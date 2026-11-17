# 4-implementation notes (task-60, LIN-4450)

**Written:** change-84 (PR #2421, head a98d042c6, to review). Decisions: decision-85 (end line chosen by digest; answers question-67, scope task-60), decision-86 (empty fence fixed in the codec; answers question-68), decision-87 (32,768 UTF-8 bytes of the serialized property, scope task-53), decision-88 (round trip throws when it cannot hold the block), decision-89 (every getIssue fetches the property, the fake returns only requested keys, scope task-53). check-90 (live digest check, in task-62, to task-62). finding-91 (source-map.md missing from the retire list, to review). finding-92 (task-61 blocked on the merge, to task-61). run-93 done.
**Ended:** question-67 and question-68 answered; finding-71, 72, 73, 76 and 77 done; check-69 handed-on into check-90; finding-75 handed-on into finding-91. **Revised:** finding-70 and finding-74 readdressed to review, because the output does not cover them.

**Looked up:** the tasks (to find LIN-4451/4452 = task-61/62 for handoffs), the open records, the area-1 findings (78–80: not mine, left), and decision-82's link shape.

**Refusals:** none.

**Relied on beyond the brief and the queries:** the mapping of LIN-4452 to task-62 and LIN-4451 to task-61 (the task records gave this, the brief didn't); the Atlassian docs URL; the key-state-census fixture; the CI and test counts; the PR branch name.

**Brief carried but not needed:** the five lessons, the area counts, task-53's full ask, run-83's account.

**Couldn't place:** the "consequence once merged" note (it is already in done-when); the CI results (change has no field for them).
