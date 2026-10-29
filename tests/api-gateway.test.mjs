import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {
  ApiGateway,
  apiDefaults,
  validateApiConfig,
} from "../desktop/api-gateway.mjs";
import { fixture, stream } from "./helpers/api-fixture.mjs";

test("API configuration rejects remote binds, unknown options, invalid accounts and unbounded limits", () => {
  assert.equal(typeof validateApiConfig, "function", "API 配置校验尚未实现");
  assert.throws(() => validateApiConfig({ ...apiDefaults, host: "0.0.0.0" }));
  for (const patch of [
    { port: 0 },
    { port: 70000 },
    { unknownSetting: 1 },
    { strategy: "unknown" },
    { accounts: [{ provider: "trae-cn", id: "a" }] },
    {
      accounts: [
        { provider: "workbuddy", id: "a" },
        { provider: "workbuddy", id: "a" },
      ],
    },
  ])
    assert.throws(() => validateApiConfig({ ...apiDefaults, ...patch }));
  assert.equal(validateApiConfig(apiDefaults).autoStart, false);
});
test("legacy output limits are discarded without replacing the API key or selected accounts", async (t) => {
  const f = await fixture(t);
  await f.gateway.stop();
  const file = path.join(f.directory, "api-gateway.json");
  const old = JSON.parse(await fs.readFile(file, "utf8"));
  old.config.maxOutputTokens = 4096;
  await fs.writeFile(file, JSON.stringify(old));
  const gateway = new ApiGateway({
    directory: f.directory,
    stores: f.stores,
    vault: f.vault,
  });
  await gateway.init();
  t.after(() => gateway.stop());
  assert.equal(gateway.getKey(), f.gateway.getKey());
  assert.deepEqual(gateway.config.accounts, old.config.accounts);
  assert.equal(
    Object.hasOwn(gateway.snapshot().config, "maxOutputTokens"),
    false,
  );
  await gateway.saveConfig(gateway.config);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.keyEncrypted, old.keyEncrypted);
  assert.equal(Object.hasOwn(saved.config, "maxOutputTokens"), false);
});

test("the built-in API test does not inject an output cap", async (t) => {
  const f = await fixture(t);
  await f.gateway.testChat();
  assert.equal(
    Object.hasOwn(JSON.parse(f.calls[0].options.body), "max_tokens"),
    false,
  );
});
test("gateway binds only loopback, requires a key and rejects browser origins and rebinding hosts", async (t) => {
  const f = await fixture(t);
  assert.match(f.status.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal((await fetch(f.status.baseUrl + "/models")).status, 401);
  assert.equal(
    (
      await fetch(f.status.baseUrl + "/models", {
        headers: { ...f.headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const rebinding = await new Promise((resolve, reject) => {
    const req = http.get(
      f.status.baseUrl + "/models",
      { headers: { ...f.headers, Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
  });
  assert.equal(rebinding, 403);
  assert.equal(f.calls.length, 0);
  assert.ok(!JSON.stringify(f.gateway.snapshot()).includes(f.gateway.getKey()));
});
test("models are discovered from the selected official region and never include disabled entries", async (t) => {
  const f = await fixture(t);
  const result = await (
    await fetch(f.status.baseUrl + "/models", { headers: f.headers })
  ).json();
  assert.equal(result.object, "list");
  assert.deepEqual(
    result.data.map((row) => row.id),
    ["fast-model", "global:fast-model"],
  );
  assert.equal(result.data[0].context_window, 128000);
  assert.ok(
    f.calls.some(
      (call) =>
        call.url === "https://www.workbuddy.cn/v2/enterprises/personal/models",
    ),
  );
  assert.ok(
    f.calls.some(
      (call) =>
        call.url === "https://www.workbuddy.ai/v2/enterprises/personal/models",
    ),
  );
  await fetch(f.status.baseUrl + "/models", { headers: f.headers });
  assert.equal(f.calls.length, 2, "model discovery is cached");
});
test("non-streaming chat aggregates real output and usage without exposing upstream private fields", async (t) => {
  const f = await fixture(t);
  const response = await f.send({ max_completion_tokens: 64 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.object, "chat.completion");
  assert.equal(result.choices[0].message.content, "private-reply");
  assert.deepEqual(result.usage, {
    prompt_tokens: 7,
    completion_tokens: 3,
    total_tokens: 10,
  });
  assert.ok(!JSON.stringify(result).includes("upstream-private-debug"));
  const body = JSON.parse(f.calls[0].options.body);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 64);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.messages[0].content, "private-client-prompt");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal(f.gateway.snapshot().totals.succeeded, 1);
});
test("streaming replies preserve actual tool calls and reasoning while rebuilding OpenAI frames", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        [
          "data: " +
            JSON.stringify({
              id: "tool-real",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    reasoning_content: "brief",
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_real",
                        type: "function",
                        function: { name: "lookup", arguments: '{"x":' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            }) +
            "\n\n",
          "data: " +
            JSON.stringify({
              id: "tool-real",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [{ index: 0, function: { arguments: "1}" } }],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }) +
            "\n\n",
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await f.send({
    stream: true,
    tools: [
      {
        type: "function",
        function: { name: "lookup", parameters: { type: "object" } },
      },
    ],
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(body, /call_real/);
  assert.match(body, /reasoning_content/);
  assert.match(body, /\[DONE\]/);
  assert.equal(
    JSON.parse(f.calls[0].options.body).tools[0].function.name,
    "lookup",
  );
});
test("account rotation, explicit global model names and session affinity never cross regions", async (t) => {
  const f = await fixture(t);
  await f.send({ conversation_id: "session-one" });
  await f.send({ conversation_id: "session-one" });
  assert.equal(
    f.calls[0].options.headers["X-User-Id"],
    f.calls[1].options.headers["X-User-Id"],
  );
  await f.send({ messages: [{ role: "user", content: "different-session" }] });
  assert.notEqual(
    f.calls[0].options.headers["X-User-Id"],
    f.calls[2].options.headers["X-User-Id"],
  );
  await f.send({ model: "global:fast-model" });
  assert.equal(f.calls[3].url, "https://www.workbuddy.ai/v2/chat/completions");
  assert.equal(f.calls[3].options.headers["X-User-Id"], "g");
  assert.equal(JSON.parse(f.calls[3].options.body).model, "fast-model");
  assert.equal(f.gateway.snapshot().recent[0].model, "global:fast-model");
});
test("invalid bodies, excessive outputs and unsupported request fields never reach upstream", async (t) => {
  const f = await fixture(t);
  for (const body of [
    { messages: [] },
    { messages: [{ role: "root", content: "bad" }] },
    { max_tokens: -1 },
    { n: 2 },
    { api_key: "wrong-secret" },
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "file:///etc/passwd" } },
          ],
        },
      ],
    },
  ])
    assert.equal((await f.send(body)).status, 400);
  assert.equal((await f.send({}, { body: "not-json" })).status, 400);
  assert.equal(
    (await f.send({}, { body: "x".repeat(32 * 1024 * 1024 + 1) })).status,
    413,
  );
  assert.equal(f.calls.length, 0);
});
test("refused channels and partial streams are failures and never trigger another paid call", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        "data: " +
          JSON.stringify({
            id: "partial",
            choices: [{ delta: { content: "partial" } }],
          }) +
          "\n\n",
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await f.send();
  assert.equal(response.status, 502);
  assert.equal(f.calls.length, 1);
  assert.equal(f.gateway.snapshot().totals.succeeded, 0);
  f.gateway.request = async () =>
    Response.json(
      { code: 11128, message: "request illegal private-token-a" },
      { status: 403 },
    );
  const refused = await f.send({ conversation_id: "second" });
  assert.equal(refused.status, 403);
  const text = await refused.text();
  assert.match(text, /upstream_access_denied/);
  assert.ok(!text.includes("private-token"));
});
test("rate limits cool only the selected account and model, and a later request can use another eligible account", async (t) => {
  let count = 0;
  const f = await fixture(t, async () =>
    ++count === 1
      ? Response.json(
          { code: 6004 },
          { status: 429, headers: { "Retry-After": "120" } },
        )
      : stream("ok"),
  );
  const limited = await f.send();
  assert.equal(limited.status, 429);
  assert.equal(count, 1);
  assert.equal((await f.send({ conversation_id: "another" })).status, 200);
  assert.equal(count, 2);
  assert.notEqual(
    f.calls[0].options.headers["X-User-Id"],
    f.calls[1].options.headers["X-User-Id"],
  );
  assert.ok(
    f.gateway
      .snapshot()
      .accounts.find(
        (row) => row.id === f.calls[0].options.headers["X-User-Id"],
      ).cooldownUntil > Date.now(),
  );
});
test("metadata persists encrypted keys and real token totals without storing prompts or model replies", async (t) => {
  const f = await fixture(t);
  const secret = f.gateway.getKey();
  await f.send();
  await f.gateway.stop();
  const config = await fs.readFile(
    path.join(f.directory, "api-gateway.json"),
    "utf8",
  );
  const usage = await fs.readFile(
    path.join(f.directory, "api-usage.json"),
    "utf8",
  );
  for (const raw of [config, usage])
    for (const sensitive of [
      secret,
      "private-client-prompt",
      "private-reply",
      "private-token-a",
    ])
      assert.ok(!raw.includes(sensitive));
  const restored = new ApiGateway({
    directory: f.directory,
    vault: f.vault,
    stores: f.stores,
    listenPort: 0,
  });
  await restored.init();
  t.after(() => restored.stop());
  assert.equal(restored.getKey(), secret);
  assert.equal(restored.snapshot().running, false);
  assert.equal(restored.snapshot().totals.outputTokens, 3);
});
test("key rotation invalidates old clients without exposing either key in status or usage", async (t) => {
  const f = await fixture(t);
  const previous = f.gateway.getKey();
  await f.gateway.rotateKey();
  assert.notEqual(f.gateway.getKey(), previous);
  assert.equal(
    (await fetch(f.status.baseUrl + "/models", { headers: f.headers })).status,
    401,
  );
  assert.ok(!JSON.stringify(f.gateway.snapshot()).includes(f.gateway.getKey()));
});
test("parallel requests are no longer rejected and stopping aborts every in-flight upstream lease", async (t) => {
  const waiters = [];
  const entered = () =>
    new Promise((resolve) => waiters.push(resolve));
  const aborts = [];
  const f = await fixture(t, async (_url, options) => {
    waiters.shift()?.();
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => {
          aborts.push(options.headers["X-User-Id"]);
          reject(new Error("aborted"));
        },
        { once: true },
      ),
    );
  });
  const first = entered();
  const pending = [f.send().catch(() => null)];
  await first;
  const second = entered();
  pending.push(f.send({ conversation_id: "parallel" }).catch(() => null));
  await second;
  assert.equal(
    f.gateway.snapshot().activeRequests,
    2,
    "多个会话可以同时运行，不再返回 429",
  );
  await f.gateway.stop();
  await Promise.all(pending);
  assert.equal(aborts.length, 2);
  assert.equal(f.gateway.snapshot().activeRequests, 0);
  assert.equal(f.gateway.snapshot().running, false);
});
test("more concurrent conversations than selected accounts all reach an account", async (t) => {
  const waiters = [];
  const entered = () => new Promise((resolve) => waiters.push(resolve));
  const f = await fixture(t, async () => {
    waiters.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return stream();
  });
  const waits = [entered(), entered(), entered()];
  const pending = [0, 1, 2].map((index) =>
    f.send({ conversation_id: "parallel-" + index }),
  );
  await Promise.all(waits);
  const responses = await Promise.all(pending);
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200, 200],
    "两个账号也要能同时承载三个会话，不再按在途请求拒绝",
  );
  assert.equal(f.calls.length, 3);
  assert.equal(f.gateway.snapshot().activeRequests, 0);
});
test("long conversations are accepted beyond the retired 2000 message cap", async (t) => {
  const f = await fixture(t);
  const messages = [
    { role: "system", content: "你是一个长期会话助手。" },
    ...Array.from({ length: 2400 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: "第 " + index + " 条历史",
    })),
  ];
  const response = await f.send({ messages });
  assert.equal(response.status, 200);
  // The single system message is folded into the first user message, so the
  // forwarded history keeps every message body but no longer needs its own
  // system role.
  assert.equal(f.gateway.snapshot().recent[0].requestInfo.messageCount, 2400);
  assert.equal(
    JSON.parse(f.calls[0].options.body).messages.length,
    2400,
    "请求体中的历史条数原样转发，不截断",
  );
  assert.equal(
    JSON.parse(f.calls[0].options.body).messages[0].content,
    "你是一个长期会话助手。\n\n第 0 条历史",
  );
});
test("no selected credentials means no listener can be started and startup errors remain visible", async (t) => {
  const f = await fixture(t);
  await f.gateway.stop();
  await f.gateway.saveConfig({ ...f.gateway.snapshot().config, accounts: [] });
  await assert.rejects(f.gateway.start(), /账号/);
  assert.equal(f.gateway.snapshot().running, false);
});
test("a temporarily unavailable system keyring never replaces or archives a valid API key file", async (t) => {
  const f = await fixture(t);
  await f.gateway.stop();
  const file = path.join(f.directory, "api-gateway.json"),
    before = await fs.readFile(file, "utf8");
  const blocked = new ApiGateway({
    directory: f.directory,
    stores: f.stores,
    vault: {
      ...f.vault,
      decrypt() {
        throw new Error("keyring temporarily locked");
      },
    },
  });
  await blocked.init();
  t.after(() => blocked.stop());
  assert.equal(
    await fs.readFile(file, "utf8"),
    before,
    "encrypted key must remain byte-for-byte unchanged",
  );
  assert.equal(blocked.snapshot().hasKey, false);
  assert.equal(blocked.snapshot().running, false);
  assert.match(blocked.snapshot().lastError, /解密|密钥|加密/);
});
test("duplicate official catalog entries are deduplicated without replacing the first model capabilities", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({
      code: 0,
      data: {
        models: [
          { id: "fast-model", name: "first", maxOutputTokens: 4096 },
          { id: "fast-model", name: "duplicate", maxOutputTokens: 8192 },
        ],
      },
    }),
  );
  const value = await (
    await fetch(f.status.baseUrl + "/models", { headers: f.headers })
  ).json();
  assert.deepEqual(
    value.data.map((model) => model.id),
    ["fast-model", "global:fast-model"],
  );
  assert.equal(value.data[0].name, "first");
});
test("upstream empty finish strings on intermediate chunks are treated as unfinished, not as an invalid terminal status", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        [
          "data: " +
            JSON.stringify({
              id: "real-empty-finish",
              choices: [
                { index: 0, delta: { content: "OK" }, finish_reason: "" },
              ],
            }) +
            "\n\n",
          "data: " +
            JSON.stringify({
              id: "real-empty-finish",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }) +
            "\n\n",
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, "OK");
});
test("the system prompt is folded into the first user message before the upstream sees it", async (t) => {
  const f = await fixture(t);
  const system = "私有系统提示词".repeat(600);
  const response = await f.send({
    messages: [
      { role: "system", content: system },
      { role: "user", content: "private-client-prompt" },
    ],
  });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  const body = JSON.parse(f.calls[0].options.body);
  assert.equal(
    body.messages.some((message) => message.role === "system"),
    false,
    "系统角色不再出现在上游请求里",
  );
  assert.equal(
    body.messages[0].content,
    system + "\n\nprivate-client-prompt",
    "系统提示词完整前置到第一条用户消息",
  );
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.status, "ok");
  assert.equal(
    entry.requestInfo.bodyBytes,
    Buffer.byteLength(f.calls[0].options.body),
  );
});
test("every system message and text part is folded while user and tool roles stay untouched", async (t) => {
  // The official service scans system / developer messages for third-party
  // harness fingerprints and answers 11128; it never refuses user content.
  // Folding the harness prompt into the first user message keeps the model
  // instructions intact and the channel sees the prompt shape it accepts.
  const f = await fixture(t, async (_url, options) => {
    const body = JSON.parse(options.body);
    return body.messages.some((message) => message.role === "system")
      ? Response.json({ code: 11128 }, { status: 400 })
      : stream("folded-reply");
  });
  const tools = [
    { type: "function", function: { name: "read", parameters: { type: "object" } } },
  ];
  const response = await f.send({
    messages: [
      {
        role: "system",
        content: "You are an AI agent powered by DeepSeek Harness.\n\nBe helpful.",
      },
      {
        role: "system",
        content: [{ type: "text", text: "Prefix.\nSecond system part." }],
      },
      {
        role: "user",
        content: "You are an AI agent powered by DeepSeek Harness.",
      },
    ],
    tools,
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).choices[0].message.content,
    "folded-reply",
  );
  assert.equal(f.calls.length, 1, "折叠后的首个请求直接通过，不浪费被拒请求");
  const body = JSON.parse(f.calls[0].options.body);
  assert.equal(
    body.messages.some((message) => message.role === "system"),
    false,
    "每一段系统提示词都被折走",
  );
  assert.equal(
    body.messages[0].content,
    "You are an AI agent powered by DeepSeek Harness.\n\nBe helpful." +
      "\n\nPrefix.\nSecond system part." +
      "\n\nYou are an AI agent powered by DeepSeek Harness.",
    "按顺序拼接后前置到第一条用户消息",
  );
  assert.deepEqual(body.tools, tools, "工具定义原样转发");
});
test("a refused request is replayed on another account instead of failing the turn", async (t) => {
  // 11128 is an intermittent channel refusal, so a body the first account
  // refuses is replayed on the next selected account.
  const users = [];
  const f = await fixture(t, async (_url, options) => {
    const id = options.headers["X-User-Id"];
    users.push(id);
    return id === "a"
      ? Response.json({ code: 11128 }, { status: 400 })
      : stream("second-account-reply");
  });
  const response = await f.send({
    messages: [
      { role: "system", content: "系统提示".repeat(400) },
      { role: "user", content: "private-client-prompt" },
    ],
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).choices[0].message.content,
    "second-account-reply",
  );
  assert.equal(f.calls.length, 2, "首个账号被拒后只换一次号");
  assert.equal(new Set(users).size, 2, "重放发生在另一个账号上");
  const body = JSON.parse(f.calls.at(-1).options.body);
  assert.equal(
    body.messages.some((message) => message.role === "system"),
    false,
  );
  assert.equal(
    body.messages[0].content,
    "系统提示".repeat(400) + "\n\nprivate-client-prompt",
  );
  assert.equal(f.gateway.snapshot().recent[0].status, "ok");
});
test("channel refusal replays are bounded across accounts and never touch user messages", async (t) => {
  const f = await fixture(t, async () => Response.json({ code: 11128 }, { status: 400 }));
  const response = await f.send({
    messages: [
      { role: "system", content: "系统提示".repeat(400) },
      { role: "user", content: "private-client-prompt" },
    ],
  });
  assert.equal(response.status, 400);
  const value = await response.json();
  assert.equal(value.error.code, "upstream_access_denied");
  assert.match(value.error.message, /11128/);
  // Two same-region accounts, one attempt each and no more: an official
  // outage must stay bounded.
  assert.equal(f.calls.length, 2);
  const payloads = f.calls.map((call) => JSON.parse(call.options.body));
  assert.equal(
    new Set(payloads.map((body) => JSON.stringify(body.messages))).size,
    1,
    "每个账号收到的请求体完全相同，用户消息从未被改写",
  );
  assert.equal(
    payloads[0].messages.at(-1).content,
    "系统提示".repeat(400) + "\n\nprivate-client-prompt",
    "用户消息正文保持原样，只是前面拼上了系统提示词",
  );
  assert.equal(
    payloads[0].messages.some((message) => message.role === "system"),
    false,
  );
  assert.deepEqual(
    new Set(f.calls.map((call) => call.options.headers["X-User-Id"])),
    new Set(["a", "b"]),
  );
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.status, "error");
  assert.equal(entry.upstreamCode, "11128");
  assert.ok(!JSON.stringify(entry).includes("private-client-prompt"));
});
test("a refusal without any system prompt still gets one replay on another account", async (t) => {
  const f = await fixture(t, async (_url, options) =>
    options.headers["X-User-Id"] === "a"
      ? Response.json({ code: 11128 }, { status: 403 })
      : stream("replayed"),
  );
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 2);
});
test("a channel refusal that arrives after output started is never replayed", async (t) => {
  const f = await fixture(t, async () =>
    new Response(
      'data: {"choices":[{"delta":{"content":"半截回复"}}]}\n\n' +
        'data: {"code":11128}\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ),
  );
  const response = await f.send();
  assert.equal(f.calls.length, 1, "已经开始输出就不能再放一次付费请求");
  assert.ok(response.status >= 400);
});
test("local API token usage is recorded per day, account and model and survives a restart", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 200);
  const rows = f.gateway.dailyApiUsage();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "workbuddy");
  assert.equal(rows[0].model, "fast-model");
  assert.equal(rows[0].input, 7);
  assert.equal(rows[0].output, 3);
  assert.equal(rows[0].requests, 1);
  assert.equal(rows[0].unknown, 0);
  assert.match(rows[0].day, /^\d{4}-\d{2}-\d{2}$/);
  await f.gateway.stop();
  const reloaded = new ApiGateway({
    directory: f.directory,
    stores: f.stores,
    vault: f.vault,
  });
  await reloaded.init();
  t.after(() => reloaded.stop());
  assert.deepEqual(reloaded.dailyApiUsage(), rows);
  assert.ok(
    !(await fs.readFile(path.join(f.directory, "api-usage-daily.json"), "utf8"))
      .includes("private-client-prompt"),
    "本地 API 用量只保存计数，不保存提示词",
  );
});
test("a local API request without reported usage counts as an unknown request instead of zero tokens", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        [
          "data: " +
            JSON.stringify({
              id: "no-usage",
              choices: [
                { index: 0, delta: { content: "OK" }, finish_reason: "stop" },
              ],
            }) +
            "\n\n",
          "data: [DONE]\n\n",
        ].join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  assert.equal((await f.send()).status, 200);
  const [row] = f.gateway.dailyApiUsage();
  assert.equal(row.requests, 1);
  assert.equal(row.unknown, 1);
  assert.equal(row.input, 0);
  assert.equal(row.output, 0);
});
