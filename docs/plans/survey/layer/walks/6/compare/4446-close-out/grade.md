# Grade: LIN-4446, close-out

Read: `key.md`, `answers-T.md`, `answers-S.md`.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **Partly.** Has the PR-body fix with all three parts, John's read, and merge. It lists the blind read's fix-sized items but hedges that they are "not addressed to close-out by name". It leaves out deploy and the two larger items (the bridge, the `ship.js` copies). | **Partly.** Has the PR-body fix, both blind-read fix-sized items addressed firmly to close-out, and John's read "after merge and deploy". It does not list merge or deploy as actions here, though Q2 says close-out merges. It leaves out the two larger items. |
| 2. Open items and owners | **Partly.** Gets the PR body, merge, John's read and the next-slice block right. It says "can't tell" who owns the fix-sized items (the key says close-out). It guesses the larger items "look like area-note material" (the key says Waiting entries). It leaves out non-Chromium, which is unverified with a rollback. | **Partly.** Gets the close-out findings, John's read and the merge right. It adds findings 14/20/31 and 47/48/50 as "still open", which are not open in the key (it does hedge on 47/48/50). It does not place the larger blind-read items as Waiting entries and leaves out non-Chromium. |
| 3. Swipe viewport decision | **Right.** It is a sanctioned leftover retirement under LIN-4414, not an overrun, it still holds, and the PR body must name it. | **Right.** Same ruling. It also names the retired Waiting entry and its witness, and says it still holds with the PR-body mention still owed. |
| 4. Approval at current head | **Right.** It is a conditional approve at `1de016f`, still the head, and new commits would move past it. Its caveat that it can't confirm the live head does not change the answer. | **Right.** It is a conditional approve on `1de016f`, not stale, and committing the fixes makes a head no verdict has seen. |
| 5. Ledger count | **Right.** 3 items, 1 discharged (chart/shim/CSP), with John's read and non-Chromium (rollback named) remaining. | **Right.** Same count and the same breakdown. |
| 6. John's read: merge or Done condition | **Right.** It is a Done condition, not a merge condition, it also gates the next slice, and it has not happened. | **Right.** Same. It also says merging is what "landed" asks for, and it has not happened. |

## Totals

- **Reader T:** 4 right, 2 partly, 0 wrong, 0 can't tell.
- **Reader S:** 4 right, 2 partly, 0 wrong, 0 can't tell.

Where they differ inside the "partly" marks: S puts the blind-read fix-sized items with close-out, where T can't tell. But S lists stale findings (14/20/31, 47/48/50) as open, which T avoids. Both miss deploy, where the larger blind-read items go, and non-Chromium in Q2.
