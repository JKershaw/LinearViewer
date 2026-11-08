I've scoped LIN-4178. The recommended size is **consolidate the decision this task touches**, set by the standing policy (err larger). Nothing is cut from the ask.

**Why it is bigger than the task as written.** The cost read that piece 1 added only reads usage from rows that carry full feedback. Production sends these three surfaces other shapes, and on them the read prices nothing:
- **`/kpis` and workspace KPIs** get rows from the Mongo projection at `lib/kpi-stats.js:449-460`. Those rows carry `usageEntry` but no `feedback`.
- **The run page** gets loop records from `lib/pipeline-loops.js:409`. These have no `status` and no `rootItemId`, so the read finds no lineages in them.

The replay cannot see either problem, because its fake collection has no `aggregate` and its session loops are hand-built. Wired as the ask describes, the tests would pass while all three surfaces showed nothing priced in production. The approved plan on LIN-4176 meant the read to handle both row shapes; piece 1 shipped it handling one.

**The extra piece, done first:** the read prices the row shapes production actually sends, and the replay is fed those shapes. It may stop if today's figures on those shapes don't match the recorded goldens, since then the goldens aren't a true "before".

**Inside the task, fixed where they start:** S12's `$0.00` comes from the data and also feeds the browser chart. S13's complete `$0` is hidden in two places, the cost fold and the `$` formatter.

**Open questions:**
- Crediting a lineage to its founder's issue on `/kpis` moves more than credits. The issue shares and ticket components can shift too, so the change list will need to name them.
- The run page needs a rule for whether a still-running loop counts.
- The workspace day axis starts a little later than the 30-day fetch. A lineage that starts in that gap is dropped today, and the corpus has no case for it.
- Timing the founder lookup needs a seeded database. If the build session has none, that line of "Done when" is at risk.
- The extra may push the work past one session.

Nothing in the repository clone was changed. Output files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a13/output/`:
- `description.md`: the size record, 198 words.
- `comment.md`: the evidence, with file and line references.
- `tracker-actions.md`: status to In Progress, and the size record added to the description.

DONE: LIN-4178 sized as "consolidate the decision this task touches" by the standing policy; the cost read must price the row shapes production sends before the surfaces move onto it; no cuts
