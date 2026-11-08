# LIN-4178: Costs rebuild 1.2: /kpis, workspace KPIs and the run page on the cost read

State: Todo
Labels: none
Parent: LIN-4176 (In Progress), "Costs rebuild 1: one cost read that every surface asks"; its description is in `parent-LIN-4176.md` beside this file. It has no size record.

## Description

## As asked

Piece 2 of 3 of **LIN-4176** (Costs rebuild 1: one cost read that every surface asks). Read the scope, research and the full approved plan in **LIN-4176's description** (`## Implementation Plan`, revised 3 Nov). Read its comment trail too, especially the Approve verdict's builder notes 1 and 2 (comment `6645f289-b9a5-4dd7-a5d2-8c7ec9170fd8`). Lands after piece 1, which provides `lib/cost-read.js`, the fixture corpus and the goldens.

**Starting point.** LIN-4176's approved plan is this piece's starting point. Follow it. Where the code shows it wrong, change course and say so in a comment on LIN-4176.

## This piece's slice of the plan

**KPI path onto the read: S11 public** `/kpis` **cost per finished task, and S12 workspace KPIs cost per day.**

* Add the **raw-collection adapter** for the founder lookup, batched **per** `urlKey` \[N4\], because `{urlKey, rootItemId}` is the index and an `{$in}` without `urlKey` scans. The rows come from the Mongo projection in `lib/kpi-stats.js:449-460` / `loadDispatchHistory` `:488`. The workspace call is at `lib/workspace-kpi-stats.js:147`.
* **The founder lookup stays on the KPI path \[N3\]** for the issue, not the start. Time it on a seeded store, since the aggregation here has timed out before (LIN-3002). If it is too slow, restrict it to anchors whose earliest fetched member has a `followUpTo` (already projected, `kpi-stats.js:454`), proven by W2. Never fall back to the fetched window for the issue.
* **S11 keeps exactly today's population:** done, not skipped, with a member in the window. The component rule, the public count floor and 2dp stay in `lib/terminal-marked-task-cost.js` / `kpi-stats` as population logic, and call the read's fold. The privacy rule stays: no identifier crosses `kpi-stats.js`.
* **S12 keeps today's day bucket:** the day of the lineage's earliest *in-window* member. This is a named display rule, not fixed here.
* **Incomplete rule on S11 (review note 1):** decide whether it applies and name the choice either way. The reviewer recommends applying it, because today a done opencode straddler is folded from its in-window deltas only and counted as `fullyPriced`, an undercount shown as complete. If you apply it, add the public movement to the change list as "(d) also reaches S11: a done opencode straddler's component is no longer priced", and allow exactly that difference in W6. Piece 1's corpus has the fixture case. If you exempt S11 instead, record the silent partial under "Left, and why" on LIN-4176.

**Run and session page: S13** (`lib/run-view.js`, session loops from `routes/dashboard.js:691`). Grouping by `rootItemId ?? loopId` (`lib/pipeline-loops.js:360`) stays a display decision. Only the per-group figure and the total come from the read. Fix the display: a complete `$0` shows `$0.00`, not "not reported"; an unpriced or unreadable lineage still withholds; the total shows only when complete.

**Delete in this change:** `joinCostLineages` (`lib/dispatch-lineage.js:187`), `reduceLineageCost` (`lib/terminal-marked-task-cost.js:68`), `windowedSpend`'s reduce (`lib/weekly-budget.js:26`), and `run-view`'s `lineageCost` (`lib/run-view.js:252`). Fix S12's all-unpriced-day `$0.00` (`lib/render-workspace-kpis.js:150`). Use piece 1's `formatUsd` wherever these renderers format a figure they touch.

## Change list this piece may show in the replay

* (b) On S11/S12, the same lineage set, but a straddler's ticket is credited to its founder's issue. The replay lists every lineage whose issue moves on the public path.
* (d) S12 no longer shows `$0.00` for an all-unpriced day; S13 shows a complete `$0.00`; S11 incomplete per your note-1 decision.
* Nothing else.

## Testing

* **W2**, KPI part: S11/S12 select the same lineage set as the golden; the straddler's ticket is credited to LIN-42; S12 puts it in the golden's day bucket.
* **W5**, S13/S12 part (tries the softened guard): an unpriced lineage and an unreadable lineage still show "not reported"; a complete 0 shows `$0.00`; an all-unpriced S12 day is not `$0.00`; `formatUsd(null/undefined)` never returns a dollar figure.
* **W6** `/kpis` unchanged: the replay of `computeTerminalMarkedTaskCost` and the public block equals the golden except (b) credits and, if taken, the note-1 movement. **Assert what is true today (review note 2):** the cost card's lineage set equals the outcome rate's lineages that have at least one `taken` member, and no lineage is in the cost set but not the outcome set. The outcome grouping also keeps never-ran lineages (`lib/dispatch-lineage.js:137-160`). Run this assertion at HEAD first. `kpi-stats-pins` and the privacy assertion stay green.
* **W4**, this piece's part: S1 = S13's group figures; S12's period sum = S11's per-lineage costs over the same lineages; S5's 30-day total = S12's 30-day sum over the lineages both count \[N5\]. The replay lists any lineage one counts and the other does not, with its reason.
* **W9**, for S11/S12/S13: every replay difference is on the change list.
* The founder-lookup timing on the seeded store is reported in the PR.

**Done when:** S11, S12 and S13 read from `cost-read`; the four copies above are deleted; the S12 and S13 display fixes are in; the note-1 decision is made and named; W2 (KPI part), W4 (part), W5 (part), W6 and W9 (part) are green; the lookup timing is in the PR.

Session fit: fits one session

Plan-review due: no — covered by LIN-4176's approving plan-review (comment 6645f289-b9a5-4dd7-a5d2-8c7ec9170fd8, rev 2)

Grounding commits: Harbour `main` `9e397e6b` (tidy 5 at `46b43b3b`); runner `5379817`. Re-grounded at breakdown on 3 Nov; nothing has moved since.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Comments (oldest first)

### 2026-11-03T23:02:00.066Z (posted with the ticket)

LIN-4177 (piece 1) is merged and deployed: PR #2261, `10b2c82f`. Goldens for S1–S13 are recorded at `9e397e6b` in `tests/fixtures/cost-replay/`, including S2–S4, S7 and S11–S13 and the done, anchored opencode straddler (`so`), so this piece can diff against a true before. `lib/cost-read.js` is the single lineage-cost read; do not add a second representation. Two open post-deploy checks (live mixed-harness tally, founder-lookup latency) are recorded on LIN-4177.

### (Survey, survey-task, posted before work began)

## Survey open-0: LIN-4178 @ 10b2c82fb

Piece 1 (LIN-4177) has landed: `cost-read.js`, `cost-format.js`, the corpus and the goldens are all here. I had only the code, not LIN-4176.

**Why it's hard: the replay feeds row shapes that production never produces.**

- **S11/S12.** The harness's `fakeCollection` (`harness.js:209`) has no `aggregate`, so `loadDispatchHistory` falls through to `find`. The goldens are therefore built from raw rows that carry full `feedback`.
  - Production rows come from the aggregated projection (`kpi-stats.js:449-460`). They have `usageEntry`, `terminalEntry` and `ticketMarkerEntries`, and no `feedback`.
  - `lineageRecords` folds `readRowUsage(member.feedback)`, so every production lineage reads `no-usage`. The replay passes while the live page shows nothing priced.
  - Setting `feedback: [usageEntry]` makes it worse. `terminalFeedbackOf`, `usageOf`, `evidenceCountOf` and `ticketMarkerEntriesOf` (`dispatch-lineage.js:32-70`) all branch on `Array.isArray(doc.feedback)`. Terminal markers would vanish, so no lineage would be `done`.
  - The adapter should build separate rows just for `fetchedRows`.
- **S13.** `sessionLoops` (`harness.js:244`) makes up `status` and `lineageId`. Real loop records (`pipeline-loops.js:409`) have no `status`, `rootItemId` or `id`. They have only `loopId`, `historyStatus` (null on live rows) and `lineageId`.
  - `groupLineageMembership` needs `status === 'taken'` and an anchor. Real loops would give no members, so every step would read "not reported".
  - The mapping has to decide what status a running live loop gets.

**First move:** make the replay use production shapes before wiring anything.

1. Give the fake an `aggregate` that applies the real projection, and run S11/S12 through it.
2. Feed S13 from real `pipeline-loops` output.
3. Confirm the goldens hold at HEAD, and add the note-2 assertion in the same step.

**Other friction:**

- **The founder lookup on `/kpis`.** `lineageIdentityRows` is a store method, but `/kpis` reads raw collections across all workspaces. The adapter must group anchors by `urlKey` and query both history and queue. The index `{urlKey, rootItemId}` exists (`db-indexes.js:240`). The `followUpTo` restriction holds, because `rootItemId` is inherited only through `followUpTo` (`dispatch-store.js:34`).
- **Timing.** The repo has the `mongodb` driver only: no in-memory server and no seed script. A sandboxed session may have no `mongod`, which could block "Done when".
- **The issue move does more than move credits.** S11's `issues` map (T), the component union, `anchoredIdentifiers` and the attributable share all key on `lineage.issueIdentifier`. Moving a straddler from LIN-99 to LIN-42 can:
  - merge components, dropping a priced one if LIN-42 has an unpriced lineage;
  - remove LIN-99 from T;
  - turn LIN-99 into a lane-landed UNKNOWN ticket.

  Note 1 also moves `pricedLineageShare`. The change list should name these, or W9 will flag them.
- **Window and day.** A record has no `start`. S11's window and S12's day must come from `record.members[0]`, the earliest fetched member. Using the true members (the founder) pushes the straddler out of the window, which changes the population.
- **The S12 null day reaches the browser.** `public/workspace-kpis.js:127-130` adds up and charts `perDay` as numbers. `render-workspace-kpis.js:46` also has its own local `formatUsd`, which hides piece 1's.

Not a symptom ticket; the risk is tests that miss production.

### (Survey, survey-place, posted before work began)

## Survey global: LIN-4178 @ 10b2c82fb

From the code alone. I had no tracker access, so LIN-4176's plan is unread.

**Where it lands.** These are the last three cost islands that bypass `cost-read.js`: `terminal-marked-task-cost.js` (S11), `weekly-budget.js` (S12, a file named for a gauge LIN-4129 removed) and `run-view.js` `lineageCost` (S13). The trend is good. LIN-4134, 4136, 4147 and 4177 each removed one decision's copies.

**What the obvious way would do**

1. **Two shape traps the replay can't see.** `readCost` reads usage only from `member.feedback`. On Mongo, KPI rows come from the `$project` at `kpi-stats.js:449-460`, which emits `usageEntry` and no `feedback`. The replay's `fakeCollection` has no `aggregate`, so it takes the find path. Wire `readCost` straight in and the replay stays green while production S11/S12 price nothing.

   Real loops (`pipeline-loops.js` `_loopRecord`) carry no `rootItemId`, `id` or `status`, only `lineageId` and `historyStatus` (null when live). `anchorOf` and `isMember` would drop every loop. The replay's `sessionLoops` hand-builds `status`.

   Both need explicit adapters, each with a test on the real shape. Exposing a live loop's status touches `pipeline-loops-pins`.
2. **A second founder query.** `kpi-stats` reads raw collections, so the adapter tends to retype `lineageIdentityRows`' query, projection and merge (`dispatch-store.js:1935`). Extract them once. `kpi-stats-reads-pin` won't notice the new read, because its collections return `[]` and no anchors means no query.
3. **The join forks.** S11 and S12 still need `status` and `ticketMarkers` from `groupDispatchLineages`. If `joinCostLineages` goes with no successor, that join is rewritten in two files. Keep one.
4. **The shares move too.** The founder's issue also shifts `attributableLineageShare`, T, and the per-issue evidence and harness flags. All of these are published in the `/kpis` fold. Change (b) names only credits.
5. **The $0 fixes sit one layer down.** S12's zero is `workspace-kpi-stats.js:98` (`|| 0`). It also feeds the chart (`public/workspace-kpis.js:127-130`), so a renderer-only fix leaves a zero bar. S13's `fmtUsd` (`render-run-steps.js:270`) returns null for `usd <= 0`, so a complete $0 would render blank. `run-view.test.js:367` pins today's behaviour.
6. **Inventories.** `source-map.md:139,141,146-148` names the deleted functions, and nothing checks that prose. `weekly-budget.js` would keep only a day-bucket.

**Better, at this task's cost**

- Both adapters, each with a real-shape test (an `aggregate`-backed collection; loops built by pipeline-loops).
- One identity query and one join.
- The $0 fixes in the data, with the chart taught about null.
- The day bucket moved into `workspace-kpi-stats.js`, and `weekly-budget.js` deleted.
- `formatUsd` in `render-kpis.js:132`, `render-workspace-kpis.js:46` and `render-run-steps.js:270`.
- The source map updated.

One edge case: S12's window starts at the floored day-29 midnight, which is later than the fetch horizon. In that sliver, "has a member in window" differs from today's "starts in window". Put such a lineage in the corpus, or S12's population can move without W9 noticing.

**Better still, not this task's.** Retire the other dollar formatters (`render-effort-readout`, `decision-panel`, `render-settings`, the browser copies; piece 3). Have the KPI aggregation emit the shape `cost-read` reads, so no adapter is needed.
