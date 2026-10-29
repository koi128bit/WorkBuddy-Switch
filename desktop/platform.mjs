import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

export const supportedPlatforms = Object.freeze(["darwin", "win32", "linux"]);
export function assertPlatform(platform) {
  if (!supportedPlatforms.includes(platform))
    throw new Error("当前操作系统暂不支持此客户端操作。");
}
const absolute = (value, fallback) =>
  typeof value === "string" && path.isAbsolute(value) ? value : fallback;
export function configRoot({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
} = {}) {
  assertPlatform(platform);
  if (platform === "darwin")
    return path.join(home, "Library", "Application Support");
  if (platform === "win32")
    return absolute(env.APPDATA, path.join(home, "AppData", "Roaming"));
  return absolute(env.XDG_CONFIG_HOME, path.join(home, ".config"));
}
export function workBuddyAuthRoot({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
} = {}) {
  assertPlatform(platform);
  const base =
    platform === "darwin"
      ? configRoot({ platform, home, env })
      : platform === "win32"
        ? absolute(env.LOCALAPPDATA, path.join(home, "AppData", "Local"))
        : absolute(env.XDG_DATA_HOME, path.join(home, ".local", "share"));
  return path.join(base, "CodeBuddyExtension", "Data", "Public", "auth");
}

// Local encryption is an explicit macOS development option. New records use
// authenticated encryption; pre-existing local CBC records remain readable.
const LOCAL_MAGIC = Buffer.from("wbv1");
const localVaultRequested = (platform, env) =>
  platform === "darwin" && env.WORKBUDDY_LOCAL_VAULT === "1";

function readLocalVaultKey(file, create = false) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || ![16, 32].includes(stat.size) ||
        (process.platform !== "win32" && (stat.mode & 0o077)))
      throw new Error("本地保险库密钥损坏或权限不安全，请保留原文件并恢复备份。");
    const key = fs.readFileSync(fd);
    if (![16, 32].includes(key.length)) throw new Error("本地保险库密钥损坏。");
    return key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!create) throw new Error("本地保险库密钥缺失，请恢复原密钥；不会自动重建。", { cause: error });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return readLocalVaultKey(file);
}

const authenticatedKey = (key) => key.length === 32 ? key :
  Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), "WorkBuddy Switch local vault v1", 32));

export function createSystemVault(engine, platform = process.platform, {
  env = process.env,
  directory = path.join(configRoot(), "WorkBuddy Switch"),
} = {}) {
  assertPlatform(platform);
  if (localVaultRequested(platform, env)) {
    const file = path.join(directory, ".local-vault-key");
    return {
      available: () => true,
      local: true,
      encrypt(raw) {
        const key = authenticatedKey(readLocalVaultKey(file, true));
        const nonce = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(LOCAL_MAGIC);
        const ciphertext = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
        return Buffer.concat([LOCAL_MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
      },
      decrypt(bytes) {
        const buffer = Buffer.from(bytes);
        if (buffer.subarray(0, 4).equals(LOCAL_MAGIC)) {
          if (buffer.length < 32) throw new Error("本地保险库密文损坏。");
          const key = authenticatedKey(readLocalVaultKey(file));
          const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(4, 16));
          decipher.setAAD(LOCAL_MAGIC);
          decipher.setAuthTag(buffer.subarray(16, 32));
          return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]).toString("utf8");
        }
        // Only unpublished local builds used a 16-byte key for v10 records.
        // Do not invent a key or embed a system/keychain password to read them.
        if (buffer.subarray(0, 3).toString() === "v10" && fs.existsSync(file)) {
          const key = readLocalVaultKey(file);
          if (key.length === 16) {
            try {
              const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
              return Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]).toString("utf8");
            } catch {
              // This may instead be an OS-encrypted record. The real system
              // service must authorize it; there is no hardcoded fallback.
            }
          }
        }
        if (!engine.isEncryptionAvailable()) throw new Error("系统加密不可用，无法读取旧账号；请解锁系统钥匙串。");
        return engine.decryptString(buffer);
      },
    };
  }
  const available = () =>
    engine.isEncryptionAvailable() &&
    (platform !== "linux" ||
      ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
        engine.getSelectedStorageBackend?.(),
      ));
  const requireSecure = () => {
    if (!available())
      throw new Error(
        platform === "linux"
          ? "系统密钥环不可用，请启动并解锁 GNOME Keyring 或 KWallet。不会降级为明文保存。"
          : "系统加密服务不可用，请解锁系统凭据存储后重试。",
      );
  };
  return {
    available,
    local: false,
    encrypt(raw) {
      requireSecure();
      return engine.encryptString(raw);
    },
    decrypt(bytes) {
      requireSecure();
      return engine.decryptString(bytes);
    },
  };
}
