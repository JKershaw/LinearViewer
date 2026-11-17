# survey-task on task-60 (LIN-4455): notes

**Written** (all `in` task-60, 15:02:16–15:02:23):
- finding-66 → task-60: releaseNote can't reach `_archiveItem` releases; late-bind (about finding-21, Waiting 4).
- question-67 → design: put `FEEDBACK_KINDS` in a leaf module because of import cycles (about finding-28).
- finding-68 → task-60: `findWakeEvent` has no skip rule; pin it, don't filter it (on task-60@1).
- finding-69 → task-60: runner-prompt order and allowlist seam.
- check-70 → task-60: test pinning `FEEDBACK_ENTRY_KINDS` order and membership.
- finding-71 → task-60: `NEVER_RAN` needs a home (about finding-19, Waiting 2).
- run-72, ended done.

Nothing was addressed to task-60, so I ended or handed on nothing. Waiting 2/4/11 (finding-19/21/28) stay open for implementation.

**Lookups:** `show --task task-60`, plus `find --to task-60` (empty). I ran `find --area area-1` to get the Waiting ids so I could link `about`. I ran `find --text` for 4448/FEEDBACK/wakeHook/NEVER_RAN/A14 and `find --kind area` to avoid duplicates and to find an addressee for A14. There is none: no LIN-4448 task or prompts area exists, so the seam finding went to task-60.

**Refusals:** none.

**Relied on outside brief/queries:** all of the code facts (line numbers, import chains, the "did not run" ×5 test, `setWakeCredentialProvisionerFactory`, `runner-kickoff.test.js:191`, `DECISION_LIFECYCLE_STAMP_KINDS`). Also the HEAD cfd152fa4, the Lessons byte count (~4.3 KB), and the 6,144 limit, which is only in task-60's done-when, not the brief. The Waiting 5 text was a query result, not in the brief.

**Not needed:** task-39's full asked text (the other Batch 1 cases), decisions 62–64 (session fit, blocking graph), lesson-3.

**Couldn't place:** the grounding drift (cfd152fa4 vs decision-61's 4b5001ddf). survey-task can't revise decisions, so it went into the run account.
