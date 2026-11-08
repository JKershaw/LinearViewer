I scoped LIN-4178 as **a small tidy**: a contained fix lands first as its own piece, then the task exactly as asked. Nothing in the ask is cut and no ruling is needed. The size record is in `output/description.md`. The only tracker action is moving the ticket from Todo to In Progress (`output/tracker-actions.md`). As the prompt says, I posted no comment.

**Is the ticket still accurate?** Yes. HEAD is `10b2c82f`, which is piece 1 (LIN-4177), committed before this ticket was created. No file the ticket names has changed since then. The code (`lib/cost-read.js`, `cost-format.js` and the replay under `tests/fixtures/cost-replay/`) matches what the ticket describes.

**What binds on this ticket.** I checked both Surveys' claims in the code:

- **Live public and workspace costs would show nothing priced.** `lineageRecords` and `missingCanChangeFigure` in `lib/cost-read.js` read usage only from `member.feedback`, through `readRowUsage`.
  - The live KPI rows come from the database query's projection (`lib/kpi-stats.js:449-460`). They carry `usageEntry` and have no `feedback`.
  - Today `joinCostLineages` reads them correctly through `usageOf`. Moving them onto the cost read as it stands would lose that.
  - The approved plan said the fold would read `usageOf`, which handles both row shapes. Piece 1 did not do that.
- **The tests would stay green anyway.** The replay's fake collection has no `aggregate` (`harness.js:209`), so the goldens are built from rows that still carry `feedback`. They never see the live shape.
- **Every run-page figure would read "not reported".** Real loop records from `pipeline-loops` have `loopId`, `lineageId` and `historyStatus`, but no `status`, `rootItemId` or `id`. The membership rule (`isMember`, `anchorOf`) would drop every loop. The replay's `sessionLoops` (`harness.js:244`) hand-builds a `status` field that real loops don't have.

So the first piece is: the cost read and its replay accept the row shapes the live code produces, and the goldens are confirmed to hold at HEAD before anything is wired. Running the review note 2 assertion at HEAD fits in that piece. Without it, the asked change looks done in tests and fails on the live page. The standing policy says to take the larger move when it pays. Fixing this where it is caused, in the read itself, pays more than writing an adapter per caller, so it decided the size.

**Engineering choices inside the task, not part of the size:**

- **Workspace KPIs.** The all-unpriced-day `$0.00` starts in the data (`workspace-kpi-stats.js:98`, `|| 0`), not only the renderer. The browser chart also adds `perDay` up as numbers (`public/workspace-kpis.js:127-130`), so the chart needs to handle a missing day too.
- **Run page.** Its formatter `fmtUsd` (`render-run-steps.js:270`) returns null for `usd <= 0`, so a complete `$0.00` needs piece 1's `formatUsd` there. `run-view.test.js:367` pins today's behaviour.
- **Join and founder lookup.** The outcome join for the public and workspace KPIs (status and ticket markers) should stay in one place once `joinCostLineages` is deleted. The raw-collection founder lookup should reuse the query in `lineageIdentityRows` (`dispatch-store.js:1935`) rather than repeat it.

**For the builder, not scope:**

- **The public page moves more than credits.** Crediting a straddler to its founder's issue also moves the public `/kpis` issue set, the component union, `anchoredIdentifiers` and the attributable share, because `lib/terminal-marked-task-cost.js` keys all of them on `lineage.issueIdentifier`. Change (b) names only credits, so W9 would flag these. The ticket already says to change course and say so on LIN-4176.
- **Piece 1's usage read deserves a note on LIN-4176.** It departs from the approved plan.
- **Timing needs a local database server.** `mongod` is present on this machine, so the founder-lookup timing can likely be run. A sandbox without it would block "Done when".

Nothing in the repository was changed.

DONE: LIN-4178 sized as a small tidy (first make the cost read and its replay take the row shapes the live code produces, then the task as asked), no cuts, decided by the standing policy; status set to In Progress.
