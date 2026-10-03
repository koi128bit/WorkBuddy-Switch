import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
export class WorkBuddyController {
  constructor(
    settings,
    {
      platform = process.platform,
      home = os.homedir(),
      env = process.env,
    } = {},
  ) {
    this.settings = settings;
    this.platform = platform;
    this.home = home;
    this.env = env;
  }
  async executable() {
    const custom = this.settings().executablePath;
    const local =
      this.env.LOCALAPPDATA || path.join(this.home, "AppData", "Local");
    const candidates = custom
      ? [custom]
      : this.platform === "darwin"
        ? [
            "/Applications/WorkBuddy.app",
            path.join(this.home, "Applications", "WorkBuddy.app"),
          ]
        : [
            path.join(local, "Programs", "WorkBuddy", "WorkBuddy.exe"),
            path.join(local, "WorkBuddy", "WorkBuddy.exe"),
            path.join(
              this.env.ProgramFiles || "C:\\Program Files",
              "WorkBuddy",
              "WorkBuddy.exe",
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
    if (this.platform === "darwin")
      return processes.filter(
        (p) =>
          p.command.startsWith(`${executable}/Contents/MacOS/`) &&
          !p.command.includes("/Helper"),
      );
    return processes.filter(
      (p) => p.executable.toLowerCase() === executable.toLowerCase(),
    );
  }
  async stop() {
    const executable = await this.executable();
    if (!executable)
      throw new Error("未找到 WorkBuddy，请在设置中指定安装路径。");
    const processList = await this.processes();
    this.ensureNoCLI(processList, executable);
    const active = this.mainProcesses(processList, executable);
    if (!active.length) return false;
    try {
      if (this.platform === "darwin")
        await exec(
          "/usr/bin/osascript",
          ["-e", 'tell application id "com.workbuddy.workbuddy" to quit'],
          { timeout: 10000 },
        );
      else
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
        this.ensureNoCLI(current, executable);
        return true;
      }
    }
    throw new Error(
      "WorkBuddy 仍在运行。为保护进行中的任务，请手动关闭后重试。",
    );
  }
  ensureNoCLI(processes, executable) {
    const root = executable.toLowerCase();
    if (
      processes.some(
        (p) =>
          p.command.toLowerCase().includes(root) &&
          /[/\\]cli[/\\].*codebuddy/i.test(p.command) &&
          !/(^|\s)--serve(\s|$)/.test(p.command),
      )
    ) {
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
}
