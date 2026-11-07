I've written the plan for LIN-998. It is ready to build in one session and doesn't need plan review.

**Cause:** Brief and Recap only generate when the user clicks the button. When a section opens, `init()` asks the server whether output exists. For anything other than "fresh" (current output), it shows a placeholder and a button and stops there (`public/brief.js:136-140`, `public/recap.js:169-173`). Context has no such step, so it always fills itself.

**Change:** in `init()` in both files, current output shows as it does today. "Missing" (none yet) or "stale" (out of date) now calls the existing `refresh()`, which shows the spinner, generates, then shows the output or an error. The tree view and the Swipe cards both open these sections through the same `init()`, so both get the fix. No server change. One trap for the builder: `init()` also wires the button at the end, so the new branch must return before that line, or each refresh click will send two requests.

**Decisions I took myself (reasons are in the plan):**
- **Stale output regenerates on open too.** Research suggested leaving it manual. I didn't, because a stale section currently shows no content, so the click the ticket wants gone would remain. After one regeneration, later opens show the saved output at no cost until the task changes again.
- **Every AI tier generates on open, free tier included.** Research called this the one product decision. I treated the ask as settling it, since excluding free-tier users would deliver only part of what was asked. The server still refuses when AI isn't set up or the daily free quota is used up. The cost is that on the free tier, opening a section with no current output now spends one of the workspace's 20 daily AI calls (the same pool prompt generation uses) without a click. That happens at most once per open, since swiping to the next card never opens a section by itself. If you'd rather keep the click for free-tier users, say so and I'll scope that in.
- **Failures show the existing inline error with `↻ retry`**, not the old generate button, which would fail the same way.

**Cuts to the ask:** none.

**Tests the builder will add**, for both Brief and Recap:
- The section fills itself on open with no click.
- Reopening output that is still current sends no new request.
- Stale output regenerates on open.
- A quota error (429) or an "AI not set up" error (503) shows inline after exactly one request.
- One refresh click sends one request.

The two existing Swipe "refresh button" tests get rewritten to match.

No status change was needed, since the ticket was already In Progress. The repo clone is unchanged.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r15/output/`:
- description.md
- comment.md
- tracker-actions.md
- final.md

DONE: Plan for LIN-998 written: Brief and Recap generate on open when output is missing or stale, on both views, with no server change; fits one session, plan-review due: no
