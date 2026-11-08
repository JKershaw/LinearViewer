I scoped LIN-4252 and recorded the size as **just the task**, decided by the standing policy (err larger).

**Why:**
- **What binds is part of the task.** Both Surveys say the fake has to repaint the way prompt-section.js does. That means swapping a whole node's markup (`slot.outerHTML =`, at five sites), handling the selector forms it uses (`:scope >`, descendant, `:not(...)`, comma lists), and reading markup back as text. I checked each of these in the code. Without them, lin-4010 can't pass on the fake. And lin-4242's `innerHTML` getter returns `''`, so `keepTypedQuestion`'s equality check would keep the card on every repaint, and the fake would pass without testing anything. That is the task's own goal of "good enough to repaint", so it opens no larger size.
- **Nothing else binds.** Moving the other client suites onto the fake, removing prompt-section's guards that only exist for the fakes, and splitting the file are all worth doing, but the ask works without them. "Err larger" was weighed and changes nothing, because the policy never makes a finding bind.
- **Partly a symptom.** Underneath are prompt-section repainting by rewriting strings, and copied fakes that have bent its code. I said so in the section.
- **Cuts:** none.
- **Staleness check:** HEAD is the commit both Surveys read (29f14bf6), so nothing the ticket names has changed since.

**Open questions:**
- **A shared fake neither Survey mentions.** The Observation tests already share a DOM shim in `tests/fixtures/observation-dom-shim.js`. This ticket leaves it standing, so there will still be a second shared fake. That could be its own ticket.
- **Real failures need a ruling.** With a working `querySelector`, lin-4010 will run repaint paths it has never run. If a test fails for a real reason, the fix is production code, which the ask rules out, so that needs a ruling at that point.

**Output files:**
- `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a06/output/description.md`: the size section, under 200 words.
- `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a06/output/comment.md`
- `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a06/output/tracker-actions.md`: sets the status to In Progress.

I didn't change the clone.

DONE: LIN-4252 sized as just the task (standing policy), no cuts, two open questions recorded
