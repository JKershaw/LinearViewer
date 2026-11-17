# Notes: 2-survey-place (task-60)

**Written (15:02:55–15:03:02Z)**
- finding-70 revised (to implementation): the kickoff test reads the same source, so a reorder passes; pin the literal. `DECISION_LIFECYCLE_STAMP_KINDS` is a fourth set, so add a stamp role.
- finding-71 revised (to implementation): five `NEVER_RAN` spellings, not three. Leave the single-mode halt sites (`dispatch-store.js:644`, `runner.mjs`) alone.
- finding-72 (to task-39, about question-68): validation imports kinds from the store, so putting the table there makes a direct cycle.
- finding-73 (to implementation, about lesson-10): the stale Lesson and docblocks; the witness should forbid the import.
- finding-74 (to implementation, about finding-22): the two-way policy is Waiting 5's to fix; name it in the PR.
- question-75 (to area-1, about finding-69): should `findWakeEvent` skip relay kinds?
- run-76 added and ended `done`. Ended nothing else: Waiting 2/4/11 and question-68 stay open.

**Looked up:** `show --task`, a `get` on findings 67–71 and question-68 (my brief showed only their first lines), a `find --to area-1` (Waiting numbers mapped to ids), `find --text` for each point (to avoid duplicates), lesson-10.

**Refusals:** none.

**Relied on that no brief or query gave me:** the code itself. That meant line numbers (`observer-sweep.js:108`, `task-page-loader.js:248`, `runner-kickoff.js:61`, docblocks `:3481`/`:10`, `dispatch-feedback-validation.js:13`), file sizes (157 and 109 lines), 58 commits since 1 Oct, the current head cfd152fa4, the 4,269-byte Lessons count, and the equivalence check across targets.

**Didn't need:** decisions 62–64 (session fit and blocking order), the parent's full ask, and lessons 3 and 4.

**Couldn't place:** the "where it lands / trend is good" health read. It went in the run account only.
