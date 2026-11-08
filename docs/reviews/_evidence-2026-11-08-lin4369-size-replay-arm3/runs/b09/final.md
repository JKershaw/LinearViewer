LIN-4178 is sized as **consolidate the decision this task touches**, decided by the standing "err larger" policy. There are no cuts to the `## As asked` block, so no ruling is needed. Nothing has changed since the ticket was filed: HEAD is still piece 1's merge, `10b2c82f`. The code clone is unchanged.

**Why it is bigger than just the task.** As the code stands, the asked change would not work. The extra work comes first, as its own piece:
- **The cost read accepts only the raw row shape.** `lib/cost-read.js` reads a row's usage only from `member.feedback`. The rows Mongo hands to both KPI pages (the projection at `lib/kpi-stats.js:449-460`) carry `usageEntry` and no `feedback`. Wired straight in, both KPI pages would price nothing in production. The approved plan said the read would accept both shapes through `usageOf`, so piece 1 departed from it here.
- **Real run-page loops never count as members.** They carry only `loopId`, `lineageId` and `historyStatus`, with no `status` or `rootItemId`. The membership rule would drop every loop, so every S13 step would read "not reported".
- **The replay test can't catch either problem.** Its fake collection has no `aggregate`, and its run-page loops are built by hand with a `status` real loops lack. W2, W6 and W9 would pass while production is broken.

**The first piece:** make the read accept all three row shapes, test each shape, and run the replay on shapes production really produces. Then check the goldens still hold at HEAD. It changes no figures. If the goldens don't hold on those shapes, the baseline is wrong: stop and take it back to LIN-4176.

**Part of the task, because they cause asked fixes.** S12's all-unpriced day reads `$0.00` because the data writes 0 (`lib/workspace-kpi-stats.js:98`), and the browser chart reads the same data. S13's formatter blanks any amount of $0 or less, so a complete $0 would show nothing.

**Not binding, so left to the builder and the Surveys:**
- writing the founder query once
- one join for status and ticket walk
- deleting `weekly-budget.js`
- updating the source map

The builder should also name under (b) everything the issue move shifts in S11 (components, T, per-ticket flags). If a published share moves, that needs a word on LIN-4176 first.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b09/output/`:
- `description.md`: the four-line size record
- `comment.md`: the reasoning, with file references
- `tracker-actions.md`: status Todo to In Progress

DONE: Sized LIN-4178 as "consolidate the decision this task touches" under the standing policy, with no cuts; first piece makes the cost read and replay take production row shapes.
