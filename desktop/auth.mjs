import { createHash } from "node:crypto";

const text = (value) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";

export function parseAuth(raw) {
  let root;
  try {
    root = JSON.parse(raw);
  } catch {
    throw new Error("WorkBuddy 登录信息不是有效的 JSON。");
  }
  const id = text(root?.account?.uid).trim();
  const token = text(root?.auth?.accessToken).trim();
  const wrapper = root?.auth?.accessToken;
  const protectedToken =
    !!wrapper &&
    typeof wrapper === "object" &&
    wrapper.$wbEncrypted === 1 &&
    typeof wrapper.envelope === "string" &&
    wrapper.envelope.length > 0;
  if (
    !id ||
    (!token && !protectedToken) ||
    id.length > 200 ||
    /[\x00-\x1f]/.test(id)
  )
    throw new Error("登录信息缺少账号或访问凭据，请先在 WorkBuddy 中登录。");
  const phone = text(root.account.phoneNumber);
  return {
    root,
    id,
    token,
    protectedToken,
    nickname: text(root.account.nickname) || "WorkBuddy 账号",
    accountType: text(root.account.accountType || root.account.type),
    phoneHint:
      phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "",
    tokenExpiresAt: tokenExpiry(root.auth),
    raw: JSON.stringify(root),
  };
}

function tokenExpiry(auth) {
  const value = Number(
    auth.expiresAt ?? auth.expireTime ?? auth.accessTokenExpiresAt,
  );
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 1e11 ? value * 1000 : value;
}

export function credentialKey(id) {
  return createHash("sha256").update(id).digest("hex");
}

// Keep machine-local metadata from the installed client, while replacing only
// the selected account and authentication material with the saved identity.
export function mergeAuth(currentRaw, targetRaw) {
  const target = parseAuth(targetRaw);
  if (!currentRaw) return target.raw;
  const current = parseAuth(currentRaw);
  const root = {
    ...current.root,
    account: target.root.account,
    auth: target.root.auth,
  };
  if (
    Array.isArray(current.root.allAccounts) ||
    Array.isArray(target.root.allAccounts)
  ) {
    const accounts = new Map();
    for (const item of [
      ...(current.root.allAccounts || []),
      ...(target.root.allAccounts || []),
      target.root.account,
    ]) {
      const id = text(item?.uid);
      if (id) accounts.set(id, item);
    }
    root.allAccounts = [...accounts.values()];
  }
  return JSON.stringify(root);
}
