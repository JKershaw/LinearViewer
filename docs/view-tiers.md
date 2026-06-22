# View Tiers

The app surfaces a growing set of views. They are **not** all surfaced the same
way, and that is intentional. This document records the tier model so the
surfacing of any given view is a deliberate choice, not an accident of history.

There are three tiers, distinguished by *how a view is discovered and gated*.

## 1. First-class (always-on)

Stable, generally-useful views. Always present as footer links for every
authenticated user; no flag, no gate.

- **dashboard** (`/`) — the project/issue tree (the root surface)
- **observation** (`/workspace/:urlKey/observation`) — the autopilot Observation
  page: a sessionId-grouped feed of autopilot work you watch live (LIN-595).
  Promoted from the experimental `dashboard` tier (see retirement note below).
- **swipe** — mobile-first task triage
- **swim** — dependency swim lanes
- **settings** — per-user configuration

Wired in `lib/components/footer.js` (`getFooterLinks` base links).

### Retired: the experimental `dashboard` flag/view (LIN-509 → LIN-595)

The experimental, realtime *autopilot dashboard* (per-user `dashboard` flag,
Settings-only discovery, `/workspace/:urlKey/dashboard`) was **promoted** to the
first-class Observation page above and the flag was **retired**. `/dashboard` now
302-redirects to `/observation`; the `dashboard` key is gone from
`lib/feature-defaults.js` and `EXPERIMENTAL_FEATURES`. Its data layer
(`/api/dashboard/*` — loops, run-/session-summary, session-context, hydrate) was
kept under its original paths and reused by the new page (no flag gate), with one
additive seam: `GET /api/dashboard/sessions` (the sessionId-grouped poll source).
The old view shell/client (`render-dashboard.js`, `public/dashboard.{js,css}`)
was deleted so there are not two equivalent views side by side (LIN-590).

## 2. Experimental (Settings-only, flag-gated)

In-development or rough-draft views that are real and intentional, but not yet
ready to advertise broadly. Each is:

- a per-user feature flag (default **off**) in `lib/feature-defaults.js`,
- listed in `EXPERIMENTAL_FEATURES` in `lib/render-settings.js`, where it gets a
  toggle and — when on — a single discovery link **in Settings only** (no footer
  link, no navbar entry),
- route-gated to redirect to `/settings` when the flag is off.

Members:

- **collective** — multi-workspace agent discussion via Yap (LIN-450)
- **taskChat** — grounded multi-turn conversation with a task
- **ship** — radial dependency view; in-progress work at the centre, everything
  else orbiting by priority and sector (surfaced under this tier by LIN-496)

`/ship` is **not** a retirement candidate. It is a key experiment in active
development — its (previous) lack of an inbound link reflected its in-dev status,
not abandonment. See the Step-2 friction note below.

## 3. Flagged power-user (footer link when on)

Mature, opt-in views for power users. A per-user feature flag (default off) in
`lib/feature-defaults.js`; when on, a **conditional footer link**
(`getFooterLinks` in `lib/components/footer.js`) and route gating. Unlike the
experimental tier, these advertise themselves in the footer once enabled.

- **roadmap**, **dispatch**, **proxy**, **pipeline**

## Step 2 friction note (recorded for LIN-491 follow-up)

Ship is a useful signal beyond being a view: it is a genuinely **new view
*concept*** — a radial dependency layout — that does **not** fit cleanly on the
current section/card/token model. Concretely:

- it is an absolutely-positioned **canvas** with no sections/cards,
- it borrows swim's popover/pill primitives (`.swim-popover-*`,
  `status-pill__char`) rather than a shared canvas frame,
- its ink color (`#2c3e50` in `public/ship.css`) has **no matching `:root`
  token** — token-wiring it (LIN-500) needs a *new* token, not a swap.

The Step-2 shared-layout / content-frame work should make adding such non-card
canvas views easy, rather than forcing them to borrow primitives ad hoc. That
missing ink token and the absence of a canvas-view frame are the concrete
friction points.

The radial layout itself (`lib/ship-layout.js`, `public/ship.js`
positioning/orientation, `public/ship.css`) is the protected experiment — it is
deliberately **not** refactored as part of tier ratification or token wiring.
