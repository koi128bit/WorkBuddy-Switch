import fs from "node:fs/promises";
import path from "node:path";
import { configRoot } from "./platform.mjs";
import { atomicWrite } from "./files.mjs";
export async function setLinuxAutostart(enabled, executable, context = {}) {
  const file = path.join(
    configRoot({ ...context, platform: "linux" }),
    "autostart",
    "com.koi128bit.workbuddy-switch.desktop",
  );
  if (!enabled) {
    await fs.rm(file, { force: true });
    return file;
  }
  if (
    typeof executable !== "string" ||
    !path.isAbsolute(executable) ||
    /[\r\n\x00]/.test(executable)
  )
    throw new Error("开机启动程序路径无效。");
  const quoted = executable.replace(/[\\"`$]/g, "\\$&");
  await atomicWrite(
    file,
    `[Desktop Entry]\nType=Application\nVersion=1.0\nName=WorkBuddy Switch\nExec="${quoted}"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
  );
  return file;
}
