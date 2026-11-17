# What this stage really wrote

## Comment on LIN-4450 at 15:21:22

## Blind read
Verdict: better. It gives Jira's description read and write a single owner (`lib/providers/jira/as-asked-region.js`: `readDescription`/`holdAsAsked`, and `descriptionRoundTrip` now runs that same pair, so the seal decision and the write can't disagree). It also folds ten inline copies of the test-token predicate onto `isHermeticTestToken` (`routes/proxy-compute.js`, `server.js`, `routes/task-chat.js`, `routes/workspace-api-steps.js`). On the worse side, a Jira issue's `description` now depends on which read produced it: the batch path in `lib/providers/jira/index.js` serves the converted words and the single-issue reads serve the exact ones.

Read: https://github.com/JKershaw/LinearViewer/pull/2421 at `f9fa4a80c` against `4b5001ddf`.

### Inside the area, fix-sized
- `routes/workspace-api-audit.js` (web-routes): lines 35–36 still write `process.env.NODE_ENV === 'test' && (workspace.accessToken === 'test-token' || …)` inline. The sweep moved every sibling copy onto `isHermeticTestToken` and missed this one. Fix: `isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local')`. It keeps its own predicate, as its comment asks.
- `routes/workspace-api-steps.js` (web-routes): `isTestToken` is now a one-line second name for `isHermeticTestToken(workspace.accessToken)`. Fix: have its callers (`workspace-api-issue-read.js`, `workspace-api-issue-write.js`, `workspace-api-prompts.js`) import the helper directly and drop the alias.
- `tests/unit/jira-as-asked-region.test.js` (other-features, for `lib/as-asked-seal.js`; and llm-and-prompts, for `lib/as-asked.js`): the test at line 291, "no longer claim that Jira is skipped", only checks that three phrases are missing from two comment headers. It says nothing about behaviour; `as-asked-create-seal.test.js` already checks that Jira holds the block. Fix: delete it.

### Inside the area, larger
- `lib/providers/jira/index.js` (providers): `client.searchIssues` never asks for `harbour.asAsked`. So the issues that `fetchProjects`/`fetchIssues` (line ~769) and `fetchIssueContext`'s `children` (line ~897) build through `_toCanonicalIssue` come back with the ADF rendering behind canonical markers. `fetchIssueFields`, `fetchIssueContext().issue` and `issueDescription` return the exact property words for the same issue. `jira-as-asked-region.test.js:166` pins this split. It is larger than a fix because closing it is a decision: either every dashboard batch asks `/search/jql` for properties (up to 32 KB per issue), or batch descriptions are documented as not carrying the exact words.

### Outside the area
None.

