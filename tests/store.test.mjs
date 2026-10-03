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
  assert.match(f.store.records[0].profile.quotaError, /添加账号.*网页登录/);
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

function rewardServer(store) {
  const states = new Map(),
    calls = [];
  const stateFor = (id) => {
    if (!states.has(id))
      states.set(id, {
        checkedIn: false,
        travel: "arrived",
        recordId: 47,
        balance: 10,
        limit: false,
      });
    return states.get(id);
  };
  store.request = async (url, options) => {
    const id =
      options.headers["X-User-Id"] ??
      options.headers.Authorization.replace("Bearer test-secret-", "");
    const state = stateFor(id);
    calls.push({ id, url, body: options.body });
    let data;
    if (url.endsWith("checkin-activity-status"))
      data = { today_checked_in: state.checkedIn };
    else if (url.endsWith("/daily-checkin")) {
      assert.equal(state.checkedIn, false);
      state.checkedIn = true;
      state.balance += 0.25;
      data = { reward_credit: 0.25 };
    } else if (url.endsWith("/config"))
      data = { enabled: true, locations: [{ id: 2, name: "海边" }] };
    else if (url.endsWith("/status"))
      data = {
        state: state.travel,
        daily_limit_reached: state.limit,
        location: { id: 2, name: "海边" },
      };
    else if (url.endsWith("/claim")) {
      assert.equal(state.travel, "arrived");
      assert.deepEqual(JSON.parse(options.body), {});
      state.travel = "idle";
      state.limit = true;
      state.balance += 18.6;
      data = { reward_credit: 18.6 };
    } else if (url.endsWith("/depart")) {
      assert.equal(state.travel, "idle");
      assert.equal(state.limit, false);
      state.travel = "traveling";
      data = {};
    } else if (url.endsWith("get-user-resource-summary"))
      data = {
        Accounts: [{ CapacitySize: 100, CapacityRemainPrecise: state.balance }],
      };
    else throw new Error("Unexpected fixture URL");
    return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
  };
  return { states, stateFor, calls };
}

test("one-click rewards query first, claim only selected accounts, refresh balance and persist real results", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  await f.store.capture(parseAuth(auth("b")));
  const server = rewardServer(f.store);
  const beforeAuth = await readAuthFixture(f.store);
  const result = await f.store.claimRewards(["a"]);
  assert.equal(result.claimed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.credit, 18.85);
  assert.equal(result.unknownAmounts, 0);
  assert.equal(
    f.store.records.find((record) => record.profile.id === "a").profile.quota
      .remaining,
    28.85,
  );
  assert.ok(server.calls.every((call) => call.id === "a"));
  assert.equal((await f.store.claimRewards(["a"])).claimed, 0);
  assert.equal(
    server.calls.filter((call) => /\/claim$|\/daily-checkin$/.test(call.url))
      .length,
    2,
  );
  assert.equal(await readAuthFixture(f.store), beforeAuth);
  const reopened = new Store({
    directory: f.directory,
    vault: f.vault,
    controller: f.controller,
  });
  await reopened.init();
  assert.equal(reopened.rewardHistory.length, 2);
  assert.ok(!JSON.stringify(await f.store.snapshot()).includes("test-secret"));
});

async function readAuthFixture(store) {
  try {
    return await fs.readFile(store.paths.auth, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

test("traveling tasks cannot be claimed by elapsed local time and departures require an official selected location", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const server = rewardServer(f.store);
  server.stateFor("a").travel = "traveling";
  const result = await f.store.claimRewards(["a"], "travel");
  assert.equal(result.claimed, 0);
  assert.ok(!server.calls.some((call) => call.url.endsWith("/claim")));
  server.stateFor("a").travel = "idle";
  await assert.rejects(() => f.store.depart("a", "99"), /地点暂不可用/);
  await f.store.depart("a", "2");
  assert.equal(server.stateFor("a").travel, "traveling");
  assert.equal(f.store.records[0].profile.travelLocationId, "2");
  assert.equal(f.store.records[0].profile.rewards.travel.state, "traveling");
  assert.equal(f.store.rewardHistory[0].result, "departed");
});

test("automation is opt-in, honors China time and per-account exclusions, and never starts an unselected trip", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  await f.store.capture(parseAuth(auth("b")));
  const server = rewardServer(f.store);
  await f.store.runAutomation();
  assert.equal(server.calls.length, 0);
  await f.store.editAccount("b", { automaticRewards: false });
  await f.store.updateSettings({
    ...f.store.settings,
    autoCheckin: true,
    autoDepartTravel: true,
    checkinHour: 9,
  });
  server.stateFor("a").travel = "idle";
  await f.store.runAutomation(Date.parse("2026-10-03T01:00:00Z"));
  assert.equal(
    server.calls.filter((call) => call.url.endsWith("/daily-checkin")).length,
    1,
  );
  assert.ok(server.calls.every((call) => call.id === "a"));
  assert.ok(!server.calls.some((call) => call.url.endsWith("/depart")));
  assert.equal(
    await f.store.runAutomation(Date.parse("2026-10-03T01:01:00Z")),
    null,
  );
  await f.store.capture(parseAuth(auth("b")));
  assert.equal(
    f.store.records.find((record) => record.profile.id === "b").profile
      .automaticRewards,
    false,
  );
});

test("partial reward failures remain separate and never become granted credits", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  await f.store.capture(parseAuth(auth("b")));
  const server = rewardServer(f.store);
  const request = f.store.request;
  f.store.request = async (url, options) =>
    options.headers["X-User-Id"] === "b"
      ? {
          ok: true,
          status: 200,
          json: async () => ({ code: 9000, message: "活动尚未开放" }),
        }
      : request(url, options);
  const result = await f.store.claimRewards();
  assert.equal(result.claimed, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.credit, 18.85);
  assert.ok(
    server.calls
      .filter((call) => /\/claim$|\/daily-checkin$/.test(call.url))
      .every((call) => call.id === "a"),
  );
  assert.match(
    f.store.records.find((record) => record.profile.id === "b").profile.rewards
      .checkinError,
    /尚未开放/,
  );
  assert.equal(f.store.busy, false);
});
