import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const module = await import("../../desktop/api-gateway.mjs").catch((error) => {
  if (
    error.code === "ERR_MODULE_NOT_FOUND" &&
    error.message.includes("api-gateway.mjs")
  )
    return {};
  throw error;
});
const { ApiGateway, apiDefaults, validateApiConfig } = module;
const document = (id, global = false) => ({
  id,
  token: "private-token-" + id,
  tokenExpiresAt: null,
  root: {
    auth: { domain: global ? "www.workbuddy.ai" : "www.workbuddy.cn" },
    account: {},
  },
});
export function stream(content = "private-reply", extra = {}) {
  return new Response(
    [
      {
        id: "real-request-1",
        debug: "upstream-private-debug",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content },
            finish_reason: null,
          },
        ],
        ...extra,
      },
      {
        id: "real-request-1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    ]
      .map((value) => "data: " + JSON.stringify(value) + "\r\n\r\n")
      .join("") + "data: [DONE]\r\n\r\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
export async function fixture(t, request) {
  assert.equal(typeof ApiGateway, "function", "本地 API 网关尚未实现");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wbs-api-"));
  const key = randomBytes(32);
  const vault = {
    available: () => true,
    encrypt(raw) {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([
        iv,
        cipher.update(raw),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
    },
    decrypt(bytes) {
      const d = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      d.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([
        d.update(bytes.subarray(12, -16)),
        d.final(),
      ]).toString();
    },
  };
  const calls = [];
  const stores = new Map(
    ["workbuddy", "workbuddy-global"].map((provider) => [
      provider,
      {
        records: (provider === "workbuddy" ? ["a", "b"] : ["g"]).map((id) => ({
          profile: { id, nickname: id, quota: null, protectedToken: false },
          apiEncrypted: "fixture-encrypted",
        })),
        apiDocument(id) {
          assert.ok(this.records.some((r) => r.profile.id === id));
          return document(id, provider === "workbuddy-global");
        },
        async exclusive(action) {
          return action();
        },
        async authorized(id, action) {
          try {
            return await action(this.apiDocument(id));
          } catch (error) {
            if (error.kind !== "auth") throw error;
            return action({ ...this.apiDocument(id), token: "renewed-token" });
          }
        },
      },
    ]),
  );
  const gateway = new ApiGateway({
    directory,
    vault,
    stores,
    listenPort: 0,
    request: async (url, options) => {
      calls.push({ url, options });
      if (request) return request(url, options);
      if (url.endsWith("/v3/config"))
        return Response.json({
          code: 0,
          data: {
            models: [
              {
                id: "fast-model",
                name: "快速模式",
                maxInputTokens: 128000,
                maxOutputTokens: 8192,
                supportsToolCall: true,
              },
              { id: "disabled", disabled: true },
            ],
          },
        });
      return stream();
    },
  });
  t.after(async () => {
    await gateway.stop();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await gateway.init();
  await gateway.saveConfig({
    ...apiDefaults,
    accounts: [
      { provider: "workbuddy", id: "a" },
      { provider: "workbuddy", id: "b" },
      { provider: "workbuddy-global", id: "g" },
    ],
  });
  const status = await gateway.start();
  const headers = {
    Authorization: "Bearer " + gateway.getKey(),
    "Content-Type": "application/json",
  };
  const send = (body = {}, other = {}) =>
    fetch(gateway.snapshot().baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "fast-model",
        messages: [{ role: "user", content: "private-client-prompt" }],
        ...body,
      }),
      ...other,
    });
  return { gateway, directory, vault, stores, calls, headers, status, send };
}
