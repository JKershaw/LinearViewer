I scoped LIN-4178 and set its size to **consolidate the decision this task touches**. The standing err-larger policy decided it: no person has ruled on size, and the parent has no size record.

**Why it binds:** I checked this in the code at HEAD 10b2c82f.
- The one cost read gets usage only from a row's full feedback array.
- The KPI pages' production rows come from the Mongo projection. They carry one usage entry and no feedback.
- The run page's real loop records have none of the status or anchor fields the read's membership rule needs.
- The replay can't catch either problem. Its fake collection has no aggregate, so it reads raw rows, and it builds loops by hand. Wiring the surfaces as asked would leave the replay passing while production prices nothing.

**The extra, done first:** the read and the replay accept the row shapes production actually produces. This step stops and reports if it would need the KPI aggregation to project more feedback, since that is the old timeout risk.

**Staleness check:** nothing has changed between the grounding commit and HEAD in any file the ticket cites.

**Two display fixes are already in the ask but sit a layer deeper than the ticket says:**
- The run page's $0 formatter hides every value of 0 or less.
- The workspace page's zero comes from the data layer and also feeds the chart.

**Open, not binding:**
- Crediting a straddler to its founder's issue may move published shares, not just credits. If the replay shows that, the change list needs a comment on LIN-4176.
- The founder-lookup query may end up copied a second time.
- Timing the founder lookup needs a seeded Mongo store, which the repo doesn't provide.
- The ticket says LIN-4176's description is in parent-LIN-4176.md, but that file is missing from the run directory, so the size rests on the code and the two Surveys.

**Cuts to the ask:** none.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a01/output/:
- description.md: the size record
- comment.md: evidence and open questions
- tracker-actions.md: status set to In Progress

The clone is unchanged.

DONE: LIN-4178 sized as "consolidate the decision this task touches" (standing policy); the read and replay must take production row shapes first; no cuts.
