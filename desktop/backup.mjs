import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { parseAuth } from "./auth.mjs";

export function encodeBackup(records, password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 512
  )
    throw new Error("备份密码应为 8–512 个字符。");
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    scryptSync(password, salt, 32),
    iv,
  );
  const payload = Buffer.concat([
    cipher.update(JSON.stringify({ records }), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify(
    {
      format: "workbuddy-switch-backup",
      version: 1,
      createdAt: Date.now(),
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      payload: payload.toString("base64"),
    },
    null,
    2,
  );
}

export function decodeBackup(raw, password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 512
  )
    throw new Error("备份密码应为 8–512 个字符。");
  if (raw.length > 8 * 1024 * 1024) throw new Error("备份文件过大。");
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("备份文件格式无效。");
  }
  if (envelope.format !== "workbuddy-switch-backup" || envelope.version !== 1)
    throw new Error("不支持的备份格式。");
  let data;
  try {
    const salt = Buffer.from(envelope.salt, "base64"),
      iv = Buffer.from(envelope.iv, "base64"),
      tag = Buffer.from(envelope.tag, "base64");
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16)
      throw new Error("invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      scryptSync(password, salt, 32),
      iv,
    );
    decipher.setAuthTag(tag);
    data = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.payload, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("密码不正确或备份已被修改。");
  }
  if (!Array.isArray(data.records) || data.records.length > 500)
    throw new Error("备份账号列表无效。");
  return data.records.map((record) => {
    const auth = parseAuth(record.raw);
    if (record.profile?.id !== auth.id) throw new Error("备份账号身份不一致。");
    return { raw: auth.raw, profile: record.profile };
  });
}
