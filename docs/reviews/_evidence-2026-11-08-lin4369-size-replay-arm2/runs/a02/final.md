Scoped LIN-4253. I set the size to **just the task**, decided by the standing policy.

What the code shows (HEAD is 29f14bf6, the commit both Surveys read, and none of the ticket's files have changed since):
- "Offered" is already declared once, on the template. The templates with no `route` (retro, survey-task, survey-place) are exactly the entries in `EXCLUDED_FROM_AI_RECOMMENDATION` (lib/prompt-templates.js:418). The selector checks both; the router's refusal (lib/action-kind.js) and the task page (`summary.excluded`) check only the set.
- "Read-only" (`SURVEY_KINDS`, lib/proxy-preamble.js:186) only switches the Survey wording of the preamble. "Read-only" means three other things elsewhere: STAGE_INTENT's READING line, `formatReadOnlyWorkflow`, and a comment on the grounding table. That is the deeper issue the ticket touches. The trait has to keep the one meaning the preamble switches on today, or it becomes a fifth meaning. Choosing that meaning is part of the task, not extra work.
- Nothing the Surveys found has to be done first for the asked change to work. So the policy has no larger size to weigh.
- Bringing the other "read-only" meanings under the trait would change what stages are told. The ask forbids that, and LIN-4251 owns it.
- Folding the other per-kind tables into the template is excluded by the ask.

Cuts: none. Open questions in the record:
- The follow-up, resume and feedback-triage paths never pass the stage. A Survey follow-up therefore gets the ordinary mandate. This task keeps that, LIN-4251 inherits it, and it may need its own ticket.
- I read a test that pins which stages carry each trait as the guard, not as a forbidden hand-kept list.

Files:
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a02/output/description.md (the size record)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a02/output/tracker-actions.md (status set to In Progress)

The code clone is unchanged.

DONE: LIN-4253 sized as just the task (standing policy); no cuts; the read-only trait must keep the preamble's one meaning; entry-path gap left as an open question
