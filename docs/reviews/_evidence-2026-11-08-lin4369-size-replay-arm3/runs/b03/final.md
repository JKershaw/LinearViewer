I sized LIN-4253 as **just the task**, decided by the standing policy. Nothing from the ask is cut.

**Is the ticket still accurate?** Yes. The code is at `29f14bf6e`, the same commit both Surveys read. The only commit touching the files the ticket names is LIN-4248 itself. I checked each Survey claim against the code:
- **Offered:** the three templates with no route (`retro`, `survey-task`, `survey-place`) are exactly what `EXCLUDED_FROM_AI_RECOMMENDATION` lists. So this half deletes a list rather than adding a field.
- **Read-only:** `SURVEY_KINDS` only controls the Survey "forecast" wording in the dispatch instructions.
- **Entry paths:** only the launch path passes the stage's kind through. Follow-ups, the feedback triage route and collective dispatches do not.

**Why not bigger:**
- **What binds:** the read-only trait has to be named for what it actually controls (the dispatch instructions). That is a design choice inside the task, not extra scope.
- **What I didn't take:** making the other read-only meanings (the reading-pass scope line, the choice of read-only or inform-only workflow) follow the same trait. Those cover four different sets of stages. Unifying them would change what some stages are told, which the ticket gives to LIN-4251.
- **The deeper problem:** "read-only" has four meanings in the code today, and LIN-4251 has to reconcile them. LIN-4251 also inherits the follow-up and feedback-route gap, since triage mostly arrives through the feedback route.

Files written:
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b03/output/description.md (the four-line size record)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b03/output/comment.md (the reasoning, what binds and notes for whoever builds it)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b03/output/tracker-actions.md (status Todo -> In Progress)

The clone is unchanged.

DONE: LIN-4253 sized as just the task (standing policy, no cuts); the meaning of the read-only trait and the follow-up/feedback-route gap are passed on to LIN-4251.
