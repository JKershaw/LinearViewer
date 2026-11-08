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
