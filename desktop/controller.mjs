import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { clientDefinition } from "./client-registry.mjs";
import { assertPlatform } from "./platform.mjs";
import {
  linuxProcesses,
  linuxExecutable,
  sameLinuxExecutable,
} from "./linux-processes.mjs";

const exec = promisify(execFile);
const packagedCLI = (command) => /[/\\]cli[/\\].*codebuddy/i.test(command);
const prewarmId = (command) =>
  command.match(
    /codebuddy(?:\.m?js)?["']?\s+--prewarm\s+--prewarm-id(?:=|\s+)(wb-pool-\d+-[a-f0-9]{6})["']?\s*$/i,
  )?.[1];
export class WorkBuddyController {
  constructor(
    settings,
    {
      platform = process.platform,
      home = os.homedir(),
      env = process.env,
      provider = "workbuddy",
    } = {},
  ) {
    this.settings = settings;
    this.platform = platform;
    this.home = home;
    this.env = env;
    this.definition = clientDefinition(provider);
    assertPlatform(platform);
    if (this.definition.product !== "workbuddy")
      throw new Error("请选择 WorkBuddy 客户端。");
  }
  async executable() {
    const custom = this.settings().executablePath;
    const local =
      this.env.LOCALAPPDATA || path.join(this.home, "AppData", "Local");
    const candidates = custom
      ? [custom]
      : this.platform === "darwin"
        ? [
            path.join("/Applications", this.definition.app),
            path.join(this.home, "Applications", this.definition.app),
          ]
        : this.platform === "linux"
          ? this.definition.linuxExecutables
          : [
              path.join(
                local,
                "Programs",
                this.definition.app.replace(/\.app$/, ""),
                this.definition.executable,
              ),
              path.join(
                local,
                this.definition.app.replace(/\.app$/, ""),
                this.definition.executable,
              ),
              path.join(
                this.env.ProgramFiles || "C:\\Program Files",
                this.definition.app.replace(/\.app$/, ""),
                this.definition.executable,
              ),
            ];
    for (const file of candidates) {
      try {
        const stat = await fs.stat(file);
        if (
          this.platform === "darwin" &&
          file.endsWith(".app") &&
          stat.isDirectory()
        )
          return file;
        if (this.platform === "linux" && stat.isFile())
          return await linuxExecutable(file);
        if (
          this.platform === "win32" &&
          file.toLowerCase().endsWith(".exe") &&
          stat.isFile()
        )
          return file;
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("无法访问 WorkBuddy 安装路径。");
      }
    }
    return null;
  }
  async processes() {
    try {
      if (this.platform === "linux")
        return await linuxProcesses(this.definition.linuxNames);
      if (this.platform === "darwin") {
        const { stdout } = await exec("/bin/ps", ["-axo", "pid=,command="], {
          timeout: 8000,
          maxBuffer: 4 * 1024 * 1024,
        });
        return stdout
          .split("\n")
          .map((line) => {
            const match = line.trim().match(/^(\d+)\s+(.+)$/);
            return match ? { pid: Number(match[1]), command: match[2] } : null;
          })
          .filter(Boolean);
      }
      const { stdout } = await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'WorkBuddy|codebuddy|node' } | Select-Object Name,ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress",
        ],
        { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      );
      const items = JSON.parse(stdout.trim() || "[]");
      const list = Array.isArray(items) ? items : [items];
      if (
        list.some(
          (item) => /workbuddy/i.test(item.Name) && !item.ExecutablePath,
        )
      )
        throw new Error("unreadable");
      return list.map((item) => ({
        pid: Number(item.ProcessId),
        command: item.CommandLine ?? "",
        executable: item.ExecutablePath ?? "",
      }));
    } catch {
      throw new Error("无法确认 WorkBuddy 进程状态，请手动关闭客户端后重试。");
    }
  }
  async status() {
    const executable = await this.executable();
    if (!executable)
      return { installed: false, running: false, executable: null };
    const processes = await this.processes();
    return {
      installed: true,
      executable,
      running: this.mainProcesses(processes, executable).length > 0,
    };
  }
  mainProcesses(processes, executable) {
    if (this.platform === "linux")
      return processes.filter(
        (item) =>
          sameLinuxExecutable(item, executable) && !packagedCLI(item.command),
      );
    if (this.platform === "darwin")
      return processes.filter(
        (p) =>
          p.command.startsWith(`${executable}/Contents/MacOS/`) &&
          !p.command.includes("/Helper") &&
          !packagedCLI(p.command),
      );
    return processes.filter(
      (p) =>
        p.executable.toLowerCase() === executable.toLowerCase() &&
        !packagedCLI(p.command),
    );
  }
  async stop() {
    const executable = await this.executable();
    if (!executable)
      throw new Error("未找到 WorkBuddy，请在设置中指定安装路径。");
    const processList = await this.processes();
    await this.ensureNoCLI(processList, executable);
    const active = this.mainProcesses(processList, executable);
    if (!active.length) return false;
    try {
      if (this.platform === "darwin")
        await exec(
          "/usr/bin/osascript",
          ["-e", `tell application id "${this.definition.bundle}" to quit`],
          { timeout: 10000 },
        );
      else if (this.platform === "linux") {
        for (const item of active.filter(
          (item) => !/(^|\s)--type(?:=|\s)/.test(item.command),
        )) {
          try {
            process.kill(item.pid, "SIGTERM");
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
        }
      } else
        for (const p of active)
          await exec("taskkill.exe", ["/PID", String(p.pid)], {
            windowsHide: true,
            timeout: 8000,
          });
    } catch {
      throw new Error("WorkBuddy 未能正常退出，请手动关闭后重试。");
    }
    for (let i = 0; i < 30; i++) {
      await delay(250);
      const current = await this.processes();
      if (!this.mainProcesses(current, executable).length) {
        await this.ensureNoCLI(current, executable);
        return true;
      }
    }
    throw new Error(
      "WorkBuddy 仍在运行。为保护进行中的任务，请手动关闭后重试。",
    );
  }
  async prewarmIdle(process) {
    const id = prewarmId(process.command);
    if (!id) return false;
    const socketPath =
      this.platform === "win32"
        ? `\\\\.\\pipe\\codebuddy-prewarm-${id}`
        : path.join(
            this.env.CODEBUDDY_CODE_PREWARM_SOCKET_PATH || "/tmp",
            `codebuddy-prewarm-${id}.sock`,
          );
    return new Promise((resolve) => {
      const socket = net.createConnection(socketPath);
      let raw = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1200);
      socket.once("connect", () => socket.write('{"cmd":"ping"}\n'));
      socket.on("data", (bytes) => {
        raw += bytes.toString("utf8");
        if (Buffer.byteLength(raw) > 4096) return finish(false);
        if (!raw.includes("\n")) return;
        try {
          const status = JSON.parse(raw.split("\n")[0]);
          finish(
            status.ok === true &&
              status.cmd === "ping" &&
              status.status === "idle" &&
              status.pid === process.pid,
          );
        } catch {
          finish(false);
        }
      });
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
      socket.once("close", () => finish(false));
    });
  }
  async ensureNoCLI(processes, executable) {
    const root = executable.toLowerCase();
    for (const p of processes) {
      if (
        !p.command.toLowerCase().includes(root) ||
        !packagedCLI(p.command) ||
        /(^|\s)--serve(\s|$)/.test(p.command)
      )
        continue;
      // A pooled worker keeps --prewarm after being assigned real work. Only a
      // read-only ping proving this exact PID is idle may pass the guard.
      if (prewarmId(p.command) && (await this.prewarmIdle(p))) continue;
      throw new Error(
        "WorkBuddy 终端会话仍在运行，请先退出后再修改登录信息或恢复对话。",
      );
    }
  }
  async launch() {
    const executable = await this.executable();
    if (!executable)
      throw new Error("未找到 WorkBuddy，请在设置中指定安装路径。");
    if (this.platform === "darwin") {
      try {
        await exec("/usr/bin/open", ["-a", executable], { timeout: 10000 });
      } catch {
        throw new Error("WorkBuddy 启动失败，请检查安装路径。");
      }
    } else
      await new Promise((resolve, reject) => {
        const child = spawn(executable, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        });
        child.once("error", () =>
          reject(new Error("WorkBuddy 启动失败，请检查安装路径。")),
        );
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    await delay(800);
    if (!(await this.status()).running)
      throw new Error("未检测到 WorkBuddy 启动，请手动打开客户端。");
  }
  async verifyAccount(readActive, id) {
    // Give the official client's restore/refresh watcher time to reconcile.
    // A successful file write alone must not be reported as a successful login.
    for (let attempt = 0; attempt < 12; attempt++) {
      await delay(250);
      if ((await readActive())?.id !== id)
        throw new Error("客户端没有接受目标账号，登录信息已发生变化。");
    }
  }
}
