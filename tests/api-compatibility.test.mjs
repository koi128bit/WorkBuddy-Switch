import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, stream } from "./helpers/api-fixture.mjs";
import {
  prepareProtocolRequest,
  ProtocolStream,
} from "../desktop/api-protocols.mjs";

test("legacy CN auth markers still use the current WorkBuddy product origin and domain", async (t) => {
  const f = await fixture(t);
  const store = f.stores.get("workbuddy"),
    original = store.apiDocument.bind(store);
  store.apiDocument = (id) => {
    const doc = original(id);
    doc.root.auth.domain = "www.codebuddy.cn";
    return doc;
  };
  assert.equal((await f.send()).status, 200);
  assert.equal(f.calls[0].url, "https://www.workbuddy.cn/v2/chat/completions");
  assert.equal(f.calls[0].options.headers["X-Domain"], "www.workbuddy.cn");
});
test("upstream refusals retain a safe business code without leaking private response bodies", async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      { code: 11199, message: "private-token-a private-client-prompt" },
      { status: 400 },
    ),
  );
  const r = await f.send();
  const d = await r.json();
  assert.equal(r.status, 400);
  assert.match(d.error.message, /11199/);
  assert.ok(!JSON.stringify(d).includes("private-token"));
  assert.ok(!JSON.stringify(d).includes("private-client-prompt"));
});

for (const [protocol, route, body] of [
  [
    "chat",
    "/chat/completions",
    { messages: [{ role: "user", content: "hi" }] },
  ],
  ["responses", "/responses", { input: "hi", store: false }],
  [
    "messages",
    "/messages",
    { messages: [{ role: "user", content: "hi" }], max_tokens: 64 },
  ],
]) {
  test(`GLM-5.1 ${protocol} works without a client-specific reasoning default`, async (t) => {
    const f = await fixture(t, async (_url, options) => {
      const payload = JSON.parse(options.body);
      return payload.reasoning_effort === "medium"
        ? stream()
        : Response.json(
            {
              code: 11150,
              message: "the reasoning effort value is not supported",
            },
            { status: 400 },
          );
    });
    const r = await post(f, "/v1" + route, { model: "glm-5.1", ...body });
    assert.equal(r.status, 200);
    assert.equal(
      JSON.parse(f.calls[0].options.body).reasoning_effort,
      "medium",
    );
  });
}

test("required GLM-5.1 defaults preserve explicit effort and do not enable reasoning on other models", () => {
  const base = { messages: [{ role: "user", content: "hi" }] };
  assert.equal(
    prepareProtocolRequest(
      { ...base, model: "glm-5.1", reasoning_effort: "high" },
      "chat",
      64,
    ).payload.reasoning_effort,
    "high",
  );
  for (const model of ["auto", "glm-5.3", "deepseek-v4.1-flash"])
    assert.equal(
      prepareProtocolRequest({ ...base, model }, "chat", 64).payload
        .reasoning_effort,
      undefined,
    );
});

test("GLM-5.1 refuses explicit thinking-off requests before any paid call", () => {
  const base = {
    model: "glm-5.1",
    messages: [{ role: "user", content: "hi" }],
  };
  for (const options of [
    { reasoning_effort: "none" },
    { thinking: { type: "disabled" } },
  ])
    assert.throws(
      () => prepareProtocolRequest({ ...base, ...options }, "chat", 64),
      /GLM-5\.1.*思考/,
    );
});

test("Responses parallel function history groups calls before their results", () => {
  const p = prepareProtocolRequest(
    {
      model: "fast-model",
      input: [
        { role: "user", content: "lookup" },
        {
          type: "function_call",
          call_id: "a",
          name: "lookup",
          arguments: "{}",
        },
        {
          type: "function_call",
          call_id: "b",
          name: "lookup",
          arguments: "{}",
        },
        { type: "function_call_output", call_id: "a", output: "one" },
        { type: "function_call_output", call_id: "b", output: "two" },
      ],
    },
    "responses",
    64,
  );
  assert.equal(p.payload.messages[1].tool_calls.length, 2);
  assert.deepEqual(
    p.payload.messages.slice(2).map((m) => m.role),
    ["tool", "tool"],
  );
});

test("protocols preserve image and schema inputs and reject stateful or unsafe requests before billing", () => {
  const p = prepareProtocolRequest(
    {
      model: "fast-model",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "aGVsbG8=",
              },
            },
          ],
        },
      ],
      max_tokens: 64,
      thinking: { type: "adaptive" },
      tool_choice: { type: "any", disable_parallel_tool_use: true },
      output_config: {
        format: { type: "json_schema", schema: { type: "object" } },
      },
    },
    "messages",
    64,
  );
  assert.equal(
    p.payload.messages[0].content[0].image_url.url,
    "data:image/png;base64,aGVsbG8=",
  );
  assert.equal(p.payload.parallel_tool_calls, false);
  assert.equal(p.payload.thinking.type, "enabled");
  const base = { model: "fast-model", input: "hello" };
  for (const patch of [
    { previous_response_id: "resp_old" },
    { background: true },
    { input: [null] },
    { instructions: 4 },
    {
      input: [
        { role: "user", content: [{ type: "input_file", file_id: "file_1" }] },
      ],
    },
  ])
    assert.throws(
      () => prepareProtocolRequest({ ...base, ...patch }, "responses", 64),
      (e) => e.status === 400,
    );
});

test("Messages and Responses terminate truncated streams explicitly and never fabricate usage", () => {
  for (const protocol of ["messages", "responses"]) {
    const p = new ProtocolStream(protocol, "fast-model");
    p.push({
      choices: [{ delta: { content: "partial" }, finish_reason: "length" }],
    });
    const end = p.finish().join("");
    if (protocol === "messages") {
      assert.match(end, /max_tokens/);
      assert.equal(p.result().usage_known, false);
    } else {
      assert.match(end, /response.incomplete/);
      assert.equal(p.result().usage, null);
    }
    assert.match(
      p.error({
        code: "upstream_transport_error",
        message: "connection ended",
      }),
      protocol === "messages" ? /event: error/ : /response.failed/,
    );
  }
});

const post = (f, route, body, headers = f.headers) =>
  fetch(f.status.baseUrl.replace(/\/v1$/, "") + route, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
const textRequest = {
  model: "fast-model",
  messages: [{ role: "user", content: "hello" }],
};
for (const [protocol, route, body, tokenField] of [
  ["chat", "/chat/completions", textRequest, "max_tokens"],
  [
    "responses",
    "/responses",
    { model: "fast-model", input: "hi", store: false },
    "max_output_tokens",
  ],
  ["messages", "/messages", textRequest, "max_tokens"],
]) {
  test(`${protocol} forwards large caller output budgets without a local cap`, async (t) => {
    const f = await fixture(t);
    const r = await post(f, "/v1" + route, { ...body, [tokenField]: 131072 });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(f.calls[0].options.body).max_tokens, 131072);
  });
  test(`${protocol} leaves an omitted output budget to the upstream default`, async (t) => {
    const f = await fixture(t);
    const r = await post(f, "/v1" + route, body);
    assert.equal(r.status, 200);
    assert.equal(
      Object.hasOwn(JSON.parse(f.calls[0].options.body), "max_tokens"),
      false,
    );
  });
}
test("Chat preserves a large max_completion_tokens alias without a local cap", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send({ max_completion_tokens: 131072 })).status, 200);
  assert.equal(JSON.parse(f.calls[0].options.body).max_tokens, 131072);
});
test("OpenCode's actual Chat shape accepts camel-case cache hint and 48 registered tools", async (t) => {
  const f = await fixture(t);
  const r = await f.send({
    promptCacheKey: "local-opencode-session",
    max_tokens: 32000,
    stream: true,
    stream_options: { include_usage: true },
    tool_choice: "auto",
    tools: Array.from({ length: 48 }, (_, i) => ({
      type: "function",
      function: {
        name: "tool_" + i,
        description: "client tool",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    })),
  });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /\[DONE\]/);
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.tools.length, 48);
  assert.equal(sent.max_tokens, 32000);
  assert.equal(sent.promptCacheKey, undefined);
});
const toolStream = () =>
  new Response(
    [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_lookup",
                  type: "function",
                  function: { name: "lookup", arguments: '{"x":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "1}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    ]
      .map((v) => "data: " + JSON.stringify(v) + "\n\n")
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );

test("Chat accepts SDK metadata and preserves caller output budgets without forwarding local-only fields", async (t) => {
  const f = await fixture(t);
  const r = await post(f, "/chat/completions/", {
    ...textRequest,
    max_tokens: 32000,
    metadata: { client: "agent" },
    store: false,
    service_tier: "auto",
    logprobs: false,
  });
  assert.equal(r.status, 200);
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.max_tokens, 32000);
  assert.equal(sent.metadata, undefined);
  assert.equal(sent.store, undefined);
});
test("zero balances are skipped, but stale zeros and unknown balances can be rechecked by upstream", async (t) => {
  const f = await fixture(t);
  f.stores.get("workbuddy").records[0].profile.quota = {
    remaining: 0,
    fetchedAt: Date.now(),
  };
  assert.equal((await f.send()).status, 200);
  assert.equal(f.calls[0].options.headers["X-User-Id"], "b");
  f.stores.get("workbuddy").records[1].profile.quota = {
    remaining: 0,
    fetchedAt: Date.now(),
  };
  assert.equal((await f.send({ conversation_id: "empty" })).status, 503);
  assert.equal(f.calls.length, 1);
  f.stores.get("workbuddy").records[0].profile.quota.fetchedAt -= 3600000;
  assert.equal((await f.send({ conversation_id: "stale" })).status, 200);
});
for (const business of [false, true])
  test(
    "definite exhausted credits fail over once in the same region" +
      (business ? " (business-code response)" : " (HTTP 402)"),
    async (t) => {
      const f = await fixture(t, async (_url, options) =>
        options.headers["X-User-Id"] === "a"
          ? Response.json({ code: 14001 }, { status: business ? 200 : 402 })
          : stream("available-account"),
      );
      const r = await f.send({ conversation_id: "sticky-empty" });
      assert.equal(r.status, 200);
      assert.equal(
        (await r.json()).choices[0].message.content,
        "available-account",
      );
      assert.deepEqual(
        f.calls.map((c) => c.options.headers["X-User-Id"]),
        ["a", "b"],
      );
      assert.equal(
        (await f.send({ conversation_id: "sticky-empty" })).status,
        200,
      );
      assert.equal(f.calls[2].options.headers["X-User-Id"], "b");
      assert.equal(f.gateway.snapshot().recent[0].accountId, "b");
    },
  );
test("partial generation followed by exhaustion never replays a potentially billed request", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"code":14001}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const r = await f.send();
  assert.equal(r.status, 402);
  assert.equal(f.calls.length, 1);
});
test("current account catalog excludes historical and media models and explicit refresh bypasses cache", async (t) => {
  let version = 1;
  const f = await fixture(t, async (url) =>
    Response.json({
      code: 0,
      data: url.endsWith("/v2/enterprises/personal/models")
        ? {
            agents: [
              { name: "cli", models: ["new-" + version, "video-model"] },
            ],
            models: [
              { id: "new-" + version, maxOutputTokens: 131072 },
              { id: "old-model" },
              { id: "video-model", tags: ["text-to-video"] },
            ],
          }
        : { models: [{ id: "old-model" }] },
    }),
  );
  let r = await f.gateway.models();
  assert.deepEqual(
    r.data.map((m) => m.id),
    ["new-1", "global:new-1"],
  );
  assert.equal(r.data[0].max_output_tokens, 131072);
  assert.equal(
    f.calls[0].url,
    "https://www.workbuddy.cn/v2/enterprises/personal/models",
  );
  version++;
  assert.equal((await f.gateway.models()).data[0].id, "new-1");
  assert.equal((await f.gateway.models(true)).data[0].id, "new-2");
});
test("Responses accepts full-history agent input, instructions and function results", async (t) => {
  const f = await fixture(t);
  const r = await post(f, "/v1/responses", {
    model: "fast-model",
    instructions: "help",
    store: false,
    max_output_tokens: 64,
    reasoning: { effort: "low" },
    input: [
      { role: "user", content: [{ type: "input_text", text: "lookup" }] },
      {
        type: "function_call",
        call_id: "call_prior",
        name: "lookup",
        arguments: '{"x":1}',
      },
      { type: "function_call_output", call_id: "call_prior", output: "found" },
    ],
    tools: [
      { type: "function", name: "lookup", parameters: { type: "object" } },
    ],
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.object, "response");
  assert.equal(j.status, "completed");
  assert.equal(j.output[0].content[0].text, "private-reply");
  assert.equal(j.usage.input_tokens, 7);
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.messages[0].role, "system");
  assert.equal(sent.messages.at(-1).tool_call_id, "call_prior");
  assert.equal(sent.tools[0].function.name, "lookup");
  await f.gateway.stop();
  assert.ok(
    !(
      await fs.readFile(path.join(f.directory, "api-usage.json"), "utf8")
    ).includes("private-reply"),
  );
});
test("Responses streams typed text events and a final complete response", async (t) => {
  const f = await fixture(t);
  const r = await post(f, "/responses", {
    model: "fast-model",
    input: "hi",
    stream: true,
  });
  assert.equal(r.status, 200);
  const s = await r.text();
  for (const e of [
    "response.created",
    "response.output_item.added",
    "response.output_text.delta",
    "response.output_text.done",
    "response.output_item.done",
    "response.completed",
  ])
    assert.ok(s.includes("event: " + e + "\n"), e);
  assert.ok(!s.includes("[DONE]"));
});
test("Responses streams tool arguments with stable call IDs and correct output indices", async (t) => {
  const f = await fixture(t, async () => toolStream());
  const r = await post(f, "/v1/responses", {
    model: "fast-model",
    input: "lookup",
    stream: true,
  });
  assert.equal(r.status, 200);
  const s = await r.text();
  assert.match(s, /response.function_call_arguments.delta/);
  const events = s
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
  const done = events.find((e) => e.type === "response.completed").response;
  assert.equal(done.output[0].call_id, "call_lookup");
  assert.equal(done.output[0].arguments, '{"x":1}');
});
test("Messages authenticates x-api-key and maps system/tools/results into the shared gateway", async (t) => {
  const f = await fixture(t);
  const r = await post(
    f,
    "/v1/messages",
    {
      model: "fast-model",
      max_tokens: 64,
      system: [
        { type: "text", text: "help", cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: "lookup" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "lookup",
              input: { x: 1 },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: "found" }],
            },
          ],
        },
      ],
      tools: [{ name: "lookup", input_schema: { type: "object" } }],
    },
    {
      "Content-Type": "application/json",
      "x-api-key": f.gateway.getKey(),
      "anthropic-version": "2023-06-01",
    },
  );
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.type, "message");
  assert.equal(j.content[0].text, "private-reply");
  assert.equal(j.stop_reason, "end_turn");
  assert.equal(j.usage.output_tokens, 3);
  const sent = JSON.parse(f.calls[0].options.body);
  assert.equal(sent.messages.at(-1).tool_call_id, "toolu_1");
});
test("Messages streams tool-use block lifecycle and usage accepted by Anthropic clients", async (t) => {
  const f = await fixture(t, async () => toolStream());
  const r = await post(f, "/messages", {
    model: "fast-model",
    messages: [{ role: "user", content: "lookup" }],
    max_tokens: 64,
    stream: true,
  });
  assert.equal(r.status, 200);
  const s = await r.text();
  for (const e of [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ])
    assert.ok(s.includes("event: " + e + "\n"), e);
  assert.match(s, /input_json_delta/);
  assert.match(s, /tool_use/);
  assert.ok(!s.includes("[DONE]"));
});
test("all protocols reject conflicting keys, unsafe images and unsupported hosted tools without upstream requests", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await post(
        f,
        "/messages",
        { ...textRequest, max_tokens: 64 },
        { ...f.headers, "x-api-key": "wrong" },
      )
    ).status,
    401,
  );
  for (const input of [
    [
      {
        role: "user",
        content: [{ type: "input_image", image_url: "file:///etc/passwd" }],
      },
    ],
  ])
    assert.equal(
      (await post(f, "/responses", { model: "fast-model", input })).status,
      400,
    );
  assert.equal(
    (
      await post(f, "/responses", {
        model: "fast-model",
        input: "hi",
        tools: [{ type: "web_search" }],
      })
    ).status,
    400,
  );
  assert.equal(f.calls.length, 0);
});
