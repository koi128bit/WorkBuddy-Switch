import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
// Resolve the kernel's executable path; command text alone can match an IDE,
// a wrapper, or another application's arguments.
export async function linuxProcesses(names) {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,comm=,args="], {
    timeout: 8000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return (
    await Promise.all(
      stdout.split("\n").map(async (line) => {
        const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
        if (!match) return null;
        const pid = Number(match[1]),
          command = match[3];
        let executable = "";
        try {
          executable = (await fs.readlink(`/proc/${pid}/exe`)).replace(
            / \(deleted\)$/,
            "",
          );
        } catch (error) {
          if (
            error.code !== "ENOENT" &&
            names.some((name) => match[2] === name.slice(0, 15))
          )
            throw new Error("无法读取客户端进程路径，请检查系统权限。");
        }
        return { pid, command, executable };
      }),
    )
  ).filter(Boolean);
}
export function sameLinuxExecutable(item, executable) {
  return item.executable === executable;
}
export async function linuxExecutable(file) {
  const resolved = await fs.realpath(file),
    stat = await fs.stat(resolved);
  if (!stat.isFile() || (stat.mode & 0o111) === 0)
    throw new Error("请选择具有执行权限的客户端主程序。");
  return resolved;
}
