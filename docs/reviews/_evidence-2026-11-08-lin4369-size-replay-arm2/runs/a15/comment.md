## Scoping: size of the move

Size recorded in the description: **consolidate the decision this task touches**, decided by the standing size policy (err larger, 2026-11-07). No cuts to `## As asked`.

**The binding finding (checked at `10b2c82f`, HEAD = piece 1; no referenced file has moved since the ticket was posted):**

- `lib/cost-read.js` folds `readRowUsage(member.feedback)` (in `lineageRecords` and `missingCanChangeFigure`). LIN-4176's plan said the fold reads `usageOf(row)`, which serves both row shapes; piece 1 reads `feedback` only.
- The KPI path's production rows come from the `$project` in `lib/kpi-stats.js` `dispatchHistoryPipeline`: `usageEntry`, `terminalEntry`, `ticketMarkerEntries`, no `feedback`. Wired straight in, every S11/S12 lineage reads `no-usage`.
- The replay's `fakeCollection` (`tests/fixtures/cost-replay/harness.js`) has no `aggregate`, so `loadDispatchHistory` takes the find path with full `feedback`, and the replay would stay green while live `/kpis` and workspace KPIs price nothing.
- S13: real loop records (`lib/pipeline-loops.js` `_loopRecord`) carry `lineageId`/`historyStatus`, no `status` or `rootItemId`; `isMember` needs `status === 'taken'`. The replay's `sessionLoops` hand-builds `status`, so the same blind spot applies.

So the extra, done first: the read gives a lineage the same figure whatever shape its rows arrive in, and the replay runs S11/S12/S13 on production shapes, with the goldens confirmed at the starting commit before any surface moves.

**Not binding, left to the builder as engineering choices at the cause:** S12's zero is made in the data (`workspace-kpi-stats.js` `|| 0`) and also feeds the browser chart, and S13's `fmtUsd` returns null for `usd <= 0`, so the asked display fixes land where the zero is made; one identity query shared by the store and the raw-collection adapter, not a retyped copy; `weekly-budget.js` keeps nothing once `windowedSpend`'s reduce goes.

**Open:** moving a straddler to its founder's issue keys T, the component union, `anchoredIdentifiers` and the attributable share on the issue, so public shares may move beyond (b)'s credits; if W9 shows that, it needs naming on LIN-4176's change list. The seeded-store timing needs a `mongod` the session may not have. Piece 1's read missing the projected shape may be worth a line on LIN-4177.
