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

## Beat 2 — cold surfaces (LIN-3749)

Captured 2026-10-21 against the `:3199` landing-faithful boot (`capture/boot-3199.mjs`, GitHub App env = the 3002 twin's env), fresh browser context per capture, patched beat-1 `capture.mjs` (`captureOne`, hooks added: `pre`, `post`, `extraContext`; archives 8 and 9 added) driven by `capture/beat2.mjs`. PNGs palette-quantised by `capture/quantise.py` (32 colours; colour figures come from the JSON). `capture/manifest.json` carries a `registryId` on every row (`capture/finalize-beat2.mjs`): all 69 cold registry members have at least one ok row, none missing.

| group | evidence | notes |
| -- | -- | -- |
| landing, templates, styleguide, privacy, terms, swipe/swim/ship public | `<key>-<theme>-<w>px.{png,json}` | landing renders 4 doors (`data/landing-and-archive-checks.json`) |
| `/kpis` | `kpis-rate-*`, `kpis-total-*`, `data/kpis-*-state.json` | seeded through `/test/seed-kpi-rollup` (60 and 58 days back, then cleared with `/test/clear-kpi-rollup`); both toggle states |
| archives 1–9, `/archive/999` | `archive-N-*`, `archive-404-*` | `darkMode: media`; all nine archives carry `prefers-color-scheme: dark` (`data/landing-and-archive-checks.json`), closing §7.4 for 8 and 9 |
| Library | `library-index-*`, `library-paper-figures-*`, `library-paper-svg-*`, `library-doc-listed-*`, `library-404-*`, `data/library-sweep.json` | sweep over all 104 catalog documents (`loadLibrary().bySlug`) at 390, light and dark; detector witnessed on an injected 1.92:1 paragraph (`data/library-sweep-witness.json`) |
| guest share | `guest-share-view-*`, `guest-share-revoked-404-*`, `data/guest-share-lifecycle.json` | mint 201 → guest view 200 (no-referrer, no-store, noindex) → revoke 200 → same URL 404; 503 and the 404 body are **synthetic** interception states |
| email family | `email-<Name>-*` (13 renderers, interception, **synthetic input**), `email-*-real-*`, `account-*`, `email-message-signin-light-*`, `data/email-outbox.json` | the sent email was produced by a real `/auth/email/send` through the capture transport; email HTML is not themed (light only); token redacted |
| `/connect/:provider/held` | `held-404-*`, `held-expired-*`, `held-409-*`, `held-picker-*`, `data/held-connection-probes.json` | 404 / 400 (expired) / 409 / picker real; the 503 body is **synthetic** (`state-held-connection-503-retry`) |
| legacy redirects | `data/legacy-redirects.json` | `/audit`, `/settings`, `/prompts` → 302 `/` cold; JSON only, no PNG (a redirect has no page of its own) |
| error family | `err-*`, `state-upstream-*`, `err-*Page` | upstream 5xx/429/auth/network/internal by interception, **synthetic**, labelled in the manifest rows' `label` |
| Lighthouse | `lighthouse/<id>.json` (28 routes, Lighthouse 12.8.2, mobile default emulation) | trimmed to scores, four metrics and failing audits |
| live harbour.cat | `live-<id>-light-1400px.png`, `data/live-comparison.json` | all 28 routes reachable; status and `<title>` identical to local on every route; landing 4 doors live and local; only local landing carries the self-host `LINEAR_ACCESS_TOKEN` notice (diff, not a defect); `/kpis` byte difference is live data vs seeded |

### Named limits carried from this beat

- **360px PNGs removed** to hold the ~10 MB evidence budget (9.0 MB at checkpoint, ~1 MB left for beat 3): the 360 `json` measurements stay, the 360 PNGs do not. Beat 3 should quantise harder or capture 1400/390 only.
- **Intercepted renderers are not Lighthouse-reachable** (covered by the M4 census) and have no live comparison; `/t/:token` 503, held 503 and upstream failures are synthetic.
- **`/kpis` other charts**: only `chart-done-daily` is a Chart.js canvas at capture time (`data/kpis-*-state.json`); the colour-only-encoding read (A23) of the other charts is a beat-4 image read.
- **`/account` signed-in** is not rendered (cold beat); `account-home` is the renderer with synthetic input.
- Lighthouse for `/archive/999`, `/auth/email/confirm`, `/connect/github/held`, `/t/not-a-real-token` ran with `--ignore-status-code` (4xx/410 documents).
- Library sweep contrast is blind to `background-image`, pseudo-elements and non-ancestor layers (item 5, carried).
