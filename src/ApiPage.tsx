import { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, Play, RefreshCw, Square } from "lucide-react";
import {
  Button,
  Modal,
  Toggle,
  date,
  mask,
  number,
  SectionHeader,
} from "./components";
import type { ApiConfig, ApiStatus } from "./types";
import { ApiAnalytics } from "./ApiAnalytics";

export function ApiPage({ privacy }: { privacy: boolean }) {
  const api = window.workbuddy;
  const operation = useRef(0);
  const [status, setStatus] = useState<ApiStatus | null>(null),
    [draft, setDraft] = useState<ApiConfig | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [rotate, setRotate] = useState(false);
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]),
    [model, setModel] = useState("auto"),
    [reply, setReply] = useState("");
  useEffect(() => {
    let alive = true,
      version = 0;
    const refresh = async () => {
      const request = ++version;
      try {
        const value = await api.apiStatus();
        if (alive && request === version) {
          setStatus(value);
          setDraft((current) => current ?? value.config);
        }
      } catch (error) {
        if (alive) setError((error as Error).message);
      }
    };
    void refresh();
    const stop = api.onChange(() => {
      void refresh();
    });
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => {
      alive = false;
      stop();
      clearInterval(timer);
    };
  }, [api]);
  const run = async <T,>(
    label: string,
    action: () => Promise<T>,
    done: (value: T) => void,
  ) => {
    if (busy && !(busy === "测试对话" && label === "停止服务")) return;
    const current = ++operation.current;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const value = await action();
      if (current === operation.current) done(value);
    } catch (error) {
      if (current === operation.current) setError((error as Error).message);
    } finally {
      if (current === operation.current) setBusy("");
    }
  };
  if (!status || !draft)
    return (
      <p className="quiet-note" role={error ? "alert" : undefined}>
        {error || "正在读取本机 API 设置…"}
      </p>
    );
  const dirty = JSON.stringify(draft) !== JSON.stringify(status.config),
    locked = status.running || !!busy;
  const update = <K extends keyof ApiConfig>(key: K, value: ApiConfig[K]) =>
    setDraft({ ...draft, [key]: value });
  const copy = (kind: "key" | "baseUrl" | "curl") =>
    void run(
      "复制",
      () => api.apiCopy(kind),
      () =>
        setMessage(
          kind === "key"
            ? "API Key 已复制。"
            : kind === "baseUrl"
              ? "Base URL 已复制。"
              : "调用示例已复制。",
        ),
    );
  return (
    <div className="api-page">
      <section className="settings-card api-service">
        <div className="api-service-heading">
          <div>
            <h2>本机 API 服务</h2>
            <p>
              <span className={"api-dot " + (status.running ? "on" : "")} />
              <strong>{status.running ? "运行中" : "已停止"}</strong>
              <span> · {status.activeRequests} 个请求执行中</span>
            </p>
          </div>
          <div className="api-actions">
            <Button
              icon={RefreshCw}
              disabled={!!busy}
              onClick={() => void run("刷新", () => api.apiStatus(), setStatus)}
            >
              刷新状态
            </Button>
            {status.running ? (
              <Button
                icon={Square}
                disabled={!!busy && busy !== "测试对话"}
                onClick={() =>
                  void run(
                    "停止服务",
                    () => api.apiStop(),
                    (value) => {
                      setStatus(value);
                      setMessage("服务已停止。");
                    },
                  )
                }
              >
                停止服务
              </Button>
            ) : (
              <Button
                primary
                icon={Play}
                disabled={
                  !!busy || dirty || !draft.accounts.length || !status.hasKey
                }
                onClick={() =>
                  void run("启动服务", () => api.apiStart(), setStatus)
                }
              >
                启动服务
              </Button>
            )}
          </div>
        </div>
        <div className="api-connection-row">
          <div>
            <small>Base URL</small>
            <code>{status.baseUrl}</code>
          </div>
          <Button icon={Copy} disabled={!!busy} onClick={() => copy("baseUrl")}>
            复制地址
          </Button>
        </div>
        <div className="api-connection-row">
          <div>
            <small>API Key</small>
            <code>
              {status.hasKey
                ? "••••••••••••••••••••••••"
                : "系统加密服务不可用"}
            </code>
          </div>
          <div className="api-actions">
            <Button
              icon={KeyRound}
              disabled={!!busy || !status.hasKey}
              onClick={() => copy("key")}
            >
              复制 API Key
            </Button>
            <Button
              disabled={!!busy || status.activeRequests > 0}
              onClick={() => setRotate(true)}
            >
              轮换密钥
            </Button>
          </div>
        </div>
        <p className="quiet-note">
          OpenAI / Anthropic 兼容 · 仅监听 127.0.0.1 ·
          随应用退出停止。调用会消耗所选账号积分，实际计费由官方确定。
        </p>
      </section>
      {error && (
        <p className="api-notice red" role="alert">
          {error}
        </p>
      )}
      {status.lastError && status.lastError !== error && (
        <p className="api-notice" role="alert">
          {status.lastError}
        </p>
      )}
      {message && (
        <p className="api-notice" role="status">
          {message}
        </p>
      )}
      <div className="api-stats" aria-label="API 累计用量">
        {[
          ["请求", status.totals.requests],
          ["成功", status.totals.succeeded],
          ["输入 Token", status.totals.inputTokens],
          ["输出 Token", status.totals.outputTokens],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{number(value as number)}</strong>
          </div>
        ))}
      </div>
      <ApiAnalytics status={status} />
      <div className="api-columns">
        <section className="settings-card api-config">
          <SectionHeader
            title="账号与调度"
            detail="只使用勾选的账号；新增账号不会自动加入。"
          />
          <fieldset disabled={locked}>
            <div className="api-fields">
              <label>
                监听端口
                <input
                  aria-label="监听端口"
                  type="number"
                  min={1024}
                  max={65535}
                  value={Number.isNaN(draft.port) ? "" : draft.port}
                  onChange={(event) =>
                    update("port", event.target.valueAsNumber)
                  }
                />
              </label>
              <label>
                账号调度
                <select
                  aria-label="账号调度"
                  value={draft.strategy}
                  onChange={(event) =>
                    update(
                      "strategy",
                      event.target.value as ApiConfig["strategy"],
                    )
                  }
                >
                  <option value="round_robin">轮询账号</option>
                  <option value="sequential">顺序使用</option>
                  <option value="expiring">先用临期积分</option>
                </select>
              </label>
              <label>
                最大并发
                <input
                  aria-label="最大并发"
                  type="number"
                  min={1}
                  max={8}
                  value={
                    Number.isNaN(draft.maxConcurrency)
                      ? ""
                      : draft.maxConcurrency
                  }
                  onChange={(event) =>
                    update("maxConcurrency", event.target.valueAsNumber)
                  }
                />
              </label>
              <label>
                每分钟请求上限
                <input
                  aria-label="每分钟请求上限"
                  type="number"
                  min={1}
                  max={600}
                  value={
                    Number.isNaN(draft.requestsPerMinute)
                      ? ""
                      : draft.requestsPerMinute
                  }
                  onChange={(event) =>
                    update("requestsPerMinute", event.target.valueAsNumber)
                  }
                />
              </label>
              <label>
                单次输出 Token 上限
                <input
                  aria-label="单次输出 Token 上限"
                  type="number"
                  min={16}
                  max={32768}
                  value={
                    Number.isNaN(draft.maxOutputTokens)
                      ? ""
                      : draft.maxOutputTokens
                  }
                  onChange={(event) =>
                    update("maxOutputTokens", event.target.valueAsNumber)
                  }
                />
              </label>
            </div>
            <Toggle
              label="随应用启动 API"
              description="应用运行期间按已保存范围启动，不创建额外的后台服务。"
              checked={draft.autoStart}
              disabled={locked}
              onChange={(value) => update("autoStart", value)}
            />
            <div className="api-account-list" aria-label="API 账号范围">
              {status.accounts.map((account) => {
                const selected = draft.accounts.some(
                  (value) =>
                    value.id === account.id &&
                    value.provider === account.provider,
                );
                return (
                  <label
                    key={account.provider + account.id}
                    className="api-account"
                  >
                    <input
                      type="checkbox"
                      aria-label={"用于 API：" + account.nickname}
                      checked={selected}
                      disabled={!account.available || locked}
                      onChange={(event) =>
                        update(
                          "accounts",
                          event.target.checked
                            ? [
                                ...draft.accounts,
                                { provider: account.provider, id: account.id },
                              ]
                            : draft.accounts.filter(
                                (value) =>
                                  !(
                                    value.id === account.id &&
                                    value.provider === account.provider
                                  ),
                              ),
                        )
                      }
                    />
                    <span>
                      <strong>{account.nickname}</strong>
                      <small>
                        {account.provider === "workbuddy-global"
                          ? "国际版"
                          : "国内版"}{" "}
                        · {mask(account.id, privacy)}
                      </small>
                    </span>
                    <small>
                      {!account.available
                        ? "需网页登录授权"
                        : account.cooldownUntil > Date.now()
                          ? "冷却至 " + date(account.cooldownUntil, true)
                          : account.remaining === null
                            ? "余额未查询"
                            : number(account.remaining) + " 积分"}
                    </small>
                  </label>
                );
              })}
              {!status.accounts.length && (
                <p className="quiet-note">
                  请先在账号页添加 WorkBuddy 官方网页登录账号。
                </p>
              )}
            </div>
          </fieldset>
          <div className="api-form-footer">
            <small>
              {status.running
                ? "停止服务后可修改配置。"
                : dirty
                  ? "配置已更改，请保存后启动。"
                  : "已选择 " + draft.accounts.length + " 个账号。"}
            </small>
            <Button
              disabled={locked || !dirty}
              onClick={() =>
                void run(
                  "保存 API 设置",
                  () => api.apiSave(draft),
                  (value) => {
                    setStatus(value);
                    setDraft(value.config);
                    setMessage("API 配置已保存。");
                  },
                )
              }
            >
              保存 API 设置
            </Button>
          </div>
        </section>
        <section className="settings-card api-config">
          <SectionHeader
            title="接入与验证"
            detail="支持 Chat Completions、Responses 和 Anthropic Messages，包含流式回复、工具调用与图片输入。"
          />
          <ol className="api-steps">
            <li>
              OpenCode 选择 OpenAI Compatible（@ai-sdk/openai-compatible）。
            </li>
            <li>填入上方 Base URL，粘贴复制的 API Key。</li>
            <li>
              获取模型后选择模型；国际版使用 <code>global:</code> 前缀。
            </li>
          </ol>
          <div className="api-test-model">
            <label>
              测试模型
              <select
                aria-label="测试模型"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {(models.length ? models : [{ id: model }]).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name && item.name !== item.id
                      ? `${item.name} · ${item.id}`
                      : item.id}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!!busy || dirty || !draft.accounts.length}
              onClick={() =>
                void run(
                  "获取模型",
                  () => api.apiModels(),
                  (value) => {
                    setModels(value.data);
                    if (!value.data.some((item) => item.id === model))
                      setModel(value.data[0]?.id || "auto");
                    setMessage(
                      "已重新查询官方目录，读取 " +
                        value.data.length +
                        " 个当前可用模型。",
                    );
                  },
                )
              }
            >
              获取模型
            </Button>
          </div>
          <p className="quiet-note">
            获取模型不发送对话。测试对话会发送一句短消息，输出最多 64
            Token，按官方计费。
          </p>
          <Button
            disabled={!!busy || !status.running}
            busy={busy === "测试对话"}
            onClick={() =>
              void run(
                "测试对话",
                () => api.apiTest(model),
                (value) => setReply(value.message),
              )
            }
          >
            测试对话
          </Button>
          {reply && (
            <p className="api-test-reply" role="status">
              {reply}
            </p>
          )}
          <details className="api-example">
            <summary>cURL 调用示例</summary>
            <p>
              先将复制的 API Key 配置为 <code>WORKBUDDY_API_KEY</code>{" "}
              环境变量。
            </p>
            <pre>{`curl '${status.baseUrl}/chat/completions' \\\n  -H "Authorization: Bearer $WORKBUDDY_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"model":"auto","messages":[{"role":"user","content":"你好"}],"max_tokens":256}'`}</pre>
            <Button disabled={!!busy} onClick={() => copy("curl")}>
              复制示例
            </Button>
          </details>
          <p className="quiet-note">
            模型来源于当前地区的官方目录；获取模型会强制刷新，不发送对话。积分为零的账号会自动跳过，明确积分不足时切换同地区已选账号。输出
            Token 按本机上限截取；流中断后不会自动重发。
          </p>
          <details className="api-example">
            <summary>其他接口格式的地址</summary>
            <p>
              Responses：使用相同 Base URL，请求 <code>/responses</code>，设置{" "}
              <code>store:false</code> 并发送完整历史。
            </p>
            <p>
              Anthropic Messages：Base URL 填{" "}
              <code>{status.baseUrl.replace(/\/v1$/, "")}</code>，客户端会请求{" "}
              <code>/v1/messages</code>；同一密钥支持 Bearer 与 x-api-key。
            </p>
            <p>
              工具由调用客户端执行。暂不支持服务端托管工具、后台任务和
              previous_response_id；模型能力与官方账号权限一致。
            </p>
          </details>
        </section>
      </div>
      <section className="settings-card api-history">
        <SectionHeader
          title="最近请求"
          detail="仅保存最近 100 条请求元数据，不保存提示词、回复正文或凭据。"
        />
        {status.totals.unknownUsage > 0 && (
          <p className="quiet-note">
            {status.totals.unknownUsage} 次请求未返回完整 Token
            用量，未按文本长度估算。
          </p>
        )}
        {!status.recent.length ? (
          <p className="quiet-note">
            暂无请求。接入客户端或发送测试对话后会显示结果。
          </p>
        ) : (
          <div className="api-request-list">
            {status.recent.slice(0, 30).map((entry) => (
              <div className="api-request" key={entry.requestId}>
                <div>
                  <strong>{entry.model}</strong>
                  <small>
                    {date(entry.at, true)} ·{" "}
                    {status.accounts.find(
                      (account) =>
                        account.id === entry.accountId &&
                        account.provider === entry.provider,
                    )?.nickname || mask(entry.accountId, privacy)}
                  </small>
                </div>
                <span className={entry.status === "ok" ? "success" : "red"}>
                  {entry.status === "ok"
                    ? "成功"
                    : entry.status === "cancelled"
                      ? "已停止"
                      : "失败"}{" "}
                  · {entry.statusCode}
                </span>
                <small>
                  {number(entry.inputTokens)} / {number(entry.outputTokens)}{" "}
                  Token
                </small>
                <small>{number(entry.durationMs / 1000, 2)} s</small>
                {entry.errorCode && <code>{entry.errorCode}</code>}
              </div>
            ))}
          </div>
        )}
      </section>
      {rotate && (
        <Modal
          title="轮换 API Key"
          subtitle="原密钥会立即失效，已接入的客户端需要更新密钥。"
          onClose={() => !busy && setRotate(false)}
          footer={
            <>
              <Button disabled={!!busy} onClick={() => setRotate(false)}>
                取消
              </Button>
              <Button
                primary
                disabled={!!busy}
                onClick={() =>
                  void run(
                    "轮换密钥",
                    () => api.apiRotate(),
                    (value) => {
                      setStatus(value);
                      setRotate(false);
                      setMessage("密钥已轮换，请重新复制到客户端。");
                    },
                  )
                }
              >
                确认轮换
              </Button>
            </>
          }
        >
          <p>账号凭据和请求记录保持不变，新的 API Key 仍由本机系统加密保存。</p>
        </Modal>
      )}
    </div>
  );
}
