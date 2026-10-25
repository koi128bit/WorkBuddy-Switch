import { test, expect } from "@playwright/test";
import { fixtureState, fixtureSessions, fixtureUsage } from "./fixtures";
import type { TaskRun } from "../src/types";

test('local API page saves explicit account scope, controls the listener and never renders credentials',async({page})=>{
  await page.evaluate(async()=>{
    const snapshot=await window.workbuddy.snapshot();
    const value={running:false,baseUrl:'http://127.0.0.1:8317/v1',activeRequests:0,hasKey:true,lastError:'',models:[] as {id:string}[],recent:[],totals:{requests:0,succeeded:0,failed:0,inputTokens:0,outputTokens:0,unknownUsage:0},config:{port:8317,autoStart:false,accounts:[] as {provider:string;id:string}[],strategy:'round_robin',maxConcurrency:2,maxOutputTokens:4096,requestsPerMinute:60},accounts:snapshot.accounts.map(account=>({provider:'workbuddy',id:account.id,nickname:account.nickname,available:true,remaining:account.quota?.remaining??null,cooldownUntil:0}))};
    Object.assign(window.workbuddy,{
      apiStatus:async()=>structuredClone(value),
      apiSave:async(config:typeof value.config)=>{value.config=config;value.baseUrl='http://127.0.0.1:'+config.port+'/v1';return structuredClone(value);},
      apiStart:async()=>{value.running=true;return structuredClone(value);},
      apiStop:async()=>{value.running=false;return structuredClone(value);},
      apiCopy:async(kind:string)=>{(window as unknown as {apiCopied:string}).apiCopied=kind;},
      apiRotate:async()=>structuredClone(value),
      apiModels:async()=>({object:'list',data:[{id:'fast-model'},{id:'global:fast-model'}]}),
      apiTest:async(model:string)=>({model,message:'OK'}),
    });
  });
  await page.getByRole('button',{name:'API',exact:true}).click();
  await expect(page.getByRole('heading',{name:'本机 API 服务',exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'用于 API：日常开发',exact:true}).check();
  await page.getByLabel('监听端口',{exact:true}).fill('8319');
  await page.getByLabel('账号调度',{exact:true}).selectOption('expiring');
  await page.getByRole('button',{name:'保存 API 设置',exact:true}).click();
  await page.getByRole('button',{name:'启动服务',exact:true}).click();
  await expect(page.getByText('运行中',{exact:true})).toBeVisible();
  await expect(page.getByLabel('监听端口',{exact:true})).toBeDisabled();
  await expect(page.getByText('http://127.0.0.1:8319/v1',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'复制 API Key',exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {apiCopied:string}).apiCopied)).toBe('key');
  expect(await page.locator('body').innerText()).not.toContain('sk-wbs-');
  await page.getByRole('button',{name:'获取模型',exact:true}).click();
  await expect(page.getByRole('option',{name:'global:fast-model',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'测试对话',exact:true}).click();
  await expect(page.getByText('OK',{exact:true})).toBeVisible();
  await page.screenshot({path:'.github/assets/api.png',animations:'disabled'});
  await page.setViewportSize({width:940,height:720});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'outputs/screenshots/v1.7-api-compact.png',animations:'disabled'});
  await page.getByRole('button',{name:'停止服务',exact:true}).click();
  await expect(page.getByText('已停止',{exact:true})).toBeVisible();
});

test("extended task confirmation separates compatibility records from paid actions and shows each manual reason", async ({
  page,
}) => {
  await page.evaluate(() => {
    const previous = window.workbuddy.prepareTasks;
    window.workbuddy.prepareTasks = async (ids, options) => {
      const plan = await previous(ids, options);
      return {
        ...plan,
        maxActivities: plan.accountIds.length,
        accounts: plan.accounts.map((account) => ({
          ...account,
          tasks: [
            ...account.tasks,
            {
              code: "Library_read",
              title: "查看资料库",
              kind: "library",
              model: null,
              modelName: "兼容活动上报",
              calls: 0,
              actions: 1,
              current: 0,
              target: 1,
              resources: [],
              waitingForUnlock: false,
            },
          ],
          pendingReasons: [
            {
              code: "wb_wechat_oa_subscribe_task",
              title: "关注官方公众号",
              reason: "需要本人在微信关注官方公众号。",
            },
          ],
          pendingTitles: ["关注官方公众号"],
        })),
      };
    };
  });
  await page.getByRole("button", { name: "一键做任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "执行前确认" });
  await expect(
    dialog.getByRole("switch", { name: "包含活动事件任务", exact: true }),
  ).toBeChecked();
  await expect(dialog).toContainText("不会生成画布或长期定时任务");
  await expect(dialog).toContainText("主题任务会应用官方主题");
  await expect(dialog).toContainText("部分体验任务需真实对话，已计入上限");
  await expect(dialog).toContainText("最多 1 次活动");
  await dialog
    .getByText(/需本人操作或暂不可执行/)
    .first()
    .click();
  await expect(
    dialog.getByText("需要本人在微信关注官方公众号。").first(),
  ).toBeVisible();
  await page.getByLabel("本次对话总上限", { exact: true }).fill("80");
  await expect(
    dialog.getByRole("button", { name: "更新范围", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "更新范围", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /确认并执行/ }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 940, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("switch", { name: "包含活动事件任务", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "outputs/screenshots/v1.6-task-confirmation.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1260, height: 860 });
  await dialog
    .getByRole("switch", { name: "包含活动事件任务", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".github/assets/task-confirmation.png",
    animations: "disabled",
  });
});

test("one-click tasks respect account selection and expose confirmed and pending results", async ({
  page,
}) => {
  await page
    .getByRole("checkbox", { name: "选择日常开发", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "选择团队协作", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "一键做任务", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "执行前确认" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "执行前确认" })).toContainText(
    "消耗积分",
  );
  await page.getByRole("button", { name: /确认并执行/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { taskIds: string[] }).taskIds),
    )
    .toEqual(["wb-sample-002"]);
  await expect(
    page.getByRole("region", { name: "任务执行进度" }),
  ).toContainText("执行结束");
  await expect(
    page.getByRole("region", { name: "任务执行进度" }),
  ).toContainText("客户端体验任务");
  await expect(
    page.getByRole("region", { name: "任务执行进度" }),
  ).toContainText("待完成");
  await page.screenshot({ path: "outputs/screenshots/v1.3-tasks-light.png" });
  await page.setViewportSize({ width: 940, height: 720 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `outputs/screenshots/v1.3-tasks-compact-${theme}.png`,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: /一键任务 · 执行结束/ }).click();
  await expect(page.getByText("客户端体验任务", { exact: true })).toHaveCount(
    0,
  );
});
test("a running one-click task can be stopped without losing its completed result", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as unknown as { holdTasks: boolean }).holdTasks = true;
  });
  await page.getByRole("button", { name: "一键做任务", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "执行前确认" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "执行前确认" })).toContainText(
    "消耗积分",
  );
  await page.getByRole("button", { name: /确认并执行/ }).click();
  await expect(
    page.getByRole("button", { name: "停止后续任务", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "停止后续任务", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "任务执行进度" }),
  ).toContainText("已停止");
  await expect(
    page.getByRole("region", { name: "任务执行进度" }),
  ).toContainText("每日签到");
});

test("paid task range can be changed or cancelled before any dialogue is sent", async ({
  page,
}) => {
  await page.getByRole("button", { name: "一键做任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "执行前确认" });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { taskIds?: string[] }).taskIds,
    ),
  ).toBeUndefined();
  await page.getByLabel("本次对话总上限", { exact: true }).fill("1");
  await expect(
    dialog.getByRole("button", { name: /确认并执行/ }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "更新范围", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { planOptions: { maxCalls: number } })
            .planOptions.maxCalls,
      ),
    )
    .toBe(1);
  await expect(
    dialog.getByRole("button", { name: /确认并执行/ }),
  ).toBeEnabled();
  await page.screenshot({
    path: "outputs/screenshots/v1.4-task-confirmation.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { taskIds?: string[] }).taskIds,
    ),
  ).toBeUndefined();
});

test("basic task mode remains usable after clearing the optional dialogue inputs", async ({
  page,
}) => {
  await page.getByRole("button", { name: "一键做任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "执行前确认" });
  await page.getByLabel("本次对话总上限", { exact: true }).fill("");
  await page.getByLabel("对话内容", { exact: true }).fill("");
  await page
    .getByRole("switch", { name: "包含真实 AI 对话", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "更新范围", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "更新范围", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "执行基础任务", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "执行基础任务", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "任务执行进度" }),
  ).toContainText("执行结束");
});

test("all six clients can be selected and editor OAuth controls are visible", async ({
  page,
}) => {
  await page.goto("/");
  for (const provider of [
    "workbuddy",
    "workbuddy-global",
    "trae-cn",
    "trae-global",
    "qoder-cn",
    "qoder-global",
  ]) {
    await page.getByLabel("切换客户端", { exact: true }).selectOption(provider);
    await expect(
      page.getByRole("heading", { name: "账号", exact: true }),
    ).toBeVisible();
    if (provider.startsWith("trae") || provider.startsWith("qoder")) {
      await expect(
        page.getByRole("button", { name: "网页登录", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "保存当前账号", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "积分", exact: true }),
      ).toHaveCount(0);
    }
    if (provider === "workbuddy-global")
      await expect(
        page.getByRole("button", { name: "一键领积分", exact: true }),
      ).toHaveCount(0);
  }
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ snapshot, sessions, usage }) => {
      const saved = localStorage.getItem("fixture-settings");
      if (saved) snapshot.settings = JSON.parse(saved);
      const listeners = new Set<() => void>();
      const changed = () => listeners.forEach((callback) => callback());
      let finishTasks: ((run: TaskRun) => void) | undefined;
      let planCounter = 0;
      const bridge = {
        snapshot: async () => structuredClone(snapshot),
        prepareTasks: async (
          ids: string[],
          options: { includeAI: boolean; maxCalls: number; prompt: string },
        ) => {
          (window as unknown as { planOptions: typeof options }).planOptions =
            options;
          let budget = options.includeAI ? options.maxCalls : 0,
            total = 0;
          const accounts = ids.map((accountId) => {
            const calls = Math.min(2, budget);
            budget -= calls;
            total += calls;
            return {
              accountId,
              nickname: snapshot.accounts.find(
                (account) => account.id === accountId,
              )!.nickname,
              tasks: calls
                ? [
                    {
                      code: "chat_5",
                      title: "真实对话体验",
                      model: "fast-model",
                      modelName: "快速模式",
                      calls,
                      current: 0,
                      target: 5,
                    },
                  ]
                : [],
              pendingTitles: ["专家团任务"],
              note: calls ? "" : "仅基础任务",
            };
          });
          return {
            id: `plan-${++planCounter}`,
            createdAt: Date.now(),
            expiresAt: Date.now() + 600000,
            accountIds: ids,
            options,
            outputLimit: 64,
            maxCalls: total,
            accounts,
          };
        },
        runTasks: async (ids: string[]) => {
          (window as unknown as { taskIds: string[] }).taskIds = ids;
          const now = Date.now(),
            dialogueCount = (
              window as unknown as { planOptions?: { includeAI: boolean } }
            ).planOptions?.includeAI
              ? 1
              : 0;
          const result: TaskRun = {
            id: "task-fixture",
            status: "running",
            startedAt: now,
            finishedAt: null,
            accountIds: ids,
            totalAccounts: ids.length,
            completedAccounts: 0,
            currentAccountId: ids[0],
            currentStep: "读取官方任务状态",
            dialogueAttempts: dialogueCount,
            dialogueLimit: dialogueCount ? 2 : 0,
            cancelRequested: false,
            summary: {
              claimed: 1,
              accepted: 1,
              departed: 0,
              pending: 1,
              skipped: 0,
              failed: 0,
              credit: 0.25,
              energy: 0,
              unknownAmounts: 0,
              dialogues: dialogueCount,
            },
            results: [
              {
                id: "task-result-1",
                accountId: ids[0],
                code: "checkin",
                title: "每日签到",
                status: "claimed",
                credit: 0.25,
                energy: null,
                detail: "官方奖励已领取",
                at: now,
              },
              {
                id: "task-result-2",
                accountId: ids[0],
                code: "todo",
                title: "客户端体验任务",
                status: "pending",
                credit: null,
                energy: null,
                detail: "请在官方客户端完成实际操作",
                at: now,
              },
            ],
          };
          if (dialogueCount)
            result.results.push({
              id: "task-dialogue-result",
              accountId: ids[0],
              code: "chat_5",
              title: "真实对话 · 快速模式",
              status: "dialogue",
              credit: null,
              energy: null,
              detail: "已收到完整回复；积分消耗以官方计费为准。",
              at: now,
            });
          const account = snapshot.accounts.find(
            (account) => account.id === ids[0],
          );
          if (account?.rewards?.checkin)
            account.rewards.checkin.checkedIn = true;
          snapshot.taskRun = result;
          snapshot.busy = true;
          changed();
          if ((window as unknown as { holdTasks?: boolean }).holdTasks)
            return new Promise<TaskRun>((resolve) => {
              finishTasks = resolve;
            });
          result.status = "completed";
          result.completedAccounts = ids.length;
          result.finishedAt = Date.now();
          snapshot.busy = false;
          changed();
          return structuredClone(result);
        },
        cancelTasks: async () => {
          const run = snapshot.taskRun!;
          run.status = "cancelled";
          run.cancelRequested = true;
          run.finishedAt = Date.now();
          snapshot.busy = false;
          changed();
          finishTasks?.(structuredClone(run));
          return true;
        },
        workbuddyScope: async (
          _provider: string,
          method: string,
          _args: unknown[],
        ) => {
          if (method === "sessions") return sessions;
          if (method === "usage") return usage;
          return null;
        },
        refreshEditor: async () => {},
        captureEditor: async (
          provider: "trae-cn" | "qoder-cn",
          nickname: string,
        ) => {
          const editor = snapshot.editors![provider];
          const account = {
            ...editor.accounts[0],
            id: `${provider}-captured`,
            nickname,
          };
          editor.accounts.push(account);
          editor.currentId = account.id;
          changed();
          return account;
        },
        switchEditor: async (provider: "trae-cn" | "qoder-cn", id: string) => {
          snapshot.editors![provider].currentId = id;
          changed();
        },
        editEditor: async (
          provider: "trae-cn" | "qoder-cn",
          id: string,
          patch: object,
        ) => {
          const account = snapshot.editors![provider].accounts.find(
            (item) => item.id === id,
          )!;
          Object.assign(account, patch);
          changed();
        },
        removeEditor: async (provider: "trae-cn" | "qoder-cn", id: string) => {
          snapshot.editors![provider].accounts = snapshot.editors![
            provider
          ].accounts.filter((item) => item.id !== id);
          changed();
        },
        launchEditor: async () => {},
        restoreEditor: async () => {},
        keepCurrentEditor: async (provider: "trae-cn" | "qoder-cn") => {
          snapshot.editors![provider].recoveryPending = false;
          changed();
        },
        traySwitchEditor: async () => true,
        chooseEditorPath: async () => null,
        sessions: async () => sessions,
        usage: async (q: unknown) => {
          (window as unknown as { lastQuery: unknown }).lastQuery = q;
          return usage;
        },
        capture: async () => snapshot.accounts[0],
        refreshQuotas: async () => {},
        refreshRewards: async () => {},
        claimRewards: async (ids: string[] | null = null, kind = "all") => {
          const targets = snapshot.accounts.filter(
            (account) => !ids || ids.includes(account.id),
          );
          let claimed = 0;
          for (const account of targets) {
            if (
              kind !== "travel" &&
              account.rewards?.checkin &&
              !account.rewards.checkin.checkedIn
            ) {
              account.rewards.checkin.checkedIn = true;
              claimed++;
            }
            if (
              kind !== "checkin" &&
              account.rewards?.travel?.state === "arrived"
            ) {
              account.rewards.travel.state = "idle";
              account.rewards.travel.dailyLimitReached = true;
              claimed++;
            }
          }
          (window as unknown as { claimedIds: string[] | null }).claimedIds =
            ids;
          changed();
          return {
            results: [],
            claimed,
            failed: 0,
            credit: claimed * 0.25,
            unknownAmounts: 0,
          };
        },
        departTravel: async (id: string) => {
          const account = snapshot.accounts.find((item) => item.id === id)!;
          if (account.rewards?.travel)
            account.rewards.travel.state = "traveling";
          changed();
        },
        onNavigate: () => () => {},
        openPage: async () => {},
        traySwitch: async () => true,
        quit: async () => {},
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
    page.getByRole("heading", { name: "账号", exact: true }),
  ).toBeVisible();
});

test("all five WorkBuddy pages render under the WorkBuddy client", async ({
  page,
}) => {
  for (const label of ["积分", "对话", "用量", "设置", "账号"]) {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: label })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "切换客户端" }),
    ).toHaveValue("workbuddy");
  }
});
test("domestic client accounts, capture, edit and confirmed switching stay isolated", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "切换客户端" })
    .selectOption("trae-cn");
  await expect(
    page.getByRole("region", { name: "Trae CN 登录快照" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "积分", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存当前账号", exact: true }).click();
  await page
    .getByRole("textbox", { name: "账号名称", exact: true })
    .fill("Trae 客户端 A");
  await page.getByRole("button", { name: "保存快照", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trae 客户端 A" }),
  ).toBeVisible();
  const other = page
    .locator(".editor-table-row")
    .filter({ hasText: "Trae CN 项目测试" });
  await other.getByRole("button", { name: "切换", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("正常退出 Trae CN");
  await page.getByRole("button", { name: "切换账号", exact: true }).click();
  await expect(other).toContainText("当前快照");
  await page
    .getByRole("combobox", { name: "切换客户端" })
    .selectOption("qoder-cn");
  await expect(
    page.getByRole("region", { name: "Qoder CN 登录快照" }),
  ).toBeVisible();
  await expect(page.locator(".editor-table-row")).not.toContainText([
    "Trae 客户端 A",
  ]);
  await page
    .getByRole("combobox", { name: "切换客户端" })
    .selectOption("workbuddy");
  await expect(page.locator(".account-card")).toHaveCount(3);
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "积分", exact: true }),
  ).toBeVisible();
});
test("attention filter surfaces the expiring credit package and suggests its account", async ({
  page,
}) => {
  await expect(
    page.locator(".account-card").filter({ hasText: "个人实验" }),
  ).toContainText("建议先用");
  await page.getByRole("button", { name: /需关注/ }).click();
  await expect(page.locator(".account-card")).toHaveCount(1);
  await page.getByRole("button", { name: "查看个人实验" }).click();
  await expect(page.locator(".quota-breakdown")).toContainText(
    "96.2 积分将在 7 天内到期",
  );
});
test("preserving a newer domestic login unblocks switching while keeping recovery archived", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const bridge = window.workbuddy,
      state = await bridge.snapshot();
    state.settings.activeProvider = "trae-cn";
    state.editors!["trae-cn"].recoveryPending = true;
    bridge.snapshot = async () => structuredClone(state);
    bridge.keepCurrentEditor = async () => {
      state.editors!["trae-cn"].recoveryPending = false;
      await bridge.saveSettings(state.settings);
    };
    await bridge.saveSettings(state.settings);
  });
  await page
    .getByRole("button", { name: "保留当前登录并归档", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("旧恢复记录归档保留");
  await page.getByRole("button", { name: "保留并归档", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复切换前登录", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".editor-table-row")
      .filter({ hasText: "Trae CN 项目测试" })
      .getByRole("button", { name: "切换", exact: true }),
  ).toBeEnabled();
});
test("domestic client pages and popup keep the native layout at minimum size", async ({
  page,
}) => {
  for (const provider of ["trae-cn", "qoder-cn"] as const) {
    await page
      .getByRole("combobox", { name: "切换客户端" })
      .selectOption(provider);
    await page.setViewportSize({ width: 1260, height: 860 });
    await page.locator(".toast").waitFor({ state: "hidden" });
    await page.screenshot({
      path: `.github/assets/${provider}.png`,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 940, height: 640 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".page-content")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "保存当前账号", exact: true }),
    ).toBeVisible();
  }
  await page.goto("/#tray");
  await page.reload();
  await page.setViewportSize({ width: 346, height: 346 });
  await expect(
    page.getByRole("combobox", { name: "快捷面板客户端" }),
  ).toHaveValue("qoder-cn");
  await expect(
    page.getByRole("button", { name: "一键领积分", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".tray-account")).toHaveCount(2);
  await page.screenshot({
    path: ".github/assets/tray-qoder-cn.png",
    animations: "disabled",
  });
});
test("account search, editing and favorites affect the visible account list", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号" })
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
    .getByRole("button", { name: "账号" })
    .click();
  await page
    .locator(".account-card")
    .filter({ hasText: "个人实验" })
    .getByRole("button", { name: "切换", exact: true })
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
  await page.getByRole("switch", { name: "切换后重新启动客户端" }).click();
  await expect(
    page.getByRole("switch", { name: "切换后重新启动客户端" }),
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
    .getByRole("button", { name: "对话" })
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
    .getByRole("button", { name: "用量" })
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
    .getByRole("button", { name: "账号" })
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
    .getByRole("button", { name: "账号" })
    .click();
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "当前客户端继续使用原来的身份",
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
    .getByRole("button", { name: "账号" })
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
test("one-click rewards respect selected accounts and update visible official task state", async ({
  page,
}) => {
  await page
    .getByRole("checkbox", { name: "选择日常开发", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "选择团队协作", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "一键领积分", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { claimedIds: string[] }).claimedIds,
      ),
    )
    .toEqual(["wb-sample-002"]);
  await expect(
    page.locator(".account-card").filter({ hasText: "个人实验" }),
  ).toContainText("已签到");
  await expect(
    page.getByRole("status").filter({ hasText: "已领取 1 项奖励" }),
  ).toBeVisible();
});
test("travel departure and automation settings are usable and persisted", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "积分", exact: true })
    .click();
  await page.getByRole("button", { name: /个人实验/ }).click();
  await page.getByLabel("旅行地点").selectOption("3");
  await page.getByRole("button", { name: "出发", exact: true }).click();
  await expect(page.locator(".account-tasks")).toContainText("旅行中");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "自动任务", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "自动签到领积分", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "自动签到领积分", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("每日签到时间").fill("10:15");
  await page.reload();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "自动任务", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "自动签到领积分", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("每日签到时间")).toHaveValue("10:15");
  await page.screenshot({
    path: ".github/assets/automation.png",
    animations: "disabled",
  });
});
test("native popup layout shows the original icon, credits and reward actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 346, height: 424 });
  await page.goto("/#tray");
  await page.reload();
  await expect(
    page.getByRole("main", { name: "菜单栏快捷面板" }),
  ).toBeVisible();
  await expect(page.getByAltText("WorkBuddy Switch")).toBeVisible();
  await expect(page.locator(".tray-account")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "一键领积分", exact: true }),
  ).toBeEnabled();
  await page.evaluate(async () => {
    const state = await window.workbuddy.snapshot();
    await window.workbuddy.saveSettings({
      ...state.settings,
      theme: "dark",
      privacyMode: false,
    });
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: ".github/assets/tray.png",
    animations: "disabled",
  });
  await page.evaluate(async () => {
    const bridge = window.workbuddy;
    const snapshot = await bridge.snapshot();
    snapshot.accounts = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot.accounts[index % 3],
      id: index === 0 ? snapshot.accounts[0].id : `popup-fixture-${index}`,
    }));
    bridge.snapshot = async () => structuredClone(snapshot);
    await bridge.saveSettings(snapshot.settings);
  });
  await expect(page.locator(".tray-account")).toHaveCount(8);
  const bounds = await page.evaluate(() => ({
    top: document.querySelector(".tray-heading")!.getBoundingClientRect().top,
    bottom: document.querySelector(".tray-footer")!.getBoundingClientRect()
      .bottom,
    height: innerHeight,
  }));
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
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
  await page
    .getByRole("checkbox", { name: "选择个人实验", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "选择团队协作", exact: true })
    .uncheck();
  await capture(".github/assets/workspace.png", "账号");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号" })
    .click();
  await capture(".github/assets/accounts.png", "账号");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "积分", exact: true })
    .click();
  await capture(".github/assets/rewards.png", "积分");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "对话", exact: true })
    .click();
  await capture(".github/assets/sessions.png", "对话");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "用量" })
    .click();
  await capture(".github/assets/analytics.png", "用量");
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
  await capture(".github/assets/dark-settings.png", "设置");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号", exact: true })
    .click();
  await capture(".github/assets/dark.png", "账号");
  await page.setViewportSize({ width: 940, height: 640 });
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "账号" })
    .click();
  await expect(page.locator(".account-card").first()).toBeVisible();
  expect(
    await page
      .locator(".page-content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await capture("test-results/minimum-window.png", "账号");
  for (const label of ["积分", "对话", "用量", "设置"]) {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      `${label} fits the minimum window`,
    ).toBe(true);
  }
});
