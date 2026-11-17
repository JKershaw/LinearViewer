# Notes: 4-implementation (task-60)

**Written:** run-83 (done); change-84 (PR #2421, head a98d042c6, on plan-54@2, decision-81@1); decision-85 (end line by digest, answers question-67); decision-86 (limit = 32,768 UTF-8 bytes of the serialized property, on decision-63@1); decision-87 (round trip throws, so the seal is skipped); finding-88 to task-61 (proxy-integration line already retired; blocked on merge); finding-89 to task-62 (digest across editor save is the open risk, about check-69).
**Ended:** question-67 answered; findings 71, 75, 77, 78, 76 done; finding-74 declined (I followed decision-63's every-getIssue rule, not its helper).
**Left open:** finding-70 (search/jql path) and finding-73 (export `plainText`): my account doesn't say. check-69 (John), decisions 63/81.

**Lookups:** `show --task task-60`, open checks, sibling tasks (to address task-61 and task-62), decision-65, `find --kind change` (none yet).

**Refusals:** `{"refused":"a change takes no to"}` and `{"refused":"a decision takes no to"}`. I re-added both without `to`. That burned 13:55:51 and :52. Because of my own ordering slip, question-67 was ended before decision-85 existed, so I ended it a second time (13:55:56) with the id in the reason.

**Relied on outside brief/queries:** the Atlassian docs URL and their bytes/characters ambiguity; the repo itself (the census fixture, `readDescription`, the fake returning only requested keys, CI results); LIN-4445's departure comment; and the fact that no credential was available.

**Brief carried, unneeded:** lessons 5, 6, 16, 47; the area list; most of task-53's asked.

**Couldn't place:** "review note 1 resolved this way" (note 1 isn't in my brief). With no `to` on changes, I couldn't address the PR to review.
