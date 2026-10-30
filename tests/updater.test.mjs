import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  CHECKSUM_FILE,
  RELEASE_API,
  RELEASE_DOWNLOAD,
  RELEASE_PAGE,
  RELEASE_SLUG,
  checkForUpdate,
  compareVersions,
  downloadFile,
  downloadUpdate,
  fetchLatestRelease,
  fetchRelease,
  installationPlan,
  isNewer,
  mirrorById,
  mirrors,
  normalizeVersion,
  parseChecksums,
  planInstall,
  releaseSources,
  resolveDownloadUrl,
  restartPlan,
  selectAsset,
  updateDefaults,
  updaterDefaults,
  verifyDownload,
} from "../desktop/updater.mjs";

const ASSET_NAMES = (version) => {
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
  ];
};

const DOWNLOAD_BASE = "https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v2.0.0";

function assetsFor(version = "2.0.0", base = DOWNLOAD_BASE) {
  return ASSET_NAMES(version).map((name) => ({
    name,
    size: 1024,
    url: `${base}/${name}`,
  }));
}

function headerBag(headers = {}) {
  const table = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  return { get: (name) => table.get(String(name).toLowerCase()) ?? null };
}

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function bytesResponse(chunks, { status = 200, headers = {} } = {}) {
  const bytes = chunks.map((chunk) => Buffer.from(chunk));
  const total = bytes.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = Buffer.concat(bytes);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerBag({ "content-length": String(total), ...headers }),
    body: streamOf(bytes.map((chunk) => new Uint8Array(chunk))),
    async text() {
      return merged.toString("utf8");
    },
    async json() {
      return JSON.parse(merged.toString("utf8"));
    },
  };
}

function jsonResponse(value, status = 200) {
  return bytesResponse([Buffer.from(JSON.stringify(value), "utf8")], {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(value, status = 200) {
  return bytesResponse([Buffer.from(String(value), "utf8")], { status });
}

function redirectResponse(location, status = 302) {
  return {
    ok: false,
    status,
    headers: headerBag({ location }),
    body: null,
    async text() {
      return "";
    },
    async json() {
      throw new Error("不是 JSON 响应。");
    },
  };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workbuddy-updater-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("版本默认值与镜像目录保持稳定", () => {
  assert.equal(updaterDefaults, updateDefaults);
  assert.ok(Object.isFrozen(updaterDefaults));
  assert.equal(updaterDefaults.mirror, "auto");
  assert.equal(updaterDefaults.channel, "stable");
  assert.equal(RELEASE_SLUG, "koi128bit/WorkBuddy-Switch");
  assert.equal(RELEASE_API, "https://api.github.com/repos/koi128bit/WorkBuddy-Switch/releases/latest");
  assert.equal(RELEASE_PAGE, "https://github.com/koi128bit/WorkBuddy-Switch/releases/latest");
  assert.equal(CHECKSUM_FILE, "SHA256SUMS.txt");

  const direct = mirrors.find((entry) => entry.id === "direct");
  assert.equal(direct.prefix, "", "直连镜像的前缀必须是空串");
  const ghproxy = mirrors.find((entry) => entry.id === "ghproxy");
  assert.equal(ghproxy.prefix, "https://ghproxy.net/");
  assert.ok(ghproxy.label.length > 0);
  const ids = mirrors.map((entry) => entry.id);
  assert.deepEqual(ids, ["direct", "gh-proxy", "ghproxy", "ghfast"]);
  assert.deepEqual(mirrors.map((entry) => typeof mirrorById(entry.id)), [
    "object",
    "object",
    "object",
    "object",
  ]);
});

test("normalizeVersion 接受 v 前缀、release 前缀与纯数字", () => {
  assert.equal(normalizeVersion("v2.0.0"), "2.0.0");
  assert.equal(normalizeVersion("2.0.0"), "2.0.0");
  assert.equal(normalizeVersion("release 2.0.0"), "2.0.0");
  assert.equal(normalizeVersion("release-v1.9.9"), "1.9.9");
  assert.equal(normalizeVersion("  v1.10.0  "), "1.10.0");
  assert.equal(normalizeVersion("v2.0.0-beta.1"), "2.0.0-beta.1");
  assert.equal(normalizeVersion(""), "");
  assert.equal(normalizeVersion("latest"), "");
  assert.equal(normalizeVersion(undefined), "");
  assert.equal(normalizeVersion(2), "");
});

test("compareVersions 按数字分段比较并处理预发布后缀", () => {
  assert.equal(compareVersions("1.9.9", "1.10.0"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("2.0.0", "v2.0.0"), 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0-beta.1"), 0);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.throws(() => compareVersions("abc", "1.0.0"), /版本号格式无效。/);
  assert.throws(() => compareVersions("1.0.0", ""), /版本号格式无效。/);
  assert.equal(isNewer("1.10.0", "1.9.9"), true);
  assert.equal(isNewer("1.9.9", "1.9.9"), false);
  assert.equal(isNewer("1.0.0-beta.1", "1.0.0"), false);
});

test("resolveDownloadUrl 覆盖 auto（镜像优先）、指定镜像与自定义模板", () => {
  const url = "https://github.com/koi128bit/WorkBuddy-Switch/releases/download/v2.0.0/x.pkg";
  const auto = resolveDownloadUrl(url, "auto");
  assert.equal(auto[0], `https://gh-proxy.com/${url}`, "auto 必须优先国内可用镜像");
  assert.ok(auto.includes(`https://ghproxy.net/${url}`));
  assert.ok(auto.includes(`https://ghfast.top/${url}`));
  assert.equal(auto[auto.length - 1], url, "直连只作最后兜底");

  const gh = resolveDownloadUrl(url, "ghproxy");
  assert.equal(gh[0], `https://ghproxy.net/${url}`);
  assert.equal(gh[gh.length - 1], url, "指定镜像后仍保留直连兜底");
  assert.ok(gh.includes(`https://gh-proxy.com/${url}`), "其余镜像继续兜底");

  const custom = resolveDownloadUrl(url, "https://mirror.example/{url}");
  assert.equal(custom[0], `https://mirror.example/${url}`);
  assert.equal(custom[1], url);

  const prefixTemplate = resolveDownloadUrl(url, "https://mirror.example/");
  assert.equal(prefixTemplate[0], `https://mirror.example/${url}`);
  assert.equal(new Set(auto).size, auto.length, "候选地址不应重复");
  assert.throws(() => resolveDownloadUrl("not-a-url"), /下载地址无效。/);
});

test("releaseSources 按 mirror 展开 API 与页面两类探测源", () => {
  const auto = releaseSources();
  assert.equal(auto[0], `https://gh-proxy.com/${RELEASE_API}`);
  assert.ok(auto.includes(`https://gh-proxy.com/${RELEASE_PAGE}`));
  assert.ok(auto.includes(RELEASE_API), "直连源仍在候选里");
  const gh = releaseSources({ mirror: "ghproxy" });
  assert.equal(gh[0], `https://ghproxy.net/${RELEASE_API}`);
  assert.ok(gh.includes(`https://ghproxy.net/${RELEASE_PAGE}`));
  const direct = releaseSources({ mirror: "direct", includePage: false });
  assert.deepEqual(direct, [RELEASE_API]);
});

test("selectAsset 在三个平台按 arch 选出正确产物且优先安装包", () => {
  const assets = assetsFor();

  const macArm = selectAsset(assets, { platform: "darwin", arch: "arm64" });
  assert.equal(macArm.name, "WorkBuddy-Switch-2.0.0-mac-arm64.pkg");
  assert.equal(macArm.target, "pkg");
  assert.equal(macArm.kind, "installer");
  const macX64 = selectAsset(assets, { platform: "darwin", arch: "x64" });
  assert.equal(macX64.name, "WorkBuddy-Switch-2.0.0-mac-x64.pkg");

  const win = selectAsset(assets, { platform: "win32", arch: "x64" });
  assert.equal(win.name, "WorkBuddy-Switch-2.0.0-windows-x64-setup.exe");
  assert.equal(win.target, "nsis");
  assert.ok(!win.name.includes("portable"), "存在 setup 时绝不选 portable");

  const linuxX64 = selectAsset(assets, { platform: "linux", arch: "x64" });
  assert.equal(linuxX64.name, "WorkBuddy-Switch-2.0.0-linux-x86_64.AppImage");
  assert.equal(linuxX64.kind, "appimage");
  const linuxArm = selectAsset(assets, { platform: "linux", arch: "arm64" });
  assert.equal(linuxArm.name, "WorkBuddy-Switch-2.0.0-linux-arm64.AppImage");

  // 缺 pkg 回退 dmg，缺 setup 回退 portable，缺 AppImage 回退 deb
  const withoutPkg = assets.filter((asset) => !asset.name.endsWith(".pkg"));
  assert.equal(
    selectAsset(withoutPkg, { platform: "darwin", arch: "arm64" }).name,
    "WorkBuddy-Switch-2.0.0-mac-arm64.dmg",
  );
  const withoutArchive = assets.filter(
    (asset) => !asset.name.endsWith(".dmg") && !asset.name.endsWith(".pkg"),
  );
  assert.equal(
    selectAsset(withoutArchive, { platform: "darwin", arch: "x64" }).name,
    "WorkBuddy-Switch-2.0.0-mac-x64.zip",
  );
  const withoutSetup = assets.filter((asset) => !asset.name.includes("-setup.exe"));
  const portableFallback = selectAsset(withoutSetup, { platform: "win32", arch: "x64" });
  assert.equal(portableFallback.name, "WorkBuddy-Switch-2.0.0-windows-x64-portable.exe");
  assert.equal(portableFallback.target, "portable");

  const withoutAppImage = assets.filter((asset) => !asset.name.endsWith(".AppImage"));
  const debX64 = selectAsset(withoutAppImage, { platform: "linux", arch: "x64" });
  assert.equal(debX64.name, "WorkBuddy-Switch-2.0.0-linux-amd64.deb", "x64 要匹配 deb 的 amd64 命名");
  assert.equal(debX64.kind, "deb");
  const debArm = selectAsset(withoutAppImage, { platform: "linux", arch: "arm64" });
  assert.equal(debArm.name, "WorkBuddy-Switch-2.0.0-linux-arm64.deb");

  // 显式 target 会提到最前
  const forced = selectAsset(assets, { platform: "darwin", arch: "arm64", target: "zip" });
  assert.equal(forced.name, "WorkBuddy-Switch-2.0.0-mac-arm64.zip");

  assert.equal(selectAsset([], { platform: "darwin", arch: "arm64" }), null);
  assert.equal(selectAsset(assets, { platform: "solaris", arch: "x64" }), null);
  assert.equal(selectAsset(assets.filter((a) => !a.name.includes("arm64")), { platform: "darwin", arch: "arm64" }), null);
  assert.equal(selectAsset([{ name: "SHA256SUMS.txt", url: "https://x/SHA256SUMS.txt" }], { platform: "linux", arch: "x64" }), null);
});

test("parseChecksums 解析 GNU 行、星号前缀并与非法行绝缘", () => {
  const hex = "a".repeat(64);
  const other = "b".repeat(64);
  const text = [
    "# 这是注释",
    `${hex}  WorkBuddy-Switch-2.0.0-mac-arm64.pkg`,
    `${other} *WorkBuddy-Switch-2.0.0-windows-x64-setup.exe`,
    `${hex}  ./WorkBuddy-Switch-2.0.0-linux-amd64.deb`,
    "",
    "这一行是垃圾",
    `${"z".repeat(64)}  bad.pkg`,
    "0123  short.pkg",
  ].join("\r\n");
  const map = parseChecksums(text);
  assert.equal(map.size, 3);
  assert.equal(map.get("WorkBuddy-Switch-2.0.0-mac-arm64.pkg"), hex);
  assert.equal(map.get("WorkBuddy-Switch-2.0.0-windows-x64-setup.exe"), other);
  assert.equal(map.get("WorkBuddy-Switch-2.0.0-linux-amd64.deb"), hex);
  assert.equal(map.get("bad.pkg"), undefined);
  assert.equal(parseChecksums(undefined).size, 0);
  assert.equal(parseChecksums("").size, 0);
});

test("verifyDownload 比对 sha256", () => {
  const bytes = Buffer.from("workbuddy");
  const hex = sha256(bytes);
  assert.equal(verifyDownload(bytes, hex), true);
  assert.equal(verifyDownload(bytes, hex.toUpperCase()), true);
  assert.equal(verifyDownload(bytes, "0".repeat(64)), false);
  assert.equal(verifyDownload(bytes, ""), false);
  assert.equal(verifyDownload("not-bytes", hex), false);
  assert.equal(verifyDownload(new Uint8Array(bytes), hex), true);
  assert.equal(verifyDownload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), hex), true);
});

test("fetchLatestRelease 从 API 源拿到完整版本信息", async () => {
  const payload = {
    tag_name: "v2.0.0",
    name: "WorkBuddy Switch 2.0.0",
    body: "更新说明",
    published_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v2.0.0",
    assets: assetsFor().map((asset, index) => ({
      name: asset.name,
      size: 2048 + index,
      browser_download_url: asset.url,
      digest: index === 0 ? `sha256:${"c".repeat(64)}` : "",
    })),
  };
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    assert.equal(url, RELEASE_API);
    return jsonResponse(payload);
  };
  const release = await fetchLatestRelease({ request, mirror: "direct" });
  assert.equal(calls.length, 1);
  assert.equal(release.version, "2.0.0");
  assert.equal(release.tag, "v2.0.0");
  assert.equal(release.name, "WorkBuddy Switch 2.0.0");
  assert.equal(release.notes, "更新说明");
  assert.equal(release.publishedAt, "2026-01-01T00:00:00Z");
  assert.equal(release.source, RELEASE_API);
  assert.equal(release.assets.length, 12);
  assert.equal(release.assets[0].digest, `sha256:${"c".repeat(64)}`);
  assert.ok(release.assets.every((asset) => asset.size > 0));
});

test("fetchLatestRelease 在 API 源失败后回退到重定向探测", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push(url);
    if (url.includes("api.github.com")) throw new Error("connect ETIMEDOUT");
    assert.equal(options?.redirect, "manual", "重定向探测不应跟随 location");
    return redirectResponse("https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v2.0.0");
  };
  const release = await fetchLatestRelease({ request });
  assert.equal(release.version, "2.0.0");
  assert.equal(release.tag, "v2.0.0");
  assert.ok(release.source.endsWith(RELEASE_PAGE), "回退源指向 Releases 页面");
  assert.equal(release.assets.length, 13, "重定向源用候选文件名生成 12 个产物 + 校验文件");
  assert.equal(release.assets.at(-1).name, CHECKSUM_FILE);
  assert.equal(
    release.assets[0].url,
    `${RELEASE_DOWNLOAD}/v2.0.0/WorkBuddy-Switch-2.0.0-mac-arm64.pkg`,
  );
  assert.equal(release.assets[0].size, 0, "重定向源没有文件大小");
  assert.ok(calls.length >= 2);
  assert.ok(calls[0].startsWith("https://gh-proxy.com/https://api.github.com"));
});

test("fetchLatestRelease 全部失败时抛出可展示的聚合错误", async () => {
  const request = async (url) => {
    if (url.includes("api.github.com")) return jsonResponse({}, 403);
    return redirectResponse("", 403);
  };
  await assert.rejects(
    () => fetchLatestRelease({ request }),
    (error) => {
      assert.equal(error.message, "无法连接更新服务器，请检查网络或在设置中切换更新线路。");
      assert.ok(Array.isArray(error.causes));
      assert.ok(error.causes.length >= 2);
      for (const cause of error.causes) {
        assert.equal(typeof cause.source, "string");
        assert.equal(typeof cause.message, "string");
        assert.ok(cause.message.length > 0);
      }
      return true;
    },
  );
});

test("fetchRelease 在第一个源非 2xx 时走下一个源", async () => {
  const payload = {
    tag_name: "v3.1.0",
    name: "",
    body: "",
    assets: assetsFor("3.1.0").map((asset) => ({
      name: asset.name,
      size: 10,
      browser_download_url: asset.url,
    })),
  };
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (calls.length === 1) return jsonResponse({}, 502);
    return jsonResponse(payload);
  };
  const sources = [RELEASE_API, `https://ghproxy.net/${RELEASE_API}`];
  const release = await fetchRelease({ request, sources });
  assert.deepEqual(calls, sources);
  assert.equal(release.version, "3.1.0");
  assert.equal(release.source, sources[1]);
  assert.equal(release.htmlUrl, "", "API 未给 html_url 时保持空字符串");
});

test("downloadFile 流式写入并对齐 sha256 与进度回调", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "nested", "asset.pkg");
  const chunks = [Buffer.from("hello "), Buffer.from("workbuddy "), Buffer.from("updater")];
  const expected = Buffer.concat(chunks);
  const events = [];
  const result = await downloadFile({
    request: async () => bytesResponse(chunks),
    url: "https://example.test/asset.pkg",
    file,
    onProgress: (event) => events.push(event),
  });
  assert.equal(result.file, file);
  assert.equal(result.size, expected.byteLength);
  assert.equal(result.sha256, sha256(expected));
  assert.equal((await fs.readFile(file)).toString("utf8"), expected.toString("utf8"));
  assert.ok(events.length >= 1);
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index].received >= events[index - 1].received, "received 必须单调不减");
  }
  const last = events.at(-1);
  assert.equal(last.done, true);
  assert.equal(last.percent, 100);
  assert.equal(last.received, expected.byteLength);
  assert.equal(last.total, expected.byteLength);

  const empty = await downloadFile({
    request: async () => bytesResponse([]),
    url: "https://example.test/empty",
    file: path.join(directory, "empty.pkg"),
  });
  assert.equal(empty.size, 0);
  assert.equal(empty.sha256, sha256(Buffer.alloc(0)));
});

test("downloadFile 在非 2xx 时抛出 HTTP 状态错误", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "asset.pkg");
  await assert.rejects(
    () =>
      downloadFile({
        request: async () => bytesResponse(["bad"], { status: 502 }),
        url: "https://example.test/asset.pkg",
        file,
      }),
    /下载安装包失败：HTTP 502/,
  );
  await assert.rejects(() => fs.stat(file), "失败时不应留下半截文件");
  await assert.rejects(() => fs.stat(`${file}.part`), "失败时应清掉 .part 临时文件");
});

test("downloadFile 响应 AbortSignal 中止并抛出取消文案", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, "asset.pkg");
  const controller = new AbortController();
  const request = async () => {
    const stream = new ReadableStream({
      start(streamController) {
        streamController.enqueue(new Uint8Array(Buffer.from("partial")));
        const timer = setInterval(() => {
          streamController.enqueue(new Uint8Array(Buffer.from("more")));
        }, 10);
        controller.signal.addEventListener("abort", () => {
          clearInterval(timer);
          streamController.error(new Error("aborted"));
        });
      },
    });
    return {
      ok: true,
      status: 200,
      headers: headerBag({ "content-length": "4096" }),
      body: stream,
    };
  };
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    () =>
      downloadFile({
        request,
        url: "https://example.test/asset.pkg",
        file,
        signal: controller.signal,
      }),
    (error) => {
      assert.equal(error.message, "更新下载已取消。");
      assert.equal(error.name, "AbortError");
      return true;
    },
  );
  await assert.rejects(() => fs.stat(file));
});

test("downloadUpdate 校验通过时返回 verified:true 且保留文件", async (t) => {
  const directory = await temporaryDirectory(t);
  const content = Buffer.from("installer-bytes-".repeat(32));
  const hex = sha256(content);
  const name = "WorkBuddy-Switch-2.0.0-mac-arm64.pkg";
  const release = {
    version: "2.0.0",
    tag: "v2.0.0",
    assets: assetsFor(),
  };
  const request = async (url) => {
    if (url.includes(CHECKSUM_FILE)) return textResponse(`${hex}  ${name}\n`);
    if (url.startsWith("https://ghproxy.net/")) return bytesResponse([content]);
    return bytesResponse(["upstream down"], { status: 502 });
  };
  const result = await downloadUpdate({
    request,
    release,
    target: { platform: "darwin", arch: "arm64" },
    directory,
  });
  assert.equal(result.name, name);
  assert.equal(result.file, path.join(directory, name));
  assert.equal(result.size, content.byteLength);
  assert.equal(result.sha256, hex);
  assert.equal(result.verified, true);
  assert.equal((await fs.readFile(result.file)).toString("utf8"), content.toString("utf8"));
});

test("downloadUpdate 在 sha256 不符时抛错并删除安装包", async (t) => {
  const directory = await temporaryDirectory(t);
  const name = "WorkBuddy-Switch-2.0.0-mac-arm64.pkg";
  const request = async (url) => {
    if (url.includes(CHECKSUM_FILE))
      return textResponse(`${"0".repeat(64)}  ${name}\n`);
    return bytesResponse([Buffer.from("tampered")]);
  };
  await assert.rejects(
    () =>
      downloadUpdate({
        request,
        release: { version: "2.0.0", tag: "v2.0.0", assets: assetsFor() },
        target: { platform: "darwin", arch: "arm64" },
        directory,
      }),
    /安装包校验失败，文件可能不完整，请重试。/,
  );
  await assert.rejects(() => fs.stat(path.join(directory, name)));
});

test("downloadUpdate 候选地址回退后成功，校验文件缺失时 verified:false", async (t) => {
  const directory = await temporaryDirectory(t);
  const content = Buffer.from("second-candidate");
  const name = "WorkBuddy-Switch-2.0.0-windows-x64-setup.exe";
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.includes(CHECKSUM_FILE)) return textResponse("", 404);
    if (url.startsWith("https://gh-proxy.com/")) return bytesResponse(["down"], { status: 502 });
    if (url.startsWith("https://ghproxy.net/")) return bytesResponse([content]);
    return bytesResponse(["down"], { status: 502 });
  };
  const result = await downloadUpdate({
    request,
    release: { version: "2.0.0", tag: "v2.0.0", assets: assetsFor() },
    target: { platform: "win32", arch: "x64" },
    mirror: "auto",
    directory,
  });
  assert.equal(result.name, name);
  assert.equal(result.verified, false, "拿不到校验文件时跳过校验");
  assert.equal(result.sha256, sha256(content));
  assert.ok(
    calls[0].startsWith("https://gh-proxy.com/https://github.com/"),
    "先试国内镜像",
  );
  assert.ok(calls.some((url) => url.startsWith("https://ghproxy.net/")));

  await assert.rejects(
    () =>
      downloadUpdate({
        request,
        release: { version: "2.0.0", tag: "v2.0.0", assets: assetsFor() },
        target: { platform: "solaris", arch: "x64" },
        directory,
      }),
    /未找到适用于当前系统的安装包。/,
  );
});

test("installationPlan 覆盖各平台安装动作描述符", () => {
  const darwinPkg = installationPlan({
    platform: "darwin",
    asset: { target: "pkg" },
    downloadPath: "/tmp/x.pkg",
  });
  assert.deepEqual(darwinPkg, {
    kind: "mac-pkg",
    command: "/usr/sbin/installer",
    args: ["-pkg", "/tmp/x.pkg", "-target", "/"],
    privileged: true,
  });
  assert.deepEqual(installationPlan({ platform: "darwin", asset: { target: "dmg" }, downloadPath: "/tmp/x.dmg" }), {
    kind: "mac-dmg",
    mount: true,
    file: "/tmp/x.dmg",
  });
  assert.equal(
    installationPlan({ platform: "darwin", asset: { target: "zip" }, downloadPath: "/tmp/x.zip" }).kind,
    "mac-zip",
  );
  assert.deepEqual(installationPlan({ platform: "win32", asset: { target: "nsis" }, downloadPath: "C:\\\\x.exe" }), {
    kind: "win-nsis",
    command: "C:\\\\x.exe",
    args: ["/S"],
    privileged: false,
  });
  assert.deepEqual(installationPlan({ platform: "linux", asset: { target: "appimage" }, downloadPath: "/tmp/x.AppImage" }), {
    kind: "linux-appimage",
    file: "/tmp/x.AppImage",
    executable: true,
  });
  assert.deepEqual(installationPlan({ platform: "linux", asset: { target: "deb" }, downloadPath: "/tmp/x.deb" }), {
    kind: "linux-deb",
    command: "/usr/bin/apt-get",
    args: ["install", "-y", "/tmp/x.deb"],
    privileged: true,
  });
  assert.throws(
    () => installationPlan({ platform: "freebsd", asset: { target: "pkg" }, downloadPath: "/tmp/x" }),
    /当前平台暂不支持自动安装，请手动打开安装包。/,
  );
  assert.throws(() => installationPlan({ platform: "darwin", asset: {}, downloadPath: "" }), /缺少安装包路径。/);
});

test("planInstall 生成每种平台与扩展名的动作数组", () => {
  assert.deepEqual(planInstall({ platform: "darwin", file: "/tmp/Work.pkg" }), [
    { kind: "open", target: "/tmp/Work.pkg", hint: "安装器会请求管理员授权" },
  ]);
  assert.deepEqual(planInstall({ platform: "darwin", file: "/tmp/Work.dmg" }), [
    { kind: "open", target: "/tmp/Work.dmg" },
  ]);
  assert.deepEqual(planInstall({ platform: "darwin", file: "/tmp/Work.zip" }), [
    { kind: "open", target: "/tmp/Work.zip" },
  ]);
  assert.deepEqual(planInstall({ platform: "win32", file: "C:\\\\Work-setup.exe" }), [
    { kind: "spawn", command: "C:\\\\Work-setup.exe", args: ["/S"] },
  ]);
  assert.deepEqual(planInstall({ platform: "linux", file: "/opt/Work.AppImage", currentExecutable: "/opt/Old.AppImage" }), [
    { kind: "replace", file: "/opt/Work.AppImage", target: "/opt/Old.AppImage" },
  ]);
  assert.deepEqual(planInstall({ platform: "linux", file: "/tmp/work.deb" }), [
    { kind: "spawn", command: "pkexec", args: ["dpkg", "-i", "/tmp/work.deb"] },
  ]);
  assert.throws(() => planInstall({ platform: "darwin", file: "/tmp/Work.txt" }), /当前平台暂不支持自动安装，请手动打开安装包。/);
  assert.throws(() => planInstall({ platform: "linux", file: "/tmp/Work.AppImage" }), /未找到当前应用路径/);
  assert.throws(() => planInstall({ platform: "darwin", file: "" }), /缺少安装包路径。/);
});

test("restartPlan 只描述重启动作", () => {
  assert.deepEqual(restartPlan({ platform: "darwin", appPath: "/Applications/WorkBuddy Switch.app" }), {
    kind: "mac-open",
    command: "/usr/bin/open",
    args: ["-n", "/Applications/WorkBuddy Switch.app"],
    detached: true,
    privileged: false,
  });
  assert.equal(restartPlan({ platform: "win32", appPath: "C:\\\\Work.exe" }).kind, "win-start");
  assert.equal(restartPlan({ platform: "linux", appPath: "/opt/work" }).kind, "linux-start");
  assert.throws(() => restartPlan({ platform: "darwin", appPath: "" }), /缺少应用路径/);
});

test("checkForUpdate 汇总可用性、选包与来源", async () => {
  const payload = {
    tag_name: "v2.0.0",
    name: "",
    body: "修复若干问题",
    html_url: "https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v2.0.0",
    assets: assetsFor().map((asset) => ({
      name: asset.name,
      size: 4096,
      browser_download_url: asset.url,
    })),
  };
  const request = async () => jsonResponse(payload);
  const result = await checkForUpdate({
    request,
    sources: [RELEASE_API],
    currentVersion: "1.9.9",
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(result.available, true);
  assert.equal(result.version, "2.0.0");
  assert.equal(result.notes, "修复若干问题");
  assert.equal(result.htmlUrl, "https://github.com/koi128bit/WorkBuddy-Switch/releases/tag/v2.0.0");
  assert.equal(result.source, RELEASE_API);
  assert.equal(result.asset.name, "WorkBuddy-Switch-2.0.0-mac-arm64.pkg");
  assert.equal(result.asset.kind, "installer");

  const same = await checkForUpdate({
    request,
    sources: [RELEASE_API],
    currentVersion: "2.0.0",
    platform: "win32",
    arch: "x64",
  });
  assert.equal(same.available, false, "同版本不算可更新");
  assert.equal(same.asset.target, "nsis");
});
