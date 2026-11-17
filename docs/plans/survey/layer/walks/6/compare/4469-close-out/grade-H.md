# Grade: LIN-4469, close-out, Reader H, as of 2026-11-13T23:26:58Z

Read: `key.md`, `answers-H.md`, `grade.md` only. Same standard as `grade.md` used for T and S.

| # | Reader H (ticket plus facts) |
|---|---|
| 1. Addressed to this stage | **partly**: has Fixes 1–2, the re-render before merge, and four of the blind read's finds. It leaves out the post-deploy 403 checks (it gives them to John in Q2), says it can't tell who owns the other two fix-sized finds when the key gives them to close-out, and adds finding-153 (lesson-10 wording), which the key does not have. |
| 2. Still open, and whose | **partly**: has the close-out items and merge, simple-dispatcher's copies (its owner's), and no John ruling open. It gives the 403 checks to John where the key names no owner, sends the blind read's two larger finds to areas instead of close-out, and adds check-148 for review, which the key does not have. It misses LIN-4350, LIN-4470 and the Survey completion criteria. |
| 3. Merge waits on `lin-4469-witness`? | **right**: No. Withdrawn as moot at 23:17Z, never answered. Merge now waits on the ledger (Fix 1 with the re-render, and Fix 2), not on John. |
| 4. Approval at current head | **right**: Head `877f32cb4`, CI green. The conditional Approve is at `05b592742` (stale, two header tidies since). The blind read's "better" is not an approval, and the ledger is not discharged. |
| 5. Blind read counts | **right**: 6 fix-sized, 2 larger, 0 outside. |
| 6. Render after Fix 1; `FROZEN_TOTAL_BYTES` | **right**: 827520 → 825278 (−2242), seams-tangles −2, wrong if any non-`work` kind or Periodical with folded text is at ≥0. Stays 396064, since `periodicals.js` is in no budgeted ceiling. |

## Totals

- **Reader H:** 4 right, 2 partly, 0 wrong, 0 can't tell.

H falls short on Q1 and Q2 in the same way S does. It makes owner claims the key does not support: the 403 checks go to John, and the blind read's larger finds go to areas. It also adds items the key does not have (finding-153, check-148) and misses LIN-4350, LIN-4470 and the Survey criteria. Like T, it hedges on two of the blind read's fix-sized finds.
