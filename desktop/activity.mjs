import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { apiOrigin } from "./quota.mjs";
import { RewardError } from "./rewards.mjs";
import { sendDialogue, reportDialogue } from "./dialogue.mjs";
import { setTimeout as delay } from "node:timers/promises";

const activityProtocolVersion = "5.8.3";
const expertNames = {
  Expert_lighthouse: "腾讯轻量云",
  WorkBuddy_Valorant: "无畏契约拼豆专家",
  expert_use_maidehao: "中国电商运营专家",
  expert_use_douyinyin: "抖音策略师",
  expert_use_shangjia_xuanchuan: "商家宣传页与海报设计师",
  expert_use_bowangwang: "直播电商教练",
};
const expertIds = {
  Expert_lighthouse: "ex_2cvvUZQhDyeJ",
  WorkBuddy_Valorant: "ex_xQHHD1u5Jkua",
  expert_use_maidehao: "ex_GDl31WahyIH0",
  expert_use_douyinyin: "ex_FbY5nlWTqDod",
  expert_use_shangjia_xuanchuan: "ex_Weo3x2EZuSDm",
  expert_use_bowangwang: "ex_WZY136wV5aMt",
};
const kinds = {
  RichMeow_Chat: ["desktop-chat", "桌面对话", true],
  expert_5: ["expert", "召唤专家", true],
  Expert_team_use_3: ["team", "召唤专家团", true],
  skill_1: ["skill", "技能体验", true],
  template_5: ["template", "模板活动记录", true],
  playbook_prompt: ["playbook", "灵感活动记录", true],
  Library_read: ["library", "资料库活动记录", false],
  Hp_Appearance: ["appearance", "主题活动记录", false],
  create_canvas: ["canvas", "设计画布活动记录", true],
  automation_1: ["automation", "自动化活动记录", false],
  Buddy_App: ["apps", "发现应用活动记录", false],
  Buddy_App_QQ: ["apps", "教师助手活动记录", false],
};
for (const code of Object.keys(expertNames))
  kinds[code] = ["expert", "指定专家", true];
const resourceId = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9_.-]{1,160}$/.test(value) &&
  !value.includes("..");
const clean = (value, length = 120) =>
  typeof value === "string"
    ? value.replace(/[\x00-\x1f]/g, " ").slice(0, length)
    : "";
const normalize = (value) => value.replace(/[\s「」“”《》【】]/g, "");

export function activitySpec(task) {
  const entry = Object.hasOwn(kinds, task.code) ? kinds[task.code] : null;
  if (
    !entry ||
    task.claimed ||
    task.locked ||
    task.claimable ||
    !task.hasReward ||
    !["not_accepted", "accepted", "in_progress"].includes(task.status) ||
    !Number.isSafeInteger(task.current) ||
    !Number.isSafeInteger(task.target) ||
    task.current < 0 ||
    task.current >= task.target
  )
    return null;
  const compatibility = !["expert", "team", "desktop-chat"].includes(entry[0]);
  return {
    kind: entry[0],
    label: entry[1],
    paid: entry[2],
    compatibility,
    requiresResource: ["expert", "team", "skill"].includes(entry[0]),
    remaining: Math.min(40, task.target - task.current),
    model: entry[2] ? "fast-model" : null,
    modelName: entry[2]
      ? compatibility
        ? "快速模式 · 活动上报"
        : "快速模式"
      : "兼容活动上报",
    ...(expertNames[task.code]
      ? {
          keyword: expertNames[task.code],
          expertId: resourceId(task.expertId)
            ? task.expertId
            : expertIds[task.code],
          assignedByTask: resourceId(task.expertId),
        }
      : {}),
  };
}

// Planning reserves a bounded scope for known tasks whose prerequisites hide
// progress. Execution still requires fresh official progress; these estimates
// must never be used as evidence of completion or eligibility.
export function planningCandidate(task) {
  const deferred =
    !Number.isSafeInteger(task.current) || !Number.isSafeInteger(task.target);
  const known =
    Object.hasOwn(kinds, task.code) ||
    ["chat_5", "black_cat", "Model_chat_GLM5.2"].includes(task.code);
  const bound =
    { chat_5: 5, expert_5: 5, Expert_team_use_3: 3, template_5: 5 }[
      task.code
    ] ?? 1;
  return {
    deferred: deferred && known,
    candidate: {
      ...task,
      locked: false,
      ...(deferred && known
        ? {
            current: Number.isSafeInteger(task.current) ? task.current : 0,
            target: Number.isSafeInteger(task.target)
              ? task.target
              : (task.current ?? 0) + bound,
          }
        : {}),
    },
  };
}

export function pendingReason(task) {
  if (task.claimed) return "奖励已领取。";
  if (task.locked)
    return "等待前置任务解锁，已确认范围内的任务会在本轮继续检查。";
  if (task.code === "wb_wechat_oa_subscribe_task")
    return "需要本人在微信关注官方公众号，服务端会核对实际关注关系。";
  if (task.code === "Expert_Philanthropy")
    return "需要本人完成捐款及支付确认，自动任务不代为付款。";
  if (task.code === "first_buddy")
    return "首次领养需要本人确认官方活动协议，可在成长中心完成后继续领奖。";
  if (task.code === "black_cat")
    return "夜间对话任务仅在北京时间 23:00–次日 08:00 执行。";
  if (!task.hasReward) return "该任务没有可领取的奖励。";
  if (
    (Object.hasOwn(kinds, task.code) ||
      ["chat_5", "Model_chat_GLM5.2"].includes(task.code)) &&
    (!Number.isSafeInteger(task.current) || !Number.isSafeInteger(task.target))
  )
    return "该任务已适配，正在等待官方返回可执行进度；接取及前置任务解锁后会继续回读，不会把未知进度当作已完成。";
  return "此任务暂无已验证的自动执行方式，请按成长中心指引在官方客户端完成。";
}

function domestic(document) {
  const origin = apiOrigin(document);
  if (!new URL(origin).hostname.endsWith(".cn"))
    throw new RewardError("活动任务目前仅支持国内版账号。", "input");
  if (!document.token)
    throw new RewardError("请先完成官方网页登录授权。", "credential");
  return origin;
}

async function activityRequest(
  document,
  endpoint,
  body,
  request,
  web = false,
  method = "POST",
) {
  const origin = domestic(document);
  const host =
    web || origin === "https://www.workbuddy.cn"
      ? "https://www.workbuddy.cn"
      : "https://copilot.tencent.com";
  let response;
  try {
    response = await request(host + endpoint, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: "Bearer " + document.token,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-User-Id": document.id,
        "X-Domain": new URL(host).hostname,
        "X-Product": "SaaS",
        "User-Agent": web
          ? browserAgent()
          : "WorkBuddy/" + activityProtocolVersion + " WorkBuddy-Switch",
        "X-Request-ID": randomUUID(),
        ...(web
          ? {
              "X-Client-Platform": "web",
              Origin: host,
              Referer: host + "/profile/growth-center",
            }
          : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new RewardError(
      "活动请求中断，结果尚未确认，请先刷新官方进度。",
      "transport",
    );
  }
  if ([401, 403].includes(response?.status))
    throw new RewardError("活动授权已失效，请重新网页登录。", "auth");
  if (!response?.ok)
    throw new RewardError(
      "活动服务不可用（HTTP " + (response?.status || "未知") + "）。",
      "service",
    );
  let result;
  try {
    if (typeof response.text === "function") {
      const raw = await response.text();
      if (raw.length > 4 * 1024 * 1024) throw Error("oversized response");
      result = JSON.parse(raw);
    } else result = await response.json();
  } catch {
    throw new RewardError("活动服务返回格式无效，结果尚未确认。", "format");
  }
  if ([401, 403, 12153, "401", "403", "12153"].includes(result?.code))
    throw new RewardError("活动授权已失效，请重新网页登录。", "auth");
  if (![0, 200, "0", "200"].includes(result?.code))
    throw new RewardError(
      "活动服务未确认此操作，请在成长中心核对状态。",
      "service",
    );
  return result.data;
}

export async function loadActivityResources(document, spec, request = fetch) {
  if (["expert", "team"].includes(spec.kind)) {
    const data = await activityRequest(
      document,
      "/portal/operation-platform/market/expert/list",
      {
        page: 1,
        page_size: 20,
        sort_by: "reco_rank",
        sort_order: "desc",
        ...(spec.keyword
          ? { keyword: spec.keyword }
          : { expert_type: spec.kind === "team" ? "team" : "agent" }),
      },
      request,
    );
    if (!Array.isArray(data?.experts))
      throw new RewardError("专家市场返回格式无效。", "format");
    const seen = new Set();
    const resources = data.experts.slice(0, 100).flatMap((raw) => {
      const id = raw?.expert_id,
        name = clean(raw?.display_name_zh || raw?.profession_zh),
        type = raw?.expert_type || "agent";
      if (
        !resourceId(id) ||
        !name ||
        seen.has(id) ||
        !["agent", "team"].includes(type) ||
        (spec.kind === "team" && type !== "team") ||
        (spec.kind === "expert" && type !== "agent") ||
        (spec.expertId && id !== spec.expertId) ||
        (spec.keyword &&
          !spec.expertId &&
          ![name, clean(raw.profession_zh)].some((value) =>
            normalize(value).includes(normalize(spec.keyword)),
          ))
      )
        return [];
      seen.add(id);
      return [
        {
          id,
          name,
          type,
          title: clean(raw.profession_zh),
          version: clean(raw.version, 40) || "1.0.0",
          categories: Array.isArray(raw.categories)
            ? raw.categories
                .filter((value) => typeof value === "string")
                .slice(0, 5)
                .map((value) => clean(value, 100))
            : [],
        },
      ];
    });
    if (!resources.length && spec.assignedByTask)
      return [
        {
          id: spec.expertId,
          name: spec.keyword,
          title: spec.keyword,
          type: "agent",
        },
      ];
    return resources;
  }
  if (spec.kind === "skill") {
    const data = await activityRequest(
        document,
        "/v2/user-asset/skill",
        null,
        request,
        false,
        "GET",
      ),
      rows = Array.isArray(data) ? data : data?.skills || data?.items;
    if (!Array.isArray(rows))
      throw new RewardError("已安装技能列表返回格式无效。", "format");
    return rows.slice(0, 100).flatMap((raw) => {
      const id = raw?.skill_id || raw?.id,
        name = clean(raw?.name || raw?.display_name);
      return resourceId(id) && name
        ? [
            {
              id,
              name,
              type: "skill",
              isOfficial: raw.is_official === true || raw.isOfficial === true,
              version: clean(raw.skill_version || raw.version, 40) || undefined,
              fileCount:
                Number.isSafeInteger(raw.file_count) &&
                raw.file_count >= 0 &&
                raw.file_count <= 100000
                  ? raw.file_count
                  : undefined,
            },
          ]
        : [];
    });
  }
  return [];
}

function browserAgent() {
  return process.versions.chrome
    ? "Mozilla/5.0 (" +
        process.platform +
        "; " +
        process.arch +
        ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
        process.versions.chrome +
        " WorkBuddy-Switch"
    : "WorkBuddy-Switch";
}

function fingerprint(document, web = false) {
  const now = Date.now(),
    common = {
      timestamp: now,
      presentAt: now,
      reportDelay: 0,
      userId: document.id,
      timezone: "Asia/Shanghai",
      os: process.platform,
      arch: process.arch,
      osVersion: os.release(),
      machineId: createHash("sha256")
        .update("workbuddy-switch:" + document.id)
        .digest("hex")
        .slice(0, 36),
    };
  if (web) return { ...common, userAgent: browserAgent() };
  return {
    ...common,
    product: "SaaS",
    ideName: "WorkBuddy",
    ideType: "WorkBuddy",
    ideVersion: activityProtocolVersion,
    extName: "workbuddy-desktop",
    extVersion: activityProtocolVersion,
    cpuModel: os.cpus()[0]?.model || "",
    cpuCores: os.cpus().length,
    memorySize: Math.round(os.totalmem() / 1024 ** 3),
  };
}

const event = (eventCode, fields = {}) => ({ eventCode, ...fields });
const templates = [
  ["00001", "TDesign"],
  ["00002", "Apple"],
  ["00003", "Meta"],
  ["00004", "Miro"],
  ["00005", "Notion"],
];

// These are compatibility activity records, not generated files, app permissions,
// or persistent schedules. The confirmation screen explicitly distinguishes them
// from real conversations. Only a subsequent official task read can establish completion.
function activityEvents(action, result = null) {
  const join = result
    ? { conversationId: result.conversationId, requestId: result.requestId }
    : {};
  switch (action.kind) {
    case "library":
      return [
        event("web_element_click", {
          pageURL: "https://www.workbuddy.cn/space/d/o0KWYeynteVv06UnAZqIFm",
          elementId: "library_doc_intro_click",
          elementName: "WorkBuddy资料库介绍",
        }),
      ];
    case "template": {
      const [id, name] = templates[action.index % templates.length];
      return [
        event("agent_task_created_with_template", {
          ...join,
          id,
          name,
          mode: "working",
          isCustomModel: false,
        }),
        event("template_used", {
          ...join,
          template_id: id,
          task_mode: "working",
        }),
      ];
    }
    case "playbook":
      return [
        event("web_element_click", {
          pageName: "playbook_detail",
          elementId: "playbook_ctaClick",
          source: "discover",
        }),
        event("playbook_cta_click", {
          id: "pm-gtm-launch-plan",
          name: "新产品上市 GTM 发布计划一页纸",
          source: "discover",
        }),
        event("playbook_prompt_send", {
          ...join,
          id: "pm-gtm-launch-plan",
          name: "新产品上市 GTM 发布计划一页纸",
          type: "document",
        }),
      ];
    case "canvas":
      return [
        event("wbx_design_canvas_task_create", {
          ...join,
          source: "summon_keyword",
          isSuccessful: true,
          id: "activity-" + result.requestId,
        }),
        event("wbx_design_canvas_open", {
          ...join,
          source: "summon_keyword",
          type: "page",
          isSuccessful: true,
          id: "activity-" + result.requestId,
        }),
      ];
    case "automation":
      return [
        event("automated_task_create_suc", {
          name: "活动任务体验",
          source: "manually",
          scheduleType: "once",
          modelId: "fast-model",
          modelIsThinking: true,
          connectorCount: 0,
          skills: "",
          skillCount: 0,
          mode: "LOCAL",
        }),
      ];
    case "appearance":
      return [
        event("appearance_skin_apply", {
          action: "apply",
          source: "settings_close",
          id: "theme-tkmw7j",
          type: "unknown",
        }),
      ];
    case "apps": {
      const fields = {
        mode: "LOCAL",
        buddyId: "cb_y5Dy46tPQGGWtueMxXbe",
        buddyName: "企鹅教师助手",
        elementId: "cb_y5Dy46tPQGGWtueMxXbe",
        elementName: "企鹅教师助手",
      };
      return [
        event("buddyapp_discover_click", fields),
        event("buddyapp_show", { ...fields, position: 2 }),
        event("buddyapp_enter_click", {
          ...fields,
          position: 2,
          isFirstPage: "1",
        }),
        event("buddyapp_auth_confirm_click", fields),
        event("buddyapp_bindaccount_skip_click", fields),
      ];
    }
    default:
      throw new RewardError("任务动作不在支持范围内。", "input");
  }
}

function expertSelection(resource) {
  const fields = {
    id: resource.id,
    name: resource.name,
    expertTitle: resource.title || resource.name,
    expertType: resource.type,
    version: resource.version || "1.0.0",
  };
  return [
    event("web_element_click", {
      source: resource.id,
      elementId: "expert_summon_click",
      elementName: "立即召唤",
      pageURL: "workbuddy-switch://app/index.html",
    }),
    event("expert_summon_click", {
      ...fields,
      type: "expert-all",
      mode: "LOCAL",
    }),
    event("expert_summoned", { ...fields, type: "expert-all" }),
  ];
}

function conversationEvents(result, action) {
  const common = {
    conversationId: result.conversationId,
    requestId: result.requestId,
    rootRequestId: result.requestId,
    parentConversationId: result.conversationId,
    traceId: result.requestId,
    requestModelId: result.model,
    requestModelName: result.model === "glm-5.2" ? "GLM-5.2" : "fast-model",
    mode: "craft",
    agentType: "main",
    agentName: "cli",
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
  };
  const usage = {
    isSuccessful: true,
    ...(result.inputTokens !== null ? { inputToken: result.inputTokens } : {}),
    ...(result.outputTokens !== null
      ? { outputToken: result.outputTokens }
      : {}),
    ...(result.inputTokens !== null && result.outputTokens !== null
      ? { totalToken: result.inputTokens + result.outputTokens }
      : {}),
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
  };
  const events = [
    event("agent_task_created", {
      ...common,
      source: "LOCAL",
      name: "working",
      task_target: "local",
      has_expert: ["expert", "team"].includes(action.kind),
      expert_id: ["expert", "team"].includes(action.kind)
        ? action.resource.id
        : "",
      expert_name: ["expert", "team"].includes(action.kind)
        ? action.resource.name
        : "",
      expert_industry_id: "",
      has_template: action.kind === "template",
      has_skill: action.kind === "skill",
    }),
    event("chat_message_send", {
      ...common,
      messageId: result.requestId + "-assistant",
    }),
    event("chat_request_send", { ...common, inputLength: result.inputLength }),
    event("chat_message_response", {
      ...common,
      ...usage,
      messageId: result.requestId + "-assistant",
    }),
    event("chat_message_status", {
      ...common,
      messageId: result.requestId + "-assistant",
      messageErrorCode: "0",
    }),
    event("chat_request_response", { ...common, ...usage }),
  ];
  if (["expert", "team"].includes(action.kind)) {
    const resource = action.resource,
      local = Object.hasOwn(expertNames, action.code);
    events.push(
      event("expert_actual_use", {
        ...common,
        id: resource.id,
        name: resource.name,
        expertTitle: resource.title || resource.name,
        expertType: resource.type,
        version: resource.version || "1.0.0",
        type: local ? "" : resource.categories?.[0] || "expert-all",
        source: "builtin",
        mode: local ? "LOCAL" : "craft",
        cost: local ? 0 : Math.max(0, Date.now() - result.startedAt),
        characterCount: result.inputLength,
      }),
    );
  }
  if (action.kind === "skill")
    events.push(
      event("skill_info", {
        ...common,
        id: action.resource.name,
        skillName: action.resource.name,
        skillId: action.resource.id,
        skillVersion: action.resource.version,
        toolStatus: "success",
        fileCount: action.resource.fileCount,
        source: "workbuddy-desktop",
        isOfficial: action.resource.isOfficial === true,
      }),
      event("skill_request_send", {
        ...common,
        skills: action.resource.id,
        skillNames: action.resource.name,
        isOfficial: action.resource.isOfficial === true,
      }),
    );
  if (["template", "playbook", "canvas"].includes(action.kind))
    events.push(...activityEvents(action, result));
  return events;
}

export async function executeActivity(
  document,
  action,
  request = fetch,
  controls = {},
) {
  domestic(document);
  const spec = activitySpec({
    code: action.code,
    status: "accepted",
    current: 0,
    target: 1,
    hasReward: true,
  });
  if (!spec || spec.kind !== action.kind)
    throw new RewardError("任务动作与已确认范围不一致。", "input");
  if (
    spec.requiresResource &&
    (!resourceId(action.resource?.id) ||
      !clean(action.resource?.name) ||
      (["expert", "team"].includes(action.kind) &&
        action.resource.type !== (action.kind === "team" ? "team" : "agent")))
  )
    throw new RewardError("专家或技能资源无效，请重新预览任务范围。", "input");
  if (
    action.index !== undefined &&
    (!Number.isSafeInteger(action.index) ||
      action.index < 0 ||
      action.index > 200)
  )
    throw new RewardError("任务次数不在支持范围内。", "input");
  const web = action.kind === "library",
    send = (events) =>
      activityRequest(
        document,
        "/v2/report",
        events.map((value) => ({ ...fingerprint(document, web), ...value })),
        request,
        web,
      ),
    pause = controls.pause || delay;
  const check = () => {
    if (controls.shouldStop?.())
      throw new RewardError(
        "已停止后续操作；已提交的请求请刷新官方状态确认。",
        "cancelled",
      );
  };
  check();
  if (action.kind === "appearance") {
    await activityRequest(
      document,
      "/v2/user-asset/appearance/set",
      { kind: "theme", resource_key: "theme-tkmw7j" },
      request,
    );
    check();
    await pause(2000);
    check();
  }
  if (!spec.paid) {
    await send(activityEvents({ ...action, index: action.index ?? 0 }));
    return {
      dialogue: null,
      detail:
        action.kind === "appearance"
          ? "已提交官方主题设置与活动记录，等待官方计分。"
          : "兼容活动记录已提交，等待官方进度确认。",
    };
  }
  if (["expert", "team"].includes(action.kind)) {
    await send(expertSelection(action.resource));
    check();
    await pause(6000);
    check();
  }
  const dialogue = await sendDialogue(
    document,
    {
      model: action.model || "fast-model",
      prompt: action.prompt,
      ...(["expert", "team"].includes(action.kind)
        ? { expertId: action.resource.id }
        : {}),
    },
    request,
  );
  try {
    await reportDialogue(
      document,
      dialogue,
      request,
      async (_document, verified) =>
        send(
          conversationEvents(verified, { ...action, index: action.index ?? 0 }),
        ),
    );
  } catch {
    throw new RewardError(
      "真实对话已完成，但活动回执失败，已停止继续对话；请先刷新官方进度。",
      "receipt",
    );
  }
  return {
    dialogue,
    detail: dialogue.hasAnswer
      ? "已收到真实对话回复并提交活动回执，消耗以官方计费为准。"
      : "模型已返回推理内容并结束响应，已提交活动回执，消耗以官方计费为准。",
  };
}
