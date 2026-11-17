# Walk 5 results: more kinds of task, and a comparison with today

*17 Nov. Model built fresh from `design.md` round 5 (289 lines, read by me; its test passes). Six replays: LIN-4450 again as the control, and five new shapes, each prepared from Harbour's material by one agent and replayed stage by stage by fresh agents (`stage-instructions.md`). The comparison ran at six stage starts on three tasks (`compare/`). Counts are [checked, by `analyse.mjs`, `show` and the grade files]; stage, reader and grader notes are [reported]; readings are [my reading]. Expectations: `expect.md`.*

## What ran

- **Six replays, 57 steps** (LIN-4450 8; LIN-4463's own stages 6; LIN-4446 13 with John's read; LIN-4469 11 with the autopilot three times and John once; LIN-4459 10; LIN-4464 11 with John, breakdown and the autopilot). About 85 to 150 queries per task.
- **Refusals:** 35 in all. 23 of them are one thing: a stage tried to address a decision, verdict or change to someone ("takes no to"). The rest: a review outcome Harbour has and the store doesn't ("needs-discussion"), a verdict that can't be superseded, a decision scoped to an area, an unknown area name, and typing slips.
- **Brief against the ticket:** briefs ran from 3,100 to 27,000 bytes; the tickets they stand beside ran from 2,200 to 56,000. Late in a task the brief is a half to two-thirds of the ticket (LIN-4446 close-out: 25,283 against 55,870). Early briefs are larger than the early ticket, as before.

## The comparison

Six stage starts, six questions each, written with true answers from the full history by one agent; answered by one reader with the ticket and its parent as they stood, and one with the brief and the store cut at that moment; marked by a third [checked, `compare/*/grade.md`].

| Point | Ticket reader | Store reader |
|---|---|---|
| LIN-4450 review | 5 right, 1 partly | 4 right, 1 partly, 1 wrong |
| LIN-4450 close-out | 3 right, 2 partly, 1 wrong | 3 right, 3 partly |
| LIN-4446 plan-review (2nd) | 6 right | 3 right, 3 partly |
| LIN-4446 close-out | 4 right, 2 partly | 3 right, 2 partly, 1 can't tell |
| LIN-4469 review (2nd) | 5 right, 1 partly | 3 right, 3 partly |
| LIN-4469 close-out | 4 right, 2 partly | 4 right, 2 partly |
| **All 36** | **27 right, 8 partly, 1 wrong** | **20 right, 14 partly, 1 wrong, 1 can't tell** |

By question: both readers got every earlier **decision** right (6 of 6 each) and nearly every **approval against the current head** (6 and 5). The store reader did worse on **what is addressed to this stage** (ticket 2 right and 4 partly; store none right, 6 partly), on **what is still open and whose** (2 and 1 right), and on **counts** (ticket 6 of 6; store 3 right, 1 partly, 1 wrong, 1 can't tell). Tokens used were about the same for both (84,000 to 111,000 each, mostly fixed overhead); the store readers made more calls (6 to 11 against 4 or 5).

**Why the store reader missed** [my reading, from the grade files and the stage notes]: every miss traces to what an earlier stage wrote, not to what the store could hold.
- Routing the design refused. Review's "fix this before merge" belongs to close-out; when a verdict couldn't carry `to`, some stages wrote a separate finding and some didn't. Implementation's "check these" to review went the same way.
- Condensing. Implementation recorded 3 of the PR's 5 departures from the plan; plan-review wrote 7 of its 8 notes; a ledger of 3 items became a set of records whose count no one could read off.
- Folding. The second plan handed every review note into the plan, so nothing was left addressed to plan-review, though plan-review needed to check those notes.
- One replay artefact: in LIN-4469 the leftover's commit was written before the second review's start, a few seconds earlier than it really landed, which cost the store reader one answer.

The ticket keeps every word a stage wrote; the store keeps what the stage chose to make a record of.

## Against the expectations

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | Only malformed writes refused | **Failed** | 23 refusals of a `to` on a decision, verdict or change, each a routing the writer meant |
| 2 | No stage looks up its done-when or works out a ticket id | **Held** | `done-when` and `ref` in part 1; ids mismatched only where a seed lacked the sibling |
| 3 | Stale shows only the real signal | **Failed** | Right at every task's end for the verdicts on a moved head, but also: chains (one finding revised, 10 records flagged in LIN-4446), a loop (plan rests on a verdict that rests on the plan), findings and checks that merely mention the change, and re-addressing counted as a revision |
| 4 | What is open at the end is owned | **Half** | Mostly; but records addressed to a stage that has already run sit open with no reader (LIN-4446: three to review; LIN-4469: one to review; LIN-4463: one to scoping) |
| 5 | Control briefs within a fifth of walk 4 | **Held** | 10,210 to 21,888 against 9,553 to 20,274 |
| 6 | The blind read isn't shown the review's verdict | **Half** | Not in its brief; but other records' text names it, and queries show it |
| 7 | LIN-4463: pieces, verdicts, children | **Half** | Two pieces, one verdict on both, children with `ref` and `piece`. But a parent links one piece, so plan-review's brief showed one of two; breakdown had to move records into the children for their briefs to see them |
| 8 | LIN-4446: plan revised after review | **Half** | Notes became findings, the second plan took them in and ended them, the second verdict rests on the new version. But the first verdict couldn't be superseded, and stale spread over the task |
| 9 | LIN-4469: implementation twice around a review | **Half** | The review's fixes went to close-out and were ended. The first review's real outcome ("Needs Discussion") couldn't be recorded. After the ruling's withdrawal, the autopilot's "merge waits on question-159" stays unflagged: it links the question `about`, not `on` |
| 10 | LIN-4459: asks on silence stay open | **Different** | Close-out closed the ask as answered by LIN-4448's earlier standing agreement (decision-119), which the store held and the ticket's silence hid |
| 11 | LIN-4464: the read has no home | **Failed, happily** | The report landed as a PR, a `change`. And the store let the blind read see that the real blind read had judged the wrong base; the autopilot confirmed it and told close-out not to apply those fixes |
| 12 | The store reader answers more questions right | **Failed** | 20 right against 27 |
| 13 | The store reader uses fewer tokens | **Failed** | About the same; more calls |

## Breaks, each with why

1. **Only the hand-off kinds may have a `to`.** Agents address decisions ("breakdown acts on this"), verdicts ("close-out fixes these first") and changes ("review, look at this PR") as naturally as findings. *Why:* §3.1 limits `to` to three kinds. This is the most likely single cause of the comparison's "addressed to you" misses.
2. **Stale over-fires.** *Why:* it is transitive, it applies to every kind, and any revise counts, including one that only changes `to`. Agents use `on` for "built from", not only "judged". The signal that matters (a verdict or decision resting on a version that moved) is there at every task's end, under noise.
3. **A verdict can't be superseded, and Harbour's review outcomes include "needs-discussion".** *Why:* the kind's ends and outcome set.
4. **A parent's several pieces.** *Why:* `piece` holds one; brief part 2 shows one.
5. **Records addressed to a stage that has run are orphaned.** *Why:* nothing shows them to a later reader except as an index line.
6. **Blindness leaks** through queries and other records' text. *Why:* `blind` applies to the brief only.
7. **A standing direction for an area can't reach future tasks** (John's read on LIN-4446). *Why:* `scope` is a task.
8. **What a stage doesn't write down, no one can read.** *Why:* the store holds records, not the stage's words. The ticket holds both, and won the comparison on detail.

**Listed, not scored:** no `blocked-by` relation between tasks (several stages wanted it); a finding can't end `disproved`; the query log on the real clock; stage-name typos.

## Is the store holding, and is it far better? [my reading]

- **It holds:** every task shape found homes for what happened; decisions and approvals read back as reliably as from the ticket; ownership across tasks works; it caught things the ticket hides (the wrong base, an ask already answered by an earlier agreement).
- **It is not yet far better** by John's bar. A stage starting from the store knows its situation slightly less well than one starting from the ticket, because the store is only as complete as what stages write, and round 5's shape stopped them routing some of it.
- **What would change that** is small, and none of it is workflow: let any record carry a `to`; make stale apply only to verdicts and decisions, directly, on content revisions; let verdicts be superseded and take Harbour's outcomes; show a parent's pieces; carry blindness into queries; let a decision's scope be an area; and keep each stage's own words as its run's account so nothing is lost, with the brief carrying the previous stage's account in full. Then run the same comparison again.
