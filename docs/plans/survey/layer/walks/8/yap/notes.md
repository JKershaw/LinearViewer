# Walk 8 / yap: notes

**Records (43):** task 5, run 5, change 5, decision 13, finding 6, lesson 5, plan 2, check 1, question 1, verdict 0.

**Corrections:** decision-10 (44px touch targets) superseded into -34; decision-9 (100dvh) into -41; decision-4 (bundled runtime) into -23; plan-1 (TODO) into -22. New heads revised on change-16 and change-32. decision-29 linked `on` decision-9@1, so it now reads STALE.

**Refusals:** none.

**Bad fits:**
- No words from the person. PR text came back 403, so tasks have no `asked` or `done-when`, `ref` is the branch, and tasks are `--by recorder`. Findings are by the sessions, though john probably reported them.
- A merge is only `end merged --by john`. There is no review text, so no verdicts (PR #17 merged 19 s after its commit). Task ends are mine.
- Out-of-thread commits (PR #14/15/18/21, 686f48f, 069deab) have no task. They appear only in end reasons, and in yap-docs plan/decision versions dated at the commit, not at the merge.
- A run has no field for its session link, so the links went into `account`. Run start and end are commit times.
- Lesson `checked-at` holds "stated in <sha>; no device run". None of the keyboard fixes has a witness.
- `link` writes a new version with the linker's by/at. decision-29 now shows "by recorder at 2026-11-18" in the brief.
- john's brief on task-36 shows "Addressed to you: (none)", yet check-21 and question-43 are open to john. Part 3 only sees records in or to the task.
- Part 4 of every task brief carries all 10 project-scoped decisions.
- Recorder records use wall-clock `at`.
- Process slips: I read store.json once while it was still empty, and I read layer.mjs.

**Open at end:**
- check-21 to john (eyeball the who-drawer screenshots; flagged underEnded task-14).
- question-43 to john (the asks and reviews for the 5 PRs).
- finding-42 to project (design.md still describes the bundled runtime).
- decision-29 is stale.
