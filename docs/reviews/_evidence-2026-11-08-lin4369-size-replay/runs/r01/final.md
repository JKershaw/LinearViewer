I've scoped LIN-4253 and written the size record: **just the task**, decided by the standing policy, with no cuts to the ask and nothing open for this task. The repo is still at `29f14bf6e`, the commit the ticket was written against, so the staleness check was clean. Both Surveys' readings hold against the code.

**The two unclear parts, settled:**
- **"Offered" needs no new flag.** A stage is offered exactly when its template says when to pick it (it has a route). The three templates without one are exactly the hand-kept excluded list (retro, survey-task, survey-place), in the same order. So that list is derived or deleted. A second flag could disagree with the route. The kinds with no template (defer, custom, periodical, autopilot) keep their current behaviour.
- **"Read-only" means one thing: the stage is dispatched under the read-only mandate.** It gets the preamble's "change nothing; your only write is your one report" wording instead of the reversible-work wording and the PR-evidence closing. Today that is the two Surveys only. The trait's definition must say it is separate from the three other ways prompt bodies already say "read-only".

**What done means:**
- Every template states both traits outright, so a trait changes only by an explicit edit. That is what "a missing trait fails a test" checks, and it stops tests that read the traits from passing on an empty set.
- The preamble module still doesn't import the template registry. The latest seams reading flags it as a knot with 11 importers.
- "Every entry path" means launch (prose and mcp), the recommend arms, follow-up/resume, feedback triage and collective, for every kind. Only launch passes a kind today. The others keep what they do now: a Survey follow-up still gets the reversible mandate. The report must say so.
- No existing test covers every kind on every path, so proving byte-identity needs a before/after capture taken at the start commit.

**Why not larger:** every larger size breaks the ticket's "no behaviour change" or its explicit "not this ticket". That covers passing the kind on the other paths, making the body wording follow the trait, and folding the other per-kind tables. The ticket is partly a symptom of two deeper problems: per-kind side tables keep multiplying, and "read-only" has no single meaning. The record says so.

**For LIN-4251 (not open here):**
- The read-only wording mentions "the surveyed ticket", so flipping look-into, context or retro without rewording it would tell them something false.
- Triage mostly enters through the feedback route, which passes no kind, so a template trait won't reach most triage dispatches.
- Triage changes Linear state, which conflicts with a "change nothing" mandate.
- Follow-up/resume passes no kind, so any read-only stage gets the reversible mandate on a follow-up.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r01/output/`:
- `description.md`: the `## Size of the move` section.
- `tracker-actions.md`: the status change to In Progress.
- No comment file, because the prompt doesn't ask for a comment.

The code clone is unchanged.

DONE: Scoped LIN-4253 as just the task (standing policy): "offered" comes from having a route, "read-only" means the dispatch mandate, no cuts, and the LIN-4251 risks are handed on.
