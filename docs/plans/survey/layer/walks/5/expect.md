# Walk 5: what the round 5 design predicts, written before looking

*Written 17 Nov from `design.md` round 5, before the model is built or anything is seeded, replayed or compared. Each line is a prediction [my reading]; afterwards each is marked **held**, **failed**, **half** or **can't tell**, with why.*

## Across every replay

1. **Only malformed writes are refused.**
2. **No stage has to look up its own task's done-when,** and no stage works out which task a ticket number is from text: the brief carries `done-when` and `ref`.
3. **Stale shows only the real signal:** verdicts and decisions resting on a version that later moved, and nothing else.
4. **What is open at each task's end is owned.**

## LIN-4450, the control

5. **As walk 4,** with briefs within a fifth of walk 4's at each stage.
6. **The blind read is not shown the review's verdict,** and its findings don't restate the review's.

## The new shapes

7. **LIN-4463, a parent planning and splitting.** The plan stage writes pieces; plan-review writes one verdict per piece on its exact version and revises the pieces its notes change; breakdown writes the child tasks with `ref` and `piece` links. A verdict on a piece revised after it shows stale. A ruling, if raised, is one question to John with options.
8. **LIN-4446, a plan revised after review.** Plan-review's notes are findings addressed to the plan stage; the second plan revises the piece and ends them; the first verdict, on the old version, shows stale; the second verdict rests on the new one. Nothing has to be retold between the rounds.
9. **LIN-4469, implementation twice around a review.** The review's requests are findings to implementation, ended by the second implementation; the first verdict shows stale once the head moves; the ruling raised and withdrawn leaves nothing claiming merge waits on it, or anything that rests on it shows stale.
10. **LIN-4459, asks on silence.** The asks to LIN-4448's lane are questions to that task with their if-unanswered defaults; the merge goes ahead on them and they stay open, shown, owned by the task they were asked of.
11. **LIN-4464, an area read.** The read has no PR. Its findings go to the area; the read itself has no kind of its own and sits in the run's account and findings. A possible break: a report someone else must later compare against has no home.

## The comparison

12. **The reader with the store answers more questions right** than the reader with the ticket, most clearly on what is open and whose, whether an approval covers the current work, and counts. On what was decided, the two do about as well: prose holds decisions.
13. **The reader with the store uses fewer tokens** to answer.

## What would count as a break

As design §5.
