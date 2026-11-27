import { useEffect, useState } from "react";
import { Copy, KeyRound, Play, RefreshCw, Square } from "lucide-react";
import { Button, SectionHeader } from "./components";
import type { ApiStatus, QwenWorkApiMode } from "./types";

export function QwenWorkApiPage() {
  const api = window.workbuddy;
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [mode, setMode] = useState<QwenWorkApiMode>("compatible");
  const [port, setPort] = useState("4021");
  const [listenerPort, setListenerPort] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalog, setCatalog] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    let version = 0;
    let initialized = false;
    const refresh = async () => {
      const revision = ++version;
      try {
        const next = await api.apiStatus();
        if (!alive || revision !== version) return;
        setStatus(next);
        if (!initialized) {
          setMode(next.qwenwork.mode);
          setPort(String(next.qwenwork.port));
          setListenerPort(String(next.config.port));
          initialized = true;
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    void refresh();
    const unsubscribe = api.onChange(() => void refresh());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!status)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "正在读取千问办公 API 设置…"}
      </p>
    );
  const upstream = status.qwenwork;
  const address = status.baseUrl.replace(/\/v1$/, "/qwenwork/v1");
  const dirtyPort = Number(listenerPort) !== status.config.port;
  const dirtyUpstream =
    key.length > 0 ||
    mode !== upstream.mode ||
    (mode === "compatible" && Number(port) !== upstream.port);
  const copy = (kind: "qwenworkUrl" | "key") =>
    void run(async () => {
      await api.apiCopy(kind);
      setNotice(
        kind === "key" ? "本机 API Key 已复制。" : "千问办公地址已复制。",
      );
    });
  return (
    <div className="api-page">
      <section className="settings-card api-config">
        <SectionHeader
          title="千问办公上游"
          detail="转发使用此处配置的授权。桌面账号在账号页单独切换。"
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setStatus(
                await api.apiSaveQwenWork({
                  mode,
                  port: Number(port),
                  key: key.trim(),
                }),
              );
              setKey("");
              setCatalog(null);
              setNotice("上游配置已加密保存。");
            });
          }}
        >
          <fieldset disabled={busy}>
            <div className="api-fields">
              <label>
                上游类型
                <select
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as QwenWorkApiMode);
                    setKey("");
                  }}
                >
                  <option value="compatible">qwenwork2api · OpenAI 兼容</option>
                  <option value="official">千问办公开放平台 · 云端会话</option>
                </select>
              </label>
              {mode === "compatible" && (
                <label>
                  本机 qwenwork2api 端口
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    required
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                </label>
              )}
              <label>
                {mode === "compatible"
                  ? "上游 API Key"
                  : "开放平台用户访问令牌"}
                <input
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={8192}
                  value={key}
                  placeholder={
                    upstream.configured && mode === upstream.mode
                      ? "已保存，输入新密钥可替换"
                      : "输入上游凭据"
                  }
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
            </div>
            <p className="quiet-note">
              {mode === "compatible"
                ? "先在本机启动 qwenwork2api，在其控制台创建 API Key。此模式提供模型列表与流式或非流式 Chat Completions。"
                : "使用与应用绑定的 oauth_app 用户令牌。请求发送到 openapi.qwenwork.cn，支持执行模式、创建云端会话、发送提示和读取事件。"}
            </p>
            <div className="api-actions">
              <Button type="submit" primary disabled={!key.trim()}>
                保存上游
              </Button>
              {upstream.configured && (
                <Button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      setStatus(await api.apiSaveQwenWork(null));
                      setKey("");
                      setCatalog(null);
                      setMode("compatible");
                      setPort("4021");
                      setNotice("千问办公上游已断开。");
                    })
                  }
                >
                  断开上游
                </Button>
              )}
            </div>
          </fieldset>
        </form>
      </section>
      <section className="settings-card api-service api-config">
        <div className="api-service-heading">
          <div>
            <h2>本机 API 服务</h2>
            <p>
              <span className={"api-dot " + (status.running ? "on" : "")} />
              {status.running ? "运行中" : "已停止"} ·{" "}
              {upstream.configured
                ? "已配置千问办公上游"
                : "待配置千问办公上游"}
            </p>
          </div>
          <Button
            primary={!status.running}
            icon={status.running ? Square : Play}
            disabled={
              busy ||
              (!status.running &&
                (!upstream.configured ||
                  !status.hasKey ||
                  dirtyPort ||
                  dirtyUpstream))
            }
            onClick={() =>
              void run(async () => {
                setStatus(
                  await (status.running ? api.apiStop() : api.apiStart()),
                );
              })
            }
          >
            {status.running ? "停止共享服务" : "启动服务"}
          </Button>
        </div>
        <div className="api-connection-row">
          <div>
            <small>Base URL</small>
            <code>{address}</code>
          </div>
          <div className="api-actions">
            <Button
              icon={Copy}
              disabled={busy}
              onClick={() => copy("qwenworkUrl")}
            >
              复制地址
            </Button>
            <Button
              icon={KeyRound}
              disabled={busy || !status.hasKey}
              onClick={() => copy("key")}
            >
              复制本机 API Key
            </Button>
          </div>
        </div>
        <p className="quiet-note">
          千问办公地址仅接受本机请求。服务的监听端口、启停和本机 API Key 与
          WorkBuddy 共用。
        </p>
        {!status.running && (
          <div className="api-connection-row">
            <label>
              本机监听端口
              <input
                type="number"
                min={1024}
                max={65535}
                value={listenerPort}
                onChange={(event) => setListenerPort(event.target.value)}
              />
            </label>
            <Button
              disabled={busy || !dirtyPort}
              onClick={() =>
                void run(async () => {
                  setStatus(
                    await api.apiSave({
                      ...status.config,
                      port: Number(listenerPort),
                    }),
                  );
                })
              }
            >
              保存端口
            </Button>
          </div>
        )}
        {upstream.configured && (
          <Button
            icon={RefreshCw}
            disabled={busy || !status.running || dirtyUpstream}
            onClick={() =>
              void run(async () => {
                setCatalog(null);
                setCatalog(await api.qwenworkCatalog());
              })
            }
          >
            {upstream.mode === "compatible" ? "获取模型" : "获取执行模式"}
          </Button>
        )}
        {catalog && (
          <p className="quiet-note" role="status">
            {catalog.length ? catalog.join(" · ") : "上游返回的目录为空。"}
          </p>
        )}
      </section>
      {(error || upstream.error || status.lastError) && (
        <p className="api-notice red" role="alert">
          {error || upstream.error || status.lastError}
        </p>
      )}
      {notice && (
        <p className="api-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
