import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { atomicWrite, readBounded } from "./files.mjs";
import {
  ApiError,
  openApiChat,
  fetchApiModels,
  apiChatFrames,
  aggregateApiFrames,
  prepareEmbeddingRequest,
  openApiEmbedding,
  AGENT_TOOLS,
  agentToolBody,
  openAgentTool,
} from "./api-upstream.mjs";
import {
  prepareProtocolRequest,
  ProtocolStream,
  estimateMessageTokens,
} from "./api-protocols.mjs";

export const apiDefaults = Object.freeze({
  port: 8317,
  autoStart: false,
  // Loopback stays the default: the service is reachable from other devices on
  // the same network only after the user turns this on in the API page.
  lan: false,
  accounts: [],
  strategy: "round_robin",
});
// A LAN bind answers on every interface, so the accepted Host header has to be
// pinned to an address this machine actually owns. Any other name is rejected
// the same way a DNS-rebinding attempt is, even with the switch on.
const networkAddresses = () => {
  const result = [];
  let interfaces = {};
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return result;
  }
  for (const rows of Object.values(interfaces))
    for (const row of rows ?? [])
      if (
        row &&
        !row.internal &&
        (row.family === "IPv4" || row.family === 4) &&
        typeof row.address === "string"
      )
        result.push(row.address);
  return result;
};
export function lanAddresses() {
  const names = [];
  const hostname = os.hostname().toLowerCase();
  if (hostname) {
    names.push(hostname);
    if (!hostname.endsWith(".local")) names.push(hostname + ".local");
  }
  for (const address of networkAddresses()) names.push(address);
  return [...new Set(names)];
}
export function allowedHosts(port, lan = false) {
  const hosts = new Set([
    "127.0.0.1:" + port,
    "localhost:" + port,
    "[::1]:" + port,
  ]);
  if (lan) for (const name of lanAddresses()) hosts.add(name + ":" + port);
  return hosts;
}
// Local request limits were removed in 1.9.4: the selected accounts, the
// official rate limiting and the model context decide what can run. Old saved
// configurations that still carry these keys stay readable and are ignored.
const retiredKeys = ["maxOutputTokens", "maxConcurrency", "requestsPerMinute"];
export const REQUEST_BODY_LIMIT = 32 * 1024 * 1024;
// An official rate limit (HTTP 429 / business code 14003 and its relatives) is
// a "try again later", not a refusal of the request content: before any output
// a different account may still serve the turn. Bounded to one replay so a
// model-wide limit never turns into an amplification loop.
const RATE_LIMIT_REPLAYS = 1;
// Local API consumption is kept per day, account and model so the usage page can
// add it to the token statistics without storing prompts or replies.
const API_USAGE_DAYS = 120;
const DAY_MS = 86400000;
const dayLabel = (value) => {
  const date = new Date(value);
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
};
const realms = ["workbuddy", "workbuddy-global"];
const ref = (account) => account.provider + ":" + account.id;
const safeNumber = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;
const totals = () => ({
  requests: 0,
  succeeded: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  unknownUsage: 0,
});
const clean = (value) =>
  typeof value === "string"
    ? value.replace(/[\x00-\x1f]/g, " ").slice(0, 200)
    : "";
export function validateApiConfig(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !retiredKeys.includes(key) && !Object.hasOwn(apiDefaults, key),
    )
  )
    throw new Error("API 设置格式无效。");
  const config = { ...apiDefaults, ...value };
  // Accept old saved configurations without restoring removed settings.
  for (const key of retiredKeys) delete config[key];
  if (
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error("API 设置 port 不在支持范围内。");
  if (
    typeof config.autoStart !== "boolean" ||
    typeof config.lan !== "boolean" ||
    !["round_robin", "sequential", "expiring"].includes(config.strategy) ||
    !Array.isArray(config.accounts) ||
    config.accounts.length > 100
  )
    throw new Error("API 账号或调度设置无效。");
  const seen = new Set();
  config.accounts = config.accounts.map((account) => {
    if (
      !account ||
      Object.keys(account).some((key) => !["provider", "id"].includes(key)) ||
      !realms.includes(account.provider) ||
      typeof account.id !== "string" ||
      !/^[A-Za-z0-9_.:@-]{1,200}$/.test(account.id) ||
      seen.has(ref(account))
    )
      throw new Error("API 账号选择无效或重复。");
    seen.add(ref(account));
    return { provider: account.provider, id: account.id };
  });
  return config;
}
function restoreRequestInfo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return {
    messageCount: safeNumber(value.messageCount),
    toolCount: safeNumber(value.toolCount),
    bodyBytes: safeNumber(value.bodyBytes),
    maxOutputTokens:
      Number.isSafeInteger(value.maxOutputTokens) && value.maxOutputTokens > 0
        ? value.maxOutputTokens
        : null,
    reasoningEffort: [
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ].includes(value.reasoningEffort)
      ? value.reasoningEffort
      : null,
  };
}
function restoreUpstreamInfo(value) {
  if (
    !Number.isInteger(value.upstreamStatus) ||
    value.upstreamStatus < 100 ||
    value.upstreamStatus > 599
  )
    return {};
  return {
    upstreamStatus: value.upstreamStatus,
    upstreamCode:
      typeof value.upstreamCode === "string" &&
      /^\d{1,8}$/.test(value.upstreamCode)
        ? value.upstreamCode
        : null,
    upstreamResponseType: ["json", "html", "event_stream", "other"].includes(
      value.upstreamResponseType,
    )
      ? value.upstreamResponseType
      : "other",
  };
}
function restoreRecent(raw) {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 100)
    .filter(
      (value) =>
        value &&
        ["ok", "error", "cancelled"].includes(value.status) &&
        realms.includes(value.provider),
    )
    .map((value) => ({
      requestId: clean(value.requestId),
      at: safeNumber(value.at),
      model: clean(value.model),
      provider: value.provider,
      accountId: clean(value.accountId),
      status: value.status,
      statusCode: safeNumber(value.statusCode),
      durationMs: safeNumber(value.durationMs),
      inputTokens: Number.isSafeInteger(value.inputTokens)
        ? Math.max(0, value.inputTokens)
        : null,
      outputTokens: Number.isSafeInteger(value.outputTokens)
        ? Math.max(0, value.outputTokens)
        : null,
      errorCode: clean(value.errorCode),
      ...restoreUpstreamInfo(value),
      ...(value.requestInfo
        ? { requestInfo: restoreRequestInfo(value.requestInfo) }
        : {}),
    }));
}
export class ApiGateway {
  config = structuredClone(apiDefaults);
  server = null;
  secret = "";
  encryptedKey = "";
  lastError = "";
  recent = [];
  totals = totals();
  active = new Map();
  leases = new Set();
  cooldowns = new Map();
  depleted = new Map();
  sessions = new Map();
  cursors = new Map();
  modelCache = new Map();
  modelPromises = new Map();
  modelWarnings = [];
  apiDaily = new Map();
  renewals = new Map();
  writeTail = Promise.resolve();
  draining = false;
  constructor({
    directory,
    vault,
    stores,
    request = fetch,
    onChange = () => {},
    listenPort,
  }) {
    Object.assign(this, {
      directory,
      vault,
      stores,
      request,
      onChange,
      listenPort,
    });
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.loadApiDaily();
    try {
      const raw = JSON.parse(
        await readBounded(
          path.join(this.directory, "api-gateway.json"),
          1024 * 1024,
        ),
      );
      if (raw.version !== 1 || typeof raw.keyEncrypted !== "string")
        throw new Error("invalid");
      this.config = validateApiConfig(raw.config);
      this.encryptedKey = raw.keyEncrypted;
      try {
        this.secret = this.vault.decrypt(
          Buffer.from(raw.keyEncrypted, "base64"),
        );
        if (!/^sk-wbs-[A-Za-z0-9_-]{43}$/.test(this.secret))
          throw new Error("invalid key");
      } catch {
        this.secret = "";
        this.lastError =
          "系统暂时无法解密 API 密钥，原配置已保留。请解锁系统密钥环后重启应用。";
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.lastError =
          "API 配置无法读取，已停止自动启动并保留原文件，请重新保存配置。";
        try {
          await fs.rename(
            path.join(this.directory, "api-gateway.json"),
            path.join(
              this.directory,
              "api-gateway-damaged-" + Date.now() + ".json",
            ),
          );
        } catch (moveError) {
          if (moveError.code !== "ENOENT") throw moveError;
        }
        this.config = structuredClone(apiDefaults);
      }
      if (this.vault.available()) {
        this.secret = "sk-wbs-" + randomBytes(32).toString("base64url");
        this.encryptedKey = this.vault.encrypt(this.secret).toString("base64");
        await this.writeConfig(this.config, this.encryptedKey);
      } else this.lastError = "系统加密服务不可用，API 服务保持关闭。";
    }
    try {
      const raw = JSON.parse(
        await readBounded(
          path.join(this.directory, "api-usage.json"),
          4 * 1024 * 1024,
        ),
      );
      if (raw.version !== 1 || !raw.totals) throw new Error("invalid");
      for (const key of Object.keys(this.totals))
        this.totals[key] = safeNumber(raw.totals[key]);
      this.recent = restoreRecent(raw.recent);
      for (const item of Array.isArray(raw.cooldowns)
        ? raw.cooldowns.slice(0, 5000)
        : [])
        if (
          typeof item.key === "string" &&
          item.key.length < 500 &&
          Number.isSafeInteger(item.until) &&
          item.until > Date.now() &&
          item.until < Date.now() + 86400000
        )
          this.cooldowns.set(item.key, item.until);
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.lastError = "API 用量记录损坏，原记录已保留；新请求会重新统计。";
        await fs.rename(
          path.join(this.directory, "api-usage.json"),
          path.join(
            this.directory,
            "api-usage-damaged-" + Date.now() + ".json",
          ),
        );
      }
    }
    if (this.config.autoStart)
      try {
        await this.start();
      } catch (error) {
        this.lastError = error.message;
        this.onChange();
      }
  }
  apiUsagePath() {
    return path.join(this.directory, "api-usage-daily.json");
  }
  async loadApiDaily() {
    let raw;
    try {
      raw = JSON.parse(await readBounded(this.apiUsagePath(), 4 * 1024 * 1024));
    } catch (error) {
      // A missing file only means the local API has not served a request yet.
      if (error.code !== "ENOENT")
        this.lastError = "本机 API 用量记录损坏，已跳过历史统计。";
      return;
    }
    const cutoff = dayLabel(Date.now() - (API_USAGE_DAYS - 1) * DAY_MS);
    for (const row of Array.isArray(raw?.days) ? raw.days : []) {
      const day = typeof row?.day === "string" ? row.day : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cutoff) continue;
      if (!realms.includes(row.provider)) continue;
      const accountId = clean(row.accountId);
      const model = clean(row.model);
      if (!accountId || !model) continue;
      this.apiDaily.set(
        day + "|" + row.provider + "|" + accountId + "|" + model,
        {
          day,
          provider: row.provider,
          accountId,
          model,
          input: safeNumber(row.input),
          output: safeNumber(row.output),
          requests: safeNumber(row.requests),
          unknown: safeNumber(row.unknown),
        },
      );
    }
  }
  recordApiUsage(provider, accountId, model, inputTokens, outputTokens) {
    const day = dayLabel(Date.now());
    const key =
      day + "|" + provider + "|" + String(accountId) + "|" + String(model);
    const row = this.apiDaily.get(key) ?? {
      day,
      provider,
      accountId: String(accountId),
      model: String(model),
      input: 0,
      output: 0,
      requests: 0,
      unknown: 0,
    };
    row.requests += 1;
    if (
      Number.isSafeInteger(inputTokens) &&
      Number.isSafeInteger(outputTokens)
    ) {
      row.input += Math.max(0, inputTokens);
      row.output += Math.max(0, outputTokens);
    } else row.unknown += 1;
    this.apiDaily.set(key, row);
    const cutoff = dayLabel(Date.now() - API_USAGE_DAYS * DAY_MS);
    for (const [key, value] of this.apiDaily)
      if (value.day < cutoff) this.apiDaily.delete(key);
  }
  dailyApiUsage() {
    return [...this.apiDaily.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  getKey() {
    if (!this.secret)
      throw new Error("系统加密服务不可用，请先解锁系统密钥环。");
    return this.secret;
  }
  async writeConfig(config, keyEncrypted = this.encryptedKey) {
    await atomicWrite(
      path.join(this.directory, "api-gateway.json"),
      JSON.stringify({ version: 1, config, keyEncrypted }, null, 2),
    );
  }
  async saveConfig(value) {
    if (this.server || this.active.size)
      throw new Error("请先停止 API 服务，再修改配置。");
    const config = validateApiConfig(value);
    for (const account of config.accounts)
      if (
        !this.accounts().some(
          (row) =>
            row.provider === account.provider &&
            row.id === account.id &&
            row.available,
        )
      )
        throw new Error("所选账号已移除或尚无官方网页登录授权。");
    this.getKey();
    await this.writeConfig(config);
    this.config = config;
    this.modelCache.clear();
    this.modelWarnings = [];
    this.sessions.clear();
    this.lastError = "";
    this.onChange();
    return this.snapshot();
  }
  async rotateKey() {
    if (this.active.size)
      throw new Error("请等待当前 API 请求结束后轮换密钥。");
    if (!this.vault.available())
      throw new Error("系统加密服务不可用，密钥保持不变。");
    const secret = "sk-wbs-" + randomBytes(32).toString("base64url"),
      encrypted = this.vault.encrypt(secret).toString("base64");
    await this.writeConfig(this.config, encrypted);
    this.secret = secret;
    this.encryptedKey = encrypted;
    this.sessions.clear();
    this.onChange();
    return this.snapshot();
  }
  accounts() {
    return realms.flatMap((provider) =>
      (this.stores.get(provider)?.records ?? []).map((record) => ({
        provider,
        id: record.profile.id,
        nickname: record.profile.nickname,
        available: !!(record.apiEncrypted || !record.profile.protectedToken),
        remaining: record.profile.quota?.remaining ?? null,
        cooldownUntil: Math.max(
          0,
          this.depleted.get(ref({ provider, id: record.profile.id }))?.until ??
            0,
          ...[...this.cooldowns]
            .filter(([key]) =>
              key.startsWith(ref({ provider, id: record.profile.id }) + "|"),
            )
            .map(([, until]) => until),
        ),
      })),
    );
  }
  snapshot() {
    const port = this.server?.address()?.port ?? this.config.port;
    const lan = !!this.config.lan;
    // Other devices cannot reach 127.0.0.1, so LAN mode leads with a real
    // address while loopback stays the first (and only) local answer.
    const lanUrls = lan
      ? networkAddresses().map((address) => "http://" + address + ":" + port)
      : [];
    return structuredClone({
      running: !!this.server?.listening && !this.draining,
      baseUrl: "http://127.0.0.1:" + port + "/v1",
      lanUrls: lanUrls.map((url) => url + "/v1"),
      lanUrl: lanUrls.length ? lanUrls[0] + "/v1" : "",
      activeRequests: this.active.size,
      hasKey: !!this.secret,
      config: this.config,
      accounts: this.accounts(),
      totals: this.totals,
      recent: this.recent,
      lastError: this.lastError,
      models: [...this.modelCache.values()].flatMap((cache) => cache.models),
      modelWarnings: this.modelWarnings,
    });
  }
  candidates(provider, model = "", excluded = new Set()) {
    const now = Date.now();
    return this.config.accounts.filter(
      (account) =>
        account.provider === provider &&
        !excluded.has(ref(account)) &&
        this.accounts().some(
          (row) =>
            row.provider === provider && row.id === account.id && row.available,
        ) &&
        (!model || this.creditAvailable(account, now)) &&
        (this.cooldowns.get(ref(account) + "|" + model) || 0) <= Date.now(),
    );
  }
  creditAvailable(account, now = Date.now()) {
    const profile = this.stores
      .get(account.provider)
      ?.records.find((row) => row.profile.id === account.id)?.profile;
    const quota = profile?.quota;
    const denial = this.depleted.get(ref(account));
    // A successful balance refresh after a refusal can restore a topped-up account.
    if (
      denial &&
      !(
        quota?.remaining > 0 &&
        !profile.quotaError &&
        quota.fetchedAt > denial.at
      ) &&
      denial.until > now
    )
      return false;
    return !(
      Number.isFinite(quota?.remaining) &&
      quota.remaining <= 0 &&
      !profile.quotaError &&
      quota.fetchedAt <= now &&
      now - quota.fetchedAt < 300000
    );
  }
  // Round-robin / sequential / expiring selection without conversation
  // stickiness, shared by chat and by the vector and agent-tool routes that
  // carry no message history.
  chooseCandidate(provider, model = "", excluded) {
    const candidates = this.candidates(provider, model, excluded);
    if (!candidates.length)
      throw new ApiError(
        503,
        "no_available_accounts",
        "没有可用的所选账号，请检查积分余额、授权与冷却状态。",
      );
    if (this.config.strategy === "expiring")
      candidates.sort((a, b) => {
        const quota = (account) =>
          this.stores
            .get(account.provider)
            ?.records.find((row) => row.profile.id === account.id)?.profile
            .quota;
        const expiry = (account) => {
          const value = quota(account);
          return value?.remaining > 0 &&
            value.expiresAt > Date.now() &&
            Date.now() - value.fetchedAt < 21600000
            ? value.expiresAt
            : Infinity;
        };
        return expiry(a) - expiry(b);
      });
    const cursor = this.cursors.get(provider) || 0;
    const selected =
      this.config.strategy === "round_robin"
        ? candidates[cursor % candidates.length]
        : this.config.strategy === "sequential"
          ? candidates.find(
              (account) =>
                ref(account) === this.cursors.get("selected:" + provider),
            ) || candidates[0]
          : candidates[0];
    this.cursors.set(provider, cursor + 1);
    this.cursors.set("selected:" + provider, ref(selected));
    return selected;
  }
  pick(prepared, excluded) {
    const candidates = this.candidates(
      prepared.provider,
      prepared.payload.model,
      excluded,
    );
    if (!candidates.length)
      throw new ApiError(
        503,
        "no_available_accounts",
        "没有可用的所选账号，请检查积分余额、授权与冷却状态。",
      );
    const first = prepared.payload.messages.find(
      (message) => message.role === "user",
    );
    const session = createHmac("sha256", this.getKey())
      .update(
        prepared.provider +
          ":" +
          (prepared.session ??
            JSON.stringify([
              prepared.payload.messages.filter(
                (message) => message.role === "system",
              ),
              first,
            ])),
      )
      .digest("hex");
    const prior = this.sessions.get(session),
      sticky =
        prior?.until > Date.now() &&
        candidates.find((account) => ref(account) === prior.account);
    let selected = sticky;
    if (!selected)
      selected = this.chooseCandidate(
        prepared.provider,
        prepared.payload.model,
        excluded,
      );
    if (this.sessions.size >= 1000)
      this.sessions.delete(this.sessions.keys().next().value);
    const conversationId = sticky ? prior.conversationId : randomUUID();
    this.sessions.set(session, {
      account: ref(selected),
      conversationId,
      until: Date.now() + 3600000,
    });
    return { ...selected, conversationId };
  }
  async credential(account, operation) {
    const store = this.stores.get(account.provider);
    let doc;
    try {
      doc = store.apiDocument(account.id);
    } catch {
      throw new ApiError(
        401,
        "credential_required",
        "无法读取所选账号授权，请在应用内重新登录。",
      );
    }
    const renew = async () => {
      const key = ref(account);
      if (this.renewals.has(key)) return this.renewals.get(key);
      const pending = store.exclusive(async () => {
        let first = true;
        return store.authorized(account.id, (document) => {
          if (first) {
            first = false;
            throw new ApiError(401, "upstream_auth_expired", "授权已失效。");
          }
          return document;
        });
      });
      this.renewals.set(key, pending);
      try {
        return await pending;
      } catch {
        throw new ApiError(
          401,
          "upstream_auth_expired",
          "官方授权续期未完成，请在应用内重新登录。",
        );
      } finally {
        this.renewals.delete(key);
      }
    };
    let renewed = false;
    if (doc.tokenExpiresAt && doc.tokenExpiresAt < Date.now() + 60000) {
      doc = await renew();
      renewed = true;
    }
    try {
      return await operation(doc);
    } catch (error) {
      if (error.kind !== "auth" || renewed) throw error;
      return operation(await renew());
    }
  }
  async models(force = false, region = null) {
    const result = [];
    const warnings = [];
    let failure;
    for (const provider of region ? [region] : realms) {
      if (
        !this.config.accounts.some((account) => account.provider === provider)
      )
        continue;
      try {
        let cache = this.modelCache.get(provider);
        if (force || !cache || cache.until < Date.now()) {
          if (!this.modelPromises.has(provider)) {
            const account = this.candidates(provider)[0];
            if (!account)
              throw new ApiError(
                503,
                "no_available_accounts",
                "该地区没有可用于查询模型的账号。",
              );
            const pending = this.credential(account, (doc) =>
              fetchApiModels(doc, this.request, AbortSignal.timeout(20000)),
            )
              .then((models) => {
                const cache = {
                  until: Date.now() + 600000,
                  models: models.map((model) => ({
                    ...model,
                    id:
                      (provider === "workbuddy-global" ? "global:" : "") +
                      model.id,
                    provider,
                  })),
                };
                this.modelCache.set(provider, cache);
                return cache;
              })
              .finally(() => this.modelPromises.delete(provider));
            this.modelPromises.set(provider, pending);
          }
          cache = await this.modelPromises.get(provider);
        }
        result.push(...cache.models);
      } catch (error) {
        failure = error;
        warnings.push({
          provider,
          code:
            error instanceof ApiError ? error.code : "model_discovery_failed",
          message:
            error instanceof ApiError
              ? error.message
              : "该地区模型目录暂时无法读取。",
        });
      }
    }
    this.modelWarnings = warnings;
    if (!result.length)
      throw (
        failure ??
        new ApiError(
          503,
          "no_selected_accounts",
          "请先选择用于 API 的 WorkBuddy 账号。",
        )
      );
    // Vector models deliberately stay out of this chat catalog: clients pick a
    // default chat model from /v1/models, and listing an embedding model there
    // only produces "model not available" turns. They are documented on the API
    // page and accepted by /v1/embeddings only.
    return {
      object: "list",
      data: region
        ? result.map((model) => ({
            ...model,
            id: model.id.replace(/^global:/, ""),
          }))
        : result,
      ...(warnings.length ? { warnings } : {}),
    };
  }
  async start() {
    if (this.server) return this.snapshot();
    this.getKey();
    if (
      !this.config.accounts.length ||
      !this.accounts().some(
        (row) =>
          row.available &&
          this.config.accounts.some((account) => ref(account) === ref(row)),
      )
    )
      throw new Error("请先选择至少一个已授权的 WorkBuddy 账号。");
    this.draining = false;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.requestTimeout = 20000;
    this.server.headersTimeout = 10000;
    this.server.keepAliveTimeout = 5000;
    this.server.maxConnections = 64;
    try {
      await new Promise((resolve, reject) => {
        const server = this.server;
        const failure = (error) => {
          server.off("listening", resolve);
          reject(error);
        };
        server.once("error", failure);
        server.once("listening", () => {
          server.off("error", failure);
          resolve();
        });
        server.listen(
          this.listenPort ?? this.config.port,
          this.config.lan ? "0.0.0.0" : "127.0.0.1",
        );
      });
    } catch (error) {
      this.server = null;
      this.lastError =
        error.code === "EADDRINUSE"
          ? "API 端口已被占用，请停止占用程序或更换端口。"
          : "API 服务启动失败，请检查本机网络权限。";
      this.onChange();
      throw new Error(this.lastError);
    }
    this.server.on("error", () => {
      this.lastError = "API 监听发生错误，请停止后重新启动。";
      this.onChange();
    });
    this.lastError = "";
    this.onChange();
    return this.snapshot();
  }
  beginShutdown() {
    this.draining = true;
    this.server?.close();
    this.server?.closeIdleConnections();
    this.onChange();
  }
  async stop() {
    const server = this.server;
    if (!server) {
      await this.writeTail;
      return this.snapshot();
    }
    this.draining = true;
    for (const controller of this.active.values()) controller.abort();
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
      const timer = setTimeout(() => {
        server.closeAllConnections();
        resolve();
      }, 2500);
      timer.unref();
      server.once("close", () => clearTimeout(timer));
    });
    this.server = null;
    await Promise.allSettled(
      [...this.active.values()].map((controller) => controller.done),
    );
    await this.writeTail;
    this.onChange();
    return this.snapshot();
  }
  authorize(req) {
    const bearer =
      typeof req.headers.authorization === "string" &&
      /^Bearer /i.test(req.headers.authorization)
        ? req.headers.authorization.slice(7)
        : "";
    const apiKey =
      typeof req.headers["x-api-key"] === "string"
        ? req.headers["x-api-key"]
        : "";
    const expected = createHash("sha256").update(this.getKey()).digest(),
      provided = createHash("sha256")
        .update(bearer || apiKey)
        .digest();
    const count = req.rawHeaders.filter(
      (value, index) =>
        index % 2 === 0 &&
        ["authorization", "x-api-key"].includes(value.toLowerCase()),
    ).length;
    return (
      count >= 1 &&
      count <= 2 &&
      req.rawHeaders.filter(
        (v, i) => i % 2 === 0 && v.toLowerCase() === "authorization",
      ).length <= 1 &&
      req.rawHeaders.filter(
        (v, i) => i % 2 === 0 && v.toLowerCase() === "x-api-key",
      ).length <= 1 &&
      (!req.headers.authorization || !!bearer) &&
      (!(bearer && apiKey) || bearer === apiKey) &&
      timingSafeEqual(expected, provided)
    );
  }
  errorBody(error, protocol) {
    return {
      ...(protocol === "messages" ? { type: "error" } : {}),
      error: {
        message: error.message,
        type:
          protocol === "messages" && error.status === 401
            ? "authentication_error"
            : error.status === 400
              ? "invalid_request_error"
              : "api_error",
        param: null,
        code: error.code,
      },
    };
  }
  json(res, status, value) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  }
  async body(req) {
    const limit = REQUEST_BODY_LIMIT;
    if (Number(req.headers["content-length"]) > limit) {
      req.resume();
      throw new ApiError(413, "request_too_large", "请求体最大为 32 MB。");
    }
    if (
      !req.headers["content-type"]?.toLowerCase().startsWith("application/json")
    )
      throw new ApiError(
        400,
        "invalid_content_type",
        "请发送 application/json 请求。",
      );
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      const cleanup = () => {
        req.off("data", data);
        req.off("end", end);
        req.off("error", error);
      };
      const error = () => {
        cleanup();
        reject(new ApiError(400, "invalid_body", "请求体未完整接收。"));
      };
      const data = (chunk) => {
        size += chunk.length;
        if (size > limit) {
          cleanup();
          req.resume();
          reject(new ApiError(413, "request_too_large", "请求体最大为 8 MB。"));
        } else chunks.push(chunk);
      };
      const end = () => {
        cleanup();
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new ApiError(400, "invalid_json", "请求体不是有效 JSON。"));
        }
      };
      req.on("data", data);
      req.once("end", end);
      req.once("error", error);
    });
  }
  async handle(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    let protocol = "chat";
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let pathname = url.pathname
        .replace(/^\/v1(?=\/|$)/, "")
        .replace(/\/$/, "");
      const realm = pathname.match(/^\/(global|cn)(?=\/|$)/);
      const region = realm
        ? realm[1] === "global"
          ? "workbuddy-global"
          : "workbuddy"
        : null;
      if (realm)
        pathname = pathname.slice(realm[0].length).replace(/^\/v1(?=\/|$)/, "");
      if (pathname === "/responses") protocol = "responses";
      if (pathname.startsWith("/messages")) protocol = "messages";
      const port = this.server?.address()?.port;
      if (
        !allowedHosts(port, !!this.config.lan).has(
          String(req.headers.host ?? "").toLowerCase(),
        ) ||
        req.headers.origin ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new ApiError(
          403,
          "local_clients_only",
          this.config.lan
            ? "API 仅接受来自本机或本机网卡地址的调用，请使用界面显示的局域网地址。"
            : "API 仅供已授权的本机工具调用。",
        );
      if (this.draining)
        throw new ApiError(503, "service_stopping", "API 服务正在停止。");
      if (!this.authorize(req))
        throw new ApiError(401, "invalid_api_key", "API Key 无效或缺失。");
      if (req.method === "GET" && pathname === "/healthz")
        return this.json(res, 200, {
          status: "ok",
          service: "workbuddy-switch-api",
        });
      if (req.method === "GET" && pathname === "/models")
        return this.json(
          res,
          200,
          await this.models(url.searchParams.get("refresh") === "1", region),
        );
      const scope = (raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new ApiError(400, "invalid_request", "请求须为 JSON 对象。");
        if (!region) return raw;
        const international =
          typeof raw.model === "string" && raw.model.startsWith("global:");
        if (region === "workbuddy" && international)
          throw new ApiError(
            400,
            "region_mismatch",
            "国内版地址不能使用国际版模型。",
          );
        return {
          ...raw,
          model:
            region === "workbuddy-global" &&
            typeof raw.model === "string" &&
            !international
              ? "global:" + raw.model
              : raw.model,
        };
      };
      if (req.method === "POST" && pathname === "/messages/count_tokens") {
        const input_tokens = estimateMessageTokens(scope(await this.body(req)));
        res.setHeader("X-Token-Count-Estimated", "true");
        return this.json(res, 200, { input_tokens });
      }
      if (req.method === "POST" && pathname === "/embeddings")
        return await this.embedding(scope(await this.body(req)), res);
      if (req.method === "POST" && pathname.startsWith("/tools/")) {
        if (region === "workbuddy-global")
          throw new ApiError(
            400,
            "unsupported_region",
            "官方工具接口目前仅支持国内版。",
          );
        return await this.agentTool(
          pathname.slice("/tools/".length),
          await this.body(req),
          res,
        );
      }
      if (
        req.method !== "POST" ||
        !["/chat/completions", "/responses", "/messages"].includes(pathname)
      )
        throw new ApiError(
          404,
          "not_found",
          "API 路径不存在，支持 /v1/models、/v1/embeddings、/v1/tools/{agentic_search|knowledge_search|tempkey}、/v1/chat/completions、/v1/responses 和 /v1/messages。",
        );
      const prepared = prepareProtocolRequest(
        scope(await this.body(req)),
        protocol,
      );
      if (region) prepared.model = prepared.model.replace(/^global:/, "");
      await this.chat(prepared, req, res);
    } catch (error) {
      const safe =
        error instanceof ApiError
          ? error
          : new ApiError(
              502,
              "gateway_error",
              "本机 API 请求未完成，请在应用内检查服务状态。",
            );
      if (safe.retryAfter)
        res.setHeader("Retry-After", String(safe.retryAfter));
      this.json(res, safe.status, this.errorBody(safe, protocol));
    } finally {
      if (!req.complete) req.resume();
    }
  }
  async chat(prepared, _req, res) {
    let account = this.pick(prepared);
    const payload = prepared.payload;
    const requestId = "chatcmpl-" + randomUUID(),
      started = Date.now(),
      controller = new AbortController();
    let finished;
    controller.done = new Promise((resolve) => (finished = resolve));
    this.leases.add(ref(account));
    this.active.set(requestId, controller);
    this.onChange();
    const timer = setTimeout(() => controller.abort(), 180000);
    timer.unref();
    const closed = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", closed);
    const entry = {
      requestId,
      at: started,
      model: prepared.model,
      provider: account.provider,
      accountId: account.id,
      status: "error",
      statusCode: 502,
      durationMs: 0,
      inputTokens: null,
      outputTokens: null,
      errorCode: "",
      requestInfo: {
        messageCount: prepared.payload.messages.length,
        toolCount: prepared.payload.tools?.length ?? 0,
        bodyBytes: Buffer.byteLength(JSON.stringify(payload)),
        maxOutputTokens: prepared.payload.max_tokens ?? null,
        reasoningEffort: prepared.payload.reasoning_effort ?? null,
      },
    };
    let usage,
      outputStarted = false,
      rateLimitReplays = 0;
    const attempted = new Set();
    const adapter =
      prepared.protocol !== "chat"
        ? new ProtocolStream(
            prepared.protocol,
            prepared.model,
            prepared.toolRegistry,
          )
        : null;
    const write = async (text) => {
      if (controller.signal.aborted || res.destroyed)
        throw new ApiError(499, "request_cancelled", "请求连接已结束。");
      if (res.write(text)) return;
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          res.off("drain", drain);
          res.off("close", close);
          controller.signal.removeEventListener("abort", close);
        };
        const drain = () => {
          cleanup();
          resolve();
        };
        const close = () => {
          cleanup();
          reject(new ApiError(499, "request_cancelled", "请求连接已结束。"));
        };
        res.once("drain", drain);
        res.once("close", close);
        controller.signal.addEventListener("abort", close, { once: true });
        if (controller.signal.aborted || res.destroyed) close();
      });
    };
    try {
      const frames = [];
      for (;;) {
        try {
          const response = await this.credential(account, (doc) =>
            openApiChat(
              doc,
              payload,
              account.conversationId,
              this.request,
              controller.signal,
            ),
          );
          for await (const frame of apiChatFrames(
            response,
            prepared.model,
            requestId,
          )) {
            outputStarted = true;
            if (controller.signal.aborted)
              throw new ApiError(
                499,
                "request_cancelled",
                "请求已停止，已产生的消耗以官方计费为准。",
              );
            if (frame.usage) usage = frame.usage;
            const events = adapter?.push(frame);
            if (prepared.stream) {
              if (!res.headersSent)
                res.writeHead(200, {
                  "Content-Type": "text/event-stream; charset=utf-8",
                  "Cache-Control": "no-cache, no-transform",
                  "X-Accel-Buffering": "no",
                  "X-Request-Id": requestId,
                });
              if (adapter) {
                for (const event of events) await write(event);
              } else if (frame.choices.length || prepared.includeUsage) {
                const value = prepared.includeUsage
                  ? frame
                  : Object.fromEntries(
                      Object.entries(frame).filter(([key]) => key !== "usage"),
                    );
                await write("data: " + JSON.stringify(value) + "\n\n");
              }
            } else if (!adapter) frames.push(frame);
          }
          break;
        } catch (error) {
          if (error instanceof ApiError && error.status === 402) {
            this.depleted.set(ref(account), {
              at: Date.now(),
              until: Date.now() + 300000,
            });
            // Only a definite refusal before any output is safe to replay.
            if (
              !outputStarted &&
              !res.headersSent &&
              !controller.signal.aborted
            ) {
              attempted.add(ref(account));
              let next;
              try {
                next = this.pick(prepared, attempted);
              } catch {
                throw error;
              }
              this.leases.delete(ref(account));
              account = next;
              this.leases.add(ref(account));
              entry.accountId = account.id;
              continue;
            }
          }
          if (error instanceof ApiError && error.status === 429) {
            this.cooldowns.set(
              ref(account) + "|" + prepared.payload.model,
              Date.now() + (error.retryAfter || 60) * 1000,
            );
            // A rate limit only means "this account/model is hot right now".
            // Replaying on another account is safe while nothing was written.
            if (
              !outputStarted &&
              !res.headersSent &&
              !controller.signal.aborted &&
              rateLimitReplays < RATE_LIMIT_REPLAYS
            ) {
              attempted.add(ref(account));
              let next;
              try {
                next = this.pick(prepared, attempted);
              } catch {
                throw error;
              }
              this.leases.delete(ref(account));
              account = next;
              this.leases.add(ref(account));
              entry.accountId = account.id;
              rateLimitReplays += 1;
              continue;
            }
          }
          throw error;
        }
      }
      const finalEvents = adapter?.finish();
      if (prepared.stream) {
        if (adapter) for (const event of finalEvents) await write(event);
        res.end(adapter ? undefined : "data: [DONE]\n\n");
      } else {
        res.setHeader("X-Request-Id", requestId);
        this.json(
          res,
          200,
          adapter
            ? adapter.result()
            : aggregateApiFrames(frames, prepared.model, requestId),
        );
      }
      entry.status = "ok";
      entry.statusCode = 200;
      this.lastError = "";
    } catch (error) {
      const safe = controller.signal.aborted
        ? new ApiError(
            499,
            "request_cancelled",
            "请求已停止，消耗以官方计费为准。",
          )
        : error instanceof ApiError
          ? error
          : new ApiError(
              502,
              "upstream_transport_error",
              "对话连接中断，结果和消耗尚未确认，不会自动重发。",
            );
      entry.status = controller.signal.aborted ? "cancelled" : "error";
      entry.statusCode = safe.status;
      entry.errorCode = safe.code;
      Object.assign(entry, restoreUpstreamInfo(safe));
      if ([402, 429, 404].includes(safe.status))
        this.cooldowns.set(
          ref(account) + "|" + prepared.payload.model,
          Date.now() + (safe.retryAfter || 60) * 1000,
        );
      this.lastError = safe.message;
      if (res.headersSent) {
        if (!res.destroyed)
          res.end(
            adapter
              ? adapter.error(safe)
              : "data: " +
                  JSON.stringify(this.errorBody(safe, prepared.protocol)) +
                  "\n\n",
          );
      } else {
        if (safe.retryAfter)
          res.setHeader("Retry-After", String(safe.retryAfter));
        this.json(res, safe.status, this.errorBody(safe, prepared.protocol));
      }
    } finally {
      clearTimeout(timer);
      res.off("close", closed);
      this.leases.delete(ref(account));
      this.active.delete(requestId);
      entry.durationMs = Date.now() - started;
      entry.inputTokens = usage?.prompt_tokens ?? null;
      entry.outputTokens = usage?.completion_tokens ?? null;
      this.commitEntry(entry, account, prepared.payload.model);
      finished();
    }
  }
  // Chat, vector and agent-tool requests share one bookkeeping path so the usage
  // page and the recent list never diverge between protocols.
  commitEntry(entry, account, model) {
    this.recordApiUsage(
      account.provider,
      account.id,
      model,
      entry.inputTokens,
      entry.outputTokens,
    );
    this.totals.requests++;
    this.totals[entry.status === "ok" ? "succeeded" : "failed"]++;
    this.totals.inputTokens += entry.inputTokens ?? 0;
    this.totals.outputTokens += entry.outputTokens ?? 0;
    if (entry.inputTokens === null || entry.outputTokens === null)
      this.totals.unknownUsage++;
    this.recent.unshift(entry);
    this.recent = this.recent.slice(0, 100);
    for (const [key, until] of this.cooldowns)
      if (until < Date.now()) this.cooldowns.delete(key);
    const saved = JSON.stringify(
      {
        version: 1,
        totals: this.totals,
        recent: this.recent,
        cooldowns: [...this.cooldowns]
          .slice(-5000)
          .map(([key, until]) => ({ key, until })),
      },
      null,
      2,
    );
    const savedDaily = JSON.stringify(
      { version: 1, days: this.dailyApiUsage() },
      null,
      2,
    );
    this.writeTail = this.writeTail
      .then(() =>
        atomicWrite(path.join(this.directory, "api-usage.json"), saved),
      )
      .then(() => atomicWrite(this.apiUsagePath(), savedDaily))
      .catch(() => {
        this.lastError =
          "API 请求结果已保留在内存，但本地用量记录保存失败，请检查磁盘。";
        this.onChange();
      });
    this.onChange();
  }
  async embedding(raw, res) {
    const prepared = prepareEmbeddingRequest(raw);
    const account = this.chooseCandidate("workbuddy", prepared.model);
    const started = Date.now();
    const entry = {
      requestId: "emb-" + randomUUID(),
      at: started,
      model: prepared.model,
      provider: account.provider,
      accountId: account.id,
      status: "error",
      statusCode: 502,
      durationMs: 0,
      inputTokens: null,
      outputTokens: 0,
      errorCode: "",
      requestInfo: {
        messageCount: 0,
        toolCount: 0,
        bodyBytes: Buffer.byteLength(JSON.stringify(prepared.payload)),
        maxOutputTokens: null,
        embeddingCount: prepared.payload.input.length,
        reason: "embedding",
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    timer.unref();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const data = await this.credential(account, (document) =>
        openApiEmbedding(
          document,
          prepared.payload,
          this.request,
          controller.signal,
        ),
      );
      entry.inputTokens = data.usage.prompt_tokens;
      entry.status = "ok";
      entry.statusCode = 200;
      this.lastError = "";
      this.json(res, 200, data);
    } catch (error) {
      const safe = controller.signal.aborted
        ? new ApiError(499, "request_cancelled", "向量请求已停止。")
        : error instanceof ApiError
          ? error
          : new ApiError(502, "gateway_error", "向量请求未完成。");
      entry.status = controller.signal.aborted ? "cancelled" : "error";
      entry.statusCode = safe.status;
      entry.errorCode = safe.code;
      Object.assign(entry, restoreUpstreamInfo(safe));
      this.lastError = safe.message;
      if (safe.retryAfter)
        res.setHeader("Retry-After", String(safe.retryAfter));
      this.json(res, safe.status, this.errorBody(safe, "chat"));
    } finally {
      clearTimeout(timer);
      entry.durationMs = Date.now() - started;
      this.commitEntry(entry, account, prepared.model);
    }
  }
  async agentTool(tool, raw, res) {
    if (!Object.hasOwn(AGENT_TOOLS, tool))
      throw new ApiError(
        404,
        "not_found",
        "可用工具：" + Object.keys(AGENT_TOOLS).join("、") + "。",
      );
    const body = agentToolBody(tool, raw);
    const account = this.chooseCandidate("workbuddy", "agenttool:" + tool);
    const started = Date.now();
    const entry = {
      requestId: "tool-" + randomUUID(),
      at: started,
      model: "agenttool:" + tool,
      provider: account.provider,
      accountId: account.id,
      status: "error",
      statusCode: 502,
      durationMs: 0,
      inputTokens: null,
      outputTokens: null,
      errorCode: "",
      requestInfo: {
        messageCount: 0,
        toolCount: 1,
        bodyBytes: Buffer.byteLength(JSON.stringify(body)),
        maxOutputTokens: null,
        reason: "agent_tool",
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300000);
    timer.unref();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const response = await this.credential(account, (document) =>
        openAgentTool(document, tool, body, this.request, controller.signal),
      );
      entry.status = "ok";
      entry.statusCode = 200;
      this.lastError = "";
      res.writeHead(200, {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (!response.body) res.end();
      else {
        for await (const chunk of response.body) {
          if (controller.signal.aborted || res.destroyed) break;
          if (!res.write(chunk))
            await new Promise((resolve) => res.once("drain", resolve));
        }
        res.end();
      }
    } catch (error) {
      const safe = controller.signal.aborted
        ? new ApiError(499, "request_cancelled", "工具请求已停止。")
        : error instanceof ApiError
          ? error
          : new ApiError(502, "gateway_error", "工具请求未完成。");
      entry.status = controller.signal.aborted ? "cancelled" : "error";
      entry.statusCode = safe.status;
      entry.errorCode = safe.code;
      Object.assign(entry, restoreUpstreamInfo(safe));
      this.lastError = safe.message;
      if (!res.headersSent) {
        if (safe.retryAfter)
          res.setHeader("Retry-After", String(safe.retryAfter));
        this.json(res, safe.status, this.errorBody(safe, "chat"));
      } else if (!res.destroyed) res.end();
    } finally {
      clearTimeout(timer);
      entry.durationMs = Date.now() - started;
      this.commitEntry(entry, account, entry.model);
    }
  }
  async testChat(model = "auto") {
    if (!this.snapshot().running) throw new Error("请先启动 API 服务。");
    if (typeof model !== "string" || model.length > 180)
      throw new Error("测试模型无效。");
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model,
        messages: [{ role: "user", content: "请只回复 OK。" }],
      });
      const req = http.request(
        this.snapshot().baseUrl + "/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.getKey(),
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
            if (text.length > 2 * 1024 * 1024) req.destroy();
          });
          res.on("end", () => {
            try {
              const value = JSON.parse(text);
              if (res.statusCode !== 200)
                reject(new Error(value.error?.message || "API 测试失败。"));
              else
                resolve({
                  model,
                  message:
                    value.choices?.[0]?.message?.content?.slice(0, 240) ||
                    "已收到完整模型响应。",
                });
            } catch {
              reject(new Error("API 测试返回格式无效。"));
            }
          });
        },
      );
      req.setTimeout(185000, () => req.destroy());
      req.on("error", () => reject(new Error("无法连接本机 API 测试服务。")));
      req.end(data);
    });
  }
}
