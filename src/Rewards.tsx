import { useState } from "react";
import {
  CalendarCheck,
  ClipboardCheck,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Gift,
  Info,
  MapPin,
  Plane,
  RefreshCw,
} from "lucide-react";
import { Button, date, Empty, mask, number, Toggle } from "./components";
import type { Account, Snapshot } from "./types";

export type Run = (
  label: string,
  action: () => Promise<unknown>,
  success?: string,
) => Promise<void>;
export type Claim = (
  ids: string[],
  kind?: "all" | "checkin" | "travel",
) => void;
export const chinaDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function CheckinStatus({ account }: { account: Account }) {
  const status = account.rewards?.checkin;
  const error = account.rewards?.checkinError;
  const known = !error && status?.day === chinaDay();
  const label = error
    ? "查询失败"
    : !known
      ? "待查询"
      : status.checkedIn
        ? "已签到"
        : "待签到";
  const Icon =
    error || !known ? CircleHelp : status.checkedIn ? CheckCircle2 : Clock3;
  return (
    <span
      className={`task-status ${known && status.checkedIn ? "success" : known ? "pending" : "muted"}`}
      title={
        error ||
        (status
          ? `状态查询于 ${date(status.fetchedAt, true)}`
          : "点击刷新状态查询今天的签到")
      }
    >
      <Icon size={15} />
      {label}
    </span>
  );
}

export function TravelStatus({ account }: { account: Account }) {
  const travel = account.rewards?.travel;
  const error = account.rewards?.travelError;
  const label = error
    ? "暂不可用"
    : !travel
      ? "待查询"
      : travel.state === "arrived"
        ? "已到达"
        : travel.state === "traveling"
          ? "旅行中"
          : travel.dailyLimitReached
            ? "今日已完成"
            : "待出发";
  return (
    <span
      className={`task-status ${!error && travel?.state === "arrived" ? "success" : "muted"}`}
      title={
        error ||
        (travel
          ? `状态查询于 ${date(travel.fetchedAt, true)}`
          : "点击刷新状态查询旅行")
      }
    >
      {travel?.state === "arrived" ? (
        <CheckCircle2 size={15} />
      ) : (
        <Plane size={15} />
      )}
      {label}
    </span>
  );
}

export function AccountTasks({
  account,
  disabled,
  run,
  claim,
  compact = false,
}: {
  account: Account;
  disabled: boolean;
  run: Run;
  claim: Claim;
  compact?: boolean;
}) {
  const [chosen, setChosen] = useState("");
  const rewards = account.rewards;
  const travel = rewards?.travel;
  const location = chosen || account.travelLocationId || "";
  const checkedIn =
    !rewards?.checkinError &&
    rewards?.checkin?.day === chinaDay() &&
    rewards.checkin.checkedIn;
  const canDepart =
    !rewards?.travelError &&
    !rewards?.configError &&
    travel?.state === "idle" &&
    !travel.dailyLimitReached;
  const canClaim = !rewards?.travelError && travel?.state === "arrived";
  return (
    <div className={`account-tasks ${compact ? "inline-tasks" : ""}`}>
      <div className="task-item">
        <div className="task-heading">
          <CalendarCheck size={18} />
          <span>每日签到</span>
        </div>
        <CheckinStatus account={account} />
        {!compact && <p>每天领取官方签到奖励，金额以官方返回为准。</p>}
        {!compact && (
          <Button
            disabled={disabled || checkedIn}
            icon={checkedIn ? Check : Gift}
            onClick={() => claim([account.id], "checkin")}
          >
            {checkedIn ? "今日已签到" : "签到领积分"}
          </Button>
        )}
        {rewards?.checkinError && (
          <p className="task-error">{rewards.checkinError}</p>
        )}
      </div>
      <div className="task-item">
        <div className="task-heading">
          <Plane size={18} />
          <span>猫猫旅行</span>
        </div>
        <TravelStatus account={account} />
        {!compact && (
          <p>
            {travel?.state === "traveling"
              ? `${travel.locationName || "旅行中"}${travel.arriveAt ? ` · 预计 ${date(travel.arriveAt, true)} 到达` : ""}`
              : travel?.state === "arrived"
                ? `${travel.locationName || "猫猫"}已到达，奖励可以领取。`
                : "选择官方地点，出发后等待奖励。"}
          </p>
        )}
        {rewards?.travelError && (
          <p className="task-error">{rewards.travelError}</p>
        )}
        {travel?.state === "arrived" && (
          <Button
            disabled={disabled || !canClaim}
            icon={Gift}
            onClick={() => claim([account.id], "travel")}
          >
            领取奖励
          </Button>
        )}
        {travel?.state === "idle" && !travel.dailyLimitReached && (
          <div className="depart-controls">
            <select
              aria-label="旅行地点"
              disabled={disabled || !rewards?.locations.length || !canDepart}
              value={location}
              onChange={(event) => {
                const value = event.target.value;
                setChosen(value);
                if (value)
                  void run("保存旅行地点", () =>
                    window.workbuddy.editAccount(account.id, {
                      travelLocationId: value,
                    }),
                  );
              }}
            >
              <option value="">选择旅行地点</option>
              {rewards?.locations.map((item) => (
                <option value={String(item.id)} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Button
              icon={Plane}
              disabled={disabled || !location || !canDepart}
              onClick={() =>
                void run(
                  "旅行出发",
                  () => window.workbuddy.departTravel(account.id, location),
                  "猫猫已出发",
                )
              }
            >
              出发
            </Button>
          </div>
        )}
        {rewards?.configError && !rewards.travelError && (
          <p className="task-error">{rewards.configError}</p>
        )}
      </div>
      {compact && (
        <div className="inline-actions">
          <Button
            className="subtle-primary"
            icon={Gift}
            disabled={disabled}
            aria-label={`领取${account.nickname}积分`}
            onClick={() => claim([account.id])}
          >
            一键领积分
          </Button>
          <Button
            icon={RefreshCw}
            disabled={disabled}
            onClick={() =>
              void run("刷新活动状态", () =>
                window.workbuddy.refreshRewards([account.id]),
              )
            }
          >
            刷新状态
          </Button>
        </div>
      )}
    </div>
  );
}

export function RewardsPage({
  state,
  disabled,
  run,
  claim,
  runTasks,
}: {
  state: Snapshot;
  disabled: boolean;
  run: Run;
  claim: Claim;
  runTasks: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState(
    state.current?.id || state.accounts[0]?.id || "",
  );
  const account =
    state.accounts.find((item) => item.id === selected) || state.accounts[0];
  const [historyScope, setHistoryScope] = useState("account");
  if (!account)
    return (
      <Empty
        icon={Gift}
        title="添加账号后领取积分"
        detail="保存当前 WorkBuddy 账号，或通过官方网页登录添加。"
      />
    );
  const history = (state.rewardHistory || []).filter(
    (item) => historyScope === "all" || item.accountId === account.id,
  );
  return (
    <div className="rewards-layout">
      <aside className="reward-accounts" aria-label="积分账号选择">
        <div className="small-heading">选择账号</div>
        {state.accounts.map((item) => (
          <button
            key={item.id}
            className={`reward-account ${item.id === account.id ? "selected" : ""}`}
            onClick={() => setSelected(item.id)}
            aria-pressed={item.id === account.id}
          >
            <span className="account-initial">{item.nickname.slice(0, 1)}</span>
            <span className="reward-account-name">
              <strong>{item.nickname}</strong>
              <small>{mask(item.id, state.settings.privacyMode)}</small>
            </span>
            <span>{item.quotaError ? "—" : number(item.quota?.remaining)}</span>
          </button>
        ))}
        <p className="quiet-note">余额来自官方积分接口。</p>
      </aside>
      <div className="reward-body">
        <div className="reward-account-heading">
          <div>
            <h2>{account.nickname}</h2>
            <p>{mask(account.id, state.settings.privacyMode)}</p>
          </div>
          <Button
            icon={ClipboardCheck}
            disabled={disabled}
            onClick={() => runTasks([account.id])}
          >
            一键做任务
          </Button>
          <div className="reward-balance">
            <span>可用积分</span>
            <strong>
              {account.quotaError ? "—" : number(account.quota?.remaining)}
              <small>积分</small>
            </strong>
            {account.quota && !account.quotaError && (
              <span className="reward-meta">
                总额 {number(account.quota.total)} · 已用{" "}
                {number(account.quota.used)}
                {account.quota.expiresAt && (
                  <span>最近到期 {date(account.quota.expiresAt)}</span>
                )}
              </span>
            )}
          </div>
        </div>
        {account.quotaError && (
          <div className="notice warn">
            <Info size={16} />
            {account.quotaError}
          </div>
        )}
        <p className="quiet-note">
          一键执行签到、成长任务接取、已达标奖励领取和旅行。需要客户端实际操作的任务会保留进度并显示待完成。
        </p>
        <AccountTasks
          key={account.id}
          account={account}
          disabled={disabled}
          run={run}
          claim={claim}
        />
        <div className="reward-preferences">
          <Toggle
            label="此账号参与自动任务"
            description="开启全局自动签到或旅行后，对此账号生效。"
            checked={account.automaticRewards !== false}
            disabled={disabled}
            onChange={(value) =>
              void run("更新账号自动任务", () =>
                window.workbuddy.editAccount(account.id, {
                  automaticRewards: value,
                }),
              )
            }
          />
          <Button
            icon={MapPin}
            disabled={disabled}
            onClick={() =>
              void run("打开官方成长中心", () =>
                window.workbuddy.openLink("growth"),
              )
            }
          >
            官方成长中心
          </Button>
        </div>
        <div className="history-heading">
          <h2>领取记录</h2>
          <select
            aria-label="领取记录范围"
            value={historyScope}
            onChange={(event) => setHistoryScope(event.target.value)}
          >
            <option value="account">当前账号</option>
            <option value="all">全部账号</option>
          </select>
        </div>
        <div className="reward-history" role="table" aria-label="积分领取记录">
          <div className="reward-history-row heading" role="row">
            <span>时间</span>
            <span>账号 / 任务</span>
            <span>结果</span>
            <span>积分</span>
          </div>
          {history.slice(0, 50).map((entry) => (
            <div className="reward-history-row" role="row" key={entry.id}>
              <span>{date(entry.at, true)}</span>
              <span>
                <strong>
                  {entry.task === "checkin"
                    ? "每日签到"
                    : entry.task === "travel"
                      ? "旅行奖励"
                      : "旅行出发"}
                </strong>
                <small>
                  {state.accounts.find((item) => item.id === entry.accountId)
                    ?.nickname ||
                    mask(entry.accountId, state.settings.privacyMode)}{" "}
                  · {entry.automatic ? "自动" : "手动"}
                </small>
              </span>
              <span
                className={entry.result === "error" ? "red" : "success"}
                title={entry.detail}
              >
                {entry.result === "error"
                  ? "失败"
                  : entry.result === "claimed"
                    ? "已领取"
                    : entry.result === "already"
                      ? "已签到"
                      : "已出发"}
                {entry.result === "error" && <small>{entry.detail}</small>}
              </span>
              <strong>
                {entry.credit === null
                  ? entry.result === "claimed"
                    ? "未返回金额"
                    : "—"
                  : `+${number(entry.credit, 4)}`}
              </strong>
            </div>
          ))}
          {!history.length && (
            <p className="history-empty">
              暂无领取记录。仅记录本应用执行的任务。
            </p>
          )}
        </div>
        <p className="quiet-note">
          自动任务仅在应用运行时执行。签到日期按北京时间计算，活动资格与奖励由官方服务决定。
        </p>
      </div>
    </div>
  );
}
