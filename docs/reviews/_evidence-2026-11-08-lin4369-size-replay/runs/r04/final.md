I scoped LIN-4178. The size is **consolidate the decision this task touches**, decided by the standing policy (err larger). It cuts nothing from the ask, so I don't need a ruling.

**What I found in the code**
- **The recorded public-card golden doesn't match today's `/kpis` page.** The replay runs the public card over every stored row, without the page's 30-day fetch, so its golden leaves out the four straddler lineages (`st`, `so`, `nss`, `cg`) that the live page counts today.
  - At HEAD on the same fixture rows, the golden gives 9 priced tickets and $74.28. The rows production would fetch give 11 and $79.88.
  - Against that golden, the ticket's tests contradict each other: "keep today's population" and "match the golden except (b)" can't both pass.
  - The straddler the ticket's note 1 is about isn't in the golden's population at all.
  - The workspace page's golden does use the 30-day window, so the two goldens disagree on population. That breaks the ticket's check that workspace cost per day equals the public card's figures.
- **I confirmed both Surveys' warning about row shapes.** The replay feeds the KPI and run-page code row shapes production never produces. Wired as written, the replay would pass while the live public and workspace pages price nothing and the run page shows no figures.
- **The $0 fixes need to go below the renderers.** The workspace day's zero comes from the stats code and also feeds the chart. The run page's formatter blanks a real $0.

**What done means now**
- The three surfaces read from the one cost read, on the row shapes production gives them.
- "Today's population" and "the golden" mean the same thing: what the public page counts today.
- The work starts by making the replay use production row shapes and re-taking those three goldens at the same baseline commit. If the outcome-rate check (note 2) fails there, the builder stops and reports on LIN-4176.
- After that comes the asked wiring, plus one founder query, one join, the unknown-day fix in the data and the chart, the misnamed `weekly-budget.js` removed, and the source map updated.
- Making the KPI query emit the read's shape directly would be a rebuild, and is not this piece.

All the line references in the ticket still hold at `10b2c82f`, and nothing has changed since the ticket was filed. The code clone is untouched.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r04/output/`:
- `description.md`: the size record.
- `comment.md`: the evidence comment.
- `tracker-actions.md`: status to In Progress.
- `final.md`: this message.

DONE: Scoped LIN-4178 as "consolidate the decision this task touches" (standing policy, no cuts): replay moves to production row shapes and the S11–S13 goldens are re-taken first, because the S11 golden leaves out the straddlers the live page counts.
