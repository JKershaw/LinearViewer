**LIN-4178 size: consolidate the decision this task touches.** Decided by the standing policy (err larger). Nothing is cut from the ask, so there is no ruling to raise.

I checked the ticket against the code: the only commit since it was written is piece 1 (`10b2c82f`). Both Surveys' claims hold. Three things bind this task, meaning the asked change would not work without them:

1. **The cost read only finds usage in a raw field production KPI rows don't have.** `lib/cost-read.js:66,138` reads usage from `member.feedback` only. The rows behind `/kpis` and workspace KPIs (the projection at `lib/kpi-stats.js:449-460`) carry `usageEntry` and no `feedback`. Moved as is, every live S11/S12 lineage would read as having no usage. The plan said the read would handle both row shapes; piece 1 didn't build it that way.
2. **The read can't group the run page's loops.** Real loop records have no `status`, `rootItemId` or `id`, so the read would drop them all and every S13 step would show "not reported".
3. **The replay can't see either problem.** Its fake collection has no `aggregate`, and its loops are hand-built, so W2, W6 and W9 would pass while production prices nothing.

These are one decision split three ways: how the read sees usage and membership in each row shape production serves. The binding findings open "a small tidy" or "consolidate"; the policy picks consolidate.

The extra is its own piece and goes first: the read takes every production row shape, and the replay is fed real shapes. It may stop: if the goldens don't hold at HEAD under real shapes, the builder stops and reports before wiring anything.

The comment also carries builder notes:
- S12's $0 comes from the data layer, and the chart has to learn about null.
- S13's formatter returns nothing for $0.
- S12 has a population edge at the start of its window.
- Moving the straddler on S11 changes several public totals and shares, not just a credit; each must be listed under (b).
- There may be no `mongod` for the timing check.
- The note-1 decision is still open.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b10/output/`:
- `description.md`: the four-line `## Size of the move` section.
- `comment.md`: the reasoning and builder notes.
- `tracker-actions.md`: status set to In Progress.
- `final.md`: this message.

The code clone was not modified.

DONE: LIN-4178 sized as "consolidate the decision this task touches" (standing policy, no cuts); first piece makes the cost read and replay take the row shapes production serves.
