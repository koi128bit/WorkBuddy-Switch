# WorkBuddy Switch Changelog

## 0.2.0 - 2026-07-25

- Add a unified provider switcher for WorkBuddy, Trae CN, and TRAE Work.
- Add Keychain-backed account capture and switching for Trae CN and TRAE Work,
  alongside the existing WorkBuddy account workflow.
- Add Trae usage and allowance views based on data returned by the corresponding
  Trae APIs, with a 15-second application refresh target.
- Keep Trae switching non-destructive: settings, plugins/extensions, workspaces,
  conversations, and machine identifiers are not reset or removed.
- Keep conversation browsing and cross-account resume explicitly WorkBuddy-only;
  Trae conversations are not read, migrated, or resumed.
- Refresh the interface around the unified provider workflow and update release
  metadata for the 0.2.0 build.

## 0.1.4 - 2026-07-25

- Allow the resume migration flow to recreate missing SQLite WAL sidecars after
  WorkBuddy exits, preventing `unable to open database file` before backup and
  session reassignment.
- Add a regression fixture that checkpoints a WAL database, removes its WAL and
  SHM sidecars, then verifies cross-account conversation migration and backup.

## 0.1.3 - 2026-07-25

- Continue a cross-account conversation by migrating only the selected session
  to the currently logged-in WorkBuddy account instead of switching credentials
  back to the session's original account.
- Stop WorkBuddy before migration, verify the active identity again, checkpoint
  WAL, and create a consistent SQLite backup before the guarded transaction.
- Restore deleted sessions and reassign ownership atomically, prevent duplicate
  resume operations, and clarify migration behavior across every resume entry.
- Make initial session and usage loading survive SwiftUI task cancellation,
  distinguish an uninitialized usage cache from a genuine zero, retry transient
  empty sources, and refresh local sessions and usage globally every 15 seconds.

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
