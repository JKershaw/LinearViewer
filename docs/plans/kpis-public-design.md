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
| Cost per terminal-marked task card | **changed** (LIN-3714) | Was dropped in LIN-3703. Now one figure, "Cost per finished task" (API-equivalent, last 30 days), with its caveats in a closed "Show the numbers" fold. The cash figure and the other dollar and count lines stay out. See "Cost per finished task (LIN-3714)". |
| Weekly budget burn gauge + chart | **dropped** | An estimate of the operator's own subscription window; an operator figure, not a public one. |
| Stat card: workspaces (+ basis) | kept | `totals.workspaces`. The nearest public "how many people" figure (no `dispatchedBy`, :412-414). **Floored** (leaf, no group). Basis string kept as an app-defined label. |
| Stat card: users | **dropped** | Counts the same people as the signed-up step; dropping it removes a group relation. |
| Stat card: active sessions | **dropped** | A live count of people right now; small and jumpy. |
| Stat cards: agent actions, autopilot runs, prompts dispatched (30d) | kept | `totals.agentActions`, `autopilotRuns`, `dispatches`. Event counts across all workspaces: not floored (see registry). |
| Stat cards: feedback notes, ai summaries, roadmap reports, custom prompts, agent tokens | **dropped** | Housekeeping counts; tokens are per-person credentials. |
| Chart: proxy calls by phase (30d/24h) | changed | Kept 30d as "what agents do" (`proxyCategories`); 24h view dropped (activity pattern, no story). |
| Chart: work landed weekly | kept | `dispatchOutcomes.weeks/weeklyRate/weeklyResolved`. Not floored. LIN-3710: drawn as a line (null weeks are gaps). |
| Charts: work resolved weekly (`outcome-weekly`), tasks finished daily (`done-daily`) | added (LIN-3710) | Stacked done / failed / aborted by start week; bars of `daily.done` per day. Rates by default. LIN-3732: `done-daily` alone also has a rate/total toggle and a "Tasks finished since <date>" line, from the new top-level `doneTotal` (below); the other charts stay rates only. |
| Sparklines on the agent actions, prompts dispatched and autopilot runs cards | added (LIN-3710) | 30 daily points from `daily.*` and the sum of `phases`. None on workspaces or the headline. |
| Chart: proxy calls (`proxy-phases`) | changed (LIN-3710) | Same stacked bars, now with a 7-day average line (23 points: none for the first six days or for today). |
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

`collectKpiStats` keeps all its reads and builders; "dropped" means not published. One new collection read, LIN-3732: `kpi-daily-rollup` (the instance sum of finished tasks by UTC day, by `$group`, else `find` summed in JS), appended last in `readSources`; a failed read gives `doneTotal: null` and every other figure renders. Before that, no new read (the page once ran past the 30s router limit, :239-247).

`doneTotal` (LIN-3732) is a new top-level key `{ since, through, done[], total }`, not a `daily` member, because every `daily` array must match `phases.days` in length. `since` is the oldest rolled-up day, never "launch"; `through` is yesterday (UTC); missing days are zero. It is approximate: part A looks back `ROLLUP_LOOKBACK_DAYS` days, so a task whose last run was dispatched earlier than that before it finished can be missed, and the page says so.

## Public payload and floor registry

`toPublicKpis(stats)` in `lib/kpi-stats.js` is pure and builds the picked view. The cache stores that view; the renderer and the script never see raw stats.

`PUBLIC_COUNT_FLOOR = 5`, exported from `lib/kpi-stats.js`. Default from the operator; **John to confirm** (LIN-3625 asked).

Every numeric leaf of the public payload:

| Path | Class | Why |
|---|---|---|
| `outcomes.weeklyFailed[]`, `outcomes.weeklyAborted[]`, `daily.{dispatches,autopilotRuns,done}[]` | not floored | LIN-3710. Run or lineage counts across every workspace; not tied to a person. A nonzero `phases` day already shows a run happened that day. A week's done is `weeklyResolved - weeklyFailed - weeklyAborted`; there is no `weeklyDone` leaf. `daily` has no `days` of its own: it uses `phases.days`. |
| `doneTotal.done[]`, `doneTotal.total` | not floored | LIN-3732. A count of finished tasks across every workspace, not tied to a person; the earliest days may be one workspace's figure. No `urlKey` is published. |
| `outcomes.{total,resolved,done,failed,aborted}`, `outcomes.weeklyResolved[]`, `outcomes.rate`, `outcomes.weeklyRate[]`, `outcomes.windowDays` | not floored | Dispatch lineages over 30 days across every workspace; not tied to a person, and the rate and window are not counts. |
| `totals.{agentActions,dispatches,autopilotRuns}` | not floored | Many events per workspace; an event count does not describe a person. |
| `phases.{orienting,deciding,acting,watching,reporting}[]` | not floored | Per-day proxy-call tallies, many per run. |
| `dispatchKinds[].count` | not floored | Dispatch rows per app-defined kind. |
| `cost.{windowDays,perTaskUsd,tasks}`, `cost.shares.{attributableLineageShare,captureRateShare,pricedLineageShare,closeOutLineageShare,evidenceLinkedShare,opencodeSummedShare,unknownHarnessShare}` | not floored | LIN-3714. An average or ratio over dispatch lineages or tasks across every workspace; not a count of people. Small-sample rule instead of a leaf floor: `tasks` below `PUBLIC_COUNT_FLOOR` publishes `cost: null`. |
| `totals.workspaces` | **floored** (leaf) | Counts workspaces, the nearest thing to people. No usable relation to another published figure, so no group. |
| `milestoneFunnel.steps.{login,connected,firstGo,prOpened,mergeClicked}.count` | **floored**, group `steps` | People who signed up in the window and reached each step. |
| `milestoneFunnel.mode.total` | **floored**, group `mode` | Task-mode entries (an account, workspace, issue triple) in the window. |
| `milestoneFunnel.mode.byRung[].entries` | **floored**, group `mode` | Same, per rung. |
| `milestoneFunnel.mode.byRung[].notReady` | **floored**, group `mode` | The part of a rung's entries recorded not ready. |

A test walks the real payload from a sparse seed and fails on any numeric leaf not in this registry.

### The rule ("suppress the dependents")

- **Leaf.** A floored leaf is published exactly if it is 0 or at least the floor; otherwise as `{ hidden: 'below-floor' }`. A floored leaf's own state is untouched: `no-signal` with `count: null` stays a "could not read" row, never 0 and never hidden.
- **Group.** Floored leaves tied by a usable relation: `steps` (steps are separate reads, not guaranteed ordered, so every pair is container and part; derivable values are every member and every difference between two members), `mode` (`total` sums `byRung[].entries`; each rung's `notReady` is a part of its `entries`; derivable values are every member, every `total` minus a subset of rung entries, and each `entries - notReady`). If any derivable value is 1 to floor-1, every nonzero member is hidden, even a large one: a member that is itself 1 to floor-1 keeps `{ hidden: 'below-floor' }`, every other is `{ hidden: 'withheld' }` (text "not shown"). A member that is exactly 0 stays 0: it shows no person and, with every nonzero member hidden, derives nothing.
- **Not grouped.** `steps` and `mode` count different populations (a sign-up cohort versus all entries in the window), and `workspaces` counts a third; no relation lets one derive another. The old `users` figure, which would have tied to `login`, is dropped.
- Applied once, in `toPublicKpis`. `collectKpiStats` and `collectMilestoneFunnel` are untouched, so `kpi-stats.test.js:571-574` (raw counts of 1) and `milestone-funnel.test.js` need no edit.
- A hidden leaf renders server-side as a text row with a `data-` hook (`data-hidden="below-floor|withheld"`), "fewer than N" from the constant. The chart script draws only steps whose `count` is a number, so it skips hidden rows by type, not by string.

### A visible count moving by one

A viewer can watch a visible count (at least the floor) move by one, at most once a minute (the 60s cache). **Accepted.** The floor protects groups too small to be anonymous. At 5 or more, a count moving by one says someone joined, not who, and nobody can make a group of fewer than 5 appear: the step from 4 to 5 shows "5", which is the intended crossover.

## Layout

One column. `max-width: 900px` content, `var(--space-*)` gutters, no horizontal overflow at 390px (the cards wrap in a two-column grid, charts get a fixed-height box). All colours come from the theme tokens the script already reads (`--green`, `--blue`, `--fg-dim`, ...), so dark parity needs no second palette. Section headings are `h3` inside `section[data-testid="kpis-section-<name>"]`. Hidden rows use the existing `kpi-chart-empty` look. Test ids: `kpis-headline`, `kpis-section-{outcome,activity,people}`, `kpis-card-<name>`, `kpis-chart-<name>`, `kpis-hidden`, `kpis-generated`, `kpis-privacy`; LIN-3714 adds `kpis-cost`, `kpis-cost-value` and `kpis-cost-numbers`; LIN-3710 adds `kpis-spark-<card>`, `kpis-numbers-<chart>` (the closed "Show the numbers" `details`) and `kpis-numbers-table-<chart>`; selectors in `SELECTORS.publicKpis`.

## Route and cache

The cache, single-flight refresh and `/kpis` handler move out of `server.js` as a whole into `lib/kpi-page.js` (`createKpiPage({ collect, render, ... })`, with `reset(mode)` for `/test/clear-kpi-cache`). Four behaviours hold: cold waits; warm serves at once and refreshes in the background, one at a time; a failed refresh keeps the last good snapshot; 500 only with no snapshot. Log strings unchanged: "KPI stats collected in Nms", "KPI background refresh failed", "Failed to render KPIs page".

The old catch re-called the renderer that had just thrown, so a renderer failure threw again inside the catch and threw outside any handler. **Fixed**: a render failure goes directly to the KPI 500 page. The cache stores the public view; the render runs per request on it.

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
| cost-per-terminal-marked-task card (all 40 tests, :453-912) and weekly-budget gauge (:913-999) | **dropped** with the cards (builders and their own tests stay). The cost card came back in LIN-3714 as a single figure with a fold; the old label pins (`terminal-marked`, `cash:`) are now asserted absent. |

New unit tests: `tests/unit/kpi-public-floor.test.js` (floor, registry walk, recovery grid, structural walk), `tests/unit/kpi-page.test.js` (the four cache behaviours and the throwing renderer, red on the old catch), the page-source and offline scan witness in `render-kpis.test.js`, and a privacy-line test in `render-legal.test.js`. Scratch mutations for each are recorded in the PR (change the constant, drop the pass, drop the group rule).

`tests/e2e/kpis.spec.js`: the `KPIs page` describe is rewritten (render without auth, headline link, charts or empty notes, no mobile overflow, footer and unlinked, no raw below-floor value); the LIN-3002 describe stays. Range-toggle specs are dropped with the toggles; cost-card and gauge specs are dropped with the cards.

## Cost per finished task (LIN-3714)

On 20 Oct the operator recommended: label the figure "Cost per finished task" (API-equivalent, last 30 days); move the coverage and bias shares into a "Show the numbers" fold under it, still published but not beside it; keep the cash figure out. John, 20 Oct: "I agree with your recommendation." He agreed to the operator's recommendation; those words are the operator's, not his.

This supersedes the 2026-08-03 ruling on two points only: the label ("cost per terminal-marked task") and the placement (shares "beside the number"). The rest stands, including that "verified" and its synonyms never appear in the builder's name, exports or field names, and that the builder's maths is unchanged.

- **Figure.** `toPublicKpis` adds `cost: { windowDays, perTaskUsd, tasks, shares }`, picked by name from `stats.terminalMarkedTaskCost` (never spread). `perTaskUsd` is `pricedTicketCostUsd / pricedTicketCount` to 2dp, `null` (shown "—", never $0) when nothing is priced. `tasks` is `pricedTicketCount`.
- **Small sample.** When `tasks` is below `PUBLIC_COUNT_FLOOR`, the view publishes `cost: null` and the page shows "—" with no fold, so an average never stands for one or two tasks.
- **Fold.** A closed `<details>` "Show the numbers" holds the tasks averaged and seven shares, each labelled with its base: coverage, of all runs (`attributableLineageShare`, `captureRateShare`, `pricedLineageShare`, the last "of runs that reported usage"), and bias, of finished tasks (`closeOutLineageShare`, `evidenceLinkedShare`, `opencodeSummedShare` "known runner only", `unknownHarnessShare`). Shares are formatted "—" for null, "<1%" for a nonzero share that rounds to 0. They appear nowhere outside the fold.
- **Not published.** Cash, `unknownLaneUsd`, `inFlightUsd`, `overheadUsd`, marker occupancy, `ticketsPerPricedLane`, `issueCount`, `unpriced`, `laneLandedCount`: a reader can use none, and the dollar lines would publish total spend. If shown later, the old wording rules apply (`inFlightUsd` is "unresolved", `overheadUsd` is "resolved overhead", `pricedLineageShare` is never "capture coverage").
- **Privacy line.** The line and `/privacy` still say "totals and counts only"; a dollar average and percentages go slightly past that. Left as is; noted as an open question in the PR.

## Commit order

1. This file only.
2. Pin conversions: tests rewritten and added (red against the old code, by design).
3. Build: `toPublicKpis` + constant, `lib/kpi-page.js`, new `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css`, privacy line, docs, screenshots.

Then, in scratch: replay (old `collectKpiStats` against `toPublicKpis`), verbatim share, shape and seams.

## Out of scope

The in-app page and any admin dashboard; rebuilding `kpi-stats.js` internals; new reads, metrics, or per-workspace or per-person numbers; the live site scan; an operator surface for the cash figure and budget gauge (default: none in this PR); linking the page from anywhere (default: no; `noindex` stays).

## Divergences from the approved plan

The plan approved in review dropped `mode`, put the route in `routes/public-kpis.js`, defined the group rule as "every nonzero member becomes withheld", split the build into three commits and linked the floor note to `/privacy`. The build differs in the five ways below; each is recorded here and in the PR rather than left implicit.

1. **`milestoneFunnel.mode` is published and drawn** (the approved design listed it under "Dropped"). It is floored as group `mode`, and the page-source test, the registry walk and the recovery grid cover it. It adds a published surface the plan review did not approve, and the rung names (copy, run-step, run-task) are not labelled for a stranger. Privacy is not affected: every `mode` leaf goes through the same floor and group rule. Kept because the entry rungs say how first runs start, which belongs to "How people get started"; the labelling is a copy question for John.
2. **The route module is `lib/kpi-page.js` (`createKpiPage`), not `routes/public-kpis.js` (`createPublicKpisRoutes`).** The module is pure and imports nothing: it holds the cache, the single-flight refresh and the handler, and `server.js` does the `app.get` mount. It is not a router, so the `^routes/` area pattern does not fit it. `scripts/code-shape/areas.json` gained `kpi-page` under "Platform & plumbing" for that reason. Because it imports nothing it adds no area-pair edge.
3. **The group rule differs from decision 4.** A member that is itself 1 to floor-1 stays `{ hidden: 'below-floor' }` instead of becoming `withheld`; every other nonzero member is `withheld`. Checked: this reveals nothing the leaf rule does not already publish (a member in 1 to floor-1 is already known to be small, and it is hidden). The design text above was changed to match in the build commit, after the fact. This is an open question for John beside the floor ruling (`lin3703-floor-rule`); the default is to keep it.
4. **Commits 3a, 3b and 3c were collapsed into one build commit** (`f40ac3fd`), so the red witness for the catch fix is not in history. It was reproduced in review: restoring the re-render in the catch makes `a renderer that throws is not called again` (`tests/unit/kpi-page.test.js`) fail.
5. **The floor note links `/privacy`.** The plan called for this and the build omitted it (only the footer linked it). Fixed in close-out: the `kpis-privacy` paragraph now carries `<a href="/privacy">`, pinned in `render-kpis.test.js`.

## Consumer sweep (class: code and docs that describe the old public page or its payload)

Query, at `dca50589` (104 hits): `grep -rn "/kpis\b" lib routes public scripts server.js docs/architecture CLAUDE.md .env.example playwright.config.js | grep -v 'workspace/:urlKey/kpis\|${prefix}/kpis'`, together with `render-kpis|renderKpisPage|public/kpis|kpis.js|kpis.css|__KPI_DATA__`.

| Member | Verdict | Reason |
|---|---|---|
| `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css`, the `server.js` KPI block | rebuilt | the change itself |
| `tests/unit/render-kpis.test.js`, `tests/e2e/kpis.spec.js` | rewritten | pins of the old page (see "Pin conversions") |
| `lib/terminal-marked-task-cost.js` :43, :50, :278, :573, :577, :600, :613, :621 | comment-only edit (close-out) | claimed `__KPI_DATA__` is public wire, that `render-kpis.js` divides the headline, and that the occupancy probe is visible on `/kpis`; none holds once the cost card is gone. The builder and the `noLineageCount` alias stay; the alias's remaining consumers are in `tests/unit/terminal-marked-task-cost.test.js` |
| `.env.example:126-128` | comment-only edit | said `PLAN_FEE_MONTHLY_USD` feeds the `/kpis` card |
| `tests/unit/terminal-marked-task-cost.test.js:921` | comment-only edit (close-out) | cited the dropped `render-kpis.test.js:475` pin |
| `routes/proxy-reads.js:28` | comment-only edit (close-out) | top endpoints are dropped, so `public/kpis.js` no longer reads endpoint strings back |
| `server.js:2253` | comment-only edit (close-out) | "above" was wrong and the route moved |
| `docs/architecture/source-map.md`, `configuration.md:36-37`, `playwright.config.js:44-45` | edited | new files, changed roles, dropped cards |
| `lib/render-templates.js:6-7`, `public/swim.js:13` | no edit | the new renderer keeps the shell (`is-landing`, `noindex`); the script keeps CSS-var colours |
| "never fed to /kpis" privacy notes (`saved-chat-store.js:23`, `prompt-trace-store.js:11,18,199`, `routes/workspace-api-prompts.js:28`, `routes/task-chat.js:301`, `routes/dashboard.js:2394`, `server.js:596,615`) | no edit | still true |
| collector and read-history notes (`kpi-stats.js`, `proxy-events.js:65,573`, `read-horizon.js:9`, `scripts/lin3014/*`, `routes/milestone-funnel.js:7`, `digest-feedback.js:7`) | no edit | the collector and raw aggregate are unchanged; the floor applies downstream |
| `lib/milestone-funnel.js:164` | no edit | a MangoDB feedback-projection caveat ("dev /kpis only"); belongs with the collector notes |
| route and test plumbing (`guest-task-path.js:80`, `scan-public-pages.js:4,23`, `scripts/scan-public-pages.mjs:7`, `routes/test.js:53,54,921,975`, `routes/test.js:937` (the `/test/kpis-fail-next-aggregate` seam), `render-workspace-kpis.js`, `render-escalation-kpis.js:10`, `components/view-nav.js:74`, `server.js:1069`, the `scan:public-pages` bullet and the `/kpis` paragraph in `CLAUDE.md`, `llms.txt:25,236`) | no edit | still true |
| `scripts/survey-tests-friction-tickets.mjs`, `scripts/eval/fixtures/**` | out of scope | dated records or generated data |
| `experiments/`, `docs/papers/`, `docs/reviews/`, `docs/runbooks/harbour-degraded.md`, `docs/incidents/`, `docs/steady-base.md`, `docs/view-tiers.md` | out of scope | dated records (the last is still true) |

Env vars of the dropped builders: `PLAN_FEE_MONTHLY_USD`, `WEEKLY_BUDGET_USD_PER_POINT`, `WEEKLY_BUDGET_CHECKPOINT_PERCENT`, `WEEKLY_BUDGET_CHECKPOINT_AT`. Edited where the text names `/kpis` (`configuration.md:36-37`, `playwright.config.js:44-45`, `.env.example:126-128`); the libs and their tests stay.
