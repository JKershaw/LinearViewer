I sized LIN-4178 as **a small tidy**, decided by the standing "err larger" policy. Nobody has posted a size ruling, and the parent ticket LIN-4176 has no size record. The record is in `output/description.md` and the status change (Todo to In Progress) is in `output/tracker-actions.md`. I posted no comment, as the prompt says. Nothing in the clone was changed.

**Re-ground.** The ticket's code pointers are unchanged. The only commit since the ticket was written is piece 1 itself (`10b2c82f`, LIN-4177). I read the code at that commit.

**The finding that sets the size: the one cost read can't read the rows these surfaces really get.**

- **Piece 1 strayed from the approved plan.** The plan says the read takes a row's usage in a way that works for both row shapes. But `lib/cost-read.js` reads usage only from `member.feedback`, at line 128 (`readRowUsage(member.feedback)`) and again in `missingCanChangeFigure`.
- **Live KPI rows have no `feedback`.** On Mongo, `/kpis` and the workspace KPI rows come from the aggregation at `lib/kpi-stats.js:449-460`, which gives `usageEntry` instead.
- **So moving S11/S12 onto the read as it stands would show nothing priced on the live pages.** Every live lineage would read "no usage".
- **The replay would still pass.** Its fake collection (`tests/fixtures/cost-replay/harness.js:209`) has no `aggregate`, so the replay reads rows that still carry full `feedback`. The goldens were recorded the same way.
- **S13 has the same gap.** Real loops (`lib/pipeline-loops.js` `_loopRecord`) have no `status` or `rootItemId`. `groupLineageMembership` would drop all of them, and every group would read "not reported". The replay's `sessionLoops` makes up the missing fields.

This finding binds: without it, the asked change doesn't work. So the extra is its own piece, done first:

- make the read accept the KPI aggregation's row shape and the run page's loop shape;
- make the replay feed those real shapes (an `aggregate`-backed fake, and loops built by `pipeline-loops`);
- confirm the goldens still hold at HEAD.

**This first piece can stop the work.** If the goldens differ on the real shapes, piece 1's recorded "before" is wrong and needs a ruling before any re-record. The policy chose a separate first piece over a fix folded into the task. It did not decide that the finding binds.

**Why not consolidate the area further.** The Surveys suggest more: extracting the founder-lookup query once, deleting `weekly-budget.js`, and updating the source map. Those are nearby and worth doing, but the task works without them, so they stay in the Surveys. The parent plan already allows two adapters into the one read.

**For the builder (inside the task, fixing at the cause):**

- **Successor to `joinCostLineages`.** S11/S12 still need the outcome status and the ticket walk. The plan puts these on the lineage records, but piece 1's records don't carry them. Delete the join with one successor, not a copy in each file.
- **S12's all-unpriced day.** The cause is at `lib/workspace-kpi-stats.js:98` (`|| 0`), not the renderer line the ticket names. That value also feeds the browser chart (`public/workspace-kpis.js:127-130`), so the chart must handle null.
- **S13's complete $0.** `lib/render-run-steps.js:270` returns null for any amount of 0 or less. `tests/unit/run-view.test.js:367` pins today's behaviour.
- **S12's population edge.** Today S12 counts a lineage when its earliest fetched member falls inside its day window, which starts at midnight 29 days back. Change that to "has a member in the window" and lineages in the sliver between the fetch horizon and that midnight would start counting. Keep today's selection.
- **Change list (b).** Crediting a straddler to its founder's issue can also move the ticket count, the component merge, the attributable share and the lane-landed tickets. Name those under (b), or the W9 replay check will flag them.
- **Lookup timing.** The repo has no in-memory Mongo or seed script, so timing the founder lookup may need a `mongod`.

**Cuts:** none. Everything in "As asked" is delivered. The ticket isn't aimed at a symptom.

DONE: sized LIN-4178 as "a small tidy" (standing policy, no cuts): first make the one cost read and its replay accept the row shapes the KPI pages and run page really pass, then the task.
