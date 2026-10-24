import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Gift,
  LogOut,
  RefreshCw,
  Settings2,
  Users,
} from "lucide-react";
import appIcon from "../assets/icon.png";
import { Button, number, Status } from "./components";
import type { Snapshot, Provider } from "./types";
import { providerNames } from "./EditorAccounts";

export function TrayPanel() {
  const [state, setState] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const api = window.workbuddy;
  useEffect(() => {
    if (!api) return;
    let active = true;
    const reload = () => {
      void api
        .snapshot()
        .then((next) => {
          if (active) setState(next);
        })
        .catch((error: Error) => {
          if (active) setMessage(error.message);
        });
    };
    reload();
    const unsubscribe = api.onChange(reload);
    const timer = setInterval(reload, 15000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [api]);
  useEffect(() => {
    const mode = state?.settings.theme || "system",
      media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        mode === "system" ? (media.matches ? "dark" : "light") : mode;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state?.settings.theme]);
  async function run(action: () => Promise<unknown>) {
    if (busy || state?.busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      setState(await api.snapshot());
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const provider = state?.settings.activeProvider || "workbuddy";
  const editor = provider !== "workbuddy" ? state?.editors?.[provider] : null;
  const currentId =
    provider === "workbuddy" ? state?.current?.id : editor?.currentId;
  const accounts =
    provider === "workbuddy"
      ? state?.accounts || []
      : (editor?.accounts || []).map((account) => ({
          ...account,
          quota: null,
          quotaError: null,
        }));
  const client = provider === "workbuddy" ? state?.client : editor?.client;
  return (
    <main className="tray-panel" aria-label="菜单栏快捷面板">
      <header className="tray-heading">
        <img src={appIcon} alt="WorkBuddy Switch" />
        <select
          aria-label="快捷面板客户端"
          disabled={!state || busy || state.busy}
          value={provider}
          onChange={(event) =>
            void run(() =>
              api.saveSettings({
                ...state!.settings,
                activeProvider: event.target.value as Provider,
              }),
            )
          }
        >
          {Object.entries(providerNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="刷新菜单栏状态"
          disabled={busy || state?.busy}
          onClick={() =>
            void run(async () => {
              if (provider === "workbuddy") {
                await api.refreshQuotas();
                await api.refreshRewards();
              }
            })
          }
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <div className="tray-accounts">
        {accounts
          .slice()
          .sort((a, b) =>
            a.id === currentId
              ? -1
              : b.id === currentId
                ? 1
                : b.lastUsedAt - a.lastUsedAt,
          )
          .slice(0, 8)
          .map((account, index) => (
            <button
              className={`tray-account ${account.id === currentId ? "current" : ""}`}
              key={account.id}
              disabled={busy || state?.busy || editor?.recoveryPending}
              onClick={() =>
                void run(() =>
                  provider === "workbuddy"
                    ? api.traySwitch(account.id)
                    : api.traySwitchEditor(provider, account.id),
                )
              }
            >
              <span className="tray-account-icon">
                {account.id === currentId ? (
                  <Check size={15} />
                ) : (
                  <Users size={15} />
                )}
              </span>
              <span>
                {state?.settings.privacyMode
                  ? `账号 ${index + 1}`
                  : account.nickname}
              </span>
              {provider === "workbuddy" ? (
                <strong>
                  {account.quotaError ? "—" : number(account.quota?.remaining)}
                  <small>积分</small>
                </strong>
              ) : (
                <small>{account.id === currentId ? "匹配" : "切换"}</small>
              )}
            </button>
          ))}
        {!accounts.length && (
          <p className="tray-empty">{state ? "还没有保存账号" : "正在读取…"}</p>
        )}
      </div>
      {provider === "workbuddy" ? (
        <Button
          primary
          icon={Gift}
          busy={busy}
          disabled={state?.busy || !state?.accounts.length}
          onClick={() =>
            void run(async () => {
              const result = await api.claimRewards();
              setMessage(
                result.claimed
                  ? `已领取 ${result.claimed} 项${result.unknownAmounts ? "，部分金额未返回" : ` · +${number(result.credit, 4)} 积分`}${result.failed ? `，${result.failed} 项失败` : ""}`
                  : result.failed
                    ? "领取失败，请在积分页查看原因"
                    : "当前没有可领取的奖励",
              );
            })
          }
        >
          一键领积分
        </Button>
      ) : (
        <Button
          primary
          icon={Users}
          disabled={!state || busy || state.busy}
          onClick={() => void api.openPage("accounts")}
        >
          管理{providerNames[provider]}账号
        </Button>
      )}
      {message && (
        <div className="tray-message" role="status">
          {message}
        </div>
      )}
      <div className="tray-links">
        <button onClick={() => void api.openPage("accounts")}>
          <ExternalLink size={16} />
          打开主界面
        </button>
        <button onClick={() => void api.openPage("settings")}>
          <Settings2 size={16} />
          设置
        </button>
      </div>
      <footer className="tray-footer">
        <Status ok={client?.running === true}>
          {client?.running === true
            ? `${providerNames[provider]} 运行中`
            : client?.running === null
              ? "运行状态未知"
              : `${providerNames[provider]} 未运行`}
        </Status>
        <button
          className="icon-button"
          aria-label="退出 WorkBuddy Switch"
          title="退出"
          onClick={() => void api.quit()}
        >
          <LogOut size={15} />
        </button>
      </footer>
    </main>
  );
}
