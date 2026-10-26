import { useEffect, useState } from "react";
import { Button, Modal, Toggle, date } from "./components";
import type { TaskPlan, TaskOptions } from "./types";
export const defaultTaskOptions: TaskOptions = {
  includeAI: true,
  includeActivities: true,
  maxCalls: 80,
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
      draft.maxCalls <= 200 &&
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
              : plan.maxActivities
                ? `确认并执行（最多 ${plan.maxActivities} 次活动）`
                : "执行基础任务"}
          </Button>
        </>
      }
    >
      <p className="task-plan-basic">
        基础任务：签到、成长任务接取、已达标奖励领取、旅行领奖及按已保存地点出发。
      </p>
      <Toggle
        label="包含活动事件任务"
        description="模板、灵感、画布、资料库等通过兼容活动上报推进；部分体验任务需真实对话，已计入上限。主题任务会应用官方主题，可在官方客户端改回。不会生成画布或长期定时任务，也不建立第三方应用授权。完成情况以官方计分为准。"
        checked={draft.includeActivities ?? false}
        disabled={busy}
        onChange={(includeActivities) =>
          setDraft({ ...draft, includeActivities })
        }
      />
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
              draft.maxCalls <= 200
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
              max="200"
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
            每次请求输出上限 {plan.outputLimit}{" "}
            Token。支持普通对话、GLM-5.2、桌面端、专家、专家团、指定专家和已安装技能；夜间任务仅在北京时间夜间执行。
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
                    {task.modelName} ·{" "}
                    {task.deferred
                      ? "等待官方进度，先预留次数上限"
                      : `官方进度 ${task.current}/${task.target}`}
                    {task.waitingForUnlock ? " · 解锁后自动继续" : ""}
                    {!!task.resources?.length &&
                      ` · ${task.resources.map((resource) => resource.name).join("、")}`}
                  </small>
                </span>
                <span>
                  {task.calls
                    ? `最多 ${task.calls} 条对话`
                    : `最多 ${task.actions || 0} 次活动`}
                </span>
              </div>
            ))}
            {account.note && <p>{account.note}</p>}
            {account.pendingTitles.length > 0 && (
              <details>
                <summary>
                  需本人操作或暂不可执行（{account.pendingTitles.length} 项）
                </summary>
                {account.pendingReasons?.length ? (
                  account.pendingReasons.map((item) => (
                    <p key={item.code}>
                      <strong>{item.title}</strong> · {item.reason}
                    </p>
                  ))
                ) : (
                  <p>{account.pendingTitles.join("、")}</p>
                )}
              </details>
            )}
          </section>
        ))}
      </div>
      <p className="task-plan-footnote">
        一次确认后会自动接取、执行、等待计分并领奖；范围内的前置任务解锁后继续处理。未确认不会发送对话；请求失败或进度不推进时停止本账号后续对话，已发出的请求可能已产生积分消耗。需本人操作的任务会逐项保留原因。
      </p>
    </Modal>
  );
}
