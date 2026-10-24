import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { editorDefinition } from "./client-registry.mjs";
import { editorDataPath } from "./editor-controller.mjs";
import {
  extractTraePeppers,
  decryptTrae,
  decryptChromium,
  parseQoderIdentity,
  parseTraeIdentity,
} from "./credential-codecs.mjs";
const exec = promisify(execFile);
async function bounded(file, limit = 4 * 1024 * 1024) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw new Error("客户端资料类型或大小无法识别。");
  return fs.readFile(file, "utf8");
}
async function unprotectWindows(encoded) {
  // DPAPI input travels over stdin; neither key material nor account credentials
  // appear in process arguments, stderr, or an exception returned to the UI.
  const script =
    "Add-Type -AssemblyName System.Security; try { $v=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($p)); } catch { exit 1 }";
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
    );
    let output = Buffer.alloc(0),
      failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      reject(new Error("Windows 系统凭据无法解锁，请在原系统用户下重试。"));
    };
    const timeout = setTimeout(() => {
      child.kill();
      fail();
    }, 15000);
    child.on("error", () => {
      clearTimeout(timeout);
      fail();
    });
    child.stdout.on("data", (data) => {
      output = Buffer.concat([output, data]);
      if (output.length > 4096) {
        child.kill();
        fail();
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return fail();
      if (!failed) resolve(Buffer.from(output.toString().trim(), "base64"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(encoded);
  });
}
export class NativeCredentials {
  keys = new Map();
  pepperCache = new Map();
  constructor({
    controllers,
    settings,
    platform = process.platform,
    home = os.homedir(),
    env = process.env,
    run = exec,
  }) {
    Object.assign(this, { controllers, settings, platform, home, env, run });
  }
  directory(provider) {
    return editorDataPath(provider, this.settings(), {
      platform: this.platform,
      home: this.home,
      env: this.env,
    });
  }
  async peppers(provider) {
    const app = await this.controllers[provider]?.executable();
    if (!app) throw new Error("未找到 Trae 安装目录，请在设置中选择对应应用。");
    const resources =
      this.platform === "darwin"
        ? path.join(app, "Contents/Resources/app")
        : path.join(path.dirname(app), "resources/app");
    const file = path.join(resources, "out/main.js"),
      stat = await fs.stat(file),
      cached = this.pepperCache.get(file);
    if (cached?.mtime === stat.mtimeMs) return cached.value;
    const value = extractTraePeppers(await bounded(file, 128 * 1024 * 1024));
    this.pepperCache.set(file, { mtime: stat.mtimeMs, value });
    return value;
  }
  async qoderKey(provider, directory, document, { interactive = true } = {}) {
    const definition = editorDefinition(provider),
      cacheKey = `${provider}:${directory}:${document.binding || ""}`;
    if (this.keys.has(cacheKey)) return this.keys.get(cacheKey);
    if (!interactive)
      throw new Error("请点击读取当前账号以解锁客户端系统凭据。");
    let result;
    try {
      if (this.platform === "darwin") {
        const { stdout } = await this.run(
          "/usr/bin/security",
          ["find-generic-password", "-s", definition.keychainService, "-w"],
          { timeout: 30000, maxBuffer: 65536 },
        );
        result = {
          platform: this.platform,
          password: stdout.replace(/\r?\n$/, ""),
        };
      } else if (this.platform === "win32") {
        const state = JSON.parse(
            await bounded(path.join(directory, "Local State")),
          ),
          encoded = state.os_crypt?.encrypted_key;
        if (typeof encoded !== "string") throw new Error();
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.toString("ascii", 0, 5) !== "DPAPI") throw new Error();
        result = {
          platform: this.platform,
          key: await unprotectWindows(bytes.subarray(5).toString("base64")),
        };
        if (result.key.length !== 32) throw new Error();
      } else {
        // Attribute names vary by vendor release. A failed lookup retains the
        // encrypted native snapshot instead of inventing a password/keyring.
        const applications =
          definition.region === "cn"
            ? ["qoder-cn-app", "qoder-cn", "qodercn", "qoder"]
            : ["qoder"];
        for (const application of applications) {
          try {
            const { stdout } = await this.run(
              "secret-tool",
              ["lookup", "application", application],
              { timeout: 10000, maxBuffer: 65536 },
            );
            const password = stdout.replace(/\r?\n$/, "");
            if (password) {
              const candidate = { platform: "linux", password };
              decryptChromium(
                Buffer.from(document.entries["auth.v1.dat"], "base64"),
                candidate,
              );
              result = candidate;
              break;
            }
          } catch {}
        }
        if (!result) throw new Error();
      }
      if (result.password === "") throw new Error();
    } catch {
      throw new Error(
        "无法读取该客户端的系统凭据，请解锁钥匙串或密钥环；仍可保存兼容快照。",
      );
    }
    this.keys.set(cacheKey, result);
    return result;
  }
  async identify(provider, document, directory, options = {}) {
    const definition = editorDefinition(provider);
    if (definition.product === "trae") {
      const raw = document.entries["iCubeAuthInfo://icube.cloudide"];
      if (raw && typeof raw === "object") return parseTraeIdentity(raw);
      if (typeof raw !== "string") throw new Error("未找到客户端登录账号。");
      const peppers = await this.peppers(provider);
      return parseTraeIdentity(decryptTrae(raw, peppers.aes));
    }
    const optionsKey = await this.qoderKey(
      provider,
      directory,
      document,
      options,
    );
    let payload;
    try {
      payload = JSON.parse(
        decryptChromium(
          Buffer.from(document.entries["auth.v1.dat"], "base64"),
          optionsKey,
        ),
      );
    } catch {
      throw new Error("当前 Qoder 登录资料无法识别，已保留兼容快照。");
    }
    return parseQoderIdentity(payload);
  }
  async context(provider, { privateKey = false } = {}) {
    const definition = editorDefinition(provider),
      directory = this.directory(provider);
    if (definition.product === "qoder") {
      for (const file of [
        path.join(this.home, definition.cliHome, ".auth/machine_id"),
        path.join(directory, "auth.machine-id"),
      ]) {
        try {
          let machineId = (await bounded(file, 65536)).trim();
          if (machineId.startsWith('"')) machineId = JSON.parse(machineId);
          if (
            typeof machineId === "string" &&
            machineId.length > 0 &&
            machineId.length <= 200
          )
            return { machineId, platform: this.platform };
        } catch (error) {
          if (error.code !== "ENOENT")
            throw new Error("客户端设备资料无法读取，请重新启动客户端。");
        }
      }
      throw new Error("请先打开 Qoder 完成初始化，再发起网页登录。");
    }
    let root, peppers, product;
    try {
      root = JSON.parse(
        await bounded(path.join(directory, "User/globalStorage/storage.json")),
      );
      peppers = await this.peppers(provider);
      const app = await this.controllers[provider].executable(),
        resource =
          this.platform === "darwin"
            ? path.join(app, "Contents/Resources/app")
            : path.join(path.dirname(app), "resources/app");
      product = JSON.parse(await bounded(path.join(resource, "product.json")));
    } catch {
      throw new Error(
        "Trae 初始化资料无法读取，请在设置中核对应用及数据目录，再正常启动客户端。",
      );
    }
    const deviceEntry = Object.entries(root).find(([key]) =>
      key.startsWith("iCubeAuthInfo://icube-dc:"),
    );
    if (!deviceEntry) throw new Error("请先正常启动 Trae 完成设备初始化。");
    const payload =
      typeof deviceEntry[1] === "object"
        ? deviceEntry[1]
        : decryptTrae(deviceEntry[1], peppers.private);
    const deviceId = deviceEntry[0].slice("iCubeAuthInfo://icube-dc:".length),
      machineId = root["telemetry.machineId"];
    if (
      !machineId ||
      !payload.publicKeyPEM ||
      !product.appVersion ||
      !product.tronBuildVersion
    )
      throw new Error("当前 Trae 版本的设备资料不完整，请通过客户端重新登录。");
    return {
      machineId,
      deviceId,
      publicKey: payload.publicKeyPEM,
      ...(privateKey ? { privateKey: payload.privateKeyPEM } : {}),
      appVersion: product.appVersion,
      pluginVersion: product.tronBuildVersion,
      quality: product.quality || "stable",
      platform: this.platform,
    };
  }
}
