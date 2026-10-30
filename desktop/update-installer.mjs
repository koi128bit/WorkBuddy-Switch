import path from "node:path";

// 更新安装器把「已下载并通过校验的安装包」变成「正在运行的新版本」。
// 应用无法在自身运行时替换自己的安装包，因此先落一个后台助手脚本：
// 它等待当前进程退出 → 执行安装 → 重新拉起应用。终端用户看不到窗口，
// 失败时 macOS 会弹一次系统对话框，其余平台把原因写进日志。
//
// 本模块只生成脚本内容与启动参数，不触碰文件系统、不启动进程，方便直接单测。

const MAC_INSTALLER = "/usr/sbin/installer";
const MAC_OPEN = "/usr/bin/open";
const MAC_OSASCRIPT = "/usr/bin/osascript";
const MAC_HDIUTIL = "/usr/bin/hdiutil";
const MAC_DITTO = "/usr/bin/ditto";
const POSIX_SHELL = "/bin/sh";
const PKEXEC = "/usr/bin/pkexec";

const INSTALL_KINDS = Object.freeze({
  darwin: Object.freeze(["mac-pkg", "mac-dmg", "mac-zip"]),
  win32: Object.freeze(["win-nsis", "win-portable"]),
  linux: Object.freeze(["linux-appimage", "linux-deb"]),
});

function unsupported() {
  return new Error("当前平台暂不支持自动安装，请手动打开安装包。");
}

function sh(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;
}

function osa(statement) {
  return `${MAC_OSASCRIPT} -e "${String(statement)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

// 需要管理员权限的 shell 命令：走系统授权对话框，成功后不再提示。
function adminShell(command) {
  return osa(`do shell script ${sh(command)} with administrator privileges`);
}

function alert(text) {
  return osa(
    `display dialog ${sh(text)} buttons {"好"} default button 1 with icon caution`,
  );
}

function ps(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

export function macBundlePath(executable) {
  const value = String(executable ?? "");
  const index = value.indexOf(".app/Contents/MacOS/");
  return index < 0 ? "" : value.slice(0, index + 4);
}

// 安装后需要重新启动的对象：macOS 是 .app 包，其余平台是可执行文件本身。
export function appStartTarget({ platform, executable, bundlePath } = {}) {
  if (platform === "darwin") {
    const bundle = String(bundlePath ?? "") || macBundlePath(executable);
    if (bundle) return bundle;
  }
  const value = String(executable ?? "");
  if (value) return value;
  throw new Error("未找到应用安装位置，请手动重新打开应用。");
}

export function updateDirectory(userData) {
  if (typeof userData !== "string" || !userData.trim())
    throw new Error("缺少应用数据目录。");
  return path.join(userData, "updates");
}

function macInstallCommand({ kind, file, appPath }) {
  if (kind === "mac-pkg")
    return `${MAC_INSTALLER} -pkg ${sh(file)} -target /`;
  const staging = `${file}.stage`;
  const unpack =
    kind === "mac-dmg"
      ? `${MAC_HDIUTIL} attach ${sh(file)} -nobrowse -quiet -mountpoint ${sh(staging)}`
      : `/bin/mkdir -p ${sh(staging)}`;
  const extract =
    kind === "mac-dmg"
      ? ""
      : ` && ${MAC_DITTO} -x -k ${sh(file)} ${sh(staging)}`;
  const detach =
    kind === "mac-dmg"
      ? ` ; ${MAC_HDIUTIL} detach ${sh(staging)} -quiet`
      : "";
  return [
    `/bin/rm -rf ${sh(staging)}`,
    `/bin/mkdir -p ${sh(staging)}`,
    unpack + extract,
    `/bin/rm -rf ${sh(appPath)}`,
    `${MAC_DITTO} ${sh(staging)}/*.app ${sh(appPath)}`,
  ].join(" && ") + detach;
}

function posixLines({ platform, kind, file, appPath, pid }) {
  const lines = [
    `# 等待主进程 ${pid} 退出后再动手，避免替换正在运行的安装包`,
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done`,
    "sleep 0.6",
  ];
  if (platform === "darwin") {
    lines.push(
      adminShell(macInstallCommand({ kind, file, appPath })),
      "status=$?",
      'if [ "$status" -eq 0 ]; then',
      `  ${MAC_OPEN} -n ${sh(appPath)}`,
      "else",
      `  ${alert("更新未完成，请打开下载目录重新安装。")}`,
      "fi",
    );
    return lines;
  }
  if (kind === "linux-appimage") {
    lines.push(
      `if /bin/cp -f ${sh(file)} ${sh(appPath)} 2>/dev/null; then`,
      `  /bin/chmod +x ${sh(appPath)}; status=0`,
      "else",
      `  ${PKEXEC} ${POSIX_SHELL} -c ${sh(`cp -f ${sh(file)} ${sh(appPath)} && chmod +x ${sh(appPath)}`)}; status=$?`,
      "fi",
      'if [ "$status" -eq 0 ]; then nohup ' + sh(appPath) + " >/dev/null 2>&1 & fi",
    );
    return lines;
  }
  lines.push(
    `${PKEXEC} /usr/bin/dpkg -i ${sh(file)}; status=$?`,
    'if [ "$status" -eq 0 ]; then nohup ' + sh(appPath) + " >/dev/null 2>&1 & fi",
  );
  return lines;
}

function powershellLines({ kind, file, appPath, pid }) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `try { Wait-Process -Id ${pid} -ErrorAction SilentlyContinue } catch { }`,
    "Start-Sleep -Milliseconds 900",
  ];
  if (kind === "win-nsis") {
    lines.push(
      `Start-Process -FilePath ${ps(file)} -ArgumentList '/S' -Wait`,
      "Start-Sleep -Milliseconds 1500",
    );
  } else {
    lines.push(
      `Copy-Item -LiteralPath ${ps(file)} -Destination ${ps(appPath)} -Force`,
      "Start-Sleep -Milliseconds 300",
    );
  }
  lines.push(`Start-Process -FilePath ${ps(appPath)}`);
  return lines;
}

// 生成助手脚本：{ platform, file, command, args, content }
// command + args 就是「执行该脚本」的完整启动方式（args 已包含脚本路径）。
export function installScript({
  platform,
  kind,
  file,
  appPath,
  pid,
  directory,
  logFile,
} = {}) {
  if (typeof file !== "string" || !file) throw new Error("缺少安装包路径。");
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("缺少进程号。");
  if (typeof directory !== "string" || !directory.trim())
    throw new Error("缺少下载目录。");
  if (!INSTALL_KINDS[platform]) throw unsupported();
  if (!INSTALL_KINDS[platform].includes(kind)) throw unsupported();

  const target = appStartTarget({ platform, executable: appPath });
  const log = typeof logFile === "string" ? logFile : "";

  if (platform === "win32") {
    const script = path.join(directory, "apply-update.ps1");
    return {
      platform,
      file: script,
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        script,
      ],
      content:
        powershellLines({ kind, file, appPath: target, pid }).join("\r\n") +
        "\r\n",
    };
  }

  const script = path.join(directory, "apply-update.sh");
  const header = ["#!/bin/sh"];
  if (log) header.push(`exec >> ${sh(log)} 2>&1`, `echo "[$(date)] 开始安装更新"`);
  return {
    platform,
    file: script,
    command: POSIX_SHELL,
    args: [script],
    content: [
      ...header,
      ...posixLines({ platform, kind, file, appPath: target, pid }),
      "",
    ].join("\n"),
  };
}

export function installKindFor({ platform, target } = {}) {
  const value = String(target ?? "");
  if (platform === "darwin") {
    if (value === "pkg") return "mac-pkg";
    if (value === "dmg") return "mac-dmg";
    if (value === "zip") return "mac-zip";
  }
  if (platform === "win32") {
    if (value === "nsis") return "win-nsis";
    if (value === "portable") return "win-portable";
  }
  if (platform === "linux") {
    if (value === "appimage") return "linux-appimage";
    if (value === "deb") return "linux-deb";
  }
  throw unsupported();
}
