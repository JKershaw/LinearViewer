I've scoped LIN-4253 as **just the task**, decided by the standing policy. Nothing in the clone was changed.

What the code shows (HEAD is 29f14bf6, and there have been no commits since the Surveys):
- **Offered:** this trait is already set on each template by whether it has a route. The list of stages not offered by the AI is exactly the templates with no route (retro and the two Surveys), in the same order. This half is just deleting a second copy.
- **Read-only:** the Survey list in the preamble really picks the Survey mandate and closing wording, not read-only work in general. Naming the trait for what it gates is a choice inside the task, not a bigger move.
- **No finding binds this task.** The kind not being passed on follow-up dispatches, the layering, and the test tautology risk are all either how to do the work or nearby issues. So the standing policy has no larger size to weigh.

Cuts to the ask: none.

Open questions, each a possible ticket of its own:
- **Follow-up dispatches carry no kind,** so a Survey follow-up gets the ordinary mandate. LIN-4251 inherits this.
- **Read-only has four other meanings in the prompts,** and they will drift away from this trait. This is the deeper problem.

Files written:
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a04/output/description.md (the size record)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a04/output/comment.md
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a04/output/tracker-actions.md (status set to In Progress)

DONE: LIN-4253 sized as just the task by the standing policy, with no cuts and two open questions
