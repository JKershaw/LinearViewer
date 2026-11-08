# Design & interface review: tenth run (LIN-4391)

Rendered-product review of the window `0b4bd287..c998cf4c5` (419 commits, 417 product files), grounded on `main` @ `c998cf4c5`. Evidence: `docs/reviews/_evidence-2026-11-08/` (paths below are relative to it; `coverage-map.md` lists what was run). Every finding cites a fresh render or probe from this run. Colour figures come from the census and probe JSON, not from the PNGs. Review-only: no product code, CSS, config, test or doc under review was changed.

This is the first run under the converted template (LIN-4380). It feeds the area notes and mints no tickets. Zero issues were created by this run (section 9).

## 1. Summary

* **Most of run 9's breakage is fixed.** LIN-3119 (dark bare controls), LIN-3121 (upstream prose), LIN-3761 (Library tables clipped), LIN-3762 (archive muted text tier), LIN-3763 (dark UA links and native controls) and LIN-739 (the cold login button's teal) are Done, and each held on fresh renders. Dark theme is now nearly clean: 5 of 220 measured surfaces have any group under 4.5:1 in dark. Four are disabled swipe arrows or decorative separators; the fifth is archive 3's `✓` status glyph at 2.63:1 (non-text, section 2 #3).
* **Still open, and the largest item by reach: green and gold status colour used as text.** Status pills, the Proxy "generate" buttons, observation poll status and the `styleguide` glyphs fail AA in light theme (2.27 to 3.3:1). LIN-3123 covers this and is Backlog. It reaches the public landing (status pill) and two email pages.
* **The teal wordmark accent (`.cat`) is 3.74:1 on white in light theme on 41 registry ids.** LIN-739 fixed the CTA fill, not the wordmark. LIN-849 names the landing CTA only; its scope should widen (section 2, finding 3).
* **New objective breakage the run found without a ticket:** the Jira site picker overflows a 390px phone by 52px (122px at 320, #7). On Dispatch, Pause, Stop and Resume look identical, and Stop stops running sessions (#8). On Settings › Models, 86 form controls have no accessible name (42 harness selects, 42 effort inputs, 2 preset inputs; #4). Proxy has one unnamed select and a placeholder-only label (#5). `/swipe` still disables pinch zoom (#6). Routed in section 9.
* **First impression is good.** The landing has one filled door, a plain definition and a readable sign-in set. The CLI character (mono wordmark, ◐ ○ states, tree rules) reads as deliberate on the tree, Settings and Library. It is plainer on the error and email family, where the shell heading is a sans "Harbour" rather than the wordmark.

## 2. Findings, severity-ranked

Severity: **S1** content unreachable or unusable; **S2** AA contrast failure on readable text in a public or primary surface; **S3** AA failure on a secondary surface, a non-text indicator, or a structural or semantic defect; **S4** polish or copy. "Ticket" is the open or Done item that owns the finding; "unticketed" findings are routed in section 9.

| # | sev | finding | where (this run's evidence) | disposition |
| -- | -- | -- | -- | -- |
| 1 | S2 | **Status and action green used as text, light theme.** `#16a34a` on white or pale fills: status pill "done" 3.08:1 on the landing (also `email-register`, `email-reproof`, `account`, `styleguide`); pill glyph 3.3:1; `btn--quiet.btn--green` (Proxy "generate") 2.71–2.75:1; `button.action-btn.save` 2.71:1 on 5 ids; `obs-poll-status` and `toggle-state` 3.3:1. Swim's "Medium" priority label `span.swim-fc-prio.p3`, gold `#d4a600` at 11px: 2.15:1 on `ws-swim`, 2.27:1 on the public Swim page (named in LIN-3123's description). Gold `#d4a600` as text: `styleguide` `.sg-glyph` 2.27:1; amber `code` 1.68:1 on `ws-ship-biscuit`. | `census.json` (light, 1400); `remeasure/lin-3123.json` | **ticket LIN-3123** (Backlog). Still reproduces. |
| 2 | S2 | **Teal wordmark accent on white.** `.cat` in `#0d9488` is 3.74:1 on white in light theme. The census lists 41 light ids: every authenticated workspace page (tree, Settings and its eight areas, Dispatch, Proxy, Runner, Ship, Swim, Swipe and others), the workspace-tree variants, and the task-not-found renderer. The cold and email pages are not on the list, and the landing's wordmark passes. Dark theme passes. | `census.json` (`span.wordmark-accent`); `lib/components/wordmark.js` | **ticket LIN-849** (Backlog; scope is the landing CTA only). Recommend widening LIN-849 to the wordmark. A 5.47:1 token (`#0f766e`) is already defined as `--brand-dim` (`public/style.css:128`). |
| 3 | S3 | **Archive status glyphs below 3:1 (non-text).** `✓` 1.82:1 light (archive-3) and 2.63:1 dark; `◐` 3.13:1 light; tree branch glyphs `├─` 1.6:1 (decorative). The muted text tier that LIN-3762 covered now passes: no archive text group is under 4.5:1. | `census.json` (archive ids, `span.glyph`, `span.branch`); `remeasure/f6.json` | **LIN-3762 Done** for text. Residual glyphs: no area file (archive pages are under `docs/archive`, outside the registry); closing comment. |
| 4 | S3 | **Settings › Models: 86 unnamed form controls.** 42 `select.harness-select`, 42 `input.dispatch-effort-input` (one per job row), 2 `input.dispatch-preset-name-input`. Objective (WCAG 4.1.2). The probe ran all 8 areas: sources, running, agent-access, health, change-log, features and account have 0. Lighthouse on Settings ran on the sources area, which is why run 9's "settings 0.87" did not reproduce. | `remeasure/unnamed-controls.json`; owner `lib/render-settings.js` | **unticketed** (run 9 #29, now a different set of controls). Area note, front-end-pages (section 9). |
| 5 | S3 | **Proxy: one unnamed select and one placeholder-only label.** `select.proxy-scope-select` has no label; `input.token-label-input` ("Label (optional)") has only a placeholder. Lighthouse on Proxy: `select-name` 0. | `remeasure/unnamed-controls.json`; `authenticated/lighthouse-proxy.json` (a11y 0.92); owner `lib/render-proxy.js` | **unticketed** (run 9 #29, Proxy part). Area note, front-end-pages. |
| 6 | S3 | **`/swipe` disables pinch zoom.** `viewport: width=device-width, initial-scale=1.0, user-scalable=no` (`lib/render-swipe.js:144`, cited to file). Lighthouse `meta-viewport` fails; a11y 0.93. Objective (WCAG 1.4.4), public page. | `lighthouse/swipe-public.json`; `lib/render-swipe.js` | **unticketed** (run 9 #30, still in source). Area note, front-end-pages. |
| 7 | S3 | **Jira site picker overflows the phone viewport.** The native `select#jira-site-select` has its right edge at 442px, so the page scrolls horizontally: 52px over at 390, 122px over at 320. The 1400px render is clean. Objective (mobile overflow). Reach: a user whose Jira grant spans several sites. The render is the production renderer with synthetic site names. | `jira-site-picker-light-390px.json`, `jira-site-picker-light-320px.json`, `jira-site-picker-light-1400px.json`; owner `lib/render-pages.js` | **unticketed.** Area note, front-end-pages; closing comment. |
| 8 | S3 | **Dispatch halt controls: Pause, Stop and Resume render identically.** All three compute to the same text colour, transparent background and no border (`rgb(0,0,0)`). Stop is the destructive one: its own copy says "Running sessions are stopped too." The component declares red for Pause and Stop, but the `buttons` presentation the Dispatch page uses does not read the tone. This is run 9 A3 (S4) promoted: a destructive control that looks like its reverse. | `remeasure/a3.json`; `lib/components/halt-controls.js` (`CONTROLS`, `willHappen`, the `buttons` branch) | **unticketed.** Area note, front-end-pages; closing comment. |
| 9 | S3 | **`/ship` and `/workspace/:urlKey/ship`: zero headings, bare title "Ship".** | `remeasure/lin-3120.json` | **ticket LIN-3120** (Backlog). Still reproduces. |
| 10 | S3 | **Two `<h1>` on every Library document.** 117 of 117 documents carry two: the shell "Harbour" and the document title. The index has one. Structural (run 9 #10). | `remeasure/library-h1.json` | **unticketed.** Area note, front-end-pages (`lib/render-library.js`). |
| 11 | S3 | **Styleguide dark swatches captioned with light values.** `--bg` swatch is dark, caption `#ffffff`; `--fg` swatch is light, caption `#1a1a1a`; `--green` swatch is the dark-theme green, caption `#16a34a`. This is the visual baseline page. Run 9 #24, still reproduces. LIN-3957 and LIN-3960 are open on this page but cover other defects. | `styleguide-dark-1400px.png` (image-read); `remeasure/a1.json` context | **unticketed.** Area note, front-end-pages (`lib/render-styleguide.js`). |
| 12 | S3 | **Shell "Harbour" heading instead of the wordmark on cold and error pages** (A14). Inter "Harbour" in the page shell (`err-upstream-429`, styleguide, guest 404) beside the mono `harbour.cat` wordmark in the nav. | `err-upstream-429-light-390px.png` (image-read); `remeasure/a13-a14.json` | recorded (A14 still reproduces). Judged once as a class; copy and brand, advisory tail. |
| 13 | S3 | **Public Ship labels are 9px nominal.** 16 of 53 leaf text elements on `/ship` (1400px) compute at 9px and 11 at 11px, at the default 45% canvas zoom. The labels are hard to read at default zoom. Legibility, not contrast. | `remeasure/ship-public-type.json`; `ship-public-light-1400px.png` (image-read) | recorded. Advisory tail item 4. |
| 14 | S4 | **Guest share 404: title and copy.** Status 404, `<title>` "Not Found - Projects" (A1), one link "Go back" to `/`. Run 9 #9, still reproduces. | `remeasure/a1.json` | recorded. Advisory tail item 5. |
| 15 | S4 | **Title drift** (A1): "Test Workspace - Projects" on the tree; bare "Ship" ×2; "Observation"; "Live Console"; "Run on my machine"; the landing title is a full sentence. | `remeasure/a1.json` | cited (run 9 #18). |
| 16 | S4 | **Backlog names itself by the workspace.** `/backlog` headings read "Test Workspace", the nav item is "tasks", and the tree links to "Backlog ›". Three names for one destination. | `backlog-light-1400px.png` (image-read) | recorded. Advisory tail item 6. |
| 17 | S4 | **Mono prose** (A5): KPIs 9 words, Swim 8, Styleguide 2, Live Console 1, Ship's Biscuit 1. | `remeasure/a5.json` | cited (run 9 #21). |
| 18 | S4 | **Internal ticket ids in user copy** (A10): Library (6), Styleguide (18), Proxy (`LIN-123`), Passage Planner (2), and new `LV-10`…`LV-17` on public Ship and Swim. | `remeasure/a10.json` | cited (run 9 #22); the `LV-` ids are new. |
| 19 | S4 | **Getting-started spacing.** A paragraph after a bullet list sits flush under the last bullet. Prose column is sound. | `getting-started-light-1400px.png` (image-read) | recorded. |
| 20 | S4 | **Settings › Models "Show N more" buttons look like text inputs** (grey box, no disclosure glyph). Affordance. | `settings-models-light-1400px.png` (image-read) | recorded. Advisory tail item 1. |
| 21 | S4 | **Swipe previous arrow 1.1:1 (light) and 1.36:1 (dark)** at card 1. It is the disabled state (`1 / 14`), which is exempt from contrast. Enabled state not measured. | `census.json` (`button.swipe-arrow-left`); `swipe-public-light-390px.png` | recorded; not an objective breakage. |
| 22 | S4 | **Swipe top nav wraps at 390.** "+ local workspace", "Sign in →", "GitHub →", "Email →" break onto two lines with arrows orphaned. | `swipe-public-light-390px.png` (image-read) | recorded. |

**Resolved since run 9 (re-measured on fresh renders):** LIN-3119 (0 elements under 4.5:1 on Dispatch, Settings, Runner, Proxy); LIN-3121 (429, 502, 401 and 500 prose now agrees with the diagnostic); LIN-3761 (117 of 117 documents at 390 and 320: no unscrolled overflow; the widest table sits in `library-doc__table-wrap`, which scrolls, `remeasure/library-table-reach.json`); LIN-3762 (text tier, section 2 #3); LIN-3763 (no UA-blue or white native controls flagged in the synthetic `f4` renders); LIN-739 (the cold login button passes: Lighthouse 1.00 on `/connect/github/held`, `/auth/email/confirm`, `/t/not-a-real-token`); A13 (wordmark visible in the nav at 390 on every workspace page).

**Performance pass (cold, Lighthouse mobile emulation, 28 routes):** median 0.95. The lowest are `swim-public` 0.56 (CLS 0.384) and `swipe-public` 0.65. CLS above 0.1 on `terms` (0.167) and `library-doc` (0.122). Not a design call, so routed in section 9 as a performance item. The cause of the layout shifts was not traced.

**Checked, clean:** `/styleguide` at 390: `document.body.scrollWidth − clientWidth` = 1, but document `scrollWidth` = 390 and the only element past the edge is `span.sg-value` at 390.73px. No horizontal scroll (`remeasure/styleguide-390-overflow.json`). The spike's `bodyOver: 1` is a sub-pixel spill, not overflow. `og-image.png` (social card) is legible and on brand (image-read). Library: 0 non-200 across 117 documents (`library-clip-sweep.json`).

## 3. Re-measure of run 9's follow-ups

| id | status now | result | JSON |
| -- | -- | -- | -- |
| LIN-3119 | Done, held | 0 elements under 4.5:1 | `remeasure/lin-3119.json` |
| LIN-3120 | Backlog, still reproduces | 0 headings on `/ship` and workspace `/ship` | `remeasure/lin-3120.json` |
| LIN-3121 | Done, held | prose agrees with diagnostic on 429, 502, 401, 500. "Linear" still hard-coded for every backend (F5, source only) | `remeasure/lin-3121-f5.json` |
| LIN-3123 | Backlog, still reproduces | pills, buttons, poll status, styleguide glyphs (section 2 #1). Tree ◐ no longer under 4.5:1 at 1400 | `remeasure/lin-3123.json`, `census.json` |
| LIN-739 | Done, held | cold login button passes AA | `lighthouse/held-connection.json` etc. |
| LIN-849 | Backlog | landing status pill and wordmark (#1, #2) remain | `census.json` |
| LIN-3760 | Backlog | not re-verified this run | (none) |
| LIN-3761 | Done, held | 117/117 documents clean at 390 and 320; tables reachable | `remeasure/library-clip-sweep.json`, `remeasure/library-table-reach.json` |
| LIN-3762 | Done, held | text tier clean; glyph residual (#3) | `census.json`, `remeasure/f6.json` |
| LIN-3763 | Done, held | no UA-blue or native white controls on dark | `remeasure/f4.json` (synthetic) |
| run 9 #10 | still | 117/117 documents with two `<h1>` | `remeasure/library-h1.json` |
| run 9 #24 | still | styleguide dark captions light-valued | section 2 #11 |
| run 9 #29 | changed | Settings 0 except Models (86); Proxy 2 | `remeasure/unnamed-controls.json` |
| run 9 #30 | still | `user-scalable=no` on `/swipe` | `lighthouse/swipe-public.json` |
| A1 | still | section 2 #15 | `remeasure/a1.json` |
| A3 | still, promoted | identical style, now a destructive control (section 2 #8) | `remeasure/a3.json` |
| A4 | not comparable | re-measured as distinct orderings (18) across workspace pages, a different metric from run 9's pairwise count. Not re-judged | `remeasure/a4.json` |
| A5, A10 | still | section 2 #17, #18 | `remeasure/a5.json`, `remeasure/a10.json` |
| A13 | Done in practice | wordmark visible in nav at 390 on all workspace pages | `remeasure/a13-a14.json` |
| A14 | still | section 2 #12 | `remeasure/a13-a14.json` |

## 4. Per-surface verdicts: new and rebuilt surfaces

* **`/getting-started` (new).** A long onboarding guide for coding agents, sans prose at a readable measure. It names the paths (look first, local workspace, Linear, GitHub, Jira, email) with clear headings. Verdict: sound, one spacing note (#19).
* **Landing (`/`).** The one filled door is "Log in with Linear"; GitHub, Jira and email are outline doors with the same width. Hierarchy holds. Light-theme status pill below 4.5:1 (#1). Lighthouse 0.96.
* **`/workspace/:urlKey/backlog` (new).** Reads as the tree, flattened to "project → tasks" with the same ▼ and counts. It names itself by the workspace, not by "Backlog" (#16).
* **Settings (eight areas, new).** Sidebar groups (`Workspace`, `You`) with a status per area (`Ready · ask`, `5 live keys`, `All clear`) read clearly. Account in dark is clean and the Light/Dark toggle is legible. Features lists the experimental flags with `on` pills. Models carries the 86 unnamed controls (#4) and the "Show N more" affordance (#20). Running's teal link rows read well in dark.
* **Tree, Dispatch, Proxy (rebuilt in the window).** The tree's onboarding callout and "Running and recently moved" are readable at 390. Dispatch's nested rule and native selects are plain but usable; "load Autopilot" controls read as text. The halt controls look the same: Pause, Stop and Resume are indistinguishable, and Stop is destructive (#8). Proxy's token and scope controls are native selects with no label (#5); "generate & copy" uses the green text pattern (#1).
* **Public Ship (`/ship`).** Radial canvas with a 45% default zoom. Labels are 9px nominal (#13). No headings (#9).
* **Styleguide.** Light reads as the baseline it claims to be. Dark captions show light values (#11).
* **Error and email family.** Plain, legible, and the 429/502 prose is now consistent (LIN-3121). The shell heading is sans "Harbour" (#12).
* **Archives.** Sign-off and figure text now passes AA; the `✓` status glyph is 1.82:1 light (#3).

## 5. First experience (cold visitor)

* **What is it and how does it work?** Yes. The landing gives a plain definition ("Harbour reads your backlog, writes the next prompt, runs it on your coding agents, and checks the result against real evidence") and the getting-started guide explains the paths. Clear in the first screen at 390.
* **Onboarding and first run.** The tree's onboarding callout ("Open a task and Harbour writes a prompt…", with "Got it") points at the first action. Getting-started is long for a first visit but structured. Not walked end to end (the onboarding journey belongs to Onboarding & Cold-Start).
* **Empty states.** Read at seed-empty states: Models ("No priced runs", "no model · 4 jobs, 0 set here"), Proxy ("Click 'generate & copy' to create a token and prompt"), Dispatch ("No job (Dispatch suggestion)"). Each says what to do. The Models counts read as noise on an empty workspace.
* **Is the single primary call-to-action clear?** On the landing, yes: the filled teal door is the only filled control and it is the only one a first-time visitor needs. Its white-on-teal text now passes (LIN-739). The wordmark on the same screen does not (#2).
* **Aesthetic coherence and first impression (first ~5 seconds).** The landing looks trustworthy and intentional: mono wordmark, anchor, one filled door, a restrained grid. The CLI language (◐ ○ states, box rules, mono ids) reads as a designed language on the tree, Settings and Library, not an accident. On the error, consent and email family it reads as unfinished (native inputs, sans shell heading, UA-ish links). That split is the advisory tail's first item in run 9 and still holds.

## 6. Coverage: what was read and what was measured

**Image-read (17 PNGs, looked at directly):** `landing-light-390px`, `getting-started-light-1400px`, `backlog-light-1400px`, `settings-models-light-1400px`, `settings-features-light-1400px`, `settings-running-dark-390px`, `settings-account-dark-390px`, `tree-light-390px`, `dispatch-light-390px`, `proxy-light-1400px`, `styleguide-light-390px`, `styleguide-dark-1400px`, `swipe-public-light-390px`, `ship-public-light-1400px`, `archive-3-light-1400px`, `err-upstream-429-light-390px`, and `og-image.png` (`public/logo/`).

**Measured only (JSON, DOM probe or census), not image-read:** the other 419 top-level PNGs and the `authenticated/` set, the 157-entry registry, the 273-id census (220 measured), all 28 cold and 6 authenticated Lighthouse runs, the Library sweep over 117 documents, the unnamed-control probe over 9 pages, the styleguide overflow probe, and the Ship type probe. Where a claim rests on measurement only, the section cites the JSON.

**Not reached (limits, named):** the task page on the default seed returns 503 (`ws-task-page`) and task edit 500 (`ws-task-edit`); the run 9 Linear-mock limit, carried and not investigated further. Live sent emails and live guest-share links (synthetic only); non-Linear merge consent (synthetic only; LIN-3760); live KPI populations, real upstream outages, real review bodies (seeded or synthetic); dark at 320 and 360; the model picker's native popup. Run 9 §6 limits carried.

## 7. Inherited claims overturned or narrowed

* Run 9's "settings 0.87, lowest authenticated score" was measured on the sources area. The Models area is the one with unnamed controls (section 2 #4).
* Run 9's "`/styleguide` bodyOver" question: a 0.73px sub-pixel spill, not overflow.
* Run 9's "archive muted tier 2.94:1": fixed for text (LIN-3762).
* Run 9's "teal CTA fails on the cold doors": fixed for the login button; the landing still fails on the status pill (LIN-3123) and the wordmark is on every in-app page (LIN-849 scope).

## 8. Evidence: size decision

The evidence folder held 436 top-level PNGs (about 25 MB) plus the `authenticated/` set at run time. Decision: keep the 16 PNGs this report and its section 6 cite (every image-read surface except the social card, which lives in `public/logo/`), and drop the rest. All JSON, `census.json`, `registry.json`, `manifest.json`, `coverage-map.md` and the capture scripts are kept. The dropped PNGs are reproducible with `capture/`. The trimmed folder is about 7.0 MB, under the ~10 MB budget. The trim is made before the merge, after the second-read (which used the report and JSON, not the PNGs).

## 9. Routing and follow-ups

**Tickets minted by this run: 0.** Enumerated identifiers from LIN-4392 upward: LIN-4392 (created 14:20:50Z, before this run's dispatch at 14:27:58Z) and LIN-4393 (created 14:40:52Z, not by this session: no issue-create call was made, and the proxy trail below has no `POST /api/proxy/issues`). Credential trail (`windowMs=86400000&limit=100`, read at 14:57Z): 84 rows, below the 100-row cap, so not truncated; 0 issue creates; `gh issue create` was not run.

**Area notes (`docs/areas/front-end-pages.md`, new; one home per unticketed finding):**
* `lib/render-settings.js`: Models unnamed controls (#4). Waiting.
* `lib/render-proxy.js`: unnamed scope select and placeholder-only label (#5). Waiting.
* `lib/render-swipe.js`: pinch-zoom lock (#6). Waiting.
* `lib/render-pages.js`: the Jira site picker overflows at 390 and 320 (#7). Waiting.
* `lib/components/halt-controls.js`: Pause, Stop and Resume render identically in the `buttons` presentation, and the tone the component declares is not applied (#8). Waiting.
* `lib/render-library.js`: two `<h1>` per document (#10). Waiting.
* `lib/render-styleguide.js`: dark captions (#11). Waiting.
* A lesson on per-row accessible names, citing `lib/render-settings.js`.

No note entry for ticketed findings (#1, #2, #9). They stay in the report only.

**Closing-comment routing (objective breakage, ranked by severity):**
1. Dispatch halt controls: Pause, Stop and Resume render identically, and Stop is destructive (#8), with its note entry.
2. Settings › Models: 86 unnamed controls (#4), with its note entry.
3. Jira site picker overflows the phone viewport: 52px at 390, 122px at 320 (#7), with its note entry.
4. Status-green and gold text, 2.2–3.3:1, light (#1), including Swim's "Medium" label. Ticket LIN-3123.
5. Teal wordmark accent, 3.74:1 on 41 light ids (#2). Ticket LIN-849; recommend widening its scope.
6. `/swipe` pinch zoom disabled (#6), with its note entry.
7. Proxy unnamed select and placeholder-only label (#5), with its note entry.
8. Library two `<h1>` per document, 117 of 117 (#10), with its note entry.
9. Archive `✓` status glyph 1.82:1 light (#3). No area file (`docs/archive`); closing comment only.
10. Performance: `swim-public` 0.56 with CLS 0.384, `swipe-public` 0.65, CLS on `terms` (0.167) and `library-doc` (0.122). No area file traced.

**Larger tidy (no area file to cite):** the run-9 capture tooling, ported here. It needed: the `PRIOR` and `TIME` pins; a Lighthouse path that existed only on another machine (now `LIGHTHOUSE_CLI`); five scripts keyed to the deleted `next-run` route; the Observation Scan-due selector; curated rows for the new routes; and `live-console` tagged experimental when `EXPERIMENTAL_VIEWS` does not list it. An honest owning-code citation for a Waiting entry is not available (`lib/periodicals.js` is in `llm-and-prompts`, which has 26 B of headroom), so the item is routed here.

**Seams:** non-Linear merge consent remains synthetic (LIN-3760, Backlog). Seams have no full home in the notes yet.

## 10. Advisory tail (ranked; before → after; mints nothing)

Measured against `/styleguide` and the design principles (mono/sans split, token layer, ✓ ◐ ○ state indicators).

1. **Give the Settings "Show N more" control a disclosure affordance.** *Before:* a grey box that reads as a text input. *After:* a button with a disclosure glyph and the same height as the rows it opens (Models, #20).
2. **Status colour as glyph and fill, text in an AA ink.** *Before:* `#16a34a` text on pale green (3.08 to 3.3:1). *After:* `#15803d` (5.02:1 on white) for text, the fill kept for dots and bars, the ✓ ◐ ○ glyph as the carrier. Settles LIN-3123.
3. **Wordmark accent in the AA brand ink.** *Before:* `.cat` in `#0d9488` (3.74:1). *After:* `#0f766e`, already defined as `--brand-dim` (5.47:1), in light theme only (LIN-849, #2).
4. **Ship labels at a legible default.** *Before:* 45% canvas zoom, 9px nominal labels. *After:* a default zoom that keeps the smallest label at 11px or more, or a minimum label size (#13).
5. **A real not-found for strangers.** *Before:* "Not Found - Projects" and "Go back" to `/`. *After:* wordmark, one line saying the share link was revoked or never existed, one link to the landing labelled for what it does (#14).
6. **One name per destination.** *Before:* "tasks" in the nav, "Backlog ›" in the tree, the workspace name as the page heading. *After:* "Backlog" in all three (#16).
7. **Shell heading as wordmark.** *Before:* sans "Harbour" in the shell on error and cold pages. *After:* the mono wordmark, as in the nav (#12, A14).
8. **Proxy and Dispatch controls get button affordance.** *Before:* "load Autopilot", "generate & copy" read as text. *After:* the `btn` treatment with a border at rest.

Already working as-is: the landing's one-filled-door hierarchy, the getting-started guide's structure, the Settings sidebar with its per-area status, the Library index and figure treatment, and the focus indicator on every walked stop.

## 11. Verification of this report

* Census: `census.json` passed (273 ids, 0 unlisted, 0 orphans).
* Registry: `registry.json` differences empty.
* Figures in sections 2 and 3 were read from the JSON named in each row. `verify-report-figures.mjs` is bound to run 9's paths and was not run.
* Probes are docs-only and live under `capture/`. Each writes its JSON to `remeasure/`.

## Adversarial Second-Read

**Tier:** Tier 2, a fresh-context sub-agent with no memory of the report-writing turn. It was given this report, the list of 417 product files changed in the window, the coverage list (17 PNGs image-read; the rest measured only) and the required question. It had read access to the repository and evidence and was told not to edit anything or post to Linear.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's full answer:**

> **Verdict: DISAGREE.** The report's top finding (status green text, LIN-3123) is widespread but readable, and it is already ticketed. The Dispatch halt controls are a larger item.
>
> **Largest item: Dispatch's Pause, Stop and Resume look identical, and Stop is styled like Resume.** Stop tears down running sessions, and the operator cannot tell it from Resume at rest.
> - Source: `lib/components/halt-controls.js` declares `tone: 'red'` for Pause and Stop. The `presentation: 'buttons'` branch (used by `lib/render-dispatch.js:127`) never reads `tone`. `public/dispatch.css:466` sets only a margin, and the buttons are `btn--quiet` chromeless labels (`public/style.css:4132`).
> - Evidence: `remeasure/a3.json` reports `identicalStyle: true` for all three buttons. Settings › Running, the `ask` presentation, does apply red to Stop (`lib/components/settings-ask.js:48-50`), so the two surfaces diverge.
> - Report handling: row #15 is S4, "cited (run 9 #19)", with no ticket. It is absent from the closing-comment routing list in section 9, and the Dispatch verdict in section 4 never mentions halt controls.
> - Pre-window: the `halt-*` buttons already had this look at `0b4bd287`, so this is a carried defect, not a regression. LIN-3889 (Done) said to keep each surface's look unless a difference is listed and classed, which was not done.
>
> **Missed objective breakage (second): the Jira site picker overflows horizontally on mobile.**
> - `evidence/jira-site-picker-light-390px.json` (and dark): `overflow.overflows: true`, `bodyOver` 52 at 390, 82 at 360, 122 at 320, offender `jira-site-select@442>390`.
> - Source: `lib/render-pages.js:449-451` (`renderJiraSiteSelectPage`, a file modified in the window). The native `select` takes its width from the long `name (url)` option text, with no width constraint (`public/style.css:3051`).
> - The report never mentions this page. It is S3 and needs a closing-comment line and a `front-end-pages.md` entry. Reach is limited to users whose grant spans multiple Jira sites.
>
> **Misfiled or incomplete:**
> - Row #1 omits the Swim priority label "Medium" (`span.swim-fc-prio.p3`, `var(--yellow)` at `public/swim.css:933`). It measures 2.15:1 on `ws-swim` and 2.27:1 on the public `swim-public` page at 11px. LIN-3123's description already names Swim, Medium and `--yellow`, so the routing is right but the list is short.
> - Row #15 (Stop styling): should be at least S3 and belongs in the closing-comment list.
> - Lighthouse CLS on public pages is not reported: `swim-public` 0.384 (layout-shifts audit 0), `terms` 0.167, `library-doc` 0.122 (`lighthouse/*.json` `metrics`).
> - `census.json` `coverage.measuredUnexpectedOutcome` lists `ws-task-edit` (500, "Could not load this task", task 123) and `ws-task-page` (503). The report does not mention either. These may be seed-dependent, which I did not confirm.
>
> **Checked and holding:** the 86 unnamed controls (42+42+2 in `remeasure/unnamed-controls.json`), 41 light wordmark ids and 3.74:1 (`census.json`), `--brand-dim` at `public/style.css:128`, `user-scalable=no` at `lib/render-swipe.js:144`, and the owner files for the Proxy, Library and styleguide notes. Ticket states: LIN-3123, LIN-849, LIN-3120 are Backlog and LIN-3762 is Done, all plausible.
>
> **Coverage note:** I did not open any PNG. Halt behaviour was judged from source and `a3.json`, not a live render. The Jira overflow was measured with the capture script's synthetic site names, not real Atlassian site names. I did not re-run any probe. I checked ticket states only through the GET proxy.

**Author's check of the reader's claims (after the read):**
- Jira site picker: confirmed in this run's `jira-site-picker-light-{390,320,1400}px.json` (overflow 52px and 122px; clean at 1400). The reader cited a path not in this folder; the file it measured is the same run's output. Added as finding #7 and a Waiting entry in `docs/areas/front-end-pages.md`.
- Halt controls: confirmed. `lib/components/halt-controls.js` `CONTROLS` declares `tone: 'red'` for Pause and Stop, `willHappen` for Stop reads "Running sessions are stopped too", and the `buttons` branch does not read `tone`. `remeasure/a3.json` shows identical computed style. Added as finding #8 (S3, promoted from A3) and a Waiting entry.
- Swim "Medium" label: confirmed in `census.json` (2.15:1 on `ws-swim`, 2.27:1 on `swim-public`, `--yellow`). LIN-3123's description names it. Added to finding #1.
- Performance: the reader is right that this pass was not reported. Added the performance paragraph in section 2 and routing item 10 in section 9.
- Task-page 503 and task-edit 500: added to section 6 as named limits. The 503 is the run 9 Linear-mock limit; not investigated further.
- Settings › Running `ask` presentation red Stop, Jira `public/style.css:3051`, `public/dispatch.css:466`: not checked by the author; they are the reader's citations and are not cited by the report.

**The three fields:**

- Adversarial second-read verdict: DISAGREE
- Differed from top finding: YES (the reader's largest item is the halt controls, #8; the report's top-ranked finding is #1)
- Disposition: fixed in place (the reader's two items and its misfiled notes were added to the report, the routing and `docs/areas/front-end-pages.md`; the report was not otherwise reshaped)
