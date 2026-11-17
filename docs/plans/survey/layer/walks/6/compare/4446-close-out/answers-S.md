# Answers, Reader S (store): LIN-4446 close-out (task-9), as of 2026-11-13T15:14:56Z

Read: `brief.txt`, `questions.md`, `model/BUILD-NOTES.md`; queried `store.json` with `show --task task-9`, `get` (check-17, change-53, finding-49, finding-55, run-52, run-56, run-59), `find --text swipe`, `find --kind decision`, `find --to John`, `find --in area-1 --state open --count`, all `--by close-out`.

## 1. What is addressed to this stage to act on?
Three findings `to close-out`, all on PR #2423 before merge:
- **finding-61** (review): fix the stale PR body. Add the swipe leftover-step retirement under "What changed", replace "Total: 30 files, +747 / -280" with the `gh pr view 2423` figures on the merged head (35 files at 1de016f), and in "Not covered" replace "serving tests were not run against HEAD" with the reviewer's mutation sentence.
- **finding-64** (blind-read): in `tests/unit/cost-format-consumers.test.js`, reword "the browser copy's words" / "The browser copy's fine mode" to "the shared formatter's words".
- **finding-65** (blind-read): in `tests/unit/cost-format.test.js`, drop the "parity comparison it used to carry is retired" sentence and the unused `export const TABLE`.
Also from review's ledger (verdict-60, check-17 `how`): after merge and deploy, ask John to read the result and record his read as a comment on LIN-4446 before marking Done.
The brief's part 3 also lists finding-14/20/31 (to review) and finding-47/48/50 (to implementation). They are not addressed to close-out. They are shown because they were left open after those stages finished.
*Source:* brief part 3; `get check-17`; run-59 "Fixes for close-out" and the ledger.

## 2. What is still open on the task, and whose is each item?
- finding-61, finding-64, finding-65: close-out's (above).
- check-17: John's. He has to read slice 1 before the next slice starts.
- change-53: PR #2423, open (not merged), head 1de016f52. Close-out merges it.
- finding-14, finding-20, finding-31: addressed to review, all still open. They cover how to count comments when judging "lighter". Review's verdict says lighter on IIFE vs shim, but none of the three was ended.
- finding-47, finding-48, finding-50: addressed to implementation, still open in the store. Implementation finished and the review says the diff matches the plan, so they look done in the PR, but none was ended. From the store I can't tell for sure that each was carried out.
- finding-12: addressed to area-1 (front-end browser area), open. It is kept out of this slice.
*Source:* `show --task task-9` (states and `to`); brief parts 3 and 7.

## 3. The swipe viewport fix beyond the plan: what was decided, and does it still hold?
Review decided it is the builder's sanctioned leftover-step retirement under `docs/areas/README.md` "One home for each leftover" (LIN-4414). It retires the `docs/areas/front-end-pages.md` Waiting entry `lib/render-swipe.js: the viewport meta is user-scalable=no`, with a witness in `tests/unit/render-swipe.test.js`. So it is not an overrun and needs no ruling from John. It still holds: verdict-60 stands and is not stale. The one thing missing is a mention in the PR body, which finding-61 asks close-out to add. No separate decision record exists; the decision lives in verdict-60 and the review's account.
*Source:* run-59 "Scope vs plan"; verdict-60 reasoning; run-56 `Retires:` line; finding-61.

## 4. Does an approval cover the work at its current head?
Yes. verdict-60 (review, approve-with-notes) is on change-53@2, whose head is `1de016f523f…` (the same commit), and it carries no STALE flag. The approval is conditional on close-out working through the ledger: the PR-body fix and John's read. blind-read's verdict-63 ("better") is also at 1de016f52. Caveat: committing finding-64/65 creates a new head that no verdict has seen.
*Source:* brief part 4; `get change-53`; run-59 header.

## 5. How many items are in "What CI Did Not Prove", and how many are discharged?
Three items. One was discharged before merge: the Chart.js/shim/CSP deferral on a priced workspace, by the reviewer's real-browser check. The other two are open:
- John's read: settled after deploy, before Done.
- Non-Chromium behaviour: not proven; a rollback is named (revert the merge commit).
*Source:* run-59 "What CI Did Not Prove".

## 6. Is John's read a condition for merging, for marking Done, or neither? Has it happened?
It is a condition for marking Done, not for merging. The next slice is also held until he has read it. Merging is what "the first slice has landed" asks for. It has not happened yet: check-17 is open (v3, revised by review at 15:07:33), and the store has no record of John's read.
*Source:* `get check-17` (`how`); run-59 ledger item 2.
