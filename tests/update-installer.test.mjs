import test from "node:test";
import assert from "node:assert/strict";
import {
  appStartTarget,
  installKindFor,
  installScript,
  macBundlePath,
  updateDirectory,
} from "../desktop/update-installer.mjs";

test("macBundlePath 从可执行文件回溯到 .app 包", () => {
  assert.equal(
    macBundlePath("/Applications/WorkBuddy Switch.app/Contents/MacOS/WorkBuddy Switch"),
    "/Applications/WorkBuddy Switch.app",
  );
  assert.equal(macBundlePath("/usr/local/bin/workbuddy-switch"), "");
  assert.equal(macBundlePath(undefined), "");
});

test("appStartTarget 在 macOS 优先使用 .app 包", () => {
  assert.equal(
    appStartTarget({
      platform: "darwin",
      executable: "/Applications/X.app/Contents/MacOS/X",
    }),
    "/Applications/X.app",
  );
  assert.equal(
    appStartTarget({
      platform: "darwin",
      executable: "/tmp/X",
      bundlePath: "/Applications/X.app",
    }),
    "/Applications/X.app",
  );
  assert.throws(() => appStartTarget({ platform: "darwin", executable: "" }));
  assert.equal(
    appStartTarget({ platform: "win32", executable: "C:\\a\\b.exe" }),
    "C:\\a\\b.exe",
  );
  assert.throws(() => appStartTarget({ platform: "linux", executable: "" }));
});

test("updateDirectory 落在 userData/updates", () => {
  assert.equal(updateDirectory("/tmp/data"), "/tmp/data/updates");
  assert.throws(() => updateDirectory(""));
});

test("installKindFor 映射每个平台的目标类型", () => {
  assert.equal(installKindFor({ platform: "darwin", target: "pkg" }), "mac-pkg");
  assert.equal(installKindFor({ platform: "darwin", target: "dmg" }), "mac-dmg");
  assert.equal(installKindFor({ platform: "darwin", target: "zip" }), "mac-zip");
  assert.equal(installKindFor({ platform: "win32", target: "nsis" }), "win-nsis");
  assert.equal(
    installKindFor({ platform: "win32", target: "portable" }),
    "win-portable",
  );
  assert.equal(
    installKindFor({ platform: "linux", target: "appimage" }),
    "linux-appimage",
  );
  assert.equal(installKindFor({ platform: "linux", target: "deb" }), "linux-deb");
  assert.throws(() => installKindFor({ platform: "darwin", target: "exe" }));
  assert.throws(() => installKindFor({ platform: "aix", target: "pkg" }));
});

test("installScript 缺少必要参数时给出中文错误", () => {
  assert.throws(() => installScript({}), /缺少安装包路径/);
  assert.throws(
    () => installScript({ platform: "linux", kind: "linux-deb", file: "/x.deb" }),
    /缺少进程号/,
  );
  assert.throws(
    () =>
      installScript({
        platform: "linux",
        kind: "linux-deb",
        file: "/x.deb",
        pid: 1,
        directory: "/tmp",
      }),
    /未找到应用安装位置/,
  );
  assert.throws(
    () =>
      installScript({
        platform: "aix",
        kind: "linux-deb",
        file: "/x.deb",
        pid: 1,
        directory: "/tmp",
        appPath: "/opt/x",
      }),
    /暂不支持自动安装/,
  );
});

test("macOS pkg 安装脚本等待进程退出后走管理员授权并重启", () => {
  const script = installScript({
    platform: "darwin",
    kind: "mac-pkg",
    file: "/tmp/u/WorkBuddy-Switch-2.0.0-mac-arm64.pkg",
    appPath: "/Applications/WorkBuddy Switch.app/Contents/MacOS/WorkBuddy Switch",
    pid: 4321,
    directory: "/tmp/u",
  });
  assert.equal(script.command, "/bin/sh");
  assert.deepEqual(script.args, ["/tmp/u/apply-update.sh"]);
  assert.equal(script.file, "/tmp/u/apply-update.sh");
  assert.match(script.content, /^#!\/bin\/sh\n/);
  assert.match(script.content, /while kill -0 4321 /);
  assert.match(script.content, /with administrator privileges/);
  assert.match(script.content, /\/usr\/sbin\/installer -pkg/);
  assert.match(script.content, /\/usr\/bin\/open -n "\/Applications\/WorkBuddy Switch\.app"/);
  assert.match(script.content, /display dialog/);
});

test("macOS dmg 安装脚本挂载后复制 .app 再重启", () => {
  const script = installScript({
    platform: "darwin",
    kind: "mac-dmg",
    file: "/tmp/u/a.dmg",
    appPath: "/Applications/WorkBuddy Switch.app",
    pid: 7,
    directory: "/tmp/u",
  });
  assert.match(script.content, /hdiutil attach/);
  assert.match(script.content, /ditto -x -k|\/usr\/bin\/ditto .*\.app/);
  assert.match(script.content, /hdiutil detach/);
});

test("macOS zip 安装脚本解压后复制 .app", () => {
  const script = installScript({
    platform: "darwin",
    kind: "mac-zip",
    file: "/tmp/u/a.zip",
    appPath: "/Applications/WorkBuddy Switch.app",
    pid: 9,
    directory: "/tmp/u",
  });
  assert.match(script.content, /ditto -x -k/);
  assert.match(script.content, /\/usr\/bin\/open -n/);
});

test("Windows nsis 脚本用 PowerShell 等待退出后静默安装并启动", () => {
  const script = installScript({
    platform: "win32",
    kind: "win-nsis",
    file: "C:\\u\\setup.exe",
    appPath: "C:\\Apps\\WorkBuddy Switch.exe",
    pid: 88,
    directory: "C:\\u",
  });
  assert.equal(script.command, "powershell.exe");
  assert.match(script.args.at(-1) ?? "", /apply-update\.ps1$/);
  assert.equal(script.args[0], "-NoProfile");
  assert.match(script.content, /Wait-Process -Id 88/);
  assert.match(script.content, /-ArgumentList '\/S' -Wait/);
  assert.match(script.content, /Start-Process -FilePath 'C:\\Apps\\WorkBuddy Switch\.exe'/);
});

test("Windows portable 脚本覆盖当前可执行文件后启动", () => {
  const script = installScript({
    platform: "win32",
    kind: "win-portable",
    file: "C:\\u\\portable.exe",
    appPath: "C:\\Apps\\WorkBuddy Switch.exe",
    pid: 12,
    directory: "C:\\u",
  });
  assert.match(script.content, /Copy-Item -LiteralPath 'C:\\u\\portable\.exe'/);
  assert.doesNotMatch(script.content, /-ArgumentList/);
});

test("Linux AppImage 脚本先就地替换，失败再请求 pkexec", () => {
  const script = installScript({
    platform: "linux",
    kind: "linux-appimage",
    file: "/tmp/u/a.AppImage",
    appPath: "/opt/wb/workbuddy-switch.AppImage",
    pid: 5,
    directory: "/tmp/u",
  });
  assert.equal(script.command, "/bin/sh");
  assert.match(script.content, /\/bin\/cp -f "\/tmp\/u\/a\.AppImage"/);
  assert.match(script.content, /\/usr\/bin\/pkexec/);
  assert.match(script.content, /nohup/);
});

test("Linux deb 脚本走 pkexec dpkg 安装", () => {
  const script = installScript({
    platform: "linux",
    kind: "linux-deb",
    file: "/tmp/u/a.deb",
    appPath: "/opt/wb/workbuddy-switch",
    pid: 6,
    directory: "/tmp/u",
  });
  assert.match(script.content, /\/usr\/bin\/pkexec \/usr\/bin\/dpkg -i/);
  assert.match(script.content, /nohup "\/opt\/wb\/workbuddy-switch"/);
});

test("安装脚本会转义路径中的引号与美元符号", () => {
  const script = installScript({
    platform: "linux",
    kind: "linux-deb",
    file: '/tmp/u/a"b$c.deb',
    appPath: "/opt/wb/app",
    pid: 3,
    directory: "/tmp/u",
  });
  assert.match(script.content, /\\"b\\\$c\.deb/);
});

test("日志文件存在时脚本把输出重定向到日志", () => {
  const script = installScript({
    platform: "darwin",
    kind: "mac-pkg",
    file: "/tmp/u/a.pkg",
    appPath: "/Applications/X.app",
    pid: 4,
    directory: "/tmp/u",
    logFile: "/tmp/u/update-install.log",
  });
  assert.match(script.content, /exec >> "\/tmp\/u\/update-install\.log" 2>&1/);
});
