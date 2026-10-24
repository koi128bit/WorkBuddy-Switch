import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export const APPLICATION_ID = "com.koi128bit.workbuddy-switch";
export const APPLICATION_PATH = "/Applications/WorkBuddy Switch.app";
const bundlePath = (executable) =>
  path.posix.dirname(path.posix.dirname(path.posix.dirname(executable)));
export function needsMacInstallation({ platform, packaged, executable }) {
  return (
    platform === "darwin" &&
    packaged &&
    bundlePath(executable) !== APPLICATION_PATH
  );
}
async function readInstalled() {
  try {
    await fs.access(APPLICATION_PATH);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const { stdout } = await exec(
    "/usr/bin/plutil",
    [
      "-convert",
      "json",
      "-o",
      "-",
      path.join(APPLICATION_PATH, "Contents/Info.plist"),
    ],
    { timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  const info = JSON.parse(stdout);
  return {
    id: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString,
  };
}
async function quitPeers(app) {
  const script = await fs.readFile(
    new URL("./quit-peers.jxa", import.meta.url),
    "utf8",
  );
  const { stdout } = await exec(
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      script,
      String(process.pid),
      app.getPath("userData"),
    ],
    { timeout: 30000, maxBuffer: 64 * 1024 },
  );
  return stdout.trim();
}
function versionParts(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value))
    throw new Error("无法确认已安装版本，请使用 PKG 安装包。");
  return value.split(".").map(Number);
}
const isNewer = (left, right) => {
  const a = versionParts(left),
    b = versionParts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};
export async function offerMacInstallation({
  app,
  dialog,
  shell,
  executable,
  readInstalled: read = readInstalled,
  quitPeers: stop = () => quitPeers(app),
}) {
  try {
    if (
      executable &&
      path.posix.basename(bundlePath(executable)) !== "WorkBuddy Switch.app"
    )
      throw new Error(
        "此副本的文件名已改变。请使用 PKG 安装包覆盖安装，避免产生另一个应用。",
      );
    const installed = await read();
    if (installed && installed.id !== APPLICATION_ID)
      throw new Error(
        "目标位置存在标识不同的应用，已停止覆盖。请检查应用程序目录。",
      );
    if (installed && isNewer(installed.version, app.getVersion())) {
      const choice = await dialog.showMessageBox({
        type: "info",
        title: "WorkBuddy Switch",
        message: "已安装更新版本",
        detail: `应用程序中已安装 ${installed.version}，当前副本为 ${app.getVersion()}。打开已安装的版本即可。`,
        buttons: ["打开已安装版本", "退出"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) {
        const error = await shell.openPath(APPLICATION_PATH);
        if (error)
          throw new Error("无法打开已安装版本，请从应用程序目录打开。");
      }
      return "exit";
    }
    const choice = await dialog.showMessageBox({
      type: "question",
      title: "安装 WorkBuddy Switch",
      message: installed
        ? "安装并替换旧版 WorkBuddy Switch"
        : "安装 WorkBuddy Switch",
      detail: `将安装到「${APPLICATION_PATH}」。运行中的旧版会正常退出；账号、设置和记录保留在原数据目录。`,
      buttons: [installed ? "安装并替换" : "安装到应用程序", "退出"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) return "exit";
    const state = await stop();
    if (state !== "ok")
      throw new Error(
        state === "busy"
          ? "旧版正在执行任务，请停止任务或等任务结束后再安装。"
          : "旧版尚未退出，请正常退出 WorkBuddy Switch 后再安装。",
      );
    const moved = app.moveToApplicationsFolder({
      conflictHandler: (type) => type === "exists",
    });
    if (!moved)
      await dialog.showMessageBox({
        type: "info",
        title: "安装未完成",
        message: "本次未完成安装",
        detail: "可以重新打开安装包，或使用 PKG 覆盖安装到应用程序目录。",
        buttons: ["好"],
      });
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "安装未完成",
      message: "无法完成覆盖安装",
      detail: error.message,
      buttons: ["好"],
    });
  }
  return "exit";
}
export class QuitGate {
  pending = false;
  scheduled = false;
  constructor({ isBusy, onWait, onQuit }) {
    this.isBusy = isBusy;
    this.onWait = onWait;
    this.onQuit = onQuit;
  }
  request(event) {
    if (!this.isBusy()) {
      this.pending = false;
      return true;
    }
    event.preventDefault();
    const first = !this.pending;
    this.pending = true;
    if (first) this.onWait();
    return false;
  }
  changed() {
    if (!this.pending || this.isBusy() || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.pending && !this.isBusy()) this.onQuit();
    });
  }
}
