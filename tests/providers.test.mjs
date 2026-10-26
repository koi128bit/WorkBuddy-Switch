import test from "node:test";
import assert from "node:assert/strict";
import { apiFor } from "../src/providers.ts";

// Electron exposes contextBridge APIs through own data properties that are
// writable:false and configurable:false, so a Proxy get trap that returns a
// wrapper function violates the ES proxy invariant and throws before the call
// ever reaches the main process. Mirror that exact shape here.
const bridge = (handlers) => {
  const target = {};
  for (const [key, value] of Object.entries(handlers))
    Object.defineProperty(target, key, {
      value,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  globalThis.window = { workbuddy: target };
  return target;
};

test("login methods reach the bridge and forward the provider", async () => {
  const calls = [];
  bridge({
    startLogin: async (...args) => {
      calls.push(["startLogin", args]);
      return { id: "login-1", expiresAt: 1 };
    },
    pollLogin: async (...args) => {
      calls.push(["pollLogin", args]);
      return { done: false };
    },
    openLogin: async (...args) => calls.push(["openLogin", args]),
    cancelLogin: async (...args) => calls.push(["cancelLogin", args]),
  });
  const api = apiFor("workbuddy");
  assert.deepEqual(await api.startLogin(), { id: "login-1", expiresAt: 1 });
  await api.pollLogin("login-1");
  await api.openLogin("login-1");
  await api.cancelLogin("login-1");
  assert.deepEqual(calls, [
    ["startLogin", ["workbuddy"]],
    ["pollLogin", ["login-1", "workbuddy"]],
    ["openLogin", ["login-1", "workbuddy"]],
    ["cancelLogin", ["login-1", "workbuddy"]],
  ]);
});

test("global login methods forward the global provider", async () => {
  const calls = [];
  bridge({
    startLogin: async (...args) => {
      calls.push(args);
      return { id: "login-2", expiresAt: 2 };
    },
  });
  await apiFor("workbuddy-global").startLogin();
  assert.deepEqual(calls, [["workbuddy-global"]]);
});

test("global scoped methods route through the scope channel", async () => {
  const calls = [];
  bridge({
    workbuddyScope: async (...args) => {
      calls.push(args);
      return [];
    },
    refreshQuotas: async () => {
      throw new Error("scoped call bypassed workbuddyScope");
    },
  });
  const api = apiFor("workbuddy-global");
  assert.deepEqual(await api.refreshQuotas(), []);
  assert.deepEqual(calls, [["workbuddy-global", "refreshQuotas", []]]);
});

test("global provider still rejects CN-only methods", async () => {
  bridge({
    refreshRewards: async () => {
      throw new Error("CN-only method reached the bridge");
    },
  });
  await assert.rejects(
    () => apiFor("workbuddy-global").refreshRewards(),
    /该功能仅支持 WorkBuddy 国内版/,
  );
});

test("untouched methods keep their original identity", () => {
  const snapshot = async () => ({});
  bridge({ snapshot, startLogin: async () => ({}) });
  assert.equal(apiFor("workbuddy").snapshot, snapshot);
});

test("a bridge method replaced after the api was handed out is still used", async () => {
  // The UI tests swap methods on a plain mock bridge after the app mounted, so
  // the per-provider api has to read the bridge live instead of copying values.
  globalThis.window = {
    workbuddy: { snapshot: async () => ({ accounts: [] }) },
  };
  const api = apiFor("workbuddy");
  assert.deepEqual(await api.snapshot(), { accounts: [] });
  window.workbuddy.snapshot = async () => ({ accounts: ["later"] });
  assert.deepEqual(await api.snapshot(), { accounts: ["later"] });
});

test("a replaced bridge invalidates the cached per-provider api", () => {
  bridge({ snapshot: async () => ({ accounts: [] }) });
  const first = apiFor("workbuddy");
  const replacement = async () => ({ accounts: ["second"] });
  bridge({ snapshot: replacement });
  const second = apiFor("workbuddy");
  assert.notEqual(first, second);
  assert.equal(second.snapshot, replacement);
});
