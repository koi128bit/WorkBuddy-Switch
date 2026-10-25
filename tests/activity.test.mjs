import test from "node:test";
import assert from "node:assert/strict";
import { parseAuth } from "../desktop/auth.mjs";
let api = {};
try {
  api = await import("../desktop/activity.mjs");
} catch {}
const document = parseAuth(
  JSON.stringify({
    account: { uid: "fixture-user", nickname: "Fixture" },
    auth: { accessToken: "fixture-secret", domain: "www.workbuddy.cn" },
  }),
);
const task = (code, current = 0, target = 1) => ({
  code,
  title: code,
  status: "accepted",
  current,
  target,
  claimed: false,
  locked: false,
  claimable: false,
  hasReward: true,
});
const json = (data) =>
  new Response(JSON.stringify({ code: 0, data }), {
    headers: { "content-type": "application/json" },
  });
const stream = () =>
  new Response(
    'data: {"id":"server-request-1","choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"id":"server-request-1","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );

test("activity catalog covers current desktop, template, library, team, and targeted expert tasks with explicit manual reasons", () => {
  assert.equal(typeof api.activitySpec, "function");
  for (const code of [
    "RichMeow_Chat",
    "expert_5",
    "Expert_team_use_3",
    "Expert_lighthouse",
    "WorkBuddy_Valorant",
    "expert_use_maidehao",
    "expert_use_douyinyin",
    "expert_use_shangjia_xuanchuan",
    "expert_use_bowangwang",
    "skill_1",
    "template_5",
    "playbook_prompt",
    "Library_read",
    "Hp_Appearance",
    "create_canvas",
    "automation_1",
    "Buddy_App",
    "Buddy_App_QQ",
  ])
    assert.ok(api.activitySpec(task(code)), code);
  assert.equal(api.activitySpec(task("unknown-from-server")), null);
  for (const code of [
    "wb_wechat_oa_subscribe_task",
    "Expert_Philanthropy",
    "first_buddy",
  ])
    assert.match(api.pendingReason(task(code)), /本人|授权|协议|捐款|关注/);
  assert.equal(api.activitySpec({ ...task("expert_5"), locked: true }), null);
  assert.equal(
    api.activitySpec({ ...task("Library_read"), claimed: true }),
    null,
  );
});

test("activity records are bounded, sent only to official endpoints, and never locally mark tasks complete", async () => {
  assert.equal(typeof api.executeActivity, "function");
  const calls = [];
  const result = await api.executeActivity(
    document,
    { kind: "library", code: "Library_read" },
    async (url, options) => {
      calls.push({ url, options });
      return json({});
    },
  );
  assert.equal(result.dialogue, null);
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every((call) => call.url === "https://www.workbuddy.cn/v2/report"),
  );
  const events = calls.flatMap((call) => JSON.parse(call.options.body));
  assert.ok(events.some((event) => event.eventCode === "web_element_click" && event.elementId === "library_doc_intro_click"));
  assert.ok(
    !events.some((event) => event.eventCode === "chat_message_response"),
  );
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
  assert.ok(!("claimed" in result));
  assert.ok(calls.every((call) => call.options.redirect === "error"));
  await assert.rejects(
    () =>
      api.executeActivity(
        document,
        { kind: "donation", code: "Expert_Philanthropy" },
        () => {
          throw Error("must not send");
        },
      ),
    /任务|支持|范围/,
  );
});

test("targeted experts are selected from real market results by exact name and preserve only public metadata", async () => {
  assert.equal(typeof api.loadActivityResources, "function");
  const resources = await api.loadActivityResources(
    document,
    api.activitySpec(task("expert_use_douyinyin")),
    async (url, options) => {
      assert.equal(
        url,
        "https://copilot.tencent.com/portal/operation-platform/market/expert/list",
      );
      assert.equal(JSON.parse(options.body).keyword, "抖音策略师");
      return json({
        experts: [
          { expert_id: "wrong", display_name_zh: "抖音策略师", profession_zh: "抖音策略师", expert_type: "agent" },
          {
            expert_id: "ex_FbY5nlWTqDod",
            display_name_zh: "抖音策略师",
            expert_type: "agent",
            profession_zh: "运营",
            version: "1.0.0",
            private_secret: "do not expose",
          },
        ],
      });
    },
  );
  assert.equal(resources.length, 1);
  assert.equal(resources[0].id, "ex_FbY5nlWTqDod");
  assert.equal(resources[0].name, "抖音策略师");
  assert.ok(!JSON.stringify(resources).includes("private_secret"));
});

test("expert activities use a bounded real conversation and join only the actual server request receipt", async () => {
  assert.equal(typeof api.executeActivity, "function");
  const calls = [];
  const result = await api.executeActivity(
    document,
    {
      kind: "expert",
      code: "expert_5",
      model: "fast-model",
      prompt: "你好",
      resource: {
        id: "verified-expert",
        name: "数据分析师",
        type: "agent",
        version: "1.0.0",
      },
    },
    async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("/chat/completions") ? stream() : json({});
    },
  );
  const chat = calls.find((call) => call.url.endsWith("/chat/completions"));
  assert.ok(chat);
  assert.equal(chat.options.headers["X-Expert-Id"], "verified-expert");
  assert.equal(JSON.parse(chat.options.body).max_tokens, 64);
  const events = calls
    .filter((call) => call.url.endsWith("/report"))
    .flatMap((call) => JSON.parse(call.options.body));
  const use = events.find((event) => event.eventCode === "expert_actual_use");
  assert.ok(use);
  assert.equal(use.id, "verified-expert");
  assert.equal(use.requestId, "server-request-1");
  assert.equal(result.dialogue.requestId, "server-request-1");
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
});

test("failed paid activities never fabricate a successful use event or retry a paid request",async()=>{const events=[];let paid=0;await assert.rejects(()=>api.executeActivity(document,{kind:'expert',code:'expert_5',model:'fast-model',prompt:'你好',resource:{id:'verified-expert',name:'专家',type:'agent'}},async(url,options)=>{if(url.endsWith('/chat/completions')){paid++;return new Response(null,{status:429});}events.push(...JSON.parse(options.body));return json({});}),/服务|额度|停止/);assert.equal(paid,1);assert.ok(!events.some(event=>['expert_actual_use','chat_message_response'].includes(event.eventCode)));});

test("activity errors sanitize credentials and refuse foreign accounts and mismatched action types", async () => {
  assert.equal(typeof api.executeActivity, "function");
  await assert.rejects(
    () =>
      api.executeActivity(
        document,
        { kind: "library", code: "Library_read" },
        async () =>
          new Response(
            JSON.stringify({ code: 500, message: "fixture-secret" }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    (error) => !error.message.includes("fixture-secret"),
  );
  for (const action of [
    { kind: "library", code: "expert_5" },
    {
      kind: "expert",
      code: "expert_5",
      resource: { id: "../../bad", name: "X" },
    },
  ])
    await assert.rejects(
      () =>
        api.executeActivity(document, action, () => {
          throw Error("must not send");
        }),
      /任务|范围|专家|资源/,
    );
  const other = parseAuth(
    JSON.stringify({
      account: { uid: "other" },
      auth: { accessToken: "other", domain: "www.workbuddy.ai" },
    }),
  );
  await assert.rejects(
    () =>
      api.executeActivity(
        other,
        { kind: "library", code: "Library_read" },
        () => {
          throw Error("must not send");
        },
      ),
    /国内/,
  );
});

test("desktop activity requests use the supported protocol version and the actual host operating system", async () => {
  let captured;
  await api.executeActivity(
    document,
    { kind: "automation", code: "automation_1" },
    async (url, options) => {
      captured = { url, options };
      return json({});
    },
  );
  assert.equal(captured.url, "https://copilot.tencent.com/v2/report");
  assert.match(
    captured.options.headers["User-Agent"],
    /^WorkBuddy\/5\.8\.3 WorkBuddy-Switch/,
  );
  const [event] = JSON.parse(captured.options.body);
  assert.equal(event.ideVersion, "5.8.3");
  assert.equal(event.os, process.platform);
  assert.equal(event.arch, process.arch);
});

for (const [kind, code, eventCode] of [
  ["library", "Library_read", "web_element_click"],
  ["appearance", "Hp_Appearance", "appearance_skin_apply"],
  ["automation", "automation_1", "automated_task_create_suc"],
  ["apps", "Buddy_App", "buddyapp_enter_click"],
])
  test(`activity ${kind} submits its declared record without a paid call or permission grant`, async () => {
    const calls = [];
    const result = await api.executeActivity(
      document,
      { kind, code },
      async (url, options) => {
        calls.push({ url, options });
        return json({});
      },
    );
    assert.equal(result.dialogue, null);
    assert.ok(calls.every((call) => (call.url.endsWith("/v2/report") || call.url.endsWith("/v2/user-asset/appearance/set"))));
    const events = calls.flatMap((call) => JSON.parse(call.options.body));
    assert.ok(events.some((event) => event.eventCode === eventCode));
    assert.ok(
      !events.some(
        (event) =>
          event.eventCode === "chat_message_response",
      ),
    );
  });

test("resource normalization refuses unrelated or unsafe experts and reads only installed skill metadata", async () => {
  const team = api.activitySpec(task("Expert_team_use_3"));
  const resources = await api.loadActivityResources(document, team, async () =>
    json({
      experts: [
        {
          expert_id: "wrong",
          expert_type: "agent",
          display_name_zh: "个人专家",
        },
        {
          expert_id: "team-ok",
          expert_type: "team",
          display_name_zh: "专家团",
        },
        { expert_id: "team-ok", expert_type: "team", display_name_zh: "重复" },
        { expert_id: "../bad", expert_type: "team", display_name_zh: "坏条目" },
      ],
    }),
  );
  assert.deepEqual(
    resources.map((row) => row.id),
    ["team-ok"],
  );
  const skills = await api.loadActivityResources(
    document,
    api.activitySpec(task("skill_1")),
    async (url, options) => {
      assert.ok(url.endsWith("/v2/user-asset/skill"));
      assert.equal(options.method, "GET");
      return json({
        skills: [
          {
            skill_id: "installed-skill",
            name: "已安装技能",
            private_value: "never return",
          },
        ],
      });
    },
  );
  assert.equal(skills[0].id, "installed-skill");
  assert.ok(!JSON.stringify(skills).includes("private_value"));
  await assert.rejects(
    () =>
      api.loadActivityResources(document, team, async () =>
        json({ not_experts: [] }),
      ),
    /格式/,
  );
  await assert.rejects(
    () =>
      api.loadActivityResources(
        document,
        api.activitySpec(task("skill_1")),
        async () => json({}),
      ),
    /格式/,
  );
});

test("a receipt authentication failure after a real reply is not an instruction to retry the paid conversation", async () => {
  let paid = 0;
  await assert.rejects(
    () =>
      api.executeActivity(
        document,
        {
          kind: "desktop-chat",
          code: "RichMeow_Chat",
          model: "fast-model",
          prompt: "你好",
        },
        async (url) => {
          if (url.endsWith("/chat/completions")) {
            paid++;
            return stream();
          }
          return new Response(null, { status: 401 });
        },
      ),
    (error) => error.kind === "receipt",
  );
  assert.equal(paid, 1);
});

test("skill receipts keep their actual provenance and conversation finish reason", async () => {
  const calls = [];
  await api.executeActivity(
    document,
    {
      kind: "skill",
      code: "skill_1",
      model: "fast-model",
      prompt: "你好",
      resource: {
        id: "installed-skill",
        name: "本地安装技能",
        type: "skill",
        isOfficial: false,
      },
    },
    async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/chat/completions"))
        return new Response(
          'data: {"id":"skill-server-1","choices":[{"delta":{"content":"回复"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      return json({});
    },
  );
  const events = calls
    .filter((call) => call.url.endsWith("/report"))
    .flatMap((call) => JSON.parse(call.options.body));
  assert.deepEqual(
    {
      official: events.find((event) => event.eventCode === "skill_info")
        .isOfficial,
      finish: events.find((event) => event.eventCode === "skill_request_send")
        .finishReason,
    },
    { official: false, finish: "length" },
  );
});

test("activity input and response failures are bounded and never count as task completion", async () => {
  for (const response of [
    new Response(null, { status: 401 }),
    new Response(null, { status: 503 }),
    new Response("not JSON"),
    new Response("x".repeat(4 * 1024 * 1024 + 1)),
    new Response(JSON.stringify({ code: 500, message: "fixture-secret" }), {
      headers: { "content-type": "application/json" },
    }),
  ]) {
    const request = async () => response;
    await assert.rejects(() =>
      api.executeActivity(
        document,
        { kind: "library", code: "Library_read" },
        request,
      ),
    );
  }
  for (const code of ["constructor", "__proto__", "unknown"])
    assert.equal(api.activitySpec(task(code)), null);
  await assert.rejects(
    () =>
      api.executeActivity(
        document,
        { kind: "template", code: "template_5", index: -1 },
        () => {
          throw Error("must not send");
        },
      ),
    /次数/,
  );
  await assert.rejects(
    () =>
      api.executeActivity(
        document,
        { kind: "library", code: "Library_read" },
        async () => {
          throw Error("fixture-secret");
        },
      ),
    (error) =>
      error.kind === "transport" && !error.message.includes("fixture-secret"),
  );
});
