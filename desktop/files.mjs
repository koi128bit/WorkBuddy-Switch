import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWrite(file, data, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(file),
    `.wb-switch-${randomUUID()}.tmp`,
  );
  try {
    const handle = await fs.open(temporary, "wx", mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    if (process.platform !== "win32") await fs.chmod(file, mode);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readOptional(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readBounded(file, limit = 8 * 1024 * 1024) {
  const info = await fs.stat(file);
  if (!info.isFile() || info.size > limit)
    throw new Error("文件类型或大小不符合要求。");
  return fs.readFile(file, "utf8");
}
