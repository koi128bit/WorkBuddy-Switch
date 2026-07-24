# WorkBuddy Switch Changelog

## 0.1.2 - 2026-07-25

- Label the headline Token value explicitly as the total for the selected date
  range, including the active model and range when a model filter is applied.
- Clarify that model Credits are only the locally attributable subset while the
  precise server figure represents all models for the current account's billing
  cycle.

## 0.1.1 - 2026-07-25

- Redesign usage analytics with account, model, and period filters; token
  breakdowns; cache hit rate; multi-series trends; and model/session details.
- Default usage analytics to today, add an inclusive custom calendar range, and
  refresh local usage incrementally every 15 seconds while the page is open.
- Add model-level request, input, output, cache-read, cache-write, and daily
  aggregation, including normalized WorkBuddy usage payload support.
- Reconcile locally attributable Credits with the current account's precise
  server-side cycle total without inventing unsupported model-level billing.
- Format chart axes with K/M/B units instead of scientific notation.
- Rename the user-facing product to WorkBuddy Switch.
- Replace the application icon and remove the opaque outer corner background.

## 0.1.0 - 2026-07-24

- Add Keychain-backed WorkBuddy account capture and atomic switching.
- Add account-aware conversation browsing, trash restoration, deep-link resume,
  and CLI fallback.
- Add local token, cache, reasoning, credit, model, and session analytics.
- Add WorkBuddy quota refresh and menu-bar quick actions.
- Add native macOS packaging, signing, DMG creation, and self-tests.
