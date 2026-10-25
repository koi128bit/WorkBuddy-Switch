import test from "node:test";
import assert from "node:assert/strict";
import {
  creditSummary,
  dailySeries,
  apiAnalytics,
  rewardSeries,
} from "../src/analytics.ts";

const now = Date.parse("2026-10-25T04:00:00Z");
test("daily series uses Beijing dates across midnight and ignores future and invalid records", () => {
  const points = dailySeries(
    [
      { at: Date.parse("2026-10-24T15:59:00Z"), value: 3 },
      { at: Date.parse("2026-10-24T16:01:00Z"), value: 4 },
      { at: now + 1000, value: 100 },
      { at: NaN, value: 5 },
    ],
    2,
    now,
  );
  assert.deepEqual(
    points.map((p) => [p.label, p.value, p.count]),
    [
      ["2026-10-24", 3, 1],
      ["2026-10-25", 4, 1],
    ],
  );
});
test("unknown amounts stay unknown instead of appearing as zero", () => {
  const points = dailySeries([{ at: now, value: null }], 2, now);
  assert.equal(points[0].value, 0);
  assert.equal(points[1].value, null);
  assert.equal(points[1].unknown, 1);
});
test("mixed known and unknown amounts retain the known subtotal and the missing count", () => {
  const [point] = dailySeries(
    [
      { at: now, value: 5 },
      { at: now, value: null },
      { at: now, value: Infinity },
    ],
    1,
    now,
  );
  assert.equal(point.value, 5);
  assert.equal(point.unknown, 2);
});
test("credit totals exclude failed and malformed quotas and preserve partial coverage", () => {
  const account = (quota, quotaError = null) => ({
    quota,
    quotaError,
    rewards: null,
    tokenExpiresAt: null,
  });
  const quota = { total: 100, remaining: 60, used: 40, resources: [] };
  const data = creditSummary(
    [
      account(quota),
      account(null),
      account(quota, "expired"),
      account({ ...quota, remaining: NaN }),
    ],
    { expiryWarningDays: 7, lowBalanceThreshold: 20 },
    now,
  );
  assert.equal(data.remaining, 60);
  assert.equal(data.known, 1);
  assert.equal(data.unknown, 3);
});
test("credit expiry reflects active resource balances rather than an account-wide estimate", () => {
  const data = creditSummary(
    [
      {
        quotaError: null,
        quota: {
          total: 100,
          remaining: 70,
          used: 30,
          resources: [
            { remaining: 20, expiresAt: now + 86400000, expired: false },
            { remaining: 50, expiresAt: now + 20 * 86400000, expired: false },
            { remaining: 500, expiresAt: now - 1000, expired: true },
          ],
        },
      },
    ],
    { expiryWarningDays: 7, lowBalanceThreshold: 20 },
    now,
  );
  assert.equal(data.expiring, 20);
});
test("reward trends count claimed entries only and scope the selected account", () => {
  const data = rewardSeries(
    [
      { accountId: "a", at: now, result: "claimed", credit: 10 },
      { accountId: "b", at: now, result: "claimed", credit: 20 },
      { accountId: "a", at: now, result: "already", credit: 10 },
      { accountId: "a", at: now, result: "error", credit: null },
    ],
    "a",
    1,
    now,
  );
  assert.equal(data[0].value, 10);
  assert.equal(data[0].count, 1);
});
test("API analytics respect the visible recent-history window and never invent unknown token usage", () => {
  const rows = [
    {
      requestId: "a",
      at: now,
      model: "model-a",
      status: "ok",
      inputTokens: 10,
      outputTokens: 3,
      durationMs: 100,
    },
    {
      requestId: "b",
      at: now,
      model: "model-a",
      status: "error",
      inputTokens: null,
      outputTokens: null,
      durationMs: 300,
    },
    {
      requestId: "c",
      at: now - 20 * 86400000,
      model: "old",
      status: "ok",
      inputTokens: 1000,
      outputTokens: 1000,
      durationMs: 1,
    },
  ];
  const data = apiAnalytics(rows, 7, now);
  assert.equal(data.requests, 2);
  assert.equal(data.successRate, 50);
  assert.equal(data.tokens, 13);
  assert.equal(data.unknown, 1);
  assert.equal(data.p50, 200);
  assert.equal(data.p95, 300);
  assert.equal(data.models.length, 1);
  assert.equal(data.tokenSeries.at(-1).unknown, 1);
});
test("duplicate API request IDs are not counted twice", () => {
  const row = {
    requestId: "a",
    at: now,
    model: "m",
    status: "ok",
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 10,
  };
  assert.equal(apiAnalytics([row, row], 7, now).requests, 1);
});
test("empty analytics expose an empty state instead of a made-up success rate or latency", () => {
  const data = apiAnalytics([], 7, now);
  assert.equal(data.requests, 0);
  assert.equal(data.successRate, null);
  assert.equal(data.p50, null);
  assert.equal(data.p95, null);
  assert.equal(data.requestSeries.length, 7);
});
