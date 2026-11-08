**Scoped. Size: consolidate the decision this task touches (the standing policy).** The size record is in the description. Below are the code facts behind it, at `10b2c82f` (piece 1 merged). Nothing has changed in these paths since the ticket was created.

**The read cannot price KPI rows (the cause, inside piece 1's read)**

- `lib/cost-read.js` reads usage only from `member.feedback`: `readRowUsage(member.feedback)` in both `lineageRecords` and `missingCanChangeFigure`.
- KPI rows come from the `$project` at `lib/kpi-stats.js:449-460`. They carry `usageEntry`, `terminalEntry` and `ticketMarkerEntries`, and no `feedback`.
- So once S11/S12 are wired, every production lineage would fold as `no-usage`.
- The plan said the fold reads `readUsageEntry(usageOf(row))`, "which serves both row shapes". For feedback rows that is exactly equivalent to `readRowUsage(row.feedback)` (`lib/session-telemetry.js:494`). So the fix is at the cause and does not move the S1/S5/S10 goldens.
- Per the starting-point rule, this divergence from the plan is to be noted on LIN-4176.
- Do not give rows a fake `feedback: [usageEntry]`. `terminalFeedbackOf` and `ticketMarkerEntriesOf` (`lib/dispatch-lineage.js:32-70`) branch on `Array.isArray(doc.feedback)`, so terminal markers and ticket walks would vanish.

**The replay measures the wrong shapes**

- `fakeCollection` (`tests/fixtures/cost-replay/harness.js`) has no `aggregate`, so `loadDispatchHistory` (`lib/kpi-stats.js:488`) takes the `find` path. S11 is called directly on raw corpus rows.
- `sessionLoops` builds `status`, and its loops carry `lineageId` in place of `rootItemId`/`id`.
- Real loop records (`lib/pipeline-loops.js` `_loopRecord`) have only `historyStatus` (null on live rows) and `lineageId`. `isMember` would drop every one of them.
- Today's S13 fold (`lib/run-view.js:252`) folds every loop in the group, whatever its status. Keep that member set.

**Two copies to avoid**

- **Founder lookup.** The query, projection and merge live in `DispatchQueueStore.lineageIdentityRows` (`lib/dispatch-store.js:1935`). Share them with the raw-collection path, batched per `urlKey`. The `{urlKey, rootItemId}` index is at `lib/db-indexes.js:240`.
- **The join.** `joinCostLineages` today supplies `status` and `ticketMarkers`, and both S11 and S12 need them. Keep one join when it is deleted.

**$0 fixes**

- **S12.** The zero is made at `lib/workspace-kpi-stats.js:98` (`|| 0`). The chart adds up and draws `perDay` (`public/workspace-kpis.js:120-135`). `lib/render-workspace-kpis.js:46` has a local `formatUsd` that hides piece 1's.
- **S13.** `fmtUsd` (`lib/render-run-steps.js:270`) returns null when `usd <= 0`. `tests/unit/run-view.test.js` pins today's "not reported" for $0.

**Corpus**

- No row in `corpus.js` carries `followUpTo`. If the follow-up-only lookup restriction (N3) is taken, W2 cannot prove it until the follow-up rows carry it.

**Other notes**

- **Spend module.** `lib/weekly-budget.js` holds only `windowedSpend`. Once its reduce is gone, the day bucket can move next to its one reader and the module can go.
- **Source map.** `docs/architecture/source-map.md:139,146-148` names the deleted functions.
- **Timing.** `mongod` is at `/opt/homebrew/bin/mongod` on this host, so the seeded-store timing can be run.

**Note-1 decision:** apply the rule. The reason is in the description.
