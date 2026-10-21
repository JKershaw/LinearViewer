# Design & interface review — ninth run (LIN-3747)

> Working document. Beat 2 (LIN-3749) adds the cold-surface evidence log below; the severity-ranked report is written in beat 5 (LIN-3752). Evidence: `docs/reviews/_evidence-2026-10-21/`; the coverage limits come from `coverage-map.md`.

## Beat 2 — cold-surface evidence log (LIN-3749)

Evidence only, no verdicts. Measurements are in the per-capture JSON; image reads and the census are beat 4.

- **Landing**: 4 doors (Linear, GitHub, Jira, email) on live and local; two distinct door backgrounds (one filled teal, the rest transparent) at 1400.
- **Archives**: 1–9 and `/archive/999` captured light/dark (media-emulated); every archive serves `prefers-color-scheme: dark`.
- **Library**: index, three document cases and a 104-document sweep at 390. Sweep totals (`data/library-sweep.json`): 0 non-200, 0 images without alt, 0 broken images, 0 composited contrast groups under 4.5:1; **every document renders two `<h1>`** (the masthead wordmark plus the document title); **74 of 104 documents overflow at 390** (wide tables, e.g. `table.@574>390`).
- **Guest share** lifecycle (`data/guest-share-lifecycle.json`): mint 201, guest 200 with `no-referrer`/`no-store`/`noindex`, revoke 200, then 404 on the same URL, a never-issued token and `/s/…`.
- **KPIs**: rate and total toggle states, seeded; total draws a `line` chart, rate is the default.
- **Email**: 13 renderers (synthetic), real routes, the sent email (`/test/email-outbox`).
- **Held**: 404 / 400 / 409 / picker real; 503 synthetic.
- **Lighthouse** accessibility (28 routes): lowest `/styleguide` 0.89 (colour-contrast, heading-order), `/archive/999`, `/auth/email/confirm`, `/connect/github/held`, `/t/<unknown>` 0.89 (colour-contrast); `/swipe` 0.92 (`meta-viewport`).
- **Live harbour.cat**: all 28 routes reachable, status and title identical to local.

## Beat 3 — authenticated captures (LIN-3750)

Evidence: `docs/reviews/_evidence-2026-10-21/authenticated/` (PNG + JSON per cell, focus logs, Lighthouse JSON), indexed by `docs/reviews/_evidence-2026-10-21/manifest.json` (every entry carries a `registry.json` id; `manifest.json › beat3` holds the coverage assertion, `passed: true`). Tooling: `capture/beat3-*.mjs` (docs-only; the committed makers `tests/visual/*.spec.js` and `tests/screenshots/` are not touched). Fresh renders, 1400/390 × light/dark, dark via the real `theme` cookie with `theme-dark` asserted in the same read as the measurement.

### The task page (carried input from beat 1) — resolved

`ws-task-page` on the default seed is a 503 because the `test-token` Linear mock cannot read a task; that is a harness property. Through the approved `/test/set-local-session` seam (real LocalStore, sessions as real dispatch rows) the page renders **HTTP 200 with the task body** in every state: running, done, waiting, PR-ready (owner), PR-ready (guest share link: evidence and text, no merge box, no owner widgets), B1 merged + Done, B1′ reopened (merge recorded, tracker In Progress; settles, no reload loop), not-found (404, also filed under `renderer:renderTaskNotFoundPage`), signed-out (redirects to `/`). `ws-task-edit` is likewise captured populated through the local seam (default seed: 500, harness). No state is captured under the Linear mock; that is the named limit.

### What was captured

| area | states |
| -- | -- |
| workspace KPIs (`ws-kpis`) | empty; populated with done-per-day rate and running-total toggles; fail (one-shot injected aggregate failure → 500 "Something Went Wrong") |
| runner (`ws-runner`) | default; minted + copied (so the `--green` feedback line is on screen) |
| rebuilt pages | tree, swipe, swim, settings, roadmap, proxy, dispatch, flight companion, live console, ship's biscuit, observation (incl. Scan-due tab), session page, ship journey, plus every other authenticated `ws-*` id and the provider twins — empty, and populated where a seam exists |
| populated | live console, ship's biscuit, observation, session page, proxy (event log opened), ship journey, dispatch, flight companion, workspace KPIs |
| interactive nav | team and assignee dropdowns open, workspace switcher open (two workspaces), `⋯ more` open, model-picker `<select>` focused |
| focus-order walks | task page (running, PR-ready), live account-merge confirm (409), email family (7 renderers, synthetic), nav (and `⋯ more` opened by keyboard) |
| Lighthouse (authenticated, light, mobile emulation, 12.8.2) | task page, workspace KPIs, runner, tree, settings, proxy |

### Measurements worth a beat-4 look (not verdicts)

* **Runner `--green` text (`public/runner-setup.css:76`)**: after mint + copy, "copied ✓" is `rgb(22,163,74)` on white = **3.3:1** (<4.5:1).
* **Primary merge button** `button.rev-closeout-press` (light task page, PR-ready): **3.74:1**; `span.wordmark-accent` reads 3.74:1 on every light page.
* **Settings under Jira, dark**: `a.settings-action` ×4 at **1.65:1**, `button.action-btn` 1.35:1 (theme-dark asserted).
* **A22 (Collective status dot)**: driven. The poll status text is `rgb(102,102,102)` (5.74:1) in all three states ("● live", "● disconnected" via browser offline emulation, "Yap not configured" via a synthetic 503): **no state colour**, so A22 stands.
* **A16 (Live Console presets)**: computed font-size **12px** on the pulse/timeline preset buttons (24px tall).
* **Lighthouse accessibility**: task page 0.96, KPIs 0.96 (`color-contrast`, `label-content-name-mismatch`), runner 0.96, tree 0.96, settings 0.87 (`color-contrast`, `label`, `select-name`, `font-size`), proxy 0.91 (`color-contrast`, `select-name`, `font-size`).
* **Focus walks**: every stop in every walk shows a computed focus indicator (2px outline) and is `:focus-visible`; no positive tabindex. The nav walk is 48 stops because every issue row is a tab stop; tab order puts workspace/team/assignee/search/feedback before the view links. After opening `⋯ more` with Enter, the overflow links are the next tab stops.
* **Review-evidence line** (task page, PR-ready): "Review's claim" runs the verdict, the body and the timestamp together with no separator ("…discharging the ledger.CI on `abc1234` is green.2026-10-06T10:00:00Z"), raw backticks shown. Seeded review body, so confirm against a real review in beat 4.
* **Ship Journey**: with reports dated before the later completions, the sentence reads "6 of 3 completed tasks charted — 200% coverage". Documented edge case in `lib/ship-journey.js` (ratio above 1 is not clamped); the kept capture re-seeds so the window spans every completion (6 of 6).

### Plan corrections (to be noted on LIN-3747)

1. **Observation is not populated by `seed-agent-status`** (plan: "Live Console / Ship's Biscuit / Observation via `seed-agent-status`"). The Observation feed is built from dispatch sessions; agent-status alone renders "nothing running". Populated here with dispatch sessions (done / blocked / running) plus agent-status.
2. **Ship's Biscuit** needs one generated edition (deterministic, no model) before it shows content; **Ship Journey** needs a local-provider workspace with completed issues plus orientation entries naming them, not just `seed-report-history`; the **Proxy** Event Log is in a closed `<details>` and was opened for the populated capture.

### Named limits (beat 3)

* Task page: no state under the Linear mock (503 harness property); all 200 states via the local-provider seam.
* Effort-readout, Task Chat, Scan-due: empty/default state only, no seed seam (beat-1 grep).
* Flight Companion: playbook seeded; a live turn is not driven. Ship's Biscuit: deterministic edition only.
* Model-picker `<select>`: focused, not opened; the native popup is not rendered headless (option sets and computed styles are in the JSON).
* A22 offline flip is browser network emulation (Playwright `setOffline`), not a product seam; the 503 variant is synthetic.
* Account-merge confirm: only the Linear-only live seam; non-Linear copies stay un-rendered (09-26 §7.1, carried to beat 4).
* Email family focus walks use the production renderers via interception (synthetic), not live states; live email pages are beat 2.
* Lighthouse: six surfaces, light only, mobile emulation; intercepted renderers are not reachable (covered by the M4 census).
* Full-page PNGs of the sticky nav bar render it mid-page (a full-page capture artifact, not a layout defect); PNGs are palette-quantised.
* Contrast sampler limits (background-image, pseudo-elements, non-ancestor layers) carry over from beat 1.
