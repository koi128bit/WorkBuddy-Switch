import {
  createHash,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
const TC_HEADER = Buffer.from("746305100000", "hex");
const MAX = 8 * 1024 * 1024;
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractTraePeppers(source) {
  if (typeof source !== "string" || source.length > 128 * 1024 * 1024)
    throw new Error("客户端版本文件过大或无法识别。");
  const pattern =
    /\.AES_PRIVATE\b[\s\S]{0,300}?(?<pa>[$\w]+)\[(?<pi>[$\w]+)\]\s*\^\s*(?<pb>[$\w]+)\[\k<pi>\][\s\S]{0,90}?else\s+if\s*\([^)]*\.AES\b[^)]*\)[\s\S]{0,300}?(?<a>[$\w]+)\[(?<i>[$\w]+)\]\s*\^\s*(?<b>[$\w]+)\[\k<i>\]/g;
  const candidates = [];
  for (const match of source.matchAll(pattern)) {
    const nearby = source.slice(
      Math.max(0, match.index - 16384),
      match.index + 16384,
    );
    const bytes = (name) => {
      const declarations = [
        ...nearby.matchAll(
          new RegExp(
            `(?:^|[^\\w$])${escape(name)}\\s*=\\s*(?:new\\s+Uint8Array|Uint8Array\\.from)\\s*\\(\\s*\\[([^\\]]{1,1300})\\]\\s*\\)`,
            "g",
          ),
        ),
      ];
      if (declarations.length !== 1 || !/^[\d,\s]+$/.test(declarations[0][1]))
        throw new Error("无法识别客户端加密常量。");
      const values = declarations[0][1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map(Number);
      if (
        values.length !== 64 ||
        values.some(
          (value) => !Number.isInteger(value) || value < 0 || value > 255,
        )
      )
        throw new Error("客户端加密常量格式无效。");
      return Buffer.from(values);
    };
    const xor = (left, right) => {
      const a = bytes(left),
        b = bytes(right);
      return Buffer.from(a.map((value, index) => value ^ b[index]));
    };
    candidates.push({
      aes: xor(match.groups.a, match.groups.b),
      private: xor(match.groups.pa, match.groups.pb),
    });
  }
  if (
    !candidates.length ||
    new Set(
      candidates.map(
        (value) => value.aes.toString("hex") + value.private.toString("hex"),
      ),
    ).size !== 1
  )
    throw new Error(
      "无法识别当前 Trae 版本的登录格式，请使用网页登录或兼容快照。",
    );
  return candidates[0];
}
function tcKey(salt, pepper) {
  if (!Buffer.isBuffer(pepper) || pepper.length !== 64)
    throw new Error("Trae 格式密钥无效。");
  const first = createHash("sha512").update(salt).digest();
  const second = createHash("sha512").update(first).update(pepper).digest();
  return { key: second.subarray(0, 16), iv: second.subarray(16, 32) };
}
export function decryptTrae(raw, pepper) {
  try {
    if (
      typeof raw !== "string" ||
      raw.length > MAX ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)
    )
      throw new Error("invalid");
    const envelope = Buffer.from(raw, "base64");
    if (
      envelope.length < 54 ||
      !envelope.subarray(0, 6).equals(TC_HEADER) ||
      (envelope.length - 38) % 16 !== 0
    )
      throw new Error("invalid");
    const { key, iv } = tcKey(envelope.subarray(6, 38), pepper);
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    const plain = Buffer.concat([
      decipher.update(envelope.subarray(38)),
      decipher.final(),
    ]);
    if (
      plain.length <= 64 ||
      !timingSafeEqual(
        plain.subarray(0, 64),
        createHash("sha512").update(plain.subarray(64)).digest(),
      )
    )
      throw new Error("integrity");
    const value = JSON.parse(plain.subarray(64).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid");
    return value;
  } catch {
    throw new Error("Trae 登录格式或完整性校验失败，原文件未修改。");
  }
}
export function encryptTrae(value, pepper) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > MAX) throw new Error("登录资料过大。");
  const salt = randomBytes(32),
    { key, iv } = tcKey(salt, pepper),
    cipher = createCipheriv("aes-128-cbc", key, iv);
  const plain = Buffer.concat([
    createHash("sha512").update(data).digest(),
    data,
  ]);
  return Buffer.concat([
    TC_HEADER,
    salt,
    cipher.update(plain),
    cipher.final(),
  ]).toString("base64");
}
function chromiumKey(options, version) {
  if (options.platform === "win32") {
    if (!Buffer.isBuffer(options.key) || options.key.length !== 32)
      throw new Error("系统凭据密钥无效。");
    return options.key;
  }
  if (!["darwin", "linux"].includes(options.platform))
    throw new Error("不支持的系统凭据格式。");
  if (typeof options.password !== "string" || !options.password)
    throw new Error("客户端系统凭据不可用。");
  return pbkdf2Sync(
    options.password,
    "saltysalt",
    options.platform === "darwin" ? 1003 : 1,
    16,
    "sha1",
  );
}
export function decryptChromium(bytes, options) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX)
      throw new Error("invalid");
    const version = bytes.toString("ascii", 0, 3);
    if (
      !["v10", "v11"].includes(version) ||
      (options.platform !== "linux" && version !== "v10")
    )
      throw new Error("invalid");
    const key = chromiumKey(options, version);
    if (options.platform === "win32") {
      if (bytes.length < 31) throw new Error("invalid");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(3, 15),
      );
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([
        decipher.update(bytes.subarray(15, -16)),
        decipher.final(),
      ]).toString("utf8");
    }
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    return Buffer.concat([
      decipher.update(bytes.subarray(3)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "无法解密客户端登录状态，请解锁该客户端的系统凭据或重新网页登录。",
    );
  }
}
export function encryptChromium(raw, options) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX)
    throw new Error("登录资料过大或格式无效。");
  const version =
    options.version || (options.platform === "linux" ? "v11" : "v10");
  if (
    !["v10", "v11"].includes(version) ||
    (options.platform !== "linux" && version !== "v10")
  )
    throw new Error("不支持的客户端加密版本。");
  const key = chromiumKey(options, version);
  if (options.platform === "win32") {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    return Buffer.concat([
      Buffer.from(version),
      nonce,
      cipher.update(raw, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  }
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  return Buffer.concat([
    Buffer.from(version),
    cipher.update(raw, "utf8"),
    cipher.final(),
  ]);
}
const text = (value) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
const validId = (value) => {
  const result = text(value).trim();
  if (!result || result.length > 200 || /[\x00-\x1f]/.test(result))
    throw new Error("登录资料缺少有效账号身份。");
  return result;
};
export function jwtClaims(token) {
  try {
    const part = token.split(".")[1];
    if (!part || part.length > 100000) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
export function expiry(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value < 1e11 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
export function parseQoderIdentity(payload) {
  const user = payload?.user || {};
  const uid = validId(
    user.id ??
      user.user_id ??
      user.uid ??
      payload?.uid ??
      payload?.user_id ??
      payload?.userId,
  );
  const token = text(
    payload.token ?? payload.accessToken ?? payload.access_token,
  );
  if (!token) throw new Error("Qoder 登录资料缺少访问凭据。");
  return {
    uid,
    nickname:
      text(user.name ?? user.nickname ?? payload.nickname) || "Qoder 账号",
    token,
    refreshToken: text(payload.refreshToken ?? payload.refresh_token),
    expiresAt: expiry(payload.expiresAt ?? payload.expires_at),
    user,
  };
}
export function parseTraeIdentity(payload) {
  const token = text(payload?.token),
    claims = jwtClaims(token),
    claimId = text(claims?.data?.id);
  const uid = validId(payload?.userId || claimId);
  if (claimId && claimId !== uid)
    throw new Error("Trae 账号身份与访问凭据不一致。");
  if (!token) throw new Error("Trae 登录资料缺少访问凭据。");
  const account = payload.account || {};
  return {
    uid,
    nickname:
      text(
        account.name ??
          account.screenName ??
          account.ScreenName ??
          account.nickname ??
          claims?.data?.name,
      ) || "Trae 账号",
    token,
    refreshToken: text(payload.refreshToken),
    expiresAt: expiry(payload.expiredAt) ?? expiry(claims?.exp),
    user: account,
  };
}
