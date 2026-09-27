# Design & Interface Review — 2026-09-26

**Periodical run (eighth).** Origin LIN-520 · task LIN-3101 · prior runs LIN-565 · LIN-568 · LIN-671 · LIN-736 · LIN-942 · LIN-1924 · LIN-2381.

| | |
|---|---|
| **Grounded on** | `6e8bf424` (research HEAD). Re-grounded against `origin/main` at `90193471` (3 later commits, all under `scripts/eval/` or `docs/reviews/`; none touches a rendered surface) |
| **Window** | `b78c4499..6e8bf424`: **625 commits** (`git rev-list --count`), which matches the ticket's "~625" |
| **Method** | Fresh renders on a keyless `NODE_ENV=test` server (`:3199`), programmatic measurement (JSON beside every capture), **plus an image-capable read of every rendered surface** (§1.4). Both themes; dark comes from the real `theme` cookie, with `theme-dark` asserted in the same read. Viewports 1400 and 390, with 360/320 sweeps where geometry was in doubt. |
| **Scope (not shrunk)** | **All 40 page-GET destinations** from the route table, the **7 archive pages** plus the `/archive/:n` 404 state, **all 9 experimental views**, and the **error/consent family** (merge confirm/reauth, 3 provider pickers, Jira link form, OpenRouter consent, workspace-not-found, 5 `renderUpstreamAwareErrorPage` branches, 3 raw callback failures). Research measured 70 surface keys in 376 captures, and every one of them is rendered. **Every surface was viewed as an image in this stage.** Surfaces with a kept PNG: 38 from research and beat 1, plus 10 kept from the 30-surface re-render in beat 2 (§1.4). |
| **Evidence** | `docs/reviews/_evidence-2026-09-26/`, **7.9 MB**: 141 PNGs, 529 JSONs, `capture/manifest.json` (every key, with `status` for kept or pruned), the capture tools, `visual-pass.md` (a per-image record of 137 PNGs), `gap-contrast-sweep.json`, `gap-dark-sweep.json`, `gap-extra-probe.json`, `lighthouse-cold.json` |
| **Result** | **31 findings: 7 objective breakage, 24 advisory** (§2 and §3). All three named re-measures **hold** (§5). **The top finding is new this run and is visual-only**: in dark theme the Workspace Halt Pause / Stop / Resume render black on a near-black card at 1.35:1 (§2 F1). Follow-up candidates: **3** (§9, minted in the next stage after a duplicate check). |

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
3. **Re-rendered the 30 surfaces that research had kept as JSON only** and viewed all 120 frames (both themes, 1400 and 390). The ten frames this report cites are kept. The rest are recorded in the manifest as `viewed impl beat 2 …, not kept — regenerable`.
4. **Replaced the first-match contrast sample with a composited full-page sweep.** The research tool read only the **first** element per selector and stopped at the first translucent background. That is how it reported `button` / `a` at 14.23:1 on pages whose halt controls sit at 1.35:1 (§8.5). The new sweep composites alpha layers down to an opaque background and checks **every** text-bearing element. It was run on 8 surfaces × 2 themes (`gap-contrast-sweep.json`) and then on **all 24 authenticated app surfaces in dark** (`gap-dark-sweep.json`).
5. **Ran Lighthouse** (12.8.2, accessibility) on five cold surfaces (`lighthouse-cold.json`). Research had planned this but never run it.

**Evidence budget.** Beat 1 left the directory at 12 MB. This stage pruned 6 superseded PNGs (the 300 ms Dispatch shots and two mid-fade archive ends; their JSON is kept). It kept only the ten beat-2 re-renders this report cites, and palette-quantised every PNG (256 colours, no dither; the defect colours were checked after quantising). The result is **7.9 MB**, about 1.2× the 08-29 set over a scope roughly 6× wider. Quantising is safe because every colour or contrast figure below comes from JSON, never from PNG pixels.

---

## 2. Findings: objective breakage (severity-ranked)

These seven are follow-up-eligible. Each cites its exact evidence by file name in `_evidence-2026-09-26/`.

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
| A4 | **The nav strip shows a different slice on every page.** The flag-gated links come out in a **different DOM order per page** (Observation starts at passage planner, Swim at live console), and the strip is `nowrap; overflow-x: auto` (`public/style.css:448-449`). The visible slice therefore shifts from page to page, and on the observation-session page the strip runs past the right edge. | `tree-light-1400px.json`, `settings-light-1400px.fp.json` (`navFoot.navLinks`), `tree-light-1400px.png` |
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
| A16 | **Live Console zoom presets (3m/15m/1h/6h, fit/1h/24h) are still small pills.** Visually unchanged and not re-measured in px this run. Cite LIN-2221 / LIN-1018. | beat-2 re-render (viewed, not kept) |
| A17 | **Upstream-error diagnostic box:** a wrapped "Reason" value falls back to column 0 instead of hanging in the value column. | `err-upstream-net-light-390px.fp.png` |
| A18 | **Consent screens:** the primary and secondary buttons stack about 2 px apart. | `err-merge-confirm-light-390px.fp.png`, `openrouter-consent-light-1400px.fp.png` |
| A19 | **The Operator Dashboard's "Run Audit" is an off-palette blue** (`#2563eb` in light), where every other primary action is teal. It is also the 2.42:1 dark instance in F1. | `audit-dark-1400px.png` |
| A20 | **The Scan-due tab label wraps to "Scan-/due" at 390**, and the Proxy prompt placeholder breaks mid-word ("toke/n"). | `observation-due-light-390px.fp.png`, `proxy-dark-390px.fp.png` |
| A21 | **The nav feedback trigger (LIN-2298) reads as plain "feedback" text** at chrome weight, top-right; it renders only when `feedbackWidget` is on. The old "FAB blue" item is moot. It works as-is. | `tree-light-1400px.png` |
| A22 | **The Collective status dot has no state colour (carried).** Not re-driven this run; see §7. | — (08-29 measurement) |
| A23 | **`/kpis` colour-only series encoding (carried).** Not re-checked this run; the charts are below the kept viewport. See §7. | — |
| A24 | **The keyless local landing shows a "┌─ Getting started / Set `LINEAR_ACCESS_TOKEN`" self-host box** under the CTA. Live `https://harbour.cat/` does not (curl, 2026-09-26). This is the zero-credential self-host state the 09-26 Onboarding review owns (R2-6 → LIN-3108), so it is **not double-flagged** here. | `landing-light-1400px.png` |

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

Once signed in, the impression is strong **in light theme**. In dark theme, three high-use operator pages (Settings, Dispatch, Collective) show near-invisible controls (F1). That is the single largest hit to "polished" in this run.

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

## 9. Follow-up candidates (≤ 3, objective breakage only)

These are drafted here and **minted in the next stage**. Each is dup-checked immediately before minting via `/api/proxy/search` and `/relations`. Cite-only IDs are never re-minted.

| rank | finding | proposed scope | dup-check status |
|---|---|---|---|
| 1 | **F1**: dark-theme unthemed `.action-btn` / `.settings-action` / `.stat-link` (incl. Workspace Halt Pause/Stop/Resume, 1.35:1) | give `.action-btn` a themed `color`, style `a.settings-action` / `a.stat-link` from tokens, fix the `.audit-button` dark fill; add the bare variants to `/styleguide` | beat-1 search: **none found**. Re-check before minting. |
| 2 | **F2**: `/ship` and `/workspace/:urlKey/ship` render zero headings | a real page `<h1>` (visually hidden if the radial must stay chromeless) + a non-bare `<title>` | **LIN-266** is related, not exact. Verify before minting. |
| 3 | **F3**: upstream error prose contradicts its diagnostic on 5xx/429 | branch the sentence on the classified code | research search: **none**. Re-check before minting. |

**Next in line, not minted (cap):** F4 (UA controls on the consent family), F5 (error renderer says "Linear"), F6 (archive sign-off contrast). **Cite-only:** F7 → LIN-739 / LIN-849. LIN-2402's guard → LIN-2491.

---

## 10. Advisory tail: actionable, ranked

Each item is before → after within the CLI idiom, measured against `/styleguide`. Mint nothing from this list.

1. **Give the dark theme a pass on every bare control** (this pairs with follow-up 1).
   *Before:* 6 of 24 app pages have UA-black buttons and UA-blue links in dark.
   *After:* `.action-btn` inherits `var(--text)`, links use the app's link token, and `/styleguide` gets an "action buttons" row in both themes. **Top item: the largest polish gain for the least change.**
2. **Make Ship open readable.**
   *Before:* 15–45% fit-zoom, no title.
   *After:* open at a zoom where node labels are ≥ 11 px, clip the radial rather than shrink it, and add the page's `<h1>`. Honour `prefers-color-scheme` on the cold preview.
3. **One `<title>` convention.**
   *Before:* 10 convention buckets; "- Projects" on 22 surfaces.
   *After:* `<Page> · <Workspace> · Harbour` everywhere, archives included, with no tier label in the tab.
4. **Differentiate Stop.**
   *Before:* Pause, Stop and Resume are identical text.
   *After:* Stop takes the danger-colour treatment the codebase already uses for `.provider-remove-btn`, and Resume stays the quiet default. It's the LIN-2400 pattern, applied to the halt row.
5. **Put human prose in sans.**
   *Before:* the halt note, the model note and the Scan-due disclaimers are 16 px mono.
   *After:* Inter at the muted token, keeping mono only for the `POST …` paths inside them.
6. **Stabilise the nav strip.**
   *Before:* experimental links in a per-page order inside a clipped scroller.
   *After:* one fixed order and a visible `⋯ more` at every width.
7. **Lift the archive sign-off to ≥ 4.5:1** (`--faint` → the `--muted` value) and make its `harbour.cat` a link. That turns every archive's last line into a route home.
8. **One brand mark.**
   *Before:* Inter "Harbour" on error pages.
   *After:* the mono `harbour.cat` wordmark from the app header. Keep the wordmark at 390.
9. **Clean the copy.** Drop the internal ticket and doc references from user copy (A10), and humanise the Settings flag-key labels (A12).
10. **Already works as-is:** the landing's hierarchy, the cold `/swipe` and `/swim` previews, `/templates`, Roadmap, Task Chat, the Scan-due tab's structure, and the LIN-2400 consent differentiation. No change proposed.

---

## Adversarial Second-Read

**Pending: an independent Tier-1 read dispatched separately by the orchestrator (fresh session, image-capable, no shared context).**

This section will record the tier used, the exact question ("What is the largest item in this window that this report missed or misfiled?"), the reader's full answer, a disposition table, and the three-field verdict (`Adversarial second-read verdict` · `Differed from top finding` · `Disposition`). This implementation session does not review its own report.
