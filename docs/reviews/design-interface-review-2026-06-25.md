# Design & Interface Review — 2026-06-25 (LIN-671)

**Task:** LIN-671 (periodical run, origin LIN-520) · **Reviewer role:** visual QA
**Evidence:** the *rendered* product, regenerated at run time — never the committed baselines.
**Policy:** corrective review with an advisory tail — mint fix-tasks only for objective
breakage; subjective design-direction calls stay in this report for a human.

> **Third run.** Measured against the baseline `design-interface-review-2026-06-20.md` (LIN-565)
> and the second run `design-interface-review-2026-06-20-lin568.md` (LIN-568, first to apply the
> full §5 craft pass). This run builds on both: it re-verifies the two closed fix-tasks on a fresh
> render and re-checks the 6-item advisory tail, rather than re-deriving the survey.

---

## Headline

**Clean cycle — zero objective breakage, zero fix-tasks minted.** Both prior fix-tasks
(LIN-566 landing keyboard/SR reachability, LIN-570 roadmap north-star contrast) are **verified
holding on a fresh render** — neither has regressed. The design system remains real and
well-consumed across ~20 surfaces; the CLI/terminal aesthetic still reads as deliberate. Every
item the LIN-568 6-item advisory tail raised is **still true and still advisory** — none has
decayed into breakage, none was fixed. The honest outcome this cycle is a written report with
**no new tasks**: the advisory tail carries forward unchanged for a human to promote by choice.

---

## How this evidence was gathered

- **Regenerated full-page renders** at desktop (1400×1000) and mobile (390×844) via the repo's
  own visual machinery: `npx playwright test --config=playwright.visual.config.js` over
  `pages-screenshots.spec.js` (16 page captures) and `swim-screenshots.spec.js` (12 swim
  captures). I read the **freshly generated** output, not the committed PNGs; **the regenerated
  baselines under `tests/screenshots/**` were reverted afterward** (`git checkout`) — a review
  must not double as a baseline refresh.
- **Live browser pass** (Chrome DevTools) on the **cold, unauthenticated landing** — a no-PAT
  test-mode server (`LINEAR_ACCESS_TOKEN=` blank, `NODE_ENV=test` to skip the prod HTTPS
  redirect) so `/` renders the real landing. Scripted focus-order + contrast probe and a
  Lighthouse navigation audit (desktop).
- **Source-level verification** of the two closed fix-tasks' CSS/markup at HEAD, because the
  mock visual harness renders the **landing** for the `roadmap` route (the `roadmap` route has no
  `test-token → testMockData` arm — a known harness gap, deferred to Code Quality), so the live
  roadmap helper line could not be captured by the maker this cycle.
- **Evidence saved** beside this report: `docs/reviews/_evidence-2026-06-25/`
  (`landing-desktop.png`, `dashboard-{desktop,mobile}.png`, `kpis-desktop.png`,
  `proxy-desktop.png`, `swim-mobile.png`).
- **Measured against** the shipped design system: `/styleguide` + the `:root` tokens in
  `public/style.css`.

**Surfaces reviewed (fresh render):** landing (cold, live + maker), `/styleguide`, `/privacy`,
`/terms`, public `/kpis`, project-tree dashboard, swipe, swim (incl. mobile), settings, dispatch,
proxy, prompts, custom-prompts, audit, pipeline, shared modal/toast overlays. Roadmap /
observation / collective live-data surfaces were not re-captured this cycle (no Linear
credentials available in this run); their prior-run findings are carried forward and flagged as
**not re-verified this cycle** where relevant.

---

## Regression check — both prior fix-tasks verified holding

### ✅ LIN-566 — Landing sign-in keyboard/SR reachability (was baseline 🔴) — HOLDS

Re-checked live on the cold landing **and** at source:

- Live probe: the cold landing has **13 focusable elements**, and the **"Connect with Linear"
  CTA is FIRST in tab order** (`firstFocusable` = the `data-testid="issue-line"` row,
  `tabIndex = 0`).
- Source/markup: every expandable row renders `role="button" tabindex="0" aria-expanded="false"`
  (`lib/render.js:536`; **22** such operable rows on the rendered landing).
- Lighthouse Accessibility **100**.

A keyboard / screen-reader visitor still has a complete path into the product. **Not regressed.**

### ✅ LIN-570 — Roadmap "north star" helper contrast (was 🔴 1.16:1) — HOLDS

`.roadmap-north-star-help` (`public/roadmap.css:435`) now resolves
`color: var(--fg-dim)` (`#666666`, **5.74:1** on white — passes WCAG AA) — the structural
`--fg-vdim` token that caused the 1.16:1 failure is gone from that rule. Verified at HEAD.
(The maker renders landing for the roadmap route, so this was confirmed at source rather than by
a fresh roadmap PNG; the fix is a one-line token swap and is unambiguous in the stylesheet.)

---

## Severity-ranked findings

**🔴 HIGH / objective breakage: none.**
**🟡 MEDIUM / 🟢 LOW: all advisory, all carried forward from LIN-568 — re-confirmed on fresh
renders, none promoted.**

### 🟡 MEDIUM (advisory, persists) — Desktop tree rows: ~1050px gap between label and its `▶`

Re-confirmed on `dashboard-desktop.png` and the cold `landing-desktop.png`: at 1400px each row's
label sits far-left while its `▶` toggle is pinned to the far-right edge — ~1050px of empty space
between a row and the control that operates it. Weakens row-as-a-unit scanning; `▶` reads as
detached chrome. **Mobile is excellent** (`dashboard-mobile.png`): the arrow sits beside the
label, no overflow. Subjective layout call; the airiness may be intended. (Advisory tail #2.)

### 🟢 LOW (advisory, persists) — re-confirmed on fresh renders

- **Landing CTA visual affordance** (tail #1): "Connect with Linear" is still a collapsed tree
  row with no button treatment, login link hidden until expanded — equal visual weight with the
  marketing rows. The single most important action on the most important page has the least
  visual dominance. Defensible within the CLI/tree aesthetic; highest-leverage "looks better"
  lever. Confirmed on the live cold landing.
- **Faint `--fg-vdim` secondary copy** (tail #4): `.proxy-collapsible-count`
  (`public/proxy.css:259`) still renders the "(1)" / "(0)" counts beside *existing tokens* and
  *recent events* at `--fg-vdim` (`#eeeeee`, ~1.16:1) — visible-but-barely on `proxy-desktop.png`.
  It is a secondary count, not instructional prose, so it stayed advisory at LIN-568 and remains
  below the mint bar. The acute instance (roadmap helper) was the one that got the task.
- **`/kpis` color-only series encoding** (tail #5): re-confirmed on `kpis-desktop.png` /
  `kpis-mobile.png`. The "proxy responses" donut (2xx/4xx/5xx) and "proxy calls by phase"
  5-series legend distinguish series by color only — standard for Chart.js, a soft colorblind
  gap.
- **Swim mobile in-lane scroll cue** (tail #6): re-confirmed on `swim/11-mobile.png` — lane
  cards clip at the right edge (`Add monit…`, `Widget da…`) with weak "more to the right"
  affordance. Expected for a 2D dependency layout on a 375px screen.
- **Semantic status dots gray-not-green** (tail #3): **NOT re-verified this cycle** — the
  `● live` / `● disconnected` poll dots live on observation/collective, which need live Linear
  data unavailable in this run. Carried forward from LIN-568 as still-open; re-check next cycle
  with a PAT-mode server.

### New observation (not promoted, cross-altitude)

- `/kpis` "top proxy endpoints" plots **`foreman/status`** as its largest bar (alongside a
  smaller `agent/status`). Per CLAUDE.md, `/foreman/status` is the **deprecated alias** for the
  canonical `/agent/status` — so the chart shows a deprecated label as a distinct, dominant
  series. This is a data/labeling concern at the **API / Code Quality** altitude (endpoint
  naming in telemetry), not a rendered-design defect. Noted here for the next API/Code review;
  **not minted, not this review's altitude.**

### Deferred (not this review's altitude — re-confirmed)

- Landing **missing `meta description`** (Lighthouse SEO 90) and **`llms.txt` fails the
  recommended format** (Agentic Browsing 67) — the only two Lighthouse failures, both non-visual.
  → Documentation / Code Quality.
- The **mock `roadmap` visual baseline still renders the landing page** (no `test-token →
  testMockData` arm on the roadmap route; same for `pipeline`, which rides the local-provider
  harness instead). Test-harness / Code-Quality territory. → Code Quality.

---

## Required: first-experience section

A cold visitor lands on `/` and sees the centered title **"Linear Projects Viewer"** above a
collapsible tree whose top-level sections double as a pitch: **Login** ("A distraction-free view
of what matters in Linear"), **Views** (Projects tree / Swipe / Swim lanes), **What This Is**
("Linear is powerful but busy. This gives you just the tree."), **AI Prompts**, **Self-Host**,
**Use Cases**, **Source**. The product explains itself *in its own UI idiom* — clever, and the
copy is tight and honest.

**What it is / how it works:** communicated well in one screen.

**Primary CTA — the standing tension (unchanged).** Sign-in is *reachable* (LIN-566 verified
above) but its *visual affordance* is still the weak point: "Connect with Linear" is a collapsed
tree row styled identically to the marketing rows, with no button treatment, requiring a
click/Enter to reveal the login link. For a CLI-aesthetic product this is a deliberate
art-direction choice, not breakage — but it remains the highest-leverage "looks better" lever
(advisory tail #1).

**Aesthetic coherence & first impression.** In the first ~5 seconds the surface reads as
trustworthy, intentional, and coherent — the monospace/tree language is executed as a real design
system, not an accidental default. Restraint is the dominant note and it works. The one thing
working *against* first-impression polish is unchanged: everything carries near-equal visual
weight (flat monospace + uniform rows), so the eye has no obvious first read. That is the theme
of the advisory tail, not a defect.

**Empty states / first-run (authenticated):** still a strength — dispatch ("Queue is empty" /
"No tokens yet"), pipeline ("○ no recent activity"), `/kpis` ("○ no data yet"), audit ("Run
Audit"). Calm and human.

**Mobile first-run is better than desktop** — narrow column keeps expand arrows beside labels,
no overflow, clean top-to-bottom read (`dashboard-mobile.png`).

---

## Accessibility & performance pass

- **Lighthouse (landing, desktop, navigation):** Accessibility **100**, Best Practices **100**,
  SEO **90**, Agentic Browsing **67**. The only two failures are `meta-description` and
  `llms.txt` (both deferred, non-visual). 47 audits passed, 2 failed.
- **Keyboard / focus order (landing, live):** 13 focusable elements, the sign-in CTA leads the
  order; `tabindex=0` + `role="button"` + `aria-expanded` present (LIN-566 verified).
- **Contrast:** measured subtitle/section-desc and footer-link text at **5.74:1** (passes AA).
  No new contrast failure surfaced on any captured surface. The known borderline
  `.proxy-collapsible-count` stays advisory (secondary count, not prose).
- **Responsive / overflow:** no horizontal overflow on landing, dashboard, KPIs, or settings at
  mobile width. Swim's in-lane horizontal scroll is by-design (advisory #6).
- **Heavier pages:** `/kpis` (~11 Chart.js charts) renders without visible jank after settle.
  No performance defects at this altitude.

---

## What's working (recorded so the next run can detect regressions)

- **Styleguide:** ships tokens, type scale, ✓/◐/○ indicators, buttons, cards, badges, status
  banners, empty states — the committed visual baseline, well-formed.
- **Dashboard (tree):** clean section headers (▼ In Progress / Project Alpha / Project Beta),
  ◐/○ state dots, "+ Add task" / "show N completed" affordances, consistent footer nav.
- **Pipeline:** three-column floor view (queue / active / activity), green status dots,
  priority-colored left borders (red/yellow), calm "no recent activity" empty state. Clean.
- **Swipe:** polished mobile card — `●●●● Urgent` priority dots, `bug` label pill, collapsible
  Description/Comments/Recap/Brief/Context/Prompts sections, prev/next with paging dots.
- **KPIs:** stat-card grid (11 cards) + consistent-palette charts + good "○ no data yet" empty
  states + footer provenance line.
- **Dispatch / Proxy / Settings / Audit / Custom-prompts:** organized card sections with real
  form controls (selects, toggles, generate buttons) — the affordance the landing tree
  deliberately forgoes.
- **Overlays:** shared modal (`token-modal`, "Token Created") + toast primitives render
  consistently at both widths.

---

## Actionable advisory tail (ranked; mint nothing from here)

Unchanged from LIN-568 and re-confirmed against fresh renders — reproduced so this report stands
alone. Subjective design-direction calls, judged *within* the minimal CLI/terminal idiom and
measured against `/styleguide`. Ordered so a maintainer reads the top item first.

1. **Give the landing primary CTA visual dominance** *(highest leverage)*.
   *Before:* "Connect with Linear" is a collapsed tree row, no button styling, login link hidden
   until expanded — equal weight with marketing rows.
   *After (within idiom):* keep the tree row, but let the *one* sign-in row carry an accent — e.g.
   render the revealed `Login with Linear →` link with the styleguide's primary-button treatment,
   and/or expand the Login section by default so the link is visible on load. Raise this one row;
   add no chrome elsewhere.

2. **Tighten the desktop tree row so label and `▶` read as one unit.**
   *Before:* label far-left, `▶` pinned to the 1400px right edge (~1050px gap).
   *After:* cap the row's interactive width (a `max-width` on the content, or move `▶` adjacent to
   the label as mobile already does) so the control sits near what it controls. Preserve the airy
   right margin as whitespace, not as a control-stranding gap.

3. **Make status dots semantic.**
   *Before:* `● live` and `● disconnected` poll dots both render `--fg-dim` gray; green means
   "healthy/on" elsewhere.
   *After:* color the dot by state — `--green` for `live`, `--red`/`--fg-dim` for `disconnected`.
   One CSS hook on the poll-status element. Applies to observation + collective.
   *(Note: not re-verified this cycle — confirm on a live PAT-mode server before acting.)*

4. **Lift faint secondary copy off `--fg-vdim` where it carries meaning.**
   *Before:* the proxy "(N)" collapsible counts lean `--fg-vdim` (~1.16:1).
   *After:* reserve `--fg-vdim` for structure (separators, box-drawing, backlog glyphs) and use
   `--fg-dim` for any text a user is expected to *read*. The acute roadmap instance was already
   fixed (LIN-570); this is the gentler systemic follow-on.

5. **Add a non-color channel to `/kpis` series.**
   *Before:* donut + multi-series legends distinguish series by color only.
   *After:* add dash patterns / point styles / direct labels (Chart.js supports all three) so the
   2xx/4xx/5xx and phase legends survive a grayscale or colorblind read.

6. **Strengthen the "more to the right" affordance in swim on mobile.**
   *Before:* lane cards clip at the right edge with no scroll cue.
   *After:* a right-edge fade/gradient or a small `›` peek so the horizontal scroll is
   discoverable. Keep the 2D layout — just signal it.

**Surfaces that already look good as-is** (minimalism is working, no change recommended): the
overlays, swipe card, pipeline floor view, settings/dispatch/proxy/audit form sections, and the
styleguide itself.

---

## Fix-tasks minted

**None.** No finding rose to objective breakage this cycle: both prior 🔴 fixes hold, Lighthouse
Accessibility is 100, and no new contrast/overflow/broken-layout defect surfaced on any fresh
render. The advisory tail is left for a human. Zero minted tasks is the honest, un-padded outcome
(§8: "ZERO is valid when nothing rises to the bar").
