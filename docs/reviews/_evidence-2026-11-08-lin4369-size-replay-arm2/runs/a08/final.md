I scoped LIN-4253 and sized it **just the task**, decided by the standing policy. The clone is unchanged.

**Re-grounding:** the work starts at 29f14bf6e, the commit both Surveys read, so nothing is stale. I checked their main claims at HEAD and they hold:
- The only templates with no `route` are `retro`, `survey-task` and `survey-place`, and that is exactly what `EXCLUDED_FROM_AI_RECOMMENDATION` holds.
- `SURVEY_KINDS` is the only gate in the preamble.
- The follow-up path (`provisionResumeCredential`) and the feedback triage route never pass a kind into the preamble.

**Why just the task:**
- "Offered" is already declared once, by whether a template has a `route`. That half only removes a duplicate list.
- The deeper issue is that "read-only" means different things in several places in the repo. Settling what this trait means is a design choice inside the task: it should be defined by what it gates today, the dispatch mandate, and kept separate from the "reading pass" wording and the read-only workflow wording.
- Every larger size changes what a stage is told, which the ticket rules out ("no behaviour change", "Not this ticket"). The standing policy only weighs findings that bind on the task, and none do here.

**Cuts to the ask:** none.

**Open questions:**
- Follow-ups never learn the kind, so a Survey follow-up gets the ordinary mandate today, and so does feedback triage. This could be its own ticket before LIN-4251, which will hit the same gap.
- One pinned list in a test would stop the trait tests passing on an empty set. Whether that counts as a "hand-kept list" is for the plan to decide.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a08/output/:
- description.md: the size record
- comment.md: the comment
- tracker-actions.md: status set to In Progress
- final.md: this message

DONE: LIN-4253 sized as just the task by the standing policy, with the read-only trait to be defined by the dispatch mandate it gates; no cuts.
