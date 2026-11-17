# Grade: LIN-4469, close-out, as of 2026-11-13T23:26:58Z

Graded against `key.md`, using only `answers-T.md` and `answers-S.md`.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **partly**: gets Fix 1, Fix 2, the re-render before merge, and the post-deploy 403 checks after the deploy. Says "can't tell" whether close-out takes the blind read's finds, but the key gives them to close-out. | **partly**: gets Fix 1, Fix 2 and the re-render, plus 4 of the 6 blind-read fix-sized finds. Leaves out the merge, the post-deploy 403 checks and blind-read finds 177/178. Adds finding-153 (lesson-10), which the key does not have. |
| 2. Still open, and whose | **partly**: Fixes and merge go to close-out, the 403 checks have no owner, simple-dispatcher's copies go to that repo's owner, and no ruling is open. Leaves the blind-read finds "unassigned/possibly close-out's", and leaves out LIN-4350, LIN-4470 and the Survey completion criteria. | **partly**: PR open and the close-out items are right. Gives the 403 checks to John, but the key says no owner is named. Sends blind-read finds 177–180 to areas, but the key gives them to close-out to fix or give a home. Leaves out simple-dispatcher, LIN-4350, LIN-4470 and the Survey criteria. Adds check-148 and finding-147, which the key does not have. |
| 3. Does `lin-4469-witness` still gate merge | **right**: no, withdrawn as moot at 23:17Z and never answered. Seams +24 is covered by no ruling and Fix 1 removes it. | **right**: no, withdrawn as moot and never answered. Merge now waits on the ledger, and seams +24 is removed by Fix 1. |
| 4. Approval on current head | **right**: the conditional Approve was given at `05b592742`, the head is `877f32cb4` (tidies, CI green), the blind read's "better" is not an approval, and the Fixes are not made yet. | **right**: same facts. The conditional approve was given at `05b592742` and is now stale, the head is `877f32cb4` with CI green, and the blind read's verdict is not a merge approval. |
| 5. Blind-read counts | **right**: 6 / 2 / 0. | **right**: 6 / 2 / 0, and it names both larger finds correctly. |
| 6. Render after Fix 1, `FROZEN_TOTAL_BYTES` | **right**: 827520 → 825278 (−2242), seams −2, and fail if any folded-text render is ≥0. `FROZEN_TOTAL_BYTES` stays 396064. | **right**: 827520 → 825278 (−2242), seams −2, and the same fail rule. `FROZEN_TOTAL_BYTES` stays 396064. |

## Totals

- **Reader T:** 4 right, 2 partly, 0 wrong, 0 can't tell.
- **Reader S:** 4 right, 2 partly, 0 wrong, 0 can't tell.

Both readers miss the same things: who owns the blind-read finds, and the items outside the task (LIN-4350, LIN-4470, the Survey criteria). Within its "partly" on Q2, S makes one real error: it names John as owner of the 403 checks, where the key says no owner is named. T hedged on Q1 and Q2 instead of asserting anything wrong.
