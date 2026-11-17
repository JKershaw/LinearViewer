# Answers: Reader S (store), close-out on task-9 (LIN-4446), as of 2026-11-13T15:14:56Z

Read: brief.txt (`brief close-out --task task-9` form), questions.md, BUILD-NOTES.md; queries with `--by close-out` on the folder's store.json: `show --task task-9`, `get change-53 / verdict-60 / finding-55 / check-17 / run-56 / run-59 / run-62 / finding-66 / finding-67`, `find --text ledger|swipe|viewport|"did not prove"|discharg`, `find --kind decision`.

## 1. What is addressed to this stage to act on?
Three fix-sized items, all before merge:
- **finding-61** (review): update PR #2423's body, which is stale after 1de016f52: add the swipe viewport leftover retirement (LIN-4414) under "What changed"; replace "Total: 30 files, +747 / -280" with the real figures from `gh pr view 2423` (35 files at 1de016f); in "Not covered", replace "serving tests not run against HEAD" with the reviewer's mutation sentence.
- **finding-64** (blind-read): in tests/unit/cost-format-consumers.test.js, reword "the browser copy's words" / "The browser copy's fine mode" to "the shared formatter's words".
- **finding-65** (blind-read): in tests/unit/cost-format.test.js, drop the "parity comparison it used to carry is retired" sentence and the unused `export const TABLE`.
Plus, from verdict-60 and check-17 (to John): after merge and deploy, ask John to read slice 1 and record his read on LIN-4446 before marking Done.
*Source:* brief part 3; verdict-60 reasoning; check-17@3 `how`.

## 2. What is still open on the task, and whose is each item?
- change-53 (PR #2423): open, not merged. Close-out merges it.
- finding-61, finding-64, finding-65: open, to close-out.
- check-17: open, to **John** (read slice 1 before the next slice).
- finding-12: open, to area-1 (common.js globals; left out of the slice).
- finding-14, finding-20, finding-31: open, to review (how to count "lighter"). The review's verdict appears to have dealt with them, but none was ended in the store.
- finding-47, finding-48, finding-50: open, to implementation. These are build notes the PR appears to have acted on, but none was ended in the store.
- Blind-read's finding-66 and finding-67 are open too, but they belong to area-1 rather than the task.
*Source:* `show --task task-9` (state and `to` of each record); get finding-66/67.

## 3. The swipe viewport fix beyond the plan: what was decided, does it still hold?
Review's judgement (verdict-60, run-59): it is the leftover step's sanctioned retirement under LIN-4414 ("One home for each leftover"), not an overrun, so **no ruling is needed**. It retires the docs/areas/front-end-pages.md Waiting entry, and a test failed before the fix. It still holds: verdict-60 stands and no later record contradicts it. The only follow-up is that the PR body omits it, and finding-61 covers that. There is no separate decision record; the only decision in the store is decision-26 (size).
*Source:* verdict-60 reasoning; run-59 account; run-56 account; finding-61; `find --kind decision`.

## 4. Does an approval cover the work at its current head?
**Yes.** change-53's latest head is 1de016f52 (v2, 14:56:27). verdict-60 (review, approve-with-notes, 15:07:31) approves "PR #2423 at 1de016f52", on change-53@2, and nothing was revised after it. The blind-read (verdict-63, "better") is also at 1de016f52. The approval is conditional on close-out discharging the PR-body fix and John's read. The store flags verdict-60 as "stale", but that comes only from the chain plan-28@13 → verdict-35, which plan-28 was revised in answer to. It is not a new head. If close-out pushes the fixes for finding-64 and finding-65, the head moves past what was approved.
*Source:* get change-53 (versions); get verdict-60; verdict-63 in brief part 4.

## 5. How many items are in the review's "What CI Did Not Prove" ledger, and how many are discharged?
**Can't tell exactly.** The store has no record by that name. The closest evidence:
- finding-55's two waiver gaps (serving tests not re-run at HEAD; no e2e witness of the Chart.js fix) are both discharged by review (ended 15:07:34).
- verdict-60 says the approval is "conditional on close-out discharging the ledger (PR-body fix, John's read)", so at least two ledger items are still undischarged.
If the ledger is those four items, then 4 items with 2 discharged. That is inference, not something the store states.
*Source:* get finding-55 (ended reason); verdict-60 reasoning; `find --text "did not prove"` found nothing.

## 6. Is John's read a condition for merging, for marking Done, or neither? Has it happened?
**A condition for marking Done, not for merging.** check-17@3 (revised by review at 15:07) says: "After merge and deploy, before the ticket closes: close-out asks John to read … records his read as a comment on LIN-4446 before marking Done … Not a merge condition." It also gates the next slice. **It has not happened yet**: check-17 is still open, to John.
*Source:* get check-17 (v3 `how`, and v1 for the earlier wording); run-59 account ("John read settles after merge, before Done").
