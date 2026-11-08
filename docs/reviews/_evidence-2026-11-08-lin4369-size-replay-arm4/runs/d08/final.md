I sized LIN-4253 as **just the task**, under the standing policy, with no cuts. The record is in `output/description.md` and the status change to In Progress is in `output/tracker-actions.md`. I posted no comment, as the prompt says.

**Is the ticket stale?** No. Both Surveys were written at `29f14bf6e`, which is HEAD of the clone, so nothing in the referenced files has changed since. I checked their claims in the code and they hold:
- **Offered:** the templates with no `route` are exactly retro, survey-task and survey-place, in that order. That is exactly the set the hand-kept "offered" list holds (`lib/prompt-templates.js:418`). The selector checks both; the router's refusal (`lib/action-kind.js:18`) and the task page (`lib/task-page-loader.js:1022`) read only the list. So deriving the list from "has no route" keeps every output byte-identical.
- **Read-only:** the list in `lib/proxy-preamble.js:186` holds only the two Survey kinds and only switches the Survey mandate and closing wording. Other code also uses "read-only", with different stage sets:
  - the reading-pass line in `lib/prompts/stage-intent.js` (context, look-into, retro and both Surveys);
  - `formatReadOnlyWorkflow` (context, plan-review, review, retrospective-audit);
  - the grounding comment.
- **Test copies:** the stage names are copied by hand in `tests/unit/lin-4248-survey-preamble.test.js`, `tests/unit/lin-4248-survey-dispatch-paths.test.js` and `tests/unit/lin-4248-survey-stages.test.js`.

**Why no larger size.** A finding only binds if the asked change would fail, or leave its problem in place, without it. None of the Survey findings meets that:
- **The other read-only meanings:** they cover different stage sets, so merging them into the new trait would change what context, look-into and retro are told. That is LIN-4251's work, and this ticket rules it out. Keeping them separate does not stop the asked change from working.
- **The other per-kind tables:** the ticket explicitly leaves them out and asks only for a report on what folding them would take.

So the larger sizes have no binding finding to weigh, and a small, clear ticket stays just the task under the standing policy.

**The deeper issue.** The ticket's real target is the per-kind side-table pattern that LIN-4248 extended: about ten maps keyed by stage name. The ticket already knows this and handles it the right way, by reporting on it instead of doing it.

**Engineering choices for the implementer (not cuts):**
- **Name the read-only trait for what it switches:** the dispatch mandate. Its doc comment should say how it differs from the reading-pass line and the read-only workflow helpers. Otherwise it becomes a fifth meaning, and review and plan-review would be marked "not read-only" while their prompts tell them "You are read-only".
- **Declare "offered" once.** Base it on `route` (make `route` required, with null meaning hand-only), not a separate flag that could disagree with it. A separate offered flag with no route would print "When: undefined" into the selector.
- **Keep the preamble module free of the template registry.** The caller in `lib/dispatch-entrance.js` already has the resolved kind, so it can look up the trait and pass a boolean.
- **Avoid tests that can't fail.** Tests should read the trait, plus one pinned list of the expected stages (the only hand-kept list allowed). Without the pin, a dropped trait just empties the loop and the tests stay green.
- **Take a byte capture before the change:** every kind, in prose and mcp mode, on each entry path. No existing test covers every kind on every path.
- **Keep one existing gap unchanged:** the follow-up/resume path never receives the kind, so a Survey follow-up gets the normal mandate today. "No behaviour change" means leaving that as is and saying so; LIN-4251 inherits it.
- **Update two stale comments:** the header of `lib/action-kind.js` and the docstring in `lib/prompt-template-defs.js` that says "No route: never offered (retro)".

DONE: LIN-4253 sized as "just the task" (standing policy, no cuts); size record written, status set to In Progress, nothing changed in the repo
