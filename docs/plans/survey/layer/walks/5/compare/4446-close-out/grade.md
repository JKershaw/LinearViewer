# Grade: LIN-4446, close-out (2026-11-13T15:14:56Z)

| Q | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **partly**: has all three parts of the PR-body fix, John's read, the merge and the two blind-read fix-sized items. Leaves out deploy and the blind read's two larger items (bridge, ship copies). Hedges on whether the blind-read items are close-out's. | **partly**: has all three parts of the PR-body fix (finding-61), both blind-read fix-sized items (64, 65) and John's read after merge and deploy. Leaves out the blind read's two larger items and does not list the merge as an action here (it does in Q2). |
| 2. Open items and owners | **partly**: PR body and merge go to close-out, and John's read to John, both correct. Says "can't tell" for the owner of the blind-read fix-sized items (key: close-out). Calls the larger items "area-note material", which is close. Leaves out non-Chromium (unverified, with a rollback). | **partly**: assigns the merge, the PR-body fix and the blind-read fix-sized items to close-out, John's read to John, and the larger items (66/67) to the area. All correct. Leaves out non-Chromium. Lists extra open records (12, 14/20/31, 47/48/50) that the key doesn't count, though it flags 14/20/31 and 47/48/50 as probably already dealt with. |
| 3. Swipe viewport decision | **right**: sanctioned leftover retirement under LIN-4414, no ruling needed, still holds, and the PR body must name it. | **right**: same ruling, still holds, and the PR body must name it (finding-61). |
| 4. Approval at current head | **right**: yes, conditional, at `1de016f`, which is still the head. Any new commit moves the head. | **right**: yes, conditional, at `1de016f52`, which is still the head. Explains the "stale" flag correctly. Fix commits would move the head. |
| 5. Ledger count / discharged | **right**: 3 items, 1 discharged (chart), and names the 2 that remain. | **can't tell**: says it can't tell exactly. The inference it offers (4 items, 2 discharged) does not match the key's 3 and 1. |
| 6. John's read: merge or Done? happened? | **right**: a condition for Done, not for merging, and it also gates the next slice. It has not happened. | **right**: a condition for Done, not for merging, and it also gates the next slice. It has not happened (check-17 is still open). |

## Totals

- **Reader T:** 4 right, 2 partly, 0 wrong, 0 can't tell.
- **Reader S:** 3 right, 2 partly, 0 wrong, 1 can't tell.
