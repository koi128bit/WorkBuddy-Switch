import type { Provider, WorkBuddyProvider, Bridge } from "./types";
export const providers = {
  workbuddy: { name: "WorkBuddy", key: "workbuddy", data: ".workbuddy" },
  "workbuddy-global": {
    name: "WorkBuddy 国际版",
    key: "workbuddyGlobal",
    data: ".workbuddy-ai",
  },
  "trae-cn": { name: "Trae CN", key: "trae", data: "Trae CN" },
  "trae-global": { name: "Trae 国际版", key: "traeGlobal", data: "Trae" },
  "qoder-cn": {
    name: "Qoder CN",
    key: "qoder",
    data: "com.qodercn.app.stable",
  },
  "qoder-global": {
    name: "Qoder 国际版",
    key: "qoderGlobal",
    data: "com.qoder.app.stable",
  },
} as const;
export const providerNames = Object.fromEntries(
  Object.entries(providers).map(([id, value]) => [id, value.name]),
) as Record<Provider, string>;
export const isWorkBuddy = (
  provider: Provider,
): provider is WorkBuddyProvider =>
  provider === "workbuddy" || provider === "workbuddy-global";
const globalMethods = new Set([
  "capture",
  "switchAccount",
  "editAccount",
  "removeAccount",
  "refreshQuotas",
  "sessions",
  "usage",
  "resume",
  "launchClient",
  "traySwitch",
  "diagnostics",
  "backups",
  "backupSessions",
  "exportAccounts",
  "importAccounts",
  "exportUsage",
  "openFolder",
]);
const cnMethods = new Set([
  "refreshRewards",
  "claimRewards",
  "runTasks",
  "prepareTasks",
  "cancelTasks",
  "departTravel",
  "importLegacy",
]);
const loginMethods = new Set([
  "startLogin",
  "pollLogin",
  "openLogin",
  "cancelLogin",
]);
const cache = new Map<Provider, Bridge>();
let native: Bridge;
type Methods = Record<string, (...args: unknown[]) => unknown>;
// contextBridge exposes its API as own data properties that cannot be
// redefined (writable: false, configurable: false). A Proxy get trap that
// returns a wrapper for such a property breaks the ES proxy invariant, which
// throws before the call reaches the main process, so copy the surface into a
// plain object and override the provider-specific methods there.
function copyMethods(target: Bridge): Methods {
  const methods: Methods = {};
  for (const key of Object.getOwnPropertyNames(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && "value" in descriptor) methods[key] = descriptor.value;
  }
  return methods;
}
function scoped(target: Bridge, provider: Provider): Bridge {
  const methods = copyMethods(target);
  for (const key of loginMethods) {
    const login = methods[key];
    if (typeof login !== "function") continue;
    methods[key] = (...args: unknown[]) => login(...args, provider);
  }
  if (provider === "workbuddy-global") {
    for (const key of globalMethods)
      methods[key] = (...args: unknown[]) =>
        target.workbuddyScope(provider, key, args);
    for (const key of cnMethods)
      methods[key] = async () => {
        throw new Error("该功能仅支持 WorkBuddy 国内版。");
      };
  }
  return methods as unknown as Bridge;
}
export function apiFor(provider: Provider): Bridge {
  if (native !== window.workbuddy) {
    native = window.workbuddy;
    cache.clear();
  }
  if (!native) return native;
  const cached = cache.get(provider);
  if (cached) return cached;
  const bridge = scoped(native, provider);
  cache.set(provider, bridge);
  return bridge;
}
