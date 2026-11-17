# 2-autopilot notes (task-131, LIN-4469)

**Written**
- run-146 (run, in task-131): added 22:39:49, ended `done` 22:39:52.
- finding-147 (finding, to area-1): look-first (survey-task, survey-place, scoping) did not run on piece 5. Implementation was dispatched directly. Raw material for the look-first rule. Links: about task-131, on verdict-124@1.
- check-148 (check, to review): watch PR #2447 for a move that is too small or too large. Links: about change-142 and task-131.
- Nothing ended or handed on. My work closed nothing.

**Looked up**
- `show --task task-131`, to see what implementation already wrote.
- `find --kind run --in task-131`, for overlap and the earlier run.
- `find --text look-first` (plus a lesson and a check variant), to check for duplicates. None found.
- `get area-1`/`area-65`, to place `lib/recommendation-look-first.js`. It falls under area-1 through its `lib/recommendation-` prefix.
- `get change-142`, so the check could point at the PR.

**Refusals:** none.

**What my real output relied on that the brief and queries didn't give**
- The dispatch itself: recommend-and-dispatch's choice of `implementation` and id b86c4a78.
- The ticket's Linear sections (`## As asked`, `## Current` only).
- That pieces 0 to 4 had run look-first.
- That review "caught real gaps on every earlier piece".
- Comment id cea38032.
None of these are in the store.

**What the brief carried that I didn't need:** most of it. The full done-when, the parent's asked, the plan text, decisions 132 to 140, the lesson index, and change-142 and finding-143 to finding-145.

**Couldn't place**
- Dispatch events have no kind.
- Ordering problem: the store already holds implementation's finished run (22:39:30). In reality my comment came at dispatch time, before that work. So check-148 points at a PR that didn't yet exist when I wrote.
- Cosmetic: run-146's account says "piece 5s" (missing apostrophe).
