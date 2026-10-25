import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite, readBounded } from "./files.mjs";
import {
  getGrowthTasks,
  acceptGrowthTasks,
  claimGrowthTask,
} from "./growth-tasks.mjs";
import { dialogueSpec, sendDialogue, reportDialogue } from "./dialogue.mjs";
import {
  activitySpec,
  loadActivityResources,
  executeActivity,
  pendingReason,
} from "./activity.mjs";
import { setTimeout as delay } from "node:timers/promises";

const runStates = [
  "running",
  "completed",
  "cancelled",
  "interrupted",
  "failed",
];
const actionStates = [
  "claimed",
  "accepted",
  "departed",
  "pending",
  "skipped",
  "error",
  "dialogue",
  "activity",
];
const counters = [
  "claimed",
  "accepted",
  "departed",
  "pending",
  "skipped",
  "failed",
  "unknownAmounts",
];
function text(value, limit) {
  if (typeof value !== "string" || value.length > limit)
    throw new Error("invalid task text");
  return value;
}
function amount(value, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER ||
    (integer && !Number.isSafeInteger(value))
  )
    throw new Error("invalid task amount");
  return value;
}
const optionalAmount = (value) =>
  value === null || value === undefined ? null : amount(value);
// Task history is a public document. Only known fields may reach the renderer.
function restoreRun(run) {
  if (
    !runStates.includes(run?.status) ||
    !Array.isArray(run.accountIds) ||
    run.accountIds.length > 1000 ||
    !Array.isArray(run.results) ||
    run.results.length > 1000 ||
    typeof run.cancelRequested !== "boolean"
  )
    throw new Error("invalid task run");
  const accountIds = run.accountIds.map((value) => text(value, 200));
  const totalAccounts = amount(run.totalAccounts, true),
    completedAccounts = amount(run.completedAccounts, true);
  if (totalAccounts !== accountIds.length || completedAccounts > totalAccounts)
    throw new Error("invalid task account count");
  const summary = Object.fromEntries(
    counters.map((key) => [key, amount(run.summary?.[key], true)]),
  );
  summary.credit = amount(run.summary?.credit);
  summary.energy = amount(run.summary?.energy);
  summary.dialogues = amount(run.summary?.dialogues ?? 0, true);
  summary.activities = amount(run.summary?.activities ?? 0, true);
  return {
    id: text(run.id, 200),
    status: run.status,
    startedAt: amount(run.startedAt, true),
    finishedAt: optionalAmount(run.finishedAt),
    accountIds,
    totalAccounts,
    completedAccounts,
    currentAccountId:
      run.currentAccountId === null ? null : text(run.currentAccountId, 200),
    currentStep: text(run.currentStep, 500),
    cancelRequested: run.cancelRequested,
    dialogueAttempts: amount(run.dialogueAttempts ?? 0, true),
    dialogueLimit: amount(run.dialogueLimit ?? 0, true),
    activityAttempts: amount(run.activityAttempts ?? 0, true),
    activityLimit: amount(run.activityLimit ?? 0, true),
    summary,
    results: run.results.map((entry) => {
      if (
        !actionStates.includes(entry?.status) ||
        !accountIds.includes(entry.accountId)
      )
        throw new Error("invalid task action");
      return {
        id: text(entry.id, 200),
        accountId: entry.accountId,
        code: text(entry.code, 100),
        title: text(entry.title, 120),
        status: entry.status,
        credit: optionalAmount(entry.credit),
        energy: optionalAmount(entry.energy),
        current: optionalAmount(entry.current),
        target: optionalAmount(entry.target),
        detail: text(entry.detail, 500),
        at: amount(entry.at, true),
      };
    }),
  };
}

export class TaskRunner {
  current = null;
  warning = null;
  pendingPlan = null;
  constructor(store) {
    this.store = store;
    this.pause = delay;
  }
  get file() {
    return path.join(this.store.directory, "task-run.json");
  }
  snapshot() {
    return structuredClone(this.current);
  }
  prepare(ids, options = {}) {
    if (this.store.definition.region !== "cn")
      throw new Error("一键做任务目前仅支持 WorkBuddy 国内版。");
    const selected = this.store.rewardTargets(ids),
      {
        includeAI = true,
        includeActivities = false,
        maxCalls = 80,
        prompt = "请用一句话介绍你能帮助我完成什么工作。",
      } = options;
    if (!selected.length) throw new Error("请先选择要执行任务的账号。");
    if (
      typeof includeAI !== "boolean" ||
      typeof includeActivities !== "boolean" ||
      !Number.isSafeInteger(maxCalls) ||
      maxCalls < 1 ||
      maxCalls > 200
    )
      throw new Error("对话总上限须为 1–200 条。");
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 200 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(prompt)
    )
      throw new Error("对话内容须为 1–200 个字符。");
    return this.store.exclusive(async () => {
      const now = Date.now(),
        plan = {
          id: randomUUID(),
          createdAt: now,
          expiresAt: now + 10 * 60 * 1000,
          accountIds: selected,
          options: { includeAI, includeActivities, maxCalls, prompt },
          outputLimit: 64,
          maxCalls: 0,
          maxActivities: 0,
          accounts: [],
        };
      let budget = includeAI ? maxCalls : 0,
        activityBudget = includeActivities ? 200 : 0;
      for (const [index, accountId] of selected.entries()) {
        const account = {
          accountId,
          nickname:
            this.store.records.find((record) => record.profile.id === accountId)
              ?.profile.nickname || "WorkBuddy 账号",
          tasks: [],
          pendingTitles: [],
          pendingReasons: [],
          note: "",
        };
        plan.accounts.push(account);
        const pending = (task, reason) => {
          account.pendingTitles.push(task.title);
          account.pendingReasons.push({
            code: task.code,
            title: task.title,
            reason,
          });
        };
        if (!includeAI && !includeActivities) {
          account.note = "仅执行基础任务，不发送对话。";
          continue;
        }
        if (index >= 20) {
          account.note =
            "本次最多预览 20 个账号的体验任务，此账号只执行基础任务。";
          continue;
        }
        try {
          const tasks = await this.store.authorized(accountId, (document) =>
            getGrowthTasks(document, this.store.request),
          );
          tasks.sort((a, b) => {
            const priority = (task) =>
              task.code === "Model_chat_GLM5.2"
                ? 0
                : activitySpec({ ...task, locked: false })?.paid === false
                  ? 1
                  : task.code === "expert_5"
                    ? 4
                    : task.code === "chat_5"
                      ? 8
                      : 3;
            return priority(a) - priority(b);
          });
          let perAccount = 40,
            perAccountActivities = 40;
          for (const task of tasks) {
            if (task.claimed || task.claimable) continue;
            const candidate = { ...task, locked: false },
              activity = activitySpec(candidate),
              chat = dialogueSpec(candidate, now),
              spec = activity || chat;
            if (!spec) {
              pending(task, pendingReason(task));
              continue;
            }
            const paid = activity ? activity.paid : true;
            if (
              (paid && !includeAI) ||
              (activity?.compatibility && !includeActivities)
            ) {
              pending(
                task,
                paid && !includeAI
                  ? "本次未包含真实对话。"
                  : "本次未包含兼容活动上报。",
              );
              continue;
            }
            const limit = paid
              ? Math.min(perAccount, budget)
              : Math.min(perAccountActivities, activityBudget);
            if (!limit) {
              pending(
                task,
                paid
                  ? "本次对话预算已分配，可提高上限后重新预览。"
                  : "本次活动次数已达到上限。",
              );
              continue;
            }
            let resources = [];
            try {
              if (activity?.requiresResource)
                resources = await this.store.authorized(accountId, (document) =>
                  loadActivityResources(document, activity, this.store.request),
                );
            } catch (error) {
              pending(task, "查询可用资源失败：" + error.message);
              continue;
            }
            if (activity?.requiresResource && !resources.length) {
              pending(
                task,
                activity.kind === "skill"
                  ? "此账号尚无可用的已安装技能，请先安装一个官方技能。"
                  : "未找到与任务对应的可用专家，请在官方成长中心核对。",
              );
              continue;
            }
            if (
              activity?.requiresResource &&
              !activity.expertId &&
              task.current > 0 &&
              resources.length > task.current
            )
              resources = resources.slice(task.current);
            const count = Math.min(
              spec.remaining,
              limit,
              resources.length || 40,
            );
            account.tasks.push({
              code: task.code,
              title: task.title,
              model: spec.model,
              modelName: spec.modelName,
              calls: paid ? count : 0,
              actions: paid ? 0 : count,
              current: task.current,
              target: task.target,
              ...(activity ? { kind: activity.kind } : {}),
              resources: resources.slice(0, count),
              waitingForUnlock: task.locked,
            });
            if (paid) {
              budget -= count;
              perAccount -= count;
              plan.maxCalls += count;
            } else {
              activityBudget -= count;
              perAccountActivities -= count;
              plan.maxActivities += count;
            }
          }
          if (!account.tasks.length)
            account.note =
              "当前没有待执行的已知体验任务，仍会签到、接取及领取已达标奖励。";
        } catch (error) {
          account.note =
            "执行范围查询失败，本次只执行基础任务：" + error.message;
        }
      }
      this.pendingPlan = plan;
      return structuredClone(plan);
    });
  }
  async dialogues(accountId, tasks, plan, execution) {
    const approved =
      plan.accounts.find((account) => account.accountId === accountId)?.tasks ||
      [];
    const advanced = (before, after) =>
      approved.some((row) => {
        const old = before.find((task) => task.code === row.code),
          fresh = after.find((task) => task.code === row.code);
        return (
          old &&
          fresh &&
          ((!old.claimable && fresh.claimable) ||
            (!old.claimed && fresh.claimed) ||
            (fresh.current ?? 0) > (old.current ?? 0))
        );
      });
    while (!this.stopped()) {
      const row = approved.find((row) => {
        const task = tasks.find((task) => task.code === row.code),
          spec = task && (row.kind ? activitySpec(task) : dialogueSpec(task));
        if (
          !spec ||
          task.status === "not_accepted" ||
          execution.failed.has(row.code)
        )
          return false;
        const paid = row.calls > 0;
        return (
          (!paid ||
            (!execution.blockedPaid &&
              this.current.dialogueAttempts < plan.maxCalls)) &&
          (paid || this.current.activityAttempts < plan.maxActivities) &&
          (execution.used.get(row.code) || 0) <
            (paid ? row.calls : row.actions) &&
          (!paid || spec.model === row.model) &&
          (!row.kind || spec.kind === row.kind)
        );
      });
      if (!row) break;
      const paid = row.calls > 0,
        index = execution.used.get(row.code) || 0;
      await this.step(
        accountId,
        (paid ? "真实对话：" : "活动记录：") + row.title,
      );
      if (this.stopped()) break;
      if (paid) this.current.dialogueAttempts++;
      else this.current.activityAttempts++;
      execution.used.set(row.code, index + 1);
      await this.flush();
      if (this.stopped()) break;
      let result;
      try {
        if (row.kind) {
          result = await this.store.authorized(accountId, (document) =>
            executeActivity(
              document,
              {
                kind: row.kind,
                code: row.code,
                index: row.current + index,
                model: row.model,
                prompt: plan.options.prompt,
                resource: row.resources?.[index],
              },
              this.store.request,
              { shouldStop: () => this.stopped(), pause: this.pause },
            ),
          );
          await this.add(
            accountId,
            row.code,
            paid ? "真实对话 · " + row.title : row.title,
            paid ? "dialogue" : "activity",
            { detail: result.detail },
          );
        } else {
          const dialogue = await this.store.authorized(accountId, (document) =>
            sendDialogue(
              document,
              { model: row.model, prompt: plan.options.prompt },
              this.store.request,
            ),
          );
          await this.add(
            accountId,
            row.code,
            "真实对话 · " + row.modelName,
            "dialogue",
            {
              detail: dialogue.hasAnswer
                ? "已收到完整模型响应，对话消耗以官方计费为准。"
                : "模型已返回推理内容并结束响应，对话消耗以官方计费为准。",
            },
          );
          try {
            await this.store.authorized(accountId, (document) =>
              reportDialogue(document, dialogue, this.store.request),
            );
          } catch (error) {
            await this.add(accountId, row.code, "对话活动回执", "error", {
              detail:
                "真实对话已完成，但活动回执失败，本账号停止继续对话：" +
                error.message,
            });
            execution.blockedPaid = true;
            execution.failed.add(row.code);
            continue;
          }
        }
      } catch (error) {
        if (error.kind === "cancelled" && this.stopped()) {
          await this.add(accountId, row.code, row.title, "pending", {
            detail: error.message,
          });
          break;
        }
        if (error.kind === "receipt")
          await this.add(
            accountId,
            row.code,
            "真实对话 · " + row.title,
            "dialogue",
            { detail: "已收到完整回复，活动回执尚未确认。" },
          );
        await this.add(
          accountId,
          row.code,
          paid ? "真实对话 · " + row.title : row.title,
          "error",
          {
            detail: error.message,
          },
        );
        execution.failed.add(row.code);
        if (paid) execution.blockedPaid = true;
        continue;
      }
      let fresh = tasks,
        progress = false;
      try {
        for (const milliseconds of [0, 750, 1500, 3000, 5000]) {
          if (this.stopped()) break;
          if (milliseconds) await this.pause(milliseconds);
          if (this.stopped()) break;
          fresh = await this.store.authorized(accountId, (document) =>
            getGrowthTasks(document, this.store.request),
          );
          progress = advanced(tasks, fresh);
          if (progress) break;
        }
      } catch (error) {
        await this.add(accountId, row.code, "回读任务进度", "error", {
          detail:
            (paid
              ? "对话已完成，但官方进度查询失败，本账号停止继续对话："
              : "活动已提交，但官方进度查询失败：") + error.message,
        });
        execution.failed.add(row.code);
        if (paid) execution.blockedPaid = true;
      }
      tasks = fresh;
      if (!progress && !this.stopped()) {
        execution.notes.set(
          row.code,
          paid
            ? "真实对话已完成，但官方未确认任务进度，本账号已停止继续对话。"
            : "活动记录已提交，官方尚未确认进度，本轮不会重复提交此任务。",
        );
        execution.failed.add(row.code);
        if (paid) execution.blockedPaid = true;
      }
    }
    return tasks;
  }
  async init() {
    let raw;
    try {
      raw = await readBounded(this.file, 4 * 1024 * 1024);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1) throw new Error("invalid task history version");
      this.current = restoreRun(data.run);
    } catch {
      await fs.rename(
        this.file,
        path.join(
          this.store.directory,
          `task-run-damaged-${Date.now()}-${randomUUID()}.json`,
        ),
      );
      this.current = null;
      this.warning = "上次任务记录无法读取，原记录已备份保留。";
      return;
    }
    this.warning = null;
    if (this.current.status === "running") {
      this.current.status = "interrupted";
      this.current.finishedAt = Date.now();
      this.current.currentStep = "上次执行已中断，重新运行时会先查询官方状态。";
      await this.flush();
    }
  }
  async flush() {
    await atomicWrite(
      this.file,
      JSON.stringify({ version: 1, run: this.current }, null, 2),
    );
    this.store.onChange();
  }
  async step(accountId, title) {
    this.current.currentAccountId = accountId;
    this.current.currentStep = title;
    await this.flush();
  }
  async add(accountId, code, title, status, values = {}) {
    const entry = {
      id: randomUUID(),
      accountId,
      code,
      title,
      status,
      credit: null,
      energy: null,
      detail: "",
      at: Date.now(),
      ...values,
    };
    this.current.results.push(entry);
    if (this.current.results.length > 1000) this.current.results.shift();
    const summary = this.current.summary;
    if (status === "claimed") {
      summary.claimed++;
      summary.credit += entry.credit ?? 0;
      summary.energy += entry.energy ?? 0;
      if (entry.credit === null && entry.energy === null)
        summary.unknownAmounts++;
    } else if (status === "accepted") summary.accepted++;
    else if (status === "dialogue") summary.dialogues++;
    else if (status === "activity") summary.activities++;
    else if (status === "departed") summary.departed++;
    else if (status === "pending") summary.pending++;
    else if (status === "skipped") summary.skipped++;
    else if (status === "error") summary.failed++;
    await this.flush();
    return entry;
  }
  cancel(id) {
    if (typeof id !== "string" || id !== this.current?.id)
      throw new Error("任务批次已变化，请刷新后重试。");
    if (this.current.status !== "running") return false;
    this.current.cancelRequested = true;
    this.current.currentStep = "正在停止后续任务，当前请求结束后保留结果。";
    this.store.onChange();
    return true;
  }
  stopped() {
    return this.current.cancelRequested;
  }
  async growth(accountId, plan) {
    const store = this.store;
    await this.step(accountId, "读取成长中心任务");
    let tasks;
    try {
      tasks = await store.authorized(accountId, (document) =>
        getGrowthTasks(document, store.request),
      );
    } catch (error) {
      await this.add(accountId, "growth", "成长任务查询", "error", {
        detail: error.message,
      });
      return;
    }
    const execution = {
        used: new Map(),
        failed: new Set(),
        notes: new Map(),
        blockedPaid: false,
      },
      claimed = new Set(),
      accepted = new Set();
    let acceptFailed = false;
    for (let round = 0; round < (plan ? 6 : 1) && !this.stopped(); round++) {
      const before = JSON.stringify(
        tasks.map((task) => [
          task.code,
          task.status,
          task.current,
          task.locked,
        ]),
      );
      const pending = tasks.filter(
        (task) =>
          !task.claimed &&
          !task.locked &&
          task.status === "not_accepted" &&
          !accepted.has(task.code),
      );
      if (pending.length && !acceptFailed) {
        await this.step(accountId, "接取 " + pending.length + " 项成长任务");
        if (this.stopped()) return;
        try {
          await store.authorized(accountId, (document) =>
            acceptGrowthTasks(
              document,
              pending.map((task) => task.code),
              store.request,
            ),
          );
          const fresh = await store.authorized(accountId, (document) =>
            getGrowthTasks(document, store.request),
          );
          tasks = fresh;
          for (const task of pending) {
            accepted.add(task.code);
            const updated = fresh.find((item) => item.code === task.code);
            await this.add(
              accountId,
              task.code,
              task.title,
              updated &&
                ["accepted", "in_progress", "completed", "claimed"].includes(
                  updated.status,
                )
                ? "accepted"
                : "pending",
              {
                detail:
                  updated?.status === "not_accepted"
                    ? "接取请求已提交，官方状态尚未确认。"
                    : "任务接取后将以官方进度为准。",
              },
            );
          }
        } catch (error) {
          acceptFailed = true;
          await this.add(accountId, "accept", "接取成长任务", "error", {
            detail: error.message,
          });
        }
      }
      if (plan && !this.stopped())
        tasks = await this.dialogues(accountId, tasks, plan, execution);
      let claimedAny = false;
      for (const task of tasks) {
        if (this.stopped()) return;
        if (
          task.claimed ||
          task.locked ||
          !task.claimable ||
          !task.hasReward ||
          claimed.has(task.code)
        )
          continue;
        await this.step(accountId, "领取：" + task.title);
        if (this.stopped()) return;
        try {
          const result = await store.authorized(accountId, (document) =>
            claimGrowthTask(document, task.code, store.request),
          );
          claimed.add(task.code);
          claimedAny = true;
          await this.add(
            accountId,
            task.code,
            task.title,
            result.already ? "skipped" : "claimed",
            {
              credit: result.credit,
              energy: result.energy,
              detail: result.already
                ? "奖励此前已领取。"
                : "奖励按官方返回结果记录。",
            },
          );
        } catch (error) {
          claimed.add(task.code);
          await this.add(accountId, task.code, task.title, "error", {
            detail: error.message,
          });
        }
      }
      if (!plan || this.stopped()) break;
      if (
        !claimedAny &&
        JSON.stringify(
          tasks.map((task) => [
            task.code,
            task.status,
            task.current,
            task.locked,
          ]),
        ) === before
      )
        break;
      try {
        tasks = await store.authorized(accountId, (document) =>
          getGrowthTasks(document, store.request),
        );
      } catch (error) {
        await this.add(accountId, "growth-refresh", "回读任务进度", "error", {
          detail: error.message,
        });
        break;
      }
    }
    for (const task of tasks) {
      if (this.stopped()) return;
      if (claimed.has(task.code)) continue;
      if (task.claimed) {
        await this.add(accountId, task.code, task.title, "skipped", {
          detail: "奖励已领取。",
        });
        continue;
      }
      const plannedReason = plan?.accounts
        .find((account) => account.accountId === accountId)
        ?.pendingReasons?.find((row) => row.code === task.code)?.reason;
      await this.add(
        accountId,
        task.code,
        task.title,
        task.locked ? "skipped" : "pending",
        {
          current: task.current,
          target: task.target,
          detail:
            execution.notes.get(task.code) ||
            plannedReason ||
            pendingReason(task),
        },
      );
    }
  }
  run(ids = null, planId = null) {
    if (this.store.definition.region !== "cn")
      throw new Error("一键做任务目前仅支持 WorkBuddy 国内版。");
    const selected = this.store.rewardTargets(ids);
    if (!selected.length) throw new Error("请先选择要执行任务的账号。");
    return this.store.exclusive(async () => {
      let plan = null;
      if (planId !== null) {
        plan = this.pendingPlan;
        if (!plan || plan.id !== planId || plan.expiresAt < Date.now())
          throw new Error("执行范围已过期或已使用，请重新预览确认。");
        if (JSON.stringify(plan.accountIds) !== JSON.stringify(selected))
          throw new Error("账号与已确认范围不一致，请重新预览。");
        this.pendingPlan = null;
      }
      this.current = {
        id: randomUUID(),
        status: "running",
        startedAt: Date.now(),
        finishedAt: null,
        accountIds: selected,
        totalAccounts: selected.length,
        completedAccounts: 0,
        currentAccountId: null,
        currentStep: "准备执行任务",
        cancelRequested: false,
        dialogueAttempts: 0,
        dialogueLimit: plan?.maxCalls || 0,
        activityAttempts: 0,
        activityLimit: plan?.maxActivities || 0,
        results: [],
        summary: {
          claimed: 0,
          accepted: 0,
          departed: 0,
          pending: 0,
          skipped: 0,
          failed: 0,
          credit: 0,
          energy: 0,
          unknownAmounts: 0,
          dialogues: 0,
          activities: 0,
        },
      };
      try {
        await this.flush();
        for (const accountId of selected) {
          if (this.stopped()) break;
          await this.step(accountId, "查询签到与旅行奖励");
          const claims = await this.store.performClaims([accountId], {
            shouldStop: () => this.stopped(),
          });
          for (const entry of claims.results)
            await this.add(
              accountId,
              entry.task,
              entry.task === "checkin" ? "每日签到" : "旅行奖励",
              entry.result === "claimed"
                ? "claimed"
                : entry.result === "error"
                  ? "error"
                  : "skipped",
              { credit: entry.credit, detail: entry.detail },
            );
          if (this.stopped()) break;
          await this.growth(accountId, plan);
          if (this.stopped()) break;
          const profile = this.store.records.find(
            (record) => record.profile.id === accountId,
          )?.profile;
          const travel = profile?.rewards?.travel;
          if (
            travel &&
            !profile.rewards.travelError &&
            !profile.rewards.configError
          ) {
            if (travel.state === "idle" && !travel.dailyLimitReached) {
              if (profile.travelLocationId) {
                await this.step(accountId, "按已保存的地点安排猫猫出发");
                try {
                  const departed = await this.store.performDepart(
                    accountId,
                    profile.travelLocationId,
                    false,
                    () => this.stopped(),
                  );
                  if (departed)
                    await this.add(
                      accountId,
                      "depart",
                      "猫猫旅行出发",
                      "departed",
                      { detail: "已按账号保存的官方地点出发。" },
                    );
                } catch (error) {
                  await this.add(accountId, "depart", "猫猫旅行出发", "error", {
                    detail: error.message,
                  });
                }
              } else
                await this.add(accountId, "depart", "猫猫旅行出发", "pending", {
                  detail: "请先为此账号选择旅行地点，再次执行即可出发。",
                });
            } else
              await this.add(
                accountId,
                "depart",
                "猫猫旅行出发",
                travel.state === "traveling" ? "pending" : "skipped",
                {
                  detail:
                    travel.state === "traveling"
                      ? "旅行仍在进行，到达后可再次执行领取奖励。"
                      : travel.dailyLimitReached
                        ? "今日旅行次数已用完。"
                        : "旅行尚有待处理奖励，请刷新状态。",
                },
              );
          }
          if (!this.stopped()) await this.store.refreshAccountQuota(accountId);
          this.current.completedAccounts++;
          await this.flush();
        }
        this.current.status = this.stopped() ? "cancelled" : "completed";
        this.current.finishedAt = Date.now();
        this.current.currentAccountId = null;
        this.current.currentStep = this.stopped()
          ? "已停止后续任务，已完成结果保留。"
          : "本次任务执行结束";
        await this.flush();
        this.store.log(
          `任务执行${this.current.status === "cancelled" ? "已停止" : "结束"}：领取 ${this.current.summary.claimed} 项，接取 ${this.current.summary.accepted} 项，出发 ${this.current.summary.departed} 项，失败 ${this.current.summary.failed} 项。`,
          this.current.summary.failed ? "info" : "success",
        );
        return this.current;
      } catch (error) {
        this.current.status = "failed";
        this.current.finishedAt = Date.now();
        this.current.currentStep = "任务执行中断，请先刷新官方状态后重试。";
        try {
          await this.flush();
        } catch {
          this.warning = "任务记录保存失败，请刷新官方状态后再执行。";
          this.store.onChange();
        }
        throw error;
      }
    });
  }
}
