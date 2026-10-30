import test from "node:test";
import assert from "node:assert/strict";
import { Login, officialLoginURL } from "../desktop/login.mjs";
import { apiOrigin, fetchQuota } from "../desktop/quota.mjs";
import { parseAuth } from "../desktop/auth.mjs";
import { Store } from "../desktop/store.mjs";
import { workBuddySessionURL } from "../desktop/client-registry.mjs";
import { WorkBuddyController } from "../desktop/controller.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
const doc = (domain) =>
  parseAuth(
    JSON.stringify({
      account: { uid: "1" },
      auth: { accessToken: "fixture-token", domain },
    }),
  );
test("WorkBuddy global login and quota never send authorization to a CN origin", async () => {
  assert.equal(apiOrigin(doc("www.workbuddy.ai")), "https://www.workbuddy.ai");
  assert.equal(
    officialLoginURL("https://www.workbuddy.ai/login", "workbuddy-global"),
    "https://www.workbuddy.ai/login",
  );
  assert.throws(() =>
    officialLoginURL("https://www.codebuddy.cn/login", "workbuddy-global"),
  );
  let calls = 0;
  const login = new Login(async (url) => {
    assert.ok(url.startsWith("https://www.workbuddy.ai/"));
    if (url.includes("/auth/state"))
      assert.equal(new URL(url).searchParams.get("platform"), "workbuddy-ai");
    return {
      ok: true,
      json: async () => ({
        data:
          ++calls === 1
            ? { state: "fixture", authUrl: "https://www.workbuddy.ai/login" }
            : calls === 2
              ? { accessToken: "fixture", domain: "www.workbuddy.ai" }
              : { uid: "1" },
      }),
    };
  }, "workbuddy-global");
  const ticket = await login.start();
  assert.equal((await login.poll(ticket.id)).id, "1");
  await fetchQuota(doc("www.workbuddy.ai"), async (url) => {
    assert.ok(url.startsWith("https://www.workbuddy.ai/"));
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { Accounts: [] } }),
    };
  });
});
test("WorkBuddy stores reject account material from another region before saving", async () => {
  const store = new Store({
    provider: "workbuddy-global",
    directory: "/unused",
    vault: { available: () => true },
    controller: {},
  });
  await assert.rejects(store.capture(doc("www.codebuddy.cn")), /地区|国际版/);
  assert.equal(store.paths.auth.endsWith("workbuddy-desktop-ai.info"), true);
});
test("session continuation opens the selected edition's registered deep link", () => {
  assert.equal(
    workBuddySessionURL("workbuddy-global", "session/1"),
    "workbuddy-ai://chat/session%2F1",
  );
  assert.equal(
    workBuddySessionURL("workbuddy", "session/1"),
    "workbuddy://chat/session%2F1",
  );
  assert.throws(() => workBuddySessionURL("trae-cn", "x"));
});
test("the official idle prewarm worker is not an interactive CLI or the main window", async () => {
  const executable = "/Applications/WorkBuddy AI.app";
  const controller = new WorkBuddyController(() => ({}), {
    provider: "workbuddy-global",
    platform: "darwin",
  });
  const ui = { pid: 1, command: executable + "/Contents/MacOS/Electron" };
  const prewarm = {
    pid: 2,
    command:
      executable +
      "/Contents/MacOS/Electron --optimize-for-size " +
      executable +
      "/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy --prewarm --prewarm-id wb-pool-1234567890123-abcdef",
  };
  controller.prewarmIdle = async (process) => process.pid === 2;
  assert.deepEqual(controller.mainProcesses([ui, prewarm], executable), [ui]);
  await assert.doesNotReject(() =>
    controller.ensureNoCLI([prewarm], executable),
  );
  await assert.rejects(
    () => controller.ensureNoCLI([{ ...prewarm, pid: 3 }], executable),
    /终端会话/,
  );
  for (const suffix of [
    "--print hello",
    "--prewarm-other",
    '--print "--prewarm"',
  ]) {
    const active = {
      pid: 3,
      command:
        executable +
        "/Contents/Resources/app.asar.unpacked/cli/codebuddy.js " +
        suffix,
    };
    await assert.rejects(
      () => controller.ensureNoCLI([active], executable),
      /终端会话/,
    );
  }
});

test("prewarm guard checks a real read-only ping, exact PID and idle status", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "wbs-pool-"),
  );
  const id = "wb-pool-1234567890123-abcdef";
  const address =
    process.platform === "win32"
      ? `\\\\.\\pipe\\codebuddy-prewarm-${id}`
      : path.join(directory, `codebuddy-prewarm-${id}.sock`);
  let status = "idle",
    pid = 77;
  const calls = [];
  const server = net.createServer((socket) =>
    socket.once("data", (raw) => {
      calls.push(JSON.parse(raw.toString()));
      socket.end(JSON.stringify({ ok: true, cmd: "ping", status, pid }) + "\n");
    }),
  );
  await new Promise((resolve) => server.listen(address, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const controller = new WorkBuddyController(() => ({}), {
    provider: "workbuddy-global",
    platform: process.platform,
    env: { CODEBUDDY_CODE_PREWARM_SOCKET_PATH: directory },
  });
  const processInfo = {
    pid: 77,
    command: `/fixture/cli/bin/codebuddy --prewarm --prewarm-id ${id}`,
  };
  await assert.doesNotReject(() =>
    controller.ensureNoCLI([processInfo], "/fixture"),
  );
  status = "active";
  await assert.rejects(
    () => controller.ensureNoCLI([processInfo], "/fixture"),
    /终端会话/,
  );
  status = "idle";
  pid = 78;
  await assert.rejects(
    () => controller.ensureNoCLI([processInfo], "/fixture"),
    /终端会话/,
  );
  assert.deepEqual(calls, [{ cmd: "ping" }, { cmd: "ping" }, { cmd: "ping" }]);
});
