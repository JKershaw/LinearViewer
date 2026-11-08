I've scoped LIN-4253 at **consolidate the decision this task touches**, decided by the standing policy (err larger). It's blocked on one ruling about two cuts to what the ticket asked for. Nothing in the repo was changed.

**What the code shows** (at `29f14bf6e`, which is HEAD; nothing has landed on these paths since the ticket, and both Surveys' claims hold):
- **"Offered" is already declared once.** The templates without a selector description (`route`) are exactly retro and the two Surveys, which is what the hand-kept list holds, in the same order. That half of the ticket is a deletion, not a new flag.
- **"Read-only" has no single meaning, and that is the deeper problem.** The list the ticket wants to replace doesn't mark stages as read-only. It switches on Survey-specific wording ("forecast", "the surveyed ticket"). Four other places say read-only, each meaning something different. Adding a plain flag would be a fifth meaning, and LIN-4251 would extend it to four stages, including triage, which changes tracker state.

**Scope:** first, give read-only one written meaning on the trait, read by the dispatch mandate. The other places that say read-only either read the trait or are named for what they actually mean. Then declare both traits on every template, test that none is missing, and remove the lists. Every rendered prompt stays byte-identical, as asked. Folding the other per-kind tables into the template stays out of scope, as the ticket says; the report only says what it would take.

**Ruling needed on two cuts:**
1. Done-when says no hand-kept list of stage names remains. I'd keep one pinned expected set in the tests anyway: without it, a stage losing its trait leaves the tests green.
2. Three entry paths give the preamble no stage kind: follow-up/resume, feedback triage and collective. They keep today's bytes, as the byte-identical rule requires, so a Survey follow-up still gets the normal "reversible work" block.

LIN-4251 should know that triage mostly enters by the feedback route, which carries no kind.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r06/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (status to In Progress)

DECISION: {"decision_id": "lin-4253-scope-cuts", "question": "LIN-4253 cuts two clauses of the ask: (1) tests keep one pinned expected set of read-only/hand-only stages (Done-when says no hand-kept list remains); (2) the follow-up/resume, feedback-triage and collective paths, which give the preamble no kind, keep today's bytes. Accept?", "options": [{"id": "accept-both", "label": "Accept both cuts as written"}, {"id": "no-test-pin", "label": "Accept 2; no stage-name literals in tests at all, accepting that a dropped trait can leave tests green"}, {"id": "thread-kind", "label": "Accept 1; also make the kind-less paths read the trait (behaviour change: Survey follow-ups get the read-only block)"}, {"id": "reject-both", "label": "Reject both: no test pin, and thread kind through every path"}], "recommended": "accept-both"}
BLOCKED: need a ruling on the two cuts to the ask (a pinned test expectation, and kind-less entry paths keeping today's bytes) before LIN-4253's scope is agreed
