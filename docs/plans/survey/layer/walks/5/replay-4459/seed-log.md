# Seed log: LIN-4459 before 2026-11-13T16:23:17.729Z (walk 5 model)

`seed.sh` rebuilds `store.json` from empty. It exits 0 with 122 records, 136 versions and an empty query log. The last write is `end task-110 done` (LIN-4456) by Harbour at 2026-11-13T16:19:20Z, which is also the latest time in the store. It was generated from the material and `docs/areas` @ 0092d8d9e, the commit both Surveys read.

**Ids**
- Runs & dispatch is `area-1`: lessons `lesson-2`…`lesson-19`, Waiting `finding-20`…`finding-37` (by position). The `runFact` entry this piece settles is `finding-28`.
- LLM & prompts is `area-38`: lessons `lesson-39`…`lesson-55`, Waiting `finding-56`…`finding-81`. The claim compare-and-set entry is `finding-64`, the LLM-side live-wait entry is `finding-65`, and the `runner-kickoff.js` entry (retired by the leftover step) is `finding-81`.
- Parent LIN-4447 is `task-82`. LIN-4448 is `task-83`: John, `via driving-session`, `asked` byte-exact, `ref`, `done-when`.
- Pieces 0–8 are `plan-87`…`plan-95`. This task's piece 4 is `plan-91`, at v2 (13:53:21). Piece 1 (`plan-88`) is at v3: its hold was removed at 15:34:58.
- Verdicts: round 1 is `verdict-96`. Round 2 is `verdict-98`…`verdict-106`, and the one on piece 4 is `verdict-102`, on `plan-91@2`.
- Rulings: `question-84` (sd-scope, by scoping), `question-85` (R1, by design), `question-97` (recommend path, by design). John answered them in `decision-120`…`decision-122`, each with `scope` task-82, and each question is ended `answered`.
- The seam ask to LIN-4448 is `question-86`: `in` task-82, `to` task-83. It is answered by `decision-119`, LIN-4448's plan session (design) at 15:39:53, which is `about` pieces 2, 4 and 1. That decision was revised by LIN-4448's breakdown at 15:55:15, the correction that names the `recent-runs.js` collision.
- Siblings: LIN-4453 is `task-107`, LIN-4454 `task-108`, LIN-4455 `task-109`, LIN-4456 `task-110` and LIN-4457 `task-111`, all done. LIN-4458 is `task-112`, still open. Each has its `ref` and `piece`.
- This task, LIN-4459, is `task-113` (14:01:57.719Z), with breakdown decisions `decision-114`…`decision-118` on `verdict-102@1`.

**Steps** (`steps.json`; start = asOf + 1 s): 1 survey-task 16:23:17.729; 2 survey-place 16:26:26.174; 3 scoping 16:29:52.430; 4 implementation 16:33:18.146; 5 leftover 16:48:19.758; 6 autopilot 16:57:36.409; 7 review 16:58:17.031; 8 blind-read 17:02:23.715; 9 close-out 17:04:57.371; 10 autopilot 17:30:19.279.
- Step 5 (leftover) is not in the step list I was given. The cost record has it as a follow-up of the implementation session, and it wrote `### Leftovers`.
- Steps 6 and 10 are autopilot wakes that wrote comments. In each, asOf is the wake's dispatch time.
- What the steps wrote on the parents: implementation wrote d3553049 on LIN-4447 and 0510ffe0 on LIN-4448; close-out wrote b564445b on LIN-4448; the step 10 autopilot wrote 15a858eb on LIN-4447.

**Placed approximately, or not placed**
- The seam ask (comment d3ba7421 on LIN-4448, 13:36:44) was written by LIN-4447's `blocked` (unblock) stage. That stage is not a declared actor, so the write is `--by Harbour --via blocked`.
- Done times for LIN-4454…4457 are not in the material. Each is dated at its PR's last main-line `docs/areas` commit, which is a lower bound. They are ended by Harbour, as walk 4 did for LIN-4453.
- Creation times for LIN-4454, 4456, 4457 and 4458 are interpolated between 14:01:50 and 14:01:57.719.
- Sibling done-whens other than LIN-4453's and LIN-4455's (walk 4's text) are written from the breakdown table and the plan.
- Pieces other than piece 4 keep walk 4's condensed text. Piece 4 is verbatim from the Implementation Plan.
- Not placed: the plan changes the siblings posted on LIN-4447 (a3dab3f7 piece 7, 40d7c83a piece 6, 055a6035 and 2f488272 piece 5). Their writing stage cannot be told from this material.
- Not placed: LIN-4447's Unblock engineering calls (dc7461eb). Walk 4 also left them out.
- Area paths: the store matches whole path segments, so each registry prefix is expanded to the files at 0092d8d9e whose first match is that area. Exact files and directories are kept as written.
- Area entries already present at 4b5001ddf are dated 12:00Z. Later ones carry the time of the main-line commit that added them.
