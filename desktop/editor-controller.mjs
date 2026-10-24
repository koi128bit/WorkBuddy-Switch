import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { editorDefinitions as editors, editorDefinition } from "./client-registry.mjs";
import { configRoot, assertPlatform } from "./platform.mjs";
export { editors, editorDefinition };

const exec = promisify(execFile);
export function parseQoderLauncher(raw) {
  const text = (
    raw[0] === 0xff && raw[1] === 0xfe
      ? raw.subarray(2).toString("utf16le")
      : raw.toString("utf8")
  ).replace(/^\uFEFF/, "");
  const fields = Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(
        /^\s*(installDir|appExecutable)\s*=\s*(.*?)\s*$/i,
      );
      return match
        ? [[match[1].toLowerCase(), match[2].replace(/^"(.*)"$/, "$1")]]
        : [];
    }),
  );
  if (
    !fields.installdir ||
    !fields.appexecutable ||
    !path.win32.isAbsolute(fields.installdir) ||
    path.win32.isAbsolute(fields.appexecutable)
  )
    return null;
  const destination = path.win32.resolve(
    fields.installdir,
    fields.appexecutable,
  );
  const relative = path.win32.relative(fields.installdir, destination);
  if (
    relative.startsWith("..") ||
    path.win32.isAbsolute(relative) ||
    path.win32.basename(destination).toLowerCase() !== "qoder cn.exe"
  )
    return null;
  return destination;
}
export function editorDataPath(
  provider,
  settings,
  { platform = process.platform, home = os.homedir(), env = process.env } = {},
) {
  const definition = editorDefinition(provider);
  return (
    settings[`${definition.key}DataPath`] || path.join(configRoot({ platform, home, env }), definition.data)
  );
}

export class EditorController {
  constructor(provider, settings, context = {}) {
    this.definition = editorDefinition(provider);
    this.settings = settings;
    this.platform = context.platform || process.platform;
    assertPlatform(this.platform);
    this.home = context.home || os.homedir();
    this.env = context.env || process.env;
  }
  async executable() {
    const d = this.definition;
    const custom = this.settings()[`${d.key}ExecutablePath`];
    const candidates = custom
      ? [custom]
      : this.platform === "darwin"
        ? [
            path.join("/Applications", d.app),
            path.join(this.home, "Applications", d.app),
          ]
        : d.windows.flatMap((folder) => [
            path.join(
              this.env.LOCALAPPDATA || path.join(this.home, "AppData", "Local"),
              "Programs",
              folder,
              d.executable,
            ),
            path.join(
              this.env.ProgramFiles || "C:\\Program Files",
              folder,
              d.executable,
            ),
          ]);
    if (!custom && this.platform === "win32" && d.key === "qoder") {
      const local =
        this.env.LOCALAPPDATA || path.join(this.home, "AppData", "Local");
      try {
        const launcher = path.join(
          local,
          "Qoder CN",
          "Qoder CN Launcher",
          "state.ini",
        );
        const stat = await fs.stat(launcher);
        if (stat.size <= 65536) {
          const file = parseQoderLauncher(await fs.readFile(launcher));
          if (file) candidates.unshift(file);
        }
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("无法读取 Qoder CN 启动器配置，请指定安装路径。");
      }
      candidates.push(path.join(local, "Qoder CN", d.executable));
    }
    for (const file of candidates) {
      try {
        const stat = await fs.stat(file);
        if (
          this.platform === "darwin" &&
          stat.isDirectory() &&
          file.endsWith(".app")
        ) {
          const { stdout } = await exec(
            "/usr/bin/plutil",
            [
              "-extract",
              "CFBundleIdentifier",
              "raw",
              "-o",
              "-",
              path.join(file, "Contents", "Info.plist"),
            ],
            { timeout: 5000 },
          );
          if (stdout.trim() !== d.bundle)
            throw new Error(`${d.name} 安装路径与国内版标识不符。`);
          return file;
        }
        if (
          this.platform === "win32" &&
          stat.isFile() &&
          path.basename(file).toLowerCase() === d.executable.toLowerCase()
        )
          return file;
        if (custom) throw new Error(`请选择 ${d.name} 的客户端应用。`);
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error(`无法验证 ${d.name} 安装路径，请选择国内版客户端。`);
      }
    }
    return null;
  }
  async processes() {
    try {
      if (this.platform === "darwin") {
        const { stdout } = await exec("/bin/ps", ["-axo", "pid=,command="], {
          timeout: 8000,
          maxBuffer: 4 * 1024 * 1024,
        });
        return stdout.split("\n").flatMap((line) => {
          const match = line.trim().match(/^(\d+)\s+(.+)$/);
          return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
        });
      }
      const { stdout } = await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Trae|Qoder' } | Select-Object Name,ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress",
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      );
      const result = JSON.parse(stdout.trim() || "[]");
      const list = Array.isArray(result) ? result : [result];
      if (
        list.some(
          (item) =>
            item.Name?.toLowerCase() ===
              this.definition.executable.toLowerCase() && !item.ExecutablePath,
        )
      )
        throw new Error("unknown process");
      return list.map((item) => ({
        pid: Number(item.ProcessId),
        executable: item.ExecutablePath || "",
        command: item.CommandLine || "",
      }));
    } catch {
      throw new Error(
        `无法确认 ${this.definition.name} 运行状态，请手动退出后重试。`,
      );
    }
  }
  matching(processes, executable) {
    return processes.filter((item) =>
      this.platform === "darwin"
        ? item.command.startsWith(`${executable}/Contents/`)
        : item.executable.toLowerCase() === executable.toLowerCase(),
    );
  }
  async status() {
    const executable = await this.executable();
    return {
      installed: !!executable,
      executable,
      running: executable
        ? this.matching(await this.processes(), executable).length > 0
        : false,
    };
  }
  async stop() {
    const file = await this.executable();
    if (!file)
      throw new Error(`未找到 ${this.definition.name}，请先指定安装路径。`);
    const current = this.matching(await this.processes(), file);
    if (!current.length) return false;
    try {
      if (this.platform === "darwin")
        await exec(
          "/usr/bin/osascript",
          ["-e", `tell application id "${this.definition.bundle}" to quit`],
          { timeout: 10000 },
        );
      else
        for (const item of current.filter(
          (item) => !/(^|\s)--type(?:=|\s)/.test(item.command),
        ))
          await exec("taskkill.exe", ["/PID", String(item.pid)], {
            windowsHide: true,
            timeout: 8000,
          });
    } catch {
      throw new Error(
        `${this.definition.name} 未能正常退出，请手动退出后重试。`,
      );
    }
    for (let i = 0; i < 40; i++) {
      await delay(250);
      if (!this.matching(await this.processes(), file).length) return true;
    }
    throw new Error(
      `${this.definition.name} 仍在运行，登录信息尚未写入。请先结束任务并退出客户端。`,
    );
  }
  async assertStopped() {
    const status = await this.status();
    if (!status.installed || status.running !== false)
      throw new Error(
        `${this.definition.name} 的退出状态无法确认，已停止写入登录信息。`,
      );
  }
  async launch() {
    const file = await this.executable();
    if (!file)
      throw new Error(
        `未找到 ${this.definition.name}，请在路径设置中选择客户端。`,
      );
    try {
      if (this.platform === "darwin")
        await exec("/usr/bin/open", ["-a", file], { timeout: 10000 });
      else
        await new Promise((resolve, reject) => {
          const child = spawn(file, [], {
            detached: true,
            stdio: "ignore",
            windowsHide: false,
          });
          child.once("error", reject);
          child.once("spawn", () => {
            child.unref();
            resolve();
          });
        });
      await delay(1000);
      if (!(await this.status()).running) throw new Error("not running");
    } catch {
      throw new Error(`${this.definition.name} 启动失败，请检查安装路径。`);
    }
  }
}
