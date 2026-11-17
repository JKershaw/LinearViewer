# 5-implementation notes (task-28, LIN-4472)

**Written:** change-97 (PR #2436, head a6492a984, about plan-10); decision-98 (served leaf `lib/time-words.js`, on question-84@2, about finding-83); plan-10 v3, v4 (as built; v4 corrected the shortfall line); finding-99 → area-49 (classic copies left in session/observation/live-console); finding-100 v1, v2 → review (reads-shorter shortfall; v2 corrected it); finding-101 → review (`fmtDuration(Infinity)` is now null); run-102, done.

**Ended done:** finding-82, -85, -87, -89, -90, -56, check-86 (e2e run locally), and area findings -91, -83. Left open: question-84 (John's question; I took its if-unanswered course and did not answer for him), finding-92.

**Looked up:** `show --task task-28`; `get` plan-10, finding-83/56/91/92; `find --kind change` and `--text served-leaf/time-words`, to avoid duplicates and see who carried the leaf remedy.

**Refusal:** `{"rule":"6","msg":"implementation may not end decision-32"}`. I left it out. decision-98's `why` says it supersedes decision-32.

**Relied on, not given:** the PR's content: suite line counts, the Infinity edge, CI and e2e results, the LIN-4463 `lin4472-served-leaf` comment, and that the classic copies sit in three named files. The head SHA came from the prompt. None of this was in the brief.

**Brief carried, not needed:** task-1's full ask text, verdict-25's long reasoning, lesson-60/63/66.

**Couldn't place:** a record for "full unit suite left to CI" (CI passed at 17:50, after my START). Revising plan-10 made every record downstream show STALE, decision-95 included.
