import { requestReward, RewardError } from "./rewards.mjs";
const codePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const clean = (value, limit) =>
  typeof value === "string"
    ? value.replace(/[\x00-\x1f]/g, " ").slice(0, limit)
    : "";
const amount = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
function taskExpertId(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}
  return decoded.match(/\bex_[A-Za-z0-9]{6,120}\b/)?.[0] || null;
}
export function requireTaskCode(value) {
  if (
    typeof value !== "string" ||
    !codePattern.test(value) ||
    value.includes("..")
  )
    throw new RewardError("成长任务标识无效。", "input");
  return value;
}
export function parseGrowthTasks(data) {
  if (!Array.isArray(data?.tasks))
    throw new RewardError("成长任务列表返回了未知格式。", "format");
  const seen = new Set();
  return data.tasks.slice(0, 200).flatMap((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.task_code !== "string" ||
      !codePattern.test(raw.task_code) ||
      raw.task_code.includes("..") ||
      seen.has(raw.task_code)
    )
      return [];
    seen.add(raw.task_code);
    const status = [
      "not_accepted",
      "accepted",
      "in_progress",
      "completed",
      "claimed",
    ].includes(raw.accept_status)
      ? raw.accept_status
      : "unknown";
    const claimed = raw.claimed === true || status === "claimed",
      locked = raw.locked === true || raw.is_locked === true;
    return [
      {
        code: raw.task_code,
        ...(taskExpertId(raw.jump_url)
          ? { expertId: taskExpertId(raw.jump_url) }
          : {}),
        title: clean(raw.title, 120) || raw.task_code,
        description: clean(raw.task_desc || raw.description, 500),
        status,
        claimed,
        locked,
        claimable:
          !claimed &&
          !locked &&
          (raw.claimable === true ||
            (raw.claimable !== false && status === "completed")),
        current: amount(raw.progress?.current),
        target: amount(raw.progress?.target),
        rewardCredit: amount(raw.reward_credit),
        rewardEnergy: amount(raw.reward_energy),
        hasReward: raw.has_reward !== false,
      },
    ];
  });
}
export async function getGrowthTasks(document, request = fetch) {
  const { data } = await requestReward(
    document,
    "/v2/activity/growth/tasks",
    "GET",
    null,
    request,
  );
  return parseGrowthTasks(data);
}
export async function acceptGrowthTasks(document, codes, request = fetch) {
  if (!Array.isArray(codes) || !codes.length || codes.length > 200)
    throw new RewardError("成长任务选择无效。", "input");
  const selected = [...new Set(codes.map(requireTaskCode))];
  await requestReward(
    document,
    "/activity/growth/tasks/accept",
    "POST",
    { task_codes: selected },
    request,
  );
}
export async function claimGrowthTask(document, code, request = fetch) {
  requireTaskCode(code);
  const { data } = await requestReward(
    document,
    `/activity/growth/tasks/${encodeURIComponent(code)}/claim`,
    "POST",
    {},
    request,
  );
  const already = data?.already_claimed === true;
  return {
    already,
    credit: already ? null : amount(data?.credit ?? data?.reward_credit),
    energy: already ? null : amount(data?.energy ?? data?.reward_energy),
  };
}
