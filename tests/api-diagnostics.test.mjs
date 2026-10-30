import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiGateway } from "../desktop/api-gateway.mjs";
import { fixture, stream } from "./helpers/api-fixture.mjs";

for (const [official, local, message] of [
  [11128, "upstream_access_denied", /渠道校验/],
  [11136, "model_access_denied", /模型.*权限/],
  [11140, "upstream_account_restricted", /账号.*限制/],
  [11115, "context_length_exceeded", /上下文/],
  [11148, "invalid_tool_history", /工具.*记录/],
  [11149, "invalid_tool_history", /工具.*记录/],
]) {
  test(`official ${official} retains its meaning when HTTP 403 is returned`, async (t) => {
    const f = await fixture(t, async () =>
      Response.json(
        { code: official, message: "private-token-a private-client-prompt" },
        { status: 403 },
      ),
    );
    const response = await f.send();
    const value = await response.json();
    assert.equal(value.error.code, local);
    assert.match(value.error.message, message);
    assert.match(value.error.message, new RegExp(String(official)));
    assert.equal(
      f.calls.length,
      1,
      "a refused request stays on the same account",
    );
    const entry = f.gateway.snapshot().recent[0];
    assert.equal(entry.upstreamStatus, 403);
    assert.equal(entry.upstreamCode, String(official));
    assert.equal(entry.upstreamResponseType, "json");
    assert.ok(!JSON.stringify({ value, entry }).includes("private-token"));
    assert.ok(
      !JSON.stringify({ value, entry }).includes("private-client-prompt"),
    );
  });
}

test("an explicit expired-authorization code on HTTP 403 renews the same account once", async (t) => {
  const f = await fixture(t, async (_url, options) =>
    options.headers.Authorization === "Bearer renewed-token"
      ? stream("ok")
      : Response.json({ code: 12153 }, { status: 403 }),
  );
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 2);
  assert.equal(
    f.calls[0].options.headers["X-User-Id"],
    f.calls[1].options.headers["X-User-Id"],
  );
});

test("a channel-validation HTTP 400 is not upgraded into an authentication HTTP 403", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({ code: 11128 }, { status: 400 }),
  );
  const response = await f.send();
  assert.equal(response.status, 400);
  const value = await response.json();
  assert.equal(value.error.type, "invalid_request_error");
  assert.match(value.error.message, /11128/);
  assert.equal(f.gateway.snapshot().recent[0].upstreamStatus, 400);
  assert.equal(
    f.calls.length,
    1,
    "the original 400 status survives without replay",
  );
});

test("an HTML HTTP 403 is not reported as an account or official channel decision", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(
        "<!doctype html><html>private-token-a private-client-prompt</html>",
        {
          status: 403,
          headers: { "content-type": "text/html" },
        },
      ),
  );
  const response = await f.send();
  const value = await response.json();
  assert.equal(response.status, 403);
  assert.equal(value.error.code, "upstream_http_forbidden");
  assert.match(value.error.message, /HTML/);
  assert.doesNotMatch(value.error.message, /账号权限|渠道校验/);
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.upstreamCode, null);
  assert.equal(entry.upstreamResponseType, "html");
  assert.ok(!JSON.stringify({ value, entry }).includes("private-token"));
  assert.equal(f.calls.length, 1);
});

test("numeric unknown business codes remain visible but arbitrary upstream text never becomes metadata", async (t) => {
  const f = await fixture(t, async () =>
    Response.json(
      { error: { code: 11199, message: "private-token-a" } },
      { status: 403 },
    ),
  );
  const first = await f.send();
  assert.match((await first.json()).error.message, /11199/);
  assert.equal(f.gateway.snapshot().recent[0].upstreamCode, "11199");
  f.gateway.request = async () =>
    Response.json({ code: "private-token-a" }, { status: 403 });
  const second = await f.send();
  assert.ok(!(await second.text()).includes("private-token"));
  assert.equal(f.gateway.snapshot().recent[0].upstreamCode, null);
});

test("failed request diagnostics persist only counts, output budget and safe upstream fields", async (t) => {
  const f = await fixture(t, async () =>
    Response.json({ code: 11128 }, { status: 403 }),
  );
  await f.send({
    max_tokens: 128000,
    reasoning_effort: "high",
    tools: [
      {
        type: "function",
        function: {
          name: "lookup",
          description: "private-tool-description",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
  });
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.requestInfo.messageCount, 1);
  assert.equal(entry.requestInfo.toolCount, 1);
  assert.equal(entry.requestInfo.maxOutputTokens, 128000);
  assert.equal(entry.requestInfo.reasoningEffort, "high");
  assert.equal(
    entry.requestInfo.bodyBytes,
    Buffer.byteLength(f.calls[0].options.body),
  );
  await f.gateway.stop();
  const file = path.join(f.directory, "api-usage.json");
  const saved = await fs.readFile(file, "utf8");
  for (const secret of [
    "private-token",
    "private-client-prompt",
    "private-tool-description",
  ])
    assert.ok(!saved.includes(secret));
  const reloaded = new ApiGateway({
    directory: f.directory,
    stores: f.stores,
    vault: f.vault,
  });
  await reloaded.init();
  t.after(() => reloaded.stop());
  assert.deepEqual(reloaded.snapshot().recent[0], entry);
});

test("streamed business refusals keep the actual upstream HTTP status", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response('data: {"code":11128,"message":"private-token-a"}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  const response = await f.send();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /11128/);
  const entry = f.gateway.snapshot().recent[0];
  assert.equal(entry.upstreamStatus, 200);
  assert.equal(entry.upstreamCode, "11128");
  assert.equal(entry.upstreamResponseType, "event_stream");
  assert.equal(f.calls.length, 1);
});
