I wrote the LIN-4178 survey comment (483 words, read-only pass) to `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/s07/output/comment.md`. It is headed `## Survey global: LIN-4178 @ 10b2c82fb`. I read the provided clone at 10b2c82fb and did not fetch or add a worktree. I had no tracker access, so LIN-4176's plan and comments are unread. The clone is unchanged.

The direction is good: LIN-4134, 4136, 4147 and 4177 each removed one decision's duplicate code. S11, S12 and S13 are the last cost readers that bypass `lib/cost-read.js`. What I found:

- **The fixture replay can't see two shape traps.**
  - `readCost` reads usage only from `member.feedback`. Production KPI rows come from the Mongo `$project` (`kpi-stats.js:449-460`) and carry `usageEntry` instead, with no `feedback`. The replay's fake collection has no `aggregate`, so it runs the full-feedback path. Wired straight in, the replay stays green while production `/kpis` and the workspace KPIs price nothing.
  - Real run-page loops have no `rootItemId`, `id` or `status`, only `lineageId` and `historyStatus`. `cost-read`'s grouping would drop every loop. The replay's `sessionLoops` hand-builds `status`, so it passes anyway.
  - Each surface needs an explicit adapter and a test on the real data shape.
- **Duplicated query.** The KPI founder lookup will tend to retype the query in `lineageIdentityRows` (`dispatch-store.js:1935`). `kpi-stats-reads-pin` would not notice the new read.
- **Duplicated join.** Deleting `joinCostLineages` without a successor rewrites its records-to-outcomes join in two files.
- **More than credits will move.** Crediting the founder's issue also changes the published `/kpis` shares (`attributableLineageShare`, T, and the per-issue evidence and harness flags). Change (b) names only credits.
- **The $0 fixes sit one layer lower than the ticket names.**
  - S12's zero comes from `workspace-kpi-stats.js:98` (`|| 0`) and also feeds the chart in `public/workspace-kpis.js`, so a renderer-only fix leaves a zero bar.
  - On S13, `fmtUsd` in `render-run-steps.js:270` returns null for `usd <= 0`, so a complete $0 would render blank.
  - `run-view.test.js:367` pins today's S13 behaviour.
- **Docs.** `docs/architecture/source-map.md` names the deleted functions, and nothing checks that text.
- **S12 window edge.** S12's window starts later than the fetch horizon, so "has a member in window" is not the same as today's "starts in window". The corpus needs a lineage in that gap.

DONE: survey comment for LIN-4178 @ 10b2c82fb written to output/comment.md
