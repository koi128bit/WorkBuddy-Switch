import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  Gift,
  CalendarCheck,
  Globe,
  HardDrive,
  History,
  Info,
  LockKeyhole,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import type {
  Account,
  BackupFile,
  Diagnostics,
  Session,
  Settings,
  Snapshot,
  Usage,
  UsageQuery,
  Provider,
} from "./types";
import {
  Button,
  date,
  Empty,
  mask,
  Metric,
  Modal,
  number,
  SectionHeader,
  shortNumber,
  Status,
  TextLink,
  Toggle,
} from "./components";
import appIcon from "../assets/icon.png";
import { Accounts } from "./Accounts";
import { RewardsPage } from "./Rewards";
import { EditorAccounts, EditorPaths, providerNames } from "./EditorAccounts";

type Page = "overview" | "accounts" | "sessions" | "usage" | "settings";
const nav = [
  { id: "accounts", label: "账号", icon: Users },
  { id: "overview", label: "积分", icon: Gift },
  { id: "sessions", label: "对话", icon: MessageSquare },
  { id: "usage", label: "用量", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;
const emptyUsage: Usage = {
  total: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    requests: 0,
    total: 0,
  },
  credits: 0,
  daily: [],
  models: [],
  sessions: [],
  fetchedAt: 0,
  records: 0,
  scannedFiles: 0,
  warnings: [],
};
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
type Confirmation = {
  title: string;
  detail: string;
  action: string;
  danger?: boolean;
  run: () => Promise<unknown>;
};

export function App() {
  const [page, setPage] = useState<Page>("accounts"),
    [state, setState] = useState<Snapshot | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]),
    [usage, setUsage] = useState<Usage>(emptyUsage);
  const [error, setError] = useState(""),
    [sessionError, setSessionError] = useState(""),
    [usageError, setUsageError] = useState("");
  const [task, setTask] = useState(""),
    [toast, setToast] = useState(""),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [login, setLogin] = useState<{ id: string; expiresAt: number } | null>(
    null,
  );
  const [edit, setEdit] = useState<Account | null>(null),
    [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [period, setPeriod] = useState("7"),
    [usageAccount, setUsageAccount] = useState("");
  const [customStart, setCustomStart] = useState(localDay),
    [customEnd, setCustomEnd] = useState(localDay);
  const [selectedAccounts, setSelectedAccounts] = useState<string[] | null>(
    null,
  );
  const requestId = useRef(0),
    usageId = useRef(0),
    sessionId = useRef(0),
    api = window.workbuddy;
  const provider = state?.settings.activeProvider || "workbuddy";
  const query = useMemo<UsageQuery>(() => {
    let since: number | null = null,
      until: number | null = null;
    if (period === "custom") {
      since = new Date(`${customStart}T00:00:00`).getTime();
      until = new Date(`${customEnd}T00:00:00`).getTime() + 86400000;
      if (since >= until) [since, until] = [until - 86400000, since + 86400000];
    } else if (period !== "all") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      since = today.getTime() - (Number(period) - 1) * 86400000;
      until = today.getTime() + 86400000;
    }
    return { accountId: usageAccount || null, since, until };
  }, [period, usageAccount, customStart, customEnd]);
  const reload = useCallback(async () => {
    if (!api) return;
    const id = ++requestId.current;
    try {
      const result = await api.snapshot();
      if (id === requestId.current) setState(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  const loadData = useCallback(async () => {
    if (!api || provider !== "workbuddy") return;
    const currentSessionRequest = ++sessionId.current;
    try {
      const result = await api.sessions();
      if (currentSessionRequest === sessionId.current) {
        setSessions(result);
        setSessionError("");
      }
    } catch (e) {
      if (currentSessionRequest === sessionId.current)
        setSessionError((e as Error).message);
    }
    const id = ++usageId.current;
    try {
      const result = await api.usage(query);
      if (id === usageId.current) {
        setUsage(result);
        setUsageError("");
      }
    } catch (e) {
      if (id === usageId.current) setUsageError((e as Error).message);
    }
  }, [api, query, provider]);
  useEffect(() => {
    if (provider !== "workbuddy")
      setPage((current) => (current === "settings" ? current : "accounts"));
  }, [provider]);
  useEffect(() => {
    void reload();
    if (!api) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = api.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reload();
      }, 160);
    });
    const interval = setInterval(() => {
      void reload();
    }, 15000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [api, reload]);
  useEffect(() => {
    void loadData();
    const timer = setInterval(() => {
      if (!document.hidden && !state?.busy) void loadData();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadData, state?.busy]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const mode = state?.settings.theme || "system",
      media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        mode === "system" ? (media.matches ? "dark" : "light") : mode;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state?.settings.theme]);
  async function run(
    label: string,
    action: () => Promise<unknown>,
    success?: string,
  ) {
    if (task || state?.busy) return;
    setTask(label);
    setError("");
    try {
      const result = await action();
      await reload();
      await loadData();
      if (success && result !== false && result !== null) setToast(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTask("");
    }
  }
  function claim(ids: string[], kind: "all" | "checkin" | "travel" = "all") {
    if (!ids.length) return;
    void run("领取积分", async () => {
      const result = await api.claimRewards(ids, kind);
      setToast(
        result.claimed
          ? `已领取 ${result.claimed} 项奖励${result.unknownAmounts ? "，部分金额未返回" : ` · +${number(result.credit, 4)} 积分`}${result.failed ? `，${result.failed} 项失败` : ""}`
          : result.failed
            ? `${result.failed} 项任务失败，请在积分页查看原因`
            : "当前没有可领取的奖励",
      );
    });
  }
  useEffect(
    () =>
      api?.onNavigate?.((target) => {
        if (nav.some((item) => item.id === target)) setPage(target as Page);
      }),
    [api],
  );
  const saveSettings = async (settings: Settings) => {
    if (task || state?.busy) return;
    setTask("保存设置");
    setError("");
    try {
      await api.saveSettings(settings);
      await reload();
      setToast("设置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTask("");
    }
  };
  function switchTo(account: Account) {
    setConfirmation({
      title: "切换 WorkBuddy 账号",
      detail: `将切换到「${account.nickname}」。WorkBuddy 会先退出，请确保正在运行的任务已结束。当前登录状态会自动保存。`,
      action: "确认切换",
      run: () => api.switchAccount(account.id),
    });
  }
  function resume(session: Session) {
    const changes = session.userId !== state?.current?.id || session.deleted;
    if (changes)
      setConfirmation({
        title: session.deleted ? "恢复并继续对话" : "迁移到当前账号",
        detail:
          "WorkBuddy 会先退出，并备份整个对话数据库。随后将这条对话归属调整到当前账号，再打开对话。原账号将不再拥有这条本地对话。",
        action: "备份并继续",
        run: () => api.resume(session.id),
      });
    else void run("打开对话", () => api.resume(session.id));
  }
  if (!api)
    return (
      <div className="standalone">
        <ShieldCheck size={40} />
        <h1>WorkBuddy Switch</h1>
        <p>请通过已安装的桌面应用打开工作台。</p>
      </div>
    );
  if (!state)
    return (
      <div className="standalone">
        <img src={appIcon} width={64} height={64} alt="WorkBuddy Switch" />
        <h1>WorkBuddy Switch</h1>
        <p>{error || "正在读取本机工作台…"}</p>
        {error && <Button onClick={() => void reload()}>重新加载</Button>}
      </div>
    );
  const privacy = state.settings.privacyMode;
  const editor = provider !== "workbuddy" ? state.editors?.[provider] : null;
  const currentClient = editor?.client || state.client;
  const clientName = providerNames[provider];
  const disabled = !!task || state.busy;
  const selected =
    selectedAccounts === null
      ? state.accounts.map((account) => account.id)
      : selectedAccounts.filter((id) =>
          state.accounts.some((account) => account.id === id),
        );
  const lastRefresh = Math.max(
    0,
    ...state.accounts.map((account) => account.quota?.fetchedAt || 0),
  );
  const clientStatus =
    currentClient.running === true
      ? `${clientName} 运行中`
      : currentClient.running === null
        ? "运行状态未知"
        : currentClient.installed
          ? `${clientName} 未运行`
          : `未找到 ${clientName}`;
  const name = (id: string) =>
    state.accounts.find((a) => a.id === id)?.nickname ||
    (state.current?.id === id ? state.current.nickname : mask(id, privacy));
  return (
    <div
      className={`app ${state.settings.compactMode ? "compact" : ""} platform-${state.platform}`}
    >
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand">
          <span className="brand-mark product-icon">
            <img src={appIcon} alt="WorkBuddy Switch" />
          </span>
          <div>
            <strong>WorkBuddy</strong>
            <span>Switch</span>
          </div>
        </div>

        <label className="provider-switcher">
          <span>客户端</span>
          <select
            aria-label="切换客户端"
            disabled={disabled}
            value={provider}
            onChange={(event) => {
              setPage("accounts");
              setError("");
              void saveSettings({
                ...state.settings,
                activeProvider: event.target.value as Provider,
              });
            }}
          >
            <option value="workbuddy">WorkBuddy</option>
            <option value="trae-cn">Trae CN</option>
            <option value="qoder-cn">Qoder CN</option>
          </select>
        </label>
        <nav aria-label="主导航">
          {nav
            .filter(
              (item) =>
                provider === "workbuddy" ||
                item.id === "accounts" ||
                item.id === "settings",
            )
            .map(({ id, label, icon: Icon }) => (
              <button
                className={`nav-item ${page === id ? "active" : ""}`}
                aria-label={label}
                aria-current={page === id ? "page" : undefined}
                key={id}
                onClick={() => {
                  setPage(id);
                  setError("");
                }}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {id === "accounts" && (
                  <span className="nav-count">
                    {editor ? editor.accounts.length : state.accounts.length}
                  </span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-current">
            <small>当前账号</small>
            <strong>
              {provider === "workbuddy"
                ? state.current
                  ? name(state.current.id)
                  : "尚未登录"
                : editor?.accounts.find(
                    (account) => account.id === editor.currentId,
                  )?.nickname || "未匹配保存快照"}
            </strong>
            <span>
              {provider !== "workbuddy"
                ? clientName
                : state.current
                  ? mask(state.current.id, privacy)
                  : "打开 WorkBuddy 登录"}
            </span>
          </div>
          <button
            className="sidebar-help"
            onClick={() => void run("打开帮助", () => api.openLink("wiki"))}
          >
            <BookOpen size={16} />
            使用指南
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-version">
            <span>WorkBuddy Switch</span>
            <span>v{state.version}</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar window-drag">
          <span>WorkBuddy Switch</span>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <h1>{nav.find((n) => n.id === page)?.label}</h1>
              <span className="heading-context">
                {page === "accounts"
                  ? `${clientName} · ${editor ? editor.accounts.length : state.accounts.length} 个账号${state.demo ? " · 演示" : ""}`
                  : page === "overview"
                    ? "签到与旅行奖励"
                    : page === "sessions"
                      ? `${sessions.filter((item) => !item.deleted).length} 条本地对话`
                      : page === "usage"
                        ? "本地 Token 记录"
                        : "偏好与自动任务"}
              </span>
            </div>
            <div className="page-actions">
              {provider === "workbuddy" &&
              (page === "accounts" || page === "overview") ? (
                <>
                  <Button
                    icon={RefreshCw}
                    busy={state.refreshing}
                    disabled={disabled}
                    onClick={() =>
                      void run("刷新账号状态", async () => {
                        await api.refreshQuotas();
                        await api.refreshRewards();
                      })
                    }
                  >
                    刷新
                  </Button>
                  {page === "accounts" && (
                    <Button
                      icon={Plus}
                      disabled={disabled}
                      onClick={() =>
                        void run("发起网页登录", async () =>
                          setLogin(await api.startLogin()),
                        )
                      }
                    >
                      添加账号
                    </Button>
                  )}
                  <Button
                    icon={Gift}
                    primary
                    disabled={
                      disabled ||
                      !(page === "accounts"
                        ? selected.length
                        : state.accounts.length)
                    }
                    onClick={() =>
                      claim(
                        page === "accounts"
                          ? selected
                          : state.accounts.map((account) => account.id),
                      )
                    }
                  >
                    一键领积分
                  </Button>
                </>
              ) : page === "usage" ? (
                <Button
                  icon={Download}
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      "导出用量",
                      () => api.exportUsage(query),
                      "用量 CSV 已导出",
                    )
                  }
                >
                  导出 CSV
                </Button>
              ) : null}
            </div>
          </div>
          {error && (
            <div role="alert" className="notice error">
              <Info size={17} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="关闭错误提示"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {provider === "workbuddy" && state.authError && !error && (
            <div className="notice warn">
              <Info size={17} />
              <span>{state.authError}</span>
            </div>
          )}
          {provider === "workbuddy" && page === "overview" && (
            <RewardsPage
              state={state}
              disabled={disabled}
              run={run}
              claim={claim}
            />
          )}
          {provider !== "workbuddy" && page === "accounts" && (
            <EditorAccounts
              key={provider}
              provider={provider}
              state={editor || undefined}
              settings={state.settings}
              disabled={disabled}
              run={run}
            />
          )}
          {provider === "workbuddy" && page === "accounts" && (
            <Accounts
              state={state}
              disabled={disabled}
              switchTo={switchTo}
              edit={setEdit}
              transfer={setTransfer}
              run={run}
              selected={selected}
              setSelected={setSelectedAccounts}
              claim={claim}
              remove={(a) =>
                setConfirmation({
                  title: "移除保存的账号",
                  detail: `移除「${a.nickname}」的登录快照。WorkBuddy 当前登录状态和对话记录会保留。此操作无法撤销，请按需先导出备份。`,
                  action: "移除账号",
                  danger: true,
                  run: () => api.removeAccount(a.id),
                })
              }
            />
          )}
          {provider === "workbuddy" && page === "sessions" && (
            <Sessions
              sessions={sessions}
              error={sessionError}
              currentId={state.current?.id}
              name={name}
              privacy={privacy}
              disabled={disabled}
              resume={resume}
            />
          )}
          {provider === "workbuddy" && page === "usage" && (
            <UsagePage
              usage={usage}
              error={usageError}
              state={state}
              period={period}
              setPeriod={setPeriod}
              account={usageAccount}
              setAccount={setUsageAccount}
              customStart={customStart}
              setCustomStart={setCustomStart}
              customEnd={customEnd}
              setCustomEnd={setCustomEnd}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              state={state}
              disabled={disabled}
              save={saveSettings}
              run={run}
              transfer={setTransfer}
            />
          )}
        </div>
      </main>
      <footer className="app-statusbar" aria-label="应用状态栏">
        <Status ok={currentClient.running === true}>{clientStatus}</Status>
        {provider === "workbuddy" ? (
          <button disabled={disabled} onClick={() => setPage("settings")}>
            自动任务{" "}
            {state.settings.autoCheckin ||
            state.settings.autoClaimTravel ||
            state.settings.autoDepartTravel
              ? "开启"
              : "关闭"}
          </button>
        ) : (
          <span>本机加密快照</span>
        )}
        <span>
          {task ||
            (state.busy
              ? "任务执行中…"
              : provider !== "workbuddy"
                ? "登录状态由客户端确认"
                : state.refreshing
                  ? "正在刷新积分…"
                  : lastRefresh
                    ? `上次刷新 ${new Date(lastRefresh).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                    : "尚未查询积分")}
        </span>
        <button
          className="statusbar-save"
          disabled={disabled}
          onClick={() =>
            provider === "workbuddy"
              ? void run(
                  "保存当前账号",
                  () => api.capture(),
                  "当前账号已加密保存",
                )
              : setPage("accounts")
          }
        >
          {provider === "workbuddy" ? "保存当前账号" : "管理账号"}
        </button>
        <button
          className="icon-button"
          aria-label={privacy ? "关闭隐私遮罩" : "开启隐私遮罩"}
          disabled={disabled}
          onClick={() =>
            void saveSettings({ ...state.settings, privacyMode: !privacy })
          }
        >
          {privacy ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </footer>
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => !task && setConfirmation(null)}
          footer={
            <>
              <Button disabled={!!task} onClick={() => setConfirmation(null)}>
                取消
              </Button>
              <Button
                primary={!confirmation.danger}
                danger={confirmation.danger}
                busy={!!task}
                onClick={() =>
                  void run(
                    confirmation.action,
                    async () => {
                      await confirmation.run();
                      setConfirmation(null);
                    },
                    "操作已完成",
                  )
                }
              >
                {confirmation.action}
              </Button>
            </>
          }
        >
          <div className="confirm-icon">
            <ShieldCheck size={26} />
          </div>
          <p className="confirmation-copy">{confirmation.detail}</p>
        </Modal>
      )}
      {login && (
        <LoginModal
          ticket={login}
          close={() => {
            void api.cancelLogin(login.id);
            setLogin(null);
          }}
          complete={() => {
            setLogin(null);
            setToast("网页登录账号已保存");
            void reload();
          }}
        />
      )}
      {edit && (
        <AccountEditor
          account={edit}
          disabled={disabled}
          close={() => setEdit(null)}
          save={(patch) =>
            void run(
              "保存账号信息",
              async () => {
                await api.editAccount(edit.id, patch);
                setEdit(null);
              },
              "账号信息已保存",
            )
          }
        />
      )}
      {transfer && (
        <TransferModal
          mode={transfer}
          disabled={disabled}
          close={() => setTransfer(null)}
          submit={(password) =>
            void run(
              transfer === "export" ? "导出备份" : "导入备份",
              async () => {
                const result =
                  transfer === "export"
                    ? await api.exportAccounts(password)
                    : await api.importAccounts(password);
                if (result !== false && result !== null) setTransfer(null);
                return result;
              },
              transfer === "export" ? "加密备份已导出" : "账号备份已导入",
            )
          }
        />
      )}
    </div>
  );
}

function Sessions({
  sessions,
  error,
  currentId,
  name,
  privacy,
  disabled,
  resume,
}: {
  sessions: Session[];
  error: string;
  currentId?: string;
  name: (id: string) => string;
  privacy: boolean;
  disabled: boolean;
  resume: (s: Session) => void;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active"),
    [account, setAccount] = useState(""),
    [page, setPage] = useState(0);
  const owners = [...new Set(sessions.map((s) => s.userId))];
  const filtered = sessions.filter(
    (s) =>
      (filter === "trash" ? s.deleted : !s.deleted) &&
      (!account || s.userId === account) &&
      `${s.title} ${s.directory} ${s.model}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const rows = filtered.slice(page * 20, (page + 1) * 20);
  useEffect(() => setPage(0), [search, filter, account]);
  return (
    <>
      <div className="filter-toolbar">
        <div className="tabs">
          <button
            className={filter === "active" ? "selected" : ""}
            onClick={() => setFilter("active")}
          >
            全部对话<span>{sessions.filter((s) => !s.deleted).length}</span>
          </button>
          <button
            className={filter === "trash" ? "selected" : ""}
            onClick={() => setFilter("trash")}
          >
            <Trash2 size={14} />
            回收站<span>{sessions.filter((s) => s.deleted).length}</span>
          </button>
        </div>
        <div className="toolbar-right">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索对话"
              placeholder="搜索标题、工作目录"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="对话账号"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">全部账号</option>
            {owners.map((id) => (
              <option key={id} value={id}>
                {name(id)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div className="notice error">
          <Info size={16} />
          {error}
        </div>
      )}
      <section className="panel session-table">
        {filtered.length ? (
          <>
            <div className="session-table-heading">
              <span>对话 / 工作目录</span>
              <span>所属账号</span>
              <span>最近更新</span>
              <span />
            </div>
            {rows.map((s) => (
              <div className="session-table-row" key={s.id}>
                <div className="session-cell">
                  <span className="session-icon">
                    <MessageSquare size={17} />
                  </span>
                  <div>
                    <strong title={s.title}>{s.title}</strong>
                    <span title={privacy ? undefined : s.directory}>
                      <FolderOpen size={12} />
                      {privacy
                        ? s.directory.split(/[\\/]/).filter(Boolean).pop() ||
                          "未知目录"
                        : s.directory || "未知目录"}
                      <i>·</i>
                      {s.model || "自动模型"}
                    </span>
                  </div>
                </div>
                <div>
                  <span
                    className={`badge ${s.userId === currentId ? "green" : ""}`}
                  >
                    {name(s.userId)}
                  </span>
                </div>
                <time>{date(s.updatedAt, true)}</time>
                <Button
                  disabled={disabled || !currentId}
                  icon={ArrowUpRight}
                  onClick={() => resume(s)}
                >
                  {s.deleted
                    ? "恢复"
                    : s.userId !== currentId
                      ? "迁移并继续"
                      : "继续"}
                </Button>
              </div>
            ))}
          </>
        ) : (
          <Empty
            icon={filter === "trash" ? Trash2 : MessageSquare}
            title={filter === "trash" ? "回收站是空的" : "没有匹配的对话"}
            detail="调整筛选条件，或在 WorkBuddy 中开始一段新的对话。"
          />
        )}
      </section>
      {filtered.length > 20 && (
        <div className="pagination">
          <span>
            {filtered.length} 条对话 · 第 {page + 1} 页
          </span>
          <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <Button
            disabled={(page + 1) * 20 >= filtered.length}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      <div className="inline-note">
        <ShieldCheck size={15} />
        跨账号继续会调整这条本地对话的归属。每次操作前自动备份，可在设置中查看。
      </div>
    </>
  );
}

function UsageChart({
  usage,
  small = false,
}: {
  usage: Usage;
  small?: boolean;
}) {
  const max = Math.max(1, ...usage.daily.map((d) => d.tokens.total));
  const points = usage.daily.length
    ? usage.daily.slice(-30)
    : Array.from({ length: 7 }, (_, i) => ({
        day: `day-${i}`,
        tokens: { total: 0 },
      }));
  return (
    <div
      className={`usage-chart ${small ? "small" : ""}`}
      aria-label="每日 Token 用量"
    >
      <div className="chart-grid">
        <span />
        <span />
        <span />
      </div>
      <div className="chart-bars">
        {points.map((d, i) => (
          <div className="bar-column" key={d.day}>
            <div className="bar-space">
              <span
                className={`chart-bar ${i === points.length - 1 ? "latest" : ""}`}
                style={{
                  height: `${d.tokens.total ? Math.max(3, (d.tokens.total / max) * 100) : 2}%`,
                }}
                title={`${d.day}: ${number(d.tokens.total, 0)} Tokens`}
              />
            </div>
            <span className="bar-label">
              {d.day.startsWith("day") ? "—" : d.day.slice(5).replace("-", "/")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function UsagePage({
  usage,
  error,
  state,
  period,
  setPeriod,
  account,
  setAccount,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
}: {
  usage: Usage;
  error: string;
  state: Snapshot;
  period: string;
  setPeriod: (p: string) => void;
  account: string;
  setAccount: (a: string) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
}) {
  const cache = usage.total.total
    ? Math.round(
        ((usage.total.cacheRead + usage.total.cacheWrite) / usage.total.total) *
          100,
      )
    : 0;
  const [modelSort, setModelSort] = useState("tokens");
  const models = [...usage.models].sort((a, b) =>
    modelSort === "credits"
      ? b.credits - a.credits
      : b.tokens.total - a.tokens.total,
  );
  return (
    <>
      <div className="filter-toolbar usage-filters">
        <div className="tabs">
          {[
            ["1", "今天"],
            ["7", "7 天"],
            ["30", "30 天"],
            ["all", "全部"],
            ["custom", "自定义"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={period === value ? "selected" : ""}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="用量账号"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">全部账号</option>
          {state.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nickname}
            </option>
          ))}
        </select>
      </div>
      {period === "custom" && (
        <div className="custom-range">
          <label>
            开始日期
            <input
              type="date"
              value={customStart}
              onChange={(e) => e.target.value && setCustomStart(e.target.value)}
            />
          </label>
          <span>至</span>
          <label>
            结束日期
            <input
              type="date"
              value={customEnd}
              onChange={(e) => e.target.value && setCustomEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && (
        <div className="notice error">
          <Info size={16} />
          {error}
        </div>
      )}
      {usage.warnings.map((w) => (
        <div key={w} className="notice warn">
          <Info size={16} />
          {w}
        </div>
      ))}
      <div className="usage-metrics">
        <Metric
          label="总 Token"
          value={shortNumber(usage.total.total)}
          detail={`${number(usage.records, 0)} 条有效用量记录`}
          icon={Zap}
        />
        <Metric
          label="记录积分"
          value={number(usage.credits)}
          detail="本地记录中的显式 Credits"
          icon={Gauge}
        />
        <Metric
          label="缓存占比"
          value={`${cache}%`}
          detail={`${shortNumber(usage.total.cacheRead + usage.total.cacheWrite)} 缓存 Tokens`}
          icon={Database}
        />
        <Metric
          label="请求次数"
          value={number(usage.total.requests, 0)}
          detail={`${usage.models.length} 个模型参与工作`}
          icon={Activity}
        />
      </div>
      <section className="panel chart-panel">
        <SectionHeader
          title="Token 使用趋势"
          detail="每日用量 · 缓存 Token 包含在总量中"
        >
          <span className="chart-legend">
            <span className="tiny-dot" />
            Tokens
          </span>
        </SectionHeader>
        <UsageChart usage={usage} />
      </section>
      <div className="usage-bottom">
        <section className="panel">
          <SectionHeader
            title="Token 构成"
            detail="推理 Token 已包含在输出中"
          />
          <div className="token-breakdown">
            {[
              ["输入", usage.total.input, "input"],
              ["输出", usage.total.output, "output"],
              ["缓存读取", usage.total.cacheRead, "read"],
              ["缓存写入", usage.total.cacheWrite, "write"],
            ].map(([label, value, color]) => (
              <div className="breakdown-row" key={String(label)}>
                <span className={`token-dot ${color}`} />
                <span>{label}</span>
                <strong>{number(Number(value), 0)}</strong>
                <small>
                  {usage.total.total
                    ? Math.round((Number(value) / usage.total.total) * 100)
                    : 0}
                  %
                </small>
              </div>
            ))}
            <div className="breakdown-foot">
              其中推理 Token <strong>{number(usage.total.reasoning, 0)}</strong>
            </div>
          </div>
        </section>
        <section className="panel">
          <SectionHeader title="模型用量" detail="按使用量排列">
            <select
              aria-label="模型排序"
              value={modelSort}
              onChange={(e) => setModelSort(e.target.value)}
            >
              <option value="tokens">按 Token</option>
              <option value="credits">按积分</option>
            </select>
          </SectionHeader>
          {models.length ? (
            <div className="model-list">
              {models.slice(0, 8).map((m, i) => (
                <div className="model-row" key={m.name}>
                  <span className="model-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{m.name}</strong>
                    <span>
                      {number(m.tokens.requests, 0)} 次请求 ·{" "}
                      {number(m.credits)} Credits
                    </span>
                  </div>
                  <strong>{shortNumber(m.tokens.total)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="subtle-empty">这个时间段还没有模型使用记录。</p>
          )}
        </section>
      </div>
      <section className="panel">
        <SectionHeader
          title="对话用量排行"
          detail="按 Token 消耗排序 · 显示前 20 条"
        />
        {usage.sessions.length ? (
          <div className="usage-session-list">
            {usage.sessions.slice(0, 20).map((s, i) => (
              <div key={s.id}>
                <span className="model-rank">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <strong>{s.name}</strong>
                <span>{number(s.credits)} Credits</span>
                <strong>
                  {shortNumber(s.tokens.total)}
                  <small>Tokens</small>
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="subtle-empty">这个时间段还没有对话用量记录。</p>
        )}
      </section>
      <div className="inline-note">
        <Info size={15} />
        统计来自本机 {usage.scannedFiles} 个 JSONL
        文件。记录积分与官方账单可能不同；未记录的 Credits 不按 Token 推算。
      </div>
    </>
  );
}

function LoginModal({
  ticket,
  close,
  complete,
}: {
  ticket: { id: string; expiresAt: number };
  close: () => void;
  complete: () => void;
}) {
  const [message, setMessage] = useState("请在官方网页完成登录或扫码授权。"),
    [failure, setFailure] = useState("");
  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(() => {
    let stopped = false,
      running = false;
    const timer = setInterval(async () => {
      if (stopped || running) return;
      if (Date.now() >= ticket.expiresAt) {
        setFailure("授权请求已过期，请关闭弹窗后重新开始。");
        clearInterval(timer);
        return;
      }
      running = true;
      try {
        const result = await window.workbuddy.pollLogin(ticket.id);
        if (!stopped && result.done) {
          clearInterval(timer);
          completeRef.current();
        }
      } catch (e) {
        if (!stopped) {
          setFailure((e as Error).message);
          clearInterval(timer);
        }
      } finally {
        running = false;
      }
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [ticket]);
  return (
    <Modal
      title="网页登录添加账号"
      subtitle="在 WorkBuddy 官方页面授权，登录信息直接加密保存在本机。"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>取消登录</Button>
          <Button
            primary
            icon={ExternalLink}
            disabled={!!failure}
            onClick={() => {
              void window.workbuddy
                .openLogin(ticket.id)
                .then(() =>
                  setMessage("官方授权页面已打开，完成后会自动保存账号。"),
                )
                .catch((e: Error) => setFailure(e.message));
            }}
          >
            打开官方登录页
          </Button>
        </>
      }
    >
      <div className="confirm-icon">
        <Globe size={26} />
      </div>
      <p className="confirmation-copy">{failure || message}</p>
      <div className="inline-note">
        <ShieldCheck size={15} />
        授权有效期 5 分钟。添加账号不会切换 WorkBuddy 当前登录身份。
      </div>
    </Modal>
  );
}
function AccountEditor({
  account,
  disabled,
  close,
  save,
}: {
  account: Account;
  disabled: boolean;
  close: () => void;
  save: (patch: { nickname: string; note: string }) => void;
}) {
  const [nickname, setNickname] = useState(account.nickname),
    [note, setNote] = useState(account.note);
  return (
    <Modal
      title="编辑账号"
      subtitle="为不同工作身份起一个容易辨认的名字。"
      onClose={close}
      footer={
        <>
          <Button onClick={close} disabled={disabled}>
            取消
          </Button>
          <Button
            primary
            disabled={disabled || !nickname.trim()}
            onClick={() => save({ nickname, note })}
          >
            保存信息
          </Button>
        </>
      }
    >
      <label className="form-field">
        账号名称
        <input
          maxLength={80}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </label>
      <label className="form-field">
        备注
        <textarea
          maxLength={300}
          value={note}
          placeholder="例如：日常开发、个人实验、团队协作"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="inline-note">
        <LockKeyhole size={14} />
        名称与备注保存在本机，不会修改 WorkBuddy 资料。
      </div>
    </Modal>
  );
}
function TransferModal({
  mode,
  disabled,
  close,
  submit,
}: {
  mode: "import" | "export";
  disabled: boolean;
  close: () => void;
  submit: (password: string) => void;
}) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  return (
    <Modal
      title={mode === "export" ? "导出加密账号备份" : "导入加密账号备份"}
      subtitle="登录凭据会用密码加密，可在另一台设备上恢复。"
      onClose={close}
      footer={
        <>
          <Button disabled={disabled} onClick={close}>
            取消
          </Button>
          <Button
            icon={mode === "export" ? Download : Upload}
            primary
            disabled={
              disabled ||
              password.length < 8 ||
              (mode === "export" && password !== confirm)
            }
            onClick={() => submit(password)}
          >
            {mode === "export" ? "选择保存位置" : "选择备份文件"}
          </Button>
        </>
      }
    >
      <label className="form-field">
        {mode === "export" ? "设置备份密码" : "备份密码"}
        <input
          type="password"
          autoComplete="off"
          minLength={8}
          maxLength={512}
          placeholder="至少 8 个字符"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {mode === "export" && (
        <label className="form-field">
          再次输入密码
          <input
            type="password"
            autoComplete="off"
            maxLength={512}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      )}
      <div className="notice info">
        <ShieldCheck size={18} />
        <span>
          {mode === "export"
            ? "请妥善保管密码，遗忘后无法恢复。备份包含登录凭据，请勿公开分享。"
            : "仅导入新版 .wbsbackup 加密备份。已存在的账号不会被覆盖。"}
        </span>
      </div>
    </Modal>
  );
}

function SettingsPage({
  state,
  disabled,
  save,
  run,
  transfer,
}: {
  state: Snapshot;
  disabled: boolean;
  save: (s: Settings) => Promise<void>;
  run: (
    label: string,
    action: () => Promise<unknown>,
    success?: string,
  ) => Promise<void>;
  transfer: (m: "import" | "export") => void;
}) {
  const [tab, setTab] = useState("general"),
    [paths, setPaths] = useState({
      authPath: state.settings.authPath,
      dataPath: state.settings.dataPath,
      executablePath: state.settings.executablePath,
    });
  const [diagnostic, setDiagnostic] = useState<Diagnostics | null>(null),
    [backups, setBackups] = useState<BackupFile[]>([]),
    [update, setUpdate] = useState(""),
    [backupError, setBackupError] = useState("");
  useEffect(() => {
    if (tab === "data")
      void window.workbuddy
        .backups()
        .then((files) => {
          setBackups(files);
          setBackupError("");
        })
        .catch((e: Error) => setBackupError(e.message));
  }, [tab]);
  const settings = state.settings,
    change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
      void save({ ...settings, [key]: value });
  const settingsNav = [
    { id: "general", label: "常规", icon: Monitor },
    { id: "automation", label: "自动任务", icon: CalendarCheck },
    { id: "appearance", label: "外观与隐私", icon: Palette },
    { id: "connection", label: "连接与路径", icon: Wifi },
    { id: "data", label: "数据与备份", icon: HardDrive },
    { id: "about", label: "关于与更新", icon: Info },
  ];
  const section = (title: string, detail: string, children: ReactNode) => (
    <section className="settings-section">
      <SectionHeader title={title} detail={detail} />
      <div className="settings-card">{children}</div>
    </section>
  );
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {settingsNav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {tab === "general" && (
          <>
            {section(
              "启动与窗口",
              "系统启动、托盘与账号保存。",
              <>
                <Toggle
                  label="登录系统时启动"
                  description="在 macOS 或 Windows 登录后打开工作台。"
                  checked={settings.launchAtLogin}
                  onChange={(v) => change("launchAtLogin", v)}
                  disabled={disabled}
                />
                <Toggle
                  label="关闭窗口后保留在托盘"
                  description="通过菜单栏或系统托盘随时打开；退出请使用托盘菜单。"
                  checked={settings.closeToTray}
                  onChange={(v) => change("closeToTray", v)}
                  disabled={disabled}
                />
                <Toggle
                  label="菜单栏显示当前积分"
                  description="macOS 在猫咪图标旁显示当前账号的已查询余额。"
                  checked={settings.menuBarBalance}
                  onChange={(v) => change("menuBarBalance", v)}
                  disabled={disabled || state.platform !== "darwin"}
                />
                <Toggle
                  label="启动时保存当前账号"
                  description="自动更新当前 WorkBuddy 登录快照，默认关闭。"
                  checked={settings.autoCapture}
                  onChange={(v) => change("autoCapture", v)}
                  disabled={disabled}
                />
                <Toggle
                  label="切换后重新启动客户端"
                  description="凭据写入完成后，自动打开客户端。"
                  checked={settings.restartAfterSwitch}
                  onChange={(v) => change("restartAfterSwitch", v)}
                  disabled={disabled}
                />
              </>,
            )}
            {section(
              "积分与提醒",
              "提前知道余额与到期，安排下一步工作。",
              <>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">积分自动刷新</div>
                    <div className="setting-description">
                      仅查询已保存账号的官方积分；本地记录每 15 秒读取。
                    </div>
                  </div>
                  <select
                    aria-label="积分自动刷新"
                    disabled={disabled}
                    value={settings.refreshSeconds}
                    onChange={(e) =>
                      change("refreshSeconds", Number(e.target.value))
                    }
                  >
                    {[
                      [0, "仅手动"],
                      [30, "30 秒"],
                      [60, "1 分钟"],
                      [300, "5 分钟"],
                      [600, "10 分钟"],
                      [1800, "30 分钟"],
                    ].map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <Toggle
                  label="桌面积分提醒"
                  description="积分临期或余额偏低时提醒；避免重复通知。"
                  checked={settings.notifications}
                  onChange={(v) => change("notifications", v)}
                  disabled={disabled}
                />
                <div className="setting-row">
                  <div>
                    <div className="setting-label">提前提醒到期</div>
                    <div className="setting-description">
                      在账号页标记即将过期的积分。
                    </div>
                  </div>
                  <select
                    aria-label="提前提醒到期"
                    value={settings.expiryWarningDays}
                    disabled={disabled}
                    onChange={(e) =>
                      change("expiryWarningDays", Number(e.target.value))
                    }
                  >
                    {[1, 3, 7, 14, 30].map((v) => (
                      <option key={v} value={v}>
                        {v} 天
                      </option>
                    ))}
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">低余额阈值</div>
                    <div className="setting-description">
                      余额低于此积分时发送桌面提醒。
                    </div>
                  </div>
                  <select
                    aria-label="低余额阈值"
                    value={settings.lowBalanceThreshold}
                    disabled={disabled}
                    onChange={(e) =>
                      change("lowBalanceThreshold", Number(e.target.value))
                    }
                  >
                    {[0, 10, 20, 50, 100].map((v) => (
                      <option key={v} value={v}>
                        {v} Credits
                      </option>
                    ))}
                  </select>
                </div>
              </>,
            )}
          </>
        )}
        {tab === "automation" && (
          <>
            {section(
              "签到",
              "应用运行时执行，签到时间按北京时间计算。",
              <>
                <Toggle
                  label="自动签到领积分"
                  description="到指定时间后查询官方状态，为尚未签到的账号领取奖励。"
                  checked={settings.autoCheckin}
                  onChange={(value) => change("autoCheckin", value)}
                  disabled={disabled}
                />
                <div className="setting-row">
                  <div>
                    <div className="setting-label">每日签到时间</div>
                    <div className="setting-description">
                      错过时间后，在下一次检查时补签。
                    </div>
                  </div>
                  <input
                    className="time-input"
                    type="time"
                    aria-label="每日签到时间"
                    disabled={disabled}
                    value={`${String(settings.checkinHour).padStart(2, "0")}:${String(settings.checkinMinute).padStart(2, "0")}`}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      const [checkinHour, checkinMinute] = event.target.value
                        .split(":")
                        .map(Number);
                      void save({ ...settings, checkinHour, checkinMinute });
                    }}
                  />
                </div>
              </>,
            )}
            {section(
              "猫猫旅行",
              "领取和出发分别控制，每个账号可选择旅行地点。",
              <>
                <Toggle
                  label="自动领取旅行奖励"
                  description="官方状态变为已到达时领取奖励。"
                  checked={settings.autoClaimTravel}
                  onChange={(value) => change("autoClaimTravel", value)}
                  disabled={disabled}
                />
                <Toggle
                  label="自动派出猫猫旅行"
                  description="仅对已选择地点的账号出发，遵循官方每日次数限制。"
                  checked={settings.autoDepartTravel}
                  onChange={(value) => change("autoDepartTravel", value)}
                  disabled={disabled}
                />
                <div className="setting-row">
                  <div>
                    <div className="setting-label">自动任务检查间隔</div>
                    <div className="setting-description">
                      查询与领取按账号依次执行，避免重复提交。
                    </div>
                  </div>
                  <select
                    aria-label="自动任务检查间隔"
                    value={settings.automationIntervalMinutes}
                    disabled={disabled}
                    onChange={(event) =>
                      change(
                        "automationIntervalMinutes",
                        Number(event.target.value),
                      )
                    }
                  >
                    {[5, 15, 30, 60].map((value) => (
                      <option key={value} value={value}>
                        {value} 分钟
                      </option>
                    ))}
                  </select>
                </div>
              </>,
            )}
            <p className="quiet-note">
              三个自动任务开关默认关闭。在积分页可单独关闭某个账号的自动任务。关闭主窗口并保留在菜单栏或托盘时，自动任务继续执行；退出应用或电脑休眠期间不执行。
            </p>
          </>
        )}
        {tab === "appearance" && (
          <>
            {section(
              "外观",
              "清晰的层次，熟悉的节奏。",
              <>
                <div className="theme-picker">
                  {[
                    { value: "light", label: "浅色", icon: Sun },
                    { value: "dark", label: "深色", icon: Moon },
                    { value: "system", label: "跟随系统", icon: Monitor },
                  ].map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      aria-pressed={settings.theme === value}
                      disabled={disabled}
                      className={`theme-option ${value} ${settings.theme === value ? "selected" : ""}`}
                      onClick={() =>
                        change("theme", value as Settings["theme"])
                      }
                    >
                      <span>
                        <Icon size={15} />
                        {label}
                        {settings.theme === value && <Check size={15} />}
                      </span>
                    </button>
                  ))}
                </div>
                <Toggle
                  label="紧凑布局"
                  description="缩小表格行高和间距，显示更多内容。"
                  checked={settings.compactMode}
                  onChange={(v) => change("compactMode", v)}
                  disabled={disabled}
                />
              </>,
            )}
            {section(
              "隐私",
              "在演示或共享屏幕时，保留一点自己的空间。",
              <>
                <Toggle
                  label="隐私遮罩"
                  description="遮罩账号 ID、缩短工作目录；托盘与通知隐藏账号名称。"
                  checked={settings.privacyMode}
                  onChange={(v) => change("privacyMode", v)}
                  disabled={disabled}
                />
                <div className="privacy-explainer">
                  <ShieldCheck size={23} />
                  <div>
                    <strong>凭据始终由系统加密</strong>
                    <p>
                      macOS 使用钥匙串保护，Windows 使用系统
                      DPAPI。界面不会读取或展示访问 Token。
                    </p>
                  </div>
                </div>
              </>,
            )}
          </>
        )}
        {tab === "connection" && (
          <>
            {section(
              "客户端连接",
              "自动发现安装位置，也支持自定义路径。",
              <>
                <div className="connection-status">
                  <Status ok={state.client.installed}>
                    {state.client.installed
                      ? "已发现 WorkBuddy"
                      : "尚未发现 WorkBuddy"}
                  </Status>
                  <span>{state.client.executable || "请指定安装路径"}</span>
                </div>
                {(
                  [
                    {
                      key: "executablePath",
                      label: "WorkBuddy 安装路径",
                      kind: "executable",
                      placeholder:
                        state.client.executable || "自动发现 .app / .exe",
                    },
                    {
                      key: "authPath",
                      label: "登录信息文件",
                      kind: "auth",
                      placeholder: state.paths.auth,
                    },
                    {
                      key: "dataPath",
                      label: "WorkBuddy 数据目录",
                      kind: "data",
                      placeholder: state.paths.data,
                    },
                  ] as const
                ).map(({ key, label, kind, placeholder }) => (
                  <label className="path-field" key={key}>
                    {label}
                    <div>
                      <input
                        value={paths[key]}
                        placeholder={placeholder}
                        onChange={(e) =>
                          setPaths({ ...paths, [key]: e.target.value })
                        }
                      />
                      <Button
                        disabled={disabled}
                        icon={FolderOpen}
                        onClick={() =>
                          void run("选择路径", async () => {
                            const result =
                              await window.workbuddy.choosePath(kind);
                            if (result)
                              setPaths((p) => ({ ...p, [key]: result }));
                          })
                        }
                      >
                        选择
                      </Button>
                    </div>
                    <small>留空则自动使用默认位置。</small>
                  </label>
                ))}
                <div className="path-actions">
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      setPaths({
                        authPath: "",
                        dataPath: "",
                        executablePath: "",
                      })
                    }
                  >
                    恢复自动发现
                  </Button>
                  <Button
                    primary
                    disabled={disabled}
                    onClick={() => void save({ ...settings, ...paths })}
                  >
                    保存路径配置
                  </Button>
                </div>
              </>,
            )}
            {(["trae-cn", "qoder-cn"] as const).map((provider) => (
              <EditorPaths
                key={provider}
                provider={provider}
                state={state.editors?.[provider]}
                settings={settings}
                disabled={disabled}
                run={run}
              />
            ))}
            {section(
              "连接诊断",
              "检查安装、登录、数据库与文件权限。",
              <>
                <div className="diagnostic-action">
                  <div>
                    <strong>一键检查本机环境</strong>
                    <p>只读取状态，不修改 WorkBuddy 登录信息。</p>
                  </div>
                  <Button
                    icon={Activity}
                    disabled={disabled}
                    onClick={() =>
                      void run("运行诊断", async () =>
                        setDiagnostic(await window.workbuddy.diagnostics()),
                      )
                    }
                  >
                    运行诊断
                  </Button>
                </div>
                {diagnostic && (
                  <div className="diagnostic-results">
                    {diagnostic.checks.map((c) => (
                      <div key={c.name}>
                        <Status ok={c.ok}>{c.name}</Status>
                        <span>{c.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>,
            )}
            <div className="inline-note">
              <Globe size={15} />
              网络请求使用系统代理；积分只访问 WorkBuddy 官方服务。
            </div>
          </>
        )}
        {tab === "data" && (
          <>
            {section(
              "WorkBuddy 账号备份",
              "WorkBuddy 网页授权可跨设备备份；Trae CN 与 Qoder CN 快照仅限本机。",
              <>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">导出账号备份</div>
                    <div className="setting-description">
                      使用你设置的密码加密，支持 macOS 与 Windows 互相导入。
                    </div>
                  </div>
                  <Button
                    icon={Download}
                    disabled={disabled || !state.accounts.length}
                    onClick={() => transfer("export")}
                  >
                    导出
                  </Button>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">导入账号备份</div>
                    <div className="setting-description">
                      现有账号会保留，只添加尚未保存的账号。
                    </div>
                  </div>
                  <Button
                    icon={Upload}
                    disabled={disabled}
                    onClick={() => transfer("import")}
                  >
                    导入
                  </Button>
                </div>
                {state.platform === "darwin" && (
                  <div className="setting-row">
                    <div>
                      <div className="setting-label">迁入旧版 macOS 账号</div>
                      <div className="setting-description">
                        读取 0.x 版钥匙串快照，迁入新版；旧版数据会保留。
                      </div>
                    </div>
                    <Button
                      disabled={disabled}
                      icon={History}
                      onClick={() =>
                        void run(
                          "迁入旧版账号",
                          async () => {
                            const result =
                              await window.workbuddy.importLegacy();
                            if (result.skipped)
                              throw new Error(
                                `已迁入 ${result.imported} 个账号，${result.skipped} 个快照暂无法读取。请解锁钥匙串后重试。`,
                              );
                          },
                          "旧版账号迁入完成",
                        )
                      }
                    >
                      迁入
                    </Button>
                  </div>
                )}
              </>,
            )}
            {section(
              "对话安全备份",
              "每次恢复或跨账号继续前，完整备份数据库。",
              <>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">备份保留数量</div>
                    <div className="setting-description">
                      自动保留最新备份，超出数量后清理最早的文件。
                    </div>
                  </div>
                  <select
                    aria-label="备份保留数量"
                    value={settings.backupLimit}
                    disabled={disabled}
                    onChange={(e) =>
                      change("backupLimit", Number(e.target.value))
                    }
                  >
                    {[5, 10, 20, 50].map((v) => (
                      <option key={v} value={v}>
                        最近 {v} 份
                      </option>
                    ))}
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">立即备份对话数据库</div>
                    <div className="setting-description">
                      包括 SQLite WAL 中尚未写回的记录。
                    </div>
                  </div>
                  <Button
                    icon={Database}
                    disabled={disabled}
                    onClick={() =>
                      void run(
                        "备份对话",
                        async () => {
                          await window.workbuddy.backupSessions();
                          setBackups(await window.workbuddy.backups());
                        },
                        "对话数据库已备份",
                      )
                    }
                  >
                    立即备份
                  </Button>
                </div>
                {backupError && (
                  <div role="alert" className="notice error">
                    {backupError}
                  </div>
                )}
                <div className="backup-list">
                  {!backupError &&
                    (backups.length ? (
                      backups.slice(0, 5).map((b) => (
                        <div key={b.name}>
                          <Database size={15} />
                          <span>{date(b.createdAt, true)}</span>
                          <span>{number(b.size / 1024)} KB</span>
                        </div>
                      ))
                    ) : (
                      <p>还没有对话备份。首次恢复或迁移时会自动创建。</p>
                    ))}
                </div>
                <div className="path-actions">
                  <Button
                    icon={FolderOpen}
                    disabled={disabled}
                    onClick={() =>
                      void run("打开备份目录", () =>
                        window.workbuddy.openFolder("backups"),
                      )
                    }
                  >
                    打开备份目录
                  </Button>
                </div>
              </>,
            )}
            {section(
              "本机存储",
              "凭据和设置只在应用数据目录中保存。",
              <div className="storage-info">
                <HardDrive size={20} />
                <span>{state.dataDirectory}</span>
                <Button
                  icon={FolderOpen}
                  disabled={disabled}
                  onClick={() =>
                    void run("打开数据目录", () =>
                      window.workbuddy.openFolder("application"),
                    )
                  }
                >
                  打开目录
                </Button>
              </div>,
            )}
          </>
        )}
        {tab === "about" && (
          <>
            {section(
              "WorkBuddy Switch",
              "让多个身份下的工作，都能顺畅衔接。",
              <>
                <div className="about-product">
                  <span className="brand-mark product-icon">
                    <img src={appIcon} alt="WorkBuddy Switch" />
                  </span>
                  <div>
                    <h3>WorkBuddy Switch</h3>
                    <p>
                      版本 {state.version} ·{" "}
                      {state.platform === "darwin" ? "macOS" : "Windows"}
                    </p>
                  </div>
                  <span className="badge">三个客户端</span>
                </div>
                <div className="setting-row">
                  <div>
                    <div className="setting-label">检查新版本</div>
                    <div className="setting-description">
                      从本项目 GitHub Releases 查询，下载后手动安装。
                    </div>
                  </div>
                  <Button
                    icon={RefreshCw}
                    disabled={disabled}
                    onClick={() =>
                      void run("检查更新", async () => {
                        const result = await window.workbuddy.checkUpdate();
                        setUpdate(
                          result.available
                            ? `发现新版本 ${result.version}，请前往下载页面安装。`
                            : "当前已经是最新正式版本。",
                        );
                      })
                    }
                  >
                    检查更新
                  </Button>
                </div>
                {update && (
                  <div className="notice info">
                    <Info size={16} />
                    {update}
                  </div>
                )}
                <div className="about-links">
                  <Button
                    icon={ExternalLink}
                    onClick={() => void window.workbuddy.openLink("github")}
                  >
                    GitHub 仓库
                  </Button>
                  <Button
                    icon={BookOpen}
                    onClick={() => void window.workbuddy.openLink("wiki")}
                  >
                    使用 Wiki
                  </Button>
                  <Button
                    icon={Download}
                    onClick={() => void window.workbuddy.openLink("releases")}
                  >
                    下载页面
                  </Button>
                </div>
              </>,
            )}
            {section(
              "隐私与许可",
              "独立社区工具 · MIT 开源许可。",
              <div className="about-privacy">
                <ShieldCheck size={24} />
                <div>
                  <strong>你的账号属于你</strong>
                  <p>
                    没有遥测、广告或第三方凭据上传。WorkBuddy
                    凭据用于官方授权与积分接口；Trae CN 和 Qoder CN
                    快照仅在本机恢复。账号库采用系统加密，对话和用量在本机处理。
                  </p>
                  <TextLink
                    arrow
                    onClick={() => void window.workbuddy.openLink("privacy")}
                  >
                    查看安全与隐私说明
                  </TextLink>
                </div>
              </div>,
            )}
            <p className="about-disclaimer">
              本项目是独立工具，与 WorkBuddy、Trae 和 Qoder 官方没有隶属关系。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
