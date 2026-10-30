import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const RELEASE_OWNER = "koi128bit";
export const RELEASE_REPO = "WorkBuddy-Switch";
export const RELEASE_SLUG = `${RELEASE_OWNER}/${RELEASE_REPO}`;
export const RELEASE_API = `https://api.github.com/repos/${RELEASE_SLUG}/releases/latest`;
export const RELEASE_PAGE = `https://github.com/${RELEASE_SLUG}/releases/latest`;
export const RELEASE_DOWNLOAD = `https://github.com/${RELEASE_SLUG}/releases/download`;
export const CHECKSUM_FILE = "SHA256SUMS.txt";

export const updateDefaults = Object.freeze({
  channel: "stable",
  mirror: "auto",
  autoCheck: true,
});

export const updaterDefaults = updateDefaults;

export const mirrors = Object.freeze([
  Object.freeze({ id: "direct", label: "直连 GitHub", prefix: "" }),
  Object.freeze({
    id: "gh-proxy",
    label: "gh-proxy.com（推荐）",
    prefix: "https://gh-proxy.com/",
  }),
  Object.freeze({
    id: "ghproxy",
    label: "ghproxy.net",
    prefix: "https://ghproxy.net/",
  }),
  Object.freeze({ id: "ghfast", label: "ghfast.top", prefix: "https://ghfast.top/" }),
]);

// auto 模式的线路顺序。国内直连 GitHub 通常不可达（实测 75 秒超时），
// 所以镜像排在前面、直连只作最后兜底，避免每次检查都先卡在直连上。
const AUTO_MIRROR_ORDER = Object.freeze(["gh-proxy", "ghproxy", "ghfast", "direct"]);

const MIRROR_ALIASES = Object.freeze({
  "ghproxy-raw": "ghproxy",
  "ghproxy.net": "ghproxy",
  "ghproxy.net/": "ghproxy",
  "gh-proxy.com": "gh-proxy",
  "gh-proxy.com/": "gh-proxy",
  "ghfast.top": "ghfast",
  "ghfast.top/": "ghfast",
  github: "direct",
  official: "direct",
});

const PLATFORM_PRIORITY = Object.freeze({
  darwin: Object.freeze(["pkg", "dmg", "zip"]),
  win32: Object.freeze(["nsis", "portable"]),
  linux: Object.freeze(["appimage", "deb"]),
});

const ARCH_TOKENS = Object.freeze({
  arm64: Object.freeze(["arm64", "aarch64"]),
  x64: Object.freeze(["x64", "x86_64", "amd64"]),
});

const PROGRESS_INTERVAL = 150;
const REQUEST_HEADERS = Object.freeze({
  Accept: "application/vnd.github+json",
  "User-Agent": "WorkBuddy-Switch-Updater",
});

const VERSION_PATTERN =
  /^(?:release[-\s]*)?v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?(?:\+[0-9A-Za-z.]+)?$/i;

function parseVersion(value) {
  if (typeof value !== "string") throw new Error("版本号格式无效。");
  const match = value.trim().match(VERSION_PATTERN);
  if (!match) throw new Error("版本号格式无效。");
  return {
    core: match[1].split(".").map((part) => Number(part)),
    pre: match[2] ? match[2].split(/[.-]/) : [],
  };
}

export function normalizeVersion(value) {
  try {
    const parsed = parseVersion(value);
    const core = parsed.core.join(".");
    return parsed.pre.length ? `${core}-${parsed.pre.join(".")}` : core;
  } catch {
    return "";
  }
}

function comparePreRelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index],
      b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const numericA = /^\d+$/.test(a),
      numericB = /^\d+$/.test(b);
    if (numericA && numericB) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference < 0 ? -1 : 1;
      continue;
    }
    if (numericA !== numericB) return numericA ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a, b) {
  const left = parseVersion(a),
    right = parseVersion(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < length; index += 1) {
    const x = left.core[index] ?? 0,
      y = right.core[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return comparePreRelease(left.pre, right.pre);
}

export function isNewer(remote, local) {
  return compareVersions(remote, local) > 0;
}

function mirrorEntries() {
  return mirrors.filter((entry) => entry.id !== "direct");
}

function autoEntries() {
  return AUTO_MIRROR_ORDER.map((id) => mirrorById(id)).filter(
    (entry) => entry && entry.id !== "direct",
  );
}

export function mirrorOptions() {
  return [
    { id: "auto", label: "自动（优先国内镜像）" },
    ...mirrors.map((entry) => ({ id: entry.id, label: entry.label })),
  ];
}

export function mirrorById(id) {
  const key = typeof id === "string" ? id.trim().toLowerCase() : "";
  if (!key) return null;
  const resolved = MIRROR_ALIASES[key] ?? key;
  return mirrors.find((entry) => entry.id === resolved) ?? null;
}

function unique(values) {
  const seen = new Set(),
    result = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function releaseSources({ mirror = "auto", includePage = true } = {}) {
  const api = resolveDownloadUrl(RELEASE_API, mirror);
  const page = includePage ? resolveDownloadUrl(RELEASE_PAGE, mirror) : [];
  return unique([...api, ...page]);
}

export function resolveDownloadUrl(url, mirror = "auto") {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim()))
    throw new Error("下载地址无效。");
  const direct = url.trim();
  const value = typeof mirror === "string" ? mirror.trim() : "auto";
  if (value === "" || value.toLowerCase() === "auto")
    return unique([
      ...autoEntries().map((entry) => entry.prefix + direct),
      direct,
    ]);
  const known = mirrorById(value);
  if (known) {
    if (known.id === "direct") return [direct];
    const rest = autoEntries()
      .filter((entry) => entry.id !== known.id)
      .map((entry) => entry.prefix + direct);
    return unique([known.prefix + direct, ...rest, direct]);
  }
  const created = value.includes("{url}")
    ? value.split("{url}").join(direct)
    : value + direct;
  return unique([created, direct]);
}

function assetArch(name) {
  for (const [arch, tokens] of Object.entries(ARCH_TOKENS))
    if (tokens.some((token) => name.includes(token))) return arch;
  return "";
}

function classifyAsset(asset) {
  const name = String(asset?.name ?? "").toLowerCase();
  const url = String(asset?.url ?? "");
  if (!name || !/^https?:\/\//i.test(url)) return null;
  const extension = path.extname(name);
  const arch = assetArch(name);
  if (name.includes("-mac-") && [".pkg", ".dmg", ".zip"].includes(extension))
    return {
      platform: "darwin",
      target: extension.slice(1),
      kind: extension === ".pkg" ? "installer" : "archive",
      arch,
    };
  if (name.includes("-windows-") && extension === ".exe") {
    const portable = name.includes("-portable.exe");
    return {
      platform: "win32",
      target: portable ? "portable" : "nsis",
      kind: portable ? "archive" : "installer",
      arch,
    };
  }
  if (name.includes("-linux-") && extension === ".appimage")
    return { platform: "linux", target: "appimage", kind: "appimage", arch };
  if (name.includes("-linux-") && extension === ".deb")
    return { platform: "linux", target: "deb", kind: "deb", arch };
  return null;
}

export function selectAsset(assets, options = {}) {
  const platform = options?.platform;
  const arch = options?.arch ?? "";
  const target = options?.target ?? null;
  if (!Object.hasOwn(PLATFORM_PRIORITY, platform)) return null;
  const priority = PLATFORM_PRIORITY[platform];
  const order = target && priority.includes(target)
    ? [target, ...priority.filter((value) => value !== target)]
    : [...priority];
  const rows = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const info = classifyAsset(asset);
    if (!info || info.platform !== platform) continue;
    if (info.arch && arch && info.arch !== arch) continue;
    rows.push({ asset, info });
  }
  const pick = (matcher) => rows.find((row) => matcher(row.info));
  for (const wanted of order) {
    const row = pick((info) => info.target === wanted && (!arch || info.arch === arch));
    if (row)
      return {
        name: String(row.asset.name),
        url: String(row.asset.url),
        size: Number.isFinite(row.asset.size) ? Number(row.asset.size) : 0,
        target: row.info.target,
        kind: row.info.kind,
        digest: typeof row.asset.digest === "string" ? row.asset.digest : "",
      };
  }
  for (const wanted of order) {
    const row = pick((info) => info.target === wanted && !info.arch);
    if (row)
      return {
        name: String(row.asset.name),
        url: String(row.asset.url),
        size: Number.isFinite(row.asset.size) ? Number(row.asset.size) : 0,
        target: row.info.target,
        kind: row.info.kind,
        digest: typeof row.asset.digest === "string" ? row.asset.digest : "",
      };
  }
  return null;
}

export function parseChecksums(text) {
  const result = new Map();
  if (typeof text !== "string") return result;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const gnu = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (gnu) {
      const name = cleanChecksumName(gnu[2]);
      if (name) result.set(name, gnu[1].toLowerCase());
      continue;
    }
    const bsd = line.match(/^SHA256\s*\((.+)\)\s*=\s*([0-9a-fA-F]{64})$/i);
    if (bsd) {
      const name = cleanChecksumName(bsd[1]);
      if (name) result.set(name, bsd[2].toLowerCase());
    }
  }
  return result;
}

function cleanChecksumName(value) {
  let name = String(value ?? "").trim();
  if (name.startsWith("*")) name = name.slice(1).trim();
  if (name.startsWith("./")) name = name.slice(2).trim();
  return name;
}

export function verifyDownload(bytes, expectedHex) {
  const expected = typeof expectedHex === "string" ? expectedHex.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  let buffer;
  if (Buffer.isBuffer(bytes)) buffer = bytes;
  else if (bytes instanceof Uint8Array) buffer = Buffer.from(bytes);
  else if (bytes instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(bytes));
  else return false;
  return crypto.createHash("sha256").update(buffer).digest("hex") === expected;
}

function abortError() {
  const error = new Error("更新下载已取消。");
  error.name = "AbortError";
  return error;
}

function signalWithTimeout(signal, timeoutMs) {
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  if (!limit) return signal;
  const timer = AbortSignal.timeout(limit);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

// 超时只约束"拿到响应头"这一段；大文件正文不能被整体超时打断。
async function requesting(request, url, options, timeoutMs, signal) {
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  if (!limit) return request(url, { ...options, signal });
  const controller = new AbortController();
  const relay = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw abortError();
    signal.addEventListener("abort", relay, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    return await request(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", relay);
  }
}

function createProgress(onProgress, total) {
  let last = 0;
  return (received, done = false) => {
    if (typeof onProgress !== "function") return;
    const now = Date.now();
    if (!done && now - last < PROGRESS_INTERVAL) return;
    last = now;
    const percent =
      done || !total ? (done ? 100 : 0) : Math.min(100, Math.round((received / total) * 100));
    if (done) onProgress({ received, total, percent: 100, done: true });
    else onProgress({ received, total, percent });
  };
}

export async function downloadFile({
  request,
  url,
  file,
  onProgress,
  signal,
  timeoutMs = 30000,
}) {
  if (typeof request !== "function") throw new Error("缺少网络请求实现。");
  if (typeof file !== "string" || !file.trim()) throw new Error("下载保存路径无效。");
  if (signal?.aborted) throw abortError();
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.part`;
  let response;
  try {
    response = await requesting(
      request,
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": REQUEST_HEADERS["User-Agent"] },
      },
      timeoutMs,
      signal,
    );
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw new Error("无法连接更新服务器，请检查网络或在设置中切换更新线路。");
  }
  if (!response || !response.ok)
    throw new Error("下载安装包失败：HTTP " + (response?.status ?? 0));
  const total = Number(response.headers?.get?.("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const report = createProgress(onProgress, total);
  let received = 0;
  const reader = response.body?.getReader?.();
  const handle = await fs.open(temporary, "w", 0o600);
  try {
    if (reader) {
      for (;;) {
        if (signal?.aborted) throw abortError();
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (signal?.aborted) throw abortError();
          throw new Error("下载安装包失败：连接意外中断。");
        }
        if (chunk.done) break;
        const value = chunk.value;
        if (!value || !value.byteLength) continue;
        const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        hash.update(buffer);
        received += buffer.byteLength;
        await handle.write(buffer);
        report(received);
      }
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (signal?.aborted && error?.name !== "AbortError") throw abortError();
    throw error;
  }
  await handle.close();
  await fs.rename(temporary, target);
  report(received, true);
  return { file: target, size: received, sha256: hash.digest("hex") };
}

export async function downloadAsset({
  request,
  asset,
  directory,
  fileName,
  onProgress,
  signal,
}) {
  if (!asset || typeof asset.url !== "string" || !asset.url)
    throw new Error("更新资产信息无效。");
  if (typeof directory !== "string" || !directory.trim())
    throw new Error("缺少下载目录。");
  const name = typeof fileName === "string" && fileName.trim() ? fileName.trim() : asset.name;
  if (!name) throw new Error("更新资产信息无效。");
  const result = await downloadFile({
    request,
    url: asset.url,
    file: path.join(directory, name),
    onProgress,
    signal,
  });
  const digest = typeof asset.digest === "string" ? asset.digest.trim().toLowerCase() : "";
  const expected = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  if (/^[0-9a-f]{64}$/.test(expected) && expected !== result.sha256) {
    await fs.rm(result.file, { force: true }).catch(() => {});
    throw new Error("安装包校验失败，文件可能不完整，请重试。");
  }
  return { path: result.file, size: result.size, sha256: result.sha256 };
}

function releaseAsset(data, source) {
  const rawTag = String(data?.tag_name ?? "");
  const version = normalizeVersion(rawTag);
  if (!version) throw new Error("更新接口未返回有效版本号。");
  const assets = (Array.isArray(data?.assets) ? data.assets : [])
    .map((asset) => ({
      name: String(asset?.name ?? ""),
      url: String(asset?.browser_download_url ?? asset?.url ?? ""),
      size: Number.isFinite(asset?.size) ? Number(asset.size) : 0,
      contentType: String(asset?.content_type ?? ""),
      digest: String(asset?.digest ?? ""),
    }))
    .filter((asset) => asset.name && /^https?:\/\//i.test(asset.url));
  return {
    version,
    tag: rawTag || `v${version}`,
    name: String(data?.name ?? ""),
    notes: String(data?.body ?? ""),
    htmlUrl: String(data?.html_url ?? ""),
    publishedAt: String(data?.published_at ?? ""),
    assets,
    source,
  };
}

export function candidateAssetNames(version) {
  const prefix = `WorkBuddy-Switch-${version}`;
  return [
    `${prefix}-mac-arm64.pkg`,
    `${prefix}-mac-x64.pkg`,
    `${prefix}-mac-arm64.dmg`,
    `${prefix}-mac-x64.dmg`,
    `${prefix}-mac-arm64.zip`,
    `${prefix}-mac-x64.zip`,
    `${prefix}-windows-x64-setup.exe`,
    `${prefix}-windows-x64-portable.exe`,
    `${prefix}-linux-x86_64.AppImage`,
    `${prefix}-linux-arm64.AppImage`,
    `${prefix}-linux-amd64.deb`,
    `${prefix}-linux-arm64.deb`,
    CHECKSUM_FILE,
  ];
}

function releaseFromRedirect(response, source) {
  const location = String(response?.headers?.get?.("location") ?? "");
  const match = location.match(/\/tag\/([^/?#]+)/);
  if (!match) throw new Error("更新页面未返回版本跳转地址。");
  const tag = decodeURIComponent(match[1]);
  const version = normalizeVersion(tag);
  if (!version) throw new Error("更新页面未返回有效版本号。");
  return {
    version,
    tag,
    name: `WorkBuddy Switch ${tag}`,
    notes: "",
    htmlUrl: `https://github.com/${RELEASE_SLUG}/releases/tag/${encodeURIComponent(tag)}`,
    publishedAt: "",
    assets: candidateAssetNames(version).map((name) => ({
      name,
      url: `${RELEASE_DOWNLOAD}/${tag}/${name}`,
      size: 0,
      contentType: "",
      digest: "",
    })),
    source,
  };
}

function isApiSource(url) {
  return url.includes("api.github.com");
}

export async function fetchRelease({
  request,
  sources,
  currentVersion = "",
  signal,
  timeoutMs = 12000,
} = {}) {
  if (typeof request !== "function") throw new Error("缺少网络请求实现。");
  const list = unique(
    Array.isArray(sources) && sources.length ? sources : releaseSources(),
  );
  const causes = [];
  for (const source of list) {
    try {
      if (isApiSource(source)) {
        const response = await request(source, {
          method: "GET",
          redirect: "follow",
          headers: REQUEST_HEADERS,
          signal: signalWithTimeout(signal, timeoutMs),
        });
        if (!response || !response.ok)
          throw new Error(
            "更新服务暂不可用（HTTP " + (response?.status ?? 0) + "）。",
          );
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error("更新接口返回的内容无法解析。");
        }
        return releaseAsset(data, source);
      }
      const response = await request(source, {
        method: "GET",
        redirect: "manual",
        headers: { ...REQUEST_HEADERS, Accept: "text/html" },
        signal: signalWithTimeout(signal, timeoutMs),
      });
      if (!response) throw new Error("更新页面无响应。");
      if (response.status === 404)
        throw new Error("更新服务暂不可用（HTTP 404）。");
      if (response.status >= 400)
        throw new Error("更新服务暂不可用（HTTP " + response.status + "）。");
      return releaseFromRedirect(response, source);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      causes.push({
        source,
        message:
          typeof error?.message === "string" && error.message
            ? error.message
            : "请求更新服务器失败。",
      });
    }
  }
  const failure = new Error(
    "无法连接更新服务器，请检查网络或在设置中切换更新线路。",
  );
  failure.causes = causes;
  if (currentVersion) failure.currentVersion = String(currentVersion);
  throw failure;
}

export async function fetchLatestRelease({
  request,
  mirror = "auto",
  timeoutMs = 12000,
} = {}) {
  const release = await fetchRelease({
    request,
    sources: releaseSources({ mirror }),
    timeoutMs,
  });
  return {
    version: release.version,
    tag: release.tag,
    name: release.name,
    notes: release.notes,
    publishedAt: release.publishedAt,
    assets: release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      url: asset.url,
      digest: asset.digest,
    })),
    source: release.source,
  };
}

async function fetchText({ request, urls, signal, timeoutMs }) {
  const causes = [];
  for (const url of urls) {
    try {
      const response = await request(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": REQUEST_HEADERS["User-Agent"] },
        signal: signalWithTimeout(signal, timeoutMs),
      });
      if (!response || !response.ok) {
        causes.push({
          source: url,
          message: "校验文件不可用（HTTP " + (response?.status ?? 0) + "）。",
        });
        continue;
      }
      return await response.text();
    } catch (error) {
      causes.push({
        source: url,
        message: error?.message ?? "校验文件下载失败。",
      });
    }
  }
  const failure = new Error("校验文件下载失败，已跳过完整性校验。");
  failure.causes = causes;
  throw failure;
}

function checksumSource(release, asset) {
  const declared = (Array.isArray(release?.assets) ? release.assets : []).find(
    (entry) => String(entry?.name ?? "").toLowerCase() === CHECKSUM_FILE.toLowerCase(),
  );
  if (declared && typeof declared.url === "string" && declared.url) return declared.url;
  const tag = typeof release?.tag === "string" && release.tag ? release.tag : "";
  const base = typeof asset?.url === "string" ? asset.url.replace(/[^/]*$/, "") : "";
  if (tag && RELEASE_DOWNLOAD) {
    const standard = `${RELEASE_DOWNLOAD}/${tag}/${CHECKSUM_FILE}`;
    if (!base || base.includes(`/releases/download/${tag}/`)) return standard;
  }
  return base ? base + CHECKSUM_FILE : "";
}

export async function downloadUpdate({
  request,
  release,
  target,
  mirror = "auto",
  directory,
  onProgress,
  signal,
  timeoutMs = 30000,
}) {
  if (!release || !Array.isArray(release.assets))
    throw new Error("更新版本信息无效。");
  if (typeof directory !== "string" || !directory.trim())
    throw new Error("缺少下载目录。");
  const asset = selectAsset(release.assets, target ?? {});
  if (!asset) throw new Error("未找到适用于当前系统的安装包。");
  const file = path.join(directory, asset.name);
  const causes = [];
  let downloaded = null;
  for (const url of resolveDownloadUrl(asset.url, mirror)) {
    try {
      downloaded = await downloadFile({
        request,
        url,
        file,
        onProgress,
        signal,
        timeoutMs,
      });
      break;
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted)
        throw error?.name === "AbortError" ? error : abortError();
      causes.push({ source: url, message: error?.message ?? "下载失败。" });
    }
  }
  if (!downloaded) {
    const failure = new Error(
      causes.length ? causes[causes.length - 1].message : "下载安装包失败。",
    );
    failure.causes = causes;
    throw failure;
  }
  const source = checksumSource(release, asset);
  let verified = false;
  if (source) {
    let text = "";
    try {
      text = await fetchText({
        request,
        urls: resolveDownloadUrl(source, mirror),
        signal,
        timeoutMs,
      });
    } catch {
      text = "";
    }
    const expected = text ? parseChecksums(text).get(asset.name) : undefined;
    if (expected && expected !== downloaded.sha256) {
      await fs.rm(downloaded.file, { force: true }).catch(() => {});
      throw new Error("安装包校验失败，文件可能不完整，请重试。");
    }
    verified = Boolean(expected && expected === downloaded.sha256);
  }
  return {
    file: downloaded.file,
    name: asset.name,
    size: downloaded.size,
    sha256: downloaded.sha256,
    verified,
  };
}

export function installationPlan({ platform, asset, downloadPath } = {}) {
  const target = typeof asset?.target === "string" ? asset.target : "";
  const file = typeof downloadPath === "string" ? downloadPath : "";
  if (!file) throw new Error("缺少安装包路径。");
  if (platform === "darwin") {
    if (target === "pkg")
      return {
        kind: "mac-pkg",
        command: "/usr/sbin/installer",
        args: ["-pkg", file, "-target", "/"],
        privileged: true,
      };
    if (target === "dmg") return { kind: "mac-dmg", mount: true, file };
    if (target === "zip") return { kind: "mac-zip", file };
  }
  if (platform === "win32") {
    if (target === "nsis" || target === "portable")
      return { kind: "win-nsis", command: file, args: ["/S"], privileged: false };
    if (target === "dmg") return { kind: "mac-dmg", mount: true, file };
  }
  if (platform === "linux") {
    if (target === "appimage")
      return { kind: "linux-appimage", file, executable: true };
    if (target === "deb")
      return {
        kind: "linux-deb",
        command: "/usr/bin/apt-get",
        args: ["install", "-y", file],
        privileged: true,
      };
  }
  throw new Error("当前平台暂不支持自动安装，请手动打开安装包。");
}

export function planInstall({ platform, file, currentExecutable } = {}) {
  if (typeof file !== "string" || !file)
    throw new Error("缺少安装包路径。");
  const extension = path.extname(file).toLowerCase();
  if (platform === "darwin") {
    if (extension === ".pkg")
      return [{ kind: "open", target: file, hint: "安装器会请求管理员授权" }];
    if (extension === ".dmg" || extension === ".zip")
      return [{ kind: "open", target: file }];
  }
  if (platform === "win32") {
    if (extension === ".exe") return [{ kind: "spawn", command: file, args: ["/S"] }];
  }
  if (platform === "linux") {
    if (extension === ".appimage") {
      if (typeof currentExecutable !== "string" || !currentExecutable)
        throw new Error("未找到当前应用路径，请手动替换 AppImage。");
      return [{ kind: "replace", file, target: currentExecutable }];
    }
    if (extension === ".deb")
      return [{ kind: "spawn", command: "pkexec", args: ["dpkg", "-i", file] }];
  }
  throw new Error("当前平台暂不支持自动安装，请手动打开安装包。");
}

export function restartPlan({ platform, appPath } = {}) {
  if (typeof appPath !== "string" || !appPath)
    throw new Error("缺少应用路径，请手动重新打开应用。");
  if (platform === "darwin")
    return {
      kind: "mac-open",
      command: "/usr/bin/open",
      args: ["-n", appPath],
      detached: true,
      privileged: false,
    };
  if (platform === "win32")
    return {
      kind: "win-start",
      command: appPath,
      args: [],
      detached: true,
      privileged: false,
    };
  if (platform === "linux")
    return {
      kind: "linux-start",
      command: appPath,
      args: [],
      detached: true,
      privileged: false,
    };
  throw new Error("当前平台暂不支持自动重启。");
}

export async function checkForUpdate({
  request,
  sources,
  currentVersion,
  platform,
  arch,
  signal,
  timeoutMs = 12000,
} = {}) {
  const release = await fetchRelease({
    request,
    sources,
    currentVersion,
    signal,
    timeoutMs,
  });
  const available = currentVersion ? isNewer(release.version, currentVersion) : true;
  const asset = selectAsset(release.assets, { platform, arch });
  return {
    available,
    version: release.version,
    tag: release.tag,
    notes: release.notes,
    htmlUrl: release.htmlUrl,
    asset,
    source: release.source,
  };
}
