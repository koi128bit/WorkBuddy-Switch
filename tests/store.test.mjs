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

function growthServer(store) {
  const base = rewardServer(store),
    original = store.request,
    states = new Map();
  const tasks = (id) => {
    if (!states.has(id))
      states.set(id, [
        {
          task_code: "ready",
          title: "已完成任务",
          accept_status: "completed",
          progress: { current: 1, target: 1 },
        },
        {
          task_code: "todo",
          title: "客户端体验任务",
          accept_status: "not_accepted",
          progress: { current: 0, target: 1 },
        },
        {
          task_code: "locked",
          title: "未解锁任务",
          accept_status: "not_accepted",
          locked: true,
        },
      ]);
    return states.get(id);
  };
  store.request = async (url, options) => {
    const id = options.headers["X-User-Id"];
    if (url.endsWith("/v2/activity/growth/tasks"))
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { tasks: tasks(id) } }),
      };
    if (url.endsWith("/growth/tasks/accept")) {
      base.calls.push({ id, url, body: options.body });
      for (const code of JSON.parse(options.body).task_codes) {
        const task = tasks(id).find((task) => task.task_code === code);
        assert.ok(!task.locked);
        task.accept_status = "accepted";
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: {} }),
      };
    }
    if (url.includes("/growth/tasks/") && url.endsWith("/claim")) {
      base.calls.push({ id, url, body: options.body });
      const task = tasks(id).find((task) =>
        url.includes("/" + task.task_code + "/"),
      );
      assert.equal(task.accept_status, "completed");
      task.accept_status = "claimed";
      base.stateFor(id).balance += 2.5;
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { credit: 2.5, energy: 1 } }),
      };
    }
    return original(url, options);
  };
  return { ...base, tasks };
}
test("one-click task run accepts eligible growth tasks, claims confirmed rewards and preserves task progress", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  await f.store.capture(parseAuth(auth("b")));
  const server = growthServer(f.store);
  assert.equal(typeof f.store.runTasks, "function");
  const result = await f.store.runTasks(["a"]);
  assert.equal(result.status, "completed");
  assert.equal(result.summary.claimed, 3);
  assert.equal(result.summary.accepted, 1);
  assert.equal(result.summary.credit, 21.35);
  assert.equal(result.summary.energy, 1);
  assert.ok(
    result.results.some(
      (entry) => entry.code === "todo" && entry.status === "pending",
    ),
  );
  assert.ok(!server.calls.some((call) => call.id === "b"));
  assert.ok(!server.calls.some((call) => /report|completions/.test(call.url)));
  const second = await f.store.runTasks(["a"]);
  assert.equal(second.summary.claimed, 0);
  assert.equal(
    server.calls.filter((call) => call.url.includes("/tasks/ready/claim"))
      .length,
    1,
  );
  const reopened = new Store({
    directory: f.directory,
    vault: f.vault,
    controller: f.controller,
  });
  await reopened.init();
  assert.equal((await reopened.snapshot()).taskRun.id, second.id);
  assert.ok(!JSON.stringify(await reopened.snapshot()).includes("test-secret"));
});
test("one-click task run starts only the saved official travel destination and respects the server daily limit", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const server = growthServer(f.store);
  server.stateFor("a").travel = "idle";
  await f.store.editAccount("a", { travelLocationId: "2" });
  assert.equal(typeof f.store.runTasks, "function");
  const result = await f.store.runTasks(["a"]);
  assert.equal(result.summary.departed, 1);
  assert.equal(server.stateFor("a").travel, "traveling");
  server.stateFor("a").travel = "idle";
  server.stateFor("a").limit = true;
  await f.store.runTasks(["a"]);
  assert.equal(
    server.calls.filter((call) => call.url.endsWith("/depart")).length,
    1,
  );
});
test("canceling a task run finishes the current request and stops later claims and accounts", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  await f.store.capture(parseAuth(auth("b")));
  const server = growthServer(f.store),
    original = f.store.request;
  assert.equal(typeof f.store.runTasks, "function");
  f.store.request = async (url, options) => {
    const response = await original(url, options);
    if (url.endsWith("/daily-checkin"))
      f.store.cancelTasks(f.store.tasks.snapshot().id);
    return response;
  };
  const result = await f.store.runTasks(["a", "b"]);
  assert.equal(result.status, "cancelled");
  assert.equal(result.summary.claimed, 1);
  assert.ok(server.calls.every((call) => call.id === "a"));
  assert.ok(
    !server.calls.some(
      (call) => call.url.endsWith("/claim") || call.url.endsWith("/depart"),
    ),
  );
  assert.equal(f.store.busy, false);
});
test("task acceptance failure remains visible while independent rewards can still finish", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const server = growthServer(f.store),
    original = f.store.request;
  assert.equal(typeof f.store.runTasks, "function");
  f.store.request = async (url, options) =>
    url.endsWith("/growth/tasks/accept")
      ? { ok: false, status: 503 }
      : original(url, options);
  const result = await f.store.runTasks(["a"]);
  assert.equal(result.status, "completed");
  assert.equal(result.summary.failed, 1);
  assert.ok(
    result.results.some(
      (entry) => entry.code === "accept" && entry.status === "error",
    ),
  );
  assert.equal(
    server.tasks("a").find((task) => task.task_code === "ready").accept_status,
    "claimed",
  );
});

test("task history restores interrupted runs through a public whitelist and cannot mutate the live batch", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  growthServer(f.store);
  await f.store.runTasks(["a"]);
  const file = path.join(f.directory, "task-run.json"),
    data = JSON.parse(await fs.readFile(file, "utf8"));
  data.run.status = "running";
  data.run.auth = { accessToken: "history-secret" };
  data.run.results[0].token = "history-secret";
  await fs.writeFile(file, JSON.stringify(data));
  await f.store.tasks.init();
  const snapshot = f.store.tasks.snapshot();
  assert.equal(snapshot.status, "interrupted");
  assert.ok(!JSON.stringify(snapshot).includes("history-secret"));
  snapshot.summary.claimed = 99999;
  assert.notEqual(f.store.tasks.snapshot().summary.claimed, 99999);
  assert.equal(
    JSON.parse(await fs.readFile(file, "utf8")).run.status,
    "interrupted",
  );
});
test("damaged task history is preserved for recovery instead of becoming an invalid UI snapshot", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  growthServer(f.store);
  await f.store.runTasks(["a"]);
  const file = path.join(f.directory, "task-run.json"),
    data = JSON.parse(await fs.readFile(file, "utf8"));
  data.run.summary.credit = "invalid";
  await fs.writeFile(file, JSON.stringify(data));
  await f.store.tasks.init();
  assert.equal(f.store.tasks.snapshot(), null);
  assert.match(f.store.tasks.warning, /备份/);
  const backup = (await fs.readdir(f.directory)).find((name) =>
    name.startsWith("task-run-damaged-"),
  );
  assert.ok(backup);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(f.directory, backup), "utf8")).run
      .summary.credit,
    "invalid",
  );
});
for (const step of ["接取 1 项成长任务", "领取：已完成任务"])
  test(`stopping during the progress update prevents the next growth mutation: ${step}`, async (t) => {
    const f = await fixture(t);
    await f.store.capture(parseAuth(auth("a")));
    const server = growthServer(f.store);
    let cancelled = false;
    f.store.onChange = () => {
      const run = f.store.tasks.snapshot();
      if (!cancelled && run?.currentStep === step) {
        cancelled = true;
        f.store.cancelTasks(run.id);
      }
    };
    const run = await f.store.runTasks(["a"]);
    assert.equal(run.status, "cancelled");
    const route = step.startsWith("接取")
      ? "/growth/tasks/accept"
      : "/growth/tasks/ready/claim";
    assert.ok(!server.calls.some((call) => call.url.endsWith(route)));
  });

test("growth and departure failures remain visible and do not prevent another selected account from finishing", async (t) => {
  const f = await fixture(t);
  for (const id of ["a", "b"]) await f.store.capture(parseAuth(auth(id)));
  const server = growthServer(f.store),
    original = f.store.request;
  for (const id of ["a", "b"]) {
    server.stateFor(id).travel = "idle";
    await f.store.editAccount(id, { travelLocationId: "2" });
  }
  f.store.request = async (url, options) =>
    options.headers["X-User-Id"] === "a" &&
    (url.includes("/tasks/ready/claim") || url.endsWith("/depart"))
      ? { ok: false, status: 503 }
      : original(url, options);
  const result = await f.store.runTasks(["a", "b"]);
  assert.equal(result.status, "completed");
  assert.equal(result.completedAccounts, 2);
  assert.equal(result.summary.failed, 2);
  assert.equal(result.summary.departed, 1);
  assert.ok(
    result.results.some(
      (entry) =>
        entry.accountId === "b" &&
        entry.code === "ready" &&
        entry.status === "claimed",
    ),
  );
  assert.ok(
    result.results.some(
      (entry) =>
        entry.accountId === "a" &&
        entry.code === "depart" &&
        entry.status === "error",
    ),
  );
});
test("unavailable growth API records the failure while preserving independent checkin and travel rewards", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  growthServer(f.store);
  const original = f.store.request;
  f.store.request = async (url, options) =>
    url.endsWith("/v2/activity/growth/tasks")
      ? { ok: false, status: 404 }
      : original(url, options);
  const result = await f.store.runTasks(["a"]);
  assert.equal(result.summary.claimed, 2);
  assert.equal(result.summary.failed, 1);
  assert.ok(
    result.results.some(
      (entry) => entry.code === "growth" && entry.status === "error",
    ),
  );
});
test("a final task-history write failure preserves confirmed results and recovers a failed batch without repeating rewards", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const server = growthServer(f.store),
    flush = f.store.tasks.flush.bind(f.store.tasks);
  let fail = true;
  f.store.tasks.flush = async () => {
    if (fail && f.store.tasks.current.status === "completed") {
      fail = false;
      throw new Error("fixture final write failure");
    }
    await flush();
  };
  await assert.rejects(() => f.store.runTasks(["a"]), /fixture final write/);
  assert.equal(f.store.busy, false);
  const saved = JSON.parse(
    await fs.readFile(path.join(f.directory, "task-run.json"), "utf8"),
  ).run;
  assert.equal(saved.status, "failed");
  assert.equal(saved.summary.claimed, 3);
  assert.equal((await f.store.runTasks(["a"])).summary.claimed, 0);
  assert.equal(
    server.calls.filter((call) => call.url.includes("/tasks/ready/claim"))
      .length,
    1,
  );
});

function paidDialogueServer(store, base, { advance = true } = {}) {
  const original = store.request,
    calls = [];
  let sequence = 0;
  for (const id of ["a", "b"])
    base.tasks(id).push(
      {
        task_code: "chat_5",
        title: "三次真实对话",
        accept_status: "not_accepted",
        progress: { current: 0, target: 3 },
      },
      {
        task_code: "Model_chat_GLM5.2",
        title: "GLM 模型体验",
        accept_status: "not_accepted",
        progress: { current: 0, target: 1 },
      },
    );
  store.request = async (url, options) => {
    if (url.endsWith("/v2/chat/completions")) {
      const body = JSON.parse(options.body),
        id = options.headers["X-User-Id"];
      calls.push({ url, id, body });
      sequence++;
      return new Response(
        `data: ${JSON.stringify({ id: `real-dialogue-${sequence}`, model: body.model, choices: [{ delta: { content: "真实回答" } }] })}\n\ndata: ${JSON.stringify({ id: `real-dialogue-${sequence}`, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (url.endsWith("/v2/report")) {
      const events = JSON.parse(options.body),
        id = options.headers["X-User-Id"];
      calls.push({ url, id, events });
      assert.match(events[0].requestId, /^real-dialogue-/);
      if (advance)
        for (const task of base.tasks(id)) {
          if (
            task.task_code === "chat_5" ||
            (task.task_code === "Model_chat_GLM5.2" &&
              events[0].requestModelId === "glm-5.2")
          ) {
            task.progress.current++;
            task.accept_status =
              task.progress.current >= task.progress.target
                ? "completed"
                : "in_progress";
          }
        }
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: {} }),
      };
    }
    return original(url, options);
  };
  return { calls };
}
test("paid task preview is read-only and confirmation binds the exact accounts, models, prompt and request limit", async (t) => {
  const f = await fixture(t);
  for (const id of ["a", "b"]) await f.store.capture(parseAuth(auth(id)));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base);
  assert.equal(typeof f.store.prepareTasks, "function");
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 2,
    prompt: "fixture-private-prompt",
  });
  assert.equal(paid.calls.length, 0);
  assert.equal(base.calls.length, 0);
  assert.deepEqual(plan.accountIds, ["a"]);
  assert.equal(plan.maxCalls, 2);
  assert.equal(plan.outputLimit, 64);
  assert.equal(
    plan.accounts[0].tasks.reduce((n, row) => n + row.calls, 0),
    2,
  );
  assert.ok(plan.accounts[0].tasks.some((row) => row.model === "glm-5.2"));
  const result = await f.store.runTasks(["a"], plan.id);
  assert.equal(result.summary.dialogues, 2);
  assert.equal(result.dialogueAttempts, 2);
  assert.equal(paid.calls.filter((call) => call.body).length, 2);
  assert.ok(paid.calls.every((call) => call.id === "a"));
  assert.ok(
    !JSON.stringify(await f.store.snapshot()).includes(
      "fixture-private-prompt",
    ),
  );
  assert.ok(
    base
      .tasks("a")
      .some(
        (task) =>
          task.task_code === "Model_chat_GLM5.2" &&
          task.accept_status === "claimed",
      ),
  );
  await assert.rejects(
    async () => f.store.runTasks(["a"], plan.id),
    /范围|确认|过期/,
  );
});
test("paid task plans expire and cannot be reused for another selection or bypassed by basic execution", async (t) => {
  const f = await fixture(t);
  for (const id of ["a", "b"]) await f.store.capture(parseAuth(auth(id)));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base);
  assert.equal(typeof f.store.prepareTasks, "function");
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 4,
    prompt: "你好",
  });
  await assert.rejects(
    async () => f.store.runTasks(["b"], plan.id),
    /账号|范围/,
  );
  f.store.tasks.pendingPlan.expiresAt = Date.now() - 1;
  await assert.rejects(
    async () => f.store.runTasks(["a"], plan.id),
    /过期|确认/,
  );
  assert.equal(base.calls.length, 0);
  await f.store.runTasks(["a"]);
  assert.equal(paid.calls.length, 0);
});
test("completed real dialogue with no official progress stops further paid attempts for that account", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base, { advance: false });
  assert.equal(typeof f.store.prepareTasks, "function");
  const plan = await f.store.prepareTasks(["a"], {
      includeAI: true,
      maxCalls: 10,
      prompt: "你好",
    }),
    run = await f.store.runTasks(["a"], plan.id);
  assert.equal(run.summary.dialogues, 1);
  assert.equal(run.dialogueAttempts, 1);
  assert.equal(paid.calls.filter((call) => call.body).length, 1);
  assert.ok(
    run.results.some((entry) =>
      /未确认.*进度|进度.*未.*确认/.test(entry.detail),
    ),
  );
});
test("stopping an in-flight real dialogue retains its result and prevents subsequent paid requests", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base),
    request = f.store.request;
  assert.equal(typeof f.store.prepareTasks, "function");
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 10,
    prompt: "你好",
  });
  f.store.request = async (url, options) => {
    const response = await request(url, options);
    if (url.endsWith("/v2/chat/completions"))
      f.store.cancelTasks(f.store.tasks.snapshot().id);
    return response;
  };
  const run = await f.store.runTasks(["a"], plan.id);
  assert.equal(run.status, "cancelled");
  assert.equal(run.summary.dialogues, 1);
  assert.equal(paid.calls.filter((call) => call.body).length, 1);
});
test("uncertain paid stream results stop the account and never emit a completion event or retry the request", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base),
    request = f.store.request;
  assert.equal(typeof f.store.prepareTasks, "function");
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 10,
    prompt: "你好",
  });
  let attempts = 0;
  f.store.request = async (url, options) => {
    if (url.endsWith("/v2/chat/completions")) {
      attempts++;
      return new Response(
        'data: {"id":"partial","choices":[{"delta":{"content":"未完成"}}]}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return request(url, options);
  };
  const run = await f.store.runTasks(["a"], plan.id);
  assert.equal(attempts, 1);
  assert.equal(run.summary.dialogues, 0);
  assert.equal(run.dialogueAttempts, 1);
  assert.equal(paid.calls.length, 0);
  assert.ok(
    run.results.some(
      (entry) => entry.status === "error" && /对话/.test(entry.title),
    ),
  );
});

test("growth tasks that were not accepted by the server never trigger a paid dialogue", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base),
    request = f.store.request;
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 10,
    prompt: "你好",
  });
  f.store.request = async (url, options) =>
    url.endsWith("/growth/tasks/accept")
      ? new Response(null, { status: 503 })
      : request(url, options);
  const run = await f.store.runTasks(["a"], plan.id);
  assert.equal(run.summary.dialogues, 0);
  assert.equal(paid.calls.length, 0);
  assert.equal(run.summary.failed, 1);
});
test("changing the public preview object cannot alter the approved prompt or model and newly completed tasks are not called again", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base);
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 2,
    prompt: "original approved prompt",
  });
  plan.options.prompt = "tampered";
  plan.accounts[0].tasks[0].model = "auto";
  const run = await f.store.runTasks(["a"], plan.id);
  assert.ok(
    paid.calls
      .filter((call) => call.body)
      .every(
        (call) => call.body.messages[0].content === "original approved prompt",
      ),
  );
  assert.equal(run.summary.dialogues, 2);
  for (const task of base.tasks("a"))
    if (task.task_code === "chat_5") task.accept_status = "completed";
  const next = await f.store.prepareTasks(["a"], {
    includeAI: true,
    maxCalls: 20,
    prompt: "你好",
  });
  assert.equal(next.maxCalls, 0);
  const previous = paid.calls.length;
  await f.store.runTasks(["a"], next.id);
  assert.equal(paid.calls.length, previous);
});

test("basic previews make no upstream calls and the total dialogue budget does not spill into later accounts", async (t) => {
  const f = await fixture(t);
  for (const id of ["a", "b"]) await f.store.capture(parseAuth(auth(id)));
  const base = growthServer(f.store),
    paid = paidDialogueServer(f.store, base);
  const basic = await f.store.prepareTasks(["a", "b"], {
    includeAI: false,
    maxCalls: 20,
    prompt: "你好",
  });
  assert.equal(basic.maxCalls, 0);
  assert.equal(base.calls.length, 0);
  assert.equal(paid.calls.length, 0);
  const limited = await f.store.prepareTasks(["a", "b"], {
    includeAI: true,
    maxCalls: 1,
    prompt: "你好",
  });
  assert.equal(limited.maxCalls, 1);
  assert.equal(limited.accounts[1].tasks.length, 0);
  await f.store.runTasks(["a", "b"], limited.id);
  assert.equal(paid.calls.filter((call) => call.body).length, 1);
  assert.ok(paid.calls.every((call) => call.id === "a"));
});
for (const failure of ["report", "progress"])
  test(`a ${failure} failure after a paid completion prevents another dialogue`, async (t) => {
    const f = await fixture(t);
    await f.store.capture(parseAuth(auth("a")));
    const base = growthServer(f.store),
      paid = paidDialogueServer(f.store, base),
      request = f.store.request;
    const plan = await f.store.prepareTasks(["a"], {
      includeAI: true,
      maxCalls: 20,
      prompt: "你好",
    });
    let after = false;
    f.store.request = async (url, options) => {
      if (url.endsWith("/v2/report")) {
        after = true;
        if (failure === "report") return new Response(null, { status: 503 });
      }
      if (
        after &&
        failure === "progress" &&
        url.endsWith("/v2/activity/growth/tasks")
      )
        return new Response(null, { status: 503 });
      return request(url, options);
    };
    const run = await f.store.runTasks(["a"], plan.id);
    assert.equal(run.summary.dialogues, 1);
    assert.equal(run.dialogueAttempts, 1);
    assert.equal(paid.calls.filter((call) => call.body).length, 1);
    assert.ok(
      run.results.some(
        (entry) =>
          entry.status === "error" && /停止继续对话/.test(entry.detail),
      ),
    );
  });

test("full task scope runs activities and real experts, waits for delayed scoring, and continues tasks unlocked by a claim", async (t) => {
  const f = await fixture(t);
  await f.store.capture(parseAuth(auth("a")));
  const base = growthServer(f.store),
    original = f.store.request,
    calls = [];
  f.store.tasks.pause = async () => {};
  const additional = [
    {
      task_code: "Library_read",
      title: "体验资料库",
      accept_status: "not_accepted",
      progress: { current: 0, target: 1 },
    },
    {
      task_code: "template_5",
      title: "使用模板",
      accept_status: "not_accepted",
      progress: { current: 0, target: 2 },
    },
    {
      task_code: "expert_use_douyinyin",
      title: "抖音策略师",
      accept_status: "not_accepted",
      progress: { current: 0, target: 1 },
    },
    {
      task_code: "Expert_team_use_3",
      title: "专家团",
      accept_status: "not_accepted",
      locked: true,
      progress: { current: 0, target: 1 },
    },
    {
      task_code: "RichMeow_Chat",
      title: "桌面端对话",
      accept_status: "not_accepted",
      progress: { current: 0, target: 1 },
    },
  ];
  base.tasks("a").push(...additional);
  const queued = [];
  let sequence = 0;
  f.store.request = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/market/expert/list")) {
      const body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            experts: [
              {
                expert_id:
                  body.expert_type === "team"
                    ? "team-verified"
                    : "ex_FbY5nlWTqDod",
                display_name_zh:
                  body.expert_type === "team" ? "专家团" : "抖音策略师",
                expert_type: body.expert_type === "team" ? "team" : "agent",
                version: "1.0.0",
              },
            ],
          },
        }),
      );
    }
    if (url.endsWith("/chat/completions")) {
      sequence++;
      return new Response(
        "data: " +
          JSON.stringify({
            id: "server-full-" + sequence,
            choices: [{ delta: { content: "你好" } }],
          }) +
          "\n\ndata: " +
          JSON.stringify({
            id: "server-full-" + sequence,
            choices: [{ finish_reason: "stop" }],
          }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (url.endsWith("/v2/report")) {
      for (const event of JSON.parse(options.body)) {
        const code =
          event.eventCode === "web_element_click" &&
          event.elementId === "library_doc_intro_click"
            ? "Library_read"
            : event.eventCode === "template_used"
              ? "template_5"
              : event.eventCode === "expert_actual_use"
                ? event.expertType === "team"
                  ? "Expert_team_use_3"
                  : "expert_use_douyinyin"
                : event.eventCode === "chat_message_response"
                  ? "RichMeow_Chat"
                  : null;
        if (code) {
          if (event.eventCode === "expert_actual_use")
            assert.match(event.requestId, /^server-full-/);
          queued.push({ code, reads: 2 });
        }
      }
      return new Response(JSON.stringify({ code: 0, data: {} }));
    }
    if (url.endsWith("/v2/activity/growth/tasks"))
      for (const item of queued) {
        if (item.reads > 0 && --item.reads === 0) {
          const row = base
            .tasks("a")
            .find((row) => row.task_code === item.code);
          if (row.accept_status !== "claimed") {
            row.progress.current = Math.min(
              row.progress.target,
              row.progress.current + 1,
            );
            row.accept_status =
              row.progress.current >= row.progress.target
                ? "completed"
                : "in_progress";
          }
        }
      }
    const response = await original(url, options);
    if (url.endsWith("/Library_read/claim"))
      base
        .tasks("a")
        .find((row) => row.task_code === "Expert_team_use_3").locked = false;
    return response;
  };
  const plan = await f.store.prepareTasks(["a"], {
    includeAI: true,
    includeActivities: true,
    maxCalls: 80,
    prompt: "你好",
  });
  assert.equal(
    calls.filter(
      (call) =>
        call.url.endsWith("/report") || call.url.endsWith("/chat/completions"),
    ).length,
    0,
  );
  assert.equal(plan.maxCalls, 5);
  assert.ok(plan.accounts[0].tasks.some((row) => row.code === "Library_read"));
  assert.ok(
    plan.accounts[0].tasks.some(
      (row) => row.code === "Expert_team_use_3" && row.waitingForUnlock,
    ),
  );
  const result = await f.store.runTasks(["a"], plan.id);
  for (const row of additional)
    assert.equal(row.accept_status, "claimed", row.task_code);
  assert.equal(result.dialogueAttempts, 4);
  assert.equal(result.summary.dialogues, 4);
  assert.equal(result.summary.activities, 1);
  assert.equal(result.results.filter(row=>row.code === "template_5" && row.status === "dialogue").length, 2);
  assert.ok(
    result.results.some(
      (row) => row.code === "template_5" && row.status === "claimed",
    ),
  );
  assert.equal(f.store.busy, false);
});
