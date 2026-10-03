import { parseAuth } from "./auth.mjs";
const num = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Math.max(0, Number(value))
    : null;
const first = (record, keys) =>
  keys.map((key) => num(record?.[key])).find((value) => value !== null) ?? null;
const day = 86400000;

export function timestamp(value) {
  if (
    typeof value === "number" ||
    (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))
  ) {
    const n = Number(value);
    return n > 0 ? (n < 1e11 ? n * 1000 : n) : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseQuota(response, now = Date.now()) {
  const containers = [
    response?.data?.Response?.Data,
    response?.data?.data?.Response?.Data,
    response?.data?.data,
    response?.data,
    response?.Response?.Data,
  ];
  const container = containers.find(
    (value) => Array.isArray(value?.Accounts) || Array.isArray(value?.Packages),
  );
  if (!container) throw new Error("积分服务返回了未知的数据格式。");
  const rows = container.Accounts ?? container.Packages;
  const resources = rows.map((row, index) => {
    const slice = row.SlicePeriodUsageDetails?.[0];
    const totalKeys = [
      "CycleCapacitySizePrecise",
      "CycleCapacitySize",
      "CycleTotalCapacity",
      "CapacitySizePrecise",
      "CapacitySize",
      "SlicePeriodCapacitySizePrecise",
    ];
    const remainKeys = [
      "CycleCapacityRemainPrecise",
      "CycleCapacityRemain",
      "CycleRemainCapacity",
      "CapacityRemainPrecise",
      "CapacityRemain",
      "SlicePeriodCapacityRemainPrecise",
    ];
    const usedKeys = [
      "CycleCapacityUsedPrecise",
      "CycleCapacityUsed",
      "CycleUsedCapacity",
      "CapacityUsedPrecise",
      "CapacityUsed",
    ];
    const remainingValue = first(row, remainKeys) ?? first(slice, remainKeys);
    const usedValue = first(row, usedKeys) ?? first(slice, usedKeys);
    const total =
      first(row, totalKeys) ??
      first(slice, totalKeys) ??
      (remainingValue ?? 0) + (usedValue ?? 0);
    const remaining = remainingValue ?? Math.max(0, total - (usedValue ?? 0));
    const cycleEnd = timestamp(row.CycleEndTime),
      deductionEnd = timestamp(row.DeductionEndTime ?? row.ExpiredTime);
    let expiresAt = deductionEnd ?? cycleEnd;
    if (deductionEnd && cycleEnd && deductionEnd - cycleEnd > 365 * day)
      expiresAt = cycleEnd;
    if (expiresAt && expiresAt - now > 730 * day) expiresAt = null;
    return {
      id: String(row.ResourceId ?? row.PackageCode ?? index),
      name: String(row.PackageName ?? "WorkBuddy 积分包").slice(0, 120),
      total,
      remaining,
      used: usedValue ?? Math.max(0, total - remaining),
      expiresAt,
      expired: expiresAt !== null && expiresAt <= now,
      cycleStartsAt: timestamp(row.CycleStartTime),
    };
  });
  const active = resources.filter((r) => !r.expired);
  return {
    total: active.reduce((n, r) => n + r.total, 0),
    remaining: active.reduce((n, r) => n + r.remaining, 0),
    used: active.reduce((n, r) => n + r.used, 0),
    resources,
    fetchedAt: now,
    expiresAt: active
      .filter((r) => r.remaining > 0 && r.expiresAt)
      .reduce(
        (min, r) => (min === null ? r.expiresAt : Math.min(min, r.expiresAt)),
        null,
      ),
  };
}

export function apiOrigin(document) {
  const domain =
    document.root.auth.domain ??
    document.root.account.domain ??
    document.root.domain;
  return ["workbuddy.cn", "www.workbuddy.cn"].includes(domain)
    ? "https://www.workbuddy.cn"
    : "https://www.codebuddy.cn";
}

export async function fetchQuota(document, request = fetch) {
  if (!document.token)
    throw new Error(
      "此登录凭据由 WorkBuddy 客户端加密。请通过「网页登录添加」重新授权后查询积分。",
    );
  const origin = apiOrigin(document);
  const options = (body) => ({
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${document.token}`,
      "Content-Type": "application/json",
      "X-Client-Platform": "web",
      "X-Domain": new URL(origin).hostname,
      Origin: origin,
      Referer: `${origin}/profile/plans-usage`,
      "User-Agent": "WorkBuddy",
    },
    body: JSON.stringify(body),
  });
  const query = async (endpoint, body) => {
    let response;
    try {
      response = await request(`${origin}${endpoint}`, options(body));
    } catch {
      throw new Error("无法连接积分服务，请检查网络或系统代理。");
    }
    if ([401, 403].includes(response.status))
      throw new Error("登录凭据已失效，请在 WorkBuddy 重新登录并保存。");
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`积分服务暂不可用（HTTP ${response.status}）。`);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("积分服务返回了无法解析的数据。");
    }
    const code = data.code ?? data.data?.code;
    if (code !== undefined && ![0, 200, "0", "200"].includes(code)) {
      if ([401, 403, 12153, "401", "403", "12153"].includes(code))
        throw new Error("登录凭据已失效，请在 WorkBuddy 重新登录并保存。");
      throw new Error(`积分服务拒绝请求（${String(code).slice(0, 12)}）。`);
    }
    return parseQuota(data);
  };
  // Older clients expose Accounts, newer clients expose Packages. A missing
  // route is the only transport condition under which we try the old endpoint.
  const summary = await query("/billing/meter/get-user-resource-summary", {
    ProductCode: "p_tcaca",
  });
  if (summary !== null) return summary;
  const legacy = await query("/v2/billing/meter/get-user-resource", {
    ProductCode: "p_tcaca",
    PageNumber: 1,
    PageSize: 100,
    Status: [0, 3],
  });
  if (legacy === null)
    throw new Error("当前 WorkBuddy 版本的积分接口暂不支持。");
  return legacy;
}

export async function renewAuth(document, request = fetch) {
  const refreshToken = document.root.auth.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken)
    throw new Error("登录授权已过期，请通过网页登录重新授权。");
  let response;
  try {
    response = await request(
      `${apiOrigin(document)}/v2/plugin/auth/token/refresh`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${document.token}`,
          "X-Refresh-Token": refreshToken,
          "X-Auth-Refresh-Source": "plugin",
          "X-Domain": new URL(apiOrigin(document)).hostname,
        },
      },
    );
  } catch {
    throw new Error("登录续期服务无法连接，请检查网络。");
  }
  if (!response.ok) throw new Error("登录续期失败，请通过网页登录重新授权。");
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("登录续期服务返回了未知格式。");
  }
  const token = data.data?.accessToken ?? data.data?.access_token;
  if (
    ![0, 200, "0", "200"].includes(data.code) ||
    typeof token !== "string" ||
    !token
  )
    throw new Error("登录续期失败，请通过网页登录重新授权。");
  const auth = {
    ...document.root.auth,
    ...data.data,
    accessToken: token,
    refreshToken:
      data.data.refreshToken ?? data.data.refresh_token ?? refreshToken,
    expiresAt:
      data.data.expiresAt ??
      (data.data.expiresIn
        ? Date.now() + Number(data.data.expiresIn) * 1000
        : null),
  };
  return parseAuth(JSON.stringify({ ...document.root, auth }));
}
