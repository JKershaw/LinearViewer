# S2 result: a withdrawn ruling leaves a false line

**Seed (Harbour):** task-1 (LIN-4448), task-2 (LIN-4469, in task-1), change-3 (open, in task-2).

**Actors**
1. Autopilot 22:50. Brief: only change-3. Added question-4 to John ("may the merge go ahead without the witness?"), about change-3.
2. Builder (implementation) 23:11. Brief indexed question-4; ran `get question-4`; added finding-5 to autopilot, in task-2: "merge waits on question-4", `on question-4@1`, about change-3.
3. Autopilot 23:40. finding-5 was "addressed to it". Ended question-4 as withdrawn. Re-brief marked finding-5 STALE; ended it as declined ("premise gone").
4. Reader of LIN-4448 09:00. task-1 brief: only task-2 indexed. John: nothing open. `show`/`find --in task-2 --state open` returned only change-3. `find --text waits` returned question-4 (withdrawn) and finding-5 (declined).

**Answer:** No. Nothing open still says merge is gated. The gate was one record resting `on` the question's exact version; the withdrawal made it stale, in the brief of the one actor who could close it. The reader learns LIN-4469 waits on nothing recorded.

**Gaps**
- The STALE flag doesn't say why. The brief doesn't name the withdrawal, so the autopilot had to run `get`.
- Nothing ends the dependant automatically. In a counterfactual where finding-5 was never ended, it stays open with `stale: true` in `find`. Only a reader who checks the flag would discount it.
- The withdrawal reason is free text and doesn't record what the merge now does: proceed, or wait on something else. The reader can't tell whether merge may go ahead.
- The parent's brief doesn't surface a child's gates, only `task-2` in the index. The reader has to drill down.

**Refusals:** none in the scene. One from a probe (scratch store), which was right: `{"refused": "id is set by the store"}`.
