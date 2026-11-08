I sized LIN-998 as **just the task**, decided by the standing policy. No cuts and no decision needed.

**Why:**
- **Nothing in the code has changed since the ticket.** It was filed at the same commit the Surveys and the repo clone are at (973a8ec), so their references still match the code.
- **Brief and Recap only fetch when a section is opened, and only once per mount**, in both the tree view and Swipe. That means re-expanding a section won't spend again.
- **A section that is out of date shows only a notice, with no content.** So "populated on open" has to include out-of-date sections as well as ones never generated. Keeping the button for either case would be a cut.
- **The Survey global's narrower suggestion (never-generated sections only, paid keys only) would cut the ask**, so I didn't take it.
- **Both views share the two section modules**, so Swipe changes too. That matches how Context behaves in both.
- **Opening a section now spends a model call where a click used to.** That cost is what the person asked for, and triage accepted it.
- **Nothing either Survey found is needed for the change to work.** The policy only enlarges a size when something binds, so it had nothing to act on.

**Open questions, recorded as possible separate tickets:**
- What the person really wants is the content already there when they open it. Generating on open still makes them wait for the model, so generating when the task changes would get closer.
- Merge the two near-identical Brief and Recap modules.
- Stop the server from running two generations for the same issue at once.

The area had no notes or Periodical readings to read.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a11/output/`:
- `description.md`: the size record (197 words).
- `tracker-actions.md`: moves the status from Todo to In Progress.
- No comment, because the prompt didn't ask for one.

The repo clone is untouched.

DONE: Sized LIN-998 as just the task (standing policy); full ask including out-of-date sections on both views, no cuts, size record written below As asked.
