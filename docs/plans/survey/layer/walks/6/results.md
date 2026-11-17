# Walk 6 results: the comparison done fairly, and across a lane

*17 Nov. Round 6 page (walk 5's shape faults fixed), model built fresh (279 lines; test passes). Walk 5's stores carried over, each run given the stage's own words as its account (`carry.mjs`; all 40 runs found). Eight points: walk 5's six stage starts, and two lane points at the close of LIN-4459 (lane LIN-4447) and LIN-4469 (lane LIN-4448). Three readers per point, each answering the same six questions; the store and ticket-plus-facts readers were fresh, but at the six stage starts the ticket reader's answers, the keys and the questions are walk 5's, reused (corrected 17 Nov, checked with `cmp`); one grader per point against a key written from the full history. Counts [checked, `compare/*/grade*.md`]; readings [my reading].*

## The readers

- **T, the ticket:** the child ticket as Harbour captured it, the parent's description and comments up to then, and at the lane points the area notes as committed. 34,000 to 159,000 characters.
- **S, the store:** the brief (23,000 to 33,000 bytes), then queries.
- **H, the ticket plus facts:** T's ticket, followed by the facts the store computes: open items and who must act, judgements and whether they rest on the current version, area counts, an index.

## Scores (48 questions)

| | T: ticket | S: store | H: ticket + facts |
|---|---|---|---|
| Six stage starts (36) | 27 right, 8 partly, 1 wrong | 23 right, 13 partly | 26 right, 10 partly |
| Two lane points (12) | 11 right, 1 partly | 6 right, 6 partly | 10 right, 2 partly |
| **All 48** | **38 right, 9 partly, 1 wrong** | **29 right, 19 partly** | **36 right, 12 partly** |

Walk 5's store reader, on the six stage starts without the stages' words: 20 right. With them: 23.

## What the scores say [my reading]

1. **A capable model reads a long ticket well.** Up to 159,000 characters of child, parent and notes, the ticket reader was right 38 times in 48 and wrong once. At these sizes, reading the whole history is not where things go wrong.
2. **The store alone knows less than the ticket.** Its misses are what earlier stages left out or left open: items never made into records, findings never ended (so the store says "open" when the narrative shows them done), owners guessed. Records assert state; prose lets a reader see what happened. At the lane points the parent and siblings were seeded from their tickets by an agent, so the same losses apply.
3. **Adding the computed facts to the ticket did not help.** H tied T at four points, lost by one at four; it was never wrong, and twice the facts misled it (findings left open, an owner guessed).
4. **Stale is now quiet** [checked]: at most one flag per brief, each a verdict or decision on a version that moved. Approvals against the current head were answered right by all three readers nearly every time.
5. **Expectations** (`expect.md`): 1 failed (23 against 27), 2 held, 3 failed (the ticket reader was ahead across a lane too), 4 held (the store reader reads a fifth to a sixth as much at the lane points), but reading less bought no accuracy.

## What this means for the idea

*Corrected 17 Nov.* This section first read the reading comparison as a verdict on the design ("the evidence says no"). The comparison measured reading, not whether the structure holds the data, and is set aside (log, "John on walk 6: back to the point"). What walk 6 shows about the design is point 4 above: stale is now quiet. Round 6's write side is untested, since no stage wrote through it here.

## Artefacts, noted

- One stage's words in LIN-4450 (the leftover's) carry a later commit date, so the review-point brief hinted at the future; the store reader noticed and set it aside.
- In LIN-4469 the leftover's commit is recorded a few seconds before the second review starts, though it landed after; it cost the store reader one answer at that point and the ticket-plus-facts reader none.
- The lane-4459 area notes are from the PR's own commit, so they already show its edits; all readers saw the clash and said so.
- The parents' descriptions are as they stand today; readers were told so and used comments up to the moment.
