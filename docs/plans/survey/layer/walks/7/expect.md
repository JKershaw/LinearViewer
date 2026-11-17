# Walk 7: what round 6 predicts when stages write through it, written before looking

*Written 17 Nov from `design.md` round 6, before the model is built or anything is seeded or replayed. Each line is a prediction [my reading]; afterwards each is marked **held**, **failed**, **half** or **can't tell**, with why.*

**What this walk is for.** No stage has written through round 6 (walk 6 only carried old stores across). This walk has stages write through it, on three tasks whose real histories contain each untested write, plus one outside project filled in after the fact. It is the last cheap check before John corrects the design. Nothing is run on Yap and nothing goes into Harbour.

**What runs.**
- A model built fresh from design §3–4 by a fresh agent.
- Three replays from walk 5's seeds and real outputs, each stage a fresh agent: LIN-4450 (the control, 8 steps), LIN-4446 (a plan revised after review, John's read at the end, 13 steps), LIN-4469 (two builds around a review, a ruling raised and withdrawn, 11 steps).
- Yap (`JKershaw/yap`, public): its mobile thread of 22–23 Apr filled in after the fact from git (the mobile UX commit, PRs #16, #17, #19, #20), with Yap's own actors. It tests whether the kinds hold a project that has no Harbour stages and no tracker.

## Across the replays

1. **Only malformed writes are refused.** None of walk 5's 23 refusals of a `to` on a decision, verdict or change recur.
2. **Hand-offs carried by judgements reach their reader.** Review's "fix before merge" is carried on the verdict (or a finding) addressed to the stage that must act, and that stage's brief shows it in part 3.
3. **Nothing is left with no reader.** Records addressed to a stage that has already run show in later briefs as left behind, and a later stage ends or hands them on. What is open at each task's end is owned; checks to John may stay open.
4. **Stale is quiet:** only verdicts or decisions on content that moved, at most two flags per task at any step.
5. **The run's account holds the stage's own words,** and part 8 carries the previous stage's account in full. Briefs grow because of it: at the same steps they run 20–60% larger than walk 5's.
6. **The blind read sees no other verdict,** in its brief or its queries.

## Per task

7. **LIN-4450, the control.** As walk 5, with refusals at or near zero. Close-out's after-approval fixes leave the review's verdict stale, and close-out deals with it.
8. **LIN-4446.** The first plan-review verdict ends superseded, into the second, which rests on the revised plan. John's read becomes a decision scoped to the area; a brief for a fresh task whose paths overlap the area shows it.
9. **LIN-4469.** The first review records "needs-discussion". The second review's verdict supersedes it. The ruling's question ends withdrawn. *Half expected:* if the autopilot's "merge waits on the ruling" rests `on` the question, it shows stale after the withdrawal; if it only links `about`, it doesn't, and that is a break of linking habit, not shape.

## Yap

10. **Everything in the thread has a home,** with actors John and the Claude sessions, and tasks with no `ref`.
11. **The fix to a fix** (#17 keeps the header visible when the keyboard opens; #20 fixes stale height when it closes) reads as one subject: the second is linked to the first, not written as an unrelated record.
12. **Yap's own standing text** (`philosophy.md`, `rejected-ideas.md`, `AGENTS.md` conventions) splits into decisions scoped to the project or an area, and lessons. *Likely break:* a convention that is both a rule and a lesson has no clear kind.

## What counts as a break

As design §5. Listed, not scored: the model's rough edges.
