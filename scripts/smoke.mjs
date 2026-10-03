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
  const popup = desktop
    .windows()
    .find((window) => window.url().endsWith("#tray"));
  assert.ok(popup, "menu-bar panel is loaded");
  await popup.locator(".tray-footer").waitFor({ state: "attached" });
  await desktop.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith("#tray"),
    );
    panel.setSize(346, 346);
  });
  await popup.waitForFunction(() => innerHeight === 346);
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
    "PASS: native desktop launch, isolated main/popup IPC, system encryption, capture, settings and tray navigation",
  );
} finally {
  await desktop?.close();
  await fs.rm(directory, { recursive: true, force: true });
}
