I've sized LIN-998 as **just the task**, decided by the standing policy. Nothing is cut from the ask.

**What the change is.** Brief and Recap fill themselves when someone opens the section and there is no current output. That covers both missing and out-of-date output, the way Context already behaves. Both views share these section modules, so both change, which matches how Context already works in both.

**Why it is just the task.**
- The code at HEAD (973a8ec) matches what the ticket and both Surveys say. None of the files it mentions has changed since the ticket was filed.
- Each section already loads once, on first open, and generation already exists behind the button. The ask fits the current code cleanly.
- Nothing the Surveys found has to change for this to work. The model-call cost, possible duplicate calls and the near-duplicate Brief and Recap code are all real, but they are separate from this change.
- The standing policy only weighs findings that the change depends on. With none, a small, clear ticket stays just the task.

**Possible follow-up tickets (not filed):**
- Generate briefs and recaps in the background so they are ready before anyone opens the section. That is what the user is really after.
- Put the decision about when briefs and recaps generate in one place, and stop duplicate in-flight calls.
- Merge the two near-identical Brief and Recap modules.

**Cost to flag to the team.** Opening one of these sections will now spend a model call. Workspaces with no connected key will draw on the shared free quota, which prompt generation also uses.

Everything is in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a09/output/`:
- `description.md`: the size record, 198 words
- `comment.md`: the scoping comment
- `tracker-actions.md`: status moved from Todo to In Progress

No repository files were changed.

DONE: LIN-998 sized as just the task by the standing policy, no cuts; size record, comment and status change written
