# Notes: 6-review, task-60

**Written**
- verdict-98 (review, approve-with-notes), on change-85@2, about task-60.
- finding-99 to close-out: the oversize test must assert the log line.
- check-100 to task-62: the first Jira-native dispatch after deploy.
- finding-101 to task-61: `createIssue` must go through `holdAsAsked` and `AS_ASKED_READ`.
- run-102, ended done.

**Revised:** check-90 (to task-62). Its `how` now has the property round trip and the right/wrong conditions.

**Ended:** finding-97 done (checked).

**Left open:** finding-89. My real review never checked `docs/architecture/source-map.md`.

**Looked up**
- `show --task task-60`, for the whole record set.
- `get change-85`, to find the head version to rest the verdict `on`.
- `get check-90` and `find --in task-62`, `--text LIN-4452`. I wanted existing live checks so I revised rather than duplicated (check-90 already held ledger item 2 and half of item 1).
- `find --kind task`, to find LIN-4451 = task-61.
- `find --text holdAsAsked`.

**Refusals:** none.

**Relied on, given by neither brief nor query:** the PR diff itself and git history:
- 9 `getIssue` sites;
- `workspace-api-audit.js:35` predicate;
- the oversize test at ~line 262 and its exact log string;
- the mutation results, local test counts and the 16-shape probe;
- main at cfd152fa4 and the 22 files;
- the LIN-4445 departure comment's contents;
- the rollback behaviour (`_End of…_` not recognised).

**Brief carried, not needed:** lessons 5, 6, 16, 47 (Survey render, blind reader, area catch-all). The area counts (LLM & prompts: 25 open). Most of part 1's parent ask.

**Couldn't place:** the LIN-4452 and LIN-4451 to task-62 and task-61 mapping isn't in the brief; I found it by query. "Conditional approve" has no outcome of its own, so I used approve-with-notes.
