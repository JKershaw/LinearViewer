# Design & interface review — ninth run (LIN-3747)

Rendered-product review of the 1,156-commit window `6e8bf424..0b4bd287` (2026-09-26 to 2026-10-21). Grounded on `main` @ `0b4bd287`; no file under `lib/`, `routes/`, `public/` or `server.js` has changed since (re-checked in beat 4). Evidence: `docs/reviews/_evidence-2026-10-21/` (paths below are relative to it). Every finding cites a fresh render from this run; colour figures come from JSON (`census.json`, `remeasure/*.json`), not from the PNGs, which are palette-quantised. Review-only: no product code, CSS, config, test or doc under review was changed.

Report written in beat 5 (LIN-3752). Beat 6 (LIN-3753) added the `## Adversarial Second-Read` section and findings 29–30 from it.

## 1. Summary

* **Nothing from the last run was fixed.** LIN-3119, LIN-3120, LIN-3121 and LIN-3123 all still reproduce on fresh renders, as do the unminted F4, F5, F6 and advisories A1, A3, A4, A5, A10, A13, A14 (section 3). Product files are byte-identical to the grounding commit, so this is expected rather than a regression.
* **Three new follow-ups minted, all objective breakage, none duplicating an open ticket** (section 9): **LIN-3761** Library wide tables are clipped and unreachable on 70 of 104 documents at 390/320; **LIN-3762** the archives' muted text tier is 2.94:1 light / 3.52–3.87:1 dark; **LIN-3763** UA-blue links (1.89:1) and white native controls in dark on the Jira form, pickers and workspace-not-found page.
* **The new front doors read well but share one systemic contrast defect.** White text on the teal `#0d9488` is 3.74:1 on every teal button and on the `.cat` wordmark accent (33 census ids carry the wordmark). It is the single biggest repeated AA failure in the census and is already owned by LIN-739/LIN-849 (cite-only, Backlog); its scope is wider than that ticket's title (section 2, finding 3).
* **The design-first rebuilds consume the system.** The rebuilt pages (task page, workspace KPIs, runner, tree, settings, swipe, swim, roadmap, proxy) render cleanly in both themes with a computed focus indicator at every stop of every focus walk, and no positive `tabindex`. The defects there are inherited tokens (teal/green fills used as text) and a handful of local rough edges, not a new design language.
* **The CLI/terminal aesthetic reads as deliberate on the landing, Library and KPIs, and as unfinished on the error/consent/email-form family** (native Arial inputs, touching buttons, UA links). That seam is the advisory tail's first item.

## 2. Findings, severity-ranked

Severity: **S1** content unreachable or unusable; **S2** AA contrast failure on readable text in a public or primary surface; **S3** AA failure on a secondary surface, or a structural/semantic defect; **S4** polish or copy. "Minted" and "cited" are in section 9; everything is recorded, promoted or not.

| # | sev | finding | where (fresh-render evidence) | disposition |
| -- | -- | -- | -- | -- |
| 1 | S1 | **Library tables are clipped and cannot be scrolled to.** 70 of 104 catalog documents carry a table that ends past the 390 viewport (392 to 1,086px; `/library/which-rules-pay` ends at 1,086px at both 390 and 320). `.library-doc__body table` is `width:100%` only (`public/library.css:327-332`), there is no scroll wrapper, and the root/`body` use `overflow-x: clip`, so `scrollX` stays 0. | `data/library-sweep.json`, `remeasure/library-table-clip.json`, `capture/library-table-clip.mjs` | **minted LIN-3761** |
| 2 | S2 | **Dark theme: bare controls render UA black/blue on the dark card.** 28 elements under 4.5:1 across dark Dispatch, Settings, Runner and Proxy; worst `button.action-btn` `rgb(0,0,0)` on `rgb(34,36,40)` = **1.35:1**; new in-class members "create a preset →" / "set up a runner ›" at **1.65:1** UA blue. | `remeasure/lin-3119.json`, `census.json` | **cited LIN-3119** |
| 3 | S2 | **Teal-fill text is 3.74:1 on every cold front door.** White on `rgb(13,148,136)` (`.login-button`: 29 census ids as `a`, 11 as `button`), `.cat` accent 3.74:1 on white (33 census ids), the landing Github/Jira/email doors 3.74:1, the landing Linear door (dark text on teal) 4.43:1, `lx-*` landing labels 3.55:1. Lighthouse `color-contrast` fails on `/t/<unknown>`, `/connect/github/held`, `/auth/email`, `/auth/email/confirm` and `/` with exactly these figures, and the same button is the primary action of the merge-consent page. | `census.json`, `lighthouse/{guest-share,held-connection,email-signin,email-confirm,landing}.json` | **cited LIN-739 / LIN-849** (scope wider than the ticket title; recommend widening) |
| 4 | S2 | **Archives 1–9: muted text tier 2.94:1 light, 3.52–3.87:1 dark** on sign-offs, figure labels, chips and the stat note (all 10.5–13px readable text). | `remeasure/f6.json`, `census.json`, `lighthouse/archive-*.json` | **minted LIN-3762** |
| 5 | S2 | **Light theme: status and action fill tokens used as text.** `◐` / In Progress `#d4a600` = **2.27:1** (tree), status pill 2.12:1, runner copy button 2.44:1, runner feedback line (`public/runner-setup.css:76`, `--green`) **3.08:1**, `button.action-btn.save` 2.71:1, `--amber` code 1.68:1. | `remeasure/lin-3123.json`, `census.json`, `authenticated/` runner JSON | **cited LIN-3123** |
| 6 | S2 | **UA-default links and controls in the error/consent/picker family, dark.** UA-blue links at **1.89:1** (9.4:1 light) on the Jira link form and workspace-not-found page; white native `<input>`/`<select>` boxes on the dark page; the repo-picker radio is 1.18:1. | `remeasure/f4.json` (synthetic via production renderers) | **minted LIN-3763** |
| 7 | S3 | **`/ship` and `/workspace/:urlKey/ship` have 0 headings and a bare `<title>` "Ship".** | `remeasure/lin-3120.json` | **cited LIN-3120** |
| 8 | S3 | **Upstream error prose contradicts its diagnostic.** 429 shows "the connection closed before it responded" beside "Linear rate-limited the request"; 502 likewise; the page names "Linear" for any backend (`lib/render-pages.js:705-707`, F5). | `remeasure/lin-3121-f5.json` (synthetic) | **cited LIN-3121** |
| 9 | S3 | **Guest share 404 is a dead end for a stranger.** Status 404, `<title>` "Not Found - Projects", one link labelled "Go back" whose `href` is `/`, no wordmark, no nav, no explanation of what a share link is or why it is gone. This is the cold arrival for anyone holding a revoked link. | `remeasure/hypotheses.json`, `guest-share-revoked-404-*.png` | recorded; copy/affordance, not objective breakage |
| 10 | S3 | **Library documents render two `<h1>`** (shell "Harbour" plus the document title) on all 104 documents, the index renders one. The shell `<h1>Harbour</h1>` is judged once as a class (A14): it is present on 8 cold public pages. | `data/library-sweep.json`, `remeasure/hypotheses.json`, `remeasure/a13-a14.json` | recorded (class judged once) |
| 11 | S3 | **Account-merge consent buttons touch (0px gap) with different widths** in every provider/theme/width; the irreversible action sits flush against its decline. Confirm is white-on-teal 3.74:1 in light. | `remeasure/synthetic-merge-reauth.json` (synthetic) | recorded; geometry polish (LIN-2400 history) |
| 12 | S3 | **Email sign-in form is native.** The real `/auth/email` renders a default Arial input with a tiny placeholder and a monospace label, the submit button flush beneath it, the input not full width at 390; the white input is also a dark-theme native box (see 6). The Lighthouse score is 0.90. | `email-signin-real-*.png`, `lighthouse/email-signin.json` | recorded |
| 13 | S3 | **Lighthouse accessibility, cold surfaces (28 routes).** Lowest: `/styleguide`, `/archive/999`, `/auth/email/confirm`, `/connect/github/held`, `/t/<unknown>` at **0.89** (colour-contrast, heading-order on the style guide); `/auth/email` 0.90; `/swipe` 0.92 (`meta-viewport`). Library 0.96–1.0; `/kpis` 1.0; `/templates` 1.0. Authenticated: task page 0.96, KPIs 0.96, runner 0.96, tree 0.96, proxy 0.91, **settings 0.87** (`color-contrast`, `label`, `select-name`, `font-size`). | `lighthouse/*.json`, `authenticated/lighthouse-*.json` | recorded; contrast members are findings 2–6 |
| 14 | S3 | **Window/label mismatch on workspace KPIs (candidate).** "Tasks done per day" reads "nothing done yet" under a header "Tasks done since 11 Sep 2026: 23" when the completions are older than the chart window (`public/workspace-kpis.js:66`). Seeded data; not confirmed on real data. | `authenticated/ws-kpis--populated-rate--*` | recorded as candidate |
| 15 | S3 | **Task-page review evidence runs together.** "Review's claim" shows the verdict, the body and the timestamp with no separator and raw backticks ("…ledger.CI on `abc1234` is green.2026-10-06T10:00:00Z"). Seeded review body; confirm against a real review. | `authenticated/` task-page PR-ready | recorded as candidate |
| 16 | S3 | **Waiting task page (1400) leaves a ~300px empty left column** under the status line while the answer card spans full width; dark answer card is a muddy brown with dim placeholder; a stray middot floats in the Plan/Build stage cards at 390. | `visual-pass.md` (`ws-task-page--waiting--dark-*`) | recorded |
| 17 | S3 | **Ship Journey can read "6 of 3 completed tasks charted — 200% coverage"** when reports predate later completions; the ratio is not clamped (`lib/ship-journey.js`, documented edge case). | beat 3 notes | recorded |
| 18 | S4 | **A1 title drift:** "Not Found - Projects" on the guest 404, "Test Workspace - Projects" on the tree, bare "Ship" ×2, "Observation", "Run on my machine". | `remeasure/a1.json` | cited (still reproduces) |
| 19 | S4 | **A3** Pause, Stop and Resume have identical computed colour, background and border. | `remeasure/a3.json` | cited |
| 20 | S4 | **A4** 10 pairwise nav-order inversions across 19 workspace pages. | `remeasure/a4.json` | cited |
| 21 | S4 | **A5** mono prose: `.guide-halt-note` (31 words) and `.model-workspace-note` (14 words) are 16px JetBrains Mono at weight 400, the same size as their section titles ("bold" in the research hypothesis is rejected); also public KPIs (9), Swim (8), Privacy (15). | `remeasure/a5.json`, `remeasure/hypotheses.json` | cited |
| 22 | S4 | **A10** internal ticket ids in user copy: Library (3), Style Guide (11), Proxy, Passage Planner (2). | `remeasure/a10.json` | cited |
| 23 | S4 | **A13/A14** wordmark absent from the nav at 390 on all 19 workspace pages and on the guest share view at 390; two brand marks (Inter "Harbour" shell heading on 8 cold pages vs mono `harbour.cat`). | `remeasure/a13-a14.json` | cited |
| 24 | S4 | **Style Guide contradicts itself in dark.** Hex captions under the swatches show light-theme values (`#ffffff` for `--bg`, `#1a1a1a` for `--fg`) beside dark swatches; the "Style Guide" heading is off-centre against the centred title. | `styleguide-dark-*.png` | recorded; the baseline page should be the most accurate page |
| 25 | S4 | **Templates:** raw markdown backticks around `implementation` and `bug` in "Not when" text; badge and "4,796 chars" stack on separate lines at 390. | `templates-*.png` | recorded |
| 26 | S4 | **Library prose rhythm:** a paragraph after a bullet list sits flush under the last bullet and reads as a list continuation; inline `code` wraps mid-path. | `library-paper-*-1400px.png` | recorded |
| 27 | S4 | **390px nav scroller starts mid-strip** so the first item can read "sks"; Live Console preset buttons are 12px / 24px tall (A16). | beat 3/4 notes | recorded |
| 28 | S4 | **A22 stands.** The Collective status dot has no state colour in any of three states (text is the same `rgb(102,102,102)`, 5.74:1). | beat 3 notes | recorded |
| 29 | S3 | **Unnamed form controls on Settings and Proxy** (added after the second-read). Settings: 2 `label` failures (`input.dispatch-preset-name-input` ×2) and 5 `select-name` failures (`select.model-select`, 4× `select.harness-select`); Proxy: 1 `select-name` (`select.proxy-scope-select`). This is the cause of Settings' 0.87, the lowest authenticated score, and is structural, not contrast; no open ticket covers it. | `authenticated/lighthouse-settings.json`, `authenticated/lighthouse-proxy.json` | recorded, **unminted: the three-mint cap was reached**; first candidate for the next run's mints |
| 30 | S3 | **`/swipe` disables pinch-zoom.** The viewport meta carries `user-scalable=no` (`lib/render-swipe.js:596`), failing Lighthouse `meta-viewport` (0.92) and WCAG 1.4.4 on a public page. | `lighthouse/swipe-public.json` | recorded, **unminted: cap reached**; first candidate for the next run's mints |

Not findings (checked, clean): guest share lifecycle (mint 201, guest 200 with `no-referrer`/`no-store`/`noindex`, revoke 200, then 404 on the same URL, a never-issued token and `/s/…`; `data/guest-share-lifecycle.json`); Library sweep totals (0 non-200, 0 images without alt, 0 broken images, 0 `<title>` missing, 0 composited contrast groups under 4.5:1 on all 104 documents at 390, `data/library-sweep.json`); LIN-3351 SVG figures render correctly in dark (`library-paper-svg-dark-*.png`); legacy redirects `/audit`, `/prompts`, `/settings` land on `/` for a cold visitor (`data/legacy-redirects.json`); live harbour.cat matches local on all 28 routes by status and `<title>` (`data/live-comparison.json`).

## 3. Re-measure of last run's follow-ups and unminted items

Fresh renders at `b901efab` (docs-only descendant of `0b4bd287`; no non-docs diff). None was fixed, none is re-minted; each points to its JSON.

| id | result | figure | JSON |
| -- | -- | -- | -- |
| LIN-3119 (dark bare controls) | **still reproduces** | 28 elements under 4.5:1; `button.action-btn` 1.35:1; new UA-blue members 1.65:1 | `remeasure/lin-3119.json` |
| LIN-3120 (`/ship` headings) | **still reproduces** | 0 headings, title "Ship", both routes | `remeasure/lin-3120.json` |
| LIN-3121 (upstream prose) | **still reproduces** | prose and diagnostic disagree on 429 and 502; `lib/render-pages.js:705-707` untouched | `remeasure/lin-3121-f5.json` |
| LIN-3123 (fill tokens as text) | **still reproduces** | 28 census ids; `◐` 2.27:1; runner 2.44:1 and 3.08:1 | `remeasure/lin-3123.json` |
| F4 | still reproduces → **minted LIN-3763** | UA blue 1.89:1 dark | `remeasure/f4.json` |
| F5 | still reproduces (source) | "Linear" for every backend | `remeasure/lin-3121-f5.json` |
| F6 | still reproduces → **minted LIN-3762** | 2.94:1 light, 3.87:1 dark | `remeasure/f6.json` |
| A1, A3, A4, A5, A10, A13, A14 | all still reproduce | see rows 18–23 above | `remeasure/a*.json` |

## 4. Per-surface verdicts: new and rebuilt surfaces

Verdict: **ships** = no objective defect, **ships with debt** = AA or structure debt already owned or minted, **needs work** = an objective defect with no owner before this run.

| surface | verdict | basis |
| -- | -- | -- |
| Landing (4 doors) | ships with debt | one filled door plus three outlined; teal contrast 3.74 / 4.43:1 (LIN-739/849); Lighthouse a11y 0.96 |
| `/library` index | ships | 1 `<h1>`, no overflow at 320/390, Lighthouse 0.96 |
| `/library/:slug`, `/library/doc/:slug` | **needs work** | clipped tables (LIN-3761); two `<h1>`; otherwise clean, figures and alt text fine |
| `/t/:token` (guest share view) | ships with debt | content, security headers and lifecycle correct; wordmark missing at 390 (A13); title drift |
| `/t/:token` 404 / 503 | ships with debt | dead-end "Go back" → `/`, "Not Found - Projects", Lighthouse 0.89 (3.74:1 button) |
| Email family (`/auth/email`, confirm, register, reproof) | ships with debt | native input, flush button, 3.74:1 button; copy and states complete (13 renderers, synthetic) |
| `/account` | ships | sparse but coherent; synthetic input corrected in beat 4 |
| `/connect/:provider/held` (404/400/409/picker) | ships with debt | native radios/selects in dark (LIN-3763); 3.74:1 button |
| Public `/kpis` | ships | rate/total toggle driven, Lighthouse 1.0; mono prose captions (A5); empty states read as "nothing yet" |
| `/archive/8`, `/archive/9` | ships with debt | render and fit at 320/390; muted tier 2.94:1 (LIN-3762) |
| Task page (`/workspace/:k/task/:id`), 9 states | ships with debt | all states render and settle (B1′ does not loop); merge button 3.74:1; evidence line run-together; layout gap on waiting |
| Workspace KPIs | ships with debt | window/label candidate (row 14); Lighthouse 0.96 |
| Runner setup | ships with debt | `--green` text 3.08:1 (LIN-3123) |
| Rebuilt: tree, swipe, swim, settings, roadmap, proxy, dispatch, flight companion, live console, ship's biscuit, observation, session | ships with debt | system consumed; inherited LIN-3119/3123 members; settings Lighthouse 0.87, caused by unnamed controls (finding 29, unowned); swipe blocks pinch-zoom (finding 30, unowned); focus indicator on every stop |
| Legacy redirects | ships | coherent for cold and signed-in |
| Merge consent / reauth (non-Linear) | ships with debt (synthetic) | provider copy correct; touching buttons; no live seam (LIN-3760) |

## 5. First experience (ticket section 4)

**What and how, cold visitor.** On `/` the tagline, the four doors and the "Getting started" CLI box answer *what* and *how* within a screen; the five backends and 17 templates are named. `/templates` explains each prompt in the idiom of the product and is the best "how it works" page, apart from raw backticks. `/library` is a credible front door: a searchable index, readable papers, figures that survive dark mode. `/kpis` ("Harbour in numbers") answers *does the work land?* with real charts and an honest "nothing resolved yet". `/archive/*` reads as a museum catalogue; strong voice, small and faint footers. The two front doors new this window behave differently: a **guest `/t/:token`** arrival with a live token is clear (task title, stages, brief) but has no wordmark at 390 and no line saying what Harbour is; the same stranger on a **revoked link** gets "Not Found - Projects" and a single "Go back" that goes to `/`, which is the weakest first impression in the product (finding 9).

**Onboarding and first run.** Sign-in choices are now four doors; email sign-in is functional but visibly unstyled next to the landing (finding 12). The pickers and the held-connection pages work and carry the right copy but use native radios and selects, white in dark (finding 6). `/account` is sparse but coherent ("Signed in as you@example.com", connect Linear, create a local workspace). The first-workspace and empty states read as intentional ("○ nothing done yet"). Whether the journey *completes* belongs to the Onboarding review; cited, not re-flagged: R2-2, R2-6 → LIN-3108, R2-11.

**The primary CTA.** With four doors the single primary call-to-action is still single: "Log in with Linear" is the one filled teal button; GitHub, Jira and email are transparent with teal text (`landing-cta-*` groups in `census.json`). The hierarchy is right. The affordance is let down by contrast, not by emphasis: the filled door uses dark text at 4.43:1 and the three outlined doors use teal on white at 3.74:1 (LIN-739/849, LIN-2220 for parity). No change recommended to the hierarchy.

**First-impression verdict (first ~5 seconds).** Landing, Library, KPIs, Templates and the archives look trustworthy and intentional: the monospace/CLI language reads as a design choice because it is applied consistently with the grid backdrop and the token palette. The error, consent, picker and email-form family reads as the accidental default: native controls, UA links in dark, flush buttons. The Style Guide, which is the committed reference, contradicts itself in dark (finding 24).

## 6. Coverage limits and unrenderable states (named, not faked)

Generated from `coverage-map.md` (09-26 section 7, items 1–14), plus the limits the beats added.

| §7 | gap | status at end of run |
| -- | -- | -- |
| 1 | non-Linear merge consent / reauth | rendered **synthetic** via production renderers (GitHub, Jira, email); no live seam; seam ticket **LIN-3760** |
| 2 | unresolved-provider "Linear" fallback | source-read only (`lib/render-pages.js:705-707`); branch unreachable by any seed; **carried** |
| 3 | upstream outages | **synthetic** by interception (`state-upstream-*`); carried |
| 4 | archive dark | media-emulated; all nine archives carry `prefers-color-scheme: dark`; carried label |
| 5 | contrast blind spots | own background closed (M3, validated 2.71:1); still blind to `background-image`, pseudo-elements and non-ancestor layers; **carried** |
| 6, 14 | sparse seeded data | populated for Live Console, Ship's Biscuit, Observation, session page, Proxy, Ship Journey, Dispatch, Flight Companion, KPIs. **Named limits:** effort-readout, Task Chat and Scan-due are empty/default only (no seed seam); Flight Companion has no live turn; Ship's Biscuit is deterministic only |
| 7 | A22/A23/A16 | A22 driven (offline flip is browser emulation; the 503 variant is synthetic); A23 driven on both KPI pages, only `chart-done-daily` was a canvas at capture time; A16 read at 12px |
| 8 | Lighthouse | 28 cold routes plus 6 authenticated, light, mobile emulation; intercepted renderers are not reachable and are covered by the census |
| 9 | live instance | all 28 routes reachable and identical in status/title; `/kpis` differs only in data; self-host `LINEAR_ACCESS_TOKEN` notice is local only (diff, not defect) |
| 10 | focus order | walked: task page (2 states), live merge confirm, 7 email renderers (synthetic), nav; every stop has a computed 2px outline and is `:focus-visible`; no positive `tabindex` |
| 11 | PNG quantisation | carried convention; colour from JSON |
| 12 | census reach | **closed**: `census.json` 249 registry ids, 201 measured, 48 excluded (reasons recorded), 0 unlisted, 0 orphan, coverage assertion passed |
| 13 | interactive nav states | team/assignee dropdowns, workspace switcher, `⋯ more` captured; model-picker `<select>` focused, **not opened** (native popup is not rendered headless) |

Additional limits:
* **Task page under the Linear mock** returns 503 (task-edit 500) on the default seed, a harness property; all 200 states come from the local-provider seam.
* **Dark at 320/390px is unverified for eight surfaces** (public Ship, Swim, Swipe, email sign-in and confirm, held 404 and expired, Library 404): 20 beat-2 "dark" cells rendered light because those pages honour the `theme` cookie, not `prefers-color-scheme`; 8 were re-captured at 1400px, the 12 mobile cells were not (`dark-cell-audit.json`). Dark is covered at 1400px only.
* **Image-read:** 690 kept PNGs, 690 lines in `visual-pass.md`; sub-reader lines for some page types are templated and are "pointers to look, not measurements", except the 84 task-page/tree lines, each re-read from its own image after review.
* **Live KPI populations, real upstream outages, real review bodies** cannot be rendered from source; synthetic or seeded, and labelled.
* 360px PNGs were removed to hold the budget; the 360 JSON measurements remain.

## 7. Inherited claims overturned

* **Research hypothesis "Integration Guide note renders as large bold mono prose": rejected in part.** It is mono prose at 16px, equal to its section title, but weight 400 (`remeasure/hypotheses.json`).
* **Research hypothesis "library double `<h1>`": confirmed for documents, rejected for the index** (1 `<h1>`).
* **Plan: "Observation populated by `seed-agent-status`": wrong.** Observation is built from dispatch sessions (beat 3). Noted on LIN-3747.
* **09-26 claim that `scrollWidth` proves no overflow** is vacuous under `overflow-x: clip` (LIN-3715); this run used the geometry rule (M1). Under it, Library overflow is now visible.
* **Beat-1 account-home "[object Object]"** was a harness input error, not a product defect (corrected in beat 4).
* **Beat-2 "dark" cells** for 20 surfaces were light; corrected above.

Nothing in the 09-26 verdicts was overturned by a fix, because nothing changed in the product.

## 8. Evidence size: decision

The evidence directory is 22 MB in git (690 PNGs, about 20 MB, plus JSON), over the plan's ~10 MB budget (last run: 8.1 MB). Review of LIN-3751 required an explicit accept-or-trim decision here before the PR merges.

**Decision: trim before merge; keep the PNGs on the branch until the second-read is finished.** The Tier-2 reader and the reviewer need the images (the F1 lesson is that JSON-only reads miss defects). After the second-read, beat 6 should trim the merge tree to ≤ ~10 MB by dropping every PNG except those this report cites by name and the `live-*` comparison set, keeping all JSON, `visual-pass.md`, `census.json`, `registry.json`, `coverage-map.md` and the capture scripts (the lines in `visual-pass.md` remain the durable image-read record; the PNGs are reproducible with `capture/*.mjs`). **Merge by squash**, so the 22 MB intermediate tree never lands in `main`'s history; the check is `du -sk docs/reviews/_evidence-2026-10-21` on the merged head. If a squash merge is not available, stop and ask before merging, because a later trim cannot remove the PNGs from history.

## 9. Follow-ups

Mints (default state, not children of LIN-3747; each dup-searched on concept and on selector/file before creation):

| id | title | severity |
| -- | -- | -- |
| **LIN-3761** | Library: wide tables clipped and unreachable at 390/320 on 70 of 104 documents | S1 |
| **LIN-3762** | Archives 1–9: muted text tier 2.94:1 light / 3.52–3.87:1 dark below AA | S2 |
| **LIN-3763** | Dark theme: UA-blue links (1.89:1) and white native controls on the Jira form, pickers, workspace-not-found | S2 |

Not minted, with the owner: LIN-3119 (finding 2), LIN-739/849 (finding 3), LIN-3123 (finding 5), LIN-3120 (7), LIN-3121 (8), LIN-3760 (non-Linear merge seam, minted by LIN-3751). Findings 9–28 are copy, geometry polish or candidates and are not objective breakage under the plan's rule; they feed the advisory tail.

## 10. Advisory tail (ranked before → after; mints nothing)

Measured against `/styleguide` and the Design Principles (mono/sans split, token layer, ✓ ◐ ○ state indicators).

1. **Give the error/consent/picker/email-form family the system's controls.** *Before:* native Arial inputs and selects, UA-blue links, touching buttons. *After:* one shared `.field` / `.select` / `a` rule set from the token layer, a gap between confirm and decline. Closes LIN-3763 and finding 11/12 in one move, and is the biggest first-impression gain.
2. **One accessible teal.** *Before:* `#0d9488` carries both fills and text at 3.74:1. *After:* a darker `--brand-ink` for text and button fills (≥ 4.5:1 with white), the bright teal kept for rules and glyphs. Settles LIN-739/849 and the 33 wordmark ids at once.
3. **Split status colour from status text.** *Before:* `--yellow`, `--green`, `--amber` fills used as text. *After:* a text-safe ink per state with the fill kept for dots and bars (the ✓ ◐ ○ glyph stays the carrier). Settles LIN-3123.
4. **A real not-found for strangers.** *Before:* "Not Found - Projects" plus "Go back" → `/`. *After:* wordmark, one line saying a share link was revoked or never existed, a single link to the landing labelled for what it does.
5. **Fix the baseline page.** *Before:* Style Guide dark swatches captioned with light hex values. *After:* captions read from the active theme's computed values.
6. **Prose in sans, labels in mono.** *Before:* 16px mono for 14–31 word notes. *After:* the sans body size for sentences, mono kept for identifiers and commands (A5).
7. **Title and heading pass.** *Before:* "- Projects" suffixes, bare "Ship". *After:* each destination named the same in nav, `<title>` and `<h1>` (A1, with LIN-3120).
8. **Task page: let the waiting state use its width.** Fill the empty left column with the status/brief and set the answer card to the same measure as the text.

Already working as-is, and worth saying: the landing's one-filled-door hierarchy, the KPI page's empty states, the Library's index and figure treatment, and the focus indicator everywhere.

## 11. Verification of this report

Twenty-two report figures (library, census, re-measure, Lighthouse and PNG-count figures) were re-read from the evidence JSON by `capture/verify-report-figures.mjs`, run at the end of beat 5; the output is in `remeasure/report-figure-check.json`.

## Adversarial Second-Read

**Tier:** 2 (fresh-context sub-agent, given only this report and the evidence path, not the author's verdict).

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (full):**

> The report's largest miss is that it files unlabeled form controls on Settings and Proxy as a Lighthouse aside, not as a finding with a ticket.
>
> Spot-checks that held up: the library clipping figures match `remeasure/library-table-clip.json` (`/library/which-rules-pay` table right edge 1,086px at 390 and 320, `scrolledX` 0, root and body `overflow-x: clip`); `remeasure/report-figure-check.json` passes all 22 checks; the Lighthouse scores for settings (0.87), proxy (0.91) and swipe (0.92) match the stored audits. The reader did not recompute contrast ratios from the PNGs or census.
>
> 1. Unlabeled form controls on Settings and Proxy are not a finding. Finding 13 lists `label`, `select-name` and `font-size` only in a parenthetical. `authenticated/lighthouse-settings.json` has 2 `label` failures (`input.dispatch-preset-name-input` ×2) and 5 `select-name` failures (`select.model-select`, 4× `select.harness-select`); `authenticated/lighthouse-proxy.json` has 1 `select-name` (`select.proxy-scope-select`). Unnamed controls on a primary authenticated surface are a structural defect no ticketed family covers, yet section 4 rates both surfaces "ships with debt" as inherited LIN-3119/3123 members.
> 2. Swipe disables pinch-zoom. `lighthouse/swipe-public.json` fails `meta-viewport` because the viewport meta contains `user-scalable=no`; `lib/render-swipe.js` is the only file that sets it. WCAG 1.4.4, objective; mentioned only as "(`meta-viewport`)".
> 3. Smaller: beat 2 says 74 of 104 library documents overflow at 390 while the report says 70 have tables past the viewport; the other 4 are not explained.
>
> Finding 1 (library table clipping, S1) is well supported and should stay #1.
>
> Adversarial second-read verdict: DISAGREE
> Differed from top finding: YES
> Recommended disposition: escalated

**Author's check of the reader's claims:** items 1 and 2 re-verified against the evidence JSON and `lib/render-swipe.js:596` (label 2, select-name 5 / 1, `user-scalable=no`). Item 3 is left as a carried note: the 4-document gap is not itemised in the evidence.

**Adversarial second-read verdict: DISAGREE** · **Differed from top finding: YES** · **Disposition: fixed in place**

Reason for the disposition: the report was amended here (findings 29 and 30 added; section 4's "ships with debt" for Settings and Proxy now also carries finding 29). The reader suggested escalating, but the follow-up cap of three was already used, so nothing more can be minted this run; the two items are named as the next run's first mint candidates instead.

---

# Appendix — beat evidence logs

The beat 2–4 logs below are the working evidence record that the report above is built from. They are kept unchanged.

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
