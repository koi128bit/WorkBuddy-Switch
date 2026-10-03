import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../desktop/store.mjs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseAuth } from "../desktop/auth.mjs";
import { decodeBackup } from "../desktop/backup.mjs";

const auth = (id) =>
  JSON.stringify({
    account: { uid: id, nickname: `Account ${id}` },
    auth: { accessToken: `test-secret-${id}` },
    machineId: "fixture",
  });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wb-store-test-"));
  t.after(() => fs.rm(directory, { recursive: true }));
  const key = randomBytes(32);
  const vault = {
    available: () => true,
    encrypt(raw) {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, c.update(raw), c.final(), c.getAuthTag()]);
    },
    decrypt(bytes) {
      const d = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      d.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([
        d.update(bytes.subarray(12, -16)),
        d.final(),
      ]).toString();
    },
  };
  let running = false,
    failLaunch = false,
    launchCount = 0;
  const controller = {
    executable: async () => "/fixture/WorkBuddy.app",
    status: async () => ({
      installed: true,
      running,
      executable: "/fixture/WorkBuddy.app",
    }),
    async stop() {
      const previous = running;
      running = false;
      return previous;
    },
    async launch() {
      launchCount++;
      if (failLaunch && launchCount === 1) throw new Error("启动失败");
      running = true;
    },
  };
  const store = new Store({
    directory,
    vault,
    controller,
    pathsContext: { home: directory, platform: "darwin" },
    request: async () => ({
      status: 200,
      ok: true,
      json: async () => ({ data: { Accounts: [] } }),
    }),
  });
  await store.init();
  await fs.mkdir(path.dirname(store.paths.auth), { recursive: true });
  return {
    store,
    directory,
    vault,
    controller,
    setRunning: (v) => {
      running = v;
    },
    failLaunch: () => {
      failLaunch = true;
    },
  };
}
test("capture persists encryption and public snapshot has no access token", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("a"));
  await f.store.captureCurrent();
  assert.ok(
    !(await fs.readFile(path.join(f.directory, "vault.json"), "utf8")).includes(
      "test-secret-a",
    ),
  );
  assert.ok(!JSON.stringify(await f.store.snapshot()).includes("test-secret"));
  assert.equal(f.store.document("a").id, "a");
});
test("encryption unavailable never writes a plaintext account fallback", async (t) => {
  const f = await fixture(t);
  f.vault.available = () => false;
  await fs.writeFile(f.store.paths.auth, auth("a"));
  await assert.rejects(() => f.store.captureCurrent(), /加密服务不可用/);
  assert.equal(f.store.records.length, 0);
});
test("failed client restart restores original authentication and index", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("b"));
  await f.store.captureCurrent();
  await fs.writeFile(f.store.paths.auth, auth("a"));
  f.setRunning(true);
  f.failLaunch();
  await assert.rejects(() => f.store.switchAccount("b"), /启动失败/);
  assert.equal((await f.store.active()).id, "a");
  assert.equal(f.store.records.length, 1);
  assert.equal(f.store.busy, false);
});
test("switch saves source account and honors disabled automatic restart", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("b"));
  await f.store.captureCurrent();
  await fs.writeFile(f.store.paths.auth, auth("a"));
  await f.store.updateSettings({
    ...f.store.settings,
    restartAfterSwitch: false,
  });
  await f.store.switchAccount("b");
  assert.equal((await f.store.active()).id, "b");
  assert.equal(f.store.records.length, 2);
  assert.equal((await f.controller.status()).running, false);
});
test("account name and settings persist after reload", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("a"));
  await f.store.captureCurrent();
  await f.store.editAccount("a", {
    nickname: "Work",
    note: "Hello",
    favorite: true,
  });
  await f.store.updateSettings({
    ...f.store.settings,
    theme: "dark",
    refreshSeconds: 0,
  });
  const second = new Store({
    directory: f.directory,
    vault: f.vault,
    controller: f.controller,
  });
  await second.init();
  assert.equal(second.settings.theme, "dark");
  assert.equal(second.records[0].profile.nickname, "Work");
});
test("graceful client exit saves a newly refreshed source token before switching", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("b"));
  await f.store.captureCurrent();
  await fs.writeFile(f.store.paths.auth, auth("a"));
  const stop = f.controller.stop;
  f.controller.stop = async () => {
    const document = JSON.parse(auth("a"));
    document.auth.accessToken = "renewed-on-exit-fixture";
    await fs.writeFile(f.store.paths.auth, JSON.stringify(document));
    return stop();
  };
  await f.store.switchAccount("b");
  assert.equal((await f.store.active()).id, "b");
  assert.equal(f.store.document("a").token, "renewed-on-exit-fixture");
});
test("corrupt saved account index fails visibly instead of resetting accounts", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, "vault.json"), "{broken");
  await assert.rejects(() => f.store.init(), /账号库损坏/);
  assert.equal(
    await fs.readFile(path.join(f.directory, "vault.json"), "utf8"),
    "{broken",
  );
});
test("duplicate portable import keeps existing account and rejects identity mismatch", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("a"));
  await f.store.captureCurrent();
  const backup = await f.store.exportAccounts("secure-password");
  await f.store.editAccount("a", { nickname: "Preserved" });
  assert.equal(await f.store.importAccounts(backup, "secure-password"), 0);
  assert.equal(f.store.records[0].profile.nickname, "Preserved");
});
test("overlapping account mutations are rejected", async (t) => {
  const f = await fixture(t);
  let release;
  const pending = f.store.exclusive(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(() => f.store.removeAccount("a"), /操作正在进行/);
  release();
  await pending;
});
test("failed quota query retains previous cache with a visible error", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.store.paths.auth, auth("a"));
  await f.store.captureCurrent();
  await f.store.refreshQuotas();
  f.store.request = async () => {
    throw new Error("network");
  };
  await f.store.refreshQuotas();
  assert.equal(f.store.records[0].profile.quota.remaining, 0);
  assert.match(f.store.records[0].profile.quotaError, /无法连接/);
});
test("browser authorization survives later capture of device-bound desktop credentials", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  await f.store.capture(
    parseAuth(
      JSON.stringify({
        account: { uid: "a" },
        auth: { accessToken: { $wbEncrypted: 1, envelope: "opaque-fixture" } },
      }),
    ),
  );
  assert.equal(f.store.document("a").protectedToken, true);
  assert.equal(f.store.records[0].profile.protectedToken, true);
  const exported = decodeBackup(
    await f.store.exportAccounts("secure-password"),
    "secure-password",
  );
  assert.equal(parseAuth(exported[0].raw).token, "test-secret-a");
  await f.store.refreshQuotas();
  assert.equal(f.store.records[0].profile.quotaError, null);
  assert.ok(
    !JSON.stringify(await f.store.snapshot()).includes("test-secret-a"),
  );
});
test("device-bound credentials cannot be mistaken for a portable backup", async (t) => {
  const f = await fixture(t);
  await f.store.capture(
    parseAuth(
      JSON.stringify({
        account: { uid: "a" },
        auth: { accessToken: { $wbEncrypted: 1, envelope: "opaque-fixture" } },
      }),
    ),
  );
  await assert.rejects(
    () => f.store.exportAccounts("secure-password"),
    /本机加密凭据/,
  );
  await f.store.refreshQuotas();
  assert.match(f.store.records[0].profile.quotaError, /网页登录添加/);
});
test("expired API authorization renews once and persists the fresh credential", async (t) => {
  const f = await fixture(t);
  await f.store.capture(
    parseAuth(
      JSON.stringify({
        account: { uid: "a" },
        auth: {
          accessToken: "expired-fixture",
          refreshToken: "refresh-fixture",
          domain: "www.codebuddy.cn",
        },
      }),
    ),
  );
  const calls = [];
  f.store.request = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/refresh"))
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            accessToken: "fresh-fixture",
            refreshToken: "next-refresh-fixture",
            expiresIn: 3600,
          },
        }),
      };
    if (options.headers.Authorization === "Bearer expired-fixture")
      return { ok: false, status: 401 };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { Accounts: [] } }),
    };
  };
  await f.store.refreshQuotas();
  assert.equal(calls.length, 3);
  assert.equal(f.store.document("a").token, "fresh-fixture");
  assert.equal(f.store.records[0].profile.quotaError, null);
  assert.ok(
    !JSON.stringify(await f.store.snapshot()).includes("fresh-fixture"),
  );
});
