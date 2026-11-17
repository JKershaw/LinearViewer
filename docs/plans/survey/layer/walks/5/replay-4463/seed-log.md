# Seed log: LIN-4463 before 2026-11-13T15:42:12.265Z (walk 5 model)

`seed.sh` rebuilds `store.json` from empty. It ran clean the first time: exit 0, 16 records, 16 versions, and an empty query log. The last write is `add task` (task-16), by John via driving-session, at 2026-11-13T15:39:22.240Z. Start commit: `c205190fd`, the commit both surveys read, committed 15:39:20Z.

**Ids**
- LIN-4463 (top level, no parent, so no pieces or siblings): `task-16`. `asked` is byte-exact (the `## As asked` block after its heading). `done-when` holds its three bullets. `paths` is `["public/"]`.
- Area Front end: browser code (`front-end-browser`, match `^public/`): `area-1`, written at 2026-11-08T02:29:09Z (526bca66c).
- Lessons 1–4: `lesson-2` to `lesson-5`. Waiting 1–10: `finding-6` to `finding-15`, in note order (app.js DOMParser, buildDispatchModelOptionDescriptors, brief.js, common.js twins, cost-format-global bridge, ship copies, prompt-section loader, observation size, llms.txt, no-AI Next step).
- Each entry is verbatim with its line wraps joined. Its `--at` is the newest commit among its lines (`git blame` at c205190fd), so the times are in note order, not time order.

**Steps** (`steps.json`; start = asOf + 1 s)
1. survey-task 15:42:12.265Z: comment `## Survey open-0` (15:44:33)
2. survey-place 15:45:43.901Z: comment `## Survey global` (15:47:49)
3. scoping 15:48:21.797Z: `## Size of the move` added to the description (snapshot 15:51:43)
4. design (Harbour's `plan`) 15:51:22.421Z: `## Implementation Plan` added to the description (snapshot 15:57:15). No comment.
5. plan-review 15:56:45.333Z: comment `### Plan Review Verdict`, Approve (16:02:45). No description change.
6. breakdown 16:03:16.710Z: comment `### Breakdown` (16:05:48). Created LIN-4471 and LIN-4472. No description change.

The autopilot (dispatched 15:40:17) wrote no comment and made no description change in this window, so it is not a step. Nobody else wrote either: no John comment, and no ruling (the one ruling was raised at 18:53).

**Could not place**
- The state moved from Todo to In Progress between snapshots 15:48:45 and 15:51:43, during scoping. The writer is not shown, and the store has no state for this.
- LIN-4471 and LIN-4472: the material has only their titles. Their creation times, descriptions and `blocks` link are missing, so `real/6-breakdown.md` lists the titles only.
- LIN-4463 blocks LIN-4342 and LIN-4343, but the material doesn't say when those relations were made. The label `stretch:open-the-door` has no field in the store. Neither is seeded.
- The task's `paths` is my reading. The ask names the browser area, `public/common.js` and `public/observation.js`. So only `front-end-browser` is seeded. `front-end-pages` and `other-features` (`lib/cost-format.js`) appear only in the plan and the review, which the replayed steps write.
