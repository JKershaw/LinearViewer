# Coverage map — 09-26 §7 items 1–14 (LIN-3747 beat 1, LIN-3748)

Written before any capture, from the approved plan (LIN-3747 `## Implementation Plan`, rev 2, Plan Review `e3e8d4a4`). The class "last run's named coverage gaps" is bounded by walking the 14 numbered items of `docs/reviews/design-interface-review-2026-09-26.md` §7 at grounding commit `0b4bd287`. Each item either closes in a named beat or carries forward as a named limit. The report's coverage-limits section is generated from this file.

| §7 | gap | disposition | closes in |
| -- | -- | -- | -- |
| 1 | non-Linear merge-consent / reauth unrendered | production renderer + request interception, **synthetic**; stays a named limit (no seam, "none identified": `routes/test.js` `/test/set-merge-conflict-session` hardcodes `'linear'`; adding a seam is product code) | beat 4 |
| 2 | unresolved-provider "Linear" fallback source-only | source read of `lib/render-pages.js:705-707` (F5); **carried limit** (branch unreachable by any seed) | beat 4 |
| 3 | upstream outages synthetic | interception with `{status}` / `{code}` / `Error`; **carried limit**, labelled synthetic (registry ids `state-upstream-*`, `renderer:renderUpstreamAwareErrorPage`) | beat 2 |
| 4 | archive dark media-emulated, JSON-only | now also for archives 8 and 9; check whether 8/9 carry `prefers-color-scheme`; **carried limit** (label `darkMode: media`) | beat 2 |
| 5 | contrast heuristics blind to own translucent background | **closed by M3** (own background layered, `color(srgb …)` parsed; validated). Still blind to `background-image`, pseudo-elements, and text over non-ancestor layers: **carried limit** | beat 1 (done) |
| 6 | sparse seeded data | populated-state table below | beat 3 |
| 7 | A22 / A23 / A16 not re-driven | A23: both KPI pages incl. rate/total toggle (LIN-3732 `b815a930`). A16: computed font-size read on the Live Console presets. A22: needs the offline flip; driven only if a seam exists, else **carried limit** | beats 2, 3 |
| 8 | Lighthouse cold-only | all cold surfaces + ~6 authenticated (`--extra-headers` Cookie; authenticated Lighthouse validated in beat 1 on `/workspace/test-workspace/settings`, `validation/lighthouse-settings-contrast.json`). Intercepted renderers are not Lighthouse-reachable, so they are covered by the M4 census instead | beat 3 |
| 9 | live instance, landing only | every cold surface vs `https://harbour.cat` (curl + one capture each); **carried limit** if unreachable (reachable at beat 1: `validation.json` M2.live) | beat 2 |
| 10 | focus order not re-walked | walk: task page, merge confirm, email family, nav | beat 3 |
| 11 | PNGs palette-quantised | **carried convention** (colour figures from JSON only) | all |
| 12 | census reach (24 authenticated only) | **closed by M4**: `census.mjs` is driven by `registry.json`; coverage assertion fails the run on any unlisted id | beat 1 (done); full run again in beat 4 |
| 13 | interactive nav states | open team / assignee dropdowns, switcher "add" rows, `⋯ more`, model-picker `<select>` | beat 3 |
| 14 | heavy-churn surfaces empty-only | populated-state table below | beat 3 |

## Populated states (§7.6 / §7.14)

Seams verified present at `origin/main` `routes/test.js`: `/test/seed-agent-status`, `/test/seed-proxy-event`, `/test/seed-report-history`, `/test/seed-dispatch-preset`, `/test/set-flight-companion-playbook`, `/test/seed-kpi-rollup`, `/test/email-outbox`.

| surface | populated by |
| -- | -- |
| Live Console, Ship's Biscuit, Observation | `seed-agent-status` (+ `seed-proxy-event` for Live Console) |
| session page | `seed-agent-status` + `seed-proxy-event` |
| Proxy | `seed-proxy-event` |
| Ship Journey | `seed-report-history` |
| Dispatch | `seed-dispatch-preset` |
| Flight Companion | `set-flight-companion-playbook`; a live turn is **not** driven (named limit) |
| KPIs (public and workspace) | `seed-kpi-rollup`, both toggle states |
| effort-readout | **no seam** (beat-1 grep of `routes/test.js`, `registry.json` → `seams`): empty state only — **named limit** |
| Task Chat | **no seed seam** (only `/test/clear-saved-chats`, `routes/test.js:1200`): default state only — **named limit** |
| Scan-due | **no seed seam** (only `/test/clear-task-decisions` :1150, `/test/task-decisions` :1174, `/test/task-decisions-count` :1189): Scan-due tab renders its empty state — **named limit** |

## Beat-1 measurement status

M1–M4 validated 2026-10-21 against the `:3199` boot (`validation/validation.json`, `capture/validate-metrics.mjs`). `census.json` covers every `registry.json` id (`coverage.passed: true`).
