import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parseUsage,
  aggregateUsage,
  usageCSV,
  mergeApiUsage,
  UsageScanner,
} from "../desktop/usage.mjs";
import { parseQuota, fetchQuota } from "../desktop/quota.mjs";
import { loadSessions, prepareSession } from "../desktop/sessions.mjs";
import { parseAuth } from "../desktop/auth.mjs";

const line = (overrides = {}) =>
  JSON.stringify({
    type: "message",
    role: "assistant",
    sessionId: "s1",
    uuid: "m1",
    timestamp: Date.now(),
    providerData: {
      model: "model-a",
      rawUsage: {
        prompt_tokens: 100,
        prompt_cache_hit_tokens: 40,
        completion_tokens: 20,
        credit: 1.5,
      },
    },
    ...overrides,
  });
test("cache and reasoning tokens are subsets, never double counted", () => {
  const parsed = parseUsage(line());
  assert.equal(parsed.tokens.total, 120);
  assert.equal(parsed.tokens.input, 60);
  assert.equal(parsed.tokens.cacheRead, 40);
});
test("billable tool calls are counted independently within the same user turn", () => {
  const messages = [
    parseUsage(
      line({ type: "function_call", role: undefined, uuid: "tool-1" }),
    ),
    parseUsage(
      line({ type: "function_call", role: undefined, uuid: "tool-2" }),
    ),
    parseUsage(line({ uuid: "text-3" })),
  ];
  assert.equal(aggregateUsage([...messages, messages[0]], []).total.total, 360);
  assert.equal(aggregateUsage(messages, []).records, 3);
  assert.equal(parseUsage(line({ type: "function_call_result" })), null);
  assert.equal(parseUsage(line({ timestamp: Infinity })), null);
});
test("normalised and missing aggregate prompt formats are supported", () => {
  const parsed = parseUsage(
    line({
      providerData: {
        rawUsage: {
          prompt_cache_miss_tokens: 30,
          prompt_cache_hit_tokens: 70,
          completion_tokens: 10,
          completion_thinking_tokens: 30,
        },
      },
    }),
  );
  assert.equal(parsed.tokens.total, 110);
  assert.equal(parsed.tokens.reasoning, 10);
  assert.equal(parseUsage(line({ role: "user" })), null);
  assert.equal(parseUsage("invalid"), null);
});
test("deduplication and live database ownership determine account attribution", () => {
  const m = parseUsage(line());
  assert.equal(
    aggregateUsage([m, m], [{ id: "s1", userId: "a" }]).total.total,
    120,
  );
  assert.equal(
    aggregateUsage([m], [{ id: "s1", userId: "b" }], { accountId: "a" }).total
      .total,
    0,
  );
  assert.equal(aggregateUsage([m], [], { accountId: "a" }).records, 0);
  assert.equal(aggregateUsage([m], []).records, 1);
});
test("date ranges are inclusive at start and exclusive at end", () => {
  const m = parseUsage(line({ timestamp: 1000 }));
  assert.equal(
    aggregateUsage([m], [], { since: 1000, until: 1001 }).records,
    1,
  );
  assert.equal(aggregateUsage([m], [], { until: 1000 }).records, 0);
});
test("credits come only from explicit records; token counts are not converted", () => {
  assert.equal(
    parseUsage(
      line({
        providerData: {
          rawUsage: { prompt_tokens: 9999, completion_tokens: 99 },
        },
      }),
    ).credits,
    0,
  );
  assert.ok(
    usageCSV(aggregateUsage([parseUsage(line())], [])).startsWith("\ufeff日期"),
  );
});
test("quota honors precise values, excludes expired packages and handles placeholder expiry", () => {
  const now = new Date("2026-10-03T00:00:00").getTime();
  const q = parseQuota(
    {
      data: {
        Response: {
          Data: {
            Accounts: [
              {
                CycleCapacitySize: 100,
                CycleCapacitySizePrecise: "100.5",
                CycleCapacityRemainPrecise: "40.25",
                DeductionEndTime: "2049-01-01",
                CycleEndTime: "2026-10-06",
              },
              {
                CycleCapacitySize: 10,
                CycleCapacityRemain: 5,
                ExpiredTime: "2026-09-30",
              },
            ],
          },
        },
      },
    },
    now,
  );
  assert.equal(q.total, 100.5);
  assert.equal(q.remaining, 40.25);
  assert.equal(q.resources[1].expired, true);
  assert.equal(q.expiresAt, new Date("2026-10-06").getTime());
});
test("empty resource list is zero while malformed response is an error", () => {
  assert.equal(parseQuota({ data: { Packages: [] } }).remaining, 0);
  assert.throws(() => parseQuota({ data: {} }), /未知/);
});
test("quota does not fall back after authentication or network failures", async () => {
  const document = parseAuth(
    JSON.stringify({ account: { uid: "a" }, auth: { accessToken: "fixture" } }),
  );
  let calls = 0;
  await assert.rejects(
    () =>
      fetchQuota(document, async () => {
        calls++;
        return { status: 401 };
      }),
    /失效/,
  );
  assert.equal(calls, 1);
  const q = await fetchQuota(document, async () => {
    calls++;
    return calls === 2
      ? { status: 404 }
      : {
          status: 200,
          ok: true,
          json: async () => ({ data: { Accounts: [] } }),
        };
  });
  assert.equal(q.remaining, 0);
  assert.equal(calls, 3);
});
test("stream scanner invalidates changed and deleted files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wb-usage-test-"));
  t.after(() => fs.rm(directory, { recursive: true }));
  const file = path.join(directory, "session.jsonl"),
    scanner = new UsageScanner();
  await fs.writeFile(file, line() + "\n");
  assert.equal((await scanner.scan(directory, [])).records, 1);
  await fs.appendFile(file, line({ uuid: "m2" }) + "\n");
  assert.equal((await scanner.scan(directory, [])).records, 2);
  await fs.rm(file);
  assert.equal((await scanner.scan(directory, [])).records, 0);
});
test("session migration backs up WAL data, touches one row and rejects stale ownership", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "wb-session-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true }));
  const file = path.join(directory, "workbuddy.db");
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,cwd TEXT,created_at INTEGER,updated_at INTEGER,deleted_at INTEGER); INSERT INTO sessions VALUES('s1','a','Title','/tmp',1,1,2); INSERT INTO sessions VALUES('s2','a','Other','/tmp',1,1,NULL)",
  );
  db.close();
  const initial = loadSessions(file)[0];
  const source = loadSessions(file).find((s) => s.id === "s1");
  const saved = await prepareSession(
    file,
    path.join(directory, "backups"),
    source,
    "b",
  );
  assert.ok(saved);
  assert.equal(loadSessions(saved).find((s) => s.id === "s1").userId, "a");
  assert.equal(loadSessions(file).find((s) => s.id === "s1").userId, "b");
  assert.equal(loadSessions(file).find((s) => s.id === "s2").userId, "a");
  await assert.rejects(
    () => prepareSession(file, directory, source, "c"),
    /变化/,
  );
  assert.equal(initial.userId, "a");
});

test("local API usage is added to totals, daily rows and models without inventing credits", () => {
  const base = aggregateUsage([], []);
  const records = [
    {
      day: "2026-10-27",
      provider: "workbuddy",
      accountId: "a",
      model: "deepseek-v4.1-flash",
      input: 700,
      output: 30,
      requests: 2,
      unknown: 0,
    },
    {
      day: "2026-10-27",
      provider: "workbuddy-global",
      accountId: "g",
      model: "global-model",
      input: 5,
      output: 5,
      requests: 1,
      unknown: 0,
    },
    {
      day: "2026-10-28",
      provider: "workbuddy",
      accountId: "a",
      model: "deepseek-v4.1-flash",
      input: 100,
      output: 10,
      requests: 1,
      unknown: 1,
    },
  ];
  const merged = mergeApiUsage(base, records, {
    provider: "workbuddy",
    accountId: "a",
  });
  assert.equal(merged.total.input, 800);
  assert.equal(merged.total.output, 40);
  assert.equal(merged.total.total, 840);
  assert.equal(merged.total.requests, 3);
  assert.equal(merged.credits, 0, "本机 API 不推算官方积分");
  assert.equal(merged.api.total, 840);
  assert.equal(merged.api.requests, 3);
  assert.equal(merged.api.unknownUsage, 1);
  assert.equal(merged.api.creditsKnown, false);
  assert.equal(merged.api.models.length, 1);
  assert.equal(merged.api.models[0].name, "deepseek-v4.1-flash");
  assert.deepEqual(
    merged.daily.map((day) => [day.day, day.tokens.total]),
    [
      ["2026-10-27", 730],
      ["2026-10-28", 110],
    ],
  );
  // Day boundaries follow the same local calendar the ledger labels use, so the
  // assertion holds in any runner timezone instead of only in Beijing time.
  const startOfDay = (label) => {
    const [year, month, day] = label.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  };
  assert.equal(
    mergeApiUsage(base, records, {
      since: startOfDay("2026-10-28"),
    }).api.requests,
    1,
    "只有 10-28 的当天记录落在筛选范围内",
  );
  assert.equal(
    mergeApiUsage(base, records, {
      until: startOfDay("2026-10-28"),
    }).api.requests,
    3,
    "结束日期不包含当天",
  );
  assert.equal(
    mergeApiUsage(base, records, { accountId: "b" }).api.requests,
    0,
    "账号筛选同样生效",
  );
});
