import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicWrite } from "./files.mjs";
import { editorDefinition } from "./editor-controller.mjs";

const limit = 4 * 1024 * 1024;
const traeKeys = Object.freeze([
  "iCubeAuthInfo://icube.cloudide",
  "iCubeAuthInfo://usertag",
  "iCubeServerData://icube.cloudide",
  "iCubeEntitlementInfo://icube.cloudide",
]);
const qoderFiles = Object.freeze([
  "auth.v1.dat",
  "auth-profile-overlays.v1.dat",
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function authFingerprint(document) {
  return hash(
    JSON.stringify([document.provider, document.entries, document.binding]),
  );
}
export function validateEditorDirectory(provider, directory) {
  const expected = editorDefinition(provider).data;
  if (
    path.basename(path.resolve(directory)).toLowerCase() !==
    expected.toLowerCase()
  )
    throw new Error(
      `请选择 ${editorDefinition(provider).name} 的数据根目录 ${expected}，不可混用地区或其他客户端目录。`,
    );
}
async function read(file, directory) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
      throw new Error("登录文件类型或大小无法识别，已停止读取。");
    const root = await fs.realpath(directory),
      resolved = await fs.realpath(file);
    if (
      path.basename(root).toLowerCase() !==
        path.basename(directory).toLowerCase() ||
      !resolved.startsWith(root + path.sep)
    )
      throw new Error("登录路径指向其他目录，已停止读取。");
    return await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function storage(directory) {
  const file = path.join(directory, "User", "globalStorage", "storage.json");
  const raw = await read(file, directory);
  if (!raw) return { file, root: {} };
  try {
    const root = JSON.parse(raw.toString("utf8"));
    if (!root || typeof root !== "object" || Array.isArray(root))
      throw new Error("invalid");
    return { file, root };
  } catch {
    throw new Error("Trae CN 设置文件格式无法识别，未修改文件。");
  }
}
function loggedIn(entries) {
  const value = entries[traeKeys[0]];
  if (typeof value === "string")
    return (
      value.trim().length > 20 && !["null", "undefined"].includes(value.trim())
    );
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.token === "string" &&
    value.token.length > 0
  );
}
async function qoderBinding(directory, platform) {
  if (platform !== "win32")
    return hash(
      Buffer.concat([
        Buffer.from(
          platform === "linux"
            ? "linux-keyring-local:"
            : "macos-keychain-local:",
        ),
        (await read(path.join(directory, "auth.machine-id"), directory)) ||
          Buffer.alloc(0),
      ]),
    );
  const raw = await read(path.join(directory, "Local State"), directory);
  try {
    const key = raw && JSON.parse(raw.toString("utf8")).os_crypt?.encrypted_key;
    if (typeof key !== "string" || !key) throw new Error("missing");
    return hash(key);
  } catch {
    throw new Error("无法确认 Qoder CN 的本机加密绑定，请先登录一次客户端。");
  }
}
export function validateEditorAuth(document, provider) {
  editorDefinition(provider);
  if (
    !document ||
    document.version !== 1 ||
    document.provider !== provider ||
    !document.entries ||
    typeof document.entries !== "object" ||
    Array.isArray(document.entries) ||
    typeof document.binding !== "string"
  )
    throw new Error("登录快照格式或客户端标识无效。");
  const trae = editorDefinition(provider).product === "trae";
  const allowed = trae ? traeKeys : qoderFiles;
  if (
    document.binding.length > 100 ||
    allowed.some((key) => !Object.hasOwn(document.entries, key))
  )
    throw new Error("登录快照字段不完整。");
  for (const [key, value] of Object.entries(document.entries)) {
    if (
      !allowed.includes(key) ||
      (value !== null &&
        typeof value !== "string" &&
        (!trae || typeof value !== "object" || Array.isArray(value)))
    )
      throw new Error("登录快照包含不支持的字段。");
    if (JSON.stringify(value).length > limit) throw new Error("登录快照过大。");
  }
  if (!trae)
    for (const [key, value] of Object.entries(document.entries)) {
      if (value === null) continue;
      const bytes = Buffer.from(value, "base64");
      if (
        key === "auth.v1.dat" &&
        (bytes.length < 19 ||
          !["v10", "v11"].includes(bytes.toString("ascii", 0, 3)))
      )
        throw new Error("Qoder CN 登录文件的加密格式暂不支持，未修改文件。");
    }
  return document;
}
export function hasEditorLogin(document) {
  return editorDefinition(document.provider).product === "trae"
    ? loggedIn(document.entries)
    : !!document.entries["auth.v1.dat"];
}
export async function readEditorAuth(
  provider,
  directory,
  { platform = process.platform } = {},
) {
  validateEditorDirectory(provider, directory);
  const entries = {};
  let binding = `${provider}-local`;
  if (editorDefinition(provider).product === "trae") {
    const { root } = await storage(directory);
    for (const key of traeKeys)
      entries[key] = Object.hasOwn(root, key) ? root[key] : null;
  } else {
    for (const name of qoderFiles)
      entries[name] =
        (await read(path.join(directory, name), directory))?.toString(
          "base64",
        ) ?? null;
    if (entries["auth.v1.dat"]) {
      const bytes = Buffer.from(entries["auth.v1.dat"], "base64"),
        length = bytes.length;
      if (platform !== "linux" && bytes.toString("ascii", 0, 3) !== "v10")
        throw new Error("客户端加密格式与当前系统不符。");
      if (platform === "win32" ? length < 31 : (length - 3) % 16 !== 0)
        throw new Error("Qoder CN 登录文件不完整，请退出客户端后重新保存。");
    }
    if (entries["auth.v1.dat"])
      binding = await qoderBinding(directory, platform);
    else binding = "no-login";
  }
  return validateEditorAuth(
    { version: 1, provider, entries, binding },
    provider,
  );
}
export async function readStableEditorAuth(provider, directory, context) {
  const first = await readEditorAuth(provider, directory, context);
  const second = await readEditorAuth(provider, directory, context);
  if (authFingerprint(first) !== authFingerprint(second))
    throw new Error("客户端正在刷新登录信息，请稍后重新保存。");
  return second;
}
export async function writeEditorAuth(
  provider,
  directory,
  document,
  { platform = process.platform } = {},
) {
  validateEditorDirectory(provider, directory);
  validateEditorAuth(document, provider);
  const resolvedRoot = await fs.realpath(directory);
  if (
    path.basename(resolvedRoot).toLowerCase() !==
    editorDefinition(provider).data.toLowerCase()
  )
    throw new Error("国内版数据根目录指向其他客户端，已停止写入。");
  if (editorDefinition(provider).product === "trae") {
    const { file, root } = await storage(directory);
    const resolvedParent = await fs.realpath(path.dirname(file));
    if (!resolvedParent.startsWith(resolvedRoot + path.sep))
      throw new Error("登录文件目录指向客户端之外，已停止写入。");
    for (const key of traeKeys) {
      if (document.entries[key] === null || document.entries[key] === undefined)
        delete root[key];
      else root[key] = document.entries[key];
    }
    await atomicWrite(file, JSON.stringify(root, null, 2));
    return;
  }
  if (
    hasEditorLogin(document) &&
    document.binding !== (await qoderBinding(directory, platform))
  )
    throw new Error("Qoder CN 本机加密绑定已变化，请重新登录并保存快照。");
  for (const name of qoderFiles) {
    const value = document.entries[name];
    if (value === null || value === undefined)
      await fs.rm(path.join(directory, name), { force: true });
    else
      await atomicWrite(
        path.join(directory, name),
        Buffer.from(value, "base64"),
      );
  }
}
