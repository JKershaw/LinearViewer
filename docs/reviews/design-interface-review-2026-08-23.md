# Design & Interface Review — 2026-08-23 (periodical run, sixth)

> **Provenance note (LIN-694).** This report was persisted retroactively on 2026-08-23. The
> review itself ran the same day, under session `voyage-advisory-reviews-2026-08-23`, but a
> conflicting operator instruction ("do NOT edit, create, or delete any file in either repo")
> prevented the file (and its evidence directory) from being written at the time — the review
> instead posted its full report as a Linear comment on **LIN-1924**, exactly as its own text
> below anticipated. This file is that verbatim commit. Nothing below has been re-derived,
> re-judged, or edited for content. Per the report's own note, the evidence PNGs referenced
> below (`_evidence-2026-08-23/`) were written to a scratchpad outside the repo during the
> run and were not recovered — they are not part of this commit.

*Review-only. No code, docs, config, CSS or baselines changed. Evidence regenerated at run time; committed screenshots under `tests/screenshots/**` were **not** trusted and **no baseline was refreshed**.*

**Session** `voyage-advisory-reviews-2026-08-23`. **HEAD** `LinearViewer` @ `0e8a1461` (= `origin/main`). Supersedes LIN-1690, as this ticket states.

**How the evidence was produced.** A server was started on an **isolated port 3199** with `NODE_ENV=test` and `LINEAR_ACCESS_TOKEN=` empty — so `/` is the real unauthenticated landing, not a redirect — and driven with Playwright from a **scratchpad script outside the repo**. **51 full-page renders** across 32 surfaces: unauthenticated cold-start, authenticated light and dark, and 390×844 mobile. Plus programmatic `getComputedStyle` / `getBoundingClientRect` measurement, which is what turned three of the findings below from "looks off" into numbers.

**Dark theme was driven by the real toggle**, as this ticket requires: the footer control was clicked (`theme: light` → `theme: dark`, `document.documentElement.className === "theme-dark"`) rather than relying on `prefers-color-scheme`. The one exception is the **landing**, which has no toggle and whose dark path *is* `@media (prefers-color-scheme: dark) body.is-landing` (`public/style.css:2136`) — there, `colorScheme: 'dark'` is the correct and only mechanism, and I say so rather than leaving it implied.

**Report artefact — the unrun step, named.** Convention is `docs/reviews/design-interface-review-<date>.md` with PNGs in `docs/reviews/_evidence-<date>/`. This session ran under a **hard no-file-write / no-PR constraint** (six sibling lanes through these repos today, two live in them now), so **the report is this comment** and **the evidence PNGs were written to a scratchpad outside the repo, not committed.** `git status` at the end of the run shows the working tree exactly as it started. **Unrun: landing the report file and its `_evidence-2026-08-23/` directory.** Every measurement below is reproducible from the method above.

---

## 0. Surface inventory — re-derived from code, and it is wider than this ticket's list

Derived from routes in `server.js` + `routes/*.js`, the `lib/render-*.js` family, `public/*.css` sorted by last-touched, and `EXPERIMENTAL_VIEWS` (`lib/feature-defaults.js:166-176`) — not from `docs/view-tiers.md`, which this ticket correctly flags as stale (**7 of 9 members**; confirmed, and reported to LIN-1856 by the Documentation Review in this same batch).

**Rendered this run (32 surfaces):** landing (light + dark + mobile) · `/templates` (+ mobile) · `/styleguide` · `/kpis` · `/archive/2` (+ mobile) · `/auth/jira` (+ mobile) · `/privacy` · `/terms` · `/prompts` · workspace-not-found · public `/swipe` — and, in **both themes**: tasks · observation · settings · live console · passage planner · flight companion · ship's biscuit · **escalation KPIs** · proxy · next run · task chat · ship journey · swim · dispatch · roadmap · **task-create** — plus live console and tasks at 390×844.

**Two surfaces in remit that this ticket's Tier A/B lists do not name**, folded in because the inventory was re-derived rather than copied:

- **`/workspace/:urlKey/escalation-kpis`** (LIN-1736, `lib/render-escalation-kpis.js`, `public/escalation-kpis.css`) — **landed today, 2026-08-23**, the newest CSS in the repo. It is where **D1** below was found.
- **`/workspace/:urlKey/task/new`** (LIN-1973, `lib/render-task-create.js`, `public/task-create.css`) — the create-side twin of the task-edit page Tier A does name. Rendered in both themes; **clean**.

---

# Objective breakage — ranked

## D1 · **HIGH** — Escalation KPIs' only control renders white-on-dark, in Arial, at 19px · **LIN-2251**

`/workspace/:urlKey/escalation-kpis`, dark theme, real toggle driven. Computed styles:

| | `#kpi-window-days` | page `body` |
|---|---|---|
| background | **`rgb(255, 255, 255)`** | `rgb(22, 24, 29)` |
| color | **`rgb(0, 0, 0)`** | `rgb(230, 230, 230)` |
| font-family | **`Arial`** | `--font-structural` (mono) |
| height | **19px** | — |

Same theme, same session, sibling page: `/proxy`'s `.proxy-scope-select` → `background: rgb(22,24,29)`, `color: rgb(230,230,230)`. Correct there, so this is a divergence and not a platform limit.

**Cause:** `public/escalation-kpis.css` (36 lines) styles `.kpi-window-form label` (`:5`) and has **no rule for the `<select>`** emitted at `lib/render-escalation-kpis.js:114`. The file's header comment claims *"Semantic-token-only (dark-safe)"* — true of everything it styles, and the one control it forgot is the exception.

**Consequence:** in dark theme the only interactive element on the page is the highest-contrast object on the screen, pulling the eye to a filter instead of the four KPI values, on an operator-facing audit surface that shipped today.

**Fix:** the house pattern is `.dispatch-exec-harness-select` (`public/style.css:2550-2559`) — `background: var(--bg); color: var(--fg); border: 1px solid var(--fg-vdim); font-family: var(--font-content)`. Apply it and give the control enough padding to clear a comfortable target height.

---

## D2 · **HIGH** — At 390px the fixed feedback FAB covers the Live Console's history control · **LIN-2252**

Measured rects at 390×844:

| element | x | y | w | h | spans x |
|---|---|---|---|---|---|
| `.lc-more-btn` *"view earlier activity ↓"* (`lib/render-live-console.js:143`) | 93 | 795 | 203 | 30 | **93 → 296** |
| `.feedback-fab` (`public/feedback-widget.css:9-13`, `position: fixed; right:16px; bottom:16px; z-index: var(--z-overlay,1000)`) | 291 | 796 | 83 | 32 | **291 → 374** |

Overlap: **x 291–296, y 796–825 — 29 of the control's 30px of height.** The FAB is above it in stacking order and covers the `↓` affordance.

**It is this page, not the FAB.** Intersection-tested at the identical FAB position across four pages: tasks **none**, observation **none**, escalation-kpis **none**, **live-console — hit**. `public/live-console.css`'s only mobile breakpoint (`@media (max-width: 560px)`, `:516-521`) adjusts `.lc-lane`/`.lc-event` grids and reserves nothing for the overlay.

**Consequence:** a tap near the control's right edge opens the feedback widget instead of loading earlier activity — a *wrong action from a plausible tap*, not a cosmetic collision, on the app's most touch-dependent surface.

**Fix:** bottom-pad `.lc-more` inside the existing `@media (max-width: 560px)` block to clear the FAB's 16px inset + 32px height. Smallest of the three options in the ticket.

---

## D3 · **MED, objective, marginal** — the landing CTA contrast contradiction, settled: it reproduces in **light only**, and there is a second, worse instance

This ticket asks to *"resolve the landing CTA contrast contradiction by measuring it fresh in both themes."* Done — and the contradiction resolves because **the two prior measurements were of different themes**.

| CTA | size / weight | light | dark | AA (4.5:1) |
|---|---|---|---|---|
| `.landing-cta-linear` — "Log in with Linear" (`public/style.css:2243`) | 16.8px / 500 | fg `rgb(4,35,31)` on `rgb(13,148,136)` = **4.43** | fg `rgb(4,35,31)` on `rgb(45,212,191)` = **8.92** | **light fails by 0.07** · dark passes |
| `.lx-os__cta` — "Open Harbour OS →" (`public/landing.css:429-440`) | 16px / 500 | fg `rgb(255,255,255)` on `rgb(13,148,136)` = **3.74** | fg `rgb(22,24,29)` on `rgb(45,212,191)` = **9.54** | **light fails** · dark passes |

Both are normal text by WCAG's definition (large-text 3:1 needs ≥18.66px bold or ≥24px regular; neither qualifies), so 4.5:1 applies.

**Two things this adds to what is already recorded.**

1. **The dark half was never measured.** LIN-739 records 4.43:1 and proposes darkening the filled-CTA ink. Dark theme is already at 8.92:1 and 9.54:1 — so **a global ink change would overcorrect dark**. The fix has to be light-theme-scoped. That is new information and it changes the fix.
2. **`.lx-os__cta` is a second instance, ungated.** LIN-739 predicted a 3.74:1 member of this class — `.landing-cta-github`, *"only renders when `GITHUB_CLIENT_ID` is set, so it was not captured this cycle."* I found a different member at exactly that ratio which is **not** gated on anything: the Harbour OS CTA renders for every visitor, and at 3.74:1 it is the clearer miss of the two.

**Not minted — [LIN-739](https://linear.app/issue/LIN-739) already owns it** (open since the 2026-06-26 review), with **LIN-849** as the a11y-cleanup companion. Both measurements are posted to LIN-739 rather than filed as a rival.

---

## 1. Open questions from this ticket — answered

| question | answer |
|---|---|
| Does the landing CTA contrast still reproduce on a fresh render, in both themes? | **Yes in light (4.43 and 3.74), no in dark (8.92 and 9.54).** See D3. |
| Do the newly added error/degraded states on Proxy, Live Console and the session page render legibly and consistently? | **Yes.** Proxy's Credential Health block renders its healthy-state copy legibly in both themes (*"No credential faults in the last 15 min"*), and Live Console's three empty states (*"all quiet — nothing in flight right now"*, *"no runs in the last 1 hour"*, *"nothing has happened yet — hang tight"*) are legible and consistently phrased at both widths. **No finding.** Caveat below. |
| Does `/archive/:n` intentionally bypass the shared shell, and therefore have no theme hook? | **Yes, and it is fine.** `docs/archive/{1,2,3}.html` are served verbatim as standalone documents. `/archive/2` renders legibly at 1400px and 390px with its own self-contained styling. This is the design, not drift. **No finding.** |
| Does roadmap still lack a `test-token → testMockData` arm? | **No — it has one.** `server.js:2676` gates both the projects fetch and the LIN-2025 team resolution, with a comment recording that its absence had made the roadmap baseline silently capture the landing page. Roadmap rendered correctly in both themes this run. **LIN-681 is resolved and should be closed** (second run to say so — reported in full on LIN-681 by the Code Quality Review in this batch). |
| Which live surfaces beyond the listed set are in remit after re-deriving the inventory? | **`/workspace/:urlKey/escalation-kpis`** (LIN-1736, landed today — where D1 was found) and **`/workspace/:urlKey/task/new`** (LIN-1973, clean). See §0. |
| Does the desktop tree-row control still look stranded at current widths? | **No.** At 1400px the tasks tree's right-edge `▶` disclosure aligns consistently down the column in both themes, with the project label right-aligned above it. Reads as a deliberate column, not a stranded control. **Advisory item retired.** |
| Were the collective status-dot semantics and faint secondary copy resolved by the later CSS-token work? | **Partly — and I am marking one unverified rather than claiming it.** Secondary copy: **resolved.** Project descriptions and metadata render at legible weight in both themes on the surfaces I rendered. Collective status dots: `/collective` requires a `YAP_BASE_URL` backend that this isolated instance does not have, so I could not render its populated state. **Unverified — do not read this as cleared.** |

---

## 2. Clean results — reported as outcomes

A clean result is a genuine outcome and this run produced a lot of one:

- **Dark theme is solid across 16 authenticated surfaces.** Driven by the real toggle, every page I rendered in both themes was correct except D1's single control. Tasks, observation, settings, proxy, dispatch, roadmap, swim, ship journey, task chat, next run, flight companion, passage planner, ship's biscuit, escalation KPIs and task-create all re-token cleanly — backgrounds, borders, card surfaces, accent and status colours. **Fifteen of sixteen perfect is the headline of this review**, and it is why D1 stands out rather than getting lost.
- **Every unauthenticated cold-start surface renders standalone.** `/`, `/templates`, `/styleguide`, `/kpis`, `/archive/2`, `/privacy`, `/terms`, `/prompts`, public `/swipe` and the workspace-not-found page all returned 200 with no session and no redirect. `/templates` — the public, indexable, `noindex`-free catalog this ticket flags as a genuine cold-visitor landing surface — renders correctly at 1400px and 390px.
- **`/auth/jira` unauthenticated is correct, not broken.** It renders a shell-free *"No Workspace Selected"* page explaining that Jira can only be added to an existing workspace, with a single teal "Go to homepage" CTA. The credential-entry form is workspace-scoped by design. Legible, well-centred, one clear action. This ticket flags credential forms as *"high-stakes first-impression surfaces"* — this one handles its no-workspace case well. **No finding.**
- **`/workspace/:urlKey/task/new` (never reviewed) is clean.** Labelled fields, a visible focus ring on Title, consistent input treatment, a primary/secondary action pair, correct in both themes.
- **Nav, footer and the `⋯more` overflow** are consistent across every authenticated surface at both widths, with the active view marked by a `▸` plus underline. The mobile strip does not wrap at 390px (LIN-2179's fix holds).

---

## 3. Advisory tail — design-direction notes, deliberately not minted

Per this ticket's §7, subjective judgements belong here and never in a fix-task:

- **The feedback FAB's blue is the one colour outside the accent system.** `.feedback-fab` renders blue in both themes while the product's accent is teal (`harbour.cat` wordmark, primary CTAs, active nav underline, `/auth/jira`'s button). It is theme-aware and legible — this is a palette-cohesion note, not breakage. It is also, on every page, the most saturated element on screen, which gives a feedback affordance more visual rank than the page's own primary action.
- **The two KPI pages have different heading languages.** `/kpis` leads with lowercase monospace (`instance kpis`) and styled pill toggles; `/escalation-kpis` leads with a sans-serif title-case `Escalation KPIs` and a bare `<select>`. Both are defensible; together they read as two designers. If one is house style, the other should follow it — and D1's fix is the natural moment.
- **Live Console timeline zoom targets at mobile.** `3m`/`15m`/`1h`/`6h` and `fit`/`1h`/`24h` measure **24px tall, 37–44px wide** at 390px — under the 44px guidance, on the app's most gesture-driven surface. Recorded here rather than minted because the sibling tickets **LIN-2221** and **LIN-1018** already own the mobile-target class; noted on LIN-2252 for whoever takes that.
- **`/kpis` series encoding is still colour-only** (advisory item #4 from prior runs). Confirmed still true at HEAD across the proxy-phase, dispatch-kind and step-outcome charts. The LIN-1846 30d/24h toggles are new, well-styled, and do not change the encoding question. Carried forward unchanged.

---

## 4. Follow-ups minted — 2, under the ~3 cap, objective breakage only

| ticket | finding |
|---|---|
| **LIN-2251** | D1 — Escalation KPIs `<select>` unstyled: white-on-dark, Arial, 19px |
| **LIN-2252** | D2 — Live Console at 390px: fixed FAB overlaps `view earlier activity ↓` |

**Not minted:** D3 (**LIN-739** owns it — both fresh measurements posted there, including the dark-theme half it never had and the second ungated instance), the mobile touch targets (**LIN-2221** / **LIN-1018**), and every advisory-tail item.

---

## 5. Not double-flagged — sibling seams

- **Stylesheet structure** is deferred to Code Quality by this review's own charter, and LIN-1920 ran in this batch: the four hand-rolled Markdown typography blocks (posted to **LIN-1622**) and the `.theme-dark` / `body.is-landing` token-set gap of 3 (**LIN-2247**) are recorded there, not here. Note the relationship: LIN-2247's missing tokens are `--accent`, `--ok`, `--red-hover`, and **no landing rule uses any of them today**, so that gap produced no visible defect this run — verified, not assumed.
- **`docs/view-tiers.md`'s staleness** is Documentation Review's; cited in §0, reported to **LIN-1856** by LIN-1922 in this batch, not fixed here.
- **API and code defects** are out of scope; only visible defects are reported.

---

## 6. Trend ledger — against 2026-07-03 (LIN-942)

| item | 07-03 | 08-23 | movement |
|---|---|---|---|
| overall cycle | **clean** over ~22 surfaces | **2 objective breakages** over 32 surfaces | **regressed — but both on surfaces that did not exist on 07-03** |
| dark-theme parity | clean | 15 of 16 authenticated surfaces perfect | **held under 9 new surfaces** |
| landing CTA contrast (LIN-739) | contradictory readings | **settled: light fails (4.43 / 3.74), dark passes (8.92 / 9.54)** | **resolved as a question; defect unchanged** |
| second CTA instance | predicted, ungatherable (`GITHUB_CLIENT_ID`) | **found ungated: `.lx-os__cta` at 3.74** | **new** |
| escalation-kpis surface | did not exist | **D1** | **new** |
| live-console mobile targets | not measured | 24px pills; FAB overlap (**D2**) | **new** |
| desktop tree-row control "stranded" | advisory | not reproduced at 1400px | **retired** |
| faint secondary copy | advisory | not reproduced | **retired** |
| collective status-dot semantics | advisory | **could not render — no Yap backend** | **unverified, carried** |
| `/kpis` colour-only series encoding | advisory #4 | unchanged | **unchanged** |
| `/archive/:n` shell bypass | open question | intentional, renders well both widths | **closed, no finding** |
| roadmap test-mode arm (LIN-681) | open question | present at `server.js:2676` | **resolved — close LIN-681** |
