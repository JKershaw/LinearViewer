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

* **Runner `--green` text (`public/runner-setup.css:76`)**: after mint + copy, "copied ✓" is `rgb(22,163,74)` on `rgb(247,247,247)` = **3.08:1** (<4.5:1).
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
* Evidence budget: the evidence directory is **18,662,720 bytes (about 18.7 MB; 17.8 MiB)** in git, over the plan's ~10 MB budget (last run: 8.1 MB). Cause: about 270 beat-3 cells at 1400/390 × light/dark, kept so beat 4 can image-read every kept PNG. The six `authenticated/lighthouse-*.json` were trimmed from full reports (2.13 MB) to metadata, category scores and per-audit scores, with details only for audits scoring below 1 (0.43 MB), which cut the directory by 1.70 MB from 20,365,493 bytes. Lighthouse screenshots, timing and passing-audit details are not kept.
* Full-page PNGs of the sticky nav bar render it mid-page (a full-page capture artifact, not a layout defect); PNGs are palette-quantised.
* Contrast sampler limits (background-image, pseudo-elements, non-ancestor layers) carry over from beat 1.

## Beat 4 — image-read, full census, re-measure (LIN-3751)

Evidence: `_evidence-2026-10-21/visual-pass.md` (image-read log), `census.json` (full registry), `remeasure/*.json` (one JSON per cited item), `dark-cell-audit.json`, `remeasure/synthetic/`, `remeasure/dark-recapture/`. Tooling (docs-only): `capture/remeasure.mjs`, `capture/remeasure-dark.mjs`, `capture/recapture-account-home.mjs`; `capture/census.mjs` re-run unchanged. Fresh renders against `:3199` (`boot-3199.mjs`), dark via the real `theme` cookie with `theme-dark` asserted in the same read. **Verdicts below are re-measures, not new findings; the severity-ranked report is beat 5.**

**Re-ground.** `git diff --name-status 0b4bd287 HEAD -- lib routes public server.js` is empty, and the same diff against `origin/main` on `lib/render*.js lib/components public/*.css` is empty: no rendered surface changed since the grounding commit. `origin/main` only gained the beat 1–3 review commits (docs-only), so the window count is 1,156 product commits plus 7 review commits.

### Census (`census.json`)

`census.mjs` over the full `registry.json`, both themes: **249 registry ids, 201 `measured` (195 plus 6 measured with an unexpected outcome that are recorded), 48 `excluded:<reason>`, 0 unlisted, 0 orphan; coverage assertion `passed: true`.** Composited contrast (own background layered): light 86 of 195 measured ids carry at least one group under threshold (218 groups), dark 21 of 195 (74 groups). Lowest ratios are a disabled swipe arrow and a decorative separator (≈1.1:1, not text a reader needs); the lowest readable text is the dark bare `button.action-btn` at **1.35:1** (LIN-3119). Most frequent groups: `span.wordmark-accent` (32), `a.login-button` (27), `button.action-btn.save` (12), `button.login-button` (11) — the white-on-teal 3.74:1 button (F7 class). The sampler remains blind to background-image, pseudo-elements and non-ancestor layers (carried limit).

### Re-measure of the cited regressions (fresh renders)

| id | verdict | figure (JSON) |
| -- | -- | -- |
| LIN-3119 (F1, dark bare controls) | **still reproduces** | 28 elements under 4.5:1 across dark Dispatch, Settings, Runner and Proxy; worst `button.action-btn` `rgb(0,0,0)` on `rgb(34,36,40)` = **1.35:1**; new in-class members "create a preset →" and "set up a runner ›" are UA blue `rgb(0,0,238)` at **1.65:1** (`remeasure/lin-3119.json`) |
| LIN-3120 (F2, `/ship`) | **still reproduces** | `/ship` and `/workspace/test-workspace/ship`: 0 headings, `<title>` "Ship" (`remeasure/lin-3120.json`) |
| LIN-3121 (F3, upstream prose) | **still reproduces** | 429 renders prose "the connection closed before it responded" beside the diagnostic "Linear rate-limited the request"; 502 likewise beside "returned a 502 server error"; `lib/render-pages.js:705-707` untouched since `0b4bd287` (`remeasure/lin-3121-f5.json`; synthetic, interception) |
| LIN-3123 (F8, fill tokens as text) | **still reproduces** | 28 census ids carry `--yellow` (24 groups), `--green` (40), `--amber` (4) as light-theme text; tree ◐ / In Progress `#d4a600` = **2.27:1**; runner copy button 2.44:1 and feedback line 3.08:1 (`remeasure/lin-3123.json`) |
| F4 (UA-default controls, error family) | **still reproduces** | Jira link form and workspace-not-found link are UA blue `rgb(0,0,238)` = **1.89:1 in dark** (9.4:1 light); six white native controls on dark (Jira form ×3, two pickers' `<select>`, email sign-in `<input>`) (`remeasure/f4.json`; synthetic) |
| F5 ("Linear" for every backend) | **still reproduces** (source) | `lib/render-pages.js:705,707` name Linear in the title and prose for any upstream category; the unresolved-provider branch stays a carried limit (not reachable by any seed) (`remeasure/lin-3121-f5.json`) |
| F6 (archive sign-offs) | **still reproduces** | `p.sig` / `p.foot` **2.94:1 light**, 3.87:1 dark, on archives 1, 2, 4, 5, 7, 8, 9 (`remeasure/f6.json`) |
| A1 (`<title>` drift) | **still reproduces** | "Not Found - Projects" on the guest 404 and "Test Workspace - Projects" on the tree; bare "Ship" ×2, "Observation", "Run on my machine" (`remeasure/a1.json`) |
| A3 (Stop styled like Pause/Resume) | **still reproduces** | identical computed colour, background and border on Pause, Stop, Resume (`remeasure/a3.json`) |
| A4 (nav order) | **still reproduces** | 10 pairwise order inversions across 19 workspace pages (e.g. "ship journey" vs "flight companion"); the raw 15 distinct orders overstate it because the active page omits its own link (`remeasure/a4.json`) |
| A5 (mono prose) | **still reproduces** | `.guide-halt-note` (31 words) and `.model-workspace-note` (14 words) are 16px JetBrains Mono, the same size as their section titles; mono prose also on public KPIs (9), public Swim (8) and Privacy (15) (`remeasure/a5.json`) |
| A10 (internal ticket ids in copy) | **still reproduces** | Library (3), Style Guide (11), Proxy (`LIN-123`), Passage Planner (2); `LV-n` on public Ship/Swim are seeded demo ids, not internal (`remeasure/a10.json`) |
| A13 (wordmark at 390) | **still reproduces** | nav wordmark is in the DOM but not visible at 390 on all 19 workspace pages (`remeasure/a13-a14.json`) |
| A14 (two brand marks) | **still reproduces** | shell `<h1>` "Harbour" in Inter on 8 cold public pages (Library, guest 404, email sign-in, public KPIs, Templates, Style Guide, Terms, Privacy; the error/consent family renders the same shell) vs mono `harbour.cat` on landing and app (`remeasure/a13-a14.json`) |

No new issue ids are minted here.

### Research hypotheses (`remeasure/hypotheses.json`)

* **Guest 404 "Not Found - Projects" + "Go back" only — confirmed.** Status 404, `<title>` "Not Found - Projects", a single link whose label is "Go back" but whose `href` is `/` (it goes home, not back). No explanation, no wordmark, no nav.
* **Library double `<h1>` — confirmed for documents, rejected for the index.** `/library/drawing-the-ship` and `/library/doc/charter` render 2 `<h1>` (shell "Harbour" plus the document title); `/library` renders 1.
* **Integration Guide mono prose — confirmed, "bold" rejected.** `.guide-halt-note` is 16px JetBrains Mono at weight 400, 31 words, the same size as its "Integration Guide" section title. It is mono prose, not bold.

### Non-Linear merge consent and reauth (synthetic, `remeasure/synthetic-merge-reauth.json`)

Production `renderMergeConfirmPage` and `renderMergeReauthRequiredPage` with `identityLabel` GitHub, Jira and email (reauth also with no re-proof link plus a note), by request interception. **SYNTHETIC: `/test/set-merge-conflict-session` still hardcodes `'linear'` (`routes/test.js:360/380/382`); no seam was added.** 24 cells (6 renders × 1400/390 × light/dark); 12 PNGs kept and image-read. Findings: the two confirm buttons touch with a **0px gap** and different widths in every provider/theme/width; the white-on-teal button is 3.74:1 in light (F7 class); the copy is correct per provider; dark renders with `theme-dark`; the no-re-proof reauth page offers no dead-end link. Provider-neutral copy is fine here; the "Linear" fallback is only in the upstream-error renderer (F5).

### Evidence-quality corrections found while image-reading

1. **20 beat-2 "dark" cells rendered light** (`dark-cell-audit.json`): public Ship, Swim, Swipe, the email sign-in/confirm real pages, held-connection 404/expired and the Library 404 honour the `theme` cookie but not `prefers-color-scheme`, so the media-emulated "dark" capture is light and its `themeAssertion.passed` was vacuous. This is consistent with the "dark is opt-in" design principle, not a product defect. Eight of them were re-captured with the real cookie (`remeasure/dark-recapture/`, `theme-dark` asserted) and the census already sweeps both themes with the cookie. **Carried limit:** the other 12 (the 320px and 390px variants of public Ship, Swim and Swipe, email sign-in and confirm, held-connection 404 and expired, and the Library 404) were not re-captured, so no dark PNG exists at 320px or 390px for those 8 surfaces. Dark is covered there at 1400px only (re-capture plus census); mobile dark for them is unverified.
2. **The account-home synthetic input was wrong.** Beat 1 passed `emails` as objects, so the original PNG read "Signed in as [object Object]". The production caller (`routes/email-auth.js` `/account`) passes `string[]`. `renderer-args.mjs` is corrected and the four cells re-rendered ("Signed in as you@example.com"). Not a product defect.

### Image-read candidates handed to beat 5 (looked at, not yet verdicts)

Seen in the renders and worth a verdict in the report: the touching merge/consent buttons; wrapped diagnostic values dropping under the label column on the upstream error page; the KPI rate chart reading "nothing done yet" under a "Tasks done since 11 Sep 2026: 23" header when the completions are older than the rate window (`public/workspace-kpis.js:66`; likely a window/label mismatch, seeded data); `ws-collective` preset rows with duplicated chair names ("Standup Chair Standup Chair") and near-invisible "launch" buttons in dark; the `ws-task-page` review-evidence line running verdict, body and timestamp together (carried from beat 3); the 390px nav scroller starting mid-strip so the first item reads "sks"; raw backticks on `/templates`; from the per-PNG re-read of the 84 task-page/tree renders: the waiting task page at 1400px (`ws-task-page--waiting--dark-1400px.png`) leaves a ~300px empty left column under the status line while the answer card spans full width and Brief and recap sits right, and at 390px a stray middot floats in the Plan and Build stage cards (the "started 2s ago · took 0s" separator), the dark answer card is muddy brown with dim placeholder text. The per-PNG notes are in `visual-pass.md`.
