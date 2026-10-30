import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  ApiGateway,
  allowedHosts,
  apiDefaults,
  lanAddresses,
  validateApiConfig,
} from "../desktop/api-gateway.mjs";
import { fixture } from "./helpers/api-fixture.mjs";

const request = (url, headers) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
  });

const lanHost = () => {
  const address = lanAddresses().find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
  return address ?? "";
};

test("LAN access is an explicit boolean option that defaults to off", () => {
  assert.equal(apiDefaults.lan, false);
  assert.equal(validateApiConfig(apiDefaults).lan, false);
  assert.equal(validateApiConfig({ ...apiDefaults, lan: true }).lan, true);
  for (const value of ["1", 1, null, undefined, "true"])
    assert.throws(() => validateApiConfig({ ...apiDefaults, lan: value }));
});

test("the accepted Host header stays on loopback until LAN access is enabled", () => {
  const loopback = allowedHosts(8317, false);
  assert.ok(loopback.has("127.0.0.1:8317"));
  assert.ok(loopback.has("localhost:8317"));
  for (const name of lanAddresses())
    assert.equal(loopback.has(name + ":8317"), false);
  const wan = allowedHosts(8317, true);
  for (const name of lanAddresses()) assert.ok(wan.has(name + ":8317"));
  assert.equal(wan.has("evil.example:8317"), false);
});

test("loopback mode rejects a request that arrives on a LAN address", async (t) => {
  const f = await fixture(t);
  assert.equal(f.status.config.lan, false);
  assert.equal(f.status.lanUrl, "");
  assert.deepEqual(f.status.lanUrls, []);
  const address = lanHost();
  if (!address) return;
  const port = new URL(f.status.baseUrl).port;
  const response = await request(f.status.baseUrl + "/models", {
    ...f.headers,
    Host: address + ":" + port,
  });
  assert.equal(response.status, 403);
  assert.match(response.body, /local_clients_only/);
  assert.equal(f.calls.length, 0);
});

test("LAN mode reaches the LAN URL and keeps the key, origin and rebinding checks", async (t) => {
  const f = await fixture(t);
  await f.gateway.stop();
  await f.gateway.saveConfig({ ...f.gateway.config, lan: true });
  const status = await f.gateway.start();
  t.after(() => f.gateway.stop());
  assert.equal(status.config.lan, true);
  assert.match(status.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  const address = lanHost();
  if (address) {
    assert.equal(status.lanUrl, "http://" + address + ":" + new URL(status.baseUrl).port + "/v1");
    assert.ok(status.lanUrls.includes(status.lanUrl));
    const port = new URL(status.baseUrl).port;
    const lan = await request(status.baseUrl + "/models", {
      ...f.headers,
      Host: address + ":" + port,
    });
    assert.equal(lan.status, 200);
    assert.match(lan.body, /fast-model/);
    const unnamed = await request(status.baseUrl + "/models", {
      ...f.headers,
      Host: "evil.example:" + port,
    });
    assert.equal(unnamed.status, 403);
  }
  const keyless = await request(status.baseUrl + "/models", {
    Host: new URL(status.baseUrl).host,
  });
  assert.equal(keyless.status, 401);
  const origin = await request(status.baseUrl + "/models", {
    ...f.headers,
    Origin: "https://evil.example",
  });
  assert.equal(origin.status, 403);
  const crossSite = await request(status.baseUrl + "/models", {
    ...f.headers,
    "Sec-Fetch-Site": "cross-site",
  });
  assert.equal(crossSite.status, 403);
});

test("the LAN switch survives a reload and the server binds the saved scope", async (t) => {
  const f = await fixture(t);
  await f.gateway.stop();
  await f.gateway.saveConfig({ ...f.gateway.config, lan: true });
  const saved = JSON.parse(
    await fs.readFile(path.join(f.directory, "api-gateway.json"), "utf8"),
  );
  assert.equal(saved.config.lan, true);
  assert.equal(path.basename(f.directory).startsWith("wbs-api-"), true);
  const gateway = new ApiGateway({
    directory: f.directory,
    stores: f.stores,
    vault: f.vault,
    listenPort: 0,
  });
  await gateway.init();
  t.after(() => gateway.stop());
  assert.equal(gateway.config.lan, true);
  const status = await gateway.start();
  assert.equal(status.config.lan, true);
  const address = gateway.server.address();
  assert.equal(address.address, "0.0.0.0");
  assert.equal(os.platform() === "win32" ? true : address.family !== "IPv6", true);
});
