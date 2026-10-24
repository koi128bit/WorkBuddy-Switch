import test from "node:test";
import assert from "node:assert/strict";
import { Login, officialLoginURL } from "../desktop/login.mjs";
import { apiOrigin, fetchQuota } from "../desktop/quota.mjs";
import { parseAuth } from "../desktop/auth.mjs";
import { Store } from "../desktop/store.mjs";
const doc = (domain) =>
  parseAuth(
    JSON.stringify({
      account: { uid: "1" },
      auth: { accessToken: "fixture-token", domain },
    }),
  );
test("WorkBuddy global login and quota never send authorization to a CN origin", async () => {
  assert.equal(apiOrigin(doc("www.workbuddy.ai")), "https://www.workbuddy.ai");
  assert.equal(
    officialLoginURL("https://www.workbuddy.ai/login", "workbuddy-global"),
    "https://www.workbuddy.ai/login",
  );
  assert.throws(() =>
    officialLoginURL("https://www.codebuddy.cn/login", "workbuddy-global"),
  );
  let calls = 0;
  const login = new Login(async (url) => {
    assert.ok(url.startsWith("https://www.workbuddy.ai/"));
    if (url.includes("/auth/state"))
      assert.equal(new URL(url).searchParams.get("platform"), "workbuddy-ai");
    return {
      ok: true,
      json: async () => ({
        data:
          ++calls === 1
            ? { state: "fixture", authUrl: "https://www.workbuddy.ai/login" }
            : calls === 2
              ? { accessToken: "fixture", domain: "www.workbuddy.ai" }
              : { uid: "1" },
      }),
    };
  }, "workbuddy-global");
  const ticket = await login.start();
  assert.equal((await login.poll(ticket.id)).id, "1");
  await fetchQuota(doc("www.workbuddy.ai"), async (url) => {
    assert.ok(url.startsWith("https://www.workbuddy.ai/"));
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { Accounts: [] } }),
    };
  });
});
test("WorkBuddy stores reject account material from another region before saving", async () => {
  const store = new Store({
    provider: "workbuddy-global",
    directory: "/unused",
    vault: { available: () => true },
    controller: {},
  });
  await assert.rejects(store.capture(doc("www.codebuddy.cn")), /地区|国际版/);
  assert.equal(store.paths.auth.endsWith("workbuddy-desktop-ai.info"), true);
});
