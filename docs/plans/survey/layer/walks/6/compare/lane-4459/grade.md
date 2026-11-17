# Grade: lane LIN-4447 at LIN-4459's close-out (2026-11-13T17:04:57Z)

Graded from `key.md`, `answers-T.md` and `answers-S.md` only.

| # | Question | Reader T | Reader S |
|---|---|---|---|
| 1 | Open across the lane, and whose | **right**: covers every key item. It has the LIN-4459 close-out ledger (a) to (e) and the blind-read fix items. It has LIN-4458 in build with calls posted and no PR, the blocking chain LIN-4460, then 4461, then 4462, the parent's finding "left for a person", and LIN-4453 to 4457 as done or landed. | **partly**: the LIN-4459 ledger, LIN-4460's block, the parent finding and the done pieces are right. But it says it "can't tell" LIN-4458's progress or owner, while the key has it in build with calls posted and no PR. Piece 8 and the repeat read appear only as plan items "to come". LIN-4461 is not named, and the 4460, 4461, 4462 chain is missing. |
| 2 | Asks to LIN-4448 and replies | **right**: all three asks are there. The seam moves were answered in 08c9c898, with the 097a3442 correction. The renewed asks 1a2e7cba and 0510ffe0 have no reply. It also has what is still to tell about runner-kickoff and the two ways to discharge it. | **partly**: the seam moves (answered), 0510ffe0 (no reply) and the runner-kickoff item still owed are right. It misses LIN-4458's renewed ask, 1a2e7cba (no reply). |
| 3 | Piece 4's terminal method: overridden, and what stands | **right**: the plan used `resolveFollowUpRoot`/`heldWakeHolderOf` (note 5). It was overridden in d3553049 because those walks go up, one row at a time, and are async. What stands is the batched `listHistory({ withLineage: true })`, which only a stage parked `[pending]` takes. Review agreed. | **right**: same substance, citing plan-91, decision-145 (d3553049) and verdict-162 agreeing. Only a stage parked `[pending]` is judged by its lineage, and what stands is the batched read. |
| 4 | Waiting entries now, and which the lane settled | **right**: 18. Settled are 2, 4, 11, 8, 9 and 19, and 14 is in PR #2432, not merged. It notes the LLM-side removals. It flags that the area note already shows the swap of 14 for the compare-and-set entry, and the count is still 18. | **right**: 18. Settled are 2, 4, 11, 8, 9 and 19, and 14 waits on the merge. The swap of 14 for the compare-and-set entry keeps the count at 18. It notes the LLM-side removals. |
| 5 | John's decisions that still hold | **right**: it has the passenger rule, R1 both, the recommend-path cut, both repos (piece 8) and the piece sizes. It says nothing is held for a ruling, and that Waiting 10 and the piece-0 sampling question were engineering calls. | **partly**: the decisions are all right (the cut, R1 both, both repos, passenger, piece sizes). But it says finding-146 is "awaiting him", while the key says nothing is waiting for John. That finding is "left for a person", with no ruling raised. |
| 6 | Is LIN-4460 still held for John? | **right**: no, the hold was removed at 15:34 after the rulings. It waits on LIN-4458 and LIN-4459, a recorded Approve, and the piece-0 baseline, which is already met. | **right**: no, the plan v3 hold is "none". It waits on LIN-4458 and LIN-4459 and then its own review. It omits that the piece-0 baseline is met, which is minor. |

## Totals

- **Reader T:** 6 right, 0 partly, 0 wrong, 0 can't tell.
- **Reader S:** 3 right, 3 partly, 0 wrong, 0 can't tell.
