import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { fetchApiModels } from "../desktop/api-upstream.mjs";
import { prepareProtocolRequest } from "../desktop/api-protocols.mjs";
import { fixture, stream } from "./helpers/api-fixture.mjs";

const globalDocument = {
  id: "g",
  token: "fixture",
  root: { auth: { domain: "www.workbuddy.ai" }, account: {} },
};
const frames = (deltas) =>
  new Response(
    deltas
      .map(
        (delta, index) =>
          "data: " +
          JSON.stringify({
            choices: [
              {
                delta,
                finish_reason:
                  index === deltas.length - 1 ? "tool_calls" : null,
              },
            ],
          }) +
          "\n\n",
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );

test("a Codex plugin toolset can exceed 128 tools without dropping definitions", () => {
  const tools = Array.from({ length: 300 }, (_, i) => ({
    type: "function",
    name: "tool_" + i,
    parameters: { type: "object" },
  }));
  const prepared = prepareProtocolRequest(
    {
      model: "global:fast-model",
      input: "hi",
      tools: [{ type: "namespace", name: "functions", tools }],
    },
    "responses",
  );
  assert.equal(prepared.payload.tools.length, 300);
  assert.throws(
    () =>
      prepareProtocolRequest(
        { model: "fast-model", input: "hi", tools: [{ type: "web_search" }] },
        "responses",
      ),
    /托管工具/,
  );
});

test("global desktop catalog includes Flash even when the CLI alias list omits it", async () => {
  const models = await fetchApiModels(globalDocument, async () =>
    Response.json({
      code: 0,
      data: {
        models: [
          { id: "fast-model" },
          { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash" },
          { id: "disabled", disabled: true },
        ],
        agents: [{ name: "cli", models: ["fast-model"] }],
      },
    }),
  );
  assert.deepEqual(
    models.map((m) => m.id),
    ["fast-model", "deepseek-v4.1-flash"],
  );
});

test("global prefers the current desktop config over a stale personal catalog", async () => {
  const routes = [];
  const models = await fetchApiModels(globalDocument, async (url) => {
    routes.push(url);
    return Response.json({
      code: 0,
      data: {
        models: [
          {
            id: url.endsWith("/v3/config")
              ? "deepseek-v4.1-flash"
              : "old-alias",
          },
        ],
      },
    });
  });
  assert.equal(models[0].id, "deepseek-v4.1-flash");
  assert.deepEqual(routes, ["https://www.workbuddy.ai/v3/config"]);
});

test("global catalog accepts the official console array shape", async () => {
  const models = await fetchApiModels(globalDocument, async (url) =>
    url.includes("/v2/")
      ? new Response("not found", { status: 404 })
      : Response.json({
          code: 0,
          data: [{ id: "deepseek-v4.1-flash", tags: ["chat"] }],
        }),
  );
  assert.equal(models[0].id, "deepseek-v4.1-flash");
});

test("one unavailable region does not hide models from the other region", async (t) => {
  const f = await fixture(t, async (url) =>
    url.startsWith("https://www.workbuddy.cn/")
      ? Response.json({ code: 12153 }, { status: 401 })
      : Response.json({
          code: 0,
          data: { models: [{ id: "deepseek-v4.1-flash" }] },
        }),
  );
  const result = await f.gateway.models(true);
  assert.deepEqual(
    result.data.map((m) => m.id),
    ["global:deepseek-v4.1-flash"],
  );
  assert.equal(result.warnings[0].provider, "workbuddy");
});

test("region URLs accept unprefixed models and never route them across regions", async (t) => {
  const f = await fixture(t);
  for (const [region, prefix] of [
    ["global", "global:"],
    ["cn", ""],
  ]) {
    const r = await fetch(f.status.baseUrl + "/" + region + "/models", {
      headers: f.headers,
    });
    assert.equal(r.status, 200);
    const catalog = await r.json();
    assert.deepEqual(
      catalog.data.map((m) => m.id),
      ["fast-model"],
    );
    const response = await fetch(
      f.status.baseUrl + "/" + region + "/chat/completions",
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          model: "fast-model",
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, "fast-model");
    const call = f.calls.at(-1);
    assert.equal(
      new URL(call.url).hostname,
      region === "global" ? "www.workbuddy.ai" : "www.workbuddy.cn",
    );
  }
  const mismatch = await fetch(f.status.baseUrl + "/cn/chat/completions", {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify({
      model: "global:fast-model",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  assert.equal(mismatch.status, 400);
});

test("Codex namespaced function tools survive a complete Responses tool loop", async (t) => {
  let turn = 0;
  const f = await fixture(t, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[0].role, "system");
    assert.equal(
      body.messages[0].content,
      "Keep instructions in their original role.",
    );
    assert.equal(body.model, "fast-model");
    if (++turn === 2) {
      assert.equal(body.messages.at(-1).role, "tool");
      assert.equal(body.messages.at(-1).content, "42");
      assert.equal(
        body.messages.at(-2).tool_calls[0].function.name,
        body.tools[0].function.name,
      );
      return stream("42");
    }
    return frames([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_lookup",
            type: "function",
            function: {
              name: body.tools[0].function.name,
              arguments: '{"q":"test"}',
            },
          },
        ],
      },
    ]);
  });
  const sdk = new OpenAI({
    apiKey: f.gateway.getKey(),
    baseURL: f.status.baseUrl + "/global",
    maxRetries: 0,
  });
  const request = {
    model: "fast-model",
    instructions: "Keep instructions in their original role.",
    store: false,
    input: [{ role: "user", content: "lookup" }],
    tools: [
      {
        type: "namespace",
        name: "functions",
        tools: [
          {
            type: "function",
            name: "lookup",
            parameters: {
              type: "object",
              properties: { q: { type: "string" } },
            },
          },
        ],
      },
    ],
  };
  const first = await sdk.responses.stream(request).finalResponse();
  assert.equal(first.output[0].type, "function_call");
  assert.equal(first.output[0].namespace, "functions");
  assert.equal(first.output[0].name, "lookup");
  const second = await sdk.responses
    .stream({
      ...request,
      input: [
        ...request.input,
        ...first.output,
        { type: "function_call_output", call_id: "call_lookup", output: "42" },
      ],
    })
    .finalResponse();
  assert.equal(second.output_text, "42");
});

test("Codex custom tools return raw input and accept custom tool results", async (t) => {
  let turn = 0;
  const code = "print('hello')\n";
  const f = await fixture(t, async (_url, options) => {
    const body = JSON.parse(options.body);
    if (++turn === 2) {
      assert.equal(
        body.messages.at(-2).tool_calls[0].function.arguments,
        JSON.stringify({ input: code }),
      );
      assert.equal(body.messages.at(-1).content, "hello");
      return stream("done");
    }
    const args = JSON.stringify({ input: code });
    return frames([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_exec",
            type: "function",
            function: {
              name: body.tools[0].function.name,
              arguments: args.slice(0, 8),
            },
          },
        ],
      },
      { tool_calls: [{ index: 0, function: { arguments: args.slice(8) } }] },
    ]);
  });
  const sdk = new OpenAI({
    apiKey: f.gateway.getKey(),
    baseURL: f.status.baseUrl + "/global",
    maxRetries: 0,
  });
  const request = {
    model: "fast-model",
    input: "run",
    store: false,
    tools: [
      {
        type: "namespace",
        name: "functions",
        tools: [{ type: "custom", name: "exec", format: { type: "text" } }],
      },
    ],
  };
  const events = [];
  const response = sdk.responses.stream(request);
  for await (const e of response) events.push(e);
  const first = await response.finalResponse();
  assert.equal(first.output[0].type, "custom_tool_call");
  assert.equal(first.output[0].namespace, "functions");
  assert.equal(first.output[0].input, code);
  assert.equal(
    events.find((e) => e.type === "response.custom_tool_call_input.done").input,
    code,
  );
  const second = await sdk.responses.create({
    ...request,
    input: [
      { role: "user", content: "run" },
      ...first.output,
      {
        type: "custom_tool_call_output",
        call_id: "call_exec",
        output: "hello",
      },
    ],
  });
  assert.equal(second.output[0].content[0].text, "done");
});

test("Claude Code streams sequential tool blocks and accepts image tool results", async (t) => {
  let turn = 0;
  const f = await fixture(t, async (_url, options) => {
    const body = JSON.parse(options.body);
    if (++turn === 2) {
      assert.equal(
        body.messages.find((m) => m.role === "tool").tool_call_id,
        "call_read",
      );
      assert.ok(
        body.messages.some(
          (m) =>
            Array.isArray(m.content) &&
            m.content.some((p) => p.type === "image_url"),
        ),
      );
      return stream("done");
    }
    return frames([
      { content: "Reading." },
      {
        tool_calls: [
          {
            index: 0,
            id: "call_read",
            type: "function",
            function: { name: "Read", arguments: '{"path":"fixture"}' },
          },
        ],
      },
    ]);
  });
  const sdk = new Anthropic({
    apiKey: f.gateway.getKey(),
    baseURL: f.status.baseUrl.replace(/\/v1$/, "") + "/v1/global",
    maxRetries: 0,
  });
  const request = {
    model: "fast-model",
    max_tokens: 128,
    system: [
      { type: "text", text: "Use Read", cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: "Read fixture" }],
    tools: [
      {
        name: "Read",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
    ],
  };
  const sequence = [];
  const response = sdk.messages.stream(request);
  for await (const event of response) sequence.push(event.type);
  const first = await response.finalMessage();
  const starts = sequence.reduce(
    (r, type, index) => (type === "content_block_start" ? [...r, index] : r),
    [],
  );
  assert.ok(
    sequence.indexOf("content_block_stop") < starts[1],
    "a block closes before the next block starts",
  );
  const next = await sdk.messages.create({
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_read",
            content: [
              { type: "text", text: "image" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "AAAA",
                },
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(next.content[0].text, "done");
});

test("Claude Code count_tokens is authenticated, labeled as estimated, and sends no chat", async (t) => {
  const f = await fixture(t);
  const url = f.status.baseUrl + "/global/messages/count_tokens?beta=true";
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  const response = await fetch(url, {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify({
      model: "fast-model",
      messages: [{ role: "user", content: "你好" }],
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-token-count-estimated"), "true");
  assert.ok((await response.json()).input_tokens > 0);
  assert.equal(f.calls.length, 0);
});

test("third-party agent system prompts keep their wording but move off the channel anchor", async (t) => {
  const f = await fixture(t, async () =>
    stream("WB_OK"),
  );
  const codexSystem =
    "You are a coding agent running in the Codex CLI, a terminal-based coding assistant.";
  const claudeSystem =
    "x-anthropic-billing-header: cc_version=2.1.169.5c0; cc_entrypoint=sdk-cli; cch=0330b;\nYou are a Claude agent, built on Anthropic's Claude Agent SDK.";
  for (const system of [codexSystem, claudeSystem]) {
    const response = await f.send({
      messages: [
        { role: "system", content: system },
        { role: "user", content: "Reply with exactly WB_OK." },
      ],
    });
    assert.equal(response.status, 200);
    const forwarded = JSON.parse(f.calls.at(-1).options.body).messages;
    assert.equal(forwarded[0].role, "system", "系统提示词仍是 system 角色");
    assert.ok(
      forwarded[0].content.endsWith(system),
      "原始 system 文本逐字保留在末段",
    );
    assert.ok(
      !/^(x-anthropic-billing-header|You are Claude Code|You are a Claude agent|You are a coding agent running in the Codex CLI)/i.test(
        forwarded[0].content,
      ),
      "第三方 CLI 指纹不再位于首字符锚点",
    );
  }
});

test("an ordinary system prompt is forwarded verbatim without a lead-in", async (t) => {
  const f = await fixture(t, async () => stream("OK"));
  const messages = [
    { role: "system", content: "你是一个中文助手。" },
    { role: "user", content: "你好" },
  ];
  await f.send({ messages });
  assert.deepEqual(JSON.parse(f.calls[0].options.body).messages, messages);
});
