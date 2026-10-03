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
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  History,
  Info,
  LayoutDashboard,
  LockKeyhole,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
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

type Page = "overview" | "accounts" | "sessions" | "usage" | "settings";
const nav = [
  { id: "overview", label: "工作台", icon: LayoutDashboard },
  { id: "accounts", label: "账号管理", icon: Users },
  { id: "sessions", label: "对话记录", icon: MessageSquare },
  { id: "usage", label: "用量分析", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;
const subtitles: Record<Page, string> = {
  overview: "把账号、对话与积分，放回同一个工作节奏。",
  accounts: "安全保存登录状态，在不同工作身份间从容切换。",
  sessions: "找到熟悉的上下文，让每一次对话接着往前。",
  usage: "看清每个模型、每次对话的本地 Token 与记录积分。",
  settings: "让 WorkBuddy Switch 更贴合你的工作方式。",
};
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
  const [page, setPage] = useState<Page>("overview"),
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
  const requestId = useRef(0),
    usageId = useRef(0),
    sessionId = useRef(0),
    api = window.workbuddy;
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
    if (!api) return;
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
  }, [api, query]);
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
  const privacy = state.settings.privacyMode,
    current = state.accounts.find((a) => a.id === state.current?.id);
  const disabled = !!task || state.busy;
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
            <span>SWITCH</span>
          </div>
        </div>
        <div className="workspace-label">个人工作空间</div>
        <nav aria-label="主导航">
          {nav.map(({ id, label, icon: Icon }) => (
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
                <span className="nav-count">{state.accounts.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={17} />
            <div>
              <strong>凭据留在本机</strong>
              <span>
                {state.encryptionAvailable
                  ? "系统级加密已就绪"
                  : "加密服务待解锁"}
              </span>
            </div>
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
        <header className="topbar">
          <div className="breadcrumb">
            工作空间<span>/</span>
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <Status ok={state.client.running === true}>
              {state.client.running
                ? "WorkBuddy 运行中"
                : state.client.installed
                  ? "WorkBuddy 已安装"
                  : "待连接客户端"}
            </Status>
            <button
              className="icon-button"
              title={privacy ? "关闭隐私遮罩" : "开启隐私遮罩"}
              aria-label={privacy ? "关闭隐私遮罩" : "开启隐私遮罩"}
              onClick={() =>
                void saveSettings({ ...state.settings, privacyMode: !privacy })
              }
              disabled={disabled}
            >
              {privacy ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <div className="topbar-avatar">W</div>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR WORK, IN SYNC</div>
              <h1>{nav.find((n) => n.id === page)?.label}</h1>
              <p>{subtitles[page]}</p>
            </div>
            <div className="page-actions">
              {page === "accounts" ? (
                <>
                  <Button
                    icon={Globe}
                    disabled={disabled}
                    onClick={() =>
                      void run("发起网页登录", async () => {
                        setLogin(await api.startLogin());
                      })
                    }
                  >
                    网页登录添加
                  </Button>
                  <Button
                    icon={RefreshCw}
                    busy={state.refreshing}
                    disabled={disabled}
                    onClick={() =>
                      void run("刷新积分", () => api.refreshQuotas())
                    }
                  >
                    刷新积分
                  </Button>
                  <Button
                    icon={Plus}
                    primary
                    disabled={disabled}
                    onClick={() =>
                      void run(
                        "保存账号",
                        () => api.capture(),
                        "当前账号已加密保存",
                      )
                    }
                  >
                    保存当前账号
                  </Button>
                </>
              ) : page === "overview" ? (
                <Button
                  icon={ArrowUpRight}
                  disabled={disabled}
                  onClick={() =>
                    void run("启动 WorkBuddy", () => api.launchClient())
                  }
                >
                  打开 WorkBuddy
                </Button>
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
          {state.authError && !error && (
            <div className="notice warn">
              <Info size={17} />
              <span>{state.authError}</span>
            </div>
          )}
          {page === "overview" && (
            <Overview
              state={state}
              current={current}
              usage={usage}
              usageLabel={
                period === "7"
                  ? "最近 7 天"
                  : period === "1"
                    ? "今天的用量"
                    : period === "30"
                      ? "最近 30 天"
                      : period === "all"
                        ? "全部用量"
                        : "自定义时间段"
              }
              usageScope={usageAccount ? name(usageAccount) : "全部账号"}
              sessions={sessions}
              name={name}
              navigate={setPage}
              resume={resume}
              capture={() =>
                void run("保存账号", () => api.capture(), "当前账号已加密保存")
              }
            />
          )}
          {page === "accounts" && (
            <Accounts
              state={state}
              disabled={disabled}
              switchTo={switchTo}
              edit={setEdit}
              transfer={setTransfer}
              run={run}
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
          {page === "sessions" && (
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
          {page === "usage" && (
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
          <footer className="page-footer">
            <span>
              <span className="tiny-dot" />
              本地工作台 · {state.accounts.length} 个已保存账号
            </span>
            <span>
              {task ||
                (state.refreshing
                  ? "正在查询积分…"
                  : `数据读取于 ${date(usage.fetchedAt, true)}`)}
            </span>
          </footer>
        </div>
      </main>
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

function Overview({
  state,
  current,
  usage,
  usageLabel,
  usageScope,
  sessions,
  name,
  navigate,
  resume,
  capture,
}: {
  state: Snapshot;
  current?: Account;
  usage: Usage;
  usageLabel: string;
  usageScope: string;
  sessions: Session[];
  name: (id: string) => string;
  navigate: (page: Page) => void;
  resume: (s: Session) => void;
  capture: () => void;
}) {
  const q = current?.quota,
    urgent = state.accounts.filter(
      (a) =>
        a.quota?.expiresAt &&
        a.quota.expiresAt - Date.now() <=
          state.settings.expiryWarningDays * 86400000 &&
        !a.quotaError,
    );
  const days = q?.expiresAt
    ? Math.max(0, Math.ceil((q.expiresAt - Date.now()) / 86400000))
    : null;
  const recent = sessions.filter((s) => !s.deleted).slice(0, 4);
  return (
    <>
      <div className="overview-main">
        <section className="account-hero">
          <div className="hero-top">
            <span className="hero-tag">
              <Zap size={14} />
              当前工作身份
            </span>
            <span className="hero-label">WORKBUDDY</span>
          </div>
          <div className="hero-account">
            <div className="account-avatar large">
              {state.current?.nickname.slice(0, 1) || "W"}
            </div>
            <div>
              <h2>
                {state.current
                  ? current?.nickname || state.current.nickname
                  : "连接你的 WorkBuddy"}
              </h2>
              <p>
                {state.current
                  ? `${mask(state.current.id, state.settings.privacyMode)} · ${current ? "账号快照已保存" : "尚未保存账号快照"}`
                  : "先在 WorkBuddy 登录，再保存当前账号"}
              </p>
            </div>
          </div>
          <div className="hero-balance">
            <span>可用积分</span>
            <div>
              {current?.quotaError ? "—" : number(q?.remaining)}
              <small>Credits</small>
            </div>
          </div>
          <div className="balance-track">
            <span
              style={{
                width: `${q && q.total > 0 ? Math.min(100, (q.remaining / q.total) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="hero-detail">
            <span>
              {q
                ? `周期额度 ${number(q.total)} · 已用 ${number(q.used)}`
                : "保存账号后刷新积分，获取实时额度"}
            </span>
            <span>{days !== null ? `${days} 天后到期` : "到期时间待查询"}</span>
          </div>
          <div className="hero-bottom">
            <span>
              <LockKeyhole size={14} />
              凭据由系统加密
            </span>
            {!current && state.current ? (
              <button onClick={capture}>
                保存这个账号
                <ArrowRight size={14} />
              </button>
            ) : (
              <button onClick={() => navigate("accounts")}>
                管理账号
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </section>
        <section className="week-summary">
          <SectionHeader title={usageLabel} detail={`本地记录 · ${usageScope}`}>
            <span className="soft-icon">
              <Activity size={19} />
            </span>
          </SectionHeader>
          <div className="week-value">
            {shortNumber(usage.total.total)}
            <span>Tokens</span>
          </div>
          <UsageChart usage={usage} small />
          <div className="summary-bottom">
            <div>
              <span>已记录积分</span>
              <strong>{number(usage.credits)}</strong>
            </div>
            <div>
              <span>请求次数</span>
              <strong>{number(usage.total.requests, 0)}</strong>
            </div>
            <div>
              <span>活跃模型</span>
              <strong>{usage.models.length}</strong>
            </div>
          </div>
          <TextLink onClick={() => navigate("usage")}>查看用量详情</TextLink>
        </section>
      </div>
      <div className="quick-stats">
        <Metric
          label="已保存账号"
          value={state.accounts.length}
          detail="安全快照，随时切换"
          icon={Users}
        />
        <Metric
          label="本地对话"
          value={sessions.filter((s) => !s.deleted).length}
          detail="保留上下文，继续工作"
          icon={MessageSquare}
        />
        <Metric
          label="积分临期账号"
          value={urgent.length}
          detail={`${state.settings.expiryWarningDays} 天内存在到期积分`}
          icon={Clock3}
        />
      </div>
      <section className="panel">
        <SectionHeader
          title="继续最近的对话"
          detail="上下文还在，工作可以接着来"
        >
          <TextLink onClick={() => navigate("sessions")}>全部对话</TextLink>
        </SectionHeader>
        {recent.length ? (
          <div className="recent-list">
            {recent.map((s) => (
              <div className="recent-row" key={s.id}>
                <span className="session-icon">
                  <MessageSquare size={18} />
                </span>
                <div className="recent-info">
                  <strong>{s.title}</strong>
                  <span>
                    {name(s.userId)}
                    <i>·</i>
                    {s.model || "自动模型"}
                  </span>
                </div>
                <time>{date(s.updatedAt, true)}</time>
                <button
                  className="icon-button"
                  aria-label={`继续 ${s.title}`}
                  disabled={state.busy || !state.current}
                  onClick={() => resume(s)}
                >
                  <ArrowUpRight size={18} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={MessageSquare}
            title="从一段对话开始"
            detail="WorkBuddy 的本地历史对话会显示在这里。"
          />
        )}
      </section>
      {urgent.length > 0 && (
        <div className="notice warn">
          <Bell size={17} />
          <span>{urgent.length} 个账号存在即将到期的积分，建议优先使用。</span>
          <TextLink onClick={() => navigate("accounts")}>查看账号</TextLink>
        </div>
      )}
    </>
  );
}

function Accounts({
  state,
  disabled,
  switchTo,
  edit,
  transfer,
  run,
  remove,
}: {
  state: Snapshot;
  disabled: boolean;
  switchTo: (a: Account) => void;
  edit: (a: Account) => void;
  transfer: (m: "import" | "export") => void;
  run: (
    label: string,
    action: () => Promise<unknown>,
    success?: string,
  ) => Promise<void>;
  remove: (a: Account) => void;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("recent"),
    [filter, setFilter] = useState("all"),
    [openMenu, setOpenMenu] = useState("");
  const accounts = useMemo(
    () =>
      state.accounts
        .filter(
          (a) =>
            `${a.nickname} ${a.note} ${a.id}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (filter !== "favorites" || a.favorite),
        )
        .sort((a, b) => {
          if (a.id === state.current?.id) return -1;
          if (b.id === state.current?.id) return 1;
          if (sort === "balance")
            return (b.quota?.remaining ?? -1) - (a.quota?.remaining ?? -1);
          if (sort === "expiry")
            return (
              (a.quota?.expiresAt ?? Infinity) -
              (b.quota?.expiresAt ?? Infinity)
            );
          return b.lastUsedAt - a.lastUsedAt;
        }),
    [state.accounts, state.current, search, sort, filter],
  );
  const valid = state.accounts.filter((a) => a.quota && !a.quotaError),
    balance = valid.reduce((n, a) => n + a.quota!.remaining, 0);
  return (
    <>
      <div className="account-summary-strip">
        <div>
          <span className="soft-icon">
            <Users size={18} />
          </span>
          <span>
            已保存 <strong>{state.accounts.length}</strong> 个账号
          </span>
        </div>
        <span className="strip-divider" />
        <div>
          <span>已查询可用积分</span>
          <strong>{number(balance)}</strong>
          <small>Credits</small>
        </div>
        <span className="summary-caption">
          {valid.length}/{state.accounts.length} 个账号已获取有效额度
        </span>
      </div>
      <div className="filter-toolbar">
        <div className="tabs">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            全部账号<span>{state.accounts.length}</span>
          </button>
          <button
            className={filter === "favorites" ? "selected" : ""}
            onClick={() => setFilter("favorites")}
          >
            <Pin size={14} />
            已收藏
          </button>
        </div>
        <div className="toolbar-right">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索账号"
              placeholder="搜索账号、备注"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="账号排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">最近使用</option>
            <option value="balance">积分余额</option>
            <option value="expiry">到期优先</option>
          </select>
        </div>
      </div>
      {accounts.length ? (
        <div className="accounts-grid">
          {accounts.map((a, i) => {
            const active = a.id === state.current?.id,
              q = a.quota,
              days = q?.expiresAt
                ? Math.ceil((q.expiresAt - Date.now()) / 86400000)
                : null,
              urgent =
                days !== null && days <= state.settings.expiryWarningDays;
            return (
              <article
                className={`account-card ${active ? "current-card" : ""}`}
                key={a.id}
              >
                <div className="account-card-top">
                  <div className={`account-avatar color-${i % 4}`}>
                    {a.nickname.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="account-title">
                    <h3>
                      {a.nickname}
                      {a.favorite && <Pin size={12} fill="currentColor" />}
                    </h3>
                    <span>{mask(a.id, state.settings.privacyMode)}</span>
                  </div>
                  <div className="card-menu">
                    <button
                      className="icon-button"
                      aria-label={`${a.nickname}的更多操作`}
                      aria-expanded={openMenu === a.id}
                      onClick={() => setOpenMenu(openMenu === a.id ? "" : a.id)}
                    >
                      <Ellipsis size={18} />
                    </button>
                    {openMenu === a.id && (
                      <div className="dropdown">
                        <button
                          onClick={() => {
                            edit(a);
                            setOpenMenu("");
                          }}
                        >
                          编辑名称与备注
                        </button>
                        <button
                          onClick={() => {
                            void run("更新收藏", () =>
                              window.workbuddy.editAccount(a.id, {
                                favorite: !a.favorite,
                              }),
                            );
                            setOpenMenu("");
                          }}
                        >
                          {a.favorite ? "取消收藏" : "收藏账号"}
                        </button>
                        <button
                          onClick={() => {
                            void run("刷新账号积分", () =>
                              window.workbuddy.refreshQuotas(a.id),
                            );
                            setOpenMenu("");
                          }}
                        >
                          刷新这个账号
                        </button>
                        <button
                          className="red"
                          onClick={() => {
                            remove(a);
                            setOpenMenu("");
                          }}
                        >
                          移除账号
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="card-status-row">
                  {active ? (
                    <span className="badge green">
                      <span className="tiny-dot" />
                      当前使用
                    </span>
                  ) : (
                    <span className="badge">
                      {a.accountType || "已保存账号"}
                    </span>
                  )}
                  {a.tokenExpiresAt && a.tokenExpiresAt < Date.now() && (
                    <span className="badge amber">登录可能过期</span>
                  )}
                </div>
                <div className="card-balance">
                  <span>可用积分</span>
                  <strong>
                    {a.quotaError ? "—" : number(q?.remaining)}
                    <small>Credits</small>
                  </strong>
                </div>
                <div className="card-meter">
                  <span
                    style={{
                      width: `${q && q.total ? Math.min(100, (q.remaining / q.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="card-quota-detail">
                  <span>
                    {q && !a.quotaError
                      ? `总额度 ${number(q.total)}`
                      : a.quotaError
                        ? "查询未成功"
                        : "尚未查询积分"}
                  </span>
                  <span>
                    {q ? `更新 ${date(q.fetchedAt, true)}` : "等待刷新"}
                  </span>
                </div>
                {a.quotaError ? (
                  <div className="card-alert">{a.quotaError}</div>
                ) : (
                  <div className={`expiry-row ${urgent ? "urgent" : ""}`}>
                    <Clock3 size={14} />
                    <span>
                      {days !== null
                        ? `${days <= 0 ? "即将" : `${days} 天后`}到期 · ${date(q?.expiresAt)}`
                        : "到期时间未提供"}
                    </span>
                    {urgent && <span>优先使用</span>}
                  </div>
                )}
                {a.note && <p className="account-note">{a.note}</p>}
                <div className="card-footer">
                  <span>
                    <ShieldCheck size={13} />
                    本机加密
                  </span>
                  <Button
                    primary={!active}
                    disabled={disabled || active}
                    icon={active ? Check : ArrowRight}
                    onClick={() => switchTo(a)}
                  >
                    {active ? "当前账号" : "切换账号"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={Users}
          title={
            search || filter === "favorites"
              ? "没有匹配的账号"
              : "保存你的第一个账号"
          }
          detail="在 WorkBuddy 完成登录后，点击右上角「保存当前账号」。切换前也会保存正在使用的身份。"
        />
      )}
      <div className="account-transfer">
        <div>
          <HardDrive size={18} />
          <span>账号备份与迁移</span>
          <small>密码加密，可跨设备导入</small>
        </div>
        <div>
          <Button
            icon={Upload}
            disabled={disabled}
            onClick={() => transfer("import")}
          >
            导入备份
          </Button>
          <Button
            icon={ArrowDownToLine}
            disabled={disabled || !state.accounts.length}
            onClick={() => transfer("export")}
          >
            导出备份
          </Button>
        </div>
      </div>
    </>
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
              "按你的习惯，留在手边或安静待命。",
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
                  label="启动时保存当前账号"
                  description="自动更新当前 WorkBuddy 登录快照，默认关闭。"
                  checked={settings.autoCapture}
                  onChange={(v) => change("autoCapture", v)}
                  disabled={disabled}
                />
                <Toggle
                  label="切换后重新启动 WorkBuddy"
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
                      <div className="theme-preview">
                        <span />
                        <div>
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
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
                  description="缩小卡片间距，在同一窗口看到更多内容。"
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
              "账号备份",
              "加密保存，也能带到另一台设备。",
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
                  <span className="badge green">WorkBuddy 专属</span>
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
                    没有遥测、广告或第三方凭据上传。凭据仅用于 WorkBuddy
                    官方授权与积分接口，账号库采用系统加密。对话和用量在本机处理。
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
              本项目是独立工具，与 WorkBuddy 官方没有隶属关系。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
