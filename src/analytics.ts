import type { Account, ApiStatus, RewardEntry, Settings } from "./types";

export interface SeriesPoint {
  label: string;
  value: number | null;
  count: number;
  unknown: number;
}
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const validAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Calendar buckets use Beijing dates, matching the official reward day. */
export function dailySeries(
  records: { at: number; value: number | null }[],
  days = 7,
  now = Date.now(),
): SeriesPoint[] {
  const today = dayFormatter.format(now);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  const points = Array.from(
    { length: Math.max(1, Math.min(90, days)) },
    (_, i) => ({
      label: dayFormatter.format(
        midnight - (Math.max(1, Math.min(90, days)) - 1 - i) * 86400000,
      ),
      value: 0 as number | null,
      count: 0,
      unknown: 0,
    }),
  );
  const index = new Map(points.map((point) => [point.label, point]));
  for (const record of records) {
    if (!Number.isFinite(record.at) || record.at > now) continue;
    const point = index.get(dayFormatter.format(record.at));
    if (!point) continue;
    point.count++;
    if (validAmount(record.value))
      point.value = (point.value ?? 0) + record.value;
    else point.unknown++;
  }
  for (const point of points) {
    if (point.count && point.count === point.unknown) point.value = null;
  }
  return points;
}

export function creditSummary(
  accounts: Account[],
  settings: Settings,
  now = Date.now(),
) {
  let remaining = 0,
    used = 0,
    total = 0,
    known = 0,
    expiring = 0,
    attention = 0;
  for (const account of accounts) {
    const quota = account.quota;
    const valid =
      !account.quotaError &&
      quota &&
      [quota.remaining, quota.used, quota.total].every(validAmount);
    let soon = 0;
    if (valid) {
      known++;
      remaining += quota.remaining;
      used += quota.used;
      total += quota.total;
      soon = quota.resources
        .filter(
          (resource) =>
            !resource.expired &&
            validAmount(resource.remaining) &&
            resource.expiresAt !== null &&
            resource.expiresAt > now &&
            resource.expiresAt <= now + settings.expiryWarningDays * 86400000,
        )
        .reduce((sum, resource) => sum + resource.remaining, 0);
      expiring += soon;
    }
    if (
      !valid ||
      soon > 0 ||
      (quota && quota.remaining <= settings.lowBalanceThreshold) ||
      (account.tokenExpiresAt && account.tokenExpiresAt <= now) ||
      account.rewards?.checkinError ||
      account.rewards?.travelError
    )
      attention++;
  }
  return {
    remaining,
    used,
    total,
    known,
    unknown: accounts.length - known,
    expiring,
    attention,
  };
}

export function rewardSeries(
  history: RewardEntry[],
  accountId = "",
  days = 7,
  now = Date.now(),
) {
  return dailySeries(
    history
      .filter(
        (entry) =>
          entry.result === "claimed" &&
          (!accountId || entry.accountId === accountId),
      )
      .map((entry) => ({ at: entry.at, value: entry.credit })),
    days,
    now,
  );
}

export function apiAnalytics(
  recent: ApiStatus["recent"],
  days = 7,
  now = Date.now(),
) {
  const startDay = dailySeries([], days, now)[0].label;
  const since = Date.parse(`${startDay}T00:00:00+08:00`);
  const seen = new Set<string>();
  const rows = recent.filter((entry) => {
    if (
      seen.has(entry.requestId) ||
      !Number.isFinite(entry.at) ||
      entry.at < since ||
      entry.at > now
    )
      return false;
    seen.add(entry.requestId);
    return true;
  });
  const amount = (entry: ApiStatus["recent"][number]) =>
    validAmount(entry.inputTokens) && validAmount(entry.outputTokens)
      ? entry.inputTokens + entry.outputTokens
      : null;
  const durations = rows
    .map((entry) => entry.durationMs)
    .filter(validAmount)
    .sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const p50 = !durations.length
    ? null
    : durations.length % 2
      ? durations[middle]
      : (durations[middle - 1] + durations[middle]) / 2;
  const models = new Map<
    string,
    { label: string; value: number; tokens: number; unknown: number }
  >();
  for (const entry of rows) {
    const model = models.get(entry.model) ?? {
      label: entry.model,
      value: 0,
      tokens: 0,
      unknown: 0,
    };
    model.value++;
    const value = amount(entry);
    if (value === null) model.unknown++;
    else model.tokens += value;
    models.set(entry.model, model);
  }
  return {
    requests: rows.length,
    successRate: rows.length
      ? Math.round(
          (rows.filter((entry) => entry.status === "ok").length / rows.length) *
            100,
        )
      : null,
    tokens: rows.reduce((sum, entry) => sum + (amount(entry) ?? 0), 0),
    unknown: rows.filter((entry) => amount(entry) === null).length,
    p50,
    p95: durations.length
      ? durations[Math.ceil(durations.length * 0.95) - 1]
      : null,
    requestSeries: dailySeries(
      rows.map((entry) => ({ at: entry.at, value: 1 })),
      days,
      now,
    ),
    tokenSeries: dailySeries(
      rows.map((entry) => ({ at: entry.at, value: amount(entry) })),
      days,
      now,
    ),
    models: [...models.values()].sort((a, b) => b.value - a.value),
  };
}
