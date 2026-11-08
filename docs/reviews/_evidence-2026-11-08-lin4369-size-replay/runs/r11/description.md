## Size of the move

**Size:** consolidate the decision this task touches
**Decided by:** the standing policy

**Chosen: settle what "read-only" means first, then do the tidy as asked.** The two traits are in different states.

- **"Offered" is already declared once.** A stage is offered exactly when its template says when to route to it. The name list beside it is a second copy, word for word: the templates with no route are exactly the three it names, in the same order. So this half is a deletion. Each template must then say whether it is routed, and one that doesn't fails a test.
- **"Read-only" is why this goes larger.** The code says "read-only" in four ways today, and they don't agree:
  - the dispatch preamble's Survey mandate, which is really Survey wording ("your only write is the one comment on the surveyed ticket");
  - the stage-intent "reading pass" line on context, look-into, retro and both Surveys;
  - the prompt bodies' read-only workflow (context, plan-review, review, retrospective-audit). plan-review even tells itself "You are read-only" while it posts a verdict;
  - the prompt bodies' inform-only workflow (look-into, retro).

A plain read-only flag would be a fifth meaning. It would sit on the preamble's Survey gate, so when LIN-4251 flips it for look-into, context, retro and triage, they would get the Survey forecast mandate. Triage files tickets and changes Linear state. I applied the standing policy (err larger, 2026-11-07): the code shows the larger move pays, because LIN-4251 builds directly on this trait.

**Sizes weighed**
- *Just the task:* deletes the "offered" copy and moves the Survey list onto the templates. It meets the ask word for word, but the trait would be named for something it doesn't control, so LIN-4251's first flip sends the wrong mandate.
- *A small tidy:* the above, plus fixing the stale comments that describe the lists. The naming problem stays.
- *Consolidate the decision this task touches (chosen):* fixes what the read-only trait means (what a dispatched stage may change, as the preamble tells it), declares that once, and says where each other "read-only" wording stands against it. LIN-4251 then flips a trait whose meaning is settled.
- *Rebuild the area:* folds every per-kind table into the template (leads, intent, grounding, completion signals, run-view labels, wall-clock buckets, the job census). The ticket rules this out and asks only for a written estimate. It would bury a no-behaviour-change tidy under a large move.
- *Wrong work:* no. Both lists really are duplicates, and LIN-4251 is waiting on this.

**The extra, done first as its own piece:** settle and name what the read-only trait means. It is the mandate the preamble gives a dispatched stage, which is a different thing from the prompt-body workflow wording and the stage-intent line. Then decide, for each of those other wordings, whether it reads the trait or stays separate, with a test pinning the answer either way. Every prompt stays byte-identical, so a wording that can't read the trait without changing what a stage is told today stays separate, and this record says so for LIN-4251. That covers plan-review's "read-only" body and the "reading pass" line on context, look-into and retro. **It may stop** once the trait is named and its relation to the other wordings is written down and pinned, if reconciling them further would change any prompt. It says why when it stops.

**Scope this size includes (what, not how)**
- **Entry paths.** Only the launch path tells the preamble the stage kind. The feedback triage dispatch, collective and the follow-up resume don't.
  - Feedback triage should be brought onto the trait. Its bytes don't change today, because triage isn't read-only, and LIN-4251's triage mostly comes in that way.
  - Collective stays a non-template kind. It is not refused and not read-only.
  - Follow-up resume is covered under the cut below.
- **The one offered option with no template** (defer) stays offered, and non-template kinds stay unrefused.
- **Tests.** A template that doesn't declare either trait fails a test. A test that reads the traits must still catch a dropped trait: looping over a derived set passes when the set is empty. It must do that without becoming a second hand-kept list of names.
- **Proof of no behaviour change.** Render every kind, in both preamble modes, on every entry path including a follow-up, before and after. No existing test covers all of that.
- **Module boundary.** The preamble deliberately doesn't load the template registry. Keep that: the trait is worked out before the preamble is called.

**The ticket is aimed at a symptom.** The two name lists are what shows. Underneath:
- "read-only" has no single meaning (this size fixes that);
- per-kind tables keep being added beside the template rather than on it. LIN-4248 touched about ten. That is the fold the ticket asks to be estimated in the report only.

**Cuts to the ask (pending a ruling)**
- *"Everything that asks reads that one declaration: the stage selector, the router's refusal, the task page's "Another step" list and the dispatch preamble. Then changing a trait is a one-line edit to the template."*
  - When a follow-up re-attaches the proxy context, the preamble is never told the stage kind, so it can't read the trait.
  - So today a Survey follow-up gets the ordinary mandate ("investigate, edit, open PRs") and the closing that asks for PR evidence. Making it read the trait would change those bytes, which *"every kind's rendered dispatch prompt is byte-identical on every entry path"* forbids.
  - Under this size, follow-up resume still isn't told the kind, so flipping read-only won't reach a follow-up.
  - Recommended: accept this, and close the follow-up gap in its own ticket before LIN-4251, which would give four more stages the same gap.

**Open questions:** none beyond the ruling above.

**Who decided:** the standing policy (err larger, 2026-11-07) set the size. The follow-up cut is pending a ruling.
