import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { ApiGateway, apiDefaults, lanAddresses } from "../desktop/api-gateway.mjs";
import { fixture } from "./helpers/api-fixture.mjs";

const key = "qwenwork-test-key";
const base = (gateway) =>
  gateway.snapshot().baseUrl.replace(/\/v1$/, "/qwenwork/v1");

test("QwenWork alone serves models, JSON and SSE over real loopback HTTP and reloads its encrypted configuration", async (t) => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : null;
    received.push({ url: req.url, headers: req.headers, body });
    if (body?.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"千问"}}]}\n\n');
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          body
            ? { choices: [{ message: { role: "assistant", content: "千问" } }] }
            : { object: "list", data: [{ id: "qwenwork-standard" }] },
        ),
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const port = server.address().port;
  const f = await fixture(t, fetch);
  await f.gateway.stop();
  await f.gateway.saveConfig({ ...apiDefaults, accounts: [] });
  await f.gateway.saveQwenWork({ mode: "compatible", port, key });
  await f.gateway.start();
  assert.deepEqual(await f.gateway.qwenworkCatalog(), ["qwenwork-standard"]);
  const chat = {
    model: "qwenwork-standard",
    messages: [{ role: "user", content: "示例" }],
  };
  const post = (body) =>
    fetch(base(f.gateway) + "/chat/completions", {
      method: "POST",
      headers: { ...f.headers, Cookie: "caller-fixture" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await (await post(chat)).json()).choices[0].message.content,
    "千问",
  );
  const streaming = await post({ ...chat, stream: true });
  assert.match(streaming.headers.get("content-type"), /text\/event-stream/);
  assert.match(await streaming.text(), /千问.*\[DONE\]/s);
  assert.deepEqual(
    received.map((item) => item.url),
    ["/v1/models", "/v1/chat/completions", "/v1/chat/completions"],
  );
  assert.deepEqual(received[1].body, chat);
  assert.ok(
    received.every(
      ({ headers }) =>
        headers.authorization === "Bearer " + key && !headers.cookie,
    ),
  );
  assert.ok(!JSON.stringify(f.gateway.snapshot()).includes(key));
  assert.ok(
    !(
      await fs.readFile(path.join(f.directory, "qwenwork-api.json"), "utf8")
    ).includes(key),
  );
  await f.gateway.stop();
  const restored = new ApiGateway({
    directory: f.directory,
    vault: f.vault,
    stores: new Map(),
    listenPort: 0,
  });
  t.after(() => restored.stop());
  await restored.init();
  await restored.start();
  assert.deepEqual(await restored.qwenworkCatalog(), ["qwenwork-standard"]);
  await restored.saveQwenWork(null);
  const disconnected = await fetch(base(restored) + "/models", {
    headers: f.headers,
  });
  assert.equal(disconnected.status, 503);
});

test("QwenWork authenticates before forwarding, rejects other destinations and preserves upstream refusals without retry", async (t) => {
  const f = await fixture(
    t,
    async () =>
      new Response(key, { status: 429, headers: { "retry-after": "11" } }),
  );
  await f.gateway.saveQwenWork({ mode: "compatible", port: 4021, key });
  const url = base(f.gateway);
  assert.equal((await fetch(url + "/models")).status, 401);
  assert.equal(
    (
      await fetch(url + "/models", {
        headers: { ...f.headers, Origin: "https://example.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(url + "/admin", { headers: f.headers })).status,
    404,
  );
  assert.equal(
    (
      await fetch(url + "/models?url=https://example.invalid", {
        headers: f.headers,
      })
    ).status,
    400,
  );
  assert.equal(f.calls.length, 0);
  const response = await fetch(url + "/models", { headers: f.headers });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "11");
  assert.ok(!(await response.text()).includes(key));
  assert.equal(f.calls.length, 1);
  await assert.rejects(
    f.gateway.saveQwenWork({
      mode: "compatible",
      port: f.gateway.server.address().port,
      key,
    }),
    /端口/,
  );
  await f.gateway.stop();
  await assert.rejects(
    f.gateway.saveConfig({ ...apiDefaults, port: 4021 }),
    /端口/,
  );
});

test("QwenWork remains local when the shared WorkBuddy listener allows LAN hosts", async (t) => {
  const address = lanAddresses().find((host) => /^\d+\.\d+\.\d+\.\d+$/.test(host));
  if (!address) return t.skip("no IPv4 LAN interface");
  const f = await fixture(t);
  await f.gateway.stop();
  await f.gateway.saveConfig({ ...f.gateway.config, lan: true });
  await f.gateway.saveQwenWork({ mode: "compatible", port: 4021, key });
  await f.gateway.start();
  const url = new URL(base(f.gateway) + "/models");
  const status = await new Promise((resolve, reject) => {
    const request = http.get(url, {
      headers: { ...f.headers, Host: address + ":" + url.port },
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
  });
  assert.equal(status, 403);
  assert.equal(f.calls.length, 0);
});

test("official JSON errors keep the provider error code and request ID", async (t) => {
  const payload = { code: "SCOPE_DENIED", message: "permission denied" };
  const trace = "ab".repeat(16);
  const f = await fixture(t, async () => Response.json(payload, {
    status: 403,
    headers: { "x-request-id": trace, "Set-Cookie": "fixture=upstream" },
  }));
  await f.gateway.saveQwenWork({ mode: "official", key });
  const response = await fetch(base(f.gateway) + "/session/session-modes", { headers: f.headers });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), payload);
  assert.equal(response.headers.get("x-request-id"), trace);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(f.calls.length, 1);
});

test("the official connector forwards cloud session creation and event cursors only to the documented origin", async (t) => {
  const f = await fixture(t, async (url, options) => {
    assert.equal(options.redirect, "manual");
    if (url.endsWith("/session-modes"))
      return Response.json({ items: [{ mode: "standard" }] });
    if (url.includes("/events/stream"))
      return new Response("data: ok\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    return Response.json({ session_id: "office-session" }, { status: 202 });
  });
  await f.gateway.saveQwenWork({ mode: "official", key });
  assert.deepEqual(await f.gateway.qwenworkCatalog(), ["standard"]);
  const url = base(f.gateway);
  const body = JSON.stringify({ app_id: "app-test", text: "测试" });
  const created = await fetch(url + "/session/sessions", {
    method: "POST",
    headers: f.headers,
    body,
  });
  assert.equal(created.status, 202);
  assert.deepEqual(await created.json(), { session_id: "office-session" });
  assert.equal(f.calls[1].options.body, body);
  const events = await fetch(
    url + "/session/sessions/office-session/events/stream?cursor=4",
    {
      headers: { ...f.headers, "Last-Event-ID": "4" },
    },
  );
  assert.equal(await events.text(), "data: ok\n\n");
  assert.equal(f.calls[2].options.headers["Last-Event-ID"], "4");
  assert.ok(
    f.calls.every((call) =>
      call.url.startsWith("https://openapi.qwenwork.cn/v1/session/"),
    ),
  );
  assert.equal(
    (
      await fetch(
        url + "/session/sessions/office-session?session_type=remote",
        { headers: f.headers },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/chat/completions", {
        method: "POST",
        headers: f.headers,
        body,
      })
    ).status,
    404,
  );
  assert.equal(f.calls.length, 3);
});

test(
  "stopping QwenWork aborts an open upstream event stream",
  { timeout: 10000 },
  async (t) => {
    let signal;
    const f = await fixture(t, async (_url, options) => {
      signal = options.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    await f.gateway.saveQwenWork({ mode: "compatible", port: 4021, key });
    const result = await fetch(base(f.gateway) + "/chat/completions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ stream: true }),
    });
    const reader = result.body.getReader();
    await reader.read();
    assert.equal(f.gateway.active.size, 1);
    await f.gateway.stop();
    assert.equal(signal.aborted, true);
    assert.equal(f.gateway.active.size, 0);
    await assert.rejects(reader.read());
  },
);
