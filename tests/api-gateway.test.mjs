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
    { maxConcurrency: 100 },
    { requestsPerMinute: 0 },
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
    (await f.send({}, { body: "x".repeat(8 * 1024 * 1024 + 1) })).status,
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
test("concurrency control and stopping abort in-flight upstream work and release every lease", async (t) => {
  let entered;
  const ready = new Promise((resolve) => (entered = resolve));
  let aborted = false;
  const f = await fixture(t, async (_url, options) => {
    entered();
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("aborted"));
        },
        { once: true },
      ),
    );
  });
  await f.gateway.stop();
  await f.gateway.saveConfig({
    ...f.gateway.snapshot().config,
    maxConcurrency: 1,
  });
  await f.gateway.start();
  const pending = f.send().catch(() => null);
  await ready;
  assert.equal((await f.send({ conversation_id: "parallel" })).status, 429);
  await f.gateway.stop();
  await pending;
  assert.equal(aborted, true);
  assert.equal(f.gateway.snapshot().activeRequests, 0);
  assert.equal(f.gateway.snapshot().running, false);
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
test("a long system prompt is shielded before the upstream sees it and the original text is recoverable", async (t) => {
  const f = await fixture(t);
  const system = "私有系统提示词".repeat(600);
  const response = await f.send({
    messages: [
      { role: "system", content: system },
      { role: "user", content: "private-client-prompt" },
    ],
  });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1, "长系统提示词首次请求即遮蔽，不浪费一次被拒请求");
  const body = JSON.parse(f.calls[0].options.body);
  const guarded = body.messages.find((message) => message.role === "system");
  assert.ok(guarded.content.includes("\u200b"));
  assert.equal(guarded.content.split("\u200b").join(""), system);
  assert.equal(body.messages.at(-1).content, "private-client-prompt");
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.status, "ok");
  assert.equal(entry.requestInfo.systemGuard, 128);
  assert.equal(
    entry.requestInfo.bodyBytes,
    Buffer.byteLength(f.calls[0].options.body),
  );
});
test("an official channel refusal escalates system shielding on the same account", async (t) => {
  const f = await fixture(t, async (_url, options) => {
    const body = JSON.parse(options.body);
    const system = body.messages.find((message) => message.role === "system").content;
    const separators = (system.match(/\u200b/g) || []).length;
    return separators >= 100
      ? stream("guarded-reply")
      : Response.json({ code: 11128 }, { status: 403 });
  });
  const system = "私有系统提示词".repeat(600);
  const response = await f.send({
    messages: [
      { role: "system", content: system },
      { role: "user", content: "private-client-prompt" },
    ],
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, "guarded-reply");
  assert.equal(f.calls.length, 3, "128 与 64 被拒后使用 32 分隔");
  assert.equal(new Set(f.calls.map((call) => call.options.headers["X-User-Id"])).size, 1);
  for (const call of f.calls) {
    const body = JSON.parse(call.options.body);
    assert.equal(body.messages.at(-1).content, "private-client-prompt");
    assert.equal(
      body.messages.find((message) => message.role === "system").content.split("\u200b").join(""),
      system,
    );
  }
  assert.equal(f.gateway.snapshot().recent[0].requestInfo.systemGuard, 32);
});
test("system shielding retries are bounded and never touch user messages", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({ code: 11128 }, { status: 400 }),
  );
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
  assert.equal(f.calls.length, 5, "一次原始请求加四次逐级遮蔽，不无限重试");
  const users = f.calls.map((call) => JSON.parse(call.options.body).messages.at(-1).content);
  assert.deepEqual(new Set(users), new Set(["private-client-prompt"]));
  assert.equal(new Set(f.calls.map((call) => call.options.headers["X-User-Id"])).size, 1);
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.status, "error");
  assert.equal(entry.upstreamCode, "11128");
  assert.equal(entry.requestInfo.systemGuard, 16);
  assert.ok(!JSON.stringify(entry).includes("private-client-prompt"));
});
test("a refusal without any system prompt is never replayed", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({ code: 11128 }, { status: 403 }),
  );
  const response = await f.send();
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 1);
  assert.equal(f.gateway.snapshot().recent[0].requestInfo.systemGuard, 0);
});
