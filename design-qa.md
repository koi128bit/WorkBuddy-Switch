# WorkBuddy Switch Design QA

## Comparison Target

- cc-switch source visual truth:
  - `work/design-qa/reference-cc-switch-main-zh.png`
- WorkBuddy usage visual truth:
  - `work/design-qa/reference-summary.png`
  - `work/design-qa/reference-trend.png`
- WorkBuddy Switch 0.2.0 native captures:
  - `work/design-qa/implementation-v0.2.0-trae-cn-accounts.png`
  - `work/design-qa/implementation-v0.2.0-trae-cn-usage.png`
  - `work/design-qa/implementation-v0.2.0-trae-work-usage.png`
  - `work/design-qa/implementation-v0.2.0-trae-work-settings.png`
  - `work/design-qa/implementation-kimi-30d.jpeg`
  - `work/design-qa/implementation-kimi-trend-30d.jpeg`
- Combined comparison evidence:
  - `work/design-qa/comparison-v0.2.0-cc-switch-trae.jpg`
  - `work/design-qa/comparison-summary.jpg`
  - `work/design-qa/comparison-trend.jpg`
- App icon implementation:
  - `Sources/OpenUsage/Resources/AppIcon.png`

## Viewport And State

- cc-switch source: 1870 x 1252 px, light appearance, account list.
- Trae implementation captures: 1120 x 672 px native macOS window, light appearance.
- WorkBuddy usage source: 1800 x 1576 px; usage implementation: 1120 x 672 px native macOS window, dark appearance.
- CSS size: not applicable to the native SwiftUI application.
- Density normalization: the cc-switch and Trae captures are aspect-fit into equal 1160 x 920 point boxes. The resulting comparison sheet is 4800 x 2000 px at the host's 2x backing scale. The source and implementation retain their original aspect ratios; the comparison assesses component hierarchy and visual language rather than claiming pixel-identical dimensions.
- Trae state: Trae CN and TRAE Work provider tabs; account empty state; current-day usage; request-count quota with 3 used of 10; no local Token records.
- WorkBuddy state: 30-day range, `kimi-k3-1` selected, current-account quota loaded.

## Interaction Evidence

- The provider selector changes between WorkBuddy, Trae CN, and TRAE Work while preserving the selected feature page.
- Trae CN and TRAE Work expose independent Keychain-backed account pages and independent usage states.
- Trae pages do not expose WorkBuddy's conversation-resume action.
- The Trae usage page defaults to `当天`, labels the trend as hourly, and exposes calendar start/end fields plus 7-day, 30-day, all, and custom ranges.
- The visible Trae refresh timestamp advanced from 15:13:42 to 15:13:58 without manual input, confirming the 15-second refresh loop.
- The request quota appears once as `当前账号周期已用 3`, with `总额 10` in the quota footer; the earlier duplicated request metric is absent.
- The settings page labels its 5-60 minute control `完整刷新间隔`, while the lightweight usage/session refresh remains 15 seconds.
- WorkBuddy still defaults to today's hourly trend, switches to daily buckets for multi-day periods, and refreshes sessions from the main refresh path.
- WorkBuddy Kimi selection updates the summary, trend, and model table consistently; Token axes use K/M/B labels rather than scientific notation.
- Accessibility labels expose provider, feature, account/model, period, date, refresh, chart, and detail controls.

## Full-View Comparison

`work/design-qa/comparison-v0.2.0-cc-switch-trae.jpg` places the actual cc-switch reference and the final Trae account screen in one image. Both use a light native utility shell with a prominent product switcher, a compact tool selector, restrained gray surfaces, blue selection, direct account actions, and a scan-first layout. WorkBuddy Switch intentionally uses a single account workspace rather than cc-switch's multi-provider card list because the selected provider is already represented by the top segmented control.

`work/design-qa/comparison-summary.jpg` and `work/design-qa/comparison-trend.jpg` show that the WorkBuddy usage flow preserves the reference hierarchy: compact filters, Token summary, requests and Credits, four Token categories, cache-hit progress, and the trend immediately below.

## Focused Evidence

- Provider and feature controls: the cc-switch-style segmented product picker and adjacent icon-only feature picker use matching compact radii, selected elevation, and restrained stroke weights.
- Trae account state: the primary save command appears once in the toolbar and once in the actionable empty state; text remains centered and unclipped at the minimum window size.
- Trae quota state: Token, interval requests, cycle usage, input/output/cache categories, cache-hit rate, and quota footer remain readable without duplicate cards or nested panels.
- WorkBuddy trend: the chart uses four-series color coding, a restrained grid, compact legend, and K/M/B axis labels.

## Required Fidelity Surfaces

- Fonts and typography: native San Francisco typography matches the platform character of the references. Headings, controls, values, secondary labels, and empty-state text preserve a clear hierarchy with 0 letter spacing and no clipping.
- Spacing and layout rhythm: the 1120 x 672 native window uses aligned top controls, compact 8 px-or-smaller radii, full-width content regions, and predictable page padding. No cards are nested inside decorative page cards.
- Colors and visual tokens: blue WorkBuddy selection, cyan Trae CN, violet TRAE Work, mint positive quota values, coral used quota values, neutral gray surfaces, and subtle separators provide clear provider and semantic states without a one-note palette.
- Image quality and asset fidelity: the supplied 1024 x 1024 WorkBuddy icon remains sharp. All four outer corner alpha values are 0, with no opaque corner box or transparency halo.
- Copy and content: provider names, account state, API provenance, request-count versus Credits quota language, current-day period, and full refresh interval are explicit and internally consistent.
- Icons: native SF Symbols provide a consistent optical weight for provider, navigation, refresh, date, account, model, and chart controls. The supplied brand icon is used rather than recreated.
- Responsiveness: the application enforces a usable native minimum, scrolls long pages vertically, and keeps provider/feature navigation visible without overlap.
- Accessibility and motion: semantic native controls are keyboard reachable, charts expose textual summaries, and the animated header honors macOS Reduce Motion.

## Comparison History

1. The earlier WorkBuddy usage pass found a P1 accounting presentation error caused by integer quota fields.
2. The parser was changed to prefer precise quota fields, and the labels now separate local model Credits from current-account server Credits. Post-fix captures show 2,200.96 server Credits and 2,107.09 unattributed Credits.
3. The initial Trae pass exposed a duplicated request-count summary and an ambiguous 5-60 minute `自动刷新` label.
4. The duplicate quota metric was removed, and the setting was renamed to `完整刷新间隔`. The final Trae usage and settings captures confirm both fixes.
5. The final combined cc-switch/Trae comparison contains no remaining actionable P0, P1, or P2 mismatch.

## Findings

No actionable P0, P1, or P2 findings remain.

The native WorkBuddy Switch window is intentionally denser than the 1870 px cc-switch reference. This is an expected platform and viewport adaptation; provider switching, tool navigation, account actions, usage hierarchy, spacing, and visual tokens remain equivalent.

## Follow-Up Polish

- P3: A wider optional window preset could provide more whitespace for large displays, but the current default and minimum sizes are readable and balanced.

final result: passed
