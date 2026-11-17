# Grade: LIN-4469, second review, as of 2026-11-13T23:17:09Z

Graded against `key.md` only.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **right**: re-review at `05b592742` with items (a) to (d), and it flags Fix 5 and the figure corrections as unreported (in Q2). | **partly**: it leads with check-148, a piece-size judgement that is not in the key. It reaches the re-review only "by implication", lists only Fixes 1 to 4, and misses (c), (d), Fix 5 and the LIN-4350 correction. |
| 2. Still open, and whose | **partly**: it has the witness ruling (John's), the review, and the 403 checks with no owner named. It misses simple-dispatcher's copies (that repo's owner) and LIN-4350 staying open. | **partly**: it has the witness ruling (John's) and the review, but on head `877f32cb4`, not the key's `05b592742`. It gives the 403 checks to John, where the key names no owner. It misses simple-dispatcher's copies and LIN-4350, and adds items the key doesn't list. |
| 3. `lin-4469-cuts` decision | **right**: John ruled fold, not accept (23:03:14). The settlement widened it to triage with the scope rule kept. It still holds, and the witness moved to `lin-4469-witness`. | **right**: fold, it holds, and it covers all four places, triage's scope rule included. It credits triage to John's decision rather than to the settlement, and says the review recommended fold where the key says the review still treated it as open. Both are side details, not the core answer. |
| 4. Verdict on current head | **right**: no verdict covers the head. Head `05b592742`; the only verdict is Needs Discussion at `3533f37c2`; the plan approval doesn't count. | **partly**: it correctly says no verdict covers the head, and gives Needs Discussion at `3533f37c2`. But it names the head `877f32cb4`, not `05b592742`. |
| 5. `FROZEN_TOTAL_BYTES` | **right**: 396064, below 396575, with the superseded figures placed correctly. | **right**: 396064, below 396575. It adds a hedge about `877f32cb4`, but the figure and the bound match the key. |
| 6. Real-context byte-identical count | **right**: four `work` kinds, `seams-tangles` +24, −2190 overall. It rejects the "eight" as stale. | **right**: four `work` kinds, `seams-tangles` +24, −2190 overall. It rejects 11 and 8 as stale. |

## Totals

- **Reader T:** 5 right, 1 partly, 0 wrong, 0 can't tell.
- **Reader S:** 3 right, 3 partly, 0 wrong, 0 can't tell.
