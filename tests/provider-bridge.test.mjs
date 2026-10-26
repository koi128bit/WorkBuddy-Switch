import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiFor, providers } from "../src/providers.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});

function expose(methods) {
  const bridge = Object.freeze(methods);
  globalThis.window = { workbuddy: bridge };
  return bridge;
}

for (const provider of Object.keys(providers)) {
  test(`a frozen ${provider} bridge supports the complete login lifecycle`, async () => {
    const calls = [];
    const ticket = { id: "isolated-login", expiresAt: 123456789 };
    const source = expose({
      startLogin: async (...args) => {
        calls.push(["start", ...args]);
        return ticket;
      },
      openLogin: async (...args) => calls.push(["open", ...args]),
      pollLogin: async (...args) => {
        calls.push(["poll", ...args]);
        return { done: true };
      },
      cancelLogin: async (...args) => calls.push(["cancel", ...args]),
    });
    const descriptor = Object.getOwnPropertyDescriptor(source, "startLogin");
    assert.equal(descriptor.writable, false);
    assert.equal(descriptor.configurable, false);

    const bridge = apiFor(provider);
    assert.equal(await bridge.startLogin(), ticket);
    await bridge.openLogin(ticket.id);
    assert.deepEqual(await bridge.pollLogin(ticket.id), { done: true });
    await bridge.cancelLogin(ticket.id);
    assert.deepEqual(calls, [
      ["start", provider],
      ["open", ticket.id, provider],
      ["poll", ticket.id, provider],
      ["cancel", ticket.id, provider],
    ]);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(source, "startLogin"),
      descriptor,
      "the original native bridge stays unchanged",
    );
  });
}

test("international account and usage actions stay in their own scope on a frozen bridge", async () => {
  const calls = [];
  expose({
    capture: async () => assert.fail("must not capture the domestic account"),
    usage: async () => assert.fail("must not read domestic usage"),
    workbuddyScope: async (...args) => {
      calls.push(args);
      return "scoped-result";
    },
  });
  const bridge = apiFor("workbuddy-global");
  const query = { days: 7, accountId: "international-account" };
  assert.equal(await bridge.capture("international"), "scoped-result");
  assert.equal(await bridge.usage(query), "scoped-result");
  assert.deepEqual(calls, [
    ["workbuddy-global", "capture", ["international"]],
    ["workbuddy-global", "usage", [query]],
  ]);
});

test("domestic actions and shared methods retain their native behavior", async () => {
  const settings = { privacyMode: true };
  const calls = [];
  const source = expose({
    capture: async (...args) => calls.push(args),
    saveSettings: async (value) => value,
    onChange: () => "unsubscribe",
  });
  const domestic = apiFor("workbuddy");
  await domestic.capture("domestic");
  assert.deepEqual(calls, [["domestic"]]);
  for (const provider of Object.keys(providers)) {
    const bridge = apiFor(provider);
    assert.equal(bridge.saveSettings, source.saveSettings);
    assert.equal(await bridge.saveSettings(settings), settings);
    assert.equal(bridge.onChange(), "unsubscribe");
  }
});

test("international rewards and AI tasks reject without invoking domestic services", async () => {
  expose({
    claimRewards: async () => assert.fail("must not claim domestic rewards"),
    runTasks: async () => assert.fail("must not run domestic AI tasks"),
  });
  const bridge = apiFor("workbuddy-global");
  await assert.rejects(bridge.claimRewards(), /仅支持 WorkBuddy 国内版/);
  await assert.rejects(
    bridge.runTasks(["international-account"]),
    /仅支持 WorkBuddy 国内版/,
  );
});

test("cached provider bridges remain bound to the source that created them", async () => {
  expose({ startLogin: async (provider) => `old:${provider}` });
  const oldDomestic = apiFor("workbuddy");
  const oldGlobal = apiFor("workbuddy-global");
  assert.equal(apiFor("workbuddy"), oldDomestic);
  assert.notEqual(oldDomestic, oldGlobal);
  expose({ startLogin: async (provider) => `new:${provider}` });
  const newDomestic = apiFor("workbuddy");
  assert.notEqual(newDomestic, oldDomestic);
  assert.equal(await newDomestic.startLogin(), "new:workbuddy");
  assert.equal(await oldDomestic.startLogin(), "old:workbuddy");
  assert.equal(await oldGlobal.startLogin(), "old:workbuddy-global");
});

test("non-enumerable native methods remain callable through the provider adapter", async () => {
  const snapshot = { accounts: [] };
  expose(
    Object.defineProperties(
      {},
      {
        startLogin: { value: async (provider) => `login:${provider}` },
        snapshot: { value: async () => snapshot },
      },
    ),
  );
  const bridge = apiFor("workbuddy");
  assert.equal(await bridge.startLogin(), "login:workbuddy");
  assert.equal(await bridge.snapshot(), snapshot);
});

test("missing preload bridges are handled until the bridge becomes available", async () => {
  globalThis.window = {};
  assert.equal(apiFor("workbuddy"), undefined);
  expose({ startLogin: async () => "ready" });
  assert.equal(await apiFor("workbuddy").startLogin(), "ready");
});

test("native login failures propagate without being replaced by proxy errors", async () => {
  const failure = new Error("Official authorization is unavailable");
  expose({
    startLogin: async () => {
      throw failure;
    },
  });
  await assert.rejects(
    apiFor("workbuddy").startLogin(),
    (error) => error === failure,
  );
});
