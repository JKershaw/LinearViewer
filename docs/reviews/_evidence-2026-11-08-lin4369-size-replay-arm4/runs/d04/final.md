I sized LIN-4253 as **just the task**, decided by the standing policy. No cuts.

**Is the ticket still accurate?** Yes. The clone's HEAD is `29f14bf6`, the LIN-4248 merge itself. Both Surveys were taken at that commit, and no later commit touches the files involved. I checked the code against the Surveys:
- `EXCLUDED_FROM_AI_RECOMMENDATION` is `{retro, survey-task, survey-place}`, in `lib/prompt-templates.js:418`. That is exactly the set of templates with no `route`. Its readers are the selector filter (`:430`), `lib/action-kind.js:18` and `lib/task-page-loader.js:1022`.
- `SURVEY_KINDS` is in `lib/proxy-preamble.js:186`. Only `lib/dispatch-entrance.js` passes it a `kind`.
- The copied literals are in `tests/unit/lin-4248-survey-preamble.test.js:17` and `lin-4248-survey-dispatch-paths.test.js:96`. The stages test and two older tests read the exclusion set directly.

**Why not a larger size.** A finding only binds if the asked change would fail, or leave its problem in place, without it. None of the Survey findings does:
- **Read-only means four different things in the repo:** the preamble mandate, `STAGE_INTENT`'s READING scope, `formatReadOnlyWorkflow`, and a comment in the grounding table. This is real and deeper than the ticket. But unifying them would change prompts, which breaks the ticket's "no behaviour change" rule, and it means folding per-kind tables the ticket puts out of scope. It belongs to LIN-4251.
- **Some entry paths drop the kind** (follow-up resume, feedback triage, collective). Fixing that changes behaviour, so it is not this ticket's to fix. The ticket keeps today's behaviour and should say so in its report. LIN-4251 inherits the gap.
- **Where the code lives, and keeping the tests from becoming tautologies,** are how-choices inside the task, not extra work.

So nothing binds. The standing policy only weighs sizes that a binding finding opens, so it leaves this small, clear tidy as asked.

**Engineering choices inside the task** (for the build stage; none of them changes the scope):
- Define the read-only trait as the dispatch mandate: no writes except the stage's one report comment. Its docstring should say how it differs from the prompt-body workflow helpers. Review and plan-review are then honestly not read-only. Keeping the name "read-only" delivers the ask in full; renaming it to a "forecast mandate" would be a cut.
- Offered stays declared once by `route`, so there is no second flag. One option: make `route` required, with null meaning hand-only, and add a test.
- The preamble keeps receiving a resolved value from its caller, so it never imports the template registry.
- One pinned expected list stays in the tests, so dropping a trait cannot empty the test loops and leave them green.
- Before and after the change, capture the rendered prompt for every kind on every entry path, and diff the bytes.

**Symptom of something deeper?** Partly. This ticket tidies one case of a general habit: per-kind side tables (leads, intent, grounding, completion signals, buckets, labels). Read-only having four meanings is the deeper problem. Both stay with the Surveys and LIN-4251, as the ticket intends.

**Files written** (under `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/d04/output/`):
- `description.md` holds the four-line size record.
- `tracker-actions.md` moves the status to In Progress.
- There is no `comment.md`, because the prompt says to post no comment.

I changed nothing in the clone.

DONE: LIN-4253 sized as just the task (standing policy, no cuts); size record written, status set to In Progress
