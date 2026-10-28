import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/api-fixture.mjs";
import {
  EMBEDDING_MODELS,
  EMBEDDING_INPUT_CHARS,
  prepareEmbeddingRequest,
  agentToolBody,
} from "../desktop/api-upstream.mjs";

const post = (f, route, body, headers = f.headers) =>
  fetch(f.status.baseUrl.replace(/\/v1$/, "") + route, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
const vectors = (count, dimensions = 4) =>
  Response.json({
    object: "list",
    model: "bge-m3",
    data: Array.from({ length: count }, (_, index) => ({
      object: "embedding",
      embedding: Array.from({ length: dimensions }, (_, i) => index + i / 10),
    })),
    usage: { prompt_tokens: count * 3, total_tokens: count * 3 },
  });

test("embeddings forward to the official vector route and return OpenAI-shaped vectors", async (t) => {
  const f = await fixture(t, async () => vectors(2));
  const response = await post(f, "/v1/embeddings", {
    model: "bge-m3",
    input: ["第一条", "第二条"],
  });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(f.calls[0].url, "https://www.workbuddy.cn/v2/embeddings");
  assert.equal(f.calls[0].options.headers.Accept, "application/json");
  assert.equal(f.calls[0].options.headers["X-Domain"], "www.workbuddy.cn");
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    model: "bge-m3",
    input: ["第一条", "第二条"],
  });
  assert.equal(value.object, "list");
  assert.equal(value.model, "bge-m3");
  assert.deepEqual(
    value.data.map((row) => row.object),
    ["embedding", "embedding"],
  );
  assert.deepEqual(
    value.data.map((row) => row.index),
    [0, 1],
  );
  assert.equal(value.data[0].embedding.length, 4);
  assert.deepEqual(value.usage, { prompt_tokens: 6, total_tokens: 6 });
});
test("embeddings record usage in the local statistics without inventing credits", async (t) => {
  const f = await fixture(t, async () => vectors(1));
  await (await post(f, "/v1/embeddings", { model: "bge-m3", input: "hi" })).text();
  const status = f.gateway.snapshot();
  assert.equal(status.totals.requests, 1);
  assert.equal(status.totals.succeeded, 1);
  assert.equal(status.totals.inputTokens, 3);
  assert.equal(status.totals.outputTokens, 0);
  assert.equal(status.recent[0].model, "bge-m3");
  const daily = f.gateway.dailyApiUsage();
  assert.equal(daily.length, 1);
  assert.equal(daily[0].model, "bge-m3");
  assert.equal(daily[0].input, 3);
  assert.equal(daily[0].output, 0);
});
test("embeddings reject unknown models locally instead of spending an upstream call", async (t) => {
  const f = await fixture(t, async () => vectors(1));
  for (const model of ["text-embedding-3-small", "glm-embedding", "auto"]) {
    const response = await post(f, "/v1/embeddings", { model, input: "hi" });
    assert.equal(response.status, 404, model);
    const value = await response.json();
    assert.equal(value.error.code, "model_not_available");
  }
  assert.equal(f.calls.length, 0, "unknown models never reach the official service");
  assert.match(
    EMBEDDING_MODELS.map((model) => model.id).join(","),
    /bge-m3/,
  );
});
test("embeddings refuse the global region prefix instead of sending CN credentials", async (t) => {
  const f = await fixture(t, async () => vectors(1));
  const response = await post(f, "/v1/embeddings", {
    model: "global:bge-m3",
    input: "hi",
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "unsupported_region");
  assert.equal(f.calls.length, 0);
});
test("oversized single inputs are refused before forwarding", async (t) => {
  const f = await fixture(t, async () => vectors(1));
  const response = await post(f, "/v1/embeddings", {
    model: "bge-m3",
    input: "字".repeat(EMBEDDING_INPUT_CHARS + 1),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /8188|切块/);
  assert.equal(f.calls.length, 0);
});
test("the embedding request normalizer keeps token arrays and rejects unsupported encodings", () => {
  const prepared = prepareEmbeddingRequest({
    model: "hunyuan-embedding",
    input: [[1, 2, 3], "文本"],
  });
  assert.deepEqual(prepared.payload.input, [[1, 2, 3], "文本"]);
  assert.throws(
    () =>
      prepareEmbeddingRequest({
        model: "bge-m3",
        input: "hi",
        encoding_format: "base64",
      }),
    /encoding_format/,
  );
  assert.throws(
    () => prepareEmbeddingRequest({ model: "bge-m3", input: [] }),
    /input/,
  );
  assert.throws(
    () => prepareEmbeddingRequest({ model: "bge-m3", input: [""] }),
    /空字符串/,
  );
  assert.throws(
    () => prepareEmbeddingRequest({ model: "bge-m3", input: [{ bad: 1 }] }),
    /token/,
  );
});
test("embedding failures keep the official error code without leaking the body", async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      {
        code: 11351,
        msg: "embedding model [private-token-a] not found",
      },
      { status: 500 },
    ),
  );
  const response = await post(f, "/v1/embeddings", { model: "bge-m3", input: "hi" });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /11351/);
  assert.equal(text.includes("private-token"), false);
});

test("agent tools forward to /agenttool with the same account credential", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({
      request_id: "r1",
      synthesis: { content: "合成结果" },
      statuses: [],
    }),
  );
  const response = await post(f, "/v1/tools/agentic_search", {
    query: "研究 A 股半导体设备行业",
  });
  assert.equal(response.status, 200);
  assert.equal(
    f.calls[0].url,
    "https://www.workbuddy.cn/agenttool/v1/agentic_search",
  );
  assert.equal(f.calls[0].options.headers.Accept, "text/event-stream");
  assert.deepEqual(JSON.parse(f.calls[0].options.body), {
    query: "研究 A 股半导体设备行业",
    search_mode: 2,
    stream: true,
    biz_via: "public",
  });
  const value = await response.json();
  assert.equal(value.synthesis.content, "合成结果");
});
test("agent tools stream upstream events back unchanged", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        'event: tool_call\ndata: {"tool":"websearch"}\n\nevent: done\ndata: {"synthesis":{"content":"ok"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await post(f, "/v1/tools/agentic_search", { query: "x" });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: tool_call/);
  assert.match(text, /event: done/);
});
test("knowledge search sends the login ticket and rejects unknown tools", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({ code: 0, data: { results: [] } }),
  );
  const response = await post(f, "/v1/tools/knowledge_search", {
    query: "测试",
    sources: [{ source_type: "workbuddy_library" }],
  });
  assert.equal(response.status, 200);
  assert.equal(
    f.calls[0].url,
    "https://www.workbuddy.cn/agenttool/v1/knowledge_search",
  );
  // Without this header the official service answers 401 / 10034; the gateway
  // must forward the login ticket it already holds.
  assert.equal(
    f.calls[0].options.headers["X-User-Ticket"],
    f.calls[0].options.headers.Authorization.slice("Bearer ".length),
  );
  const unknown = await post(f, "/v1/tools/nope", {});
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, "not_found");
  assert.equal(f.calls.length, 1, "an unknown tool never reaches upstream");
});
test("a missing search ticket is reported as a tool problem, not an expired login", async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      {
        code: 10034,
        msg: "platform credentials and search ticket are required",
      },
      { status: 401 },
    ),
  );
  const response = await post(f, "/v1/tools/knowledge_search", { query: "x" });
  assert.equal(response.status, 502);
  const value = await response.json();
  assert.equal(value.error.code, "tool_credentials_required");
  assert.equal(
    f.calls.length,
    1,
    "a tool credential problem must not trigger an authorization renewal",
  );
});
test("an unavailable knowledge source keeps its official code", async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      { code: 10040, msg: "knowledge search service unavailable" },
      { status: 502 },
    ),
  );
  const response = await post(f, "/v1/tools/knowledge_search", {
    query: "x",
    sources: [{ source_type: "ima" }],
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "tool_service_unavailable");
});
test("agent tool bodies are normalized without forwarding unknown fields", () => {
  assert.deepEqual(agentToolBody("tempkey", { ignored: true }), {});
  assert.deepEqual(
    agentToolBody("agentic_search", {
      query: "q",
      search_mode: 1,
      stream: false,
      biz_via: "internal",
      extra: "drop",
    }),
    { query: "q", search_mode: 1, stream: false, biz_via: "internal" },
  );
  assert.deepEqual(agentToolBody("knowledge_search", { query: "q" }), {
    query: "q",
  });
  assert.throws(() => agentToolBody("agentic_search", {}), /query/);
  assert.throws(() => agentToolBody("agentic_search", { query: "   " }), /query/);
});
test("agent tool failures keep the official status and never echo the prompt", async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      { code: 10040, msg: "knowledge search service unavailable" },
      { status: 502 },
    ),
  );
  const response = await post(f, "/v1/tools/knowledge_search", {
    query: "private-client-prompt",
  });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes("private-client-prompt"), false);
});
test("the documented route list mentions the new endpoints", async (t) => {
  const f = await fixture(t);
  const response = await post(f, "/v1/not-a-route", {});
  assert.equal(response.status, 404);
  const message = (await response.json()).error.message;
  assert.match(message, /\/v1\/embeddings/);
  assert.match(message, /\/v1\/tools\//);
});
