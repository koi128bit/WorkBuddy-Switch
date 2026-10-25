import type { Snapshot, Usage, Session } from "../src/types";

export function fixtureState(): Snapshot {
  const now = Date.now();
  const settings = {
    theme: "light" as const,
    privacyMode: true,
    compactMode: false,
    launchAtLogin: false,
    closeToTray: true,
    autoCapture: false,
    refreshSeconds: 300,
    restartAfterSwitch: true,
    expiryWarningDays: 7,
    lowBalanceThreshold: 20,
    notifications: true,
    authPath: "",
    dataPath: "",
    executablePath: "",
    backupLimit: 10,
    autoCheckin: false,
    autoClaimTravel: false,
    autoDepartTravel: false,
    automationIntervalMinutes: 15,
    checkinHour: 9,
    checkinMinute: 0,
    menuBarBalance: true,
    activeProvider: "workbuddy" as const,
    traeDataPath: "",
    traeExecutablePath: "",
    qoderDataPath: "",
    qoderExecutablePath: "",
    traeGlobalDataPath: "",
    traeGlobalExecutablePath: "",
    qoderGlobalDataPath: "",
    qoderGlobalExecutablePath: "",
    workbuddyGlobalAuthPath: "",
    workbuddyGlobalDataPath: "",
    workbuddyGlobalExecutablePath: "",
  };
  const accounts = [
    {
      id: "wb-sample-001",
      nickname: "日常开发",
      total: 600,
      remaining: 428.5,
      days: 21,
      favorite: true,
      note: "主力工作账号 · 日常开发与项目维护",
    },
    {
      id: "wb-sample-002",
      nickname: "个人实验",
      total: 300,
      remaining: 96.2,
      days: 3,
      favorite: false,
      note: "尝试新模型，验证一些有趣的想法",
    },
    {
      id: "wb-sample-003",
      nickname: "团队协作",
      total: 1000,
      remaining: 762.8,
      days: 15,
      favorite: true,
      note: "团队项目与代码审查",
    },
  ].map((a, i) => ({
    ...a,
    originalNickname: a.nickname,
    accountType: "个人账号",
    phoneHint: "138****0000",
    capturedAt: now - 86400000 * 12,
    lastUsedAt: now - i * 3600000,
    tokenExpiresAt: null,
    quotaError: null,
    automaticRewards: true,
    travelLocationId: "2",
    rewards: {
      checkin: {
        checkedIn: i !== 1,
        day: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(now),
        fetchedAt: now,
      },
      checkinError: null,
      travel: {
        state:
          i === 0
            ? ("arrived" as const)
            : i === 1
              ? ("idle" as const)
              : ("traveling" as const),
        locationId: 2,
        locationName: "海边",
        departAt: now - 3600000,
        arriveAt: i === 0 ? now - 300000 : now + 3600000,
        serverNow: now,
        dailyLimitReached: false,
        recordId: 47 + i,
        rewardCredit: null,
        fetchedAt: now,
      },
      travelError: null,
      configError: null,
      travelEnabled: true,
      locations: [
        { id: 2, name: "海边" },
        { id: 3, name: "山间" },
      ],
    },
    quota: {
      total: a.total,
      remaining: a.remaining,
      used: a.total - a.remaining,
      expiresAt: now + a.days * 86400000,
      fetchedAt: now,
      resources: [
        {
          id: a.id,
          name: "基础积分包",
          total: a.total,
          remaining: a.remaining,
          used: a.total - a.remaining,
          expiresAt: now + a.days * 86400000,
          expired: false,
          cycleStartsAt: now - 10 * 86400000,
        },
      ],
    },
  }));
  return {
    demo: true,
    editors: Object.fromEntries(
      (["trae-cn", "trae-global", "qoder-cn", "qoder-global"] as const).map(
        (provider) => {
          const name =
            provider === "trae-cn"
              ? "Trae CN"
              : provider === "trae-global"
                ? "Trae 国际版"
                : provider === "qoder-cn"
                  ? "Qoder CN"
                  : "Qoder 国际版";
          return [
            provider,
            {
              provider,
              name,
              accounts: ["日常开发", "项目测试"].map((label, index) => ({
                id: `${provider}-${index}`,
                nickname: `${name} ${label}`,
                note: "演示快照",
                favorite: index === 0,
                capturedAt: now - index * 86400000,
                lastUsedAt: now - index * 3600000,
                automatic: false,
                uid: `demo-${index}`,
                originalNickname: label,
                nativeAvailable: true,
                canRefresh: true,
                source: "native",
                expiresAt: now + 7 * 86400000,
              })),
              currentId: `${provider}-0`,
              hasLogin: true,
              error: null,
              client: {
                installed: true,
                running: false,
                executable: `/Applications/${name}.app`,
              },
              dataPath: `/Users/example/Library/Application Support/${provider === "trae-cn" ? "Trae CN" : "com.qodercn.app.stable"}`,
              recoveryPending: false,
            },
          ];
        },
      ),
    ) as Snapshot["editors"],
    accounts,
    current: {
      id: accounts[0].id,
      nickname: accounts[0].nickname,
      phoneHint: "138****0000",
    },
    settings,
    paths: {
      auth: "/Users/example/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info",
      data: "/Users/example/.workbuddy",
      database: "/Users/example/.workbuddy/workbuddy.db",
      projects: "/Users/example/.workbuddy/projects",
    },
    client: {
      installed: true,
      running: true,
      executable: "/Applications/WorkBuddy.app",
    },
    encryptionAvailable: true,
    busy: false,
    refreshing: false,
    events: [],
    rewardHistory: [],
    authError: null,
    version: "1.6.1",
    platform: "darwin",
    dataDirectory:
      "/Users/example/Library/Application Support/WorkBuddy Switch",
  };
}
export function fixtureSessions(): Session[] {
  return [
    "优化工作台的账号切换流程",
    "为项目补全测试和错误处理",
    "整理本周的开发记录",
    "一起构思一个新的桌面工具",
    "恢复回收站中的旧对话",
  ].map((title, i) => ({
    id: `sample-session-${i}`,
    userId: `wb-sample-00${(i % 3) + 1}`,
    title,
    directory: `/Users/example/Projects/${["workbuddy-switch", "api-service", "weekly-notes", "desktop-tools", "archive"][i]}`,
    status: "completed",
    model: ["DeepSeek-V3.2", "Claude Sonnet 4.5", "GPT-5.2"][i % 3],
    createdAt: Date.now() - 86400000 * 4,
    updatedAt: Date.now() - i * 3600000,
    deleted: i === 4,
  }));
}
export function fixtureUsage(): Usage {
  const tokens = (n: number) => ({
    input: Math.round(n * 0.37),
    output: Math.round(n * 0.12),
    cacheRead: Math.round(n * 0.46),
    cacheWrite: Math.round(n * 0.05),
    reasoning: Math.round(n * 0.02),
    requests: Math.round(n / 6500),
    total: n,
  });
  const days = [126000, 224000, 174000, 342000, 278000, 419000, 296000];
  const total = days.reduce((a, b) => a + b, 0);
  return {
    total: tokens(total),
    credits: 82.4,
    daily: days.map((n, i) => {
      const d = new Date();
      d.setDate(d.getDate() - 6 + i);
      return {
        day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        tokens: tokens(n),
        credits: (i + 3) * 1.7,
      };
    }),
    models: [
      { name: "DeepSeek-V3.2", tokens: tokens(982000), credits: 38.6 },
      { name: "Claude Sonnet 4.5", tokens: tokens(581000), credits: 31.2 },
      { name: "GPT-5.2", tokens: tokens(296000), credits: 12.6 },
    ],
    sessions: fixtureSessions()
      .slice(0, 4)
      .map((s, i) => ({
        id: s.id,
        name: s.title,
        tokens: tokens(394000 - i * 81000),
        credits: 18.4 - i * 2.5,
      })),
    fetchedAt: Date.now(),
    records: 286,
    scannedFiles: 24,
    warnings: [],
  };
}
