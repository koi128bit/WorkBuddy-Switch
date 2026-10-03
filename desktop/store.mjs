import fs from "node:fs/promises";
import path from "node:path";
import { parseAuth, mergeAuth } from "./auth.mjs";
import { defaults, validateSettings, resolvePaths } from "./settings.mjs";
import { atomicWrite, readOptional, readBounded, exists } from "./files.mjs";
import { encodeBackup, decodeBackup } from "./backup.mjs";
import { fetchQuota, renewAuth } from "./quota.mjs";
import { loadSessions, prepareSession, backupDatabase } from "./sessions.mjs";
import { UsageScanner } from "./usage.mjs";
import {
  getCheckinStatus,
  checkIn,
  getTravelConfig,
  getTravelStatus,
  departTravel,
  claimTravel,
  rewardDay,
} from "./rewards.mjs";
import { randomUUID } from "node:crypto";

export class Store {
  records = [];
  settings = { ...defaults };
  busy = false;
  scanner = new UsageScanner();
  events = [];
  refreshPromise = null;
  rewardHistory = [];
  lastAutomationAt = 0;
  constructor({
    directory,
    vault,
    controller,
    request = fetch,
    pathsContext,
    onChange = () => {},
  }) {
    this.directory = directory;
    this.vault = vault;
    this.controller = controller;
    this.request = request;
    this.pathsContext = pathsContext;
    this.onChange = onChange;
  }
  get paths() {
    return resolvePaths(this.settings, this.pathsContext);
  }
  get backupDirectory() {
    return path.join(this.directory, "session-backups");
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const settingData = await readOptional(
      path.join(this.directory, "settings.json"),
    );
    if (settingData) {
      try {
        this.settings = validateSettings(JSON.parse(settingData));
      } catch {
        throw new Error(
          "设置文件损坏。请备份应用数据目录后修复 settings.json。",
        );
      }
    }
    const accounts = await readOptional(
      path.join(this.directory, "vault.json"),
    );
    if (accounts) {
      try {
        const data = JSON.parse(accounts);
        if (
          data.version !== 1 ||
          !Array.isArray(data.records) ||
          data.records.some(
            (r) =>
              typeof r.profile?.id !== "string" ||
              typeof r.encrypted !== "string",
          )
        )
          throw new Error("invalid");
        this.records = data.records;
      } catch {
        throw new Error(
          "账号库损坏，已停止读取。请保留 vault.json 并从加密备份恢复。",
        );
      }
    }
    const history = await readOptional(
      path.join(this.directory, "rewards-history.json"),
    );
    if (history) {
      try {
        const data = JSON.parse(history);
        if (
          data.version !== 1 ||
          !Array.isArray(data.entries) ||
          data.entries.some(
            (entry) =>
              typeof entry.id !== "string" ||
              typeof entry.accountId !== "string" ||
              !Number.isFinite(entry.at) ||
              !["checkin", "travel", "depart"].includes(entry.task) ||
              !["claimed", "already", "departed", "error"].includes(
                entry.result,
              ),
          )
        )
          throw new Error("invalid");
        this.rewardHistory = data.entries.slice(0, 500);
      } catch {
        throw new Error(
          "积分领取记录损坏，请保留 rewards-history.json 后修复。账号库不受影响。",
        );
      }
    }
  }
  async saveRecords(records = this.records) {
    await atomicWrite(
      path.join(this.directory, "vault.json"),
      JSON.stringify({ version: 1, records }, null, 2),
    );
    this.records = records;
  }
  async updateSettings(value) {
    const settings = validateSettings(value);
    await atomicWrite(
      path.join(this.directory, "settings.json"),
      JSON.stringify(settings, null, 2),
    );
    this.settings = settings;
    this.scanner.cache.clear();
    this.onChange();
    return this.settings;
  }
  async active() {
    const raw = await readOptional(this.paths.auth);
    return raw ? parseAuth(raw) : null;
  }
  encrypt(raw) {
    if (!this.vault.available())
      throw new Error(
        "系统凭据加密服务不可用，无法保存账号。请解锁系统钥匙串后重试。",
      );
    return this.vault.encrypt(raw).toString("base64");
  }
  document(id) {
    const record = this.records.find((r) => r.profile.id === id);
    if (!record) throw new Error("账号快照不存在，请重新保存。");
    let raw;
    try {
      raw = this.vault.decrypt(Buffer.from(record.encrypted, "base64"));
    } catch {
      throw new Error("系统无法解密该账号，请解锁钥匙串或重新导入备份。");
    }
    const document = parseAuth(raw);
    if (document.id !== id) throw new Error("账号快照身份不一致，已停止操作。");
    return document;
  }
  async exclusive(action) {
    if (this.busy) throw new Error("已有操作正在进行，请稍候。");
    this.busy = true;
    this.onChange();
    try {
      if (this.refreshPromise) await this.refreshPromise;
      return await action();
    } finally {
      this.busy = false;
      this.onChange();
    }
  }
  log(message, level = "success") {
    this.events.unshift({
      id: `${Date.now()}-${this.events.length}`,
      at: Date.now(),
      message,
      level,
    });
    this.events = this.events.slice(0, 40);
    this.onChange();
  }
  async capture(document) {
    const existing = this.records.find((r) => r.profile.id === document.id);
    const profile = {
      id: document.id,
      nickname: existing?.profile.nickname ?? document.nickname,
      originalNickname: document.nickname,
      accountType: document.accountType,
      phoneHint: document.phoneHint,
      capturedAt: existing?.profile.capturedAt ?? Date.now(),
      lastUsedAt: Date.now(),
      favorite: existing?.profile.favorite ?? false,
      note: existing?.profile.note ?? "",
      tokenExpiresAt: document.tokenExpiresAt,
      quota: existing?.profile.quota ?? null,
      quotaError: null,
      protectedToken: document.protectedToken,
      rewards: existing?.profile.rewards ?? null,
      automaticRewards: existing?.profile.automaticRewards ?? true,
      travelLocationId: existing?.profile.travelLocationId ?? "",
    };
    const record = { profile, encrypted: this.encrypt(document.raw) };
    // A fresh desktop snapshot may contain a device-bound envelope. Retain a
    // separately authorized API credential without trying to decrypt that envelope.
    if (existing?.apiEncrypted) record.apiEncrypted = existing.apiEncrypted;
    else if (document.protectedToken && existing) {
      const prior = this.document(document.id);
      if (prior.token) record.apiEncrypted = existing.encrypted;
    }
    if (!document.protectedToken) record.apiEncrypted = record.encrypted;
    await this.saveRecords([
      ...this.records.filter((r) => r.profile.id !== document.id),
      record,
    ]);
    return profile;
  }
  captureCurrent() {
    return this.exclusive(async () => {
      const active = await this.active();
      if (!active) throw new Error("请先在 WorkBuddy 登录，再保存当前账号。");
      const profile = await this.capture(active);
      this.log("当前 WorkBuddy 账号已加密保存。");
      return profile;
    });
  }
  editAccount(id, patch) {
    return this.exclusive(async () => {
      if (
        !patch ||
        Object.keys(patch).some(
          (key) =>
            ![
              "nickname",
              "note",
              "favorite",
              "automaticRewards",
              "travelLocationId",
            ].includes(key),
        )
      )
        throw new Error("账号信息格式无效。");
      if (
        "nickname" in patch &&
        (typeof patch.nickname !== "string" ||
          !patch.nickname.trim() ||
          patch.nickname.length > 80)
      )
        throw new Error("账号名称应为 1–80 个字符。");
      if (
        "note" in patch &&
        (typeof patch.note !== "string" || patch.note.length > 300)
      )
        throw new Error("备注最多 300 个字符。");
      if ("favorite" in patch && typeof patch.favorite !== "boolean")
        throw new Error("收藏设置无效。");
      if (
        "automaticRewards" in patch &&
        typeof patch.automaticRewards !== "boolean"
      )
        throw new Error("自动任务设置无效。");
      if (
        "travelLocationId" in patch &&
        (typeof patch.travelLocationId !== "string" ||
          (patch.travelLocationId !== "" &&
            !/^[\w-]{1,80}$/.test(patch.travelLocationId)))
      )
        throw new Error("旅行地点设置无效。");
      if (!this.records.some((r) => r.profile.id === id))
        throw new Error("未找到该账号。");
      await this.saveRecords(
        this.records.map((r) =>
          r.profile.id === id
            ? {
                ...r,
                profile: {
                  ...r.profile,
                  ...patch,
                  ...("nickname" in patch
                    ? { nickname: patch.nickname.trim() }
                    : {}),
                },
              }
            : r,
        ),
      );
    });
  }
  removeAccount(id) {
    return this.exclusive(async () => {
      await this.saveRecords(this.records.filter((r) => r.profile.id !== id));
      this.log("已移除保存的账号。");
    });
  }
  switchAccount(id) {
    return this.exclusive(async () => {
      const record = this.records.find((r) => r.profile.id === id);
      const target = record?.apiEncrypted
        ? parseAuth(
            this.vault.decrypt(Buffer.from(record.apiEncrypted, "base64")),
          )
        : this.document(id);
      if (target.id !== id) throw new Error("目标凭据身份不一致，已停止切换。");
      const previous = await this.active();
      if (previous?.id === id) {
        await this.controller.launch();
        return;
      }
      const priorRecords = structuredClone(this.records);
      if (previous) await this.capture(previous);
      const wasRunning = (await this.controller.status()).running;
      let wrote = false;
      try {
        await this.controller.stop();
        const beforeWrite = await readOptional(this.paths.auth);
        if (beforeWrite !== (previous ? previous.raw : null)) {
          // Formatting or refreshed tokens may change during graceful exit.
          // Verify identity and save the latest same-account token before writing.
          const latest = beforeWrite ? parseAuth(beforeWrite) : null;
          if (latest?.id !== previous?.id)
            throw new Error(
              "WorkBuddy 账号在退出时发生变化，请刷新后重新切换。",
            );
          if (latest) await this.capture(latest);
        }
        const rollbackData = beforeWrite;
        this.rollbackData = rollbackData;
        const merged = mergeAuth(beforeWrite, target.raw);
        await atomicWrite(this.paths.auth, merged);
        wrote = true;
        if ((await this.active())?.id !== id)
          throw new Error("登录信息写入后身份检查失败。");
        await this.saveRecords(
          this.records.map((r) =>
            r.profile.id === id
              ? { ...r, profile: { ...r.profile, lastUsedAt: Date.now() } }
              : r,
          ),
        );
        if (this.settings.restartAfterSwitch) await this.controller.launch();
        this.log("账号已切换，登录信息写入完成。");
      } catch (error) {
        if (wrote) {
          try {
            await this.controller.stop();
            if (this.rollbackData !== null)
              await atomicWrite(this.paths.auth, this.rollbackData);
            else await fs.rm(this.paths.auth, { force: true });
            await this.saveRecords(priorRecords);
            if (wasRunning) await this.controller.launch();
          } catch {
            throw new Error(
              "账号切换失败且自动恢复未完成。原账号快照仍在账号库中，请关闭 WorkBuddy 后重新切换。",
            );
          }
        } else if (wasRunning) {
          try {
            await this.controller.launch();
          } catch {
            throw new Error(
              "切换未完成，WorkBuddy 重新启动失败。请手动打开客户端。",
            );
          }
        }
        throw error;
      } finally {
        delete this.rollbackData;
      }
    });
  }
  async refreshQuotas(id = null) {
    if (this.busy) throw new Error("正在修改账号或对话，请稍后刷新。");
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const targets = this.records
        .filter((r) => !id || r.profile.id === id)
        .map((r) => r.profile.id);
      for (const accountId of targets) {
        await this.refreshAccountQuota(accountId);
      }
      this.log(
        "积分查询已完成。",
        this.records.some((r) => r.profile.quotaError) ? "info" : "success",
      );
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
      this.onChange();
    }
  }
  apiDocument(id) {
    const record = this.records.find((r) => r.profile.id === id);
    if (!record) throw new Error("未找到该账号。");
    const document = record.apiEncrypted
      ? parseAuth(
          this.vault.decrypt(Buffer.from(record.apiEncrypted, "base64")),
        )
      : this.document(id);
    if (document.id !== id) throw new Error("查询凭据身份不一致，已停止操作。");
    return document;
  }
  async authorized(id, operation) {
    let document = this.apiDocument(id);
    try {
      return await operation(document);
    } catch (error) {
      if (
        !document.token ||
        !(
          error.kind === "auth" ||
          (!error.kind && error.message.includes("失效"))
        )
      )
        throw error;
      document = await renewAuth(document, this.request);
      if (document.id !== id)
        throw new Error("续期凭据身份不一致，已停止操作。");
      const encrypted = this.encrypt(document.raw);
      await this.saveRecords(
        this.records.map((record) =>
          record.profile.id === id
            ? {
                ...record,
                apiEncrypted: encrypted,
                ...(record.profile.protectedToken ? {} : { encrypted }),
                profile: {
                  ...record.profile,
                  tokenExpiresAt: document.tokenExpiresAt,
                },
              }
            : record,
        ),
      );
      return operation(document);
    }
  }
  async patchProfile(id, patch) {
    await this.saveRecords(
      this.records.map((record) =>
        record.profile.id === id
          ? { ...record, profile: { ...record.profile, ...patch } }
          : record,
      ),
    );
    this.onChange();
  }
  async refreshAccountQuota(id) {
    try {
      const quota = await this.authorized(id, (document) =>
        fetchQuota(document, this.request),
      );
      await this.patchProfile(id, { quota, quotaError: null });
    } catch (error) {
      await this.patchProfile(id, { quotaError: error.message });
    }
  }
  rewardTargets(ids = null, automatic = false) {
    if (
      ids !== null &&
      (!Array.isArray(ids) ||
        ids.length > 500 ||
        ids.some((id) => typeof id !== "string"))
    )
      throw new Error("账号选择无效。");
    const requested = ids === null ? null : new Set(ids);
    if (
      requested &&
      [...requested].some(
        (id) => !this.records.some((record) => record.profile.id === id),
      )
    )
      throw new Error("部分账号已移除，请刷新后重新选择。");
    return this.records
      .filter(
        (record) =>
          (!requested || requested.has(record.profile.id)) &&
          (!automatic || record.profile.automaticRewards !== false),
      )
      .map((record) => record.profile.id);
  }
  async rewardEntry(
    accountId,
    task,
    result,
    credit = null,
    detail = "",
    automatic = false,
  ) {
    const entry = {
      id: randomUUID(),
      accountId,
      task,
      result,
      credit,
      detail: detail.slice(0, 200),
      automatic,
      at: Date.now(),
    };
    const entries = [entry, ...this.rewardHistory].slice(0, 500);
    await atomicWrite(
      path.join(this.directory, "rewards-history.json"),
      JSON.stringify({ version: 1, entries }, null, 2),
    );
    this.rewardHistory = entries;
    this.onChange();
    return entry;
  }
  async fetchRewardState(id) {
    const profile = this.records.find(
      (record) => record.profile.id === id,
    )?.profile;
    if (!profile) throw new Error("未找到该账号。");
    const state = {
      checkin: null,
      travel: null,
      locations: [],
      travelEnabled: null,
      ...profile.rewards,
      checkinError: null,
      travelError: null,
      configError: null,
    };
    try {
      state.checkin = await this.authorized(id, (document) =>
        getCheckinStatus(document, this.request),
      );
    } catch (error) {
      state.checkinError = error.message;
    }
    try {
      const config = await this.authorized(id, (document) =>
        getTravelConfig(document, this.request),
      );
      state.locations = config.locations;
      state.travelEnabled = config.enabled;
    } catch (error) {
      state.configError = error.message;
    }
    if (state.travelEnabled === false && !state.configError) {
      state.travel = null;
      state.travelError = "当前账号的旅行活动尚未开放，请到官方成长中心查看。";
    } else {
      try {
        state.travel = await this.authorized(id, (document) =>
          getTravelStatus(document, this.request),
        );
      } catch (error) {
        state.travelError = error.message;
      }
    }
    await this.patchProfile(id, { rewards: state });
    return state;
  }
  refreshRewards(ids = null) {
    return this.exclusive(async () => {
      for (const id of this.rewardTargets(ids)) await this.fetchRewardState(id);
      this.log("签到和旅行状态已更新。", "info");
    });
  }
  async performClaims(
    ids,
    { checkin = true, travel = true, automatic = false } = {},
  ) {
    const results = [];
    for (const id of this.rewardTargets(ids, automatic)) {
      let state = await this.fetchRewardState(id);
      if (checkin) {
        if (state.checkinError || !state.checkin) {
          results.push(
            await this.rewardEntry(
              id,
              "checkin",
              "error",
              null,
              state.checkinError || "未取得签到状态。",
              automatic,
            ),
          );
        } else if (!state.checkin.checkedIn) {
          try {
            const result = await this.authorized(id, (document) =>
              checkIn(document, this.request),
            );
            // A successful POST establishes completion, even when the response
            // omits an amount. Repeated-day responses never become new rewards.
            state = {
              ...state,
              checkin: {
                checkedIn: true,
                day: rewardDay(),
                fetchedAt: Date.now(),
              },
              checkinError: null,
            };
            await this.patchProfile(id, { rewards: state });
            results.push(
              await this.rewardEntry(
                id,
                "checkin",
                result.already ? "already" : "claimed",
                result.credit,
                "",
                automatic,
              ),
            );
          } catch (error) {
            state = { ...state, checkinError: error.message };
            await this.patchProfile(id, { rewards: state });
            results.push(
              await this.rewardEntry(
                id,
                "checkin",
                "error",
                null,
                error.message,
                automatic,
              ),
            );
          }
        }
      }
      if (travel) {
        if (state.travelError || !state.travel) {
          results.push(
            await this.rewardEntry(
              id,
              "travel",
              "error",
              null,
              state.travelError || "未取得旅行状态。",
              automatic,
            ),
          );
        } else if (state.travel.state === "arrived") {
          try {
            const result = await this.authorized(id, (document) =>
              claimTravel(document, this.request),
            );
            results.push(
              await this.rewardEntry(
                id,
                "travel",
                "claimed",
                result.credit,
                "",
                automatic,
              ),
            );
            try {
              state = {
                ...state,
                travel: await this.authorized(id, (document) =>
                  getTravelStatus(document, this.request),
                ),
                travelError: null,
              };
            } catch (error) {
              state = {
                ...state,
                travelError: `奖励已领取，但状态刷新失败：${error.message}`,
              };
            }
            await this.patchProfile(id, { rewards: state });
          } catch (error) {
            state = { ...state, travelError: error.message };
            await this.patchProfile(id, { rewards: state });
            results.push(
              await this.rewardEntry(
                id,
                "travel",
                "error",
                null,
                error.message,
                automatic,
              ),
            );
          }
        }
      }
      if (
        results.some(
          (entry) => entry.accountId === id && entry.result === "claimed",
        )
      )
        await this.refreshAccountQuota(id);
    }
    return {
      results,
      claimed: results.filter((entry) => entry.result === "claimed").length,
      failed: results.filter((entry) => entry.result === "error").length,
      credit: results
        .filter((entry) => entry.result === "claimed")
        .reduce((sum, entry) => sum + (entry.credit ?? 0), 0),
      unknownAmounts: results.filter(
        (entry) => entry.result === "claimed" && entry.credit === null,
      ).length,
    };
  }
  claimRewards(ids = null, kind = "all") {
    if (!["all", "checkin", "travel"].includes(kind))
      throw new Error("领取任务无效。");
    return this.exclusive(async () => {
      const result = await this.performClaims(ids, {
        checkin: kind !== "travel",
        travel: kind !== "checkin",
      });
      this.log(
        `领取完成：${result.claimed} 项成功，${result.failed} 项失败。`,
        result.failed ? "info" : "success",
      );
      return result;
    });
  }
  async performDepart(id, locationId, automatic = false) {
    const state = await this.fetchRewardState(id);
    if (state.travelError || state.configError)
      throw new Error(state.travelError || state.configError);
    if (!state.travel || state.travel.state !== "idle")
      throw new Error("猫猫正在旅行或有奖励待领取，请先刷新状态。");
    if (state.travel.dailyLimitReached)
      throw new Error("今日旅行次数已达上限，请明天再来。");
    const location = state.locations.find(
      (item) => String(item.id) === String(locationId),
    );
    if (!location)
      throw new Error("该地点暂不可用，请从官方地点列表重新选择。");
    await this.authorized(id, (document) =>
      departTravel(document, location.id, this.request),
    );
    await this.patchProfile(id, { travelLocationId: String(location.id) });
    await this.rewardEntry(
      id,
      "depart",
      "departed",
      null,
      location.name,
      automatic,
    );
    try {
      state.travel = await this.authorized(id, (document) =>
        getTravelStatus(document, this.request),
      );
      state.travelError = null;
    } catch (error) {
      state.travelError = `已出发，但状态刷新失败：${error.message}`;
    }
    await this.patchProfile(id, { rewards: state });
  }
  depart(id, locationId) {
    return this.exclusive(async () => {
      await this.performDepart(id, locationId);
      this.log("猫猫已出发，奖励到账后可领取。");
    });
  }
  async runAutomation(now = Date.now()) {
    if (
      this.busy ||
      this.refreshPromise ||
      !this.records.length ||
      !(
        this.settings.autoCheckin ||
        this.settings.autoClaimTravel ||
        this.settings.autoDepartTravel
      ) ||
      (this.lastAutomationAt &&
        now - this.lastAutomationAt <
          this.settings.automationIntervalMinutes * 60000)
    )
      return null;
    this.lastAutomationAt = now;
    return this.exclusive(async () => {
      const clock = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(now)
        .split(":")
        .map(Number);
      const checkin =
        this.settings.autoCheckin &&
        clock[0] * 60 + clock[1] >=
          this.settings.checkinHour * 60 + this.settings.checkinMinute;
      const result =
        checkin || this.settings.autoClaimTravel
          ? await this.performClaims(null, {
              checkin,
              travel: this.settings.autoClaimTravel,
              automatic: true,
            })
          : null;
      if (this.settings.autoDepartTravel) {
        for (const id of this.rewardTargets(null, true)) {
          const profile = this.records.find(
            (record) => record.profile.id === id,
          ).profile;
          if (!profile.travelLocationId) continue;
          const state = await this.fetchRewardState(id);
          if (
            state.travelError ||
            state.configError ||
            !state.travel ||
            state.travel.state !== "idle" ||
            state.travel.dailyLimitReached
          )
            continue;
          try {
            await this.performDepart(id, profile.travelLocationId, true);
          } catch (error) {
            await this.rewardEntry(
              id,
              "depart",
              "error",
              null,
              error.message,
              true,
            );
          }
        }
      }
      if (result?.claimed || result?.failed)
        this.log(
          `自动领取：${result.claimed} 项成功，${result.failed} 项失败。`,
          result.failed ? "info" : "success",
        );
      return result;
    });
  }
  async sessions() {
    if (!(await exists(this.paths.database))) return [];
    return loadSessions(this.paths.database);
  }
  async usage(query) {
    return this.scanner.scan(this.paths.projects, await this.sessions(), query);
  }
  resumeSession(id, open) {
    return this.exclusive(async () => {
      const current = await this.active();
      if (!current) throw new Error("请先在 WorkBuddy 登录。");
      const session = (await this.sessions()).find((s) => s.id === id);
      if (!session) throw new Error("未找到该对话，请刷新后重试。");
      if (session.userId === current.id && !session.deleted) {
        await open(id);
        return;
      }
      const wasRunning = (await this.controller.status()).running;
      let backupPath = null;
      try {
        await this.controller.stop();
        if ((await this.active())?.id !== current.id)
          throw new Error("当前账号发生变化，已停止恢复。");
        backupPath = await prepareSession(
          this.paths.database,
          this.backupDirectory,
          session,
          current.id,
        );
        if ((await this.active())?.id !== current.id)
          throw new Error("当前账号发生变化，请重新打开对话。");
        await this.controller.launch();
        await open(id);
        await this.pruneBackups();
        this.log("对话已恢复到当前账号，迁移前备份已保留。");
      } catch (error) {
        if (wasRunning) {
          try {
            await this.controller.launch();
          } catch {
            throw new Error(
              "对话操作结束，但 WorkBuddy 重新启动失败。请手动打开客户端。",
            );
          }
        }
        if (backupPath)
          throw new Error(
            `对话迁移已完成，但打开失败。安全备份已保留，请手动在 WorkBuddy 中继续。${error.message}`,
          );
        throw error;
      }
    });
  }
  async exportAccounts(password) {
    const records = this.records.map((r) => {
      const document = r.apiEncrypted
        ? parseAuth(this.vault.decrypt(Buffer.from(r.apiEncrypted, "base64")))
        : this.document(r.profile.id);
      if (document.protectedToken)
        throw new Error(
          "账号包含 WorkBuddy 的本机加密凭据。请先通过网页登录重新授权，再导出跨设备备份。",
        );
      if (document.id !== r.profile.id)
        throw new Error("备份凭据身份不一致，已停止导出。");
      return { profile: r.profile, raw: document.raw };
    });
    return encodeBackup(records, password);
  }
  importAccounts(raw, password) {
    return this.exclusive(async () => {
      const records = decodeBackup(raw, password);
      let next = [...this.records];
      for (const item of records) {
        if (next.some((r) => r.profile.id === item.profile.id)) continue;
        const auth = parseAuth(item.raw);
        const profile = {
          id: auth.id,
          nickname: String(item.profile.nickname || auth.nickname).slice(0, 80),
          originalNickname: auth.nickname,
          accountType: auth.accountType,
          phoneHint: auth.phoneHint,
          capturedAt: Date.now(),
          lastUsedAt: 0,
          favorite: !!item.profile.favorite,
          note: String(item.profile.note || "").slice(0, 300),
          tokenExpiresAt: auth.tokenExpiresAt,
          quota: null,
          quotaError: null,
          protectedToken: auth.protectedToken,
          rewards: null,
          automaticRewards: true,
          travelLocationId: "",
        };
        next.push({ profile, encrypted: this.encrypt(auth.raw) });
      }
      const added = next.length - this.records.length;
      await this.saveRecords(next);
      this.log(`已导入 ${added} 个新账号。`);
      return added;
    });
  }
  importLegacy(records) {
    return this.exclusive(async () => {
      let count = 0;
      for (const item of records) {
        const auth = parseAuth(item.raw);
        if (this.records.some((r) => r.profile.id === auth.id)) continue;
        await this.capture(auth);
        if (item.nickname)
          await this.saveRecords(
            this.records.map((r) =>
              r.profile.id === auth.id
                ? {
                    ...r,
                    profile: {
                      ...r.profile,
                      nickname: String(item.nickname).slice(0, 80),
                    },
                  }
                : r,
            ),
          );
        count++;
      }
      this.log(`已迁入 ${count} 个旧版账号。`);
      return count;
    });
  }
  async backups() {
    let names;
    try {
      names = await fs.readdir(this.backupDirectory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const files = await Promise.all(
      names
        .filter((name) => /^workbuddy-.*\.db$/.test(name))
        .map(async (name) => {
          const info = await fs.stat(path.join(this.backupDirectory, name));
          return { name, size: info.size, createdAt: info.mtimeMs };
        }),
    );
    return files.sort((a, b) => b.createdAt - a.createdAt);
  }
  backupSessions() {
    return this.exclusive(async () => {
      const name = `workbuddy-${Date.now()}-manual.db`;
      await backupDatabase(
        this.paths.database,
        path.join(this.backupDirectory, name),
      );
      await this.pruneBackups();
      this.log("对话数据库已完整备份。");
      return name;
    });
  }
  async pruneBackups() {
    const files = await this.backups();
    for (const file of files.slice(this.settings.backupLimit))
      await fs.rm(path.join(this.backupDirectory, file.name));
  }
  async snapshot() {
    let active = null,
      authError = null,
      status = null;
    try {
      const document = await this.active();
      if (document)
        active = {
          id: document.id,
          nickname: document.nickname,
          phoneHint: document.phoneHint,
        };
    } catch (e) {
      authError = e.message;
    }
    try {
      status = await this.controller.status();
    } catch {
      status = {
        installed: !!(await this.controller.executable()),
        running: null,
        executable: await this.controller.executable(),
      };
    }
    return {
      accounts: this.records.map((r) => r.profile),
      current: active,
      settings: this.settings,
      paths: this.paths,
      client: status,
      encryptionAvailable: this.vault.available(),
      busy: this.busy,
      refreshing: !!this.refreshPromise,
      events: this.events,
      rewardHistory: this.rewardHistory,
      authError,
    };
  }
  async diagnostics() {
    const state = await this.snapshot(),
      checks = [];
    checks.push({
      name: "WorkBuddy 客户端",
      ok: state.client.installed,
      detail: state.client.executable || "未找到安装路径，可在连接设置中指定。",
    });
    checks.push({
      name: "系统凭据加密",
      ok: state.encryptionAvailable,
      detail: state.encryptionAvailable
        ? "系统加密服务可用。"
        : "请解锁系统钥匙串。",
    });
    checks.push({
      name: "登录信息",
      ok: !!state.current,
      detail: state.current
        ? "登录文件格式有效。"
        : state.authError || "尚未登录，请先在 WorkBuddy 完成登录。",
    });
    checks.push({
      name: "对话数据库",
      ok: await exists(this.paths.database),
      detail: this.paths.database,
    });
    checks.push({
      name: "本地 Token 记录",
      ok: await exists(this.paths.projects),
      detail: this.paths.projects,
    });
    const probe = path.join(this.directory, ".permission-probe");
    try {
      await atomicWrite(probe, "ok");
      await fs.rm(probe);
      checks.push({
        name: "应用数据权限",
        ok: true,
        detail: "应用数据目录可读写。",
      });
    } catch {
      checks.push({
        name: "应用数据权限",
        ok: false,
        detail: "请检查应用数据目录的访问权限。",
      });
    }
    return { checkedAt: Date.now(), checks };
  }
}
