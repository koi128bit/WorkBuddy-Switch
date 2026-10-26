import test from "node:test";
import assert from "node:assert/strict";
import { parseAuth } from "../desktop/auth.mjs";
import {
  getCheckinStatus,
  checkIn,
  getTravelStatus,
  getTravelConfig,
  departTravel,
  claimTravel,
  rewardDay,
  RewardError,
} from "../desktop/rewards.mjs";

const document = parseAuth(
  JSON.stringify({
    account: { uid: "fixture-user", enterpriseId: "fixture-tenant" },
    auth: { accessToken: "fixture-access", domain: "www.codebuddy.cn" },
  }),
);
const response = (data, code = 0) => ({
  ok: true,
  status: 200,
  json: async () => ({ code, data }),
});

test("check-in uses authenticated official status and falls back only on a missing route", async () => {
  const calls = [];
  const status = await getCheckinStatus(document, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? { ok: false, status: 404 }
      : response({ today_checked_in: true });
  });
  assert.equal(status.checkedIn, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["X-User-Id"], "fixture-user");
  assert.equal(calls[0].options.headers["X-Tenant-Id"], "fixture-tenant");
  assert.equal(calls[0].options.redirect, "error");
  assert.match(
    calls[1].url,
    /^https:\/\/www.workbuddy.cn\/v2\/billing\/meter\/checkin-status$/,
  );
  let failedCalls = 0;
  await assert.rejects(
    () =>
      getCheckinStatus(document, async () => {
        failedCalls++;
        return { status: 401, ok: false };
      }),
    (error) => error instanceof RewardError && error.kind === "auth",
  );
  assert.equal(failedCalls, 1);
});

test("unknown check-in and travel status never becomes an eligible task", async () => {
  await assert.rejects(
    () => getCheckinStatus(document, async () => response({})),
    /格式/,
  );
  for (const state of [undefined, "unknown", "claimed"]) {
    await assert.rejects(
      () => getTravelStatus(document, async () => response({ state })),
      /状态/,
    );
  }
  assert.equal(
    (
      await getTravelStatus(document, async () =>
        response({ state: "traveling", arrive_at: 100, server_now: 200 }),
      )
    ).state,
    "traveling",
  );
});

test("successful check-in preserves fractional official rewards and unknown amounts", async () => {
  assert.equal(
    (await checkIn(document, async () => response({ reward_credit: "0.25" })))
      .credit,
    0.25,
  );
  assert.equal(
    (await checkIn(document, async () => response({}))).credit,
    null,
  );
  for (const credit of [false, true, " ", [], {}, "invalid", -1])
    assert.equal(
      (await checkIn(document, async () => response({ credit }))).credit,
      null,
    );
  const already = await checkIn(document, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ code: 409, message: "今日已签到" }),
  }));
  assert.equal(already.already, true);
  assert.equal(already.credit, null);
});

test("domestic Tencent domains are supported and international activity requests are skipped", async () => {
  const domestic = parseAuth(
    JSON.stringify({
      account: { uid: "fixture-user" },
      auth: { accessToken: "fixture-access", domain: "copilot.tencent.com" },
    }),
  );
  assert.equal(
    (
      await getCheckinStatus(domestic, async () =>
        response({ today_checked_in: false }),
      )
    ).checkedIn,
    false,
  );
  let requests = 0;
  for (const domain of [
    "www.workbuddy.ai",
    "WWW.CODEBUDDY.AI",
    "workbuddy.com",
  ]) {
    const international = parseAuth(
      JSON.stringify({
        account: { uid: "fixture-user" },
        auth: { accessToken: "fixture-access", domain },
      }),
    );
    await assert.rejects(
      () =>
        getCheckinStatus(international, async () => {
          requests++;
        }),
      /国内版/,
    );
  }
  assert.equal(requests, 0);
});

test("network uncertainty never retries a credit-changing POST", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      checkIn(document, async () => {
        calls++;
        throw new Error("timeout fixture-access");
      }),
    /结果尚未确认/,
  );
  assert.equal(calls, 1);
});

test("travel matches official claim and departure payloads and rejects invalid locations", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return response({ reward_credit: 18.6 });
  };
  const claim = await claimTravel(document, request);
  assert.equal(claim.credit, 18.6);
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  await assert.rejects(
    () => departTravel(document, "../invalid", request),
    /地点/,
  );
  assert.equal(calls.length, 1);
  await departTravel(document, 2, request);
  assert.deepEqual(JSON.parse(calls[1].options.body), { location_id: 2 });
});

test("disabled travel, protected credentials and activity failures are visible", async () => {
  assert.equal(
    (
      await getTravelConfig(document, async () =>
        response({ enabled: false, locations: [] }),
      )
    ).enabled,
    false,
  );
  const protectedDocument = parseAuth(
    JSON.stringify({
      account: { uid: "a" },
      auth: { accessToken: { $wbEncrypted: 1, envelope: "opaque" } },
    }),
  );
  let calls = 0;
  await assert.rejects(
    () =>
      checkIn(protectedDocument, async () => {
        calls++;
      }),
    /网页登录/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      checkIn(document, async () => ({
        ok: true,
        status: 200,
        json: async () => ({ code: 9001, message: "签到活动已过期" }),
      })),
    (error) => error.kind !== "auth",
  );
});

test("reward day follows the official China day across local timezone boundaries", () => {
  assert.equal(rewardDay(Date.parse("2026-10-02T16:00:00Z")), "2026-10-03");
  assert.equal(rewardDay(Date.parse("2026-10-02T15:59:59Z")), "2026-10-02");
});
