export type Theme = "system" | "light" | "dark";
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
  snapshot(): Promise<Snapshot>;
  capture(): Promise<Account>;
  switchAccount(id: string): Promise<void>;
  editAccount(
    id: string,
    patch: Partial<Pick<Account, "nickname" | "note" | "favorite">>,
  ): Promise<void>;
  removeAccount(id: string): Promise<void>;
  refreshQuotas(id?: string): Promise<void>;
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
  openLink(name: "github" | "wiki" | "releases" | "privacy"): Promise<void>;
  launchClient(): Promise<void>;
  onChange(callback: () => void): () => void;
  startLogin(): Promise<{ id: string; expiresAt: number }>;
  pollLogin(id: string): Promise<{ done: boolean }>;
  openLogin(id: string): Promise<void>;
  cancelLogin(id: string): Promise<void>;
}
declare global {
  interface Window {
    workbuddy: Bridge;
  }
}
