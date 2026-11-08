LIN-4178 is scoped. The size is **consolidate the decision this task touches**, decided by the standing policy (err larger). The ask has no cuts and there are no open questions.

**What the ticket delivers.** The public cost per finished task (S11), the workspace cost per day (S12) and the run page (S13) take their figures from the one cost read in production, not only in the replay. The four old copies are deleted, the two display fixes are in, and the note-1 choice is made.

**What done means.** The ticket's witnesses pass on a replay that feeds each page the row shapes production actually gives it, and the founder-lookup timing on a seeded store is reported.

**Why the larger size.** Wiring the read in the obvious way passes every gate while the live pages go wrong:
- **The read cannot price KPI rows.** It takes usage only from a row's full feedback list (`lib/cost-read.js`). Production KPI rows come from the aggregated projection (`lib/kpi-stats.js:449-460`), which has no feedback. So every lineage on `/kpis` and the workspace KPIs would read as "no usage". The approved plan said the read serves both row shapes; piece 1 did not deliver that. The fix belongs in the read, and it does not move piece 1's goldens.
- **The replay checks the wrong shapes.** Its fake store cannot aggregate, so the KPI pages get raw rows. Its run-page loops are hand-made with a status and anchor that real loop records lack. The goldens, W6 and W9 would pass over a public page that prices nothing.
- **Two copies would be added:** a second founder lookup, and a split join of outcome and membership.
- **Both $0 faults sit one layer below the named renderers.** S12's zero is made in the data and the chart also draws it. S13's formatter refuses any figure at or below $0.

**The extra piece, done first.** Make the replay feed production shapes, confirm the goldens still hold at the start commit, and add the note-2 assertion. It may stop if the goldens do not hold on those shapes, because then the recorded "before" has to be agreed again.

**Settled for the builder:**
- Apply the incomplete rule on S11 (note 1), with its public movement (d) added to the change list.
- Read (b) on S11 as covering the counts and shares a moved credit changes.
- S13 keeps folding the same loops it folds today.
- Two corpus cases to add: lineages in the gap between the fetch horizon and the start of S12's day axis, and follow-up rows that carry their predecessor link, which W2 needs if the lookup is restricted to follow-ups.

Files written:
- /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r03/output/description.md (the `## Size of the move` section)
- /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r03/output/comment.md (the code facts, with file and line references)
- /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r03/output/tracker-actions.md (status moved to In Progress)

The repo clone was only read and is unchanged.

DONE: LIN-4178 scoped as "consolidate the decision this task touches" (standing policy): fix the read to price production KPI rows, make the replay use production shapes first, apply note 1 on S11; no cuts, no open questions.
