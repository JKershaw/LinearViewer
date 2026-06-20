# Design & Interface Review — 2026-06-20 (LIN-568)

**Task:** LIN-568 (periodical run, origin LIN-520) · **Reviewer role:** review analyst
**Evidence:** the *rendered* product, regenerated at run time — never the committed baselines.
**Policy:** corrective review with an advisory tail — mint fix-tasks only for objective
breakage; subjective design-direction calls stay in this report for a human.

> **Second run.** Measured against the baseline `docs/reviews/design-interface-review-2026-06-20.md`
> (LIN-565). This run is the **first to apply the full §5 design-quality craft pass** added by
> LIN-567. Filename is suffixed `-lin568` to avoid colliding with the same-date baseline.

---

## How this evidence was gathered

- **Regenerated full-page renders** at desktop (1400×1000) and mobile (390×844) via the repo's
  own visual machinery: `npx playwright test --config=playwright.visual.config.js` over
  `pages-screenshots.spec.js`, `swim-screenshots.spec.js`, `ship-screenshots.spec.js`
  (16 page captures + swim/ship families; collective deferred in that harness). **The
  re-rendered baselines under `tests/screenshots/**` were reverted afterward** (`git checkout`) —
  a review must not double as a baseline refresh.
- **Live browser pass** (Chrome DevTools) for surfaces the maker can't capture cleanly:
  - **Cold, unauthenticated landing** — a no-PAT server (`LINEAR_ACCESS_TOKEN=` blank) so `/`
    renders the real landing, not a redirect. Scripted focus-order / keyboard-activation probes
    + Lighthouse (navigation, desktop).
  - **Roadmap, autopilot dashboard, collective** — a PAT-mode server with real Linear data,
    feature flags toggled on for the session (and **reverted to off afterward** so no stray
    experimental links persist to the workspace prefs). Scripted contrast measurement and
    computed-style probes.
- **Evidence saved** beside this report: `docs/reviews/_evidence-2026-06-20-lin568/`
  (mock page renders `*-{desktop,mobile}.png`; live captures `live-*.png`).
- **Measured against** the shipped design system: `/styleguide` (the `:root` tokens in
  `public/style.css`).

**Surfaces reviewed:** landing (cold), `/styleguide`, `/privacy`, `/terms`, `/kpis`,
project-tree dashboard, swipe, swim, settings, roadmap (live), dispatch, proxy, prompts,
custom-prompts, audit, pipeline, ship, autopilot dashboard (live), collective (live shell),
shared modal/toast overlays.
**Collective:** captured live this cycle (first time in this periodical) — the static shell is
deterministic enough on a PAT server; the live Yap transcript still isn't (`● disconnected`,
no channel traffic), which is expected.

---

## Headline

The app's **design system is real and well-consumed** — `/styleguide` ships tokens, a type
scale, the ✓/◐/○ indicators, buttons, cards, badges, status banners, and empty states, and
~20 surfaces genuinely use them. The CLI/terminal aesthetic reads as deliberate, not accidental.
Empty-state copy remains a strength ("nothing running right now", "no finished runs in the last
30 days", "Queue is empty", "○ no messages yet").

**The baseline's one 🔴 (landing sign-in keyboard/SR-unreachable) is fixed and verified live
(LIN-566).** This run surfaced **one new objective defect**: a roadmap helper line is rendered at
**1.16:1 contrast — effectively invisible** — because a structural box-drawing token is used for
readable prose. It escaped automated tooling precisely because Lighthouse only audits the cold
landing, not the flagged roadmap. Everything else is advisory.

---

## Severity-ranked findings

### 🔴 HIGH — Roadmap "north star" helper text is unreadable (objective, NEW) → task minted

On `/workspace/:urlKey/roadmap`, the helper line under the North-star textarea —
**"Without a north star, layers 3b and 4 are skipped."** — is rendered at
`color: var(--fg-vdim)` = `#eeeeee` on a white background. Measured contrast: **1.16:1**
(WCAG 2.1 1.4.3 Contrast Minimum, AA, requires 4.5:1 for normal text). The text is meaningful —
it tells the user that two report layers will be *silently skipped* without input — yet it is
functionally invisible.

- **Root cause is a token misuse, not a one-off color.** `--fg-vdim` is documented in
  `public/style.css` as *"Very dim — box-drawing characters, structural elements"*. The rule
  `.roadmap-north-star-help` (`public/roadmap.css:435`) applies it to body copy. The trivial fix
  is `--fg-dim` (`#666`, the token used for every other helper/secondary line on the page, which
  measures a comfortable 5.74:1).
- **Why automated tools missed it:** Lighthouse scored Accessibility **100** — but only because
  it audits the cold landing; the roadmap is behind a feature flag. This is the baseline's
  "automated 100 is not a pass — use your eyes" lesson, recurring on a different surface.
- **Class check (isolated, mostly).** `color: var(--fg-vdim)` appears in ~18 rules across the
  stylesheets, but nearly all are the token's *intended* structural use — separators
  (`.stat-separator`, `.dashboard-stat-sep`, `.local-workspace-cta-sep`), prefix/tree glyphs
  (`.kpi-tree-glyph`, `.issue-prefix`, `.option-prefix`), and deliberate backlog-state dimming
  (`.status-pill--backlog`, `.swim-box-state.backlog`, `.swipe-card-status .state.backlog`).
  Only **two** apply it to readable content: this roadmap helper (acute — instructional prose)
  and `.proxy-collapsible-count` (`proxy.css:259` — the secondary "(N)" count beside "existing
  tokens", borderline, lower priority). The fix should correct the roadmap helper and check the
  proxy count; it need not sweep the legitimate structural uses.

→ **Fix-task minted** (see below). This is the only finding that rose to objective breakage.

### ✅ RESOLVED & VERIFIED — Landing sign-in keyboard/SR reachability (was baseline 🔴, fixed by LIN-566)

Re-checked live on the cold landing. The fix holds and has **not regressed**:

- The "Connect with Linear" row is now `<div class="line expandable" role="button" tabindex="0"
  aria-expanded="false">` — **first in the tab order** (focusable set = 8 tree rows + 5 footer
  links; the sign-in row leads it).
- Activating it by keyboard works end-to-end: focusing the row and pressing **Enter** flips
  `aria-expanded` `false → true`, reveals the `Login with Linear →` (`/auth/linear`) link, and
  that link becomes **visible and in the tab order**. (Verified by script, not just markup.)
- `:focus-visible` outline is present (WCAG 2.4.7).

A keyboard-only / screen-reader visitor now has a complete path into the product. Confirmed
resolved.

### 🟡 MEDIUM (advisory, persists) — Desktop tree rows: ~1000px gap between label and its control

Unchanged from baseline. On the project-tree dashboard and landing at 1400px, each row's label
sits far left while its `▶` control is pinned to the far-right edge — ~1000px of empty space
between a row and the affordance that operates it. It weakens row-as-a-unit scanning and makes
`▶` read as disconnected chrome. Mobile (390px) is excellent — the arrow sits beside the label.
*Subjective layout/hierarchy call; the airiness may be intended, but the cost on wide screens is
real. Left for a human (see advisory tail #2).*

### 🟢 LOW (advisory, persists) — Smaller subjective notes (all re-confirmed against fresh renders)

- **Landing CTA visual affordance** is low even for mouse users: the primary CTA is a collapsed
  tree row with no button styling, login link hidden until expanded. Defensible within the
  CLI/tree aesthetic, but it asks a first-timer to *discover* how to sign in. (Advisory tail #1.)
- **Autopilot dashboard `● live` dot reads gray, not green.** Confirmed live: the poll status
  renders `rgb(102,102,102)` while `--green` is `rgb(22,160,133)`. The same view shows a *green*
  `● LinearViewer` workspace chip inches away, so "live" (the strongest healthy signal) is the
  one dot that isn't green. The text label "live" carries the meaning, so this is a
  semantic-color consistency gap, not breakage. The collective view shares the pattern
  (`● disconnected`, also gray). (Advisory tail #3.)
- **`/kpis` charts encode series by color only** (2xx/4xx/5xx donut, 5-phase proxy legend).
  Standard for Chart.js; a soft colorblind gap. (Advisory tail #5.)
- **Swim lanes on mobile rely on in-lane horizontal scroll** — cards extend past the right edge
  (`Add monit…`, `Widget da…` visibly clipped) with weak "more to the right" affordance.
  Expected for a 2D dependency layout on a narrow screen. (Advisory tail #6.)

### Deferred (NOT this review's altitude — re-confirmed, do not re-own)

- Landing **missing `meta description`** (Lighthouse SEO 90) and **`llms.txt` fails the
  recommended format** (Agentic Browsing 67) — the only two Lighthouse failures, both non-visual.
  → Documentation / Code Quality reviews.
- The **mock "roadmap" visual baseline still captures the landing page** (the `roadmap` route has
  no `test-token → testMockData` arm, so a test-token session 401s and falls through to landing —
  confirmed again: `tests/screenshots/pages/roadmap-*.png` show landing, not roadmap). Same for
  `pipeline`'s lack of that arm (it rides the local-provider harness instead). Test-harness /
  code-quality territory; the *real* roadmap, rendered live, is clean (below). → Code Quality.

---

## Required: first-experience section

A cold visitor lands on `/` and sees the centered title **"Linear Projects Viewer"** above a
collapsible tree whose top-level sections double as a pitch: **Login**, **Views** (Projects tree
/ Swipe / Swim lanes), **What This Is** ("Linear is powerful but busy. This gives you just the
tree."), **AI Prompts**, **Self-Host**, **Use Cases**, **Source**. The product explains itself
*in its own UI idiom* — clever, and the copy is tight and honest.

**What it is / how it works:** communicated well in one screen.

**Primary CTA — the standing tension.** Sign-in is now *reachable* (LIN-566 — the breakage is
gone), but its *visual affordance* is still the weak point: "Connect with Linear" is a collapsed
tree row styled identically to the marketing rows, with no button treatment, requiring a
click/Enter to reveal the actual login link. The single most important action on the most
important page has the *least* visual dominance. For a CLI-aesthetic product this is a deliberate
art-direction choice, not breakage — but it is the highest-leverage "looks better" lever on the
app (advisory tail #1).

**Aesthetic coherence & first impression.** In the first ~5 seconds the surface reads as
trustworthy, intentional, and coherent. The monospace/tree language is executed as a real design
system, not an accidental default. Restraint is the dominant note and it works. The one thing
working *against* first-impression polish is that everything carries near-equal visual weight
(flat monospace + uniform rows) — so the eye has no obvious first read. That's the theme of the
advisory tail, not a defect.

**Empty states / first-run (authenticated):** strong — autopilot dashboard ("nothing running
right now" / "no finished runs in the last 30 days"), dispatch ("Queue is empty" / "No tokens
yet"), `/kpis` ("○ no data yet"), collective ("○ no messages yet — start a discussion above,
then watch it unfold here"). Calm and human. (Caveat: collective's empty-state line is itself
rendered faint — see tail #4.)

**Mobile first-run is better than desktop** — narrow column keeps expand arrows beside labels,
no overflow, clean top-to-bottom read.

---

## Accessibility & performance pass

- **Lighthouse (landing, desktop, navigation):** Accessibility **100**, Best Practices **100**,
  SEO **90**, Agentic Browsing **67**. The only two failures are `meta-description` and
  `llms.txt` (both deferred, non-visual).
- **Keyboard / focus order (landing):** 13 focusable elements, sign-in row leads the order;
  Enter activation reveals and tabs to the login link (LIN-566 verified). Focus order logical.
- **Contrast:** automated landing checks pass; the **roadmap north-star helper fails at 1.16:1**
  (🔴 above) — found by direct measurement on the flagged page, which Lighthouse doesn't audit.
  Other measured text passes (subtitle/footer 5.74:1, textarea placeholder 4.61:1).
- **Responsive / overflow:** no horizontal overflow on landing, roadmap, or the authenticated
  tree at mobile width. Swim's in-lane horizontal scroll is by-design.
- **Heavier pages:** `/kpis` (~9 Chart.js charts) and roadmap render without visible jank after
  settle; ship's radial canvas pans/zooms smoothly. No performance defects at this altitude.

---

## What's working (recorded so the next run can detect regressions)

- **Roadmap (live):** leads with velocity (`avg 23.4 shipped/week`), `│`-prefixed section
  headers, collapsible "Recently shipped (150 in 90 days)" / "By project" / "Reading" / "Chat",
  "At a glance" recap box. On-brand and clean (apart from the 🔴 helper line).
- **Autopilot dashboard (live):** Autopilot/All-runs scope toggle, green workspace chip, calm
  empty states, "● live" poll status. Coherent (apart from the gray-live advisory).
- **Collective (live shell):** card-based Set-up (workspaces / channel / topic / target / start)
  + Discussion pane with say-box — consumes the same cards, buttons, inputs, and `●` status idiom.
- **Pipeline:** three-column floor view (queue / active / activity), status dots, priority-colored
  left borders. Clean.
- **Ship:** radial dependency layout — central in-progress cluster, orbiting cards, section
  labels, zoom control. Distinctive (the protected experiment).
- **Swipe:** polished mobile card — priority dots, label pills, collapsible sections, prev/next
  with correct disabled state.
- **KPIs:** stat-card grid + consistent-palette charts + good empty states.
- **Settings / Dispatch / Proxy / Prompts / Custom-prompts / Audit:** organized card sections
  with real toggle/select/form controls — the affordance the landing tree deliberately forgoes.
- **Overlays:** shared modal (`token-modal`) + toast (info/error, semantic left-border colors)
  primitives render consistently at both widths.

---

## Actionable advisory tail (ranked; mint nothing from here)

Subjective design-direction calls, judged *within* the minimal CLI/terminal idiom and measured
against `/styleguide`. Ordered so a maintainer reads the top item first.

1. **Give the landing primary CTA visual dominance** *(highest leverage)*.
   *Before:* "Connect with Linear" is a collapsed tree row, no button styling, login link hidden
   until expanded — equal weight with marketing rows.
   *After (within idiom):* keep the tree row, but let the *one* sign-in row carry an accent — e.g.
   render the revealed `Login with Linear →` link with the styleguide's primary-button treatment,
   and/or expand the Login section by default so the link is visible on load. The eye should land
   on "sign in" first. Don't add chrome elsewhere; raise this one row.

2. **Tighten the desktop tree row so label and `▶` read as one unit.**
   *Before:* label far-left, `▶` pinned to the 1400px right edge (~1000px gap).
   *After:* cap the row's interactive width (e.g. `max-width` on the content, or move `▶`
   adjacent to the label as mobile already does) so the control sits near what it controls.
   Preserve the airy right margin as whitespace, not as a control-stranding gap.

3. **Make status dots semantic.**
   *Before:* `● live` and `● disconnected` poll dots both render `--fg-dim` gray; green is used
   for "healthy/on" elsewhere (workspace chip, ✓).
   *After:* color the dot by state — `--green` for `live`, `--red` (or `--fg-dim`) for
   `disconnected` — so the dot reinforces the word instead of contradicting it. One CSS hook on
   the poll-status element keyed off its text/state. Applies to dashboard + collective.

4. **Lift faint secondary copy off the `--fg-vdim` token where it carries meaning.**
   *Before:* beyond the 🔴 roadmap helper, the collective empty-state line and the proxy "(N)"
   count lean very dim.
   *After:* reserve `--fg-vdim` for structure (separators, box-drawing, backlog glyphs) and use
   `--fg-dim` for any text a user is expected to *read*. (The 🔴 task covers the acute instance;
   this tail item is the gentler systemic follow-on.)

5. **Add a non-color channel to `/kpis` series.**
   *Before:* donut + multi-series legends distinguish series by color only.
   *After:* add dash patterns / point styles / direct labels (Chart.js supports all three) so the
   2xx/4xx/5xx and phase legends survive a grayscale or colorblind read.

6. **Strengthen the "more to the right" affordance in swim on mobile.**
   *Before:* lane cards clip at the right edge with no scroll cue.
   *After:* a right-edge fade/gradient or a small `›` peek so the horizontal scroll is
   discoverable. Keep the 2D layout — just signal it.

**Surfaces that already look good as-is** (minimalism is working, no change recommended): the
overlays, swipe card, pipeline floor view, ship radial canvas, settings/dispatch/proxy form
sections, and the styleguide itself.

---

## Fix-tasks minted

1. **(HIGH, objective)** Roadmap "north star" helper text is unreadable — `1.16:1` contrast
   from `--fg-vdim` (a structural box-drawing token) used for body copy in
   `.roadmap-north-star-help`. Switch to `--fg-dim`; also check `.proxy-collapsible-count`
   (same misuse, secondary). → **LIN-570**.

No other finding rose to objective breakage. The advisory tail is left for a human; a single
minted task is the honest, un-padded outcome.
