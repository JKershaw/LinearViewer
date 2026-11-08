## Size of the move

**Size:** just the task
**Decided by:** the standing policy

**Chosen: just the task.** That means the tidy as asked, with the two things the ticket leaves unclear now settled. I re-checked both Surveys at `29f14bf6e`, which is still HEAD (nothing in the area has changed since the ticket was filed), and their readings hold.

**What the task delivers, settled:**

- **"Offered" is not a new declaration.** A stage is offered exactly when its template says when to pick it. Today the three templates that don't say this (retro, survey-task, survey-place) are exactly the hand-kept "excluded" set, in the same order. So the set either goes away or is derived from the templates, and no second flag is added. A second flag could disagree with the route (an "offered" stage with no route would render "When: undefined" in the selector). The kinds that have no template (defer, custom, periodical, autopilot) behave as they do now: defer is still offered, and the others are still not refused.
- **"Read-only" means one thing: the stage is dispatched under the read-only mandate.** It gets the dispatch preamble's "change nothing; your only write is your one report" mandate and closing, in place of the reversible-work mandate and the PR-evidence closing. Today that is the two Surveys and nothing else. The trait does **not** describe what a prompt body says. The prompt-body "read-only" wording already means three other things: the reading-pass intent line (context, look-into, retro, the Surveys), the read-only workflow helper (context, plan-review, review, retrospective-audit) and the inform-only helper (look-into, retro). The trait's own definition has to say so. Otherwise review and plan-review would read as "not read-only" next to bodies that say they are. A fifth unwritten meaning is exactly what LIN-4251 would trip on.
- **Every template states both traits outright**, including "not offered" and "not read-only". So a trait changes only by an explicit one-line edit, never by a line going missing. That explicit statement is what "a missing trait fails a test". It also stops tests that read the traits from quietly passing on an empty set when a trait is dropped.
- **The trait reaches the preamble without the preamble learning the template registry.** That module is already a flagged knot in the latest seams reading (run 7, F4, 11 importers). The current layering, where the caller resolves the kind and the gate lives in the preamble, stays the shape.
- **"Every entry path" means every path that produces a dispatched prompt.** That covers launch (prose and mcp), the recommend override and descent arms, follow-up/resume, the feedback triage dispatch and collective. Every kind is covered, the kinds without a template included. Only the launch path passes a kind today. The others keep what they do now, including a Survey follow-up still getting the reversible mandate and the PR-evidence closing. That is the "no behaviour change" the ask requires, and the report should say it plainly. No existing test covers every kind on every path, so the byte-identity claim needs its own before/after capture taken at the start commit.

**Sizes weighed:**

- *Just the task* (chosen): one declaration per trait. The routing, refusal, "Another step" and preamble answers come from the templates. LIN-4251's flips become one-line template edits.
- *A small tidy*: also pass the kind through the follow-up/resume and feedback paths, so a read-only stage keeps its mandate there. This changes what a Survey follow-up is told, which breaks this ticket's no-behaviour-change clause. LIN-4251 needs it (see below).
- *Consolidate the decision this task touches*: make the reading-pass intent line and the body workflow helpers follow the one trait. This changes the bytes of context, look-into, retro, review and others. That is LIN-4251's "what any stage is told", so it is out of this ticket by its own terms.
- *Rebuild the area*: fold every per-kind table into the template. The ask rules this out explicitly ("Not this ticket"). The report names what it would take.
- *Wrong work*: no. Both lists exist as described, and the deletion pays straight away.

The standing policy (err larger) is applied, and it lands on the task: every larger size would break the ask's no-behaviour-change clause or its explicit "not this ticket". The ticket's own extra is the report on folding the remaining tables, and that report is part of the task, not added work.

**Aimed at a symptom?** Partly. The deeper problem is that LIN-4248 added about ten per-kind side tables for two stages, and that "read-only" has no single meaning. This ticket fixes the two traits it names and settles that meaning for the dispatch mandate. Folding the rest of the per-kind tables, and making the body wording agree with the mandate, are left to LIN-4251 and to the folding the report describes.

**Cuts to the ask:** none.

**Open questions for this task:** none.

**Handed on to LIN-4251 (not open here):**

- The read-only mandate and closing are worded for a Survey ("the surveyed ticket"). Flipping look-into, context or retro without rewording them would tell those stages something false.
- Triage enters mostly by the feedback route, which passes no kind. So a read-only trait on triage would not reach most triage dispatches unless that path passes the kind.
- Triage files tickets and changes Linear state, which conflicts with a "change nothing" mandate.
- Follow-up/resume passes no kind, so any read-only stage falls back to the reversible mandate on a follow-up.

**Who decided:** the size comes from the standing size policy (err larger, set 2026-11-07), applied as above. There is no human size comment on the trail.
