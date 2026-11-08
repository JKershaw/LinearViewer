## Size: consolidate the decision this task touches (standing policy)

Re-ground: HEAD is `10b2c82f` (piece 1, LIN-4177), and nothing has landed since. No file this ticket names has changed since it was filed. The parent has no size record, and nobody has posted a size ruling on the trail.

**What binds (I checked each against the code, not against the Surveys' wording)**

1. **The read only accepts the raw row shape.** `lineageRecords` folds `readRowUsage(member.feedback)` (`lib/cost-read.js:129`). `missingCanChangeFigure` (`:71`) and the duration merge (`:193`) also read `feedback`.
   - On Mongo, `/kpis` and the workspace KPIs get rows from the `$project` at `lib/kpi-stats.js:449-460`. Those rows have `usageEntry` and no `feedback`.
   - If S11/S12 are wired straight in, every production lineage reads `no-usage`.
   - The approved plan said the fold reads `readUsageEntry(usageOf(row))`, "which serves both row shapes". `usageOf` (`lib/dispatch-lineage.js:42`) already does that, so piece 1 departed from the plan here.
   - Without this fix the asked change does not work.
2. **Real run-page loops are not members.** `isMember` needs `status === 'taken'`, and `anchorOf` needs `rootItemId`/`_id`/`id` (`lib/lineage-membership.js`).
   - The loop record (`lib/pipeline-loops.js` `_loopRecord`) has only `loopId`, `lineageId` and `historyStatus`, which is null on a live row.
   - Every S13 group would read "not reported".
   - Today `lineageCost` folds every loop in the group, live ones included. The mapping has to keep that population.
3. **The replay can't see either problem.**
   - The harness's `fakeCollection` has no `aggregate`, so S11/S12 take the `find` path with full `feedback`.
   - `sessionLoops` hand-builds the `status` that real loops don't have (`tests/fixtures/cost-replay/harness.js:209,244`).
   - So W2/W6/W9 would pass while production is broken.

**The extra, done first (it may stop):** one place in the read decides how each caller's row shape reaches it: the raw row, the KPI projection and the loop record. Each shape gets a test, and the replay runs S11/S12 through a fake `aggregate` that applies the real projection and runs S13 on loops built by `pipeline-loops`. Then the goldens are confirmed at HEAD on those shapes, along with the note-2 assertion. **If the goldens do not hold at HEAD on production shapes, stop:** the baseline the change list is diffed against is wrong, and that goes back to LIN-4176. This piece moves no figure.

**The cause of an asked fix, so part of the task (not extra):**
- S12's all-unpriced `$0.00` starts in the data (`lib/workspace-kpi-stats.js:98`, `|| 0`). The browser chart reads the same data (`public/workspace-kpis.js:127-130`). Fixing only the renderer would still leave a `$0.00` bar on the chart.
- S13's complete `$0` would render blank, because `fmtUsd` returns null for `usd <= 0` (`lib/render-run-steps.js:270`). `tests/unit/run-view.test.js:367` pins today's behaviour.

**Nearby, not binding (left to the builder's judgement or the Surveys):**
- Writing the identity query and merge once, instead of a second copy beside `lineageIdentityRows`.
- One join for status and ticket walk, instead of two.
- Moving the day bucket and deleting `weekly-budget.js`.
- Updating `source-map.md`, which is piece 3's work.
- Having the KPI aggregation emit the shape the read wants (a later rebuild).

**For the builder (not a cut):**
- Moving a straddler's issue also changes everything in S11 that is keyed on the issue: the component union, T, the anchored identifiers and the per-ticket flags. Name those movements under (b) on the change list, or W9 will flag them. If any of them moves a published share on the public block (beyond the credit), that is a public movement the plan calls a bug, and it needs a word on LIN-4176 before it ships.
- The note-1 decision is the builder's to make, as the ask says.
- `mongod` is on this host for the timing run. A sandbox without it would block "Done when".
