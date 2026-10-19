# Public /kpis page: design (LIN-3703)

Base: `origin/main` at `dca50589` (includes LIN-3689, `493c62bb`). Line numbers below are at that base.

John, 19 Oct: "The global public one tells the public facing story." The in-app page (LIN-3689, `/workspace/:urlKey/kpis`) tells the operator story and does not change.

## The story

A stranger should understand in thirty seconds that Harbour hands tickets to AI agents, how much of that work lands, and how new people get from signing up to a merged pull request.

Three sections, in that order: **Does the work land?**, **What the agents do**, **How people get started**.

## What the page shows today

Source of every "today" row: `lib/render-kpis.js` (538 lines), `public/kpis.js` (470), `public/kpis.css`, `server.js:2266-2353`.

### Frame, cards and charts

| Figure | Verdict | Reason / source / floor treatment |
|---|---|---|
| Title "instance kpis", "collected N ago" | changed | New title and the story line; "collected N ago" kept. Source `generatedAt`. |
| `noindex`, unlinked | kept | No change to linking; see "Out of scope". |
| Whole stats object as `__KPI_DATA__` | changed | Only the `toPublicKpis` view is embedded. |
| Headline outcome rate (+ done/failed/aborted slices, resolved of total) | kept | `dispatchOutcomes`. Counts of dispatch lineages, not people: not floored. Evidence link to the weekly chart kept. |
| Cost per terminal-marked task card | **dropped** | The cash headline is always "—" (`resolveCashHeadline`, :125-129), and the card carries sixteen disclosures a stranger cannot use. Not published, builder kept. |
| Weekly budget burn gauge + chart | **dropped** | An estimate of the operator's own subscription window; an operator figure, not a public one. |
| Stat card: workspaces (+ basis) | kept | `totals.workspaces`. The nearest public "how many people" figure (no `dispatchedBy`, :412-414). **Floored** (leaf, no group). Basis string kept as an app-defined label. |
| Stat card: users | **dropped** | Counts the same people as the signed-up step; dropping it removes a group relation. |
| Stat card: active sessions | **dropped** | A live count of people right now; small and jumpy. |
| Stat cards: agent actions, autopilot runs, prompts dispatched (30d) | kept | `totals.agentActions`, `autopilotRuns`, `dispatches`. Event counts across all workspaces: not floored (see registry). |
| Stat cards: feedback notes, ai summaries, roadmap reports, custom prompts, agent tokens | **dropped** | Housekeeping counts; tokens are per-person credentials. |
| Chart: proxy calls by phase (30d/24h) | changed | Kept 30d as "what agents do" (`proxyCategories`); 24h view dropped (activity pattern, no story). |
| Chart: work landed weekly | kept | `dispatchOutcomes.weeks/weeklyRate/weeklyResolved`. Not floored. |
| Chart: dispatched work by kind (daily stacked) | dropped | The kind bar says the same thing with a fifth of the payload. |
| Chart: dispatch kinds | kept | `dispatchKinds` (label + count). Not floored. "+N more" caption dropped with `dispatchKindsOtherCount`. |
| Chart: work funnel (dispatched, taken, reported, completed) | dropped | Lower bounds that need a caveat; the headline already answers "does it land". `funnel.*IsLowerBound` go with it. |
| Chart: milestone funnel | kept, changed | Now section 3, five steps (mergeClicked drawn, it was published but never drawn). **Floored**, group `steps`. |
| Chart: step outcomes, proxy responses, top proxy endpoints | dropped | Machinery: endpoint templates, response classes. |
| Chart: work by hour (UTC), free tier prompts | dropped | Activity pattern / operator funnel; no part of the story. |
| Footer line: busiest day, reads per write, median wait, db backend | dropped | Machinery and vanity. |

### Undrawn fields in `collectKpiStats`

| Field | Verdict | Reason |
|---|---|---|
| `totals.localIssues`, `localProjects` | dropped | Instance counts nobody reads. |
| `milestoneFunnel.mode` | **kept, newly drawn** | How the first runs start (copy, run-step, run-task): a text list in section 3. **Floored**, group `mode`. |
| `milestoneFunnel.steps.mergeClicked` | kept, newly drawn | Last funnel step. Usually `no-signal` text row. |
| `milestoneFunnel.*.coverage` strings | kept for steps | App-defined labels; they are the text of a `no-signal` row. `mode.coverage` dropped. |
| `funnel.*IsLowerBound`, `workspacesBasis`, `roadmapReportsBasis` | dropped / kept | `workspacesBasis` kept (it qualifies the workspaces card); the others go with their cards. |

`collectKpiStats` keeps all its reads and builders; "dropped" means not published. No new collection read (the page once ran past the 30s router limit, :239-247).

## Public payload and floor registry

`toPublicKpis(stats)` in `lib/kpi-stats.js` is pure and builds the picked view. The cache stores that view; the renderer and the script never see raw stats.

`PUBLIC_COUNT_FLOOR = 5`, exported from `lib/kpi-stats.js`. Default from the operator; **John to confirm** (LIN-3625 asked).

Every numeric leaf of the public payload:

| Path | Class | Why |
|---|---|---|
| `outcomes.{total,resolved,done,failed,aborted}`, `outcomes.weeklyResolved[]`, `outcomes.rate`, `outcomes.weeklyRate[]`, `outcomes.windowDays` | not floored | Dispatch lineages over 30 days across every workspace; not tied to a person, and the rate and window are not counts. |
| `totals.{agentActions,dispatches,autopilotRuns}` | not floored | Many events per workspace; an event count does not describe a person. |
| `phases.{orienting,deciding,acting,watching,reporting}[]` | not floored | Per-day proxy-call tallies, many per run. |
| `dispatchKinds[].count` | not floored | Dispatch rows per app-defined kind. |
| `totals.workspaces` | **floored** (leaf) | Counts workspaces, the nearest thing to people. No usable relation to another published figure, so no group. |
| `milestoneFunnel.steps.{login,connected,firstGo,prOpened,mergeClicked}.count` | **floored**, group `steps` | People who signed up in the window and reached each step. |
| `milestoneFunnel.mode.total` | **floored**, group `mode` | Task-mode entries (an account, workspace, issue triple) in the window. |
| `milestoneFunnel.mode.byRung[].entries` | **floored**, group `mode` | Same, per rung. |
| `milestoneFunnel.mode.byRung[].notReady` | **floored**, group `mode` | The part of a rung's entries recorded not ready. |

A test walks the real payload from a sparse seed and fails on any numeric leaf not in this registry.

### The rule ("suppress the dependents")

- **Leaf.** A floored leaf is published exactly if it is 0 or at least the floor; otherwise as `{ hidden: 'below-floor' }`. A floored leaf's own state is untouched: `no-signal` with `count: null` stays a "could not read" row, never 0 and never hidden.
- **Group.** Floored leaves tied by a usable relation: `steps` (steps are separate reads, not guaranteed ordered, so every pair is container and part; derivable values are every member and every difference between two members), `mode` (`total` sums `byRung[].entries`; each rung's `notReady` is a part of its `entries`; derivable values are every member, every `total` minus a subset of rung entries, and each `entries - notReady`). If any derivable value is 1 to floor-1, every nonzero member is published as `{ hidden: 'withheld' }` (text "not shown"), even a large one. A member that is exactly 0 stays 0: it shows no person and, with every nonzero member hidden, derives nothing.
- **Not grouped.** `steps` and `mode` count different populations (a sign-up cohort versus all entries in the window), and `workspaces` counts a third; no relation lets one derive another. The old `users` figure, which would have tied to `login`, is dropped.
- Applied once, in `toPublicKpis`. `collectKpiStats` and `collectMilestoneFunnel` are untouched, so `kpi-stats.test.js:571-574` (raw counts of 1) and `milestone-funnel.test.js` need no edit.
- A hidden leaf renders server-side as a text row with a `data-` hook (`data-hidden="below-floor|withheld"`), "fewer than N" from the constant. The chart script draws only steps whose `count` is a number, so it skips hidden rows by type, not by string.

### A visible count moving by one

A viewer can watch a visible count (at least the floor) move by one, at most once a minute (the 60s cache). **Accepted.** The floor protects groups too small to be anonymous. At 5 or more, a count moving by one says someone joined, not who, and nobody can make a group of fewer than 5 appear: the step from 4 to 5 shows "5", which is the intended crossover.

## Layout

One column. `max-width: 900px` content, `var(--space-*)` gutters, no horizontal overflow at 390px (the cards wrap in a two-column grid, charts get a fixed-height box). All colours come from the theme tokens the script already reads (`--green`, `--blue`, `--fg-dim`, ...), so dark parity needs no second palette. Section headings are `h3` inside `section[data-testid="kpis-section-<name>"]`. Hidden rows use the existing `kpi-chart-empty` look. Test ids: `kpis-headline`, `kpis-section-{outcome,activity,people}`, `kpis-card-<name>`, `kpis-chart-<name>`, `kpis-hidden`, `kpis-generated`, `kpis-privacy`; selectors in `SELECTORS.publicKpis`.

## Route and cache

The cache, single-flight refresh and `/kpis` handler move out of `server.js` as a whole into `lib/kpi-page.js` (`createKpiPage({ collect, render, ... })`, with `reset(mode)` for `/test/clear-kpi-cache`). Four behaviours hold: cold waits; warm serves at once and refreshes in the background, one at a time; a failed refresh keeps the last good snapshot; 500 only with no snapshot. Log strings unchanged: "KPI stats collected in Nms", "KPI background refresh failed", "Failed to render KPIs page".

The old catch re-called the renderer that had just thrown, so a renderer failure threw again inside the catch and left the request hanging. **Fixed**: a render failure goes directly to the KPI 500 page. The cache stores the public view; the render runs per request on it.

## Pin conversions (commit 2)

Unchanged and passing: `kpi-stats-reads-pin.test.js`, `workspace-kpi-stats.test.js`, `lin3014-capture-kpis.test.js`, `kpi-stats-pins.test.js`, `kpi-stats.test.js` (incl. canary :576-588), `milestone-funnel.test.js`, `scan-public-pages.test.js`.

`tests/unit/render-kpis.test.js` is rewritten as a whole; the guard-bearing pins survive in new form (each gets a scratch mutation, recorded in the PR):

| Old pin | Conversion |
|---|---|
| headline value, slices, coverage; evidence link; em dash with no anchor on null rate | kept in new markup (`kpis-headline`). Mutation: drop the anchor / print `0%` for null. |
| `<` escaped in embedded payload | kept. Mutation: remove the escape. |
| subtitle age discloses real `generatedAt` | kept. Mutation: hard-code "collected just now". |
| noindex meta; page is unlinked | kept. Mutation: drop the meta. |
| zero-as-bar (reached step with count 0 is a bar, not a row) | kept as: 0 stays 0 and is not a hidden row. Mutation: treat 0 as below floor. |
| no-signal step is a text row naming step and coverage; rows sit outside the canvas wrapper | kept. Mutation: render nothing for no-signal. |
| stat cards ride on `.card`; chart boxes ride on `.section` | kept. |
| formatted values | kept for the three event cards. |
| stat-card basis span (LIN-2325) | kept for the workspaces card. |
| proxy-phase 30d/24h range toggle; proxy responses and top endpoints toggles; range-aware "+N more"; `renderChartBox` caption guards; "titles the newly-windowed charts"; work-funnel lower-bound caption | **dropped**: the 24h views, endpoint chart and work funnel are not on the page. |
| vanity strip; queue-to-take latency formatting; omit empty vanity | **dropped**: the footer line is gone. |
| cost-per-terminal-marked-task card (all 40 tests, :453-912) and weekly-budget gauge (:913-999) | **dropped** with the cards (builders and their own tests stay). |

New unit tests: `tests/unit/kpi-public-floor.test.js` (floor, registry walk, recovery grid, structural walk), `tests/unit/kpi-page.test.js` (the four cache behaviours and the throwing renderer, red on the old catch), the page-source and offline scan witness in `render-kpis.test.js`, and a privacy-line test in `render-legal.test.js`. Scratch mutations for each are recorded in the PR (change the constant, drop the pass, drop the group rule).

`tests/e2e/kpis.spec.js`: the `KPIs page` describe is rewritten (render without auth, headline link, charts or empty notes, no mobile overflow, footer and unlinked, no raw below-floor value); the LIN-3002 describe stays. Range-toggle specs are dropped with the toggles; cost-card and gauge specs are dropped with the cards.

## Commit order

1. This file only.
2. Pin conversions: tests rewritten and added (red against the old code, by design).
3. Build: `toPublicKpis` + constant, `lib/kpi-page.js`, new `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css`, privacy line, docs, screenshots.

Then, in scratch: replay (old `collectKpiStats` against `toPublicKpis`), verbatim share, shape and seams.

## Out of scope

The in-app page and any admin dashboard; rebuilding `kpi-stats.js` internals; new reads, metrics, or per-workspace or per-person numbers; the live site scan; an operator surface for the dropped cost card and budget gauge (default: none in this PR); linking the page from anywhere (default: no; `noindex` stays).
