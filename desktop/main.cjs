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
  screen,
} = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
let mainWindow,
  trayWindow,
  trayMenu,
  store,
  editorStore,
  editorOAuth,
  tray,
  quitting = false,
  refreshTimer,
  automationTimer,
  tickBusy = false;
const noticeKeys = new Map();
const workbuddyStores = new Map();
let clientDefinitions = {};
function scopedWorkBuddy(provider = "workbuddy") {
  if (!workbuddyStores.has(provider))
    throw new Error("WorkBuddy 客户端地区无效。");
  const target = workbuddyStores.get(provider);
  if (provider === "workbuddy-global")
    target.settings = {
      ...store.settings,
      authPath: store.settings.workbuddyGlobalAuthPath,
      dataPath: store.settings.workbuddyGlobalDataPath,
      executablePath: store.settings.workbuddyGlobalExecutablePath,
      autoCheckin: false,
      autoClaimTravel: false,
      autoDepartTravel: false,
    };
  return target;
}
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
  growth: "https://www.codebuddy.cn/profile/growth-center",
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
  editorOAuth?.close();
  quitting = true;
  clearInterval(refreshTimer);
  clearInterval(automationTimer);
});
app.on("window-all-closed", () => {
  if (!store?.settings.closeToTray) app.quit();
});
app.on("activate", () => showWindow());

function changed() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("wb:changed");
  if (trayWindow && !trayWindow.isDestroyed())
    trayWindow.webContents.send("wb:changed");
  updateTray();
}
function showWindow() {
  trayWindow?.hide();
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}
function openPage(page) {
  if (!["accounts", "overview", "sessions", "usage", "settings"].includes(page))
    throw new Error("页面无效。");
  showWindow();
  const navigate = () => mainWindow.webContents.send("wb:navigate", page);
  if (mainWindow.webContents.isLoadingMainFrame())
    mainWindow.webContents.once("did-finish-load", navigate);
  else navigate();
}
function createApplicationMenu() {
  const mac = process.platform === "darwin";
  app.setAboutPanelOptions({
    applicationName: "WorkBuddy Switch",
    applicationVersion: app.getVersion(),
    copyright: "© koi128bit · MIT License",
    iconPath: path.join(root, "assets/icon.png"),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: mac ? "WorkBuddy Switch" : "应用",
        submenu: [
          { label: "关于 WorkBuddy Switch", role: "about" },
          {
            label: "设置…",
            accelerator: "CmdOrCtrl+,",
            click: () => openPage("settings"),
          },
          { type: "separator" },
          ...(mac
            ? [
                { label: "隐藏 WorkBuddy Switch", role: "hide" },
                { label: "隐藏其他应用", role: "hideOthers" },
                { label: "显示全部", role: "unhide" },
                { type: "separator" },
              ]
            : []),
          { label: "退出 WorkBuddy Switch", role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { label: "撤销", role: "undo" },
          { label: "重做", role: "redo" },
          { type: "separator" },
          { label: "剪切", role: "cut" },
          { label: "复制", role: "copy" },
          { label: "粘贴", role: "paste" },
          { label: "全选", role: "selectAll" },
        ],
      },
      {
        label: "窗口",
        submenu: [
          {
            label: "显示主窗口",
            accelerator: "CmdOrCtrl+1",
            click: showWindow,
          },
          {
            label: "菜单栏快捷面板",
            accelerator: "CmdOrCtrl+Shift+M",
            click: showTray,
          },
          { type: "separator" },
          { label: "最小化", role: "minimize" },
          { label: "缩放", role: "zoom" },
          { label: "关闭窗口", role: "close" },
        ],
      },
      {
        label: "帮助",
        submenu: [
          { label: "使用指南", click: () => shell.openExternal(links.wiki) },
          {
            label: "GitHub 仓库",
            click: () => shell.openExternal(links.github),
          },
          {
            label: "下载更新",
            click: () => shell.openExternal(links.releases),
          },
        ],
      },
    ]),
  );
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: "WorkBuddy Switch",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#252525" : "#fafafa",
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
    } else if (!quitting) {
      app.quit();
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
  const source = [mainWindow, trayWindow].find(
    (window) =>
      window && !window.isDestroyed() && event.sender === window.webContents,
  );
  if (!source || event.senderFrame !== event.sender.mainFrame) return false;
  const url = event.senderFrame.url;
  const suffix = source === trayWindow ? "#tray" : "";
  return (
    url ===
    (devURL
      ? `${devURL}/${suffix}`
      : `workbuddy-switch://app/index.html${suffix}`)
  );
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
    { EditorStore },
    { EditorController, editorDefinition },
    { clients, editorDefinitions },
    { createSystemVault },
    { NativeCredentials },
    { EditorOAuth },
  ] = await Promise.all([
    import("./store.mjs"),
    import("./controller.mjs"),
    import("./files.mjs"),
    import("./usage.mjs"),
    import("./login.mjs"),
    import("./editor-store.mjs"),
    import("./editor-controller.mjs"),
    import("./client-registry.mjs"),
    import("./platform.mjs"),
    import("./native-credentials.mjs"),
    import("./editor-oauth.mjs"),
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
  const vault = createSystemVault(safeStorage);
  const editorContext = testMode
    ? { home: testMode, env: { APPDATA: testMode, LOCALAPPDATA: testMode } }
    : {};
  const controller = new WorkBuddyController(
    () => store?.settings || {},
    editorContext,
  );
  store = new Store({
    directory: app.getPath("userData"),
    vault,
    controller,
    pathsContext: editorContext,
    request: (url, options) => net.fetch(url, options),
    onChange: changed,
  });
  await store.init();
  clientDefinitions = clients;
  workbuddyStores.set("workbuddy", store);
  const globalController = new WorkBuddyController(
    () => scopedWorkBuddy("workbuddy-global").settings,
    { ...editorContext, provider: "workbuddy-global" },
  );
  const globalStore = new Store({
    provider: "workbuddy-global",
    directory: path.join(app.getPath("userData"), "workbuddy-global"),
    vault,
    controller: globalController,
    pathsContext: editorContext,
    request: (url, options) => net.fetch(url, options),
    onChange: changed,
  });
  await globalStore.init();
  workbuddyStores.set("workbuddy-global", globalStore);
  const editorControllers = Object.fromEntries(
    Object.keys(editorDefinitions).map((provider) => [
      provider,
      new EditorController(provider, () => store.settings, editorContext),
    ]),
  );
  const nativeCredentials = new NativeCredentials({
    controllers: editorControllers,
    settings: () => store.settings,
    ...editorContext,
  });
  editorOAuth = new EditorOAuth({
    request: (url, options) => net.fetch(url, options),
    context: (provider, options) =>
      nativeCredentials.context(provider, options),
  });
  editorStore = new EditorStore({
    directory: app.getPath("userData"),
    vault,
    settings: () => store.settings,
    controllers: editorControllers,
    identities: nativeCredentials,
    context: editorContext,
    onChange: changed,
  });
  await editorStore.init();
  handle("editor-refresh", (provider, id) =>
    store.exclusive(async () => {
      const credential = editorStore.credential(provider, string(id, 200));
      const renewed = await editorOAuth.refresh(provider, credential);
      if (renewed.uid !== credential.uid)
        throw new Error("刷新授权的账号身份不一致。");
      await editorStore.saveCredential(provider, renewed);
    }),
  );
  handle("editor-capture", (provider, nickname) =>
    store.exclusive(() => editorStore.capture(provider, string(nickname, 80))),
  );
  handle("editor-switch", (provider, id) =>
    store.exclusive(() => editorStore.switchAccount(provider, string(id, 200))),
  );
  handle("editor-edit", (provider, id, patch) =>
    store.exclusive(() => editorStore.edit(provider, string(id, 200), patch)),
  );
  handle("editor-remove", (provider, id) =>
    store.exclusive(() => editorStore.remove(provider, string(id, 200))),
  );
  handle("editor-restore", (provider) =>
    store.exclusive(() => editorStore.restore(provider)),
  );
  handle("editor-keep-current", (provider) =>
    store.exclusive(() => editorStore.keepCurrent(provider)),
  );
  handle("editor-launch", (provider) => {
    editorDefinition(provider);
    return store.exclusive(() => editorControllers[provider].launch());
  });
  handle("editor-tray-switch", async (provider, id) => {
    const definition = editorDefinition(provider);
    editorStore.record(provider, string(id, 200));
    trayWindow?.hide();
    const result = await dialog.showMessageBox({
      type: "question",
      title: `切换 ${definition.name}`,
      message: `即将正常退出 ${definition.name} 并恢复本机登录快照，请先结束运行中的任务。`,
      buttons: ["取消", "切换账号"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    await store.exclusive(() => editorStore.switchAccount(provider, id));
    return true;
  });
  handle("editor-choose-path", async (provider, kind) => {
    const definition = editorDefinition(provider);
    if (!["data", "executable"].includes(kind))
      throw new Error("路径选择无效。");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `选择 ${definition.name} ${kind === "data" ? "数据根目录" : "应用"}`,
      properties: [kind === "data" ? "openDirectory" : "openFile"],
      ...(kind === "executable" && process.platform === "win32"
        ? { filters: [{ name: definition.name, extensions: ["exe"] }] }
        : {}),
    });
    return result.canceled ? null : result.filePaths[0];
  });
  const logins = Object.fromEntries(
    ["workbuddy", "workbuddy-global"].map((provider) => [
      provider,
      new Login((url, options) => net.fetch(url, options), provider),
    ]),
  );
  const loginFor = (provider) => {
    if (!Object.hasOwn(clients, provider)) throw new Error("授权客户端无效。");
    return logins[provider] || editorOAuth;
  };
  const pollingLogins = new Set();
  handle("login-start", (provider = "workbuddy") => {
    const login = loginFor(provider);
    return login.start(provider);
  });
  handle("login-open", (id, provider = "workbuddy") =>
    shell.openExternal(
      loginFor(provider).require(string(id, 200), provider).url,
    ),
  );
  handle("login-cancel", (id, provider = "workbuddy") => {
    const login = loginFor(provider);
    return logins[provider]
      ? login.cancel(string(id, 200))
      : login.cancel(provider, string(id, 200));
  });
  handle("login-poll", async (id, provider = "workbuddy") => {
    string(id, 200);
    const login = loginFor(provider),
      key = `${provider}:${id}`;
    if (pollingLogins.has(key)) return { done: false };
    pollingLogins.add(key);
    try {
      const document = await (logins[provider]
        ? login.poll(id)
        : login.poll(provider, id));
      if (!document) return { done: false };
      await store.exclusive(async () => {
        login.require(id, provider);
        if (logins[provider]) await scopedWorkBuddy(provider).capture(document);
        else await editorStore.saveCredential(provider, document);
      });
      if (logins[provider]) login.cancel(id);
      else login.cancel(provider, id);
      store.log("网页登录账号已加密保存。");
      return { done: true };
    } finally {
      pollingLogins.delete(key);
    }
  });
  nativeTheme.themeSource = store.settings.theme;
  handle("snapshot", async () => ({
    ...(await scopedWorkBuddy(
      store.settings.activeProvider === "workbuddy-global"
        ? "workbuddy-global"
        : "workbuddy",
    ).snapshot()),
    settings: store.settings,
    providers: Object.fromEntries(
      Object.entries(clients).map(([id, d]) => [
        id,
        {
          name: d.name,
          product: d.product,
          region: d.region,
          program: d.program,
          platforms: d.platforms,
          capabilities: d.capabilities,
        },
      ]),
    ),
    busy: store.busy || globalStore.busy,
    editors: await editorStore.snapshots(),
    version: app.getVersion(),
    platform: process.platform,
    dataDirectory: app.getPath("userData"),
  }));
  handle("workbuddy-scope", async (provider, method, args) => {
    if (
      provider !== "workbuddy-global" ||
      !Array.isArray(args) ||
      args.length > 3
    )
      throw new Error("客户端操作范围无效。");
    const target = scopedWorkBuddy(provider);
    const operations = {
      snapshot: () => target.snapshot(),
      capture: () => target.captureCurrent(),
      switchAccount: () => target.switchAccount(string(args[0], 200)),
      editAccount: () => target.editAccount(string(args[0], 200), args[1]),
      removeAccount: () => target.removeAccount(string(args[0], 200)),
      refreshQuotas: () =>
        target.refreshQuotas(args[0] ? string(args[0], 200) : null),
      sessions: () => target.sessions(),
      usage: () => target.usage(query(args[0])),
      launchClient: () => target.exclusive(() => globalController.launch()),
      diagnostics: () => target.diagnostics(),
      backups: () => target.backups(),
      backupSessions: () => target.backupSessions(),
      resume: () => target.resumeSession(string(args[0], 200), async () => {}),
      exportAccounts: async () => {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: "导出国际版加密账号备份",
          defaultPath: "WorkBuddy-global.wbsbackup",
          filters: [{ name: "加密账号备份", extensions: ["wbsbackup"] }],
        });
        if (result.canceled || !result.filePath) return false;
        await atomicWrite(
          result.filePath,
          await target.exportAccounts(string(args[0], 512)),
        );
        return true;
      },
      importAccounts: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: "导入国际版加密备份",
          properties: ["openFile"],
          filters: [{ name: "加密账号备份", extensions: ["wbsbackup"] }],
        });
        return result.canceled
          ? null
          : target.importAccounts(
              await readBounded(result.filePaths[0]),
              string(args[0], 512),
            );
      },
      exportUsage: async () => {
        const usage = await target.usage(query(args[0]));
        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: "WorkBuddy-global-usage.csv",
        });
        if (result.canceled || !result.filePath) return false;
        await atomicWrite(result.filePath, usageCSV(usage));
        return true;
      },
      openFolder: async () => {
        const folders = {
          application: target.directory,
          backups: target.backupDirectory,
          projects: target.paths.projects,
        };
        if (!Object.hasOwn(folders, args[0])) throw new Error("文件夹无效。");
        if (args[0] === "backups")
          await fs.mkdir(folders.backups, { recursive: true });
        if (await shell.openPath(folders[args[0]]))
          throw new Error("系统无法打开该文件夹。");
      },
      traySwitch: async () => {
        const id = string(args[0], 200);
        if (!target.records.some((r) => r.profile.id === id))
          throw new Error("未找到该账号。");
        trayWindow?.hide();
        const answer = await dialog.showMessageBox({
          type: "question",
          title: "切换 WorkBuddy 国际版",
          message: "请先结束客户端中运行的任务，切换将正常退出客户端。",
          buttons: ["取消", "切换账号"],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return false;
        await target.switchAccount(id);
        return true;
      },
    };
    if (!Object.hasOwn(operations, method))
      throw new Error("此客户端不支持该操作。");
    if (
      ["snapshot", "sessions", "usage", "backups", "diagnostics"].includes(
        method,
      )
    )
      return operations[method]();
    return store.exclusive(operations[method]);
  });
  handle("capture", () => store.captureCurrent());
  handle("switch", (id) => store.switchAccount(string(id, 200)));
  handle("edit", (id, patch) => store.editAccount(string(id, 200), patch));
  handle("remove", (id) => store.removeAccount(string(id, 200)));
  handle("refresh", (id) => store.refreshQuotas(id ? string(id, 200) : null));
  handle("rewards-refresh", (ids) => store.refreshRewards(ids ?? null));
  handle("rewards-claim", (ids, kind) =>
    store.claimRewards(ids ?? null, kind ?? "all"),
  );
  handle("travel-depart", (id, locationId) =>
    store.depart(string(id, 200), string(locationId, 80)),
  );
  handle("sessions", () => store.sessions());
  handle("usage", (q) => store.usage(query(q)));
  handle("resume", (id) =>
    store.resumeSession(string(id, 200), async (sessionId) =>
      shell.openExternal(`workbuddy://chat/${encodeURIComponent(sessionId)}`),
    ),
  );
  handle("launch", () => store.exclusive(() => controller.launch()));
  handle("open-page", openPage);
  handle("tray-switch", async (id) => {
    string(id, 200);
    if (store.busy) throw new Error("已有任务正在执行，请稍候。");
    if (!store.records.some((record) => record.profile.id === id))
      throw new Error("未找到该账号。");
    trayWindow?.hide();
    if ((await store.active())?.id === id) {
      await controller.launch();
      return true;
    }
    const result = await dialog.showMessageBox({
      type: "question",
      title: "切换 WorkBuddy 账号",
      message: "切换将关闭 WorkBuddy。请先结束正在运行的任务。",
      buttons: ["取消", "切换账号"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    await store.switchAccount(id);
    return true;
  });
  handle("quit", () => app.quit());
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
      scheduleAutomation();
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
  createTrayWindow();
  createApplicationMenu();
  scheduleRefresh();
  if (store.settings.autoCapture) {
    try {
      await store.captureCurrent();
    } catch (e) {
      store.log(safeMessage(e), "error");
    }
  }
  scheduleAutomation();
}
function createTray() {
  const image = nativeImage.createFromPath(path.join(root, "assets/icon.png"));
  tray = new Tray(image.resize({ width: 20, height: 20 }));
  tray.setToolTip("WorkBuddy Switch");
  tray.on("click", showTray);
  tray.on("right-click", () => {
    if (process.platform === "darwin" && trayMenu)
      tray.popUpContextMenu(trayMenu);
  });
  updateTray();
}
function createTrayWindow() {
  trayWindow = new BrowserWindow({
    title: "WorkBuddy Switch 菜单栏",
    width: 346,
    height: 470,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    ...(process.platform === "darwin"
      ? { vibrancy: "popover", visualEffectState: "active" }
      : {}),
    backgroundColor: "#00000000",
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  trayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  trayWindow.webContents.on("page-title-updated", (event) =>
    event.preventDefault(),
  );
  trayWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  trayWindow.on("blur", () => trayWindow?.hide());
  trayWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      trayWindow.hide();
    }
  });
  trayWindow.webContents.on("render-process-gone", () => {
    if (!quitting) trayWindow?.destroy();
  });
  if (devURL) trayWindow.loadURL(`${devURL}/#tray`);
  else trayWindow.loadURL("workbuddy-switch://app/index.html#tray");
}
function showTray() {
  if (!trayWindow || trayWindow.isDestroyed()) createTrayWindow();
  if (trayWindow.isVisible()) {
    trayWindow.hide();
    return;
  }
  const bounds = tray.getBounds();
  const work = screen.getDisplayMatching(bounds).workArea;
  const width = 346,
    height = Math.min(
      560,
      300 +
        Math.max(
          1,
          Math.min(
            8,
            ["workbuddy", "workbuddy-global"].includes(
              store.settings.activeProvider,
            )
              ? scopedWorkBuddy(store.settings.activeProvider).records.length
              : editorStore.records.filter(
                  (record) => record.provider === store.settings.activeProvider,
                ).length,
          ),
        ) *
          46,
      work.height - 12,
    );
  const x = Math.max(
    work.x + 6,
    Math.min(
      work.x + work.width - width - 6,
      Math.round(bounds.x + bounds.width / 2 - width / 2),
    ),
  );
  const y =
    bounds.y < work.y + work.height / 2
      ? Math.max(work.y + 4, bounds.y + bounds.height + 4)
      : Math.max(work.y + 6, bounds.y - height - 4);
  trayWindow.setBounds({ x, y, width, height });
  trayWindow.show();
  trayWindow.focus();
  trayWindow.webContents.send("wb:changed");
}
function updateTray() {
  if (!tray) return;
  const provider = store.settings.activeProvider || "workbuddy";
  const clientName = clientDefinitions[provider]?.name || "WorkBuddy";
  const workbuddy = ["workbuddy", "workbuddy-global"].includes(provider)
    ? scopedWorkBuddy(provider)
    : null;
  const accounts = (
    workbuddy
      ? [...workbuddy.records]
      : editorStore?.records.filter((record) => record.provider === provider) ||
        []
  )
    .sort((a, b) => b.profile.lastUsedAt - a.profile.lastUsedAt)
    .slice(0, 8);
  trayMenu = Menu.buildFromTemplate([
    { label: "打开 WorkBuddy Switch", click: showWindow },
    { type: "separator" },
    ...accounts.map((r, i) => ({
      label: store.settings.privacyMode ? `账号 ${i + 1}` : r.profile.nickname,
      enabled: !store.busy && (workbuddy || !!r.encrypted),
      click: async () => {
        const result = await dialog.showMessageBox({
          type: "question",
          title: `切换 ${clientName} 账号`,
          message: `切换将关闭 ${clientName}。请先结束正在运行的任务。`,
          buttons: ["取消", "切换账号"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          try {
            if (workbuddy)
              await (provider === "workbuddy"
                ? workbuddy.switchAccount(r.profile.id)
                : store.exclusive(() => workbuddy.switchAccount(r.profile.id)));
            else
              await store.exclusive(() =>
                editorStore.switchAccount(provider, r.profile.id),
              );
          } catch (error) {
            dialog.showErrorBox("切换未完成", safeMessage(error));
          }
        }
        updateTray();
      },
    })),
    { type: "separator" },
    {
      label: `打开 ${clientName}`,
      enabled: !store.busy,
      click: async () => {
        try {
          await store.exclusive(() =>
            workbuddy
              ? workbuddy.controller.launch()
              : editorStore.controllers[provider].launch(),
          );
        } catch (e) {
          dialog.showErrorBox("启动未完成", safeMessage(e));
        }
      },
    },
    { label: "退出", click: () => app.quit() },
  ]);
  if (process.platform !== "darwin") tray.setContextMenu(trayMenu);
  if (process.platform === "darwin") {
    void (workbuddy ? workbuddy.active() : Promise.resolve(null))
      .then((active) => {
        if (quitting || !tray || tray.isDestroyed()) return;
        const profile = workbuddy?.records.find(
          (record) => record.profile.id === active?.id,
        )?.profile;
        tray.setTitle(
          workbuddy &&
            store.settings.menuBarBalance &&
            profile?.quota &&
            !profile.quotaError
            ? new Intl.NumberFormat("zh-CN", {
                maximumFractionDigits: 4,
              }).format(profile.quota.remaining)
            : "",
        );
      })
      .catch(() => {
        if (!quitting && tray && !tray.isDestroyed()) tray.setTitle("");
      });
  }
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
function scheduleAutomation() {
  clearInterval(automationTimer);
  if (
    testMode ||
    !(
      store.settings.autoCheckin ||
      store.settings.autoClaimTravel ||
      store.settings.autoDepartTravel
    )
  )
    return;
  const run = async () => {
    try {
      await store.runAutomation();
    } catch (error) {
      store.log(safeMessage(error), "error");
    }
  };
  automationTimer = setInterval(run, 60000);
  void run();
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
