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
export function apiFor(provider: Provider): Bridge {
  if (native !== window.workbuddy) {
    native = window.workbuddy;
    cache.clear();
  }
  if (!native) return native;
  if (cache.has(provider)) return cache.get(provider)!;
  const target = native;
  // Electron freezes the native bridge. A separate target allows scoped wrappers
  // without violating the native properties' non-writable descriptors.
  const bridge = new Proxy({ ...target }, {
    get(_facade, key: keyof Bridge) {
      if (loginMethods.has(key))
        return (...args: unknown[]) =>
          (target[key] as (...values: unknown[]) => unknown)(...args, provider);
      if (provider === "workbuddy-global" && globalMethods.has(key))
        return (...args: unknown[]) =>
          target.workbuddyScope(provider, key, args);
      if (provider === "workbuddy-global" && cnMethods.has(key))
        return async () => {
          throw new Error("该功能仅支持 WorkBuddy 国内版。");
        };
      return target[key];
    },
  });
  cache.set(provider, bridge);
  return bridge;
}
