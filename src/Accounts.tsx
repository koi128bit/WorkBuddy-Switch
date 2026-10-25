import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Ellipsis,
  Pin,
  Search,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { Button, Empty, mask, number } from "./components";
import { AccountTasks, CheckinStatus, type Claim, type Run } from "./Rewards";
import type { Account, Snapshot } from "./types";
import { accountHealth, suggestedAccount } from "./account-health";
import { apiFor } from "./providers";
import { creditSummary } from "./analytics";

const expiry = (value?: number | null) =>
  value ? new Date(value).toLocaleDateString("sv-SE") : "未提供";

export function Accounts({
  state,
  disabled,
  switchTo,
  edit,
  transfer,
  run,
  remove,
  selected,
  setSelected,
  claim,
}: {
  state: Snapshot;
  disabled: boolean;
  switchTo: (account: Account) => void;
  edit: (account: Account) => void;
  transfer: (mode: "import" | "export") => void;
  run: Run;
  remove: (account: Account) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  claim: Claim;
}) {
  const api = apiFor(state.settings.activeProvider);
  const rewards = state.settings.activeProvider === "workbuddy";
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("recent"),
    [filter, setFilter] = useState("all"),
    [openMenu, setOpenMenu] = useState(""),
    [inspected, setInspected] = useState(state.current?.id || "");
  useEffect(() => {
    if (!openMenu) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".card-menu")) setOpenMenu("");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu("");
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", key);
    };
  }, [openMenu]);
  const accounts = useMemo(
    () =>
      state.accounts
        .filter(
          (account) =>
            `${account.nickname} ${account.note} ${account.id}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (filter !== "favorites" || account.favorite) &&
            (filter !== "attention" ||
              accountHealth(account, state.settings).attention),
        )
        .sort((a, b) => {
          if (a.id === state.current?.id) return -1;
          if (b.id === state.current?.id) return 1;
          if (sort === "balance")
            return (b.quota?.remaining ?? -1) - (a.quota?.remaining ?? -1);
          if (sort === "expiry")
            return (
              (a.quota?.expiresAt ?? Infinity) -
              (b.quota?.expiresAt ?? Infinity)
            );
          return b.lastUsedAt - a.lastUsedAt;
        }),
    [state.accounts, state.current, state.settings, search, sort, filter],
  );
  const account =
    state.accounts.find((item) => item.id === inspected) ||
    state.accounts.find((item) => item.id === state.current?.id) ||
    accounts[0];
  const allSelected =
    accounts.length > 0 && accounts.every((item) => selected.includes(item.id));
  const valid = state.accounts.filter((item) => item.quota && !item.quotaError);
  const suggestion = suggestedAccount(state.accounts, state.settings);
  const health = account && accountHealth(account, state.settings);
  const attentionCount = state.accounts.filter(
    (item) => accountHealth(item, state.settings).attention,
  ).length;
  const toggleAll = () =>
    setSelected(
      allSelected
        ? selected.filter((id) => !accounts.some((item) => item.id === id))
        : [...new Set([...selected, ...accounts.map((item) => item.id)])],
    );
  const summary = creditSummary(state.accounts, state.settings);
  return (
    <>
      <div className="account-summary-strip" aria-label="账号积分摘要">
        <div>
          <small>可用积分合计</small>
          <strong>{summary.known ? number(summary.remaining) : "—"}</strong>
        </div>
        <div>
          <small>
            {state.settings.expiryWarningDays} 天内到期
            {summary.expiryUnknown ? " · 部分未知" : ""}
          </small>
          <strong className={summary.expiring ? "pending" : ""}>
            {summary.known && (summary.expiryKnown || !summary.expiryUnknown)
              ? number(summary.expiring)
              : "—"}
          </strong>
        </div>
        <div>
          <small>已查询账号</small>
          <strong>
            {summary.known}
            <span>/ {state.accounts.length}</span>
          </strong>
        </div>
        <div>
          <small>需关注</small>
          <strong>
            {attentionCount}
            <span>个账号</span>
          </strong>
        </div>
      </div>
      <div className="filter-toolbar">
        <div className="tabs">
          <button
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            全部账号<span>{state.accounts.length}</span>
          </button>
          <button
            className={filter === "favorites" ? "selected" : ""}
            onClick={() => setFilter("favorites")}
          >
            <Pin size={14} />
            已收藏
          </button>
          <button
            className={filter === "attention" ? "selected" : ""}
            onClick={() => setFilter("attention")}
          >
            需关注{attentionCount > 0 && <span>{attentionCount}</span>}
          </button>
        </div>
        <div className="toolbar-right">
          <div className="search">
            <Search size={15} />
            <input
              aria-label="搜索账号"
              placeholder="搜索账号、备注"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="账号排序"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="recent">最近使用</option>
            <option value="balance">积分余额</option>
            <option value="expiry">到期优先</option>
          </select>
        </div>
      </div>
      <section className="account-workspace">
        <div
          className="account-table"
          role="table"
          aria-label="已保存的 WorkBuddy 账号"
        >
          <div className="account-table-row table-heading" role="row">
            <input
              type="checkbox"
              aria-label="选择全部可见账号"
              checked={allSelected}
              disabled={!accounts.length || disabled}
              onChange={toggleAll}
            />
            <span>账号</span>
            <span>可用积分</span>
            <span>到期时间</span>
            <span>{rewards ? "今日签到" : "服务地区"}</span>
            <span>操作</span>
          </div>
          {accounts.map((item, index) => {
            const active = state.current?.id === item.id;
            const urgent =
              !!item.quota?.expiresAt &&
              item.quota.expiresAt - Date.now() <
                state.settings.expiryWarningDays * 86400000;
            return (
              <article
                key={item.id}
                role="row"
                className={`account-table-row account-card ${active ? "current-card" : ""} ${item.id === account?.id ? "inspected" : ""}`}
              >
                <input
                  type="checkbox"
                  aria-label={`选择${item.nickname}`}
                  checked={selected.includes(item.id)}
                  disabled={disabled}
                  onChange={() =>
                    setSelected(
                      selected.includes(item.id)
                        ? selected.filter((id) => id !== item.id)
                        : [...selected, item.id],
                    )
                  }
                />
                <button
                  className="account-cell"
                  onClick={() => setInspected(item.id)}
                  aria-label={`查看${item.nickname}`}
                  aria-pressed={item.id === account?.id}
                >
                  <span className={`account-initial color-${index % 4}`}>
                    {item.nickname.slice(0, 1)}
                  </span>
                  <span>
                    <h3>
                      {item.nickname}
                      {item.favorite && <Pin size={12} />}
                      {active && <span className="badge blue">当前</span>}
                      {suggestion?.id === item.id && (
                        <span className="badge">建议先用</span>
                      )}
                    </h3>
                    <small>
                      {mask(item.id, state.settings.privacyMode)}
                      {accountHealth(item, state.settings).renew
                        ? " · 凭据待续期"
                        : ""}
                    </small>
                  </span>
                </button>
                <div
                  className="table-balance"
                  title={
                    item.quotaError ||
                    (item.quota
                      ? `查询于 ${new Date(item.quota.fetchedAt).toLocaleString("zh-CN")}`
                      : "尚未查询")
                  }
                >
                  <strong>
                    {item.quotaError ? "—" : number(item.quota?.remaining)}
                  </strong>
                  {item.quota && !item.quotaError && (
                    <span
                      className="quota-mini-track"
                      aria-label={`剩余 ${item.quota.total ? Math.round(Math.min(1, item.quota.remaining / item.quota.total) * 100) : 0}%`}
                    >
                      <span
                        style={{
                          width: `${item.quota.total ? Math.min(100, Math.max(0, (item.quota.remaining / item.quota.total) * 100)) : 0}%`,
                        }}
                      />
                    </span>
                  )}
                  {item.quotaError && <small className="red">查询失败</small>}
                </div>
                <span className={urgent ? "pending" : "muted"}>
                  {expiry(item.quota?.expiresAt)}
                </span>
                {rewards ? (
                  <CheckinStatus account={item} />
                ) : (
                  <span className="muted">国际版</span>
                )}
                <div className="table-actions">
                  <Button
                    disabled={disabled || active}
                    onClick={() => switchTo(item)}
                  >
                    {active ? "使用中" : "切换"}
                  </Button>
                  <div className="card-menu">
                    <button
                      className="icon-button"
                      disabled={disabled}
                      aria-label={`${item.nickname}的更多操作`}
                      aria-expanded={openMenu === item.id}
                      onClick={() =>
                        setOpenMenu(openMenu === item.id ? "" : item.id)
                      }
                    >
                      <Ellipsis size={18} />
                    </button>
                    {openMenu === item.id && (
                      <div className="dropdown">
                        <button
                          onClick={() => {
                            edit(item);
                            setOpenMenu("");
                          }}
                        >
                          编辑名称与备注
                        </button>
                        <button
                          onClick={() => {
                            void run("更新收藏", () =>
                              api.editAccount(item.id, {
                                favorite: !item.favorite,
                              }),
                            );
                            setOpenMenu("");
                          }}
                        >
                          {item.favorite ? "取消收藏" : "收藏账号"}
                        </button>
                        <button
                          onClick={() => {
                            void run("刷新账号", async () => {
                              await api.refreshQuotas(item.id);
                              if (rewards) await api.refreshRewards([item.id]);
                            });
                            setOpenMenu("");
                          }}
                        >
                          刷新这个账号
                        </button>
                        {rewards && (
                          <button
                            onClick={() => {
                              claim([item.id]);
                              setOpenMenu("");
                            }}
                          >
                            领取此账号积分
                          </button>
                        )}
                        <button
                          className="red"
                          onClick={() => {
                            remove(item);
                            setOpenMenu("");
                          }}
                        >
                          移除账号
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!accounts.length && (
            <Empty
              icon={Users}
              title={
                search || filter === "favorites"
                  ? "没有匹配的账号"
                  : "添加你的第一个账号"
              }
              detail="通过官方网页登录添加，或保存 WorkBuddy 当前账号。"
            />
          )}
        </div>
        <div className="account-table-caption">
          <span>已选 {selected.length} 个账号</span>
          <span>
            {valid.length
              ? `可用积分合计 ${number(valid.reduce((sum, item) => sum + item.quota!.remaining, 0))} · ${valid.length}/${state.accounts.length} 个账号查询成功`
              : "点击刷新查询官方积分状态"}
          </span>
        </div>
        {account && (
          <div className="account-inspector">
            <div className="inspector-identity">
              <span className="account-initial">
                {account.nickname.slice(0, 1)}
              </span>
              <div>
                <h3>{account.nickname}</h3>
                <small>{mask(account.id, state.settings.privacyMode)}</small>
                {account.note && <p title={account.note}>{account.note}</p>}
              </div>
            </div>
            <div className="inspector-balance">
              <span>可用积分</span>
              <strong>
                {account.quotaError ? "—" : number(account.quota?.remaining)}
                <small>积分</small>
              </strong>
            </div>
            {rewards && (
              <AccountTasks
                key={account.id}
                account={account}
                disabled={disabled}
                run={run}
                claim={claim}
                compact
              />
            )}
            {account.quotaError && (
              <p className="inspector-error">{account.quotaError}</p>
            )}
          </div>
        )}
        {account?.quota && !account.quotaError && (
          <div className="quota-breakdown">
            <div className="quota-breakdown-heading">
              <strong>积分包明细</strong>
              <span>
                {health && health.expiringCredits > 0
                  ? `${number(health.expiringCredits)} 积分将在 ${state.settings.expiryWarningDays} 天内到期`
                  : "按官方积分包显示"}
              </span>
            </div>
            {account.quota.resources
              .filter((resource) => !resource.expired && resource.remaining > 0)
              .map((resource) => (
                <div className="quota-resource" key={resource.id}>
                  <span>{resource.name || "积分包"}</span>
                  <strong>{number(resource.remaining)}</strong>
                  <span
                    className={
                      resource.expiresAt &&
                      resource.expiresAt <=
                        Date.now() + state.settings.expiryWarningDays * 86400000
                        ? "pending"
                        : "muted"
                    }
                  >
                    {expiry(resource.expiresAt)}
                  </span>
                </div>
              ))}
            <small className="muted">
              查询于 {new Date(account.quota.fetchedAt).toLocaleString("zh-CN")}{" "}
              · 建议仅依据最近 6 小时内查询成功的临期积分
            </small>
          </div>
        )}
      </section>
      <div className="account-transfer">
        <span>
          <ShieldCheck size={15} />
          账号在本机加密保存
        </span>
        <div>
          <Button
            icon={Upload}
            disabled={disabled}
            onClick={() => transfer("import")}
          >
            导入备份
          </Button>
          <Button
            icon={ArrowDownToLine}
            disabled={disabled || !state.accounts.length}
            onClick={() => transfer("export")}
          >
            导出备份
          </Button>
        </div>
      </div>
    </>
  );
}
