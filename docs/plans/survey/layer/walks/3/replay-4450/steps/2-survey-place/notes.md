# survey-place, task-60 (LIN-4450): notes

**Records written** (13:51:36–44, no refusals)
- finding-67 revised: re-addressed from area-1 to task-60 (taken on)
- finding-73 → task-60: one region module owns both stores; export `plainText`; one read helper; size function there (on plan-54@2)
- finding-74 → task-60: stale claims beyond the plan's three (on plan-54@2)
- finding-75 → task-60: `reason:'provider'` branch left without a subject (on plan-54@2)
- finding-76 → area-1: Jira-native tickets normalised into escaped words (about plan-56)
- finding-77 → area-1: bulk search could fetch `properties` (about finding-70)
- finding-78 → area-1: comment weight in `index.js` and source-map
- run-79 (on plan-54@2), ended `done`

**Taken on:** finding-67. Task-60 is what makes Harbour write Jira descriptions, so the task creates the harm. finding-68 already sends it there. Left finding-52 with area-46: moving it is a move for the guide's owner.

**Looked up:** area-1 findings, D1, search, plainText, source-map, normalisation, tasks and runs. Doing this, I dropped two items from the real output. One was proxy-integration.md:2070, which is already in plan-55's retire list. The other was the claim that "fetchIssueFields isn't in the plan's list", because plan-54 v2 names it. I also did not repeat "D1 won't block Harbour-written blocks", which finding-67 shows is wrong. finding-66 already covered the reader/writer finding.

**Refusals:** none.

**What the real output relied on that neither brief nor query gave:** the repository at 4b5001ddf. That covers the line numbers (getIssue sites, dispatch-factory:1008, source-map:216/:82, guard test 345/351, create-seal 207-227), running the codec probes, and the Atlassian `search/jql` API.

**Brief carried what I didn't need:** the 26 area-2 findings, area-46's findings except 52, and lessons 5, 6 and 16.

**Couldn't place:** "two stores of the words" as a lesson, since it isn't true until the code is built. I put it in finding-73 instead.
