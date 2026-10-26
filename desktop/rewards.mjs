import { workBuddyOrigin, timestamp } from "./quota.mjs";

const prefix = "/activity/growth/buddy/travel";
const success = (code) => [0, 200, "0", "200"].includes(code);
const id = (value) =>
  (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
  (typeof value === "string" && /^[\w-]{1,80}$/.test(value));
export const rewardDay = (now = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

export class RewardError extends Error {
  constructor(message, kind = "service") {
    super(message);
    this.kind = kind;
  }
}

const amount = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
const rewardCredit = (data) => {
  // Only explicit reward fields count. Do not derive rewards from balance,
  // token usage, a published maximum, or a cached trip estimate.
  for (const key of [
    "reward_credit",
    "rewardCredit",
    "reward_credits",
    "credit",
  ])
    if (amount(data?.[key]) !== null) return amount(data[key]);
  return null;
};
const message = (body, document) => {
  let text =
    typeof (body?.message ?? body?.msg) === "string"
      ? (body.message ?? body.msg)
      : "";
  for (const secret of [document.token, document.root.auth.refreshToken])
    if (typeof secret === "string" && secret)
      text = text.replaceAll(secret, "[已隐藏]");
  return text.replace(/[\x00-\x1f]/g, " ").slice(0, 180);
};

export async function requestReward(document, endpoint, method, body, request) {
  if (!document.token)
    throw new RewardError(
      "此账号使用本机加密凭据，请点击「添加账号」完成官方网页登录授权后领取积分。",
      "credential",
    );
  const domain =
    document.root.auth.domain ??
    document.root.account.domain ??
    document.root.domain;
  if (
    typeof domain === "string" &&
    /(^|\.)(workbuddy|codebuddy)\.(ai|com)$/i.test(domain)
  )
    throw new RewardError(
      "签到和旅行活动目前仅支持国内版 WorkBuddy 账号。",
      "missing",
    );
  const origin = workBuddyOrigin(document);
  const headers = {
    Authorization: `Bearer ${document.token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-User-Id": document.id,
    "X-Domain": new URL(origin).hostname,
    "X-Client-Platform": "web",
    Origin: origin,
    Referer: `${origin}/profile/growth-center`,
  };
  const tenant =
    document.root.account.enterpriseId ?? document.root.account.enterprise_id;
  if (
    (typeof tenant === "string" || typeof tenant === "number") &&
    /^[\w-]{1,200}$/.test(String(tenant))
  ) {
    headers["X-Enterprise-Id"] = String(tenant);
    headers["X-Tenant-Id"] = String(tenant);
  }
  let response;
  try {
    response = await request(`${origin}${endpoint}`, {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    throw new RewardError(
      method === "POST" && !endpoint.includes("status")
        ? "请求中断，领取或出发结果尚未确认。请刷新官方状态后再操作。"
        : "无法连接积分活动服务，请检查网络或系统代理。",
      "transport",
    );
  }
  if ([401, 403].includes(response.status))
    throw new RewardError("登录授权已失效，请通过网页登录重新授权。", "auth");
  if (response.status === 404)
    throw new RewardError("当前账号的活动接口暂不支持。", "missing");
  if (!response.ok)
    throw new RewardError(`活动服务暂不可用（HTTP ${response.status}）。`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new RewardError(
      "活动服务返回了无法解析的数据，操作结果尚未确认。",
      "format",
    );
  }
  if (success(result?.code)) return { data: result.data, already: false };
  if ([401, 403, 12153, "401", "403", "12153"].includes(result?.code))
    throw new RewardError("登录授权已失效，请通过网页登录重新授权。", "auth");
  const detail = message(result, document);
  if (
    endpoint.endsWith("/daily-checkin") &&
    /已签到|already\s+(checked|signed)|repeat/i.test(detail)
  )
    return { data: null, already: true };
  throw new RewardError(
    detail || "活动服务返回了未知的结果，请刷新后重试。",
    success(result?.code) ? "format" : "service",
  );
}

export async function getCheckinStatus(document, request = fetch) {
  let result;
  try {
    result = await requestReward(
      document,
      "/v2/billing/meter/checkin-activity-status",
      "POST",
      {},
      request,
    );
  } catch (error) {
    if (error.kind !== "missing") throw error;
    result = await requestReward(
      document,
      "/v2/billing/meter/checkin-status",
      "POST",
      {},
      request,
    );
  }
  const checkedIn =
    result.data?.today_checked_in ?? result.data?.todayCheckedIn;
  if (result.data?.enabled === false || result.data?.active === false)
    throw new RewardError("当前账号的签到活动尚未开放。", "inactive");
  if (typeof checkedIn !== "boolean")
    throw new RewardError("签到状态返回了未知格式。", "format");
  const now = Date.now();
  return { checkedIn, day: rewardDay(now), fetchedAt: now };
}

export async function checkIn(document, request = fetch) {
  const result = await requestReward(
    document,
    "/v2/billing/meter/daily-checkin",
    "POST",
    {},
    request,
  );
  return {
    already: result.already,
    credit: result.already ? null : rewardCredit(result.data),
  };
}

export async function getTravelConfig(document, request = fetch) {
  const { data } = await requestReward(
    document,
    `${prefix}/config`,
    "GET",
    null,
    request,
  );
  if (data?.enabled === false) return { enabled: false, locations: [] };
  if (!Array.isArray(data?.locations))
    throw new RewardError("旅行地点返回了未知格式。", "format");
  const locations = data.locations
    .filter((location) => id(location?.id) && typeof location.name === "string")
    .slice(0, 200)
    .map((location) => ({ id: location.id, name: location.name.slice(0, 80) }));
  return { enabled: locations.length > 0, locations };
}

export async function getTravelStatus(document, request = fetch) {
  const { data } = await requestReward(
    document,
    `${prefix}/status`,
    "GET",
    null,
    request,
  );
  if (!data || !["idle", "traveling", "arrived"].includes(data.state))
    throw new RewardError(
      "旅行服务返回了未知状态，请到官方成长中心查看。",
      "format",
    );
  return {
    state: data.state,
    locationId: id(data.location?.id) ? data.location.id : null,
    locationName:
      typeof data.location?.name === "string"
        ? data.location.name.slice(0, 80)
        : "",
    departAt: timestamp(data.depart_at),
    arriveAt: timestamp(data.arrive_at),
    serverNow: timestamp(data.server_now),
    dailyLimitReached: data.daily_limit_reached === true,
    recordId:
      Number.isSafeInteger(Number(data.record_id)) && Number(data.record_id) > 0
        ? Number(data.record_id)
        : null,
    rewardCredit: rewardCredit(data),
    fetchedAt: Date.now(),
  };
}

export async function departTravel(document, locationId, request = fetch) {
  if (!id(locationId))
    throw new RewardError("请选择官方提供的有效旅行地点。", "input");
  await requestReward(
    document,
    `${prefix}/depart`,
    "POST",
    { location_id: locationId },
    request,
  );
  return { departed: true };
}

export async function claimTravel(document, request = fetch) {
  // The official growth center claims the authenticated account's current trip
  // with an empty body. Store verifies a fresh "arrived" status before calling.
  const { data } = await requestReward(
    document,
    `${prefix}/claim`,
    "POST",
    {},
    request,
  );
  return { credit: rewardCredit(data) };
}
