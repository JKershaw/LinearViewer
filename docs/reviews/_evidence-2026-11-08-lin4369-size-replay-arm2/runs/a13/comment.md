## Scope: LIN-4178 @ 10b2c82f

**Size: consolidate the decision this task touches. Decided by the standing policy (err larger, 7 Nov). No cuts to the ask.**

**Re-ground.** The only commit since this ticket was filed is piece 1 (`10b2c82f`, LIN-4177). None of the files this piece names has changed apart from piece 1's new `lib/cost-read.js`, `lib/cost-format.js` and `tests/fixtures/cost-replay/`. The line references in the ask still hold.

**Why it is bigger than just the task (this finding binds).** I checked both Surveys' shape findings against HEAD, and both hold:

- `lineageRecords` (`lib/cost-read.js:129`) and `missingCanChangeFigure` (`:71`) read usage only through `readRowUsage(member.feedback)`. The `/kpis` and workspace rows come from the `$project` at `lib/kpi-stats.js:449-460`, which carries `usageEntry` and no `feedback`. Today's S11/S12 path reads both shapes through `usageOf` (`lib/dispatch-lineage.js:41`). The approved plan says the read folds `readUsageEntry(usageOf(row))`, "which serves both row shapes". Piece 1 landed it reading one shape only.
- The replay cannot see this. `fakeCollection` (`tests/fixtures/cost-replay/harness.js:209`) has no `aggregate`, so `loadDispatchHistory` falls through to `find` and returns raw rows that carry full `feedback`.
- S13: `lineageCost` (`lib/run-view.js:252`) folds every loop in a group as it is. The read's membership (`isMember` and `anchorOf`, `lib/lineage-membership.js`) needs `status === 'taken'` and a `rootItemId` or id. Real loop records (`_loopRecord`, `lib/pipeline-loops.js:409`) carry `loopId`, `lineageId` and `historyStatus`, which is null for queue rows. The replay's `sessionLoops` (`harness.js:244`) makes up `status`.

So wiring S11, S12 and S13 to the read as it stands would price nothing in production, while W6 and W9 stay green. The extra piece, done first, is for the read to price the row shapes production actually sends, with the replay fed those shapes. It may stop if today's figures on those shapes do not match the recorded goldens, because then the goldens are not a true before. The ask lets the builder change course on the plan, so this should go on LIN-4176 as a comment: the read now serves both shapes, as the plan intended.

**Fixed at the cause, within the task (not an extra size):**

- S12's `$0.00` comes from the data (`lib/workspace-kpi-stats.js:98`, `|| 0`), and the browser chart reads that data too (`public/workspace-kpis.js:127-130`). Fixing only the renderer would leave a zero bar.
- S13's complete `$0` is blanked twice: by `lineageCost`'s `usd > 0` and by `fmtUsd` (`lib/render-run-steps.js:270`). `run-view.test.js` pins today's behaviour.

**Open questions (none binds; the builder names each on LIN-4176 or files it):**

- Change (b) moves more than credits on `/kpis`. The issue key also drives T, the component union, the anchored identifiers and the attributable share, so the change list should name whatever the replay shows moving.
- The run page needs a rule for what a running queue loop counts as.
- The workspace day axis starts at floored day-29 midnight, which is later than the 30-day fetch horizon. A lineage whose fetched start falls in that gap is dropped today. Read "in-window" in the ask as the fetch window and keep today's behaviour, and add the case to the corpus so W9 sees it.
- The founder-lookup timing needs a seeded store. If the build session has no database, that line of "Done when" is at risk.
- The extra may push the work past "fits one session".
- Possible tickets, not this one: retire `lib/weekly-budget.js` once it holds only a day bucket; have the KPI aggregation emit the read's shape directly; update the source-map prose (piece 3).
