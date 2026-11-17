# Walk 4: what the round 4 design predicts, written before looking

*Written 17 Nov from `design.md` round 4, before the model is built or anything is seeded, replayed or played. Each line is a prediction [my reading]; afterwards each is marked **held**, **failed**, **half** or **can't tell**, with why. Walk 4 re-runs walk 3 (same real outputs, same parent state, same scenes) on a store that checks shape only, so each difference from walk 3 should trace to the page.*

## Across the three tasks

1. **Only malformed writes are refused.** The seeds need no workarounds: plan-review revises the pieces it reviews, design revises the task, as they really did. No stage leaves out something it meant because the store wouldn't take it.
2. **Corrections replace rather than pile.** Stages revise another stage's finding instead of writing a linked addition; leftover supersedes the lesson its new one replaces; review moves the PR head itself.
3. **Retelling stays stopped:** each of LIN-4450's three main threads (empty-fence defect, live probe, bulk-path gap) is one record at a time, as in walk 3.
4. **Survey-place looks up the area.** With the area findings gone from its brief, its brief falls from 20,000–28,000 bytes to under 10,000, and it runs `find` on its areas. Other stages' briefs are within a fifth of walk 3's. Reported, not scored.
5. **Stale is quieter and still right.** Fewer flags at LIN-4450's end than walk 3's 22, since ended records aren't flagged; review's and blind read's verdicts still show stale after close-out moves the head.
6. **What is open at each task's end is owned,** as in walk 3.
7. **Review can find the plan as approved:** the verdict in its brief names the version it rests on, and `get <id>@<v>` returns it.

## LIN-4472

8. **The autopilot writes as itself.** Its decision on scoping's question is stored, by `autopilot`, and the question shows it as answered.
9. **Implementation sees the autopilot's decision beside the question** and says whose call it is acting on.
10. **John's answer is a second decision on the same question.** Whoever plays John looks, finds the autopilot's decision, and supersedes it with his own. Whether he also finds and supersedes the breakdown's "no serving change" is his reasoning, not the store's: I expect he does only if he searches the parent's decisions. Half.

## LIN-4455

11. **The autopilot's summary is a run with an account,** and adds little the record didn't hold (walk 3: 11 of 14 lines held).
12. **Waiting 2, 4 and 11 are ended** by the stage that settled them, as in walk 3.

## The six scenes

13. **S1, lanes on silence.** The builds' asks are questions to LIN-4448's task (walk 3: builds couldn't ask). Silence leaves them open beside a decision taken on the if-unanswered default. Who is woken is Harbour's, not the store's.
14. **S2, the withdrawn ruling.** The builder's line rests `on` the question; after the withdrawal it shows stale, and the reader sees the question was withdrawn.
15. **S3, the copied count.** No actor types a count: each runs `find --count`, and the reviewer asks for the count as of 10:00. No two disagree.
16. **S4, the double claim.** Session B's brief shows A's open run with the shared path, so B learns of A. A learns of B only if it looks again. Half.
17. **S5, the pile.** The proposals stay open: the store doesn't expire anything, and nothing in the scene declines them. Near-repeats are linked `same-as` only if the sixth run looks. Not a store break; whether Harbour should resurface them is Harbour's.
18. **S6, no git, no tracker.** Every record has a home; the newsletter is a `change` with a saved file as its head. The check to John is in close-out's index, so close-out sees it before sending; what it does is its judgement.

## What would count as a break

As design §5: something with no home; a hand-off to no reader; a thing retold that should be one record; something a stage needed that neither brief nor query gave it; a write refused that was right, or accepted that was malformed.
