# 5-leftover notes (task-60, LIN-4450)

**Written / ended**
- finding-22 (to area-2) ended `done`: the test-token retirement.
- finding-70 (to task-60) ended `handed-on` → finding-77: the check found no guard or cache that compares the two reads. The gap itself stays open.
- lesson-88..91 (in area-1): one reader/writer, compare renderings not ADF, loose end line kept safe by one shared reader, the fake can't prove live behaviour. 88 rests `on` lesson-8, 90 `on` decision-83, 91 `about` check-69.
- run-92 added, then ended `done`.

**Looked up**: change-82 (for the head). Area-1 and area-2 findings, to find finding-22 (the retirement) and finding-77 (bulk-read duplicate). Jira lessons (none).

**Refusals**
- `revise change-82` → `{"rule":"6","msg":"leftover may not revise change-82"}`. Left out. The new head f9fa4a80c is in run-92's account.
- `revise finding-77` (add "no guard compares; now in providers.md") → `{"rule":"6","msg":"leftover may not revise finding-77"}`. Left out. finding-70's end reason carries it.

**Relied on beyond brief/queries**: the PR diff and its commits. That covers the four stale comments, the inline test-token callers, `AS_ASKED_READ`, `searchAllIssues`, that `/search/jql` accepts `properties`, the CI rerun, and the new head SHA. Also the area-notes file contents: the brief does not say docs/areas/providers.md doesn't exist yet. The retired entry was in neither the brief nor its index. I found it only by searching area-2.

**Not needed**: the person's words for task-53, the verdict/decision text in full, lessons 5, 6 and 16, finding-86.

**Couldn't place**: the tidies done now. No kind fits a tidy in an existing PR, so they are only in run-92.
