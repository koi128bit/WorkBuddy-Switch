import { useEffect, useState } from "react";
import { Button, Modal, Toggle, date } from "./components";
import type { TaskPlan, TaskOptions } from "./types";
export const defaultTaskOptions: TaskOptions = {
  includeAI: true,
  maxCalls: 20,
  prompt: "请用一句话介绍你能帮助我完成什么工作。",
};
export function TaskPlanDialog({
  plan,
  busy,
  error,
  update,
  execute,
  close,
}: {
  plan: TaskPlan;
  busy: boolean;
  error: string;
  update: (options: TaskOptions) => void;
  execute: () => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(plan.options),
    [expired, setExpired] = useState(false);
  useEffect(() => {
    setDraft(plan.options);
    setExpired(false);
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, plan.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [plan]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.options),
    valid =
      Number.isInteger(draft.maxCalls) &&
      draft.maxCalls >= 1 &&
      draft.maxCalls <= 20 &&
      draft.prompt.trim().length > 0 &&
      draft.prompt.length <= 200;
  return (
    <Modal
      title="执行前确认"
      subtitle={`${plan.accountIds.length} 个账号 · 范围有效至 ${date(plan.expiresAt, true)}`}
      onClose={() => !busy && close()}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button disabled={busy || !valid} onClick={() => update(draft)}>
            更新范围
          </Button>
          <Button
            primary
            disabled={busy || dirty || expired || !valid}
            onClick={execute}
          >
            {plan.maxCalls
              ? `确认并执行（最多 ${plan.maxCalls} 条）`
              : "执行基础任务"}
          </Button>
        </>
      }
    >
      <p className="task-plan-basic">
        基础任务：签到、成长任务接取、已达标奖励领取、旅行领奖及按已保存地点出发。
      </p>
      <Toggle
        label="包含真实 AI 对话"
        description="将发送真实对话并消耗积分；实际价格由官方计费，奖励可能低于消耗。"
        checked={draft.includeAI}
        disabled={busy}
        onChange={(includeAI) =>
          setDraft({
            ...draft,
            includeAI,
            maxCalls:
              Number.isInteger(draft.maxCalls) &&
              draft.maxCalls >= 1 &&
              draft.maxCalls <= 20
                ? draft.maxCalls
                : defaultTaskOptions.maxCalls,
            prompt: draft.prompt.trim()
              ? draft.prompt
              : defaultTaskOptions.prompt,
          })
        }
      />
      {draft.includeAI && (
        <div className="task-plan-options">
          <label>
            本次对话总上限
            <input
              aria-label="本次对话总上限"
              type="number"
              min="1"
              max="20"
              value={Number.isNaN(draft.maxCalls) ? "" : draft.maxCalls}
              disabled={busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  maxCalls:
                    event.target.value === ""
                      ? NaN
                      : Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            对话内容
            <textarea
              aria-label="对话内容"
              maxLength={200}
              rows={2}
              value={draft.prompt}
              disabled={busy}
              onChange={(event) =>
                setDraft({ ...draft, prompt: event.target.value })
              }
            />
          </label>
          <p>
            每次请求输出上限 {plan.outputLimit} Token。当前支持普通次数、GLM-5.2
            体验和北京时间夜间对话；只按官方进度执行。
          </p>
        </div>
      )}
      {(dirty || expired) && (
        <p className="task-plan-warning">
          {expired
            ? "范围已过期，请更新后再次确认。"
            : "选项已更改，请先更新执行范围。"}
        </p>
      )}
      {error && (
        <p role="alert" className="task-plan-warning">
          {error}
        </p>
      )}
      <div className="task-plan-scope" aria-label="已确认执行范围">
        {plan.accounts.map((account) => (
          <section key={account.accountId}>
            <strong>{account.nickname}</strong>
            {account.tasks.map((task) => (
              <div className="task-plan-row" key={task.code}>
                <span>
                  {task.title}
                  <small>
                    {task.modelName} · 官方进度 {task.current}/{task.target}
                  </small>
                </span>
                <span>最多 {task.calls} 条</span>
              </div>
            ))}
            {account.note && <p>{account.note}</p>}
            {account.pendingTitles.length > 0 && (
              <details>
                <summary>
                  仍需客户端操作或暂不满足条件（{account.pendingTitles.length}{" "}
                  项）
                </summary>
                <p>
                  {account.pendingTitles.slice(0, 8).join("、")}
                  {account.pendingTitles.length > 8 ? "等" : ""}
                </p>
              </details>
            )}
          </section>
        ))}
      </div>
      <p className="task-plan-footnote">
        未确认不会发送对话。失败、进度不推进或点击停止后，本账号不再继续发送；已发出的请求可能已经产生积分消耗。确认范围之外的新任务留待下次操作。
      </p>
    </Modal>
  );
}
