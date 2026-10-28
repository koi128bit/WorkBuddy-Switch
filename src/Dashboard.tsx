import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Cable,
  CalendarCheck,
  ClipboardCheck,
  Coins,
  Gift,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import {
  Button,
  date,
  Metric,
  number,
  SectionHeader,
  shortNumber,
} from "./components";
import { BalanceBars, chartColors, RingChart, TrendChart } from "./Charts";
import { creditSummary, rewardSeries } from "./analytics";
import { apiFor } from "./providers";
import { chinaDay } from "./Rewards";
import type { ApiStatus, Snapshot, Usage } from "./types";

export function Dashboard({
  state,
  disabled,
  navigate,
  runTasks,
}: {
  state: Snapshot;
  disabled: boolean;
  navigate: (page: "accounts" | "overview" | "usage" | "api") => void;
  runTasks: (ids: string[]) => void;
}) {
  const provider = state.settings.activeProvider;
  const [usage, setUsage] = useState<Usage | null>(null);
  const [gateway, setGateway] = useState<ApiStatus | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    let alive = true,
      version = 0;
    const api = apiFor(provider);
    const refresh = async () => {
      const request = ++version;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const results = await Promise.allSettled([
        api.usage({
          accountId: null,
          since: today.getTime() - 6 * 86400000,
          until: today.getTime() + 86400000,
        }),
        window.workbuddy.apiStatus(),
      ]);
      if (!alive || request !== version) return;
      const notes: string[] = [];
      if (results[0].status === "fulfilled") setUsage(results[0].value);
      else {
        setUsage(null);
        notes.push("本地用量暂不可用");
      }
      if (results[1].status === "fulfilled") setGateway(results[1].value);
      else {
        setGateway(null);
        notes.push("API 状态暂不可用");
      }
      setErrors(notes);
    };
    void refresh();
    const stop = api.onChange(() => void refresh());
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      alive = false;
      stop();
      clearInterval(timer);
    };
  }, [provider]);
  const credit = creditSummary(state.accounts, state.settings);
  const rewards = provider === "workbuddy";
  const claimed = rewardSeries(state.rewardHistory || []);
  const earned = claimed.reduce((sum, point) => sum + (point.value ?? 0), 0);
  const unknown = claimed.reduce((sum, point) => sum + point.unknown, 0);
  const checkins = state.accounts.filter(
    (account) =>
      !account.rewards?.checkinError &&
      account.rewards?.checkin?.day === chinaDay() &&
      account.rewards.checkin.checkedIn,
  ).length;
  const waiting = state.accounts.filter(
    (account) =>
      !account.rewards?.travelError &&
      account.rewards?.travel?.state === "arrived",
  ).length;
  const activity = [
    ...state.events.map((entry) => ({
      id: entry.id,
      at: entry.at,
      title: entry.message,
      detail: "应用事件",
      ok: entry.level !== "error",
    })),
    ...(state.rewardHistory || []).map((entry) => ({
      id: entry.id,
      at: entry.at,
      title: `${state.accounts.find((account) => account.id === entry.accountId)?.nickname || "已移除账号"} · ${entry.task === "checkin" ? "每日签到" : entry.task === "travel" ? "旅行领奖" : "旅行出发"}`,
      detail:
        entry.result === "claimed"
          ? entry.credit === null
            ? "奖励金额未返回"
            : `+${number(entry.credit)} 积分`
          : entry.result === "error"
            ? "执行失败"
            : entry.result === "departed"
              ? "已出发"
              : "今日已签到",
      ok: entry.result !== "error",
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const trend = (usage?.daily || []).slice(-7).map((day) => ({
    label: day.day,
    value: day.tokens.total,
    count: day.tokens.requests,
    unknown: 0,
  }));
  return (
    <div className="dashboard">
      <div className="usage-metrics dashboard-metrics">
        <Metric
          label="可用积分"
          value={credit.known ? number(credit.remaining) : "—"}
          detail={`${credit.known}/${state.accounts.length} 个账号已查询${credit.unknown ? ` · ${credit.unknown} 个未知` : " · 官方余额"}`}
          icon={Coins}
        />
        <Metric
          label="近 7 天 Token"
          value={usage ? shortNumber(usage.total.total) : "—"}
          detail={
            usage
              ? usage.api && usage.api.requests > 0
                ? `${number(usage.total.requests)} 次请求 · 含本机 API ${number(usage.api.requests)}`
                : `${number(usage.total.requests)} 次请求 · 本地记录`
              : "正在读取本地用量"
          }
          icon={Zap}
        />
        <Metric
          label="临期积分"
          value={
            credit.known && (credit.expiryKnown || !credit.expiryUnknown)
              ? number(credit.expiring)
              : "—"
          }
          detail={`${state.settings.expiryWarningDays} 天内到期${credit.expiryUnknown ? ` · ${credit.expiryUnknown} 个账号到期未知` : " · 按已查积分包"}`}
          icon={CalendarCheck}
        />
        <Metric
          label="API 请求"
          value={gateway ? number(gateway.totals.requests) : "—"}
          detail={
            gateway
              ? `${gateway.running ? "服务运行中" : "服务已停止"} · ${gateway.activeRequests} 个执行中`
              : "正在读取服务状态"
          }
          icon={Cable}
        />
      </div>
      {errors.length > 0 && (
        <p className="quiet-note pending" role="status">
          {errors.join(" · ")}
        </p>
      )}
      <div className="dashboard-charts">
        <section className="data-section trend-section">
          <SectionHeader
            title="Token 使用趋势"
            detail="近 7 天 · 全部账号 · 本地日期"
          >
            <button className="text-link" onClick={() => navigate("usage")}>
              查看用量
              <ArrowUpRight size={14} />
            </button>
          </SectionHeader>
          <TrendChart
            title="Token 使用趋势"
            points={trend}
            empty={!usage?.records}
          />
          {usage?.warnings.length ? (
            <p className="quiet-note pending">{usage.warnings.join("；")}</p>
          ) : (
            <p className="chart-footnote">
              来自本机对话记录，未记录的用量不会推算。
            </p>
          )}
        </section>
        <section className="data-section">
          <SectionHeader
            title="账号积分分布"
            detail="已查询余额 · 按账号对比"
          />
          <BalanceBars
            title="账号积分分布"
            rows={[...state.accounts]
              .sort(
                (a, b) =>
                  (b.quota?.remaining ?? -1) - (a.quota?.remaining ?? -1),
              )
              .slice(0, 5)
              .map((account) => ({
                label: account.nickname,
                value: account.quotaError
                  ? null
                  : (account.quota?.remaining ?? null),
                detail: account.quotaError
                  ? "查询失败"
                  : account.quota
                    ? `更新于 ${date(account.quota.fetchedAt, true)}`
                    : "尚未查询",
              }))}
          />
          <button
            className="section-bottom-link"
            onClick={() => navigate("accounts")}
          >
            管理全部 {state.accounts.length} 个账号
            <ArrowUpRight size={13} />
          </button>
        </section>
      </div>
      <div className="dashboard-lower">
        <section className="data-section">
          <SectionHeader
            title="Token 构成"
            detail="近 7 天 · 推理包含在输出中"
          />
          <RingChart
            title="Token 构成"
            segments={[
              { label: "输入", value: usage?.total.input || 0 },
              { label: "输出", value: usage?.total.output || 0 },
              { label: "缓存读取", value: usage?.total.cacheRead || 0 },
              { label: "缓存写入", value: usage?.total.cacheWrite || 0 },
            ]}
          />
        </section>
        <section className="data-section">
          <SectionHeader
            title={rewards ? "任务与奖励" : "账号状态"}
            detail={rewards ? "今日状态 · 签到按北京时间" : "国际版账号与凭据"}
          />
          <div className="dashboard-task-stats">
            <div>
              <span>
                <Users size={14} />
                已保存账号
              </span>
              <strong>
                {state.accounts.length}
                <small>个</small>
              </strong>
            </div>
            <div>
              <span>
                <ShieldCheck size={14} />
                需关注账号
              </span>
              <strong className={credit.attention ? "pending" : ""}>
                {credit.attention}
                <small>个</small>
              </strong>
            </div>
            {rewards && (
              <>
                <div>
                  <span>
                    <CalendarCheck size={14} />
                    今日已签到
                  </span>
                  <strong>
                    {checkins}
                    <small>/ {state.accounts.length}</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Gift size={14} />
                    旅行待领奖
                  </span>
                  <strong>
                    {waiting}
                    <small>个</small>
                  </strong>
                </div>
              </>
            )}
          </div>
          {rewards && (
            <div className="dashboard-task-footer">
              <span>
                近 7 天签到 / 旅行 <strong>+{number(earned)}</strong>
                {unknown > 0 && <small> · {unknown} 笔金额未知</small>}
              </span>
              <Button
                icon={ClipboardCheck}
                disabled={disabled || !state.accounts.length}
                onClick={() =>
                  runTasks(state.accounts.map((account) => account.id))
                }
              >
                一键做任务
              </Button>
            </div>
          )}
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="data-section">
          <SectionHeader title="最近动态" detail="本应用记录的账号与奖励事件" />
          {activity.length ? (
            <div className="activity-list">
              {activity.map((entry, i) => (
                <div key={entry.id + i}>
                  <span
                    className="activity-mark"
                    style={{ color: entry.ok ? chartColors[2] : "var(--red)" }}
                  >
                    <Activity size={14} />
                  </span>
                  <div>
                    <strong>{entry.title}</strong>
                    <small>{entry.detail}</small>
                  </div>
                  <time>{date(entry.at, true)}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="activity-empty">
              <Activity size={19} />
              <span>暂无动态，执行操作后会显示在这里。</span>
            </div>
          )}
        </section>
        <section className="data-section service-summary">
          <SectionHeader title="本机服务" detail="OpenAI 兼容 API" />
          <span className={`service-state ${gateway?.running ? "online" : ""}`}>
            <span />
            {gateway ? (gateway.running ? "运行中" : "已停止") : "状态未知"}
          </span>
          <code>{gateway?.baseUrl || "127.0.0.1"}</code>
          <p>凭据在本机加密，调用范围由你选择。</p>
          <button
            className="section-bottom-link"
            onClick={() => navigate("api")}
          >
            打开 API 控制台
            <ArrowUpRight size={13} />
          </button>
        </section>
      </div>
    </div>
  );
}
