import { test, expect } from "@playwright/test";
import { fixtureState, fixtureSessions, fixtureUsage } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ snapshot, sessions, usage }) => {
      const saved = localStorage.getItem("fixture-settings");
      if (saved) snapshot.settings = JSON.parse(saved);
      const listeners = new Set<() => void>();
      const changed = () => listeners.forEach((callback) => callback());
      const bridge = {
        snapshot: async () => structuredClone(snapshot),
        sessions: async () => sessions,
        usage: async (q: unknown) => {
          (window as unknown as { lastQuery: unknown }).lastQuery = q;
          return usage;
        },
        capture: async () => snapshot.accounts[0],
        refreshQuotas: async () => {},
        startLogin: async () => ({
          id: "login-fixture",
          expiresAt: Date.now() + 300000,
        }),
        openLogin: async () => {},
        cancelLogin: async () => {},
        pollLogin: async () => {
          snapshot.accounts.push({
            ...snapshot.accounts[0],
            id: "browser-fixture",
            nickname: "网页测试账号",
          });
          changed();
          return { done: true };
        },
        switchAccount: async (id: string) => {
          const account = snapshot.accounts.find((a) => a.id === id)!;
          snapshot.current = { id, nickname: account.nickname, phoneHint: "" };
          changed();
        },
        editAccount: async (id: string, patch: unknown) => {
          Object.assign(snapshot.accounts.find((a) => a.id === id)!, patch);
          changed();
        },
        removeAccount: async (id: string) => {
          snapshot.accounts = snapshot.accounts.filter((a) => a.id !== id);
          changed();
        },
        saveSettings: async (value: typeof snapshot.settings) => {
          snapshot.settings = value;
          localStorage.setItem("fixture-settings", JSON.stringify(value));
          changed();
          return value;
        },
        choosePath: async () => "/Users/example/selected",
        diagnostics: async () => ({
          checkedAt: Date.now(),
          checks: [
            {
              name: "WorkBuddy 客户端",
              ok: true,
              detail: "/Applications/WorkBuddy.app",
            },
            { name: "系统凭据加密", ok: true, detail: "系统加密服务可用。" },
          ],
        }),
        backups: async () => [],
        backupSessions: async () => "fixture.db",
        openFolder: async () => {},
        exportAccounts: async () => true,
        importAccounts: async () => 1,
        importLegacy: async () => ({ imported: 1, skipped: 0 }),
        exportUsage: async () => true,
        checkUpdate: async () => ({ available: false, version: "1.0.0" }),
        openLink: async () => {},
        launchClient: async () => {},
        resume: async () => {},
        onChange: (callback: () => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      };
      Object.defineProperty(window, "workbuddy", { value: bridge });
    },
    {
      snapshot: fixtureState(),
      sessions: fixtureSessions(),
      usage: fixtureUsage(),
    },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作台", exact: true }),
  ).toBeVisible();
});

test("all five pages render and WorkBuddy is the only managed product", async ({
  page,
}) => {
  for (const label of ["账号管理", "对话记录", "用量分析", "设置", "工作台"]) {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: label })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Trae/i);
  }
});
test("account search, editing and favorites affect the visible account list", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  await page.getByRole("textbox", { name: "搜索账号" }).fill("团队");
  await expect(page.locator(".account-card")).toHaveCount(1);
  await page.getByRole("button", { name: "团队协作的更多操作" }).click();
  await page.getByRole("button", { name: "编辑名称与备注" }).click();
  await page.getByLabel("账号名称", { exact: true }).fill("团队协作新版");
  await page.getByRole("button", { name: "保存信息" }).click();
  await expect(
    page.getByRole("heading", { name: "团队协作新版" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索账号" }).fill("");
  await page.getByRole("button", { name: "已收藏" }).click();
  await expect(page.locator(".account-card")).toHaveCount(2);
});
test("switch requires a concrete confirmation and then reflects current identity", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  await page
    .locator(".account-card")
    .filter({ hasText: "个人实验" })
    .getByRole("button", { name: "切换账号" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("正在运行的任务");
  await expect(page.locator(".current-card")).toContainText("日常开发");
  await page.getByRole("button", { name: "确认切换" }).click();
  await expect(page.locator(".current-card")).toContainText("个人实验");
});
test("settings persist across reload, including dark theme", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("switch", { name: "切换后重新启动 WorkBuddy" }).click();
  await expect(
    page.getByRole("switch", { name: "切换后重新启动 WorkBuddy" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "外观与隐私", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("session search, trash filter and migration notice work", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "对话记录" })
    .click();
  await page.getByRole("textbox", { name: "搜索对话" }).fill("测试");
  await expect(page.locator(".session-table-row")).toHaveCount(1);
  await page.getByRole("button", { name: "迁移并继续", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("原账号将不再拥有");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索对话" }).fill("");
  await page.getByRole("button", { name: /回收站/ }).click();
  await expect(page.locator(".session-table-row")).toHaveCount(1);
});
test("usage filters pass selected identity and inclusive custom date range to backend", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "用量分析" })
    .click();
  await page.getByLabel("用量账号").selectOption("wb-sample-002");
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await page.getByLabel("开始日期").fill("2026-10-01");
  await page.getByLabel("结束日期").fill("2026-10-03");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { lastQuery: { accountId: string } }).lastQuery
            .accountId,
      ),
    )
    .toBe("wb-sample-002");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { lastQuery: { until: number; since: number } })
            .lastQuery.until -
          (window as unknown as { lastQuery: { since: number } }).lastQuery
            .since,
      ),
    )
    .toBe(3 * 86400000);
});
test("backup export requires matching passphrases of at least eight characters", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  const submit = page.getByRole("button", { name: "选择保存位置" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("设置备份密码").fill("long-passphrase");
  await page.getByLabel("再次输入密码").fill("mismatch");
  await expect(submit).toBeDisabled();
  await page.getByLabel("再次输入密码").fill("long-passphrase");
  await expect(submit).toBeEnabled();
});
test("browser authorization completes without switching the current client identity", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  await page.getByRole("button", { name: "网页登录添加", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "不会切换 WorkBuddy 当前登录身份",
  );
  await page
    .getByRole("button", { name: "打开官方登录页", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 6000 });
  await expect(
    page.getByRole("heading", { name: "网页测试账号" }),
  ).toBeVisible();
  await expect(page.locator(".current-card")).toContainText("日常开发");
});
test("dialogs contain keyboard focus and return it to their trigger on close", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  const trigger = page.getByRole("button", { name: "导出备份", exact: true });
  await trigger.click();
  await expect(page.getByRole("button", { name: "关闭弹窗" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "关闭弹窗" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
test("screenshots cover light pages, dark settings and minimum window width", async ({
  page,
}) => {
  const capture = async (file: string, label: string) => {
    await expect(
      page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: file, animations: "disabled" });
  };
  await capture(".github/assets/workspace.png", "工作台");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  await capture(".github/assets/accounts.png", "账号管理");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "用量分析" })
    .click();
  await capture(".github/assets/analytics.png", "用量分析");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await capture(".github/assets/settings.png", "设置");
  await page.getByRole("button", { name: "外观与隐私", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: "设置已保存" }),
  ).not.toBeVisible();
  await capture(".github/assets/dark.png", "设置");
  await page.setViewportSize({ width: 940, height: 640 });
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号管理" })
    .click();
  await expect(page.locator(".account-card").first()).toBeVisible();
  expect(
    await page
      .locator(".page-content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await capture("test-results/minimum-window.png", "账号管理");
});
