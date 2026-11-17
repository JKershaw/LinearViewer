# Grade: LIN-4469, close-out, as of 2026-11-13T23:26:58Z

Read: `key.md`, `answers-T.md`, `answers-S.md` only.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **partly**: has Fixes 1–2, the re-render, and the 403 checks after the deploy, matching the key. But it says it can't tell whether close-out takes the blind read's finds, and the key says close-out must handle them. | **partly**: has Fixes 1–2, the re-render, and four of the blind read's finds. It leaves out the post-deploy 403 checks and puts them on John, though the key says the review names no owner. Its extra finding-153 (lesson-10 wording) is not in the key. |
| 2. Still open, and whose | **partly**: has Fixes and merge (close-out), the 403 checks with no owner, the blind read's 6+2 finds, simple-dispatcher's copies (that repo's owner), and no ruling open. It leaves the blind read's finds unassigned, though the key gives them to close-out to fix or give a home. It misses LIN-4350, LIN-4470 and the Survey completion criteria. | **partly**: has the close-out items and says question-159 is withdrawn. It gives the 403 checks to John and the blind read's two larger finds and two of its fix-sized finds to areas, where the key gives the checks no owner and the finds to close-out. It misses simple-dispatcher's copies, LIN-4350 and LIN-4470. |
| 3. Merge waits on `lin-4469-witness`? | **right**: No. Withdrawn as moot at 23:17Z and never answered. Fix 1 removes the seams +24. Merge now waits on the ledger. | **right**: Same answer and reasons. Merge waits on the ledger, not on John. |
| 4. Approval at current head | **right**: The conditional Approve is at `05b592742` and the head is `877f32cb4` (tidies not re-reviewed). The blind read's "better" is not an approval, and the ledger is not yet discharged. | **right**: Same heads and conditional verdict, with the review marked stale. The blind read's verdict is not an approval. |
| 5. Blind read counts | **right**: 6 fix-sized, 2 larger, 0 outside. | **right**: 6 / 2 / 0, with the items named. |
| 6. Render after Fix 1; `FROZEN_TOTAL_BYTES` | **right**: 827520 → 825278 (−2242), seams −2, wrong if any non-`work` kind or Periodical with folded text is at ≥0. Stays 396064. | **right**: Same figures and reason. 396064 is unchanged. |

## Totals

- **Reader T:** 4 right, 2 partly, 0 wrong, 0 can't tell.
- **Reader S:** 4 right, 2 partly, 0 wrong, 0 can't tell.

Both readers were partly right on the same two questions, for different reasons. On Q1 and Q2, T's only problem is a hedge: it can't tell who owns the blind read's finds. S makes definite owner claims that the key does not support: it gives the 403 checks to John and sends four of the blind read's finds to areas instead of close-out. S also drops items the history names (simple-dispatcher's copies, LIN-4350, LIN-4470).
