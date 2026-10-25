export type Theme = "system" | "light" | "dark";
export type WorkBuddyProvider = "workbuddy" | "workbuddy-global";
export type Provider =
  | WorkBuddyProvider
  | "trae-cn"
  | "trae-global"
  | "qoder-cn"
  | "qoder-global";
export type EditorProvider = Exclude<Provider, WorkBuddyProvider>;
export interface Settings {
  theme: Theme;
  privacyMode: boolean;
  compactMode: boolean;
  launchAtLogin: boolean;
  closeToTray: boolean;
  autoCapture: boolean;
  refreshSeconds: number;
  restartAfterSwitch: boolean;
  expiryWarningDays: number;
  lowBalanceThreshold: number;
  notifications: boolean;
  authPath: string;
  dataPath: string;
  executablePath: string;
  backupLimit: number;
  autoCheckin: boolean;
  autoClaimTravel: boolean;
  autoDepartTravel: boolean;
  automationIntervalMinutes: number;
  checkinHour: number;
  checkinMinute: number;
  menuBarBalance: boolean;
  activeProvider: Provider;
  traeDataPath: string;
  traeExecutablePath: string;
  qoderDataPath: string;
  qoderExecutablePath: string;
  workbuddyGlobalAuthPath: string;
  workbuddyGlobalDataPath: string;
  workbuddyGlobalExecutablePath: string;
  traeGlobalDataPath: string;
  traeGlobalExecutablePath: string;
  qoderGlobalDataPath: string;
  qoderGlobalExecutablePath: string;
}
export interface EditorAccount {
  id: string;
  nickname: string;
  note: string;
  favorite: boolean;
  capturedAt: number;
  lastUsedAt: number;
  automatic: boolean;
  uid?: string | null;
  originalNickname?: string;
  expiresAt?: number | null;
  source?: "web" | "native";
  nativeAvailable?: boolean;
  canRefresh?: boolean;
  identityError?: string | null;
}
export interface EditorSnapshot {
  provider: EditorProvider;
  name: string;
  accounts: EditorAccount[];
  currentId: string | null;
  hasLogin: boolean;
  error: string | null;
  client: Snapshot["client"];
  dataPath: string;
  recoveryPending: boolean;
}
export interface Resource {
  id: string;
  name: string;
  total: number;
  remaining: number;
  used: number;
  expiresAt: number | null;
  expired: boolean;
  cycleStartsAt: number | null;
}
export interface Quota {
  total: number;
  remaining: number;
  used: number;
  expiresAt: number | null;
  fetchedAt: number;
  resources: Resource[];
}
export interface Account {
  id: string;
  nickname: string;
  originalNickname: string;
  accountType: string;
  phoneHint: string;
  capturedAt: number;
  lastUsedAt: number;
  favorite: boolean;
  note: string;
  tokenExpiresAt: number | null;
  quota: Quota | null;
  quotaError: string | null;
  protectedToken?: boolean;
  rewards?: RewardState | null;
  automaticRewards?: boolean;
  travelLocationId?: string;
}
export interface RewardState {
  checkin: { checkedIn: boolean; day: string; fetchedAt: number } | null;
  checkinError: string | null;
  travel: {
    state: "idle" | "traveling" | "arrived";
    locationId: string | number | null;
    locationName: string;
    departAt: number | null;
    arriveAt: number | null;
    serverNow: number | null;
    dailyLimitReached: boolean;
    recordId: number | null;
    rewardCredit: number | null;
    fetchedAt: number;
  } | null;
  travelError: string | null;
  configError: string | null;
  travelEnabled: boolean | null;
  locations: { id: string | number; name: string }[];
}
export interface RewardEntry {
  id: string;
  accountId: string;
  task: "checkin" | "travel" | "depart";
  result: "claimed" | "already" | "departed" | "error";
  credit: number | null;
  detail: string;
  automatic: boolean;
  at: number;
}
export interface ClaimResult {
  results: RewardEntry[];
  claimed: number;
  failed: number;
  credit: number;
  unknownAmounts: number;
}
export interface TaskAction {
  id: string;
  accountId: string;
  code: string;
  title: string;
  status:
    | "claimed"
    | "accepted"
    | "departed"
    | "pending"
    | "skipped"
    | "error"
    | "dialogue"
    | "activity";
  credit: number | null;
  energy: number | null;
  current?: number | null;
  target?: number | null;
  detail: string;
  at: number;
}
export interface TaskOptions {
  includeAI: boolean;
  includeActivities?: boolean;
  maxCalls: number;
  prompt: string;
}
export interface TaskPlan {
  id: string;
  createdAt: number;
  expiresAt: number;
  accountIds: string[];
  options: TaskOptions;
  outputLimit: number;
  maxCalls: number;
  maxActivities?: number;
  accounts: {
    accountId: string;
    nickname: string;
    note: string;
    pendingTitles: string[];
    pendingReasons?: { code: string; title: string; reason: string }[];
    tasks: {
      code: string;
      title: string;
      model: string | null;
      modelName: string;
      calls: number;
      actions?: number;
      kind?: string;
      resources?: {
        id: string;
        name: string;
        type: string;
        title?: string;
        version?: string;
      }[];
      waitingForUnlock?: boolean;
      current: number;
      target: number;
    }[];
  }[];
}
export interface TaskRun {
  id: string;
  status: "running" | "completed" | "cancelled" | "interrupted" | "failed";
  startedAt: number;
  finishedAt: number | null;
  accountIds: string[];
  totalAccounts: number;
  completedAccounts: number;
  currentAccountId: string | null;
  currentStep: string;
  cancelRequested: boolean;
  dialogueAttempts: number;
  dialogueLimit: number;
  activityAttempts?: number;
  activityLimit?: number;
  summary: {
    claimed: number;
    accepted: number;
    departed: number;
    pending: number;
    skipped: number;
    failed: number;
    credit: number;
    energy: number;
    unknownAmounts: number;
    dialogues: number;
    activities?: number;
  };
  results: TaskAction[];
}
export interface Session {
  id: string;
  userId: string;
  title: string;
  directory: string;
  status: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  requests: number;
  total: number;
}
export interface Usage {
  total: Tokens;
  credits: number;
  daily: { day: string; tokens: Tokens; credits: number }[];
  models: { name: string; tokens: Tokens; credits: number }[];
  sessions: { id: string; name: string; tokens: Tokens; credits: number }[];
  fetchedAt: number;
  records: number;
  scannedFiles: number;
  warnings: string[];
}
export interface UsageQuery {
  accountId: string | null;
  since: number | null;
  until: number | null;
}
export interface Snapshot {
  providers?: Record<
    Provider,
    {
      name: string;
      product: string;
      region: string;
      program: string;
      platforms: string[];
      capabilities: Record<string, boolean>;
    }
  >;
  editors?: Record<EditorProvider, EditorSnapshot>;
  demo?: boolean;
  accounts: Account[];
  current: { id: string; nickname: string; phoneHint: string } | null;
  settings: Settings;
  paths: { auth: string; data: string; database: string; projects: string };
  client: {
    installed: boolean;
    running: boolean | null;
    executable: string | null;
  };
  encryptionAvailable: boolean;
  busy: boolean;
  refreshing: boolean;
  events: { id: string; at: number; message: string; level: string }[];
  rewardHistory: RewardEntry[];
  taskRun?: TaskRun | null;
  taskRunWarning?: string | null;
  authError: string | null;
  version: string;
  platform: string;
  dataDirectory: string;
}
export interface Diagnostics {
  checkedAt: number;
  checks: { name: string; ok: boolean; detail: string }[];
}
export interface BackupFile {
  name: string;
  size: number;
  createdAt: number;
}
export interface Bridge {
  apiStatus(): Promise<ApiStatus>;
  apiSave(config: ApiConfig): Promise<ApiStatus>;
  apiStart(): Promise<ApiStatus>;
  apiStop(): Promise<ApiStatus>;
  apiRotate(): Promise<ApiStatus>;
  apiCopy(kind: "key" | "baseUrl" | "curl"): Promise<void>;
  apiModels(): Promise<{
    object: string;
    data: {
      id: string;
      name?: string;
      context_window?: number;
      max_output_tokens?: number;
    }[];
  }>;
  apiTest(model: string): Promise<{ model: string; message: string }>;
  prepareTasks(ids: string[] | null, options: TaskOptions): Promise<TaskPlan>;
  runTasks(ids?: string[] | null, planId?: string | null): Promise<TaskRun>;
  cancelTasks(id: string): Promise<boolean>;
  workbuddyScope(
    provider: WorkBuddyProvider,
    method: string,
    args: unknown[],
  ): Promise<unknown>;
  refreshEditor(provider: EditorProvider, id: string): Promise<void>;
  captureEditor(
    provider: EditorProvider,
    nickname: string,
  ): Promise<EditorAccount>;
  switchEditor(provider: EditorProvider, id: string): Promise<void>;
  editEditor(
    provider: EditorProvider,
    id: string,
    patch: Partial<Pick<EditorAccount, "nickname" | "note" | "favorite">>,
  ): Promise<void>;
  removeEditor(provider: EditorProvider, id: string): Promise<void>;
  restoreEditor(provider: EditorProvider): Promise<void>;
  keepCurrentEditor(provider: EditorProvider): Promise<void>;
  launchEditor(provider: EditorProvider): Promise<void>;
  traySwitchEditor(provider: EditorProvider, id: string): Promise<boolean>;
  chooseEditorPath(
    provider: EditorProvider,
    kind: "data" | "executable",
  ): Promise<string | null>;
  snapshot(): Promise<Snapshot>;
  capture(): Promise<Account>;
  switchAccount(id: string): Promise<void>;
  editAccount(
    id: string,
    patch: Partial<
      Pick<
        Account,
        | "nickname"
        | "note"
        | "favorite"
        | "automaticRewards"
        | "travelLocationId"
      >
    >,
  ): Promise<void>;
  removeAccount(id: string): Promise<void>;
  refreshQuotas(id?: string): Promise<void>;
  refreshRewards(ids?: string[] | null): Promise<void>;
  claimRewards(
    ids?: string[] | null,
    kind?: "all" | "checkin" | "travel",
  ): Promise<ClaimResult>;
  departTravel(id: string, locationId: string): Promise<void>;
  openPage(
    page: "accounts" | "overview" | "sessions" | "usage" | "settings" | "api",
  ): Promise<void>;
  traySwitch(id: string): Promise<boolean>;
  quit(): Promise<void>;
  onNavigate(callback: (page: string) => void): () => void;
  sessions(): Promise<Session[]>;
  usage(query: UsageQuery): Promise<Usage>;
  resume(id: string): Promise<void>;
  saveSettings(value: Settings): Promise<Settings>;
  choosePath(kind: "auth" | "data" | "executable"): Promise<string | null>;
  diagnostics(): Promise<Diagnostics>;
  backups(): Promise<BackupFile[]>;
  backupSessions(): Promise<string>;
  openFolder(kind: "application" | "backups" | "projects"): Promise<void>;
  exportAccounts(password: string): Promise<boolean>;
  importAccounts(password: string): Promise<number | null>;
  importLegacy(): Promise<{ imported: number; skipped: number }>;
  exportUsage(query: UsageQuery): Promise<boolean>;
  checkUpdate(): Promise<{ available: boolean; version: string }>;
  openLink(
    name: "github" | "wiki" | "releases" | "privacy" | "growth",
  ): Promise<void>;
  launchClient(): Promise<void>;
  onChange(callback: () => void): () => void;
  startLogin(provider?: Provider): Promise<{ id: string; expiresAt: number }>;
  pollLogin(id: string, provider?: Provider): Promise<{ done: boolean }>;
  openLogin(id: string, provider?: Provider): Promise<void>;
  cancelLogin(id: string, provider?: Provider): Promise<void>;
}
export interface ApiConfig {
  port: number;
  autoStart: boolean;
  accounts: { provider: WorkBuddyProvider; id: string }[];
  strategy: "round_robin" | "sequential" | "expiring";
  maxConcurrency: number;
  maxOutputTokens: number;
  requestsPerMinute: number;
}
export interface ApiStatus {
  running: boolean;
  baseUrl: string;
  activeRequests: number;
  hasKey: boolean;
  config: ApiConfig;
  accounts: {
    provider: WorkBuddyProvider;
    id: string;
    nickname: string;
    available: boolean;
    remaining: number | null;
    cooldownUntil: number;
  }[];
  totals: {
    requests: number;
    succeeded: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    unknownUsage: number;
  };
  recent: {
    requestId: string;
    at: number;
    model: string;
    provider: WorkBuddyProvider;
    accountId: string;
    status: "ok" | "error" | "cancelled";
    statusCode: number;
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    errorCode: string;
  }[];
  lastError: string;
  models: { id: string; name?: string }[];
}
declare global {
  interface Window {
    workbuddy: Bridge;
  }
}
