import { useEffect, useState } from "react";
import {
  FolderOpen,
  History,
  Monitor,
  Pin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Globe,
} from "lucide-react";
import { Button, Empty, Modal, Status } from "./components";
import { apiFor, providerNames, providers } from "./providers";
import { LoginModal } from "./LoginModal";
import type {
  EditorAccount,
  EditorProvider,
  EditorSnapshot,
  Settings,
} from "./types";

type Run = (
  label: string,
  action: () => Promise<unknown>,
  success?: string,
) => Promise<void>;

export function EditorPaths({
  provider,
  state,
  settings,
  disabled,
  run,
}: {
  provider: EditorProvider;
  state?: EditorSnapshot;
  settings: Settings;
  disabled: boolean;
  run: Run;
}) {
  const prefix = providers[provider].key;
  const dataKey = `${prefix}DataPath` as const,
    executableKey = `${prefix}ExecutablePath` as const;
  const [dataPath, setDataPath] = useState(settings[dataKey]);
  const [executablePath, setExecutablePath] = useState(settings[executableKey]);
  const name = providerNames[provider];
  return (
    <details className="editor-paths">
      <summary>{name} 路径配置</summary>
      <p className="quiet-note">
        自动查找对应地区的安装位置。数据根目录名称为 {providers[provider].data}
        。
      </p>
      {(
        [
          {
            kind: "executable",
            label: "应用",
            value: executablePath,
            set: setExecutablePath,
            placeholder: state?.client.executable || "自动查找客户端应用",
          },
          {
            kind: "data",
            label: "数据根目录",
            value: dataPath,
            set: setDataPath,
            placeholder: state?.dataPath || "自动查找客户端数据",
          },
        ] as const
      ).map((item) => (
        <label className="path-field" key={item.kind}>
          {name} {item.label}
          <div>
            <input
              aria-label={`${name} ${item.label}`}
              placeholder={item.placeholder}
              value={item.value}
              onChange={(event) => item.set(event.target.value)}
            />
            <Button
              disabled={disabled}
              icon={FolderOpen}
              onClick={() =>
                void run("选择路径", async () => {
                  const result = await window.workbuddy.chooseEditorPath(
                    provider,
                    item.kind,
                  );
                  if (result) item.set(result);
                })
              }
            >
              选择
            </Button>
          </div>
        </label>
      ))}
      <div className="path-actions">
        <Button
          disabled={disabled}
          onClick={() => {
            setDataPath("");
            setExecutablePath("");
          }}
        >
          恢复自动发现
        </Button>
        <Button
          primary
          disabled={disabled}
          onClick={() =>
            void run(
              "保存路径",
              () =>
                window.workbuddy.saveSettings({
                  ...settings,
                  [dataKey]: dataPath,
                  [executableKey]: executablePath,
                }),
              "路径配置已保存",
            )
          }
        >
          保存{name}路径
        </Button>
      </div>
    </details>
  );
}

export function EditorAccounts({
  provider,
  state,
  settings,
  disabled,
  run,
}: {
  provider: EditorProvider;
  state?: EditorSnapshot;
  settings: Settings;
  disabled: boolean;
  run: Run;
}) {
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: "capture" | "edit" | "switch" | "remove" | "restore" | "keep";
    account?: EditorAccount;
  } | null>(null);
  const [nickname, setNickname] = useState("");
  const [note, setNote] = useState("");
  const [login, setLogin] = useState<{ id: string; expiresAt: number } | null>(
    null,
  );
  const name = providerNames[provider],
    api = apiFor(provider);
  useEffect(
    () => () => {
      if (login) void api.cancelLogin(login.id).catch(() => {});
    },
    [login, api],
  );
  const accounts = (state?.accounts || [])
    .filter(
      (account) =>
        `${account.nickname} ${account.note} ${account.uid || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!favorites || account.favorite),
    )
    .sort((a, b) =>
      a.id === state?.currentId
        ? -1
        : b.id === state?.currentId
          ? 1
          : b.lastUsedAt - a.lastUsedAt,
    );
  const open = (kind: "capture" | "edit", account?: EditorAccount) => {
    setNickname(
      account?.nickname || `${name} 账号 ${(state?.accounts.length || 0) + 1}`,
    );
    setNote(account?.note || "");
    setDialog({ kind, account });
  };
  const confirm = async () => {
    if (!dialog) return;
    await run(
      "处理登录快照",
      async () => {
        if (dialog.kind === "capture")
          await api.captureEditor(provider, nickname);
        else if (dialog.kind === "edit")
          await api.editEditor(provider, dialog.account!.id, {
            nickname,
            note,
          });
        else if (dialog.kind === "switch")
          await api.switchEditor(provider, dialog.account!.id);
        else if (dialog.kind === "remove")
          await api.removeEditor(provider, dialog.account!.id);
        else if (dialog.kind === "keep") await api.keepCurrentEditor(provider);
        else await api.restoreEditor(provider);
        setDialog(null);
      },
      dialog.kind === "switch"
        ? "本机登录快照已恢复，请在客户端确认登录状态"
        : "操作已完成",
    );
  };
  return (
    <>
      <div className="editor-intro">
        <div>
          <Status ok={state?.client.installed === true}>
            {state?.client.installed ? `${name} 已发现` : `未找到 ${name}`}
          </Status>
          <p>
            {state?.currentId
              ? "当前文件与已保存快照匹配"
              : state?.hasLogin
                ? "检测到本机登录文件，可保存为账号快照"
                : "网页登录添加账号，或读取客户端当前身份"}
          </p>
        </div>
        <div className="toolbar-right">
          <Button
            icon={Monitor}
            disabled={disabled}
            onClick={() =>
              void run(`打开 ${name}`, () => api.launchEditor(provider))
            }
          >
            打开{name}
          </Button>
          <Button
            icon={RefreshCw}
            disabled={disabled}
            onClick={() => void run("刷新状态", () => api.snapshot())}
          >
            刷新
          </Button>
          <Button
            icon={Globe}
            disabled={disabled || !!login}
            onClick={() =>
              void run("发起网页登录", async () =>
                setLogin(await api.startLogin()),
              )
            }
          >
            网页登录
          </Button>
          <Button
            primary
            icon={Plus}
            disabled={disabled || !state?.hasLogin}
            onClick={() => open("capture")}
          >
            保存当前账号
          </Button>
        </div>
      </div>
      <div className="notice info">
        <ShieldCheck size={17} />
        <span>
          支持识别真实账号与刷新授权。首次切换前，请在客户端登录并保存当前账号，关联完整登录资料。客户端登录快照仅在本机使用。
        </span>
      </div>
      {state?.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      {state?.recoveryPending && (
        <div className="notice warn">
          <History size={17} />
          <span>有一次未完成的切换，已保留加密恢复记录。</span>
          <Button
            disabled={disabled}
            onClick={() => setDialog({ kind: "restore" })}
          >
            恢复切换前登录
          </Button>
          <Button
            disabled={disabled}
            onClick={() => setDialog({ kind: "keep" })}
          >
            保留当前登录并归档
          </Button>
        </div>
      )}
      <div className="filter-toolbar">
        <div className="tabs">
          <button
            className={!favorites ? "selected" : ""}
            onClick={() => setFavorites(false)}
          >
            全部账号<span>{state?.accounts.length || 0}</span>
          </button>
          <button
            className={favorites ? "selected" : ""}
            onClick={() => setFavorites(true)}
          >
            <Pin size={14} />
            已收藏
          </button>
        </div>
        <div className="search">
          <Search size={15} />
          <input
            aria-label={`搜索${name}账号`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索账号、备注"
          />
        </div>
      </div>
      <section
        className="account-workspace editor-workspace"
        aria-label={`${name} 登录快照`}
      >
        <div className="editor-table-row table-heading">
          <span>账号</span>
          <span>保存时间</span>
          <span>操作</span>
        </div>
        {accounts.map((account, index) => (
          <article
            className={`editor-table-row ${account.id === state?.currentId ? "current-card" : ""}`}
            key={account.id}
          >
            <div className="editor-identity">
              <span className="account-initial">
                {settings.privacyMode
                  ? index + 1
                  : account.nickname.slice(0, 1)}
              </span>
              <div>
                <h3>
                  {account.nickname}
                  {account.favorite && <Pin size={12} />}{" "}
                  {account.id === state?.currentId && (
                    <span className="badge blue">当前快照</span>
                  )}
                </h3>
                <small className="muted">
                  {account.note ||
                    (account.uid
                      ? `${settings.privacyMode ? "已识别账号" : `UID ${account.uid}`} · ${account.nativeAvailable === false ? "待关联客户端登录" : "可切换"}`
                      : account.automatic
                        ? "切换前自动保存，可用于恢复"
                        : "本机加密保存")}
                </small>
                {account.expiresAt && (
                  <small className="muted">
                    授权到期{" "}
                    {new Date(account.expiresAt).toLocaleString("zh-CN")}
                  </small>
                )}
                {account.identityError && (
                  <small className="muted">{account.identityError}</small>
                )}
              </div>
            </div>
            <span className="muted">
              {new Date(account.capturedAt).toLocaleDateString("zh-CN")}
            </span>
            <div className="table-actions">
              <Button
                disabled={
                  disabled ||
                  account.id === state?.currentId ||
                  state?.recoveryPending ||
                  account.nativeAvailable === false
                }
                onClick={() => setDialog({ kind: "switch", account })}
              >
                切换
              </Button>
              {account.canRefresh && (
                <Button
                  icon={RefreshCw}
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      "刷新授权",
                      () => api.refreshEditor(provider, account.id),
                      "授权已刷新，客户端登录资料保留",
                    )
                  }
                >
                  续期
                </Button>
              )}
              <button
                className="icon-button"
                aria-label={`${account.favorite ? "取消收藏" : "收藏"}${account.nickname}`}
                disabled={disabled}
                onClick={() =>
                  void run("更新收藏", () =>
                    api.editEditor(provider, account.id, {
                      favorite: !account.favorite,
                    }),
                  )
                }
              >
                <Pin
                  size={15}
                  fill={account.favorite ? "currentColor" : "none"}
                />
              </button>
              <Button disabled={disabled} onClick={() => open("edit", account)}>
                编辑
              </Button>
              <button
                className="icon-button"
                aria-label={`移除${account.nickname}`}
                disabled={disabled}
                onClick={() => setDialog({ kind: "remove", account })}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
        {!accounts.length && (
          <Empty
            icon={Users}
            title={
              search || favorites
                ? "没有匹配的账号"
                : `保存你的第一个 ${name} 账号`
            }
            detail={`先在 ${name} 登录账号 A 并保存，再登录账号 B 并保存，即可在这里切换。`}
          />
        )}
      </section>
      {login && (
        <LoginModal
          ticket={login}
          provider={provider}
          close={() => {
            void api.cancelLogin(login.id);
            setLogin(null);
          }}
          complete={() => {
            setLogin(null);
            void run("更新账号", () => api.snapshot());
          }}
        />
      )}
      <EditorPaths
        key={provider}
        provider={provider}
        state={state}
        settings={settings}
        disabled={disabled}
        run={run}
      />
      {dialog && (
        <Modal
          title={
            dialog.kind === "capture"
              ? `保存 ${name} 当前账号`
              : dialog.kind === "edit"
                ? "编辑账号快照"
                : dialog.kind === "switch"
                  ? `切换 ${name} 账号`
                  : dialog.kind === "remove"
                    ? "移除登录快照"
                    : dialog.kind === "keep"
                      ? "保留当前登录"
                      : "恢复切换前登录"
          }
          onClose={() => !disabled && setDialog(null)}
          footer={
            <>
              <Button disabled={disabled} onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                primary={dialog.kind !== "remove"}
                danger={dialog.kind === "remove"}
                disabled={
                  disabled ||
                  (["capture", "edit"].includes(dialog.kind) &&
                    !nickname.trim())
                }
                onClick={() => void confirm()}
              >
                {dialog.kind === "switch"
                  ? "切换账号"
                  : dialog.kind === "remove"
                    ? "移除快照"
                    : dialog.kind === "restore"
                      ? "恢复登录"
                      : dialog.kind === "keep"
                        ? "保留并归档"
                        : "保存快照"}
              </Button>
            </>
          }
        >
          {dialog.kind === "capture" || dialog.kind === "edit" ? (
            <>
              <p className="quiet-note">
                请确认 {name} 中显示的是要保存的账号。优先识别真实
                UID；格式暂不支持时仍可按名称保留兼容快照。
              </p>
              <label className="form-field">
                账号名称
                <input
                  value={nickname}
                  maxLength={80}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
              {dialog.kind === "edit" && (
                <label className="form-field">
                  备注
                  <textarea
                    value={note}
                    maxLength={300}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              )}
            </>
          ) : (
            <p className="confirmation-copy">
              {dialog.kind === "switch"
                ? `将正常退出 ${name}，保存切换前登录并恢复「${dialog.account?.nickname}」。请先结束客户端中正在运行的任务。`
                : dialog.kind === "remove"
                  ? `只移除「${dialog.account?.nickname}」的本地快照，客户端当前登录与数据保留。`
                  : dialog.kind === "keep"
                    ? "保留当前客户端的登录文件，存在登录凭据时先加密保存为快照，再将旧恢复记录归档保留。之后可以继续切换账号。"
                    : `将正常退出 ${name} 并恢复上次切换前的登录。恢复记录会在检查通过后移除。`}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
