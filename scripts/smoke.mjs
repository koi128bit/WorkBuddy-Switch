import { _electron as electron } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wb-desktop-smoke-"));
const authFile = path.join(directory, "fixture-auth.info");
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
    dataPath: path.join(directory, "fixture-data"),
    refreshSeconds: 0,
    theme: "light",
  }),
);
const editorStorage = path.join(
  directory,
  ...(process.platform === "win32" ? [] : ["Library", "Application Support"]),
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
    args: ["."],
    env: {
      ...process.env,
      WB_SWITCH_TEST_DIR: directory,
      WB_SWITCH_DEV_URL: "",
    },
  });
  await desktop.firstWindow();
  let page;
  for (let i = 0; i < 80; i++) {
    page = desktop
      .windows()
      .find((window) => window.url() === "workbuddy-switch://app/index.html");
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(page, "main application window is loaded");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "账号", exact: true })
    .waitFor({ timeout: 20000 });
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
  const initial = await page.evaluate(() => window.workbuddy.snapshot());
  assert.equal(initial.current.id, "isolated-fixture");
  assert.equal(initial.accounts.length, 0);
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
  await popup.evaluate(() => window.workbuddy.openPage("settings"));
  await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
  console.log(
    "PASS: native desktop launch, isolated main/popup/editor IPC, system encryption, separate credential vaults, capture, settings and tray navigation",
  );
} finally {
  await desktop?.close();
  await fs.rm(directory, { recursive: true, force: true });
}
