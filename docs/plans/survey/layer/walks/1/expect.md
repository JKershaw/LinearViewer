# Walk 1: what the design predicts, written before looking

*Written 17 Nov, before the model is built or the task filled, from `design.md` at `fda3553b0` and trace 1 (peaceful-euler). Committed before any later step. Each line is a prediction [my reading]; after the walk each is marked **held**, **failed** or **can't tell**, with why.*

*Trace 1 rows are cited as R1–R16.*

## Fit

1. **Every row finds a place.** R7 (the change) sits outside by design, linked from records. R16 (run records) stays outside because `run` isn't built this round. R15 (the prune) becomes nothing: there is no prune, and the plan's versions keep what it removed. No other row is unplaced.
2. **Kinds used.** Roughly: 2 `task`, 1 `plan` with at least 2 versions, 6–12 `finding`, 1–3 `check`, 0 `question`, 2–5 `decision`, 2–3 `verdict`, 4 `lesson`, 1–2 `area`.
3. **Where a kind strains.**
   - **R1, John's standing direction** ("Settle engineering questions yourself"): with no `setting`, it lands as a `decision` with basis `policy`, or unplaced. This is where `setting` is missed.
   - **R2, the child's ask:** the doc's rule (a child links to its plan piece) handles it cleanly. The filler doesn't put the breakdown's words in `asked`.
   - **R12, the review's 10,993 characters:** a `verdict` plus several `finding`s. Its "exact right/wrong conditions" for the live check overlap with the `check`'s `how`, and the overlap is recorded twice or linked.
   - **R10's `Retires:` line:** the retired entry is a `finding` ended `done`. Why an unrelated sweep was pulled in is a prompt rule, outside the layer.

## Retelling

4. **The bulk-path gap** (six retellings today) becomes **one** `finding` addressed to the `providers` area, with at most two `same-as` links where later stages raise it again. A **break** if it becomes three or more unlinked findings.
5. **The live probe** (proposed, then "not verified", then "not run", a PR comment, a piece of its own) becomes **one to three `check`s** addressed to John, open at close-out. A **break** if the filler can't keep it as one thread and it scatters across findings.

## Rules (logged as hits; retro mode)

6. **Rule 1 does not hit at close-out.** The open checks are addressed to John and the bulk-path finding to the area, not to the task. So the task closes while they stay open and handed on, as happened, but as single records instead of retold text. A **design question either way:** should a task close over a check it raised?
7. **Rule 2 does not hit** if the filler writes the five departures as the plan's next version, which the doc invites. It hits if they are written as findings that end as built differently. Either way, the departures sit on the plan, not beside it.
8. **Rule 4 hits if** close-out's fixes after approval moved the PR head: the review's and blind read's verdicts go stale. That is "nobody re-reads these" made visible. If the fixes landed without a new head on record, it can't tell.
9. **Rules 3, 5 and 6:** no hits from 3 (no questions). 5 and 6 hit only on the filler's own slips.

## Out: the briefs

10. **Each stage's brief carries much less than today's text.** Today a stage could read LIN-4450's description plus pointers into LIN-4445's description (20,805 characters), design (12,934) and plan review (6,851). Each brief should carry the ask, its plan piece, and a handful of open records. Size is reported, not judged.
11. **At least one stage's brief lacks something it used.** Most likely the implementation stage: if the plan piece holds only the slice, the design's reasoning isn't in it. A **break** if the brief lacks detail from the plan that the build used, and **why** matters: is the `plan` kind too thin, or the brief's rule too narrow?
12. **Review and close-out need the diff,** which is outside. Their briefs link to the PR and don't hold it. Not a break.

## Guesses

13. **Fewer guessed addressees than the Yap spike** (34 of 71): Harbour's stage outputs already carry headings like "better still, not this task's" and "Not verified". Roughly 20–40% guessed.

## John's four choices

14. **`ask`:** no lane traffic in this task, so no evidence either way.
15. **who is working:** one stage at a time, so no evidence.
16. **measure:** the filler reaches for a measured value at least twice (the test counts, the size guard's 32,768 bytes, the cost) and has to put it in prose.
17. **Candidates:** `verdict` used 2–3 times, `lesson` 4, `area` 1–2. `run` missed at R16, `setting` missed at R1 and R6.

## What would count as a break

Each reported with why it broke:
- a row with no home that should have one;
- a kind taking unlike pieces;
- a retold thing that stays scattered (4, 5);
- a brief missing what its stage used (11), or carrying what it didn't need;
- a rule that would have refused something that was right.
