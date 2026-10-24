import path from "node:path";
import os from "node:os";

export const supportedPlatforms = Object.freeze(["darwin", "win32", "linux"]);
export function assertPlatform(platform) {
  if (!supportedPlatforms.includes(platform)) throw new Error("当前操作系统暂不支持此客户端操作。");
}
const absolute = (value, fallback) => typeof value === "string" && path.isAbsolute(value) ? value : fallback;
export function configRoot({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  assertPlatform(platform);
  if (platform === "darwin") return path.join(home, "Library", "Application Support");
  if (platform === "win32") return absolute(env.APPDATA, path.join(home, "AppData", "Roaming"));
  return absolute(env.XDG_CONFIG_HOME, path.join(home, ".config"));
}
export function workBuddyAuthRoot({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  assertPlatform(platform);
  const base = platform === "darwin" ? configRoot({ platform, home, env }) : platform === "win32" ? absolute(env.LOCALAPPDATA, path.join(home, "AppData", "Local")) : absolute(env.XDG_DATA_HOME, path.join(home, ".local", "share"));
  return path.join(base, "CodeBuddyExtension", "Data", "Public", "auth");
}
export function createSystemVault(engine, platform = process.platform) {
  assertPlatform(platform);
  const available = () => engine.isEncryptionAvailable() && (platform !== "linux" || ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(engine.getSelectedStorageBackend?.()));
  const requireSecure = () => { if (!available()) throw new Error(platform === "linux" ? "系统密钥环不可用，请启动并解锁 GNOME Keyring 或 KWallet。不会降级为明文保存。" : "系统加密服务不可用，请解锁系统凭据存储后重试。"); };
  return { available, encrypt(raw) { requireSecure(); return engine.encryptString(raw); }, decrypt(bytes) { requireSecure(); return engine.decryptString(bytes); } };
}
