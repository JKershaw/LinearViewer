I wrote the survey comment for LIN-4178 at 10b2c82fb to `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/s01/output/comment.md` (489 words). This was a read-only pass, and `code/` is unchanged. Piece 1 (LIN-4177) is in place at this commit. I couldn't read LIN-4176's plan or comments, because there's no tracker access here.

**Main finding: the replay won't catch the failures most likely to hit production.**
- **S11 and S12 (the KPI pages).** The replay's fake collection has no `aggregate`, so the goldens are built from raw rows with full `feedback`.
  - Production rows come from the aggregated projection. They carry `usageEntry`, `terminalEntry` and `ticketMarkerEntries`, and no `feedback`.
  - `cost-read` reads usage from `member.feedback`. On production rows every lineage would come out with no usage, so the replay passes while the live pages show nothing priced.
  - Adding a synthetic `feedback` array to the rows makes it worse. The outcome helpers in `dispatch-lineage.js` all check `Array.isArray(doc.feedback)`, so terminal markers would disappear and no lineage would count as done.
- **S13 (the run page).** The replay builds its loops with made-up `status` and `lineageId` fields. Real loop records from `pipeline-loops.js` have neither `status` nor an anchor field. Fed real loops, `groupLineageMembership` finds no members, so every step would read "not reported".
- **What to do first:** make the replay use production shapes before any wiring. That means a fake `aggregate` that applies the real projection, and real `pipeline-loops` output for S13. Then confirm the goldens still hold at HEAD, and add the note-2 assertion in the same step.

**Other friction the comment covers:**
- **Founder lookup on `/kpis`.** The existing lookup is a store method. `/kpis` reads raw collections across all workspaces, so the new adapter has to batch anchors by `urlKey` over both history and queue. The `followUpTo` restriction holds, because `rootItemId` is only inherited through `followUpTo`.
- **Timing.** The repo has no in-memory Mongo and no seed script. A session without a running `mongod` may not be able to produce the timing that "Done when" requires.
- **The issue move does more than move credits.** Moving a straddler to its founder's issue also changes:
  - S11's component merges;
  - the ticket count T and the per-ticket shares;
  - the lane-landed reconciliation.

  Taking note 1 also moves `pricedLineageShare`. These movements need naming on the change list, or W9 will flag them.
- **Window and day rule.** S11's window and S12's day bucket have to come from `record.members[0]`, the earliest fetched member. Using the founder's time would push the straddler out of the window and change the population.
- **The S12 null-day fix reaches the browser.** `public/workspace-kpis.js` adds up and charts `perDay` as numbers. `render-workspace-kpis.js` also defines its own local `formatUsd`, which hides piece 1's.

DONE: Survey comment written; the main risk is that the replay doesn't use production row shapes (aggregated KPI rows, real loop records), so first make the replay use them, then wire.
