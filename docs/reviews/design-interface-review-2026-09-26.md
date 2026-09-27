# Design & Interface Review — 2026-09-26

**Periodical run (eighth).** Origin LIN-520 · task LIN-3101 · prior runs LIN-565 · LIN-568 · LIN-671 · LIN-736 · LIN-942 · LIN-1924 · LIN-2381.

| | |
|---|---|
| **Grounded on** | `6e8bf424` (research HEAD). Re-grounded against `origin/main` at `90193471` (3 later commits, all under `scripts/eval/` or `docs/reviews/`; none touches a rendered surface) |
| **Window** | `b78c4499..6e8bf424`: **625 commits** (`git rev-list --count`), which matches the ticket's "~625" |
| **Method** | Fresh renders on a keyless `NODE_ENV=test` server (`:3199`), programmatic measurement (JSON beside every capture), **plus an image-capable read of every rendered surface** (§1.4). Both themes; dark comes from the real `theme` cookie, with `theme-dark` asserted in the same read. Viewports 1400 and 390, with 360/320 sweeps where geometry was in doubt. |
| **Scope (not shrunk)** | **All 40 page-GET destinations** from the route table, the **7 archive pages** plus the `/archive/:n` 404 state, **all 9 experimental views**, and the **error/consent family** (merge confirm/reauth, 3 provider pickers, Jira link form, OpenRouter consent, workspace-not-found, 5 `renderUpstreamAwareErrorPage` branches, 3 raw callback failures). Research measured 70 surface keys in 376 captures, and every one of them is rendered. **Every surface was viewed as an image in this stage, and every rendered surface now has at least one kept PNG** (after the second-read, one light 1400 full-page render was kept for each of the 24 authenticated surfaces that beat 2 had viewed but not kept; §1.4). |
| **Evidence** | `docs/reviews/_evidence-2026-09-26/`, **9.8 MB**: 165 PNGs, 554 JSONs, `capture/manifest.json` (every key, with `status` for kept or pruned), the capture tools, `visual-pass.md` (a per-image record of the first 137 PNGs), `gap-contrast-sweep.json`, `gap-dark-sweep.json`, **`gap-full-sweep.json`** (a <4.5:1 census of all 24 auth surfaces in both themes), `gap-extra-probe.json`, `lighthouse-cold.json` |
| **Result** | **32 findings: 8 objective breakage, 24 advisory** (§2 and §3). All three named re-measures **hold** (§5). **The top finding is new this run and is visual-only**: in dark theme the Workspace Halt Pause / Stop / Resume render black on a near-black card at 1.35:1 (§2 F1). **#2, added after the independent second-read:** in the *default* light theme, status and action colours are used as text below AA on 16 of 24 app pages, including the ◐ / In Progress rows of the first screen after sign-in (§2 F8). Follow-ups minted: **4**: LIN-3119, **LIN-3123**, LIN-3120, LIN-3121 (§9, each dup-checked immediately before minting). Second-read: **DISAGREE · differed from top finding NO · fixed in place** (§ Adversarial Second-Read). |

> **Review-only.** No product code, stylesheet, config or document under review was modified. This report and its evidence directory are the only artifacts committed.

---

## 1. Scope and method

### 1.1 Where the surfaces came from

Derived from code, not from the ticket's prose (`_evidence-2026-09-26/research-notes.md` §4, which gives commands and line numbers):

* **Route table.** Page GETs in `server.js` and `routes/*.js`, excluding `/api/` and `/test/`. That gives **40 rendered destinations**: 10 cold, 26 workspace-scoped, and 4 pre-auth error/consent GETs.
* **`ls docs/archive/`** gives 7 documents. **5, 6 and 7 are new public pages in this window.** `/archive/:n(\d+)` is a digits-only `sendFile` with no allow-list (`server.js:1870`). Its 404 (`/archive/999`) is a distinct rendered state.
* **The experimental registry** (`lib/feature-defaults.js:166-176`) now has **9 members**, including `ship-journey`. All nine were rendered with their flags on.
* **Newly in remit, not named by the ticket:**
  * the `/auth/openrouter` consent interstitial
  * the `/archive/:n` 404
  * the **Scan-due tab**, which lives on **Observation**, not Settings (§8.4)
  * Dispatch's **Workspace Halt** section (LIN-3026)

  The Proxy halt (LIN-3025) is API-only and has no rendered control. Proxy was rendered anyway, which confirms that.

### 1.2 Class bounds

| class | bound |
|---|---|
| themes | light (default) · cookie dark (`theme-dark` asserted before every shot) · media-emulated dark for the standalone documents (landing, cold `/ship`/`/swipe`/`/swim`, archives), labelled `darkMode: 'media'` |
| viewports | 1400×1000 · 390×844 · 360/320 for archives, cold previews, `/ship` and the error family |
| auth modes | cold (fresh context per surface) · `/test/set-session` with all flags on · provider seeds for local / GitHub / GitHub Projects / Jira · the in-process mock Yap backend for Collective |
| error family | rendered through the production renderers with request interception at the real origin, so `/style.css` and computed styles are the real ones |

### 1.3 Capture modes

Every manifest row carries `captureMode`:

* `viewport`: 1400×1000 or 390×844.
* `fullPage`: files ending `.fp.png`. Used for the error/consent family, Ship, the operator read-outs, Settings, Dispatch, Proxy and the Scan-due tab.
* `pageEnd`: files ending `.pe.png`. The final viewport of the archive documents, which is where the colophon (D7) and the trailing links (§3) live.

Two capture artifacts are named so nobody reports them as defects (`visual-pass.md`, A1–A4):

* **A1.** Archives 1, 2 and 4 fade content in (`.reveal`, 0.5 s), so the 200 ms page-end shots caught them mid-fade. The settled re-shoots are kept (`*.pe-settled.png`).
* **A3.** Dispatch's four async sections read "Loading…" at 300 ms and have loaded by 6 s (`dispatch-settled-*.fp.png`).

### 1.4 How this stage closed the "no image-capable reader" gap

The research worker had **no image input** (research-notes §6d and §7.7). Every research verdict was a number: overflow, heading census, contrast sample, footer count. This stage ran on an image-capable model and passed a self-test first: it transcribed `archive-4-light-390px.pe.png`. It then:

1. **Viewed every kept PNG.** That is 137 images, one row each in `visual-pass.md`, set against the paired JSON verdict.
2. **Filled the capture gap.** Settings, Dispatch and Proxy (full page, both themes, 1400 and 390), the Scan-due tab, settled Dispatch, and settled archive page-ends.
3. **Re-rendered the 30 surfaces that research had kept as JSON only** and viewed all 120 frames (both themes, 1400 and 390). Beat 2 kept the ten frames it cited. **After the second-read** (its ask 3), one light 1400 **full-page** render was also kept for each of the 24 authenticated surfaces among them (`<surface>-light-1400px.fp.png`, via `capture/capture-gap.mjs keep24`), so every verdict below is citable. The other frames are recorded in the manifest as regenerable.
4. **Replaced the first-match contrast sample with a composited full-page sweep.** The research tool read only the **first** element per selector and stopped at the first translucent background. That is how it reported `button` / `a` at 14.23:1 on pages whose halt controls sit at 1.35:1 (§8.5). The new sweep composites alpha layers down to an opaque background and checks **every** text-bearing element. It was run on 8 surfaces × 2 themes (`gap-contrast-sweep.json`), then on all 24 authenticated app surfaces in dark with a <3:1 cut-off (`gap-dark-sweep.json`). **After the second-read** it was run as a full AA census: every group under 4.5:1, on all 24 surfaces, in **both** themes (`gap-full-sweep.json`). The dark census matched the <3:1 pass exactly, so F1's "6 of 24" is a full census. The light census produced F8.
5. **Ran Lighthouse** (12.8.2, accessibility) on five cold surfaces (`lighthouse-cold.json`). Research had planned this but never run it.

**Evidence budget.** Beat 1 left the directory at 12 MB. This stage pruned 6 superseded PNGs (the 300 ms Dispatch shots and two mid-fade archive ends; their JSON is kept). It kept only the ten beat-2 re-renders this report cites, and palette-quantised every PNG (256 colours, no dither; the defect colours were checked after quantising). The result was 7.9 MB. The second-read's ask to keep one PNG per authenticated surface added 24 full-page renders (1.6 MB), for **9.8 MB** in total, about 1.5× the 08-29 set over a scope roughly 6× wider. Quantising is safe because every colour or contrast figure below comes from JSON, never from PNG pixels.

---

## 2. Findings: objective breakage (severity-ranked)

These eight are follow-up-eligible, listed in severity order. Each cites its exact evidence by file name in `_evidence-2026-09-26/`. **IDs are stable, not ranks.** F8 was added after the second-read and ranks **second**. F1–F7 keep their IDs because the minted tickets (LIN-3119/3120/3121) already cite them.

### F1 · In dark theme, unthemed action buttons and links are unreadable, including the Workspace Halt controls
**Objective · WCAG 1.4.3 · new this run · visual-only (the research JSON reported a pass)**

`.action-btn` (`public/common-actions.css:11`) sets `background: none` and **no `color`**. On a `<button>` the text therefore falls back to the user-agent default, black. `a.settings-action` has **no CSS rule at all**, so it renders in UA link blue. In light theme both are merely off-system. In dark theme they sit on the `rgb(34,36,40)` card and disappear.

| surface | control | colour on bg | ratio |
|---|---|---|---|
| **Dispatch → Workspace Halt** | **Pause · Stop · Resume** | `rgb(0,0,0)` on `rgb(34,36,40)` | **1.35:1** |
| Dispatch → Send Prompt | load Autopilot · load Autopilot · stepped · continue until stopped | same | 1.35:1 |
| Dispatch | "create a preset →" | `rgb(0,0,238)` on `rgb(34,36,40)` | 1.65:1 |
| Settings | 12 links: the 9 "open the …" experimental links, catalog, custom prompts, operator dashboard | UA blue | 1.65:1 |
| Settings → Providers | make active · refresh / test | UA black | 1.35:1 |
| Collective | 6 preset "launch" buttons, "add character", "view prompt" | UA black | 1.35:1 |
| Proxy → Event Log | prev · next | UA black | 1.35:1 |
| Prompts | "custom prompts →" (`a.stat-link`) | UA blue | 1.89:1 |
| Operator Dashboard | "Run Audit" (`button.audit-button`, a different cause: white on the light-blue dark `--focus`-family fill) | `rgb(255,255,255)` on `rgb(110,168,254)` | 2.42:1 |

That is **6 of the 24 authenticated app surfaces** (`gap-dark-sweep.json`). The Workspace Halt section is the worst place for it. Its own disclaimer says the page is for incidents ("This page can load slowly when Linear or the database is degraded…"), and its three controls are the ones that cannot be read. **Stop** in particular carries no treatment that distinguishes it from Pause and Resume (see A3).

`/styleguide`, the design-system baseline, documents neither the bare `.action-btn` nor `.settings-action`. So the system has no reference for the controls that break (A8).

*Evidence:* `dispatch-settled-dark-1400px.fp.png` and `dispatch-settled-dark-390px.fp.png` (halt section loaded, "No halt requested."), `settings-dark-1400px.fp.png`, `settings-dark-390px.fp.png`, `collective-dark-1400px.png`, `prompts-dark-1400px.png`, `audit-dark-1400px.png`, `proxy-dark-1400px.fp.png`, `gap-dark-sweep.json`, `gap-contrast-sweep.json` (`dispatch--dark--1400px`, `settings--dark--1400px`). The orchestrator independently viewed `dispatch-settled-dark-1400px.fp.png` and confirmed the halt controls are near-invisible.

*Existing tickets:* a search on "dark mode contrast", "action-btn", "dark theme button", "theme-dark" and "unreadable dark" found none. LIN-2251 (Done) is the same class on a different element.

---

### F8 · Light theme: status and action colours used as text fall below AA on 16 of 24 app pages, including the first screen after sign-in
**Objective · WCAG 1.4.3, and 1.4.11 for the ◐ glyph · default theme · added after the independent second-read (the visual pass saw it and set it aside as "a palette choice")**

The token layer already ships AA-safe text companions: `--green-dim: #15803d` ("AA-safe green text on light") and `--amber-dim: #8a5a00` ("AA-safe amber text on light") at `public/style.css:128-130`. `/styleguide` declares `--yellow` as a **fill** (`lib/render-styleguide.js:56`). Yet these call sites use the fill tokens `--yellow #d4a600` (`:28`), `--green #16a34a` (`:27`) and `--amber #FFB224` (`:129`, "fill/dot") as **text**. The UI is not consuming its own system, which is the question ticket §3 asks.

| token as text | element(s) | pages | ratio (light) |
|---|---|---|---|
| `--amber` | "⚠ AI is not configured on the server…" (`p.next-run-warning`, `p.ship-biscuit-warning`) | Suggested Next Run, The Ship's Biscuit | **1.68:1** |
| `--yellow` | "Recommended — the agent reaches the tracker…" (`span.feature-note`) | Settings | **2.12:1** |
| `--yellow` | **▼ In Progress** header and every **◐** in-progress glyph (`div.in-progress-header`, `span.status-pill__char`) | **Tree (the default page after sign-in)**, Swim, Ship | **2.15–2.27:1** |
| `--yellow` | priority "Medium" (`span.swim-fc-prio.p3`) | Swim | 2.15–2.27:1 |
| `--green` | every `.action-btn.save`: save · save preset · add · generate · generate & copy · Dispatch ▾ · start · send · ask · copy prompt · run the presses · generate suggestions · start discussion · + new prompt | Settings, Dispatch, Proxy, Flight Companion, Next Run, Passage Planner, Ship's Biscuit, Task Chat, Collective, Custom Prompts | **3.08–3.3:1** |
| `--green` | "● on" toggle states (16), "● live", the ✓ done glyph | Settings, Observation, Roadmap | 3.3:1 |

**Why it ranks #2, above F2 and F3, and below F1.**
* **Above F2/F3:** it breaks AA in the theme every user gets, on the first screen after sign-in, and across 16 of 24 authenticated surfaces. F2 is one view (an experimental radial plus its cold preview). F3 is copy on an error path.
* **Below F1:** F1's 1.35:1 is effectively invisible, on incident controls. F8's worst text (1.68:1, the AI-not-configured warning) is faint but readable, and its most-seen instance (2.27:1) is legible. The second-read ranked it the same way.

It is also the same failure type as F6 (2.94:1) and F7 (3.74:1), in a worse and wider instance. The dark theme is unaffected: the full census finds none of these under 4.5:1 in dark.

*Evidence:* `gap-full-sweep.json` (keys `/--light`, `/settings--light`, `/next-run--light`, `/ship-biscuit--light`, `/swim--light`, `/roadmap--light`, …), `gap-contrast-sweep.json` (`tree--light--1400px`, `settings--light--1400px`, `dispatch--light--1400px`, `proxy--light--1400px`, `ship--light--1400px`, `observation-due--light--1400px`), `tree-light-1400px.png`, `next-run-light-1400px.fp.png`, `ship-biscuit-light-1400px.fp.png`, `swim-light-1400px.fp.png`, `settings-light-1400px.fp.png`. The visual pass had it in its `tree--light--1400px` row and filed it as advisory; this report had then dropped it. That was an omission, corrected here.

*Existing tickets:* none (see §9). LIN-786 (Done) built the `-dim` companions, but these call sites never adopted them.

---

### F2 · `/ship` and `/workspace/:urlKey/ship` still render zero headings (D8)
**Objective · accessibility · carried from 08-29, still reproduces**

Both Ship renders have `h1`–`h6` = 0 and a11y `roleHeading` = 0. Every sibling app page has a title `<h1>`. Ship's `<title>` is the bare `Ship`. Visually the page opens straight into the radial with no page title at all. LIN-2401's fix covered `render-pages.js`, not `lib/render-ship.js` (no `<h1..h6>`, no `renderPageHeader`; source-checked).

This compounds with A2. The radial opens at a fit-zoom where node text is about 3–5 px, so a cold `/ship` visitor gets **no heading and no readable text**.

Lighthouse on cold `/ship` scores 0.95, failing `color-contrast` (the active mode toggle, white on teal, which is the F7 class) and `label-content-name-mismatch` (the zoom reset button).

*Evidence:* `ship-public-light-1400px.fp.png`/`.json`, `ship-light-1400px.fp.png`/`.json`, `ship-light-390px.fp.png`, `lighthouse-cold.json` (`/ship`).

---

### F3 · The upstream error page contradicts its own diagnostic on 5xx and 429 (D5)
**Objective · copy correctness · carried from 08-29, still reproduces on the render**

`renderUpstreamAwareErrorPage` prints one hardcoded sentence, *"the connection closed before it responded"*, on every `upstream` branch. Directly beneath it, the diagnostic box reads:

| trigger | prose | diagnostic on the same screen |
|---|---|---|
| 503 | the connection closed before it responded | **"Linear returned a 503 server error."** |
| 429 | the connection closed before it responded | **"Linear rate-limited the request; it should recover shortly."** |
| ECONNRESET | the connection closed before it responded | "The connection to Linear closed before a response arrived…" ✓ |

This is the error path for the tree, swipe, swim, ship and roadmap routes.

*Evidence:* `err-upstream-5xx-light-1400px.fp.png`, `err-upstream-429-light-1400px.fp.png`, `err-upstream-net-light-1400px.fp.png` (and their dark and 390 siblings), `capture/analysis.json` (`upstreamCopy`).

---

### F4 · The error and consent pages still ship UA-default controls
**Objective · contrast plus a broken layout at 390 · visual-only (new this run)**

| page | defect | measured |
|---|---|---|
| workspace-not-found | the workspace link is UA `rgb(0,0,238)`, underlined; its list bullet is stranded at the far left; no gap before the button | **1.89:1 in dark** |
| **Jira API-token form** (a credential form) | all three inputs are UA Arial 13.33 px with a 2 px inset border, **white in dark**. At 390 the labels and fields wrap independently ("Email" ends one line and its field starts the next beside "API token"). The `id.atlassian.com` link is UA blue. | link 1.89:1 in dark |
| GitHub Projects picker · Jira site picker | UA `<select>`, white in dark; at 390 it butts against the submit button | — |

This is the LIN-2251 class (an unstyled form control) recurring on the pre-auth family.

*Evidence:* `err-workspace-notfound-dark-390px.fp.png`, `jira-link-form-light-390px.fp.png`, `jira-link-form-dark-1400px.fp.png`, `gh-projects-picker-dark-390px.fp.png`, `jira-site-picker-dark-1400px.fp.png`, `gap-extra-probe.json`.

---

### F5 · The upstream error renderer says "Linear" for any backend (§6)
**Objective · provider neutrality · carried, still reproduces in the error renderer**

"Trouble Reaching **Linear**", "We couldn't reach **Linear's** API", and "**Linear** rejected your session…" render on all five branches. There is no provider parameter in the call path, so a GitHub-, Jira- or Local-backed workspace is told that Linear failed.

The view-renderer fallbacks (`render-{roadmap,swim,ship,swipe}.js`) did **not** reproduce under any seed: every provider resolves a display name, and the non-Linear trees render "Local Workspace", "GitHub Workspace" and so on. Those remain `(source, not rendered)`.

*Evidence:* `err-upstream-auth-light-1400px.fp.png`, `err-upstream-5xx-light-1400px.fp.png`, `local-tree-light-1400px.png` (the non-Linear tree carries no "Linear"). Existing tickets LIN-2351, LIN-2354, LIN-2370, LIN-2371 and LIN-561 do not reach `render-pages.js`.

---

### F6 · Archive provenance sign-offs render at 2.94:1
**Objective · contrast on public pages · visual-only (new this run)**

The closing sign-off is the line D7-refined relies on as "the colophon" (§6). It renders `rgb(139,147,160)` on `rgb(250,249,246)` at 12 px mono. That was measured identically on archives 1, 4, 5 and 7, and the `--faint: #8b93a0` token is also declared in 2 (source). Archives 3 and 6 were not measured.

Lighthouse corroborates on `/archive/7`: `color-contrast` fails on 26 nodes (its reading-list anchors), and `label-content-name-mismatch` fails on 14 back-links whose `aria-label` differs from their visible text.

*Evidence:* `archive-1-light-1400px.pe-settled.png`, `archive-4-light-1400px.pe-settled.png`, `archive-5-light-390px.pe.png`, `archive-7-light-390px.pe.png`, `gap-extra-probe.json`, `lighthouse-cold.json` (`/archive/7`).

---

### F7 · `.login-button` white-on-teal renders at 3.74:1 (one site-wide class)
**Objective · contrast · cite-only, never re-mint (LIN-739, LIN-849)**

`.login-button { background: var(--brand); color: var(--bg) }` gives white on `rgb(13,148,136)`, **3.74:1**. The class covers:

* the merge-confirm and OpenRouter primaries
* every error-page "Try again" and "Go to homepage" button
* the picker submit buttons
* the archive-404 "Go back"
* the active Ship mode toggle

The landing CTA ("Log in with Linear", dark ink on teal, 4.43:1) is the LIN-739 instance, independently re-flagged by Lighthouse on `/` (`color-contrast`, 14 nodes).

*Evidence:* `err-merge-confirm-light-1400px.fp.png`, `openrouter-consent-light-390px.fp.png`, `archive-404-light-390px.pe.png`, `capture/analysis.json` (`mergeButtons`), `lighthouse-cold.json` (`/`).

---

## 3. Findings: advisory (ranked)

These are real, recorded, and never minted.

| # | finding | evidence |
|---|---|---|
| A1 | **`<title>` drift has widened (D6).** "- Projects" (the pre-rename brand) is now the **most common** convention, on **22** surfaces: every `render-pages.js` page and the tree/roadmap under all five providers. "- Experimental" leaks into 8 tabs. 7 titles are bare (`Ship`, `Observation`, `New task`, `Choose a Jira site`, `Connect Jira` …). The census groups them into 10 buckets, including one-offs. Consistency, not breakage; LIN-975 (Done) covered the in-page `<h1>`, not `<title>`. | `capture/analysis.json` (`titleCensus`, `conventionCounts`) |
| A2 | **Ship opens illegible.** Default fit-zoom is 45% (cold, 1400), 41% (auth, 1400) and 15% (390), so node text is about 3–5 px. Cold `/ship` renders pixel-identical in media-dark and light: it ignores `prefers-color-scheme` where the landing honours it. Authenticated Ship uses a full-bleed 32 px gutter against every other page's centred column. | `ship-public-light-390px.fp.png`, `ship-public-dark-1400px.fp.png`, `ship-light-1400px.fp.png` |
| A3 | **Workspace Halt: "Stop" is styled the same as Pause and Resume.** It is the LIN-2400 class (a consequential action that looks like its benign siblings) on a new incident surface. Advisory because Resume exists. | `dispatch-settled-light-1400px.fp.png` |
| A4 | **The nav strip shows a different slice on every page.** The flag-gated links come out in a **different DOM order per page** (Observation starts at passage planner, Swim at live console), and the strip is `nowrap; overflow-x: auto` (`public/style.css:448-449`). The visible slice therefore shifts from page to page, and on the observation-session page the strip runs past the right edge. | `tree-light-1400px.json`, `settings-light-1400px.fp.json` (`navFoot.navLinks`), `tree-light-1400px.png`, `observation-session-light-1400px.fp.png`, `swim-light-1400px.fp.png` |
| A5 | **Mono used for prose.** Dispatch `.guide-halt-note` is 16 px JetBrains Mono, larger than its section title. Settings `.model-workspace-note` is 16 px mono. The Scan-due disclaimers and the effort-readout explainer are mono prose. This breaks CLAUDE.md's "mono for machine facts, sans for human prose". | `dispatch-settled-light-1400px.fp.png`, `observation-due-light-1400px.fp.png`, `gap-contrast-sweep.json` (`fonts`) |
| A6 | **D7-refined:** archives 4, 5 and 6 do not wrap their provenance sign-off in a `<footer>` landmark (`footerCount 0`). It is a semantics nicety; the colophon content is present (§6). | `archive-4-light-1400px.pe-settled.png`, `archive-5-light-1400px.pe.json` |
| A7 | **No archive offers a route into the app (§3), and neither does the archive 404.** 0 home / workspace / nav links on all 7; the 404's only exit is "Go back". | `capture/links-reconciliation.json`, `archive-404-light-1400px.pe.png` |
| A8 | **`/styleguide` omits the controls that break.** It shows no bare `.action-btn` and no `.settings-action`, and its Field component renders a UA `<select>`. | `styleguide-light-1400px.fp.png` |
| A9 | **Sparse heading structure on the new operator surfaces.** Effort-readout and escalation-KPIs render one `<h1>` each; the tile and kind labels are styled text. | `effort-readout-light-1400px.fp.png`, `escalation-kpis-light-1400px.fp.png` |
| A10 | **Internal references in user copy:** "(pending LIN-2995)", "LIN-2566 §5", "LIN-2567", "docs/escalation-philosophy.md §7". | `dispatch-settled-light-1400px.fp.png`, `effort-readout-light-1400px.fp.png`, `escalation-kpis-light-1400px.fp.png` |
| A11 | **Settings toggle pills take two shapes.** Wherever the description beside a pill is long, it collapses into a stacked "●/on" square. | `settings-light-1400px.fp.png` |
| A12 | **Settings experimental-link labels are raw camelCase flag keys** ("taskChat:", "flightCompanion:"). | `settings-light-390px.fp.png` |
| A13 | **At 390 the `harbour.cat` wordmark is absent on every app page**, and the workspace name truncates ("Test Wo…") with free space beside it. | `tree-light-390px.png`, `local-tree-light-390px.png` |
| A14 | **Two brand marks.** The error/consent family heads with Inter "Harbour"; the app and landing use mono `harbour.cat`. | `err-generic-light-1400px.fp.png`, `landing-light-1400px.png` |
| A15 | **Two KPI heading languages (carried).** `/kpis` uses a mono lowercase "instance kpis"; `/escalation-kpis` uses sans Title Case with no section headings. | `kpis-light-1400px.png`, `escalation-kpis-light-1400px.fp.png` |
| A16 | **Live Console zoom presets (3m/15m/1h/6h, fit/1h/24h) are still small pills.** Visually unchanged and not re-measured in px this run. Cite LIN-2221 / LIN-1018. | `live-console-light-1400px.fp.png` |
| A17 | **Upstream-error diagnostic box:** a wrapped "Reason" value falls back to column 0 instead of hanging in the value column. | `err-upstream-net-light-390px.fp.png` |
| A18 | **Consent screens:** the primary and secondary buttons stack about 2 px apart. | `err-merge-confirm-light-390px.fp.png`, `openrouter-consent-light-1400px.fp.png` |
| A19 | **The Operator Dashboard's "Run Audit" is an off-palette blue** (`#2563eb` in light), where every other primary action is teal. It is also the 2.42:1 dark instance in F1. | `audit-dark-1400px.png` |
| A20 | **The Scan-due tab label wraps to "Scan-/due" at 390**, and the Proxy prompt placeholder breaks mid-word ("toke/n"). | `observation-due-light-390px.fp.png`, `proxy-dark-390px.fp.png` |
| A21 | **The nav feedback trigger (LIN-2298) reads as plain "feedback" text** at chrome weight, top-right; it renders only when `feedbackWidget` is on. The old "FAB blue" item is moot. It works as-is. | `tree-light-1400px.png` |
| A22 | **The Collective status dot has no state colour (carried).** Not re-driven this run; see §7. | — (08-29 measurement) |
| A23 | **`/kpis` colour-only series encoding (carried).** Not re-checked this run; the charts are below the kept viewport. See §7. | — |
| A24 | **The keyless local landing shows a "┌─ Getting started / Set `LINEAR_ACCESS_TOKEN`" self-host box** under the CTA. Live `https://harbour.cat/` does not (curl, 2026-09-26). This is the zero-credential self-host state the 09-26 Onboarding review owns (R2-6 → LIN-3108), so it is **not double-flagged** here. | `landing-light-1400px.png` |

### 3.1 Per-surface verdicts for the window's heavy-churn authenticated surfaces

The second-read noted that several surfaces with heavy churn in this window (ticket §2) had no verdict of their own. Each one has a kept light 1400 full-page render; all 24 were also covered by the both-theme census (`gap-full-sweep.json`).

| surface (window churn) | verdict | evidence |
|---|---|---|
| **Flight Companion** (+1.8k JS / +460 CSS) | The chat panel, "How to use", the kickoff prompt and the read-only observer report read in a clear order. The status line mixes a mono machine fact (`openai/gpt-5.4-mini`) with sans labels, which is correct. The "How to use" steps are 16 px mono prose (A5 class). "start" and "send" are the F8 green at 3.08:1. There is no F1 instance in dark. | `flight-companion-light-1400px.fp.png` |
| **Observation**, Autopilot tab (+2.7k JS) and the session page | Tabs and filter chip are clean, as is the empty state "○ nothing running right now". "● live" is F8 green at 3.3:1. The session page's 404 ("Session not found") is coherent, and it is where the nav strip visibly clips (A4). | `observation-light-1400px.fp.png`, `dashboard-light-1400px.fp.png`, `observation-session-light-1400px.fp.png` |
| **Task Chat** (agent-turn core, LIN-2966) | Task / Conversation / Saved chats boxes. The red "AI is not configured" note passes. "ask" is F8 green. This is empty state only. | `task-chat-light-1400px.fp.png` |
| **Ship Journey** | Empty state only ("not enough charted history yet"). It has a title and a subtitle, and nothing fails. | `ship-journey-light-1400px.fp.png` |
| **Live Console** | Clean section rhythm, and the mono section marks are decorative. The preset pills are still small (A16). This is empty state only. | `live-console-light-1400px.fp.png` |
| **Swim / Swipe** (authenticated) | Both are legible. Swim's ◐ and "Medium" are F8 `--yellow` at 2.15–2.27:1. Swipe's disabled ← is exempt. | `swim-light-1400px.fp.png`, `swipe-light-1400px.fp.png` |
| **Roadmap** | Clean, scannable shipped feed. The ✓ glyphs are F8 green at 3.3:1. Otherwise it works as-is. | `roadmap-light-1400px.fp.png` |
| **Suggested Next Run · Ship's Biscuit · Passage Planner** | Each has a clear Generate → Options (or Run → Front page) structure. The amber "AI is not configured" warning is **1.68:1** (F8, the worst instance). Passage Planner's kickoff prompt block is long mono, which is appropriate for machine text. | `next-run-light-1400px.fp.png`, `ship-biscuit-light-1400px.fp.png`, `passage-planner-light-1400px.fp.png` |
| **Collective** (mock Yap) | Dense but orderly Set up form. "launch" is F1 in dark and "start discussion" is F8 in light. | `collective-light-1400px.fp.png` |
| **Task create / edit** | The create form is clean, and "Create task" is the F7 teal class. The edit render is the withdrawn harness 500 (§6.3). | `task-new-light-1400px.fp.png`, `task-edit-light-1400px.fp.png` |
| **Prompts · Custom Prompts · Operator Dashboard** | Legible. "+ new prompt" is F8 green, and "Run Audit" is off-palette blue (A19). | `prompts-light-1400px.fp.png`, `custom-prompts-light-1400px.fp.png`, `audit-light-1400px.fp.png` |
| **Provider trees** (GitHub, GitHub Projects, Jira, Local roadmap route) and **Jira Settings** | Each renders its workspace name, with no "Linear" (F5's fallbacks not reached). The ◐ In Progress rows visually carry the same `--yellow` text as F8. These provider seeds are outside the census (§7.12), so they are not measured. | `github-tree-light-1400px.fp.png`, `ghp-tree-light-1400px.fp.png`, `jira-tree-light-1400px.fp.png`, `local-roadmap-light-1400px.fp.png`, `jira-settings-light-1400px.fp.png` |

---

## 4. First experience: the cold visitor

**Required section.** It covers how the surfaces *look and read*. Whether the *journey* completes belongs to the **2026-09-26 Onboarding & Cold-Start review** (`docs/reviews/onboarding-cold-start-review-2026-09-26.md`, LIN-3106). Its findings (R2-2 unlinked provider list, R2-6 ungated Linear CTA → LIN-3108, R2-11 bare 404s) are cited, not re-flagged.

**What it is and how it works.** The landing (`landing-light-1400px.png`) has a clear first read, second read and third read:

1. the wordmark, then the tagline "keep human intent in command of AI execution"
2. one dominant teal CTA
3. the provider list and how-it-works steps

The cold previews show the product itself, not screenshots of it. **`/swipe`** reads immediately: "Triage tasks one card at a time", with a real card and 1/14 paging (`swipe-public-light-1400px.png`). **`/swim`** shows five labelled lanes of the product's own roadmap (`swim-public-light-1400px.png`). **`/templates`** and **`/kpis`** are legible, self-describing and Lighthouse-clean (1.00 each; `templates-light-1400px.png`, `kpis-light-1400px.png`). **`/ship` is the weak door:** no heading, and text too small to read at the default zoom (F2, A2).

**The single primary CTA** ("Log in with Linear") is the most prominent element on `/` at both widths. It goes full-width at 390 (`landing-light-390px.png`). Its dark-ink-on-teal is 4.43:1, the LIN-739 instance (F7); Lighthouse re-flags it. Lower-stakes chrome doesn't compete with it. The one exception is the local-only self-host box directly under it (A24).

**Archives.** The seven archives are the richest cold surfaces and read as deliberate editorial objects. 1, 2 and 4 are serif with mono artefact voices; 3 and 7 are Inter with label rails; all reflow at 390 with no page overflow (LIN-2402 holds, §5). But every one ends in a 2.94:1 sign-off (F6) and offers no route into the app (A7). A search visitor who reads archive 7 to the end gets a link to archive 5 and nothing else.

**First-impression verdict.** In the first five seconds, the landing, `/swipe`, `/swim`, `/templates` and the archives look **trustworthy and intentional**. The mono/sans split, box-drawing scaffolding and restrained teal read as a **deliberate CLI design language**, not a default. That impression breaks in two places a cold visitor can reach:

* `/ship`: headless and unreadable at the default zoom.
* the error/consent family: plain "Harbour" wordmark (A14), UA-default form controls on the Jira credential form (F4), and white-on-teal buttons below AA (F7).

Once signed in, the impression is strong but not clean in **either** theme. In light (the default), the first screen's **In Progress** header and every ◐ glyph are pale amber at 2.27:1, and the green save/generate buttons across 10 operator pages sit at about 3.1:1 (F8; the second-read caught this). In dark, three high-use operator pages (Settings, Dispatch, Collective) show near-invisible controls (F1). Together they are the largest hit to "polished" in this run.

**Lighthouse (12.8.2, accessibility, cold, light, default mobile emulation):**

| surface | score | failing audits |
|---|---|---|
| `/` | 0.96 | `color-contrast` (14: landing CTA + step numerals; LIN-739) |
| `/templates` | **1.00** | none |
| `/kpis` | **1.00** | none |
| `/archive/7` | 0.96 | `color-contrast` (26), `label-content-name-mismatch` (14) (F6) |
| `/ship` | 0.95 | `color-contrast` (1, F7 class), `label-content-name-mismatch` (1) (F2) |

*Evidence:* `lighthouse-cold.json`.

---

## 5. Tier-B re-measures: LIN-2400, LIN-2401, LIN-2402

### LIN-2400 (merge-consent differentiation and sizing): **HOLDS**

The confirm is filled teal `rgb(13,148,136)` with white text. The decline is a chromeless outline (`background: transparent`, `1px solid rgb(221,221,221)`, ink `rgb(26,26,26)`). Both are 16 px Inter, `cursor: pointer`, **46 px tall**. On 08-29 they were pixel-identical at 13.33 px / 42 px with `cursor: default`. The render confirms it: the destructive choice is now visually dominant and the safe choice clearly secondary, in both themes.

Residuals: the stack gap (A18) and the 3.74:1 primary (F7). *Evidence:* `err-merge-confirm-{light,dark}-{1400,390}px.fp.png`, `capture/analysis.json` (`mergeButtons`).

### LIN-2401 (error-page subject as a real heading): **HOLDS**

Every error/consent subject is `<h2 class="error-title">`, and a11y role ≡ DOM on all **18** captured variants (merge confirm/reauth, generic, 5 upstream, workspace-not-found, 3 pickers, Jira form, OpenRouter consent, 3 raw callbacks, archive 404): `h1` "Harbour" + `h2` subject on each, plus two `h3` group headings on the GitHub repo picker. The render confirms the subject reads as the page's heading beneath the "Harbour" mark. **Scope caveat:** the fix does not reach Ship (F2). *Evidence:* `err-*-light-1400px.fp.json` (`headings.a11y`), `capture/analysis.json` (`errHeadings`).

### LIN-2402 (archive `.chip` nowrap overflow): **HOLDS on the measurement; the render confirms no page overflow but cannot see the chips**

There is zero document-level horizontal overflow at 320, 360 and 390 on all 7 archives (`scrollWidth == clientWidth`, no offenders). On 08-29 it was 531/390 on 1 and 2 and 425/390 on 4. Research confirmed the long `.chip.ev` content is still present and now wraps (`measurements-summary.md` §9).

**Qualified (visual-pass C5):** the kept 390 page-end PNGs show no overflow, but those frames don't contain the chip rows. This verdict rests on JSON plus the source check, not on a PNG. The regression guard **LIN-2491** is still Backlog: cite only, never re-mint. *Evidence:* `archive-{1..7}-light-{320,360,390}px.json`.

---

## 6. Inherited claims: overturned or refined

1. **D7, "`/archive/4` ships without the colophon": overturned as framed, refined to a landmark note.** Every archive 1–7 ends with a visible provenance sign-off. Archive 4's reads *"THE HARBOUR ARCHIVE · THE AUGUST WING · compiled by the flight companion for John Kershaw · sources: … · harbour.cat"*, under a "Colophon & provenance" block. What holds is that archives 4, 5 and 6 don't wrap it in a `<footer>` element (A6). **New qualifier this run:** the sign-off exists but fails contrast at 2.94:1 (F6). *Evidence:* `archive-4-light-1400px.pe-settled.png`, `archive-4-light-390px.pe.png` (the self-test image, captured mid-fade; A1).
2. **§3, "every archive has zero links back into the product": refined.** There are 0 links into the app on all 7, so that part holds (A7). But "zero links" was literally wrong. Archive 5 links to archive 4. Archive 7 links to 2, to 5, and to `https://harbour.cat/archive/5`. Archives 1, 2 and 4 mention `harbour.cat` as plain text. *Evidence:* `capture/links-reconciliation.json`.
3. **Task-edit 500: withdrawn as a harness artifact.** The test-token seed fails a real Linear GraphQL call (401), which falls through to "Something Went Wrong". With a real session the route takes its 400/404 paths (`routes/task-edit.js:93,146`). The render shows a coherent error page with "Back to tasks" and a home link. *Evidence:* `task-edit-light-1400px.json`.
4. **"Settings Scan-due tab": relocated.** The research notes and the plan both placed Scan-due on Settings. It is Observation's **fourth tab** (`lib/render-observation.js:183`, LIN-2667). The research `settings` capture never measured it, and the `observation` capture rendered the default Autopilot tab. So before this stage Scan-due was **unmeasured and unrendered**. It is now captured with the tab clicked (`observation-due-*.fp.png`, `dueSectionVisible: true`, h1 + 5 h2), in its empty state only.
5. **"Dark contrast passes on Settings/Dispatch/Proxy" (implied by research JSON): overturned.** The `contrast` arrays in `{settings,dispatch,proxy}-dark-*.json` report `button`/`a` at 14.23:1. Those are first-match samples of the workspace switcher and the wordmark. The composited sweep over every element finds F1. It is the same reframe for workspace-not-found's link (F4).
6. **"Nav experimental links share one DOM order": overturned.** This was carried from research into beat 1's V9. The order differs per page (A4).

---

## 7. Coverage limits: named, not faked

1. **Non-Linear merge-consent and reauth screens were not rendered.** The only seam (`/test/set-merge-conflict-session`, `routes/test.js:306`) hardcodes `provider: 'linear'`. The GitHub, GitHub Projects and Jira confirm/reauth copies remain un-rendered by any design review.
2. **The unresolved-provider "Linear" fallbacks are source-only.** Every seed resolves a display name, so that branch is unreachable without injecting a provider with no `ui.displayName` (F5).
3. **Upstream outages are synthetic.** They are rendered by calling the production renderer with `{status: 401/429/503}`, `{code: 'ECONNRESET'}` and `Error('boom')`, not from a live outage.
4. **Archive dark is media-emulated and JSON-only.** It has no PNG. Archives 1–4 carry no `prefers-color-scheme` rules, so their "dark" is identical to light.
5. **Contrast heuristics.** The composited sweep fixes the translucent-layer mis-resolution. It is still blind to `background-image`, pseudo-elements and text over non-ancestor layers. Individual ratios are heuristic; the V1 and V2 numbers were cross-checked against the rendered PNGs.
6. **Sparse seeded data.** Effort-readout, escalation-KPIs, Scan-due, Observation, Live Console, Ship Journey and Ship's Biscuit render their empty or zero states. No capture shows a populated effort read-out, a due-row list, or a busy Live Console.
7. **Carried advisory items not re-driven:**
   * the Collective status-dot state colours (A22), which need the offline flip
   * `/kpis` colour-only chart encoding (A23), where the charts are below the kept viewport
   * the Live Console preset sizes in px (A16)
8. **Lighthouse ran on 5 cold surfaces only**, light, with default mobile emulation. Authenticated pages were not Lighthouse-audited; their accessibility evidence is the heading census and the contrast sweeps.
9. **The live instance was compared for the landing only** (a curl of `https://harbour.cat/`). The one drift found is local-only, not a live defect (A24).
10. **Focus order and keyboard reach** were not re-walked this run. The 08-29 merge-confirm focus result (`:focus-visible` uses `--focus`, with two clean stops) is inherited, not re-verified.
11. **PNGs are palette-quantised** (§1.4). They are fine for layout and hierarchy judgments. Colour figures come only from JSON.
12. **Contrast-sweep thresholds and reach (named after the second-read, then closed where cheap):**
    * The beat-2 dark sweep recorded only groups **under 3:1**, so "6 of 24" was not a full AA census. **Closed:** the <4.5:1 census in both themes (`gap-full-sweep.json`) found no further dark groups.
    * Beat 1's light sweep reached only **8 surfaces**. Swim, Swipe, Roadmap and Audit consume `--yellow` and were unmeasured. **Closed:** the census covers all 24 authenticated surfaces in light (Swim and Roadmap fail, F8; Swipe has only the exempt disabled ← and a 3.55:1 teal ▶ disclosure glyph, which passes the 3:1 non-text bar; Audit has none).
    * **Still open:** the census covers the 24 authenticated app surfaces only. Cold pages, archives and the error/consent family are covered by the first-match JSON, the targeted probe (`gap-extra-probe.json`) and Lighthouse on 5 cold pages, not by the composited census.
13. **Interactive nav states were never captured.** That covers the **open** team and assignee dropdowns (LIN-2519/2527), the registry-driven switcher "add" rows (LIN-2802/2803), the `⋯ more` expander opened, and the model-picker `<select>` (LIN-2719) opened. Research checked only that the selectors are present (`measurements-summary.md` §5). None has a verdict.
14. **Heavy-churn surfaces are judged only in their empty or sparse states** (§3.1). Flight Companion was never driven through a live turn, Task Chat has no conversation, Observation has no running session, and Ship Journey has no charted history. Each now has a kept render and a verdict on what renders, but not on its populated states.

---

## 8. Maker coverage gap: handed off, not fixed

The committed makers (`tests/visual/*.spec.js`; `tests/screenshots/` last regenerated 2026-09-12) cover:

* `/styleguide`, `/privacy`, `/terms`, `/kpis`, `/templates`
* Swim, Ship, the Rulings tab
* a dispatch overlay/toast

They cover **none** of:

* the 7 archives or the archive 404
* the error/consent family (merge, pickers, Jira form, OpenRouter consent, the 5 upstream branches)
* Settings, the Workspace Halt section, the Scan-due tab
* effort-readout, escalation-KPIs, Collective, Flight Companion
* **any dark-theme capture of an operator page**, which is why F1 could ship unseen

Per the brief, these were captured live, and the gap is **handed to the test/code-quality altitude** (precedent: LIN-868, LIN-941). The committed makers were not extended.

---

## 9. Follow-ups minted: 4 (one over the ~3 cap, with the reason given)

All four are objective breakage. Each is left in its default state (**Backlog**), unassigned, with a `related` link to LIN-3101. The duplicate check was re-run **immediately before minting** (2026-09-27): `/api/proxy/search` on the concept and on the file/selector, plus `/api/proxy/issues/LIN-3101/relations`, which was empty. No cite-only ID was re-minted.

| ticket | finding | dup-check result |
|---|---|---|
| **LIN-3119** | **F1**: in dark theme, bare `.action-btn` / `a.settings-action` / `a.stat-link` render UA black or blue on the dark card. This includes Workspace Halt Pause/Stop/Resume at 1.35:1, on 6 of 24 auth surfaces. | Searched "action-btn", "settings-action", "common-actions", "dark theme contrast", "dark mode button", "unstyled button dark", "Workspace Halt", "halt pause stop resume". **No existing ticket names these controls.** Adjacent, different elements: LIN-738 (`+proxy` toggle, Done), LIN-2251 (escalation-KPI `<select>`, Done), LIN-2222 (`.login-button-jira`), LIN-2711 (Scan-due bulk-bar classes with no CSS), LIN-3074 (halt *copy*, not contrast). |
| **LIN-3123** | **F8**: light theme status/action colours used as text below AA (◐ / In Progress 2.27:1, AI-not-configured warning 1.68:1, save/generate 3.08:1) on 16 of 24 auth surfaces | Minted **after the second-read**. Duplicate check re-run immediately before minting: amber / yellow / green contrast, status-pill contrast, save button contrast, in-progress contrast, `--yellow`, `green-dim`, `amber-dim`, state indicator contrast, `toggle-state`, `next-run-warning`, and LIN-3101 relations. **None names this.** LIN-786 (Done) built the AA-safe `-dim` companions that these call sites never adopted. LIN-738 and LIN-570 fixed other elements with the same token-misuse class. LIN-739 and LIN-849 cover the teal CTA and focus rings. |
| **LIN-3120** | **F2**: `/ship` and `/workspace/:urlKey/ship` render zero headings, with a bare `<title>` | Searched "ship heading(s)", "render-ship", "ship accessibility", "ship title". **LIN-266 (Canceled) was read in full.** It concerns the Ship view's nautical *heading* label convention (north-star tagging), not HTML heading elements, so it is **not a duplicate**. LIN-2401 (Done) covered `render-pages.js` only. |
| **LIN-3121** | **F3**: upstream error prose contradicts its own diagnostic on 5xx/429 | Searched "renderUpstreamAwareErrorPage", "connection closed before it responded", "upstream error copy", "rate-limited error page", "503 error page", "Trouble Reaching Linear". **None names the copy contradiction.** LIN-2351 and LIN-2363 concern "Linear" naming in the proxy and autopilot, which is F5's class, not this. |

**Why a fourth follow-up instead of displacing LIN-3121.** F8 is objective breakage in the **default** theme and ranks above the existing follow-ups (#2, below only F1). LIN-3121 (F3) is also real, and cancelling it would drop a finding. The ticket's cap is "up to ~3". Exceeding it by one for a higher-ranked default-theme breakage is better than leaving the #2 objective finding unticketed. This was the orchestrator's decision after the second-read.

**Next in line, not minted:** F4 (UA controls on the consent family), F5 (error renderer says "Linear"; LIN-2351/2354/2370/2371/561 don't reach `render-pages.js`), F6 (archive sign-off contrast). **Cite-only:** F7 → LIN-739 / LIN-849. LIN-2402's guard → LIN-2491.

---

## 10. Advisory tail: actionable, ranked

Each item is before → after within the CLI idiom, measured against `/styleguide`. Mint nothing from this list.

1. **Give the dark theme a pass on every bare control** (this pairs with follow-up 1).
   *Before:* 6 of 24 app pages have UA-black buttons and UA-blue links in dark.
   *After:* `.action-btn` inherits `var(--text)`, links use the app's link token, and `/styleguide` gets an "action buttons" row in both themes. **Top item: the largest polish gain for the least change.**
2. **Route status text to the AA-safe companions** (pairs with follow-up LIN-3123).
   *Before:* `--yellow`, `--green` and `--amber` fills used as text (◐ 2.27:1, save 3.08:1, warning 1.68:1).
   *After:* text uses `--amber-dim` / `--green-dim` (plus a `--yellow` text companion if the in-progress hue must stay distinct from amber). Fills and dots keep the fill tokens, and `/styleguide` shows each status token as fill *and* text.
3. **Make Ship open readable.**
   *Before:* 15–45% fit-zoom, no title.
   *After:* open at a zoom where node labels are ≥ 11 px, clip the radial rather than shrink it, and add the page's `<h1>`. Honour `prefers-color-scheme` on the cold preview.
4. **One `<title>` convention.**
   *Before:* 10 convention buckets; "- Projects" on 22 surfaces.
   *After:* `<Page> · <Workspace> · Harbour` everywhere, archives included, with no tier label in the tab.
5. **Differentiate Stop.**
   *Before:* Pause, Stop and Resume are identical text.
   *After:* Stop takes the danger-colour treatment the codebase already uses for `.provider-remove-btn`, and Resume stays the quiet default. It's the LIN-2400 pattern, applied to the halt row.
6. **Put human prose in sans.**
   *Before:* the halt note, the model note and the Scan-due disclaimers are 16 px mono.
   *After:* Inter at the muted token, keeping mono only for the `POST …` paths inside them.
7. **Stabilise the nav strip.**
   *Before:* experimental links in a per-page order inside a clipped scroller.
   *After:* one fixed order and a visible `⋯ more` at every width.
8. **Lift the archive sign-off to ≥ 4.5:1** (`--faint` → the `--muted` value) and make its `harbour.cat` a link. That turns every archive's last line into a route home.
9. **One brand mark.**
   *Before:* Inter "Harbour" on error pages.
   *After:* the mono `harbour.cat` wordmark from the app header. Keep the wordmark at 390.
10. **Clean the copy.** Drop the internal ticket and doc references from user copy (A10), and humanise the Settings flag-key labels (A12).
11. **Already works as-is (apart from the F8 colour tokens noted in §3.1):** the landing's hierarchy (`landing-light-1400px.png`), the cold `/swipe` and `/swim` previews, `/templates`, Roadmap (`roadmap-light-1400px.fp.png`), Task Chat (`task-chat-light-1400px.fp.png`), the Scan-due tab's structure, and the LIN-2400 consent differentiation. No change proposed beyond F8.

---

## Adversarial Second-Read

* **Tier: Tier 1.** A wholly separate dispatched session (dispatch `eec3309a`): claude-code, Opus 5.5, image-capable (it passed its own image self-test). It shared no context with this report's author and was read-only on PR #1597 at `a81ec0cb`. It was dispatched by the orchestrator, not by this session. This session did not review itself.
* **The question, asked cold:** *"What is the largest item in this window that this report missed or misfiled?"* The reader was also asked whether scope was silently shrunk, whether every claim carries a citation, and whether any "still reproduces" verdict contradicts a fresh PNG.
* **The reader's full answer**, verbatim from LIN-3101 comment `53aa5982` (2026-09-27T07:27:48Z):

> ## Adversarial second-read (independent, Tier 1)
>
> **Reader:** a separate dispatched session (dispatch `eec3309a`, claude-code, Opus 5.5). It shares no context with the report's author. **Read-only:** I checked out PR #1597 at `a81ec0cb` and changed nothing.
> **Image self-test passed.** The last visible line of `archive-4-light-390px.pe.png` is *"JKershaw/simple-dispatcher · harbour.cat"*. It closes the sign-off "THE HARBOUR ARCHIVE · THE AUGUST WING · compiled by the flight companion for John Kershaw · sources: JKershaw/LinearViewer ·".
>
> ### The question
>
> > **"What is the largest item in this window that this report missed or misfiled?"**
>
> ### Answer: the report left out the light-theme failures of the product's own status colours
>
> The miss is a class of light-theme WCAG failures on the product's own state and action colours. The **default** theme fails, on the **flagship** page. The report's own evidence measured it. The visual pass noted it. Then the report dropped it: it is not an objective finding, not an advisory row, and not a coverage limit.
>
> From `gap-contrast-sweep.json` (light, 1400, composited):
>
> | surface | element | colour on bg | ratio |
> |---|---|---|---|
> | **Tree** (`/workspace/:urlKey/`, the default page after sign-in) | `div.in-progress-header` "▼ In Progress" (16px/600) | `rgb(212,166,0)` on white | **2.27:1** |
> | Tree | `span.status-pill__char` **◐** (10 instances) | same | **2.27:1**, which also fails the 3:1 non-text minimum (1.4.11) |
> | Ship | `span.swim-box-state…status-pill--in-progress` ◐ (5) | same | 2.27:1 |
> | Settings | `span.feature-note` "Recommended — the agent reaches the tracker…" | `rgb(212,166,0)` on `rgb(247,247,247)` | **2.12:1** |
> | Settings / Dispatch / Proxy | `button.action-btn.save`: **save**, **save model overrides**, **save dispatch defaults**, **save preset**, **add**, **generate**, **generate & copy**, **Dispatch ▾** | `rgb(22,163,74)` on `rgb(247,247,247)` | **3.08–3.13:1** |
> | Settings / Observation | `span.toggle-state` "● on" (16), `span.obs-poll-status` "● live" | `rgb(22,163,74)` on white | 3.3:1 |
>
> - **The render confirms it.** In `tree-light-1400px.png` the whole In Progress section is faint amber on white. It is legible to me, but clearly below the grey project-context text beside it.
> - **The visual pass saw it and set it aside.** `visual-pass.md`, row `tree--light--1400px`, says: *"◐ amber glyph + 'In Progress' header 2.27:1 on white (sweep `tree--light`), a pre-existing palette choice (§ advisory)"*. But the report has **no** advisory row for it. `grep -E "2\.27|2\.12|3\.08|yellow|In Progress"` over `design-interface-review-2026-09-26.md` returns nothing. The ticket's §8 says to record every finding, including the ones you don't promote, so this is a straight omission.
> - **It is the design system failing itself.** That is exactly the question the brief poses in §3: does the UI consume its own system? The ◐ in-progress indicator is one of the three state indicators CLAUDE.md names. `--yellow: #d4a600` (`public/style.css:28`) is declared in `/styleguide` as `kind: 'fill'` (`lib/render-styleguide.js:56`). Yet `var(--yellow)` is used as a **text** colour 21 times across 5 stylesheets (style, swim, swipe, settings, audit). The green save and "on" states are the same pattern with `--green`.
> - **It is new to the record.** No design review from 06-20 through 08-29 mentions it (a grep for `yellow|d4a600|2.27|3.08` across `design-interface-review-*.md` finds nothing). A search for "amber contrast", "in-progress contrast", "status pill contrast", "save button contrast", "green contrast" and "state indicator contrast" found no ticket. LIN-849 and LIN-739 cover the teal CTA and focus rings, not these tokens.
> - **Why it is the largest miss:**
>   - It is objective breakage: WCAG 1.4.3, and 1.4.11 for the glyph.
>   - It is in the **default** theme, so every signed-in user sees it on their first screen.
>   - It reaches at least Tree, Ship, Settings, Dispatch, Proxy and Observation. Swim, Swipe, Roadmap and Audit also consume `--yellow`, but the light sweep covered only 8 surfaces, so they were never measured.
>   - F1 is 1.35:1, but only in the opt-in dark theme. This class is 2.1–3.3:1 in the theme everyone gets. I rank it at least level with F2 and F3, and above F4–F7.
>
> ### Scope: not silently shrunk as a count, but the window's named items were thinned without saying so
>
> - **Counts verified.**
>   - Route table: page GETs in `server.js` + `routes/*.js` + `lib/github-install-flow.js`, excluding `/api` and `/test`. That gives 40 rendered destinations, which matches research-notes §4a.
>   - `ls docs/archive/` gives 1–7.
>   - `EXPERIMENTAL_VIEWS` (`lib/feature-defaults.js:166-176`) has 9 entries.
>   - `git rev-list --count b78c4499..6e8bf424` = 625.
>   - The "40 + 7 + 404 + 9 + error family" claim holds.
> - **But the ticket's §2 window items got no verdict.**
>   - Flight Companion (+1.8k JS / +460 CSS) is never judged. It appears only in the §8 maker-gap list.
>   - Observation's default tab and the session page (+2.7k JS) appear only through A4.
>   - Ship Journey and Live Console appear only in the sparse-data limit and A16.
>   - Task Chat is "works as-is" (§10.10), with no kept evidence behind it.
>   - The nav rework's interactive states were never captured. That covers the registry-driven switcher "add" rows (LIN-2802/2803), the **open** team and assignee dropdowns (LIN-2519/2527), and the model-picker `<select>` (LIN-2719). `measurements-summary.md` §64–65 checks only that the selectors are present. None of this is named in §7 coverage limits.
> - **Evidence retention.** No PNG was kept for 24 authenticated surfaces, including every heavy-churn one: `flight-companion`, `task-chat`, `live-console`, `observation`, `observation-session`, `dashboard`, `roadmap`, `swipe`, `swim`, `ship-journey`, `ship-biscuit`, `passage-planner`, `next-run`, `task-new`, `task-edit`, `custom-prompts`, and the github/ghp/jira trees. They are marked "viewed impl beat 2, not kept". So "every surface was viewed as an image" can't be checked for exactly the surfaces the window changed most. A16 cites "beat-2 re-render (viewed, not kept)", which is no citation. The dark sweep does cover these surfaces, with 0 groups under 3:1, so F1's reach is backed.
> - **The dark sweep only records groups under 3:1** (`gap-dark-sweep.json` note). The report never says so, and "6 of 24" reads as a full AA census. Dark failures between 3:1 and 4.5:1 are unenumerated.
>
> ### Citations: the ones I opened check out
>
> - **F1:** confirmed. `dispatch-settled-dark-1400px.fp.png` shows Pause / Stop / Resume, load Autopilot and continue until stopped as near-invisible. "create a preset →" is invisible blue. The sweep rows match (`dispatch--dark--1400px`: `halt-pause`/`halt-stop`/`halt-resume` 1.35). **"6 of 24" re-counted: correct.** Settings, dispatch, proxy, collective, prompts and audit each have a real group. The other two sub-3:1 hits are exempt: `/swipe`'s `swipe-arrow-left` 1.36 is the `disabled` Previous button (`lib/render-swipe.js:625`), and `/prompts`' `stat-separator` is a decorative "·".
> - **F2:** confirmed. `ship-public-light-1400px.fp.png` has no heading, a 45% zoom and illegible node text.
> - **F4:** confirmed. In `jira-link-form-light-390px.fp.png` "Email" ends one line and its field starts the next beside "API token". The inputs are UA-default and `id.atlassian.com` is UA blue.
> - **F3 / F5:** the visual-pass rows match the report's quoted diagnostics.
> - **D7-refined:** the self-test image matches the report's quoted sign-off.
> - **Weak spots:** A16 (no kept evidence), and the "works as-is" list for Roadmap and Task Chat (no kept evidence).
>
> ### Verdicts: no contradiction with a fresh PNG
>
> - LIN-2400 and LIN-2401 HOLD, D5, D8 and §6 still reproduce, and D7/§3-refined all match the PNGs I checked.
> - The LIN-2402 HOLD is honestly qualified as resting on JSON rather than a PNG (C5).
> - **One misfiling:** the light-theme `--yellow`/`--green` text class above is objective breakage, but it is filed nowhere. The visual pass tagged it "advisory", and the report dropped even that.
>
> ### Ranking
>
> - **F1 as #1 is defensible, and I would keep it.** A 1.35:1 control is effectively invisible, and these are incident controls, while 2.27:1 is faint but readable.
> - **The rest of the ranking is not defensible without the missing class.** Light-theme status and save colours should sit at #2, above F2 (the zero-heading Ship, an experimental view plus a cold preview) and F3 (error copy), and well above F6 (2.94:1 archive sign-off) and F7 (3.74:1). The report promotes F6 and F7, which are milder instances of the same failure type, while leaving out the worse and wider default-theme instance.
> - **Follow-ups.** The follow-up cap is already reached (LIN-3119/3120/3121). The fix in place is to add this finding as an objective F-row with its evidence, record that it outranks F3 or F2, and list it first under "next in line, not minted". Whether it should displace LIN-3121 is a call for whoever merges.
>
> ### Asks for the report author (fix in place, docs-only)
>
> 1. Add an objective finding for light-theme `--yellow` text (◐ glyph and In Progress header at 2.27:1, "Recommended" note at 2.12:1) and `--green` text (save/add/generate at 3.08:1, "● on"/"● live" at 3.3:1). Cite `gap-contrast-sweep.json` (`tree--light--1400px`, `settings--light--1400px`, `dispatch--light--1400px`, `proxy--light--1400px`, `ship--light--1400px`, `observation-due--light--1400px`), `tree-light-1400px.png`, `public/style.css:27-28` and `lib/render-styleguide.js:56`. Re-rank it, and correct the headline count (31 findings / 7 objective).
> 2. Add to §7 coverage limits:
>    - the dark sweep's under-3:1 threshold
>    - the light sweep's 8-surface reach (Swim, Swipe, Roadmap and Audit use `--yellow` and are unmeasured)
>    - the nav dropdown and switcher open states, and the model-picker `<select>`, never captured
>    - Flight Companion (and the other heavy-churn surfaces) have no committed PNG and no verdict
> 3. Either keep one PNG per heavy-churn surface, or soften "Every surface was viewed as an image" to say that those views aren't in the evidence.
>
> Adversarial second-read verdict: DISAGREE · Differed from top finding: NO · Recommended disposition: fixed in place
>
> *(Close-out mapping: `Disposition` = the recommendation above; this reader cannot apply it.)*

### Disposition: fixed in place

| # | reader's ask / point | what changed (section) | notes |
|---|---|---|---|
| 1 | Add an objective finding for light-theme `--yellow` / `--green` text; re-rank it; correct the headline counts | **Added F8** (§2, placed second). Its table widened after a full light census of all 24 auth surfaces: it now covers **16 of 24** surfaces and adds a worse instance the reader didn't list, the `--amber` "AI is not configured" warning at **1.68:1**. Counts corrected: front-matter **Result** row, 31 → **32** findings and 7 → **8** objective. §2's intro now says eight. §4's signed-in paragraph now names F8. §10 gets a new tail item 2. **Follow-up LIN-3123 minted** (§9). | **Ranked #2, as the reader recommended**: above F2/F3 because it breaks AA in the default theme on the first screen after sign-in and across 16 pages; below F1 because 1.35:1 incident controls are effectively invisible while F8's text is faint but readable. IDs are kept stable (F8, not a renumber) because LIN-3120/3121 already cite F2/F3. |
| 1a | The visual pass saw it and filed it as "a palette choice (§ advisory)"; the report then dropped it | F8's evidence note records the omission explicitly | No self-exoneration: it was a straight omission against ticket §8 ("record every finding"). |
| 2a | The dark sweep's <3:1-only threshold made "6 of 24" look like a full AA census | **Closed by measurement, not just named.** A <4.5:1 census on all 24 surfaces in both themes (`gap-full-sweep.json`) found no further dark groups, so "6 of 24" now stands as a full census. §1.4 item 4 and §7.12 record both the limit and its closure. | — |
| 2b | Light sweep reached only 8 surfaces; Swim, Swipe, Roadmap, Audit unmeasured | **Closed by measurement.** All 24 are in the light census. Swim and Roadmap fail (folded into F8); Swipe has only the exempt disabled ← and a 3.55:1 ▶ glyph (passes 3:1 non-text); Audit has none (§7.12). | The census still excludes cold pages, archives and the error family (§7.12, "still open"). |
| 2c | Nav dropdown / switcher open states and the model-picker `<select>` were never captured | Named as coverage limit **§7.13** | Not captured in this beat. |
| 2d | Heavy-churn surfaces had no verdict (Flight Companion et al.) | **New §3.1**: a per-surface verdict for Flight Companion, Observation and its session page, Task Chat, Ship Journey, Live Console, Swim/Swipe, Roadmap, Next Run / Ship's Biscuit / Passage Planner, Collective, Task create/edit, Prompts / Custom Prompts / Operator Dashboard, the provider trees and Jira Settings. Each cites a kept render. The empty-state-only limit is named in **§7.14**. | — |
| 3 | Keep one PNG per heavy-churn surface, or soften "every surface was viewed" | **Kept.** One light 1400 full-page PNG for each of the 24 authenticated surfaces beat 2 had viewed but not kept (`capture/capture-gap.mjs keep24`, palette-compressed). The manifest is repointed from "viewed, not kept" to the kept `--fp` keys. A16's uncitable "(viewed, not kept)" is now `live-console-light-1400px.fp.png`, and A4 and §10.11 cite real keys. The front-matter claim stands and now says every surface has a kept PNG. | All 24 re-rendered; none needed softening. `observation-session` (404) and `task-edit` (harness 500) render their expected states. |
| — | F1 as #1 is defensible; F1's "6 of 24", F2, F4 and the D7 image confirmed; no verdict contradicts a fresh PNG | No change | Recorded as agreement. |
| — | Weak spots: A16 had no kept evidence; "works as-is" for Roadmap and Task Chat had no kept evidence | Fixed under ask 3. §10.11 now cites `roadmap-light-1400px.fp.png` and `task-chat-light-1400px.fp.png`, and qualifies Roadmap with its F8 ✓ glyph. | — |
| — | Whether F8 should displace LIN-3121 is "a call for whoever merges" | **Orchestrator decision: mint as a fourth follow-up; keep LIN-3121.** The rationale is in §9. | — |

**Adversarial second-read verdict: DISAGREE** · **Differed from top finding: NO** · **Disposition: fixed in place**
