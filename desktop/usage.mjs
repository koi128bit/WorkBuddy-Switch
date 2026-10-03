import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

const nonnegative = (v) =>
  Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0;
const max = (...v) => Math.max(0, ...v.map(nonnegative));
const sum = (v, key) =>
  Array.isArray(v) ? v.reduce((n, item) => n + nonnegative(item?.[key]), 0) : 0;
export const emptyTokens = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  requests: 0,
  total: 0,
});

export function parseUsage(line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !(
      (row.type === "message" && row.role === "assistant") ||
      row.type === "function_call"
    ) ||
    !row.sessionId ||
    !(Number(row.timestamp) > 0) ||
    !Number.isFinite(Number(row.timestamp)) ||
    !Number.isFinite(new Date(Number(row.timestamp)).getTime())
  )
    return null;
  const p = row.providerData;
  if (!p || (!p.rawUsage && !p.usage)) return null;
  const r = p.rawUsage ?? {},
    u = p.usage ?? {};
  const hit = max(
    r.prompt_cache_hit_tokens,
    r.cache_read_input_tokens,
    r.cached_tokens,
    r.prompt_tokens_details?.cached_tokens,
    sum(u.inputTokensDetails, "cached_tokens"),
  );
  const write = max(
    r.cache_creation_input_tokens,
    r.prompt_cache_write_tokens,
    r.cache_write_input_tokens,
  );
  const prompt = Math.max(
    max(r.prompt_tokens, u.inputTokens),
    hit + Math.max(max(r.prompt_cache_miss_tokens), write),
  );
  const output = max(r.completion_tokens, u.outputTokens);
  if (prompt + output === 0) return null;
  const cacheRead = Math.min(hit, prompt),
    cacheWrite = Math.min(write, prompt - cacheRead);
  const id =
    row.uuid ??
    row.messageId ??
    row.id ??
    createHash("sha256").update(line).digest("hex");
  return {
    key: `${row.sessionId}:${id}`,
    sessionId: String(row.sessionId),
    timestamp: Number(row.timestamp),
    model: String(p.model ?? "auto").slice(0, 160),
    tokens: {
      input: prompt - cacheRead - cacheWrite,
      output,
      cacheRead,
      cacheWrite,
      reasoning: Math.min(
        max(
          r.completion_thinking_tokens,
          r.completion_tokens_details?.reasoning_tokens,
          sum(u.outputTokensDetails, "reasoning_tokens"),
        ),
        output,
      ),
      requests: Math.max(1, max(r.requests, u.requests)),
      total: prompt + output,
    },
    credits: Number.isFinite(Number(r.credit))
      ? Math.max(0, Number(r.credit))
      : 0,
  };
}

export function aggregateUsage(
  messages,
  sessions,
  { accountId = null, since = null, until = null } = {},
) {
  const owners = new Map(sessions.map((s) => [s.id, s]));
  const unique = new Map();
  for (const m of messages)
    if (
      (!accountId || owners.get(m.sessionId)?.userId === accountId) &&
      (!since || m.timestamp >= since) &&
      (!until || m.timestamp < until)
    )
      unique.set(m.key, m);
  const total = emptyTokens(),
    days = new Map(),
    models = new Map(),
    conversations = new Map();
  let credits = 0;
  const add = (target, message) => {
    for (const key of Object.keys(total)) target[key] += message.tokens[key];
  };
  for (const m of unique.values()) {
    add(total, m);
    credits += m.credits;
    const date = new Date(m.timestamp),
      label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const daily = days.get(label) ?? {
      day: label,
      tokens: emptyTokens(),
      credits: 0,
    };
    add(daily.tokens, m);
    daily.credits += m.credits;
    days.set(label, daily);
    const model = models.get(m.model) ?? {
      name: m.model,
      tokens: emptyTokens(),
      credits: 0,
    };
    add(model.tokens, m);
    model.credits += m.credits;
    models.set(m.model, model);
    const session = conversations.get(m.sessionId) ?? {
      id: m.sessionId,
      name: owners.get(m.sessionId)?.title ?? "未命名对话",
      tokens: emptyTokens(),
      credits: 0,
    };
    add(session.tokens, m);
    session.credits += m.credits;
    conversations.set(m.sessionId, session);
  }
  return {
    total,
    credits,
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    models: [...models.values()].sort(
      (a, b) => b.tokens.total - a.tokens.total,
    ),
    sessions: [...conversations.values()].sort(
      (a, b) => b.tokens.total - a.tokens.total,
    ),
    fetchedAt: Date.now(),
    records: unique.size,
  };
}

export class UsageScanner {
  cache = new Map();
  async scan(root, sessions, query = {}) {
    const files = [],
      warnings = [];
    const walk = async (directory) => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT" && directory === root) {
          warnings.push("未找到本地 Token 记录目录。");
          return;
        }
        throw new Error("无法读取部分 Token 记录目录，请检查访问权限。");
      }
      for (const item of entries) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const file = path.join(directory, item.name);
        if (item.isDirectory()) await walk(file);
        else if (item.isFile() && item.name.endsWith(".jsonl"))
          files.push(file);
      }
    };
    await walk(root);
    const seen = new Set(files),
      all = [];
    for (const file of this.cache.keys())
      if (!seen.has(file)) this.cache.delete(file);
    for (const file of files) {
      const stat = await fs.stat(file),
        fingerprint = `${stat.size}:${stat.mtimeMs}`;
      let cached = this.cache.get(file);
      if (cached?.fingerprint !== fingerprint) {
        const messages = [];
        const stream = createReadStream(file, { encoding: "utf8" });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            const message = parseUsage(line);
            if (message) messages.push(message);
          }
        } catch {
          throw new Error("部分 Token 记录读取失败，请检查文件权限后重试。");
        } finally {
          lines.close();
          stream.destroy();
        }
        cached = { fingerprint, messages };
        this.cache.set(file, cached);
      }
      for (const message of cached.messages) all.push(message);
    }
    return {
      ...aggregateUsage(all, sessions, query),
      scannedFiles: files.length,
      warnings,
    };
  }
}

export function usageCSV(usage) {
  const quote = (value) =>
    `"${String(value)
      .replace(/^[=+\-@\t\r]/, (m) => `'${m}`)
      .replaceAll('"', '""')}"`;
  return (
    "\ufeff" +
    [
      "日期,输入Token,输出Token,缓存读取,缓存写入,推理Token,请求数,总Token,记录Credits",
      ...usage.daily.map((d) =>
        [
          d.day,
          d.tokens.input,
          d.tokens.output,
          d.tokens.cacheRead,
          d.tokens.cacheWrite,
          d.tokens.reasoning,
          d.tokens.requests,
          d.tokens.total,
          d.credits,
        ]
          .map(quote)
          .join(","),
      ),
    ].join("\n")
  );
}
