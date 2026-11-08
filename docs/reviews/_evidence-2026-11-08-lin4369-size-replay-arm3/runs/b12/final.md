I've sized LIN-4178 as **a small tidy**, decided by the standing size policy (err larger), with no cuts to what was asked. Nobody on the trail has ruled on size, and the parent LIN-4176 has no size record. I changed nothing in the repository.

**Re-ground.** The only commit since the ticket was created is piece 1 (`10b2c82f`), which the ticket expects. Piece 1 did not touch the KPI or run-page files, and every line reference in the ticket still matches the code.

**Two findings that bind.** Both Surveys reported them, and I confirmed both in the code:
1. **KPI rows:** the cost read finds usage only in a row's raw feedback, both when it adds up a lineage's cost and when it decides a lineage is incomplete. The rows the public and workspace KPI pages load in production carry a pre-extracted usage entry and no raw feedback. Wired straight in, every KPI lineage would read as having no usage. The approved plan said the read would use the helper that already handles both row shapes; piece 1 departed from that.
2. **Run-page rows:** the run page's real loop records have no status and no anchor. The read groups rows on exactly those, so every step would show "not reported".

The replay's test fakes hide both problems: they hand the read raw feedback and invented statuses. The tests would pass while production priced nothing.

**The tidy, done first and allowed to stop:**
- Make the read accept both production row shapes.
- Make the replay feed it the rows production actually produces.
- Confirm the goldens still hold at HEAD, and run the outcome-set check (review note 2) there.
- If the goldens move on the real shapes, stop and report before moving the KPI pages and run page onto the read.

**For the builder:**
- The workspace page's `$0.00` for a day with nothing priced comes from the data, and the chart draws it too. It needs fixing at that source, not just in the table.
- The run page's dollar formatter hides a real $0, and an existing test pins that.
- Keep the join of outcome facts in one place once the old join function is deleted.
- Add a test case for the edge of the workspace page's 30-day window, or its population could shift unnoticed.
- Moving a straddler to its founder's issue shifts the public page's ticket count and its per-issue shares, not just the credit. That goes in a comment on LIN-4176 under (b), as the ticket's starting-point rule asks.

Nearby work stays in the Surveys and doesn't bind this ticket: one shared founder query, removing the misnamed weekly-budget file, the docs updates, the other dollar formatters, and having the KPI query emit the read's own shape. A local `mongod` is installed, so the founder-lookup timing can be done on a seeded store.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b12/output:
- description.md: the four-line size record
- comment.md: the reasoning, with code references
- tracker-actions.md: status Todo -> In Progress

DONE: Sized LIN-4178 as a small tidy (standing policy, no cuts): first make the cost read accept the row shapes production sends for the KPI and run pages, then move those pages onto it.
