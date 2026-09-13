# Papers

Short studies of Harbour, one question each, with the evidence. `standard.md` says how one
is written. `proposals.md` lists the questions waiting for a paper.

## About Harbour

| Paper | Question | Finding |
|---|---|---|
| [review-loops](harbour/review-loops.md) | Why does a plan go round plan-review more than once? | The gate is not judging the design. 83 of 94 plans were sent back, every send-back read asked for one more member of a list the plan had already built, and the loops cost a third of all session time. |
| [efficiency-levers](harbour/efficiency-levers.md) | What levers to make a task faster or cheaper are already written down? | Thirty-seven, in five stages of a ticket's life. Most are measured once, on one day, and none is measured past its gate. |
| [writing-length](harbour/writing-length.md) | Does the writing get longer faster than the ideas do? | Yes, by about 1.6×. Reviews tripled in three months while their findings doubled. |
| [tasks-generate-tasks](harbour/tasks-generate-tasks.md) | How do tasks generate tasks, and at what rate? | 2.1 created per one closed over sixty days; a generated task that gets worked produces 1.12 more. Half of all filings are never worked, and close-outs and reviews are 63% of that pile. |
| [never-worked-pile](harbour/never-worked-pile.md) | What is in the never-worked pile, and what do the worked chains look like? | Live work in the wrong place: 34 of 40 filings still true at HEAD and 38 self-contained, but 23 of 40 are the parent ticket's own unfinished scope. Worked chains mostly narrow — 54 of 84 hops. |
| [close-out-claims](harbour/close-out-claims.md) | When a close-out files its own unfinished scope next door, does it say so? | Always — 23 of 23 name the filing in the comment that closes the ticket. Five call it the parent's own scope left undone, 18 call it a separate matter now owned elsewhere, and all 23 parents are Done while the filing is unworked. |
| [root-task-ratio](harbour/root-task-ratio.md) | Does the system run out of tasks, or generate them forever? | Neither: collapsing breakdown trees to one unit, 1,484 tickets are 1,340 units and each causes 0.74 further ones. Three in four cause none, but a unit that reaches Done causes 1.52 — the population number is under one only because most filings are never worked. |
| [cheap-implementer](harbour/cheap-implementer.md) | Can a cheap model implement Harbour tickets to Opus's review standard, and what does it cost? | Yes, on small tickets: thirteen PRs from three models, eight first-pass, all within one round, no logic defect found. The Opus review is the cost, $2 to $5 each and flat with size. A cheap shadow reviewer agreed with Opus on every clean PR and missed the one hard finding it saw cold. Every launch failure was plumbing, invisible from Harbour. |

## About the process

None yet. A question about how papers are written goes in `process/`.
