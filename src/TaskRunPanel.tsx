import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ClipboardCheck,
  Square,
  LoaderCircle,
} from "lucide-react";
import { Button, date, number } from "./components";
import type { Snapshot } from "./types";
const statuses = {
  claimed: "已领取",
  accepted: "已接取",
  departed: "已出发",
  pending: "待完成",
  skipped: "已跳过",
  error: "失败",
  dialogue: "已对话",
  activity: "已提交活动",
};
export function TaskRunPanel({
  state,
  stop,
}: {
  state: Snapshot;
  stop: (id: string) => void;
}) {
  const run = state.taskRun;
  const [expanded, setExpanded] = useState(run?.status === "running");
  const lastRun = useRef(run?.id);
  useEffect(() => {
    if (run?.id !== lastRun.current) {
      lastRun.current = run?.id;
      setExpanded(run?.status === "running");
    }
  }, [run?.id, run?.status]);
  if (!run)
    return state.taskRunWarning ? (
      <p className="quiet-note">{state.taskRunWarning}</p>
    ) : null;
  const running = run.status === "running",
    summary = run.summary;
  const title = running
    ? run.cancelRequested
      ? "正在停止"
      : "执行中"
    : run.status === "cancelled"
      ? "已停止"
      : run.status === "interrupted"
        ? "执行中断"
        : run.status === "failed"
          ? "执行失败"
          : "执行结束";
  const current = state.accounts.find(
    (account) => account.id === run.currentAccountId,
  );
  return (
    <section className="task-run-panel" role="region" aria-label="任务执行进度">
      <div className="task-run-heading">
        <button
          className="task-run-title"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {running ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ClipboardCheck size={18} />
          )}
          <strong>一键任务 · {title}</strong>
          <span>
            {run.completedAccounts}/{run.totalAccounts} 个账号
          </span>
          <ChevronDown size={15} />
        </button>
        {running ? (
          <Button
            icon={Square}
            disabled={run.cancelRequested}
            onClick={() => stop(run.id)}
          >
            停止后续任务
          </Button>
        ) : (
          <small>{date(run.finishedAt || run.startedAt, true)}</small>
        )}
      </div>
      <div className="task-run-summary" role="status" aria-live="polite">
        {running ? (
          <span>
            {current?.nickname ? `${current.nickname} · ` : ""}
            {run.currentStep}
          </span>
        ) : (
          <span>
            领取 {summary.claimed} 项 · 接取 {summary.accepted} 项 · 出发{" "}
            {summary.departed} 项 · 待完成 {summary.pending} 项
            {summary.failed ? ` · 失败 ${summary.failed} 项` : ""}
            {summary.dialogues ? ` · 真实对话 ${summary.dialogues} 次` : ""}
            {summary.activities ? ` · 活动记录 ${summary.activities} 次` : ""}
          </span>
        )}
        <span>
          官方返回奖励 <strong>+{number(summary.credit, 4)} 积分</strong>
          {summary.energy > 0 ? ` · +${number(summary.energy)} 能量` : ""}
          {summary.unknownAmounts
            ? ` · ${summary.unknownAmounts} 项未返回金额`
            : ""}
        </span>
      </div>
      {expanded && (
        <div className="task-run-results">
          {run.results.slice(-100).map((entry) => (
            <div className="task-run-row" key={entry.id}>
              <div>
                <strong>{entry.title}</strong>
                <small>
                  {state.accounts.find(
                    (account) => account.id === entry.accountId,
                  )?.nickname || "已移除账号"}
                  {entry.current !== null &&
                  entry.current !== undefined &&
                  entry.target
                    ? ` · ${entry.current}/${entry.target}`
                    : ""}
                </small>
              </div>
              <span
                className={
                  entry.status === "error"
                    ? "red"
                    : entry.status === "pending" || entry.status === "activity"
                      ? "muted"
                      : "success"
                }
              >
                {statuses[entry.status]}
              </span>
              <p>
                {entry.detail}
                {entry.status === "claimed" &&
                (entry.credit !== null || entry.energy !== null)
                  ? ` ${entry.credit !== null ? `+${number(entry.credit, 4)} 积分` : ""}${entry.energy !== null ? ` +${number(entry.energy)} 能量` : ""}`
                  : ""}
              </p>
            </div>
          ))}
          {!run.results.length && (
            <p className="quiet-note">正在查询官方任务状态…</p>
          )}
        </div>
      )}
    </section>
  );
}
