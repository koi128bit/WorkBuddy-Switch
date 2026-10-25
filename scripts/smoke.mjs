import { _electron as electron } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:net";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wb-desktop-smoke-"));
const authFile = path.join(directory, "fixture-auth.info");
const globalAuthFile = path.join(directory, "fixture-global-auth.info");
const taskFixture = {
  id: "isolated-task",
  status: "running",
  startedAt: Date.now(),
  finishedAt: null,
  accountIds: ["isolated-fixture"],
  totalAccounts: 1,
  completedAccounts: 0,
  currentAccountId: "isolated-fixture",
  currentStep: "读取成长任务",
  cancelRequested: false,
  summary: {
    claimed: 0,
    accepted: 0,
    departed: 0,
    pending: 1,
    skipped: 0,
    failed: 0,
    credit: 0,
    energy: 0,
    unknownAmounts: 0,
  },
  results: [
    {
      id: "isolated-result",
      accountId: "isolated-fixture",
      code: "client-task",
      title: "隔离任务记录",
      status: "pending",
      credit: null,
      energy: null,
      detail: "测试记录，未发送活动请求。",
      at: Date.now(),
    },
  ],
};
await fs.writeFile(
  path.join(directory, "task-run.json"),
  JSON.stringify({ version: 1, run: taskFixture }),
);
await fs.writeFile(
  globalAuthFile,
  JSON.stringify({
    account: { uid: "isolated-global", nickname: "国际版测试" },
    auth: { accessToken: "fake-global-credential", domain: "www.workbuddy.ai" },
  }),
);
await fs.writeFile(
  authFile,
  JSON.stringify({
    account: { uid: "isolated-fixture", nickname: "测试工作空间" },
    auth: { accessToken: "fake-test-credential" },
  }),
);
await fs.writeFile(
  path.join(directory, "settings.json"),
  JSON.stringify({
    authPath: authFile,
    workbuddyGlobalAuthPath: globalAuthFile,
    workbuddyGlobalDataPath: path.join(directory, "fixture-global-data"),
    dataPath: path.join(directory, "fixture-data"),
    refreshSeconds: 0,
    theme: "light",
  }),
);
const editorStorage = path.join(
  directory,
  ...(process.platform === "win32"
    ? []
    : process.platform === "linux"
      ? [".config"]
      : ["Library", "Application Support"]),
  "Trae CN",
  "User",
  "globalStorage",
  "storage.json",
);
await fs.mkdir(path.dirname(editorStorage), { recursive: true });
await fs.writeFile(
  editorStorage,
  JSON.stringify({
    "iCubeAuthInfo://icube.cloudide": "tc:fake-editor-fixture-credential",
  }),
);
let desktop;
try {
  desktop = await electron.launch({
    executablePath: electronPath,
    args: [
      ...(process.platform === "linux"
        ? ["--password-store=gnome-libsecret"]
        : []),
      ".",
    ],
    env: {
      ...process.env,
      WB_SWITCH_TEST_DIR: directory,
      WB_SWITCH_DEV_URL: "",
    },
  });
  await desktop.firstWindow({ timeout: 30000 });
  let page;
  for (let i = 0; i < 80; i++) {
    page = desktop
      .windows()
      .find((window) => window.url() === "workbuddy-switch://app/index.html");
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(page, "main application window is loaded");
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "总览", exact: true })
    .waitFor({ timeout: 20000 });
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号", exact: true })
    .click();
  const security = await desktop.evaluate(({ BrowserWindow }) => {
    const p =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      nodeIntegration: p.nodeIntegration,
      contextIsolation: p.contextIsolation,
    };
  });
  assert.deepEqual(security, {
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  });
  if (process.platform === "linux")
    assert.equal(
      await desktop.evaluate(({ safeStorage }) =>
        safeStorage.getSelectedStorageBackend(),
      ),
      "gnome_libsecret",
      "native Linux smoke uses a real unlocked system keyring",
    );
  const initial = await page.evaluate(() => window.workbuddy.snapshot());
  const apiInitial = await page.evaluate(() => window.workbuddy.apiStatus());
  assert.equal(apiInitial.running, false);
  assert.equal(apiInitial.hasKey, true);
  assert.equal(JSON.stringify(apiInitial).includes("sk-wbs-"), false);
  assert.equal(initial.current.id, "isolated-fixture");
  assert.equal(initial.accounts.length, 0);
  assert.equal(initial.taskRun.status, "interrupted");
  await page
    .getByRole("region", { name: "任务执行进度" })
    .getByText("执行中断", { exact: false })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.workbuddy.cancelTasks("isolated-task")),
    false,
  );
  assert.match(
    await page.evaluate(async () => {
      try {
        await window.workbuddy.runTasks([]);
        return "unexpected";
      } catch (error) {
        return error.message;
      }
    }),
    /选择/,
  );
  assert.equal(Object.keys(initial.editors).length, 4);
  assert.equal(Object.keys(initial.providers).length, 6);
  await page.evaluate(() =>
    window.workbuddy.workbuddyScope("workbuddy-global", "capture", []),
  );
  const globalState = await page.evaluate(() =>
    window.workbuddy.workbuddyScope("workbuddy-global", "snapshot", []),
  );
  assert.equal(globalState.accounts[0].id, "isolated-global");
  assert.equal(
    (await page.evaluate(() => window.workbuddy.snapshot())).accounts.length,
    0,
  );
  assert.equal(
    JSON.stringify(globalState).includes("fake-global-credential"),
    false,
  );
  assert.equal(
    (
      await fs.readFile(
        path.join(directory, "workbuddy-global/vault.json"),
        "utf8",
      )
    ).includes("fake-global-credential"),
    false,
  );
  assert.ok(!JSON.stringify(initial).includes("fake-test-credential"));
  assert.equal(initial.editors["trae-cn"].accounts.length, 0);
  assert.equal(initial.editors["qoder-cn"].accounts.length, 0);
  assert.ok(!JSON.stringify(initial).includes("tc:fake-editor"));
  await page.evaluate(() =>
    window.workbuddy.captureEditor("trae-cn", "隔离客户端测试"),
  );
  const capturedEditor = await page.evaluate(() => window.workbuddy.snapshot());
  assert.equal(capturedEditor.editors["trae-cn"].accounts.length, 1);
  assert.equal(capturedEditor.editors["qoder-cn"].accounts.length, 0);
  assert.equal(capturedEditor.accounts.length, 0);
  assert.ok(
    !(
      await fs.readFile(path.join(directory, "editor-vault.json"), "utf8")
    ).includes("tc:fake-editor"),
  );
  const rejected = await page.evaluate(async () => {
    try {
      await window.workbuddy.switchEditor("qoder-cn", "missing-snapshot");
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(
    rejected,
    "cross-client missing snapshots fail through isolated IPC",
  );
  const popup = desktop
    .windows()
    .find((window) => window.url().endsWith("#tray"));
  assert.ok(popup, "menu-bar panel is loaded");
  popup.setDefaultTimeout(20000);
  await popup.locator(".tray-footer").waitFor({ state: "attached" });
  await desktop.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith("#tray"),
    );
    panel.setContentSize(346, 346);
    panel.show();
  });
  await popup.waitForFunction(
    () => Math.abs(innerWidth - 346) <= 1 && Math.abs(innerHeight - 346) <= 1,
  );
  const panelLayout = await popup.evaluate(() => ({
    headerTop: document.querySelector(".tray-heading").getBoundingClientRect()
      .top,
    footerBottom: document.querySelector(".tray-footer").getBoundingClientRect()
      .bottom,
    height: innerHeight,
  }));
  assert.ok(panelLayout.headerTop >= 0, "empty popup header stays visible");
  assert.ok(
    panelLayout.footerBottom <= panelLayout.height,
    "empty popup footer stays visible",
  );
  await page.evaluate(() => window.workbuddy.capture());
  const after = await page.evaluate(() => window.workbuddy.snapshot());
  assert.equal(after.accounts.length, 1);
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const apiPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await page.evaluate(async (port) => {
    const state = await window.workbuddy.apiStatus();
    await window.workbuddy.apiSave({
      ...state.config,
      port,
      accounts: [{ provider: "workbuddy", id: "isolated-fixture" }],
    });
  }, apiPort);
  const listening = await page.evaluate(() => window.workbuddy.apiStart());
  assert.equal(listening.running, true);
  assert.equal((await fetch(listening.baseUrl + "/models")).status, 401);
  assert.equal(
    (
      await fs.readFile(path.join(directory, "api-gateway.json"), "utf8")
    ).includes("sk-wbs-"),
    false,
  );
  assert.equal(
    await popup.evaluate(async () => {
      try {
        await window.workbuddy.apiCopy("key");
        return false;
      } catch {
        return true;
      }
    }),
    true,
    "tray IPC cannot copy a gateway credential",
  );
  await page.evaluate(() => window.workbuddy.apiStop());
  assert.equal(
    (await page.evaluate(() => window.workbuddy.apiStatus())).running,
    false,
  );
  const taskPlan = await page.evaluate(() =>
    window.workbuddy.prepareTasks(["isolated-fixture"], {
      includeAI: false,
      maxCalls: 1,
      prompt: "隔离测试",
    }),
  );
  assert.equal(taskPlan.maxCalls, 0);
  assert.equal(taskPlan.accountIds[0], "isolated-fixture");
  assert.ok(!JSON.stringify(taskPlan).includes("fake-test-credential"));
  assert.match(
    await page.evaluate(async () => {
      try {
        await window.workbuddy.runTasks(["isolated-fixture"], "invalid-plan");
        return "unexpected";
      } catch (error) {
        return error.message;
      }
    }),
    /范围|确认/,
  );

  const persisted = await fs.readFile(
    path.join(directory, "vault.json"),
    "utf8",
  );
  assert.ok(!persisted.includes("fake-test-credential"));
  await page.evaluate(async () => {
    const state = await window.workbuddy.snapshot();
    await window.workbuddy.saveSettings({
      ...state.settings,
      theme: "dark",
      compactMode: true,
    });
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  const saved = JSON.parse(
    await fs.readFile(path.join(directory, "settings.json"), "utf8"),
  );
  assert.equal(saved.theme, "dark");
  assert.equal(saved.compactMode, true);
  assert.deepEqual(errors, []);
  const popupState = await popup.evaluate(() => window.workbuddy.snapshot());
  assert.equal(popupState.accounts.length, 1);
  assert.ok(!JSON.stringify(popupState).includes("fake-test-credential"));
  await popup.evaluate(() => {
    // Navigation hides this renderer. Observe the main window's result instead
    // of awaiting an IPC promise in a background-throttled Windows popup.
    void window.workbuddy.openPage("settings");
  });
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  console.log(
    "PASS: native desktop launch, isolated main/popup/editor/task IPC, interrupted-task recovery, system encryption, separate credential vaults, capture, settings and tray navigation",
  );
} finally {
  await desktop?.close();
  await fs.rm(directory, { recursive: true, force: true });
}
