# Design & Interface Review — 2026-07-03 (LIN-942)

**Task:** LIN-942 (periodical run, origin LIN-520) · **Reviewer role:** review analyst
**Evidence:** the *rendered* product, regenerated at run time — never the committed baselines.
**Policy:** corrective review with an advisory tail — mint fix-tasks only for objective
breakage; subjective design-direction calls stay in this report for a human.

> **Fourth run.** Measured against the baseline `design-interface-review-2026-06-20.md`
> (LIN-565), the second run `-lin568.md` (LIN-568, first §5 craft pass), and the third
> `design-interface-review-2026-06-25.md` (LIN-671, clean cycle). This run builds on all three:
> it re-verifies the two closed fix-tasks on a fresh render and re-checks the carried-forward
> 6-item advisory tail against the live UI, rather than re-deriving the survey.

---

## Headline

**Clean cycle — zero objective breakage, zero fix-tasks minted.** Both prior fix-tasks
(LIN-566 landing keyboard/SR reachability, LIN-570 roadmap north-star contrast) are **verified
holding on a fresh render**. Lighthouse Accessibility is **100**; no new contrast, overflow, or
broken-layout defect surfaced on any of the ~22 surfaces captured at desktop + mobile.

**The story of this cycle is forward motion on the advisory tail, not new breakage.** Since
LIN-671 the product has shipped a **complete landing redesign** (the `harbour.` brand hero) and
an **opt-in dark theme**. Two of the six standing advisory items have been **materially
addressed** by that work:

- **Advisory #1 — the landing primary CTA (the highest-leverage item across all four runs) is
  now resolved.** The sign-in is a real teal primary button, first in tab order, **8.92:1**
  contrast — exactly the "give the one sign-in row visual dominance within the idiom" change the
  prior three reports asked for.
- **Advisory #3 — status dots are now semantic on Observation** (`.obs-poll-status` renders
  `● live` in `var(--green)`). It still renders gray on Collective, so the item carries forward
  **narrowed to Collective only**.

The remaining four advisory items (desktop tree-row gap, faint `--fg-vdim` secondary copy,
`/kpis` color-only series, swim mobile scroll cue) persist unchanged and stay advisory. The
honest outcome is a written report with **no new tasks**.

---

## How this evidence was gathered

- **Regenerated full-page renders** at desktop (1400×1000) and mobile (390×844) via the repo's
  own visual machinery: `npx playwright test --config=playwright.visual.config.js` over
  `pages-screenshots.spec.js` (16 page captures incl. overlays) and `swim-screenshots.spec.js`
  (12 swim captures), plus the `ship-screenshots.spec.js` family. I read the **freshly
  generated** output, not the committed PNGs; **the regenerated baselines under
  `tests/screenshots/**` were reverted afterward** (`git checkout tests/screenshots`, 42 paths) —
  a review must not double as a baseline refresh.
- **Live browser pass** (Chrome DevTools) on the **cold, unauthenticated landing** — a no-PAT
  test-mode server (`LINEAR_ACCESS_TOKEN=` blank, `NODE_ENV=test` to skip the prod HTTPS
  redirect) so `/` renders the real landing. Scripted focus-order / contrast / keyboard-order
  probes + a **Lighthouse a11y navigation audit** (desktop).
- **Live captures of the surfaces the mock maker does not cover** — Observation (first-class, no
  flag), Suggested Next Run, Task Chat — driven through the `/test/set-session?features=` seam on
  the live server. These rendered in **dark theme** (the DevTools browser reports
  `prefers-color-scheme: dark`), which gave a free coherence check of the new dark palette across
  four surfaces.
- **Source-level verification** of the two closed fix-tasks and the Collective status dot,
  because the mock harness renders the **landing** for the `roadmap` route (still no
  `test-token → testMockData` arm — the known harness gap, **confirmed to persist**), so the live
  roadmap helper line could not be captured by the maker this cycle.
- **Evidence saved** beside this report under `docs/reviews/_evidence-2026-07-03/`:
  `landing-cold-desktop.png`, `landing-dark-desktop.png`, `dashboard-{desktop,mobile}.png`,
  `observation-desktop.png`, `next-run-desktop.png`, `task-chat-desktop.png`, `kpis-desktop.png`,
  `proxy-desktop.png`, `settings-desktop.png`, `styleguide-desktop.png`, `swipe-mobile.png`,
  `swim-mobile.png`, `ship-desktop.png`, `overlay-modal-desktop.png`.
- **Measured against** the shipped design system: `/styleguide` (`lib/render-styleguide.js`) + the
  `:root` token layer in `public/style.css` (semantic `--text/--muted/--faint/--brand/--green/…`
  over the structural `--fg/--fg-dim/--fg-vdim` primitives).

**Surfaces reviewed (fresh render):** landing (cold light + dark), `/styleguide`, `/privacy`,
`/terms`, public `/kpis`, project-tree dashboard (desktop + mobile), observation, swipe, swim
(incl. mobile), settings, dispatch, prompts, custom-prompts, audit, proxy, next-run, task-chat,
ship, shared modal/toast overlays. Roadmap was verified **at source** (harness gap). Collective's
live Yap transcript remains non-deterministic (the maker still defers it); its status-dot rule was
verified at source.

---

## Regression check — both prior fix-tasks verified holding

### ✅ LIN-566 — Landing sign-in keyboard/SR reachability (was baseline 🔴) — HOLDS (and strengthened)

Re-checked live on the cold landing. The landing was **redesigned** since LIN-671 (the `harbour.`
hero), and the reachability is not just preserved but improved:

- The primary CTA is now a real `<a href="/auth/linear">` styled as a **teal primary button**
  (`background: rgb(45,212,191)`, text `rgb(4,35,31)`, `padding: 12px 24px`, `border-radius: 4px`)
  and is **FIRST in the tab order** (14 focusable elements; index 0 = "Log in with Linear").
- No longer a collapsed tree row — the login link is visible on load, not hidden behind an
  expand. A keyboard/SR visitor reaches sign-in with zero interaction.
- Lighthouse Accessibility **100**.

**Not regressed — improved.** (This is also what closes advisory #1; see below.)

### ✅ LIN-570 — Roadmap "north star" helper contrast (was 🔴 1.16:1) — HOLDS

`.roadmap-north-star-help` (`public/roadmap.css:405`) now resolves `color: var(--muted)`, and
`--muted` maps to `--fg-dim` = `#666666` (**5.74:1** on white — passes WCAG AA). The structural
`--fg-vdim` token that caused the 1.16:1 failure is gone from that rule, and the fix has since
moved up a layer from a raw `--fg-dim` to the semantic `--muted` token — the correct home.
Verified at HEAD (the maker renders landing for the roadmap route, so this was confirmed at source
rather than by a fresh roadmap PNG; the rule is unambiguous).

---

## Severity-ranked findings

**🔴 HIGH / objective breakage: none.**
**🟡 MEDIUM / 🟢 LOW: all advisory. Two advanced this cycle; four carried forward.**

### ✅ ADVANCED — Advisory #1 (landing CTA dominance) is resolved by the landing redesign

The single highest-leverage "looks better" item across all three prior runs. The old landing's
"Connect with Linear" collapsed tree row (equal visual weight with marketing rows, login link
hidden until expanded) is gone. The new hero leads with the anchor mark, the `harbour.` wordmark,
the tagline **"Keep human intent in command of AI execution"**, and a **centered teal primary
button "Log in with Linear."** The eye lands on sign-in first; the CTA now carries clear button
affordance and **8.92:1** contrast. This is precisely the prior reports' advisory-#1 "after"
proposal, executed within the idiom. **Recorded as resolved; removed from the carried-forward
tail.**

### ✅ ADVANCED (partial) — Advisory #3 (semantic status dots) resolved on Observation, persists on Collective

- **Observation:** `.obs-poll-status` (`public/observation.css:122`) now renders the pulsing
  `● live` indicator in `color: var(--green)` — confirmed live at `rgb(46,230,95)` (the dark-theme
  green), beside a green workspace chip. The "live" dot is finally green. **Resolved here.**
- **Collective:** `.collective-poll-status` (`public/collective.css:189`) is still
  `color: var(--fg-dim)`, so both `● live` and `● disconnected` render gray. The item **carries
  forward, narrowed to Collective only** (advisory tail #3 below). Still a semantic-color
  consistency gap, not breakage — the text label carries the meaning.

### 🟡 MEDIUM (advisory, persists) — Desktop tree rows: ~1050px gap between label and its `▶`

Re-confirmed on `dashboard-desktop.png` and the cold landing tree sections: at 1400px each row's
label sits far-left while its `▶` toggle is pinned to the far-right edge (~1050px of empty space
between a row and the control that operates it). Weakens row-as-a-unit scanning; `▶` reads as
detached chrome. **Mobile is excellent** (`dashboard-mobile.png`): the arrow sits beside the
label, no overflow. Subjective layout call; the airiness may be intended. (Advisory tail #1 below.)

### 🟢 LOW (advisory, persists) — re-confirmed on fresh renders

- **Faint `--fg-vdim` secondary copy** (tail #3): `.proxy-collapsible-count`
  (`public/proxy.css:253`) still renders the "(1)" / "(0)" counts beside *existing tokens* and
  *recent events* at `--fg-vdim` (`#eeeeee`, ~1.16:1) — visible-but-barely on `proxy-desktop.png`.
  A secondary count, not instructional prose, so it stays below the mint bar (the acute roadmap
  instance was already fixed by LIN-570).
- **`/kpis` color-only series encoding** (tail #4): re-confirmed on `kpis-desktop.png`. The
  "proxy responses" donut (2xx/4xx/5xx) and the "proxy calls by phase" 5-series legend
  (orienting/deciding/acting/watching/reporting) distinguish series by color only — standard for
  Chart.js, a soft colorblind gap.
- **Swim mobile in-lane scroll cue** (tail #5): re-confirmed on `swim-mobile.png` — lane cards
  clip at the right edge (`Add monit…`, `Widget da…`) with a weak "more to the right" affordance.
  Expected for a 2D dependency layout on a 390px screen.

### New observation (not promoted, cross-altitude) — carried from LIN-671

- `/kpis` "top proxy endpoints" still plots **`foreman/status`** as its largest bar (alongside a
  smaller `agent/status`). Per CLAUDE.md, `/foreman/status` is the **deprecated alias** for the
  canonical `/agent/status` — so the chart shows a deprecated label as a distinct, dominant
  series. This is a data/labeling concern at the **API / Code Quality** altitude (endpoint naming
  in telemetry), not a rendered-design defect. Unchanged since LIN-671; re-noted for the next
  API/Code review; **not minted, not this review's altitude.**

### Deferred (not this review's altitude — re-confirmed)

- Landing **missing `meta description`** (Lighthouse SEO 90) and **`llms.txt` fails the
  recommended format** (Agentic Browsing 67) — the only two Lighthouse failures, both non-visual.
  → Documentation / Code Quality.
- The **mock `roadmap` visual baseline still renders the landing page** (no `test-token →
  testMockData` arm on the roadmap route). Test-harness / Code-Quality territory. → Code Quality.

---

## Required: first-experience section

A cold visitor now lands on a **purpose-built brand hero** (`lib/components/landing-hero.js`),
not the old "Linear Projects Viewer" tree. Above the fold: the teal anchor mark, the `harbour.`
wordmark, the tagline **"Keep human intent in command of AI execution,"** and a single centered
**"Log in with Linear"** primary button. Below it, a collapsible tree still doubles as the pitch —
**What Harbour Is** ("Mission control for AI-built software" / "The control plane for your coding
agents"), **Views** (Tree, swipe & swim lanes / Observation / Roadmap & ship), **Orchestration**
(Dispatch / Autopilot / Workspace API proxy), **Self-Host**, **Source**, **Harbour OS** ("A
separate in-browser workstation Harbour can dispatch into"). A subtle graph-paper grid sits behind
it all. The product still explains itself *in its own UI idiom*, and the copy is tight and honest.

**What it is / how it works:** communicated well, and better than before — the tagline states the
thesis in one line and the sectioned tree fills in the detail.

**Primary CTA — the standing tension is resolved.** For three cycles the highest-leverage note was
"the single most important action has the least visual dominance." The redesign fixes it head-on:
the sign-in is now the visually dominant element on the page, a real button, first in tab order,
high-contrast, visible on load. This is no longer a weak point.

**Aesthetic coherence & first impression.** In the first ~5 seconds the surface reads as
trustworthy, intentional, and *more* polished than the prior baseline. The hero gives the eye an
unambiguous first read (brand → tagline → CTA) that the old flat, uniform-weight tree lacked — the
one criticism that ran through every prior run. The mono/sans split (JetBrains Mono for the
wordmark and machine facts, Inter for prose/labels) and the anchor mark read as a deliberate
design language, not an accidental default. The **dark theme** (new since LIN-671) renders
coherently across landing, observation, next-run, and task-chat — the teal CTA stays legible on
the dark ground and the token layer carries over cleanly; the styleguide now documents both themes
side by side. Restraint is still the dominant note, and it is working better than ever.

**Empty states / first-run (authenticated):** still a strength — observation ("○ nothing running
right now"), dispatch ("Queue is empty" / "No tokens yet"), `/kpis` ("○ no data yet"), next-run
("○ click 'generate suggestions'…"), task-chat ("○ enter a task above, then ask it anything…"),
audit ("Run Audit"). Calm and human. The experimental surfaces surface a clear amber/red "AI is
not configured" notice when OpenRouter is absent — honest, not broken.

**Mobile first-run is better than desktop** — the narrow column keeps expand arrows beside labels,
no overflow, a clean top-to-bottom read (`dashboard-mobile.png`).

---

## Accessibility & performance pass

- **Lighthouse (landing, desktop, navigation):** Accessibility **100**, Best Practices **100**,
  SEO **90**, Agentic Browsing **67**. The only two failures are `meta-description` and `llms-txt`
  (both deferred, non-visual). 48 audits passed, 2 failed.
- **Keyboard / focus order (landing, live):** 14 focusable elements; the **"Log in with Linear"
  CTA leads the order** (index 0). Expandable tree rows retain `role="button"` + `tabindex="0"`
  (LIN-566 verified). Focus order logical.
- **Contrast:** the landing CTA measures **8.92:1** (passes AAA). The north-star helper measures
  **5.74:1** (LIN-570 holds). No new contrast failure surfaced on any captured surface. The known
  borderline `.proxy-collapsible-count` (~1.16:1) stays advisory — a secondary count, not prose.
- **Responsive / overflow:** no horizontal overflow on landing, dashboard, KPIs, settings, or the
  experimental surfaces at mobile width. Swim's in-lane horizontal scroll is by-design (advisory
  #5).
- **Heavier pages:** `/kpis` (~11 Chart.js charts) renders without visible jank after settle. No
  performance defects at this altitude.

---

## What's working (recorded so the next run can detect regressions)

- **Landing hero (new):** anchor mark + `harbour.` wordmark + tagline + teal primary CTA over a
  subtle grid, with a sectioned collapsible pitch-tree below. The strongest first impression this
  periodical has recorded.
- **Styleguide:** ships tokens, a type scale, ✓/◐/○ indicators, buttons, cards, badges, status
  pills, empty states, primitives, iconography, **and a light/dark Themes section** — the committed
  visual baseline, well-formed and now theme-complete.
- **Dashboard (tree):** clean section headers (▼ In Progress / Project Alpha / Project Beta),
  ◐/○ state dots, "+ Add task" / "show N completed" affordances, consistent footer nav.
- **Observation:** calm mobile-first feed shell — green `● live` poll tag, FILTER / ACTIVE
  eyebrows, "○ nothing running right now" empty state, collapsible Completed archive.
- **Swipe:** polished card — `●●●● Urgent` priority dots, `bug` label pill, collapsible
  Description/Comments/Recap/Brief/Context/Prompts, prev/next with paging dots.
- **KPIs:** stat-card grid (11 cards) + consistent-palette charts + good "○ no data yet" empty
  states + footer provenance line.
- **Settings / Dispatch / Proxy / Audit / Custom-prompts / Next-run / Task-chat:** organized card
  sections with real form controls (selects, ● on/○ off toggles, generate buttons) — the affordance
  the landing tree deliberately forgoes. Experimental surfaces are clearly labelled and gate cleanly.
- **Ship:** radial dependency layout — central "IN PROGRESS" cluster, orbiting cards by sector,
  dashed concentric rings, PROJECT/ORIENTATION toggle. Distinctive (the protected experiment).
- **Overlays:** shared modal (`token-modal`, "Token Created") + toast primitives render
  consistently at both widths.

---

## Actionable advisory tail (ranked; mint nothing from here)

Re-confirmed against fresh renders; **prior #1 (landing CTA) is resolved and removed**, so the tail
is now **five items**. Subjective design-direction calls, judged *within* the minimal CLI/terminal
idiom and measured against `/styleguide`. Ordered so a maintainer reads the top item first.

1. **Tighten the desktop tree row so label and `▶` read as one unit** *(now highest leverage)*.
   *Before:* label far-left, `▶` pinned to the 1400px right edge (~1050px gap).
   *After:* cap the row's interactive width (a `max-width` on the content, or move `▶` adjacent to
   the label as mobile already does) so the control sits near what it controls. Preserve the airy
   right margin as whitespace, not as a control-stranding gap.

2. **Make the Collective status dot semantic, matching Observation.**
   *Before:* `.collective-poll-status` renders `● live` / `● disconnected` in `--fg-dim` gray.
   *After:* mirror the Observation fix — `color: var(--green)` for `live`, `--red`/`--fg-dim` for
   `disconnected`. Observation already did exactly this (`.obs-poll-status`); this is the last
   surface where the "live" dot isn't green. One CSS hook.

3. **Lift faint secondary copy off `--fg-vdim` where it carries meaning.**
   *Before:* the proxy "(N)" collapsible counts lean `--fg-vdim` (~1.16:1).
   *After:* reserve `--fg-vdim`/`--faint` for structure (separators, box-drawing, backlog glyphs)
   and use `--fg-dim`/`--muted` for any text a user is expected to *read*. The acute roadmap
   instance was already fixed (LIN-570); this is the gentler systemic follow-on.

4. **Add a non-color channel to `/kpis` series.**
   *Before:* donut + multi-series legends distinguish series by color only.
   *After:* add dash patterns / point styles / direct labels (Chart.js supports all three) so the
   2xx/4xx/5xx and phase legends survive a grayscale or colorblind read.

5. **Strengthen the "more to the right" affordance in swim on mobile.**
   *Before:* lane cards clip at the right edge with no scroll cue.
   *After:* a right-edge fade/gradient or a small `›` peek so the horizontal scroll is
   discoverable. Keep the 2D layout — just signal it.

**Surfaces that already look good as-is** (minimalism is working, no change recommended): the new
landing hero, the overlays, the swipe card, the observation feed, the ship radial canvas, the
settings/dispatch/proxy/audit/next-run/task-chat form sections, and the styleguide itself.

---

## Fix-tasks minted

**None.** No finding rose to objective breakage this cycle: both prior 🔴 fixes hold, Lighthouse
Accessibility is 100, and no new contrast/overflow/broken-layout defect surfaced on any fresh
render. Two advisory items advanced through normal product work (landing CTA resolved; status dots
now semantic on Observation) and the remaining five are left for a human. Zero minted tasks is the
honest, un-padded outcome (§7: "zero is valid when nothing rises to the bar").
