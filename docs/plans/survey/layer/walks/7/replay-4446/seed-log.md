# Seed log: LIN-4446 before 2026-11-13T13:12:07.028Z (walk 5 model)

`seed.sh` rebuilds `store.json` from empty. It exits 0 on the first run with 9 records, 9 versions and an empty query log. The last seed write is `add task` (LIN-4446) by John via driving-session at 2026-11-13T12:08:10.414Z.

**Ids**
- Task LIN-4446: `task-9`. It is top-level, so there is no parent, no plan piece, no sibling and no `in`.
- Area front-end-browser: `area-1`. It is the only area the task's paths fall in. `public/` matches `^public/`; `CLAUDE.md` and `docs/areas/` match no area at 4b5001ddf.
- Its Lessons: `lesson-2` and `lesson-3`. Its five Waiting entries: `finding-4`…`finding-8`. All are by Harbour at 12:01:48Z (the commit time), copied verbatim with wrapped lines joined.

**Task fields**
- `asked`: the `## As asked` block byte-exact, without its heading and end line, as in the replay-4450 seed.
- `done-when`: its "Done when" sentence.
- `paths` (`public/`, `CLAUDE.md`, `docs/areas/front-end-browser.md`): taken from what the ask names, because the ticket lists no paths.

**Steps** (`steps.json`; start = asOf + 1.5 s)
1 survey-task 13:12:07.028 · 2 survey-place 13:15:07.717 · 3 scoping 13:18:43.275 · 4 design 13:23:04.310 · 5 plan-review 14:23:44.441 · 6 design 14:28:30.120 · 7 plan-review 14:31:06.769 · 8 implementation 14:36:48.288 · 9 leftover 14:56:24.521 · 10 review 15:07:27.010 · 11 blind-read 15:12:04.711 · 12 close-out 15:14:56.700 · 13 John 15:39:21.268

**Choices and what I could not place**
- **Leftover (step 9).** It is not in the given step list. The cost record nests it under implementation as its own dispatch (`leftover`, 14:56:24.521Z), and it wrote its own `### Leftovers` comment. So I gave it its own step, as replay-4450 does.
- **13:25–14:23.** Nothing was written on the ticket in this window. The rulings file is empty (count 0), and no comment or description change falls between design's last request (13:25:44) and plan-review's dispatch. The autopilot's wake (13:22:33) spans the hour with 10 requests up to 14:23:47 but left nothing on the ticket. I found no John or ruling step to add.
- **"Decided by: a ruling".** Scoping's "John ruled small" points to the asked text ("the size is John's call, and for this work it's small"), not to a ruling record. None exists.
- **Autopilot.** The 13:11 kickoff and the later wakes wrote no comment and no description change, so the autopilot has no step. Todo→In Progress (between 13:19:00 and 13:22:43) is a state change only.
- **Final description rewrite.** It replaces the plan section with "Implemented: …" after the 15:31:25 snapshot. I put it under close-out (its last request was at 15:31:50), but the autopilot's wake at 15:31:51 could have written it instead.
- **Design's first plan.** The snapshots show it only at 14:24:00, but the session ended at 13:25:44.
- **Step 13.** John's read is relayed by the driving agent ("John approved these words"). It is filed as the actor John.
