## Scope: LIN-4178 @ 10b2c82f

**Size: a small tidy, decided by the standing policy (err larger). Cuts: none.** Nobody on the trail has ruled on size, and LIN-4176 has no size record.

**Re-ground.** I ran `git log` from the ticket's creation over every path it names. The only commit is piece 1 (`10b2c82f`, LIN-4177), which the ticket was written to follow. Piece 1 did not touch the S11–S13 files, and every line reference in the ticket still matches HEAD (`kpi-stats.js:449-460`, `:488`, `workspace-kpi-stats.js:147`, `dispatch-lineage.js:187`, `terminal-marked-task-cost.js:68`, `weekly-budget.js:26`, `run-view.js:252`, `render-workspace-kpis.js:150`, `pipeline-loops.js:360`, `routes/dashboard.js:691`).

**Two findings that bind.** Without each fix, the asked move would not work in production. I confirmed both in the code. Both Surveys had reported them.

1. **The read prices only rows that carry raw `feedback`.** `lineageRecords` folds `readRowUsage(member.feedback)`, and `missingCanChangeFigure` reads `member.feedback` too (`cost-read.js:71,129`). Production KPI rows come from the `$project` at `kpi-stats.js:449-460`, which carries `usageEntry` and no `feedback`. So every S11/S12 lineage would read as no usage. The approved plan said the fold reads `readUsageEntry(usageOf(row))`, and `usageOf` already serves both row shapes (`dispatch-lineage.js:41`). Piece 1 departed from the plan here. The fix belongs in the read, not in a KPI adapter that fakes `feedback`: the outcome helpers branch on `Array.isArray(doc.feedback)`, so faking it would drop the terminal markers.
2. **Real loop records lack the fields the read groups on.** The read needs `status === 'taken'` and an anchor (`lineage-membership.js:33`). `_loopRecord` (`pipeline-loops.js:409`) has neither: it carries only `loopId`, `lineageId` and `historyStatus`, which is null on live rows. So every S13 group would read "not reported". The loops need a mapping into the read, and that mapping must decide which status a live, running loop gets.

The replay hides both problems. Its `fakeCollection` has no `aggregate`, so S11/S12 take the find path with raw `feedback` (`harness.js:209`). Its `sessionLoops` makes up `status` (`harness.js:244`). W6 and W9 would pass while production priced nothing.

**The tidy, done first, which may stop:** make the read accept the KPI projection's rows and real loop records. Give the replay an `aggregate` that applies the real projection, and feed S13 from `pipeline-loops` output. Then confirm the goldens still hold at HEAD, and run the note-2 assertion there. If the goldens move on production shapes, stop and report before wiring S11–S13.

**The engineering in the task itself, each with its reason:**
- **S12's `$0.00` comes from the data, not the renderer.** `workspace-kpi-stats.js:98` has `|| 0`, and the chart sums and draws `perDay` (`public/workspace-kpis.js:127-130`). The fix goes at that cause, and the chart learns about null. A fix in the renderer alone would leave a zero bar.
- **S13's renderer hides a complete $0.** `fmtUsd` (`render-run-steps.js:270`) returns null for `usd <= 0`, and `run-view.test.js:367` pins that behaviour. Both change when `formatUsd` replaces it.
- **One join of outcome facts.** S11 and S12 both still need `status` and `ticketMarkers` after `joinCostLineages` goes, so the join should live in one place, not be rewritten in each file.
- **S12's window edge.** `activityStart` (the floored day-29 midnight) is later than the fetch horizon. "Earliest in-window member" must mean what today's fetched `start` means, or S12's population moves without W9 noticing. Add a corpus case for a lineage with members on both sides of `activityStart`.

**To say on LIN-4176 (the ticket's starting-point rule), not a cut:** moving a straddler's issue changes more than its credit. S11's ticket set T, the component union, `anchoredIdentifiers`, the attributable share and the per-issue harness and evidence flags all key on the lineage's issue (`terminal-marked-task-cost.js:161-260`). The replay has to list those movements under (b), or W9 will flag them.

**Left in the Surveys (they don't bind):**
- one founder-lookup query shared by the store and the raw-collection adapter;
- deleting or renaming `weekly-budget.js`;
- the `source-map.md` prose (that is piece 3);
- the other dollar formatters;
- having the aggregation emit the shape the read takes.

The policy tips the size from "just the task" to a tidy named as its own piece. It does not make any of these bind.

**Timing.** `mongod` is installed in this environment, so timing the founder lookup on a seeded store is possible here.
