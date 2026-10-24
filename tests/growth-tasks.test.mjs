import test from "node:test";
import assert from "node:assert/strict";
import { parseAuth } from "../desktop/auth.mjs";
let api;
try {
  api = await import("../desktop/growth-tasks.mjs");
} catch {}
const document = parseAuth(
  JSON.stringify({
    account: { uid: "fixture-user" },
    auth: {
      accessToken: "fixture-access",
      refreshToken: "fixture-refresh",
      domain: "www.codebuddy.cn",
    },
  }),
);
const response = (data) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, data }),
});
test("growth task normalization preserves server eligibility instead of guessing completion from progress", () => {
  assert.equal(typeof api?.parseGrowthTasks, "function");
  const tasks = api.parseGrowthTasks({
    tasks: [
      {
        task_code: "chat_5",
        title: "五次对话",
        accept_status: "in_progress",
        progress: { current: 5, target: 5 },
        reward_credit: 100,
      },
      {
        task_code: "expert_5",
        title: "专家任务",
        accept_status: "completed",
        progress: { current: 5, target: 5 },
      },
      { task_code: "old", title: "已领取", accept_status: "claimed" },
      {
        task_code: "locked",
        title: "未解锁",
        accept_status: "completed",
        locked: true,
      },
      { task_code: "../invalid", accept_status: "completed" },
    ],
  });
  assert.equal(tasks.length, 4);
  assert.equal(tasks[0].claimable, false);
  assert.equal(tasks[1].claimable, true);
  assert.equal(tasks[2].claimed, true);
  assert.equal(tasks[3].claimable, false);
});
test("growth list, acceptance and claims use official web routes and reject unsafe task IDs", async () => {
  assert.equal(typeof api?.getGrowthTasks, "function");
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return response(
      url.endsWith("/tasks")
        ? {
            tasks: [
              {
                task_code: "Model_chat_GLM5.2",
                title: "模型体验",
                accept_status: "not_accepted",
              },
            ],
          }
        : {},
    );
  };
  const tasks = await api.getGrowthTasks(document, request);
  await api.acceptGrowthTasks(document, [tasks[0].code], request);
  await api.claimGrowthTask(document, tasks[0].code, request);
  assert.equal(
    calls[0].url,
    "https://www.codebuddy.cn/v2/activity/growth/tasks",
  );
  assert.equal(
    calls[1].url,
    "https://www.codebuddy.cn/activity/growth/tasks/accept",
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    task_codes: ["Model_chat_GLM5.2"],
  });
  assert.ok(
    calls[2].url.endsWith("/activity/growth/tasks/Model_chat_GLM5.2/claim"),
  );
  assert.ok(
    calls.every(
      (call) =>
        call.options.redirect === "error" &&
        call.options.headers["X-Client-Platform"] === "web",
    ),
  );
  const count = calls.length;
  await assert.rejects(
    api.claimGrowthTask(document, "../other", request),
    /任务/,
  );
  assert.equal(calls.length, count);
});
test("growth claims count only explicit server rewards and distinguish an already claimed response", async () => {
  assert.equal(typeof api?.claimGrowthTask, "function");
  assert.deepEqual(
    await api.claimGrowthTask(document, "example", async () =>
      response({ credit: 1.25, energy: 2 }),
    ),
    { already: false, credit: 1.25, energy: 2 },
  );
  assert.deepEqual(
    await api.claimGrowthTask(document, "example", async () =>
      response({ balance: 999, reward_credit_estimate: 100 }),
    ),
    { already: false, credit: null, energy: null },
  );
  assert.deepEqual(
    await api.claimGrowthTask(document, "example", async () =>
      response({ already_claimed: true, credit: 100 }),
    ),
    { already: true, credit: null, energy: null },
  );
});
test("malformed task lists and foreign realm accounts fail without sending their credentials", async () => {
  assert.equal(typeof api?.parseGrowthTasks, "function");
  assert.throws(() => api.parseGrowthTasks({ unexpected: true }), /格式/);
  let called = false;
  const global = parseAuth(
    JSON.stringify({
      account: { uid: "1" },
      auth: { accessToken: "secret", domain: "www.workbuddy.ai" },
    }),
  );
  await assert.rejects(
    api.getGrowthTasks(global, async () => {
      called = true;
    }),
    /国内版/,
  );
  assert.equal(called, false);
});

test("growth task list skips malformed identifiers without aborting valid tasks", () => {
  const tasks = api.parseGrowthTasks({tasks:[null, {task_code:123}, {task_code:"ready",accept_status:"completed"}, {task_code:"ready",accept_status:"claimed"}]});
  assert.deepEqual(tasks.map(task=>task.code),["ready"]);
  assert.equal(tasks[0].claimable,true);
});
