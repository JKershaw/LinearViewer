# Grade: LIN-4469, second review, as of 2026-11-13T23:17:09Z

Read: `key.md`, `answers-T.md`, `answers-S.md`.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **right**: re-review PR #2447 at `05b592742` against the settlement's list (a) to (d), which matches the key. | **partly**: re-reviewing at the new head appears only as "implicitly". It leads with check-148 (move size), which the key does not list. It does not give the (a) to (d) list. |
| 2. Still open, and whose | **partly**: has the witness ruling (John's, gates merge), this review, the 403 checks (no owner named) and the unreported Fix 5 and Fix 2 items. It misses simple-dispatcher's copies (that repo's owner) and LIN-4350 staying open. | **partly**: has the witness ruling (John's, gates merge), Fix 5 and the open PR. It gives the 403 checks to John, but the key says no owner is named. It adds check-148 and finding-147, which the key does not have. It misses simple-dispatcher's copies and LIN-4350. |
| 3. `lin-4469-cuts` decision | **right**: John ruled fold at 23:03:14. The settlement added triage. The witness half moved to `lin-4469-witness`. The decision holds. | **right**: John ruled fold, with triage added. It holds. The witness half split off into question-159. (It credits triage to the ruling itself, not to the settlement's widening. That is minor.) |
| 4. Verdict on the current head | **right**: no verdict. The head is `05b592742`. The only verdict is Needs Discussion at `3533f37c2`. The plan Approve and green CI are not an approval of the PR. | **partly**: "No" is correct. But it names the head as `877f32cb4`, a commit that is not there at this moment. The key says `05b592742`. |
| 5. `FROZEN_TOTAL_BYTES` | **right**: 396064, below 396575. The earlier figures it gives also match the key. | **right**: 396064, below 396575. Its caveat about the later head does not change the figure. |
| 6. Byte-identical kinds in real context | **right**: four `work` kinds, `seams-tangles` +24, total −2190. It flags "eight" as stale. | **right**: four `work` kinds, `seams-tangles` +24, total −2190. It flags "11" as wrong. |

## Totals

- **Reader T:** 5 right, 1 partly, 0 wrong, 0 can't tell.
- **Reader S:** 3 right, 3 partly, 0 wrong, 0 can't tell.

Note: Reader S's head `877f32cb4` and its run-162 ("leftover's header tidies") look like records from after this moment. The key says the leftover follow-up had not landed yet. If so, the store did not stop at the moment as it should have, and that cost Reader S on Q4. It may also have shaped its Q1 and Q2 answers.
