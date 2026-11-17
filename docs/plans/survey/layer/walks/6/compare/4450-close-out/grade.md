# Grade: LIN-4450 close-out (as of 2026-11-13T15:21:56Z)

Graded against `key.md` only.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to close-out | **partly**: names the test fix, the conditional verdict tied to the ledger, and all three blind-read items. But it says it can't tell whether close-out must fix the blind-read items, which the key assigns to close-out. It also doesn't mention that merging unblocks LIN-4451. | **partly**: names the test fix and all three blind-read items as close-out's. But it calls the test fix the verdict's "one condition" and misses that the verdict is conditional on close-out discharging the ledger. It doesn't mention that merging unblocks LIN-4451. |
| 2. Still open, and whose | **partly**: these match the key: test fix to close-out, the three checks to LIN-4452, LIN-4451 blocked, and the bulk-read decision in a providers.md Waiting entry. But it gives the blind-read items no owner (the key says close-out). It gives the merge to review and the orchestrator (the key says close-out). It also omits createIssue→holdAsAsked going to LIN-4451. | **partly**: these match the key: test fix and blind-read items to close-out, the checks to LIN-4452, and createIssue plus the LIN-4451 block to LIN-4451. But it misses the bulk-read decision and its Waiting entry, and doesn't say close-out owns the merge and deploy. It adds area items (finding-79/80) that are not in the key. |
| 3. Empty-fence decision | **right**: "met in substance": no rich-content rule changed, only the empty-fence codec-shape rule, declared in Size of the move and on LIN-4445, and it still holds. | **right**: same substance ("met in substance", only the empty-codeBlock shape rule changed), and it still stands. |
| 4. Approval vs current head | **right**: approved at `f9fa4a80c`, which is still the head. The approval is conditional, and a close-out push would not be re-reviewed. | **right**: verdict on change-84@2 = `f9fa4a80c`, which is still current. The approval is conditional, and a later push would not be re-reviewed. |
| 5. Ledger count | **right**: 3 checks, 0 merge conditions, and the rollback is not a check. | **right**: 3 checks, none of them merge conditions. |
| 6. Leave audit.js:35 alone? | **wrong**: it concludes "close-out may leave it alone", the opposite of the key's "No". It gets the keep-the-local-arm fix form right, but leaves whether close-out should act as "can't tell". | **right**: the answer is "not necessarily", because blind read's finding-105 is open and addressed to close-out. Only the token half moves to `isHermeticTestToken`, the local arm stays, and the readings don't conflict. |

## Totals

- **Reader T:** 3 right, 2 partly, 1 wrong, 0 can't tell.
- **Reader S:** 4 right, 2 partly, 0 wrong, 0 can't tell.
