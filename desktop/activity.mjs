import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { apiOrigin } from "./quota.mjs";
import { RewardError } from "./rewards.mjs";
import { sendDialogue, reportDialogue } from "./dialogue.mjs";

const desktopOrigin = "https://copilot.tencent.com";
const activityProtocolVersion = "5.8.3";
const expertNames = {
  Expert_lighthouse: "腾讯轻量云",
  WorkBuddy_Valorant: "无畏契约拼豆专家",
  expert_use_maidehao: "中国电商运营专家",
  expert_use_douyinyin: "抖音策略师",
  expert_use_shangjia_xuanchuan: "商家宣传页与海报设计师",
  expert_use_bowangwang: "直播电商教练",
};
const kinds = {
  RichMeow_Chat: ["desktop-chat", "桌面对话", true],
  expert_5: ["expert", "召唤专家", true],
  Expert_team_use_3: ["team", "召唤专家团", true],
  skill_1: ["skill", "技能体验", true],
  template_5: ["template", "模板活动记录", false],
  playbook_prompt: ["playbook", "灵感活动记录", false],
  Library_read: ["library", "资料库活动记录", false],
  Hp_Appearance: ["appearance", "主题活动记录", false],
  create_canvas: ["canvas", "设计画布活动记录", false],
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
  return {
    kind: entry[0],
    label: entry[1],
    paid: entry[2],
    remaining: Math.min(40, task.target - task.current),
    model: entry[2] ? "fast-model" : null,
    modelName: entry[2] ? "快速模式" : "兼容活动上报",
    ...(expertNames[task.code] ? { keyword: expertNames[task.code] } : {}),
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
  const origin = domestic(document),
    host = web ? origin : desktopOrigin;
  let response;
  try {
    response = await request(host + endpoint, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${document.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-User-Id": document.id,
        "X-Domain": new URL(host).hostname,
        "X-Product": "SaaS",
        "X-Client-Platform": web ? "web" : "desktop",
        "User-Agent": web
          ? "WorkBuddy-Switch"
          : `WorkBuddy/${activityProtocolVersion} WorkBuddy-Switch`,
        "X-Request-ID": randomUUID(),
        Origin: origin,
        Referer: `${origin}/profile/growth-center`,
      },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new RewardError(
      "活动请求中断，结果尚未确认，请先刷新官方进度。",
      "transport",
    );
  }
  if ([401, 403].includes(response.status))
    throw new RewardError("活动授权已失效，请重新网页登录。", "auth");
  if (!response.ok)
    throw new RewardError(
      `活动服务不可用（HTTP ${response.status}）。`,
      "service",
    );
  let result;
  try {
    if (typeof response.text === "function") {
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error("response too large");
      result = JSON.parse(text);
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
    return data.experts.slice(0, 100).flatMap((raw) => {
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
        (spec.keyword &&
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
        },
      ];
    });
  }
  if (spec.kind === "skill") {
    const data = await activityRequest(
      document,
      "/v2/user-asset/skill",
      null,
      request,
      false,
      "GET",
    );
    const rows = Array.isArray(data) ? data : data?.skills;
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
            },
          ]
        : [];
    });
  }
  return [];
}

function fingerprint(document) {
  const now = Date.now();
  return {
    timestamp: now,
    presentAt: now,
    reportDelay: 0,
    userId: document.id,
    product: "SaaS",
    ideName: "WorkBuddy",
    ideType: "WorkBuddy",
    ideVersion: activityProtocolVersion,
    extName: "workbuddy-desktop",
    extVersion: activityProtocolVersion,
    timezone: "Asia/Shanghai",
    os: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    cpuModel: os.cpus()[0]?.model || "",
    cpuCores: os.cpus().length,
    memorySize: Math.round(os.totalmem() / 1024 ** 3),
    machineId: createHash("sha256")
      .update(`workbuddy-switch:${document.id}`)
      .digest("hex")
      .slice(0, 36),
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
function activityEvents(action) {
  switch (action.kind) {
    case "library":
      return [
        event("library_doc_intro_click", {
          pageURL: "https://www.workbuddy.cn/library",
          elementId: "library_doc_intro",
          elementName: "资料库介绍",
        }),
      ];
    case "template": {
      const [templateId, name] = templates[action.index % templates.length];
      return [
        event("agent_task_created_with_template", {
          id: templateId,
          name,
          mode: "working",
          isCustomModel: false,
        }),
        event("template_used", {
          template_id: templateId,
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
          id: "pm-gtm-launch-plan",
          name: "新产品上市 GTM 发布计划一页纸",
          type: "document",
        }),
      ];
    case "canvas":
      return [
        event("wbx_design_canvas_task_create", {
          source: "summon_keyword",
          isSuccessful: true,
        }),
        event("wbx_design_canvas_open", {
          source: "summon_keyword",
          type: "page",
          isSuccessful: true,
        }),
      ];
    case "automation":
      return [
        event("automated_task_create_suc", {
          name: "活动任务体验",
          source: "manually",
          scheduleType: "once",
          modelId: "fast-model",
          mode: "LOCAL",
        }),
      ];
    case "appearance":
      return [
        event("appearance_skin_apply", {
          kind: "theme",
          resource_key: "theme-tkmw7j",
          resourceKey: "theme-tkmw7j",
          skinId: "theme-tkmw7j",
          source: "settings",
        }),
      ];
    case "apps":
      return [
        event("buddyapp_discover_click", { mode: "LOCAL" }),
        event("buddyapp_show", {
          buddyId: "cb_y5Dy46tPQGGWtueMxXbe",
          buddyName: "企鹅教师助手",
          elementId: "cb_y5Dy46tPQGGWtueMxXbe",
        }),
        event("buddyapp_enter_click", {
          buddyId: "cb_y5Dy46tPQGGWtueMxXbe",
          buddyName: "企鹅教师助手",
          elementId: "cb_y5Dy46tPQGGWtueMxXbe",
          isFirstPage: "1",
        }),
      ];
    default:
      throw new RewardError("任务动作不在支持范围内。", "input");
  }
}

function conversationEvents(result, action) {
  const common = {
    conversationId: result.conversationId,
    requestId: result.requestId,
    rootRequestId: result.requestId,
    requestModelId: result.model,
    requestModelName: result.model === "glm-5.2" ? "GLM-5.2" : "快速模式",
    mode: "craft",
    agentType: "conversation",
    agentName: "workbuddy-switch",
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
  };
  const usage = {
    inputToken: result.inputTokens,
    outputToken: result.outputTokens,
    isSuccessful: true,
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
  };
  const events = [
    event("agent_task_created", {
      ...common,
      source: "LOCAL",
      task_target: "local",
      has_expert: !!action.resource,
      expert_id: action.resource?.id || "",
    }),
    event("chat_message_send", common),
    event("chat_request_send", { ...common, inputLength: result.inputLength }),
  ];
  if (action.kind === "desktop-chat")
    events.push(
      event("chat_message_response", { ...common, ...usage }),
      event("chat_message_status", { ...common, messageErrorCode: "0" }),
      event("chat_request_response", { ...common, ...usage }),
    );
  if (["expert", "team"].includes(action.kind)) {
    const resource = action.resource,
      fields = {
        id: resource.id,
        name: resource.name,
        expertTitle: resource.title || "",
        expertType: resource.type,
        version: resource.version || "1.0.0",
      };
    events.push(
      event("expert_summon_click", fields),
      event("expert_summoned", fields),
      event("expert_actual_use", {
        ...common,
        ...fields,
        type: "expert-all",
        source: "builtin",
        mode: action.code === "Expert_lighthouse" ? "LOCAL" : "craft",
        characterCount: result.inputLength,
      }),
    );
  }
  if (action.kind === "skill")
    events.push(
      event("skill_info", {
        ...common,
        skillName: action.resource.name,
        skillId: action.resource.id,
        isOfficial: action.resource.isOfficial === true,
      }),
      event("skill_request_send", {
        ...common,
        skills: action.resource.id,
        skillNames: action.resource.name,
        isOfficial: action.resource.isOfficial === true,
      }),
    );
  return events;
}

export async function executeActivity(document, action, request = fetch) {
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
  if (spec.paid && action.kind !== "desktop-chat") {
    if (
      !resourceId(action.resource?.id) ||
      !clean(action.resource?.name) ||
      (["expert", "team"].includes(action.kind) &&
        action.resource.type !== (action.kind === "team" ? "team" : "agent"))
    )
      throw new RewardError(
        "专家或技能资源无效，请重新预览任务范围。",
        "input",
      );
  }
  if (
    action.index !== undefined &&
    (!Number.isSafeInteger(action.index) ||
      action.index < 0 ||
      action.index > 200)
  )
    throw new RewardError("任务次数不在支持范围内。", "input");
  const send = async (events) =>
    activityRequest(
      document,
      "/v2/report",
      events.map((value) => ({ ...fingerprint(document), ...value })),
      request,
      action.kind === "library",
    );
  if (!spec.paid) {
    await send(activityEvents({ ...action, index: action.index ?? 0 }));
    return { dialogue: null, detail: "兼容活动记录已提交，等待官方进度确认。" };
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
      async (_document, verified) => send(conversationEvents(verified, action)),
    );
  } catch {
    throw new RewardError(
      "真实对话已完成，但活动回执失败，已停止继续对话；请先刷新官方进度。",
      "receipt",
    );
  }
  return {
    dialogue,
    detail: dialogue.hasAnswer ? "已收到真实对话回复并提交活动回执，消耗以官方计费为准。" : "模型已返回推理内容并结束响应，已提交活动回执，消耗以官方计费为准。",
  };
}
