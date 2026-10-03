const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  nativeTheme,
  shell,
  Tray,
  Menu,
  nativeImage,
  protocol,
  net,
  session,
  Notification,
} = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
let mainWindow,
  store,
  tray,
  quitting = false,
  refreshTimer,
  tickBusy = false;
const noticeKeys = new Map();
const root = path.join(__dirname, "..");
const devURL =
  !app.isPackaged && process.env.WB_SWITCH_DEV_URL === "http://127.0.0.1:5173"
    ? process.env.WB_SWITCH_DEV_URL
    : null;
const links = {
  github: "https://github.com/koi128bit/WorkBuddy-Switch",
  wiki: "https://github.com/koi128bit/WorkBuddy-Switch/wiki",
  releases: "https://github.com/koi128bit/WorkBuddy-Switch/releases/latest",
  privacy:
    "https://github.com/koi128bit/WorkBuddy-Switch/blob/main/SECURITY.md",
};
app.setName("WorkBuddy Switch");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "workbuddy-switch",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const testMode = !app.isPackaged && process.env.WB_SWITCH_TEST_DIR;
if (testMode) app.setPath("userData", testMode);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => showWindow());
  app
    .whenReady()
    .then(start)
    .catch(() => {
      dialog.showErrorBox(
        "WorkBuddy Switch 无法启动",
        "应用数据或系统加密服务初始化失败。请保留应用数据目录，并查看 Wiki 的故障排查。",
      );
      app.quit();
    });
}
app.on("before-quit", () => {
  quitting = true;
  clearInterval(refreshTimer);
});
app.on("window-all-closed", () => {
  if (!store?.settings.closeToTray) app.quit();
});
app.on("activate", () => showWindow());

function changed() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("wb:changed");
  updateTray();
}
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: "WorkBuddy Switch",
    backgroundColor: "#f8faf7",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 20, y: 22 },
    icon: path.join(root, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (!quitting && store.settings.closeToTray && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.on("render-process-gone", () => {
    if (!quitting) {
      dialog.showErrorBox(
        "界面已关闭",
        "界面进程意外退出，请重新打开应用。账号数据已保存在本机。",
      );
      app.quit();
    }
  });
  if (devURL) mainWindow.loadURL(devURL);
  else mainWindow.loadURL("workbuddy-switch://app/index.html");
}
function trusted(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  const url = event.senderFrame.url;
  return devURL
    ? url === `${devURL}/`
    : url === "workbuddy-switch://app/index.html";
}
function handle(name, action) {
  ipcMain.handle(`wb:${name}`, async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: "操作来源无效。" };
    try {
      return { ok: true, value: await action(...args) };
    } catch (error) {
      return { ok: false, error: safeMessage(error) };
    }
  });
}
function safeMessage(error) {
  if (error.code === "EACCES" || error.code === "EPERM")
    return "文件访问被系统拒绝。请检查路径权限，macOS 可在系统设置中授权完全磁盘访问。";
  if (error.code === "ENOENT")
    return "未找到需要的文件，请检查连接设置中的路径。";
  if (error.code === "ENOSPC") return "磁盘空间不足，操作未完成。";
  return typeof error.message === "string" &&
    /[\u4e00-\u9fff]/.test(error.message)
    ? error.message.slice(0, 350)
    : "操作未完成，请检查数据权限后重试。";
}
const string = (value, limit = 500) => {
  if (typeof value !== "string" || value.length > limit || value.includes("\0"))
    throw new Error("操作参数无效。");
  return value;
};
function query(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("查询参数无效。");
  if (value.accountId !== null && value.accountId !== undefined)
    string(value.accountId, 200);
  for (const key of ["since", "until"])
    if (
      value[key] !== null &&
      value[key] !== undefined &&
      (!Number.isFinite(value[key]) || value[key] < 0)
    )
      throw new Error("日期范围无效。");
  return {
    accountId: value.accountId ?? null,
    since: value.since ?? null,
    until: value.until ?? null,
  };
}
async function start() {
  const [
    { Store },
    { WorkBuddyController },
    { readBounded, atomicWrite },
    { usageCSV },
    { Login },
  ] = await Promise.all([
    import("./store.mjs"),
    import("./controller.mjs"),
    import("./files.mjs"),
    import("./usage.mjs"),
    import("./login.mjs"),
  ]);
  await protocol.handle("workbuddy-switch", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "app")
        return new Response("Forbidden", { status: 403 });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.resolve(root, "renderer", relative);
      if (
        !file.startsWith(path.join(root, "renderer") + path.sep) ||
        !/\.(html|js|css|svg|png|woff2)$/.test(file)
      )
        return new Response("Forbidden", { status: 403 });
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  const vault = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (raw) => safeStorage.encryptString(raw),
    decrypt: (data) => safeStorage.decryptString(data),
  };
  const controller = new WorkBuddyController(() => store?.settings || {});
  store = new Store({
    directory: app.getPath("userData"),
    vault,
    controller,
    request: (url, options) => net.fetch(url, options),
    onChange: changed,
  });
  await store.init();
  const login = new Login((url, options) => net.fetch(url, options));
  let pollingLogin = false;
  handle("login-start", () => login.start());
  handle("login-open", (id) =>
    shell.openExternal(login.require(string(id, 200)).url),
  );
  handle("login-cancel", (id) => login.cancel(string(id, 200)));
  handle("login-poll", async (id) => {
    string(id, 200);
    if (pollingLogin) return { done: false };
    pollingLogin = true;
    try {
      const document = await login.poll(id);
      if (!document) return { done: false };
      await store.exclusive(async () => {
        login.require(id);
        await store.capture(document);
      });
      login.cancel(id);
      store.log("网页登录账号已加密保存。");
      return { done: true };
    } finally {
      pollingLogin = false;
    }
  });
  nativeTheme.themeSource = store.settings.theme;
  handle("snapshot", async () => ({
    ...(await store.snapshot()),
    version: app.getVersion(),
    platform: process.platform,
    dataDirectory: app.getPath("userData"),
  }));
  handle("capture", () => store.captureCurrent());
  handle("switch", (id) => store.switchAccount(string(id, 200)));
  handle("edit", (id, patch) => store.editAccount(string(id, 200), patch));
  handle("remove", (id) => store.removeAccount(string(id, 200)));
  handle("refresh", (id) => store.refreshQuotas(id ? string(id, 200) : null));
  handle("sessions", () => store.sessions());
  handle("usage", (q) => store.usage(query(q)));
  handle("resume", (id) =>
    store.resumeSession(string(id, 200), async (sessionId) =>
      shell.openExternal(`workbuddy://chat/${encodeURIComponent(sessionId)}`),
    ),
  );
  handle("launch", () => controller.launch());
  handle("diagnostics", () => store.diagnostics());
  handle("backups", () => store.backups());
  handle("backup-sessions", () => store.backupSessions());
  handle("settings", (settings) =>
    store.exclusive(async () => {
      const { validateSettings } = await import("./settings.mjs");
      const value = validateSettings(settings),
        previous = store.settings;
      if (value.launchAtLogin !== previous.launchAtLogin && !testMode) {
        if (!app.isPackaged)
          throw new Error("请在安装后的应用中设置开机启动。");
        app.setLoginItemSettings({
          openAtLogin: value.launchAtLogin,
          ...(process.platform === "win32" &&
          process.env.PORTABLE_EXECUTABLE_FILE
            ? { path: process.env.PORTABLE_EXECUTABLE_FILE }
            : {}),
        });
        if (
          app.getLoginItemSettings(
            process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_FILE
              ? { path: process.env.PORTABLE_EXECUTABLE_FILE }
              : {},
          ).openAtLogin !== value.launchAtLogin
        )
          throw new Error("系统未能应用开机启动设置。");
      }
      try {
        await store.updateSettings(value);
      } catch (error) {
        if (!testMode && value.launchAtLogin !== previous.launchAtLogin)
          app.setLoginItemSettings({
            openAtLogin: previous.launchAtLogin,
            ...(process.platform === "win32" &&
            process.env.PORTABLE_EXECUTABLE_FILE
              ? { path: process.env.PORTABLE_EXECUTABLE_FILE }
              : {}),
          });
        throw error;
      }
      nativeTheme.themeSource = value.theme;
      scheduleRefresh();
      updateTray();
      return value;
    }),
  );
  handle("choose-path", async (kind) => {
    if (!["auth", "data", "executable"].includes(kind))
      throw new Error("路径选择无效。");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 WorkBuddy 路径",
      properties: kind === "data" ? ["openDirectory"] : ["openFile"],
      ...(kind === "auth"
        ? { filters: [{ name: "登录信息", extensions: ["info"] }] }
        : {}),
      ...(kind === "executable" && process.platform === "win32"
        ? { filters: [{ name: "WorkBuddy", extensions: ["exe"] }] }
        : {}),
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("open-folder", async (kind) => {
    const folders = {
      application: app.getPath("userData"),
      backups: store.backupDirectory,
      projects: store.paths.projects,
    };
    if (!Object.hasOwn(folders, kind)) throw new Error("文件夹选择无效。");
    if (kind === "backups")
      await fs.mkdir(folders[kind], { recursive: true, mode: 0o700 });
    const error = await shell.openPath(folders[kind]);
    if (error) throw new Error("系统无法打开该文件夹。");
  });
  handle("export", async (password) => {
    string(password, 512);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出加密账号备份",
      defaultPath: `WorkBuddy-accounts-${new Date().toISOString().slice(0, 10)}.wbsbackup`,
      filters: [{ name: "加密账号备份", extensions: ["wbsbackup"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await atomicWrite(result.filePath, await store.exportAccounts(password));
    return true;
  });
  handle("import", async (password) => {
    string(password, 512);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入加密账号备份",
      properties: ["openFile"],
      filters: [{ name: "加密账号备份", extensions: ["wbsbackup"] }],
    });
    if (result.canceled) return null;
    return store.importAccounts(
      await readBounded(result.filePaths[0]),
      password,
    );
  });
  handle("legacy", async () => {
    if (process.platform !== "darwin")
      throw new Error("旧版迁入仅适用于 macOS。Windows 请导入加密备份。");
    const index = path.join(
      os.homedir(),
      "Library/Application Support/OpenUsage/accounts.json",
    );
    let profiles;
    try {
      profiles = JSON.parse(await readBounded(index));
    } catch {
      throw new Error("未找到有效的旧版账号库。");
    }
    if (!Array.isArray(profiles) || profiles.length > 500)
      throw new Error("旧版账号库格式无效。");
    const records = [];
    let skipped = 0;
    for (const profile of profiles) {
      string(profile.id, 200);
      if (store.records.some((r) => r.profile.id === profile.id)) continue;
      try {
        const { stdout } = await exec(
          "/usr/bin/security",
          [
            "find-generic-password",
            "-s",
            "com.koi128bit.openusage.workbuddy-account.v1",
            "-a",
            profile.id,
            "-w",
          ],
          { timeout: 30000, maxBuffer: 1024 * 1024 },
        );
        records.push({ raw: stdout.trim(), nickname: profile.nickname });
      } catch {
        skipped++;
      }
    }
    const imported = await store.importLegacy(records);
    return { imported, skipped };
  });
  handle("export-usage", async (q) => {
    const usage = await store.usage(query(q));
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出用量 CSV",
      defaultPath: "WorkBuddy-usage.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await atomicWrite(result.filePath, usageCSV(usage));
    return true;
  });
  handle("link", (name) => {
    if (!Object.hasOwn(links, name)) throw new Error("链接无效。");
    return shell.openExternal(links[name]);
  });
  handle("update", checkUpdate);
  createWindow();
  createTray();
  scheduleRefresh();
  if (store.settings.autoCapture) {
    try {
      await store.captureCurrent();
    } catch (e) {
      store.log(safeMessage(e), "error");
    }
  }
}
function createTray() {
  const image = nativeImage.createFromPath(path.join(root, "assets/icon.png"));
  tray = new Tray(image.resize({ width: 20, height: 20 }));
  tray.setToolTip("WorkBuddy Switch");
  tray.on("click", showWindow);
  updateTray();
}
function updateTray() {
  if (!tray) return;
  const accounts = [...store.records]
    .sort((a, b) => b.profile.lastUsedAt - a.profile.lastUsedAt)
    .slice(0, 8);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 WorkBuddy Switch", click: showWindow },
      { type: "separator" },
      ...accounts.map((r, i) => ({
        label: store.settings.privacyMode
          ? `账号 ${i + 1}`
          : r.profile.nickname,
        enabled: !store.busy,
        click: async () => {
          const result = await dialog.showMessageBox({
            type: "question",
            title: "切换 WorkBuddy 账号",
            message: "切换将关闭 WorkBuddy。请先结束正在运行的任务。",
            buttons: ["取消", "切换账号"],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response === 1) {
            try {
              await store.switchAccount(r.profile.id);
            } catch (error) {
              dialog.showErrorBox("切换未完成", safeMessage(error));
            }
          }
          updateTray();
        },
      })),
      { type: "separator" },
      {
        label: "打开 WorkBuddy",
        click: async () => {
          try {
            await store.controller.launch();
          } catch (e) {
            dialog.showErrorBox("启动未完成", safeMessage(e));
          }
        },
      },
      { label: "退出", click: () => app.quit() },
    ]),
  );
}
function scheduleRefresh() {
  clearInterval(refreshTimer);
  if (!store.settings.refreshSeconds) return;
  refreshTimer = setInterval(async () => {
    if (store.busy || tickBusy || !store.records.length) return;
    tickBusy = true;
    try {
      await store.refreshQuotas();
      notifyBalances();
      updateTray();
    } catch (e) {
      store.log(safeMessage(e), "error");
    } finally {
      tickBusy = false;
    }
  }, store.settings.refreshSeconds * 1000);
}
function notifyBalances() {
  if (!store.settings.notifications || !Notification.isSupported()) return;
  for (const { profile } of store.records) {
    if (!profile.quota || profile.quotaError) continue;
    const urgent =
      profile.quota.expiresAt &&
      profile.quota.expiresAt - Date.now() <=
        store.settings.expiryWarningDays * 86400000;
    if (!urgent && profile.quota.remaining > store.settings.lowBalanceThreshold)
      continue;
    const key = `${profile.id}:${Math.floor(Date.now() / 86400000)}:${urgent ? "expiry" : "low"}`;
    if (noticeKeys.has(key)) continue;
    noticeKeys.set(key, true);
    if (noticeKeys.size > 1000)
      noticeKeys.delete(noticeKeys.keys().next().value);
    new Notification({
      title: "WorkBuddy 积分提醒",
      body: `${store.settings.privacyMode ? "一个已保存账号" : profile.nickname}${urgent ? "有积分即将到期。" : "积分余额已低于提醒阈值。"}`,
    }).show();
  }
}
async function checkUpdate() {
  let response;
  try {
    response = await net.fetch(
      "https://api.github.com/repos/koi128bit/WorkBuddy-Switch/releases/latest",
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      },
    );
  } catch {
    throw new Error("更新检查失败，请检查网络后重试。");
  }
  if (!response.ok)
    throw new Error(`更新服务暂不可用（HTTP ${response.status}）。`);
  const data = await response.json();
  const match = String(data.tag_name).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error("未找到有效的正式版本。");
  const remote = match.slice(1).map(Number),
    local = app.getVersion().split(".").map(Number);
  let available = false;
  for (let i = 0; i < 3; i++) {
    if (remote[i] !== local[i]) {
      available = remote[i] > local[i];
      break;
    }
  }
  return { available, version: match[0].replace(/^v/, "") };
}
