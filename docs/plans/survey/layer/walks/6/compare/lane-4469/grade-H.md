# Grade: Reader H, lane LIN-4448 at the start of LIN-4469's close-out (2026-11-13T23:26:58Z)

Read: `key.md`, `answers-H.md`, `grade.md` only. Same standard as `grade.md` used for T and S.

| # | Question | Reader H (ticket plus facts) |
|---|---|---|
| 1 | Open across the lane, and whose | **right**: PR #2447 unmerged (approved at 05b592742, head 877f32cb4), Fix 1 and Fix 2 owned by close-out, blind-read finds, the post-deploy 403 checks after the merge, LIN-4470 blocked by LIN-4469, LIN-4448 Request Changes awaiting a re-review, pieces 0–4 closed. Gives the 403 check to John (defensible, as for S). Its blind-read list is incomplete: it misses the two larger finds with no home (the witness's table hashes, `STEP_KIND_WORDS`). Leaves out LIN-4350 (minor). |
| 2 | Asks made to other lanes / replies owed | **partly**: has the LIN-4350 report right, treats 097a3442 as a notice, has "agree" (08c9c898) right, and treats Runs' renewed asks as moot or unanswered (close to the key). Misses the 15de14a7 heads-up and the b555094d notice, which got no reply, and says no ask waits. |
| 3 | Piece 5's fold overridden; what stands | **right**: overridden by John's `fold` plus the engineering settlement (fab0cf08) for triage. What stands is complete: the four mandates, triage, survey-task/place and blind-read folded (04bb47598/05b592742), triage keeps its scope rule, the code/branch/PR/merge words stay, the four `work` kinds unchanged. Does not state the first build's `accept` recommendation (minor). |
| 4 | Waiting entries on main; which this lane settled | **right**: 23 on main, #2447 unmerged, the 2 removals and 4 rewrites, the earlier LIN-4466 (blind-read) and LIN-4467 (tables) settlements, and live-wait/runner-kickoff given to the Runs lane. Hedges on first-match (removed or narrowed), as T did. |
| 5 | John's decisions that still hold | **partly**: has safety-cuts defer, look-into retire, `lin-4469-cuts` fold, and the byte-limit remark (correctly not a ruling). Its held-wake stamp is hedged, as T's was. But it puts **triage** inside John's `lin-4469-cuts` ruling ("covered by the option"), which the key lists as an engineering settlement. That is the same error S was marked down for. |
| 6 | #2447 byte change at the approved head; FROZEN_TOTAL_BYTES | **right**: 05b592742, 827520→825330 (−2190), 56/72 fall, seams-tangles +24 ×2, seven ±0, −2242 only after Fix 1, 396064 down from 396884 and below 396575, 396419 (ec59bd26) stale. |

## Totals

- **Reader H:** 4 right, 2 partly, 0 wrong, 0 can't tell.

Compared with T and S: H matches T on Q2 (it misses most of the LIN-4447 notices) and matches S on Q5 (triage given to John). Unlike S, it does get the earlier LIN-4466 and LIN-4467 settlements in Q4.
