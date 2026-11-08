## Scope: size of the move recorded

**Size:** consolidate the decision this task touches, decided by the standing size policy (err larger, set 2026-11-07). No size ruling is on the trail, and LIN-4176 has no size record.

**Why it binds (checked at HEAD `10b2c82f`).** Both Surveys' shape findings hold in the code:

- `readCost` / `lineageRecords` (`lib/cost-read.js`) read usage only via `readRowUsage(member.feedback)`. Production KPI rows come from the `$project` in `lib/kpi-stats.js:449-460` and carry `usageEntry` with no `feedback`. Today's path copes because `usageOf` (`lib/dispatch-lineage.js:43`) reads both shapes. The replay's `fakeCollection` (`tests/fixtures/cost-replay/harness.js:209`) has no `aggregate`, so the goldens are built from the raw-feedback find path and would stay green while production prices nothing.
- Real loop records (`_loopRecord`, `lib/pipeline-loops.js:408`) have `historyStatus`, `lineageId` and `loopId`, but no `status`, `rootItemId` or `id`. `isMember` requires `status === 'taken'` (`lib/lineage-membership.js:38`), so feeding loops straight into the read would drop every loop. The replay's `sessionLoops` (`harness.js:244`) invents `status`.

So the extra, done first, is that the read and the replay accept the row shapes production really produces. It stops and reports if that needs the KPI aggregation to project more of `feedback`, which is the LIN-3002 timeout risk.

**Staleness.** No drift. `git diff 9e397e6b 10b2c82f` is empty for every file the ticket cites, and the four functions to delete are where the ticket says they are.

**Display findings the builder will meet (part of the ask, fix at the cause):**
- S13's `fmtUsd` (`lib/render-run-steps.js:270`) returns null for `usd <= 0`, so a complete $0 would still render blank until `formatUsd` replaces it.
- S12's zero comes from `|| 0` in `lib/workspace-kpi-stats.js:98`, and the browser chart sums `perDay` as numbers. A renderer-only fix leaves a zero bar.

**Open, not binding (possible tickets or LIN-4176 comments):**
- Change (b) names only credits. Moving a straddler's issue can also move the attributable share, the issue set and the per-issue component union on `/kpis`. If the replay shows that, the builder should widen the change list in a comment on LIN-4176, as this ticket's starting-point clause allows.
- The KPI path may need a second copy of `lineageIdentityRows`' query. Extracting it once is the builder's call.
- The founder-lookup timing needs a seeded Mongo store. The repo ships the driver only, with no in-memory server or seed script.
- The ticket points to LIN-4176's plan and the Approve verdict's builder notes, but they were not available to this look. The size rests on the code and the two Surveys.

**Cuts to the ask:** none.
