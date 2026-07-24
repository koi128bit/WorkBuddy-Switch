# WorkBuddy Switch Design QA

## Comparison Target

- Source visual truth:
  - `work/design-qa/reference-summary.png`
  - `work/design-qa/reference-trend.png`
  - `work/design-qa/reference-icon.png`
- Native implementation captures:
  - `work/design-qa/implementation-kimi-30d.jpeg`
  - `work/design-qa/implementation-kimi-trend-30d.jpeg`
- Combined comparison evidence:
  - `work/design-qa/comparison-summary.jpg`
  - `work/design-qa/comparison-trend.jpg`
- App icon implementation:
  - `Sources/OpenUsage/Resources/AppIcon.png`

## Viewport And State

- Source screenshots: 1800 x 1576 px, raster density unknown.
- Implementation screenshots: 1120 x 672 px native macOS window captures.
- Normalization: comparison sheets fit each image to 1000 px width while preserving its aspect ratio. The source is a taller settings page; the implementation is the requested native cc-switch-style shell, so composition and component fidelity were compared instead of asserting pixel-identical chrome.
- State: dark appearance, usage page, 30-day range, `kimi-k3-1` selected, current account quota loaded.
- Expected values: 1,495,521 Token, 5 requests, 74.86 locally recorded model Credits, 2,200.96 current-account server Credits, and 2,107.09 unattributed Credits.

## Interaction Evidence

- A fresh launch defaults to `当天` and uses an hourly trend.
- `30 天` updates both date fields to 2026/6/26 - 2026/7/25 and uses a daily trend.
- Selecting `kimi-k3-1` updates the summary, trend, and model table consistently.
- Editing the start date to 2026/7/23 switches the period to `自定义` and recalculates the visible range.
- The refresh timestamp advanced from 00:41:40 to 00:41:56 without manual input, confirming the 15-second refresh loop.
- Scrolling exposes the trend and model detail without clipping persistent navigation.
- Two overview captures 1.2 seconds apart differed across 22.0% of pixels, concentrated in the animated header region, confirming the Kimi-inspired motion is active.
- Accessibility labels expose the account/model filters, period segments, date fields, refresh action, chart summaries, and detail tabs.

## Full-View Comparison

`work/design-qa/comparison-summary.jpg` shows that both designs use the same hierarchy: page title, compact filters, a large Token summary, request/cost metrics, four Token categories, a cache-hit progress indicator, and the trend immediately below. WorkBuddy Switch intentionally uses a persistent cc-switch-style sidebar in place of the reference app's settings tabs.

## Focused Trend Comparison

`work/design-qa/comparison-trend.jpg` confirms the dark chart surface, four-series color coding, purple cache-hit area, restrained grid, compact legend, period label, and model detail placement. The implementation axis uses `K/M/B` labels (`1.0M`, `750K`, `500K`, `250K`) and does not emit scientific notation.

## Required Fidelity Surfaces

- Fonts and typography: native San Francisco system typography preserves the reference hierarchy and remains legible at the smaller native window size. Values use rounded numerals; labels, captions, and table copy do not overlap or truncate.
- Spacing and layout rhythm: 28 px page margins, 20 px panel padding, 8 px radii, aligned filter rows, and full-width un-nested sections reproduce the source density while fitting the cc-switch navigation shell.
- Colors and visual tokens: blue selection, mint positive values, coral quota values, violet cache-hit trend, neutral dark surfaces, and subtle separators map directly to the reference intent with adequate contrast.
- Image quality and asset fidelity: the user-supplied WorkBuddy icon is retained as a sharp 1024 x 1024 raster asset. All four outer corner alpha values are 0, with no opaque black corner box or visible transparency halo.
- Copy and content: labels distinguish locally recorded model Credits from the current account's server total and explicitly state that WorkBuddy does not provide model-level billing.
- Icons: visible controls use consistent native SF Symbols at aligned optical sizes; the supplied brand icon is used rather than recreated.
- Responsiveness: the window enforces a 1120 x 620 minimum, and the content scrolls vertically at the minimum size without hiding the sidebar or toolbar.
- Accessibility and motion: semantic native controls are keyboard-accessible, charts expose textual summaries, and the animated header honors macOS Reduce Motion.

## Comparison History

1. Initial live pass found a P1 accounting presentation error: the UI used integer quota fields and displayed 2,201.00 server Credits with 2,107.13 unattributed.
2. The quota parser was changed to prefer `CycleCapacitySizePrecise` and `CycleCapacityRemainPrecise`, with legacy numeric fields as fallback. The reconciliation labels were also clarified as current-account values.
3. Post-fix native evidence in `work/design-qa/implementation-kimi-30d.jpeg` shows 2,200.96 server Credits and 2,107.09 unattributed, while preserving 74.86 as the separately labeled local Kimi value.
4. The final summary and trend comparison sheets contain no remaining actionable P0, P1, or P2 mismatch.

## Findings

No actionable P0, P1, or P2 findings remain.

The implementation is intentionally denser than the 1800 x 1576 reference because it is a resizable native utility window with a persistent account-switching sidebar. The hierarchy, visual language, and primary usage workflow remain equivalent.

## Follow-Up Polish

- P3: A wider optional window preset could provide more whitespace for users who prefer the reference page's spacious density, but the current minimum and default sizes are usable and visually balanced.

final result: passed
