I've sized LIN-4178 as "consolidate the decision this task touches", decided by the standing policy (err larger). No person has commented on size, and the parent has no size record. There are no cuts to the ask, so nothing needs a ruling.

**Why it is bigger than just the task.** The code confirms the first Survey's main finding:
- The one cost read (`lib/cost-read.js`, added by piece 1) takes a row's usage only from its full `feedback` (`readRowUsage(member.feedback)`, in `lineageRecords` and `missingCanChangeFigure`). The approved plan said it would use `usageOf`, which reads both row shapes; piece 1 shipped the feedback-only version.
- On production, the KPI rows come from the aggregation projection (`kpi-stats.js:449-460`). They carry `usageEntry` and no `feedback`.
- The replay never feeds that shape, because its fake collection has no `aggregate`.
- So moving the public `/kpis` card and workspace KPIs onto the read as it stands would price nothing live, and the replay would still pass.
- The old reduce (`reduceLineageCost`) does read both shapes. Deleting it as asked without fixing the read would be a live regression.

**The extra, done first.** The read prices rows in the shapes production actually sends, and the replay feeds those shapes. It stops and says why if the recorded goldens don't hold on them.

**The run page.** Real loop records have no `status` or `rootItemId`, so the read would drop every loop. Mapping them is needed for the ask itself, so I counted it as part of the task, not the extra.

**Open questions in the record:**
- Moving a straddler to its founder's issue may also shift public shares and merge ticket components, beyond the credit change (b) names.
- The workspace KPIs' day window starts later than the fetch horizon. Counting "a member in the window" could add lineages the page leaves out today.
- The lookup timing needs a seeded store, which the build session may not have.

**Staleness check.** Only piece 1's commit `10b2c82f` landed after the ticket was created. I re-read the referenced code at HEAD instead of relying on the ticket. The code clone is unchanged.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a14/output/`:
- `description.md`: the size record
- `tracker-actions.md`: status Todo to In Progress

There is no `comment.md`; no comment was needed.

DONE: LIN-4178 sized as "consolidate the decision this task touches" by the standing policy; first the cost read must handle the KPI projection's row shape and the replay must feed production shapes; no cuts.
