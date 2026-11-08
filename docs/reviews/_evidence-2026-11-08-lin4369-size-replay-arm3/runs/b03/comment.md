## Scoping: size of the move

**Size: just the task. Decided by the standing policy (err larger, 2026-11-07). No cuts.**

**Is the ticket still accurate?** HEAD is `29f14bf6e`, the same commit both Surveys read. Since the ticket was filed, the only commit to touch the referenced paths is LIN-4248 itself. I re-checked each claim at HEAD:
- The templates without a `route` are exactly `retro`, `survey-task` and `survey-place`. `EXCLUDED_FROM_AI_RECOMMENDATION` (`lib/prompt-templates.js:418`) lists exactly those, in the same order.
- `SURVEY_KINDS` (`lib/proxy-preamble.js:186`) gates only the Survey mandate and its closing sentence.
- Only the launch arm in `lib/dispatch-entrance.js:1083` passes `kind` on to the preamble.
- The three LIN-4248 test files each copy the two kind names.

**What binds on this task**
- **What "read-only" means.** The trait has to be named and documented for the thing it actually controls: the dispatch mandate, meaning the Survey "forecast" wording. Otherwise the declaration is wrong for review and plan-review, which already call themselves read-only, and LIN-4251's one-line change would give triage "your only write is the one comment on the surveyed ticket". This is a design choice inside the task. It does not make the move bigger.
- **Entry paths that never pass a kind.** These are the follow-up/resume, the feedback triage route and collective. To keep the prompts byte-identical, they must keep getting the reversible-work mandate. The report should say so.
- **Module boundary.** The preamble module deliberately does not import the template registry. So the caller has to resolve the trait. That is an engineering choice, stated here so it is not a surprise.

**What I weighed and did not take**
"Consolidate the decision" would also make the reading-pass scope line and the choice of read-only/inform-only workflow read the trait. At HEAD those cover four different sets of stages. One trait can only drive all of them if some stages are told something different, and the ticket rules that out ("changing what any stage is told" is LIN-4251's job). The policy only weighs a larger size that a binding finding opens. This one would break the no-behaviour-change constraint, so I did not take it.

**Something deeper, for LIN-4251.** The real issue is that "read-only" has four meanings in the code, plus this trait as a fifth. LIN-4251 is where they must be reconciled. Its four stages (look-into, context, retro, triage) are nearly the reading-pass set. LIN-4251 also inherits the resume and feedback-route gap, since triage mostly comes in through the feedback route.

**Notes for whoever builds it:**
- "Offered" is a deletion, not a new field: derive it from the template's `route`.
- `defer` stays offered through the meta-routes, and `custom` and `periodical` must still not be refused.
- The tests should check that every template declares its traits as its own properties. A byte capture of every kind on every entry path, taken before the change, keeps the tests that iterate the derived set from becoming tautologies. That works without leaving a hand-kept list of stage names behind.
