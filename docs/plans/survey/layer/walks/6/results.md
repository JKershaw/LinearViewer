# Walk 6 results: the comparison done fairly, and across a lane

*17 Nov. Round 6 page (walk 5's shape faults fixed), model built fresh (279 lines; test passes). Walk 5's stores carried over, each run given the stage's own words as its account (`carry.mjs`; all 40 runs found). Eight points: walk 5's six stage starts, and two lane points at the close of LIN-4459 (lane LIN-4447) and LIN-4469 (lane LIN-4448). Three readers per point, each fresh, each answering the same six questions; one grader per point against a key written from the full history. Counts [checked, `compare/*/grade*.md`]; readings [my reading].*

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

## What this means for the idea [my reading]

- **As a replacement for the ticket as what agents read:** the evidence says no. The store is as good only where stages record and close everything; the ticket keeps everything without anyone having to. This is not a test artefact any more: with the stages' own words in the store, it still trails.
- **What the store does do that the ticket doesn't:** every record has an owner and a state that code can read; counts and approvals against the current head are computed, not copied; briefs stay a fixed size as the history grows; an answer, a withdrawal or an override lands once and everything resting on it can be flagged. Those are benefits to **Harbour's code** (gates, counts, views, what to wake) and to cost, not to an agent's understanding.
- **So the honest shape** is smaller than the design page: keep the text as what agents read, and keep a small typed layer beside it for what code must track (who owns an open item, open or ended, which version a judgement rests on, counts), written by the same stages. That is roughly what Harbour's rulings and PR state already are. Whether that layer is worth building is a different question from the one walks 1–6 set out to answer, and it is John's.
- **The leaks** the traces showed (notes growing, counts drifting, things with no home) still need an answer. The store showed it can hold those without growing; what these walks show is that a long text is not what confuses a capable reader. If the leak is real, it is in what gets written and kept (lists, rules, unended items), not in where.

## Artefacts, noted

- One stage's words in LIN-4450 (the leftover's) carry a later commit date, so the review-point brief hinted at the future; the store reader noticed and set it aside.
- In LIN-4469 the leftover's commit is recorded a few seconds before the second review starts, though it landed after; it cost the store reader one answer at that point and the ticket-plus-facts reader none.
- The lane-4459 area notes are from the PR's own commit, so they already show its edits; all readers saw the clash and said so.
- The parents' descriptions are as they stand today; readers were told so and used comments up to the moment.
