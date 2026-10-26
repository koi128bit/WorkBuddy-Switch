import path from "node:path";
import os from "node:os";
import { workBuddyAuthRoot } from "./platform.mjs";
import { clientDefinition } from "./client-registry.mjs";

export const defaults = Object.freeze({
  theme: "system",
  privacyMode: true,
  compactMode: false,
  glassEffect: true,
  launchAtLogin: false,
  closeToTray: true,
  autoCapture: false,
  refreshSeconds: 300,
  restartAfterSwitch: true,
  autoSwitchOnZero: false,
  expiryWarningDays: 7,
  lowBalanceThreshold: 20,
  notifications: true,
  authPath: "",
  dataPath: "",
  executablePath: "",
  backupLimit: 10,
  autoCheckin: false,
  autoClaimTravel: false,
  autoDepartTravel: false,
  automationIntervalMinutes: 15,
  checkinHour: 9,
  checkinMinute: 0,
  menuBarBalance: true,
  activeProvider: "workbuddy",
  traeDataPath: "",
  traeExecutablePath: "",
  qoderDataPath: "",
  qoderExecutablePath: "",
  workbuddyGlobalAuthPath: "",
  workbuddyGlobalDataPath: "",
  workbuddyGlobalExecutablePath: "",
  traeGlobalDataPath: "",
  traeGlobalExecutablePath: "",
  qoderGlobalDataPath: "",
  qoderGlobalExecutablePath: "",
});

export function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("设置格式无效。");
  const result = { ...defaults };
  for (const [key, raw] of Object.entries(value)) {
    if (!Object.hasOwn(defaults, key))
      throw new Error("包含无法识别的设置项。");
    if (typeof raw !== typeof defaults[key])
      throw new Error("设置值类型无效。");
    if (key === "theme" && !["system", "light", "dark"].includes(raw))
      throw new Error("主题设置无效。");
    if (key === "activeProvider") {
      try {
        clientDefinition(raw);
      } catch {
        throw new Error("客户端选择无效。");
      }
    }
    if (key === "refreshSeconds" && ![0, 30, 60, 300, 600, 1800].includes(raw))
      throw new Error("刷新间隔无效。");
    if (
      key === "expiryWarningDays" &&
      (!Number.isInteger(raw) || raw < 1 || raw > 30)
    )
      throw new Error("提醒天数应在 1–30 之间。");
    if (
      key === "lowBalanceThreshold" &&
      (!Number.isFinite(raw) || raw < 0 || raw > 100000)
    )
      throw new Error("余额提醒阈值无效。");
    if (key === "backupLimit" && ![5, 10, 20, 50].includes(raw))
      throw new Error("备份保留数量无效。");
    if (key === "automationIntervalMinutes" && ![5, 15, 30, 60].includes(raw))
      throw new Error("自动任务检查间隔无效。");
    if (
      key === "checkinHour" &&
      (!Number.isInteger(raw) || raw < 0 || raw > 23)
    )
      throw new Error("签到小时应为 0–23。");
    if (
      key === "checkinMinute" &&
      (!Number.isInteger(raw) || raw < 0 || raw > 59)
    )
      throw new Error("签到分钟应为 0–59。");
    if (
      key.endsWith("Path") &&
      (raw.length > 4096 ||
        raw.includes("\0") ||
        (raw !== "" && !path.isAbsolute(raw)))
    )
      throw new Error("请填写完整的本地路径。");
    result[key] = raw;
  }
  return result;
}

export function resolvePaths(
  settings,
  {
    platform = process.platform,
    home = os.homedir(),
    env = process.env,
    provider = "workbuddy",
  } = {},
) {
  const definition = clientDefinition(provider);
  const authRoot = workBuddyAuthRoot({ platform, home, env });
  const data = settings.dataPath || path.join(home, definition.data);
  return {
    auth: settings.authPath || path.join(authRoot, definition.authFile),
    data,
    database: path.join(data, "workbuddy.db"),
    projects: path.join(data, "projects"),
  };
}
