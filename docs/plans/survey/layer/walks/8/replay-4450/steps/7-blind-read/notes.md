# Notes: 7-blind-read (task-57)

**Written**
- verdict-94 (blind-read, better), on change-80@3, to close-out, about plan-51, decision-81.
- finding-95 (workspace-api-audit inline predicate), finding-96 (drop `isTestToken` alias), finding-97 (delete comment-phrase test): all to close-out, about change-80 (95/96 also finding-20).
- question-98 to project: batch vs single-issue description split, two options, if-unanswered = as built.
- Ended finding-76 handed-on into question-98 (same gap; the question adds the pinning test and the decision framing).
- run-99 added, ended done.

**Looked up**: change-80 (version to pin: @3, head f9fa4a80c); run-93; open records to blind-read (none); `show task-57`; `find --text` for isHermeticTestToken/test-token/bulk/batch/searchIssues/workspace-api-audit, to avoid duplicates. Found finding-76 (bulk gap, open to project) and finding-20 (ended; its reason says audit "keeps its own predicate on purpose").

**Refusals**: none.

**Relied on beyond brief/queries**: the PR diff at f9fa4a80c itself: line numbers (audit 35–36, test 291, 166, index.js ~769/~897), the three `isTestToken` callers, the "ten inline copies" count, the area labels (web-routes, other-features, llm-and-prompts, providers). No query gives code.

**Brief carried but unneeded**: the plan-51 text in full and its review notes 3 and 6; decision-60, decision-79; check-82/92 and finding-83 (task-59/58 items); the counts (32 open to project, 22 lessons).

**Couldn't place**: who settles question-98 (engineering, so not John; no stage owns it, so `project`). Also, run-89's stored account holds the 15:32 merge commit, after this stage's time. I did not use it.
