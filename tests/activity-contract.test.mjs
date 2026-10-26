import test from "node:test";
import assert from "node:assert/strict";
import { parseAuth } from "../desktop/auth.mjs";
import { parseGrowthTasks } from "../desktop/growth-tasks.mjs";
import {
  activitySpec,
  loadActivityResources,
  executeActivity,
} from "../desktop/activity.mjs";
const document = parseAuth(
  JSON.stringify({
    account: { uid: "fixture-user" },
    auth: { accessToken: "fixture-secret", domain: "www.workbuddy.cn" },
  }),
);
const json = (data) => new Response(JSON.stringify({ code: 0, data }));
const stream = () =>
  new Response(
    'data: {"id":"contract-real-1","choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );

test("library grading uses the web click element on the official introduction document", async () => {
  const calls = [];
  await executeActivity(
    document,
    { kind: "library", code: "Library_read" },
    async (url, options) => {
      calls.push({ url, options });
      return json({});
    },
  );
  const event = JSON.parse(calls[0].options.body)[0];
  assert.equal(event.eventCode, "web_element_click");
  assert.equal(event.elementId, "library_doc_intro_click");
  assert.equal(
    event.pageURL,
    "https://www.workbuddy.cn/space/d/o0KWYeynteVv06UnAZqIFm",
  );
  assert.ok(!("extName" in event));
  assert.equal(calls[0].options.headers["X-Client-Platform"], "web");
});

test("appearance tasks apply the declared official theme before reporting its application", async () => {
  const calls = [];
  await executeActivity(
    document,
    { kind: "appearance", code: "Hp_Appearance" },
    async (url, options) => {
      calls.push({ url, options });
      return json({});
    },
  );
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/v2/user-asset/appearance/set", "/v2/report"],
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    kind: "theme",
    resource_key: "theme-tkmw7j",
  });
  const event = JSON.parse(calls[1].options.body)[0];
  assert.equal(event.id, "theme-tkmw7j");
  assert.equal(event.action, "apply");
});

test("task-assigned experts preserve their exact identifier and cannot be replaced by a same-name market result", async () => {
  const [task] = parseGrowthTasks({
    tasks: [
      {
        task_code: "expert_use_douyinyin",
        title: "抖音策略师",
        accept_status: "accepted",
        progress: { current: 0, target: 1 },
        jump_url: "workbuddy://expert?expert_id=ex_FbY5nlWTqDod",
      },
    ],
  });
  assert.equal(task.expertId, "ex_FbY5nlWTqDod");
  const resources = await loadActivityResources(
    document,
    activitySpec(task),
    async () =>
      json({
        experts: [
          {
            expert_id: "wrong-same-name",
            display_name_zh: "抖音策略师",
            expert_type: "agent",
          },
          {
            expert_id: "ex_FbY5nlWTqDod",
            display_name_zh: "斗音音",
            profession_zh: "抖音策略师",
            expert_type: "agent",
          },
        ],
      }),
  );
  assert.deepEqual(
    resources.map((item) => item.id),
    ["ex_FbY5nlWTqDod"],
  );
});

test("expert receipts join the full real chat lifecycle and targeted experts use the local activity mode", async () => {
  const calls = [];
  await executeActivity(
    document,
    {
      kind: "expert",
      code: "expert_use_douyinyin",
      model: "fast-model",
      prompt: "你好",
      resource: { id: "ex_FbY5nlWTqDod", name: "斗音音", type: "agent" },
    },
    async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("/chat/completions") ? stream() : json({});
    },
  );
  const events = calls
    .filter((call) => call.url.endsWith("/report"))
    .flatMap((call) => JSON.parse(call.options.body));
  for (const code of [
    "agent_task_created",
    "chat_message_send",
    "chat_request_send",
    "chat_message_response",
    "chat_message_status",
    "chat_request_response",
    "expert_actual_use",
  ])
    assert.ok(
      events.some((event) => event.eventCode === code),
      code,
    );
  const usage = events.find((event) => event.eventCode === "expert_actual_use");
  assert.equal(usage.mode, "LOCAL");
  assert.equal(usage.id, "ex_FbY5nlWTqDod");
  assert.equal(usage.requestId, "contract-real-1");
  assert.equal(
    events.find((event) => event.eventCode === "chat_message_response")
      .outputToken,
    2,
  );
  assert.ok(
    calls.findIndex((call) => call.url.endsWith("/report")) <
      calls.findIndex((call) => call.url.endsWith("/chat/completions")),
  );
});

test("template, inspiration and canvas compatibility actions reserve and use an approved real model response", async () => {
  for (const [kind, code, eventCode] of [
    ["template", "template_5", "template_used"],
    ["playbook", "playbook_prompt", "playbook_prompt_send"],
    ["canvas", "create_canvas", "wbx_design_canvas_task_create"],
  ]) {
    const spec = activitySpec({
      code,
      status: "accepted",
      current: 0,
      target: 1,
      hasReward: true,
    });
    assert.equal(spec.paid, true);
    assert.equal(spec.compatibility, true);
    const calls = [];
    const result = await executeActivity(
      document,
      { kind, code, prompt: "你好", model: "fast-model", index: 0 },
      async (url, options) => {
        calls.push({ url, options });
        return url.endsWith("/chat/completions") ? stream() : json({});
      },
    );
    assert.equal(result.dialogue.requestId, "contract-real-1");
    const event = calls
      .filter((call) => call.url.endsWith("/report"))
      .flatMap((call) => JSON.parse(call.options.body))
      .find((event) => event.eventCode === eventCode);
    assert.equal(event.requestId, "contract-real-1");
  }
});

test("application activity telemetry never calls an authorization or consent endpoint", async () => {
  const events = [];
  await executeActivity(
    document,
    { kind: "apps", code: "Buddy_App" },
    async (url, options) => {
      assert.equal(url, "https://www.workbuddy.cn/v2/report");
      events.push(...JSON.parse(options.body));
      return json({});
    },
  );
  assert.deepEqual(
    events.map((event) => event.eventCode),
    [
      "buddyapp_discover_click",
      "buddyapp_show",
      "buddyapp_enter_click",
      "buddyapp_auth_confirm_click",
      "buddyapp_bindaccount_skip_click",
    ],
  );
});

test("stopping during theme settlement prevents its subsequent report", async () => {
  let stopped = false;
  const calls = [];
  await assert.rejects(
    () =>
      executeActivity(
        document,
        { kind: "appearance", code: "Hp_Appearance" },
        async (url) => {
          calls.push(url);
          if (url.endsWith("/appearance/set")) stopped = true;
          return json({});
        },
        { shouldStop: () => stopped, pause: async () => {} },
      ),
    /停止/,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith("/appearance/set"));
});

test("stopping after expert selection never starts the paid conversation", async () => {
  let stopped = false,
    paid = 0;
  await assert.rejects(
    () =>
      executeActivity(
        document,
        {
          kind: "expert",
          code: "expert_5",
          model: "fast-model",
          prompt: "你好",
          resource: { id: "selected-expert", name: "专家", type: "agent" },
        },
        async (url) => {
          if (url.endsWith("/chat/completions")) {
            paid++;
            return stream();
          }
          stopped = true;
          return json({});
        },
        { shouldStop: () => stopped, pause: async () => {} },
      ),
    /停止/,
  );
  assert.equal(paid, 0);
});
