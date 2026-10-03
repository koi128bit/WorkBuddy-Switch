import test from "node:test";
import assert from "node:assert/strict";
import { Login, officialLoginURL } from "../desktop/login.mjs";
import { parseAuth, mergeAuth } from "../desktop/auth.mjs";

test("client protected credentials are preserved and recognized without guessing decryption keys", () => {
  const wrapper = { $wbEncrypted: 1, envelope: "fixture-encrypted-field" };
  const raw = JSON.stringify({
    account: { uid: "a" },
    auth: { accessToken: wrapper },
  });
  assert.equal(parseAuth(raw).protectedToken, true);
  assert.equal(parseAuth(raw).token, "");
  assert.deepEqual(JSON.parse(mergeAuth(null, raw)).auth.accessToken, wrapper);
});
test("login URLs allow only the official https hosts", () => {
  assert.ok(officialLoginURL("https://www.codebuddy.cn/login?state=fixture"));
  for (const url of [
    "https://www.codebuddy.cn.evil.test",
    "http://www.codebuddy.cn",
    "https://user@www.codebuddy.cn",
    "javascript:alert(1)",
    "https://www.codebuddy.cn:9999",
  ])
    assert.throws(() => officialLoginURL(url));
});
test("official login obtains identity in main process and supports cancellation", async () => {
  let calls = 0;
  const login = new Login(async () => ({
    ok: true,
    json: async () => {
      calls++;
      return calls === 1
        ? {
            data: {
              state: "fixture-state",
              authUrl: "https://www.codebuddy.cn/login",
            },
          }
        : calls === 2
          ? {
              data: {
                accessToken: "fixture-token",
                domain: "www.codebuddy.cn",
              },
            }
          : { data: { uid: "fixture-id", nickname: "Name" } };
    },
  }));
  const ticket = await login.start();
  assert.ok(!JSON.stringify(ticket).includes("fixture-state"));
  const document = await login.poll(ticket.id);
  assert.equal(document.id, "fixture-id");
  login.cancel(ticket.id);
  assert.throws(() => login.require(ticket.id), /过期/);
});
test("unauthorized foreign-domain login cannot be saved", async () => {
  let count = 0;
  const login = new Login(async () => ({
    ok: true,
    json: async () =>
      ++count === 1
        ? { data: { state: "fixture", url: "https://www.codebuddy.cn/login" } }
        : { data: { accessToken: "fixture-token", domain: "attacker.test" } },
  }));
  const ticket = await login.start();
  await assert.rejects(() => login.poll(ticket.id), /域名不匹配/);
});
