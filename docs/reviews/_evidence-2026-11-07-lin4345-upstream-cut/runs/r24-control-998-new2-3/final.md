I've written the plan for LIN-998 into the description under `## Implementation Plan`. It fits one session, plan review is due, and nothing is cut from what was asked.

**The change:** it only touches the browser code, in `public/brief.js` and `public/recap.js`. When a section opens and its cached copy is current, it shows that copy as it does today. When there is no cached copy, or it is out of date, the section now starts generating straight away, using the same spinner and request the `✦ generate` / `↻ refresh` button uses. Both the tree view and the swipe view get this, because they open the sections through the same code. The server routes, the cache and the once-per-card mount guard are unchanged.

**Decisions I made rather than parking them:**
- **Out-of-date sections also generate on open.** Research suggested leaving those on the manual button. I didn't, because an out-of-date section shows no content today: the server returns no text in that case, so the section would still open empty. The cost stays bounded: a new generation happens only after the task has actually changed since the last one.
- **Every AI tier generates on open, free tier included.** The free-tier daily limit is still enforced on the server. Once it is reached, the section shows the existing inline error with `↻ retry` and never retries by itself. Leaving free tier on the manual button would have cut the request for those users.

**Why plan review is due:** this removes the click that kept these two sections from spending on the AI model without the user asking. It also deliberately goes against the "generate only on an explicit button" rule the Observation page follows. A second reader should confirm that before it is built.

**Tests the builder will add:** browser tests, run for both sections on both views:
- An empty section fills in with no click, after exactly one generation.
- An out-of-date section regenerates and fills in.
- A section with a current copy, or one that is collapsed and reopened, triggers no generation at all.
- One click on `↻ refresh` triggers exactly one generation. This guards against the button being wired twice.
- A failed generation stops on the error.

The existing swipe and tree tests that assume the first generation is a manual click will be updated.

I checked for changes since the ticket was filed: none touch these sections. I made no code changes and the clone is clean. The ticket was already In Progress, so I didn't change its status.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r24/output:
- description.md
- comment.md
- tracker-actions.md

DONE: Planned LIN-998: Brief/Recap generate on open when missing or out of date, on both views; no cuts; fits one session; plan-review due: yes
