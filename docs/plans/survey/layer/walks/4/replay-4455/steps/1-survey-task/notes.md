# Notes: 1-survey-task (task-60)

**Written** (all `in` task-60):
- run-66 run: added, account revised (v2), ended `done` (v3).
- finding-67, to implementation: the release note can't ride the per-request wakeHook, so late-bind it. Do this first. about finding-21 (Waiting 4).
- question-68, to task-39: put `FEEDBACK_KINDS` in a leaf module to avoid import cycles? The plan changes. about plan-45, on plan-45@1.
- finding-69, to implementation: `findWakeEvent` has no skip rule. Add a column and pin it, no filter. about finding-28.
- finding-70, to implementation: the prompt seam needs the order pinned, plus rows for kinds off the allowlist. about finding-28.
- finding-71, to implementation: `NEVER_RAN` needs a home, plus the safe leaves. about finding-19.
Findings rest `on` task-60@1. Nothing ended or handed on. Waiting 2/4/11 stay open.

**Looked up:** `show --task task-60`, the open area-1 records (to find the Waiting ids; numbering shifts from 16 on), all tasks and areas, and `--text` for FEEDBACK_KINDS/LIN-4448/A14/releaseNote/NEVER_RAN/findWakeEvent (to check for duplicates; none). I also read plan-45 and finding-22.

**Refusals:** none.

**What the real output relied on that no brief or query gave:** the code itself, meaning every file:line, the import chains, `setWakeCredentialProvisionerFactory`, `DECISION_LIFECYCLE_STAMP_KINDS`, `runner-kickoff.test.js:191` and the five "did not run" asserts. Also origin/main cfd152fa4 being docs-only, the Lessons size (4.3 KB), the binding "never recompute pre-cutover history" (it is in the done-when, not the brief text), and that LIN-4447 = task-39.

**Brief carried but unneeded:** decisions 62–64 (session fit, blocking graph), lesson-3.

**Couldn't place:** A14/LIN-4448 has no task or actor, so the prompt-seam point went to implementation.
