# View Tiers

The app surfaces a growing set of views. They are **not** all surfaced the same
way, and that is intentional. This document records the tier model so the
surfacing of any given view is a deliberate choice, not an accident of history.

There are three tiers, distinguished by *how a view is discovered and gated*.

## 1. First-class (always-on)

Stable, generally-useful views. Always present in the header view switcher for
every authenticated user; no flag, no gate.

- **dashboard** (`/`) — the project/issue tree (the root surface)
- **observation** (`/workspace/:urlKey/observation`) — the autopilot Observation
  page: a sessionId-grouped feed of autopilot work you watch live (LIN-595).
  Promoted from the experimental `dashboard` tier (see retirement note below).
- **swipe** — mobile-first task triage
- **swim** — dependency swim lanes
- **settings** — account-owned configuration, cross-device (LIN-1331)
- **kpis** (`/workspace/:urlKey/kpis`) — this workspace's own counts, last 7 and
  30 days (LIN-3689). Members only, counts only; the instance-wide public
  `/kpis` page is a separate surface and is not linked from here.

Wired as places in the side rail, `PLACES` in `lib/places.js` (LIN-4342; the old
header strip, `lib/components/view-nav.js`, went with the old bar in LIN-4568). The
rail gates by who you are: Runs (observation) and KPIs are the owner's with run
controls, so a member reaches them by URL.

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

## 2. Experimental (flag-gated; Settings + a gated rail place)

In-development or rough-draft views that are real and intentional, but not yet
ready to advertise broadly. Each is:

- a per-user (account-owned, LIN-1331) feature flag (default **off**) in `lib/feature-defaults.js`,
- a member of the shared ordered `EXPERIMENTAL_VIEWS` source of truth in
  `lib/feature-defaults.js` (`{ flag, path }`), consumed by **both** surfaces
  below so they cannot drift on membership or route,
- surfaced when its flag is on in **two** places: a discovery link in Settings
  (`lib/render-settings.js`, an "open the …" action phrase) **and** a place in
  the rail's Views group (`PLACES` in `lib/places.js`, a short label from
  `VIEW_LABELS`, each in its own slot) — LIN-1247 reversed the earlier
  Settings-only policy to gated nav inclusion; the rail replaced the old bar's
  `⋯ more` overflow (LIN-4342, LIN-4568),
- route-gated to redirect to `/settings` when the flag is off.

The rail's gate is strict `flag === true` and keys the place by the **kebab
route** (`taskChat` → `task-chat`), which is what the page passes to light it; the
camelCase flag is only the gate, never the key.

Members (the shared `EXPERIMENTAL_VIEWS` list, in order):

- **collective** (`collective`) — multi-workspace agent discussion via Yap (LIN-450)
- **taskChat** (`task-chat`) — grounded multi-turn conversation with a task
- **ship** (`ship`) — radial dependency view; in-progress work at the centre,
  everything else orbiting by priority and sector (surfaced under this tier by LIN-496)
- **flightCompanion** (`flight-companion`) — realtime chat with work in flight (LIN-922); the
  in-page chat and the copyable kickoff prompt render one shared brief (LIN-2618)
- **shipBiscuit** (`ship-biscuit`) — LLM-set newspaper of autopilot activity (LIN-818)
- **shipJourney** (`ship-journey`) — animated playback of waypoints charted
  against your north star over retained report history, with a coverage
  figure and north-star-change markers (LIN-1675)

`/ship` is **not** a retirement candidate. It is a key experiment in active
development — its (previous) lack of an inbound link reflected its in-dev status,
not abandonment. See the Step-2 friction note below.

## 3. Flagged power-user (a rail place when on)

Mature, opt-in views for power users. **roadmap** is a per-user feature flag
(default off) in `lib/feature-defaults.js`; when on, it is a place in the rail's
Views group, and its route is gated. **dispatch** and **proxy** (Connect an agent)
lost their switches in LIN-3849: they are the rail's Tools places for the owner
with run controls, and their pages answer by URL for anyone in the workspace.
The footer names no view: it is the same on every page (`renderFrameFooter` in
`lib/components/frame.js`; the old conditional footer links went long ago, and the
old footer itself with LIN-4568).

- **roadmap**, **dispatch**, **proxy**

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
