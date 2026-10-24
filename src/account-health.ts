import type { Account, Settings } from "./types";

export function accountHealth(
  account: Account,
  settings: Settings,
  now = Date.now(),
) {
  const expiring = account.quotaError
    ? []
    : (account.quota?.resources || []).filter(
        (resource) =>
          !resource.expired &&
          resource.remaining > 0 &&
          resource.expiresAt !== null &&
          resource.expiresAt > now &&
          resource.expiresAt <= now + settings.expiryWarningDays * 86400000,
      );
  const expiringCredits = expiring.reduce(
    (sum, resource) => sum + resource.remaining,
    0,
  );
  const renew = !!account.tokenExpiresAt && account.tokenExpiresAt <= now;
  const low =
    !account.quotaError &&
    !!account.quota &&
    account.quota.remaining <= settings.lowBalanceThreshold;
  const error = !!(
    account.quotaError ||
    account.rewards?.checkinError ||
    account.rewards?.travelError
  );
  return {
    expiring,
    expiringCredits,
    renew,
    low,
    error,
    attention: error || renew || low || expiringCredits > 0,
  };
}

export function suggestedAccount(
  accounts: Account[],
  settings: Settings,
  now = Date.now(),
) {
  return accounts
    .filter(
      (account) =>
        !account.quotaError &&
        (account.quota?.remaining || 0) > 0 &&
        !!account.quota?.fetchedAt &&
        now - account.quota.fetchedAt < 6 * 3600000 &&
        accountHealth(account, settings, now).expiringCredits > 0,
    )
    .sort(
      (a, b) =>
        (a.quota!.expiresAt || Infinity) - (b.quota!.expiresAt || Infinity),
    )[0];
}
