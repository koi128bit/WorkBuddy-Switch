import test from "node:test";
import assert from "node:assert/strict";
import { parseAuth } from "../desktop/auth.mjs";
let api;
try {
  api = await import("../desktop/dialogue.mjs");
} catch {}
const document = parseAuth(
  JSON.stringify({
    account: { uid: "fixture-user" },
    auth: { accessToken: "fixture-secret", domain: "www.workbuddy.cn" },
  }),
);
const task = (code, current = 0, target = 5) => ({
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
function stream(events) {
  const text = events
    .map(
      (event) =>
        `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 19));
        controller.enqueue(bytes.slice(19, 78));
        controller.enqueue(bytes.slice(78));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
const completed = () =>
  stream([
    {
      id: "server-real-1",
      model: "glm-5.2",
      choices: [{ delta: { content: "你好" } }],
    },
    {
      id: "server-real-1",
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 2 },
    },
    "[DONE]",
  ]);
test("dialogue plans support only known real chat actions and honor official progress and Beijing night hours", () => {
  assert.equal(typeof api?.dialogueSpec, "function");
  const day = Date.parse("2026-10-25T04:00:00Z"),
    night = Date.parse("2026-10-25T16:00:00Z");
  assert.deepEqual(api.dialogueSpec(task("chat_5", 2, 5), day), {
    model: "fast-model",
    modelName: "快速模式",
    remaining: 3,
  });
  assert.equal(
    api.dialogueSpec(task("Model_chat_GLM5.2", 0, 1), day).model,
    "glm-5.2",
  );
  assert.equal(api.dialogueSpec(task("black_cat", 0, 1), day), null);
  assert.ok(api.dialogueSpec(task("black_cat", 0, 1), night));
  for (const item of [
    task("expert_5"),
    task("Sequential_Tasks_3"),
    { ...task("chat_5"), locked: true },
    { ...task("chat_5"), claimed: true },
    { ...task("chat_5"), target: null },
    { ...task("chat_5"), status: "unknown" },
  ])
    assert.equal(api.dialogueSpec(item, night), null);
});
test("real dialogue sends a bounded official SSE request, reads the whole result and reports only its real identity", async () => {
  assert.equal(typeof api?.sendDialogue, "function");
  const calls = [];
  const result = await api.sendDialogue(
    document,
    { model: "glm-5.2", prompt: "你好，请介绍自己。" },
    async (url, options) => {
      calls.push({ url, options });
      return completed();
    },
  );
  assert.equal(calls[0].url, "https://copilot.tencent.com/v2/chat/completions");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.max_tokens, 64);
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].content, "你好，请介绍自己。");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(result.requestId, "server-real-1");
  assert.equal(result.outputTokens, 2);
  assert.equal(result.inputTokens, 9);
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
  await api.reportDialogue(document, result, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) };
  });
  const event = JSON.parse(calls[1].options.body)[0];
  assert.equal(calls[1].url, "https://www.workbuddy.cn/v2/report");
  assert.equal(event.requestId, "server-real-1");
  assert.equal(event.eventCode, "chat_request_send");
  assert.equal(event.requestModelId, "glm-5.2");
  assert.equal(event.inputLength, [..."你好，请介绍自己。"].length);
  assert.equal(typeof result.conversationId, "string");
  assert.equal(event.conversationId, result.conversationId);
});
test("paid requests reject unconfirmed streams, errors, foreign accounts and arbitrary model input without retrying", async () => {
  assert.equal(typeof api?.sendDialogue, "function");
  let count = 0;
  await assert.rejects(
    () =>
      api.sendDialogue(
        document,
        { model: "fast-model", prompt: "你好" },
        async () => {
          count++;
          return stream([
            { id: "partial", choices: [{ delta: { content: "不完整" } }] },
          ]);
        },
      ),
    /未确认|完整/,
  );
  assert.equal(count, 1);
  await assert.rejects(
    () =>
      api.sendDialogue(
        document,
        { model: "fast-model", prompt: "你好" },
        async () => stream([{ error: { message: "fixture-secret leaked" } }]),
      ),
    (error) => !error.message.includes("fixture-secret"),
  );
  for (const model of ["auto", "https://evil.test", ""])
    await assert.rejects(
      () =>
        api.sendDialogue(document, { model, prompt: "你好" }, () => {
          throw new Error("must not send");
        }),
      /模型/,
    );
  const global = parseAuth(
    JSON.stringify({
      account: { uid: "global" },
      auth: { accessToken: "foreign-secret", domain: "www.workbuddy.ai" },
    }),
  );
  await assert.rejects(
    () =>
      api.sendDialogue(global, { model: "fast-model", prompt: "你好" }, () => {
        throw new Error("must not send");
      }),
    /国内版/,
  );
  await assert.rejects(
    () =>
      api.reportDialogue(document, { requestId: "fake" }, () => {
        throw new Error("must not report");
      }),
    /真实/,
  );
});
