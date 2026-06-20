# Design & Interface Review — 2026-06-20

**Task:** LIN-565 (periodical run, origin LIN-520) · **Reviewer role:** visual QA
**Evidence:** the *rendered* product, regenerated at run time — never the committed baselines.
**Policy:** corrective review with an advisory tail — mint fix-tasks only for objective
breakage; subjective design-direction calls stay in this report for a human.

> **Baseline run.** No prior `design-*` / `design-interface-*` report exists under
> `docs/reviews/` (only the `drift-coherence`, `comprehension-debt`, and
> `recent-headwinds` families). This is the baseline the next run measures against.

---

## How this evidence was gathered

- **Regenerated full-page renders** at desktop (1400×1000) and mobile (390×844) via the
  repo's own visual machinery: `npx playwright test --config=playwright.visual.config.js`
  over `pages-screenshots.spec.js`, `swim-screenshots.spec.js`, `ship-screenshots.spec.js`.
  (The re-rendered baselines under `tests/screenshots/**` were reverted afterward — a
  review shouldn't double as a baseline refresh.)
- **Live browser pass** (Chrome DevTools) for surfaces the maker cannot capture cleanly:
  the **cold, unauthenticated landing** (started a no-PAT server so `/` renders the real
  landing instead of redirecting), plus the **roadmap** and **autopilot dashboard** with
  real Linear data (flags toggled on the live session). Saved captures:
  `docs/reviews/_evidence-2026-06-20/`.
- **Accessibility/performance:** Lighthouse (navigation, desktop) on the landing +
  scripted focus-order / keyboard-reachability / overflow probes.

**Surfaces reviewed:** landing (cold), `/styleguide`, `/privacy`, `/terms`, `/kpis`,
project-tree dashboard, swipe, swim, settings, roadmap, dispatch, proxy, prompts,
custom-prompts, audit, pipeline, ship, autopilot dashboard, shared modal/toast overlays.
**Not captured:** `collective` (deferred in the maker — non-deterministic channel + no
mock Yap; pre-existing, documented).

---

## Headline

The app has a **real, well-consumed design system**. `/styleguide` ships tokens, a type
scale, the ✓/◐/○ state indicators, buttons, cards, badges, status banners and empty
states — and the surfaces genuinely *use* them. Across ~19 surfaces the visual language is
consistent and the CLI/terminal aesthetic is coherent and deliberate. Empty-state copy is a
particular strength ("nothing running right now", "no finished runs in the last 30 days",
"○ no data yet", "Queue is empty").

The one **objective defect** is at the worst possible place: a cold visitor using a keyboard
or screen reader **cannot reach the sign-in action at all**. Everything else below is
advisory.

---

## Severity-ranked findings

### 🔴 HIGH — Landing sign-in is keyboard / screen-reader unreachable (objective)

On the cold landing (`/`, unauthenticated), the **only** keyboard-focusable elements are the
five footer links (`swipe · swim · github · privacy · terms`). The primary call-to-action —
"Connect with Linear" → `Login with Linear →` (`/auth/linear`) — is unreachable:

- The clickable row is `<div class="line expandable">` with **no `role`, no `tabindex`, no
  anchor** — so it is not in the tab order and is not announced as a control.
- The actual `/auth/linear` link lives inside a `.details.hidden` (`display:none`) block,
  revealed only *after* that div is clicked — so it is not in the tab order either.

Net: a **mouse** user can sign in (click the row → it expands → click the revealed link — a
non-obvious two-step), but a **keyboard-only or screen-reader** user has *no path into the
product*. This is WCAG 2.1.1 (Keyboard, A) and 4.1.2 (Name/Role/Value, A) failure on the
single most important first-run action.

Note Lighthouse scored **Accessibility 100** on this page — precisely because a
non-interactive `<div>` trips no automated rule. This is the class of defect automated tools
miss and a human review exists to catch.

**Root cause is a class, not a one-off.** The same non-focusable `.line.expandable` pattern
drives every collapsible row in the project tree (landing *and* the authenticated
dashboard), so keyboard users can't expand task details anywhere. The acute, must-fix
instance is the landing login (it blocks entry); fixing the row primitive fixes the class.
→ **Follow-up task minted** (see below).

### 🟡 MEDIUM (advisory) — Desktop tree rows: ~1000px gap between label and its control

In the project-tree dashboard at 1400px, each row's label sits at the far left (~x185)
while its `▶` expand control is pinned to the far right edge (~x1230) — over 1000px of empty
space between a row and the control that operates it. It hurts scannability (eye/mouse must
traverse the full width to associate row ↔ affordance) and makes the `▶` read as
disconnected chrome. The **same** rows on mobile (390px) are excellent — the arrow sits
beside the label. This is desktop-only, and it recurs on the landing page. *Subjective
layout/hierarchy call — left for a human; the minimal aesthetic may intend this airiness,
but the cost is real on wide screens.*

### 🟢 LOW (advisory) — Smaller, subjective notes

- **Landing CTA affordance / discoverability.** Beyond the keyboard issue above, the *visual*
  affordance of "Connect with Linear" is low even for mouse users: the primary CTA is a
  collapsed tree row indistinguishable from marketing content, with no button styling, and
  the login link is hidden until expanded. Weighed honestly against the deliberate
  CLI/tree aesthetic, this is a defensible art-direction choice — but it asks a first-time
  visitor to *discover* how to log in. Worth a human's eye.
- **Autopilot dashboard "● live" dot reads gray, not green.** The status pill claims "live"
  but the leading dot is dim/gray; elsewhere the system uses green for active/healthy
  (e.g. the green workspace dot in the same view, the green ✓). A live indicator that isn't
  green is a mildly confusing signal.
- **`/kpis` charts encode series by color only** (e.g. the 2xx/4xx/5xx response donut, the
  5-phase proxy-calls legend). Standard for Chart.js and not a blocker, but color-only
  encoding is a soft a11y gap for colorblind users.
- **Swim lanes on mobile rely on in-lane horizontal scroll** — cards extend past the right
  edge with no scroll affordance. Expected for an inherently 2D dependency layout on a
  narrow screen, but discoverability ("there's more to the right") is weak.
- **Landing is missing a `meta description`** (Lighthouse SEO) and **`llms.txt` fails the
  recommended format** (agentic-browsing audit). Both are non-visual; flagged here only
  because they surfaced in the same pass — **defer to the Documentation / Code Quality
  reviews** (out of this review's altitude).

---

## Required: first-experience section

A cold visitor lands on `/` and sees a centered title **"Linear Projects Viewer"** above a
collapsible tree whose top-level sections double as a pitch: **Login**, **Views**
(Projects tree / Swipe / Swim lanes), **What This Is** ("Linear is powerful but busy. This
gives you just the tree."), **AI Prompts**, **Self-Host**, **Use Cases**, **Source**. It is
genuinely clever — the product explains itself *in its own UI idiom*, and the copy is tight
and honest.

**What the product is / how it works:** communicated well. "What This Is" answers the
question directly, and "Views" previews the three modes. A newcomer can understand the value
in one screen.

**The primary CTA is the weak point.** Sign-in is the one thing a convinced visitor needs,
and it is (a) collapsed by default, (b) styled identically to marketing rows, and
(c) — critically — **keyboard/SR-unreachable** (HIGH finding above). The single most
important affordance on the most important page has the *least* affordance. For a CLI-aesthetic
product this is a deliberate tension, but the keyboard-reachability half of it is not a
matter of taste — it's breakage.

**Empty states / first-run (authenticated):** strong. The autopilot dashboard's "nothing
running right now" / "no finished runs in the last 30 days", dispatch's "Queue is empty" /
"No tokens yet", and `/kpis`'s "○ no data yet" all read as calm, human, and informative
rather than broken.

**Mobile first-run is better than desktop** — the narrow column keeps expand arrows beside
their labels and the page reads cleanly top-to-bottom with no overflow.

---

## Accessibility & performance pass

- **Lighthouse (landing, desktop, navigation):** Accessibility **100**, Best Practices
  **100**, SEO **90**, Agentic Browsing **67**. The two failures are non-visual:
  missing `meta description` and `llms.txt` format (both deferred above).
- **Keyboard / focus order (landing):** 5 focusable elements, all in the footer; **the
  login flow is not among them** (HIGH finding). Focus order within the footer is logical.
- **Contrast:** automated checks pass (Lighthouse 100); the dim-gray secondary text
  (descriptions, right-aligned metadata) is legible against white. No contrast failures
  observed in the rendered surfaces.
- **Responsive / overflow:** no horizontal overflow detected on landing, roadmap, or the
  authenticated tree at mobile width. Swim's in-lane horizontal scroll is by-design.
- **Heavier pages:** `/kpis` (Chart.js, ~9 charts) and `/roadmap` render without visible
  jank after settle; ship's radial canvas pans/zooms smoothly. No performance defects
  surfaced at the rendered-product altitude.

---

## Cross-altitude note (deferred, not a product finding)

While rendering, the **roadmap** visual-regression baseline captures the **landing page**,
not a roadmap: the roadmap route does a live provider fetch and — like `pipeline` — has **no
`test-token → testMockData` mock arm**, so the maker's short-lived token 401s
(`code: 'EXPIRED'`) and falls through to the landing/PAT fallback. The committed
`tests/screenshots/pages/roadmap-*.png` baselines are therefore misleading (they show
landing). This is **test-harness / code-quality territory**, not a user-visible defect —
flagged for the Code Quality Review, which owns the fix (the documented remedy is the
local-provider harness `pipeline` already uses). The *real* roadmap, rendered live with
authenticated data, is clean (see below).

---

## What's working (recorded so the next run can detect regressions)

- **Roadmap (live):** delivery-focused, leads with velocity (`avg 23.1 shipped/week`),
  `│`-prefixed section headers, dated ship-log grouped by week, "By project" section. On-brand.
- **Pipeline:** three-column floor view (queue / active / activity) with status dots and
  priority-colored left borders. Clean.
- **Ship:** radial dependency layout — central in-progress cluster, orbiting cards, section
  labels, zoom control. Distinctive and coherent (the protected experiment).
- **Swipe:** polished mobile card — priority dots, label pills, collapsible sections, real
  prev/next controls with correct disabled state.
- **KPIs:** stat-card grid + consistent-palette charts + good empty states.
- **Settings / Dispatch / Proxy:** organized card sections, **real toggle/form controls**
  (the affordance the landing tree lacks).
- **Overlays:** shared modal + toast primitives render consistently at both widths.

---

## Follow-up tasks minted

1. **(HIGH, objective)** Make the project-tree expandable row a keyboard-operable control so
   the landing sign-in (and all tree expand/collapse) is reachable without a mouse — the
   acute instance being the landing `/auth/linear` CTA. → **LIN-566**.

No other findings rose to objective breakage; the rest are advisory and left here for a
human. A bounded set of one task is the honest outcome — not padded to a cap.
