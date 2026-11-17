# Seed log: LIN-4464 before 2026-11-13T15:56:30.374Z (walk 5 model)

`seed.sh` rebuilds `store.json` from empty. It exits 0 with 83 records, 86 versions and an empty query log. The last seed write is `question-83`, by breakdown, at 2026-11-13T15:55:54.652Z.

**Ids**
- Parent LIN-4448: `task-60` (John, via driving-session). LIN-4464: `task-78` (breakdown, 15:54:40.300Z). Its piece is piece 0, `plan-64`.
- Pieces 0–6: `plan-64`…`plan-70` (design, 15:39:54Z). Plan-review approve verdicts: `verdict-71`…`verdict-77`, each on `@1`. The one on piece 0 is `verdict-71`.
- Areas, at `5dcf5bcda`:
  - LLM & prompts: `area-1`, with lessons `lesson-2`…`lesson-18` and Waiting 1–25 as `finding-19`…`finding-43`. Note blob `b6b4c726d`.
  - Front end: server-rendered pages (the control): `area-44`, with lessons `lesson-45`…`lesson-47` and Waiting 1–12 as `finding-48`…`finding-59`. Note blob `ae9c007e1`.
- Scoping's size record: `decision-61` (v2 at 15:34:35 says "Decided by: a ruling"). The cuts ruling: `question-62`, answered by John's `decision-63` (15:33:39Z) and ended `answered`.
- Breakdown decisions in LIN-4464: `decision-79`…`decision-81`, each on `verdict-71@1`. The assignee call, in the parent: `decision-82`.
- `question-83`: the ruling `lin4448-lookinto-none`, to John. It is open at the moment, and step 2 answers it.
- Siblings: none. LIN-4464 was the breakdown's first subtask, and LIN-4465…4470 were filed after it.

**Steps** (`steps.json`; start = asOf + 1 s)
1 survey-task 15:56:30.374 · 2 John 15:57:43.409 (ruling answer, on LIN-4448) · 3 breakdown 15:58:14.076 (ruling applied, on LIN-4448) · 4 survey-place 15:59:38.872 · 5 scoping 16:03:21.049 · 6 implementation 16:05:57.405 · 7 leftover 16:17:28.031 · 8 review 16:25:59.409 · 9 blind-read 16:28:52.112 · 10 autopilot 16:32:11.820 · 11 close-out 16:32:21.249

**Choices and gaps**
- Leftover is a step of its own (7). The cost record shows it as a follow-up dispatch in the implementation session at 16:17:28. The prompt's STEPS list did not include it.
- Survey-task's comment (15:58:40) landed after steps 2 and 3. I filed it under survey-task, its writer, not by the time window.
- Start commit: `5dcf5bcda`, the base named by the breakdown and survey-task. The implementation read at `e8e92d50a`.
- Area records are dated at the placeholder 12:00:00Z. Every lesson and entry in them already existed by `4b5001ddf`; since then, entries were only removed.
- Area `paths` are the registry regex expanded to the files it matches first at `5dcf5bcda` (91 and 92 files). `lib/prompts/` and `lib/components/` are each kept as one entry. Lesson `paths` are the backticked repo paths in each lesson.
- Wrapped lines in the notes are joined with single spaces. `checked-at` is `5dcf5bcda`.
- The parent's `via driving-session` is inferred from LIN-4447, which was filed 2 s earlier. The material does not say how LIN-4448 was filed.
- Task `paths` are the files the ask names, plus `docs/plans/survey/area-read-reports/` (#2422's folder, already at `5dcf5bcda`). LIN-4464 has no `asked`: child tasks carry none. Its ask is folded into `done-when`.
- Piece texts and verdict reasonings are condensed from the plan (snapshot 15:50:06) and from the review comment 72406236. They are not verbatim. Scoping's 13:28 question and decision use the ruling's raisedAt, and its revise uses the custom run's last request (15:34:35).
- Not seeded:
  - the parent's two Survey comments and LIN-4447's seam ask (13:36), which are comments, not records;
  - the breakdown's seam correction, which went on LIN-4447.
- Not placed:
  - the 16:42 LIN-4448 comments from the LIN-4458 and LIN-4459 sessions, which are other tasks' writes during close-out;
  - who moved LIN-4464 to In Progress (scoping or implementation);
  - the breakdown's `## Current` edits to LIN-4468 and LIN-4469.
