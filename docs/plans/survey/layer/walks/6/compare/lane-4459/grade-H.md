# Grade: Reader H, lane LIN-4447 at LIN-4459's close-out (2026-11-13T17:04:57Z)

Graded from `key.md`, `answers-H.md` and `grade.md` only, on the same standard `grade.md` used for Readers T and S.

| # | Question | Reader H |
|---|---|---|
| 1 | Open across the lane, and whose | **right**: covers every key item. It has the full LIN-4459 close-out ledger: (a) the Retires bullet is finding-161, (b) the LIN-4448 coordination is check-156, (c) CI on the merged commit is check-157, (d) the monitor and rollback is check-158, and (e) the post-deploy check or "not yet observed" is check-159. It has both blind-read fix items, though it words the `runFact` one as "one local mapping" where the key says two mappings; that reads as describing the fix. It has LIN-4458 in build with the 16:42 calls (it does not say outright that no PR is open), the chain from LIN-4460 to 4461 to 4462, the parent's finding "left for a person", LIN-4453 Done and pieces 3, 5, 6 and 7 landed. |
| 2 | Asks to LIN-4448 and replies | **right**: all three asks are there. The seam moves were answered in 08c9c898 and corrected in 097a3442, with the LIN-4465 collision. The renewed asks 1a2e7cba and 0510ffe0 have no reply, and LIN-4458 is not waiting. It also has the runner-kickoff item still to tell and both ways to discharge it. |
| 3 | Piece 4's terminal method: overridden, and what stands | **right**: the plan used `resolveFollowUpRoot`/`heldWakeHolderOf`. It was overridden in d3553049 because those are async walks that go up, one row at a time. What stands is the batched `listHistory({ withLineage: true })` through `deriveLineageFields`, and only a row parked `[pending]` takes it. The review agreed, and the area-notes Lesson reflects it. |
| 4 | Waiting entries now, and which the lane settled | **right**: 18. Settled are 2, 4, 11, 8, 9 and 19, and 14 is in PR #2432, gone only on merge. It lists the lane's added entries and the swap of 14 for the compare-and-set entry, so the count is 18 either way. It names the LLM-side runner-kickoff retirement only under Q2 and leaves out the two live-wait removals, which is minor. |
| 5 | John's decisions that still hold | **right**: it has the passenger rule, R1 both, the recommend-path cut, both repos (piece 8) and the piece sizes. It says nothing is held for a ruling and that the piece-0 sampling question was an engineering call. It correctly says the "not parked but blocked" finding is not raised as a ruling. It cites Waiting 12 as "not yet ripe" rather than Waiting 10 as an engineering call, but that does not contradict the key. |
| 6 | Is LIN-4460 still held for John? | **right**: no, the Breakdown's hold was released once the rulings were answered. It waits on LIN-4458 and LIN-4459, a recorded Approve and the piece-0 baseline, which is already met. The extra LIN-4466 rebase note does not contradict the key. |

## Totals

- **Reader H:** 6 right, 0 partly, 0 wrong, 0 can't tell.
