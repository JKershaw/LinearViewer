# Notes: 6-review (task-57)

**Written:** verdict-90 (review, approve-with-notes, on change-80, to close-out); finding-91 (oversize test must assert the log line, to close-out); check-92 (post-deploy first dispatch of a Jira-native ticket, to task-59, about finding-75); run-93 (ended done).
**Revised:** check-82 (to task-59; adds the review's right/wrong conditions and `3.`); finding-73 (readdressed review → close-out: source-map.md :82/:216 was not confirmed by the review); change-80 (review → close-out); verdict-90 re-pinned to change-80@3 after the readdress bumped the version (same head).
**Ended/handed on:** none besides run-93. finding-75 (to John) and finding-83 (to task-58) left open.

**Looked up:** `find --to review --state open` (what fell to me); `show --task task-57`, `get run-89`; `get check-82` and `find --text` ("first dispatch", "Jira-native", "rollback", "log line") so the live ledger extends rather than duplicates; task list to map LIN-4452 → task-59; `get finding-75`.

**Refusals (verbatim):** `{"error":"a verdict must have on"}` and `Field on does not belong to verdict`. I had put links at top level; the build notes don't show the `links` object in `add` JSON, so I found it in `layer.mjs`.

**Relied on beyond brief/queries:** the PR diff, CI runs, local test runs, mutations and probes; `git log` on four files; LIN-4445's departure comment; `routes/workspace-api-audit.js:35`; that no credential for John's site exists in a build session.

**Brief carried, not needed:** the full plan-51 text and the plan-review notes (the review used the ticket's `## As asked`); decision-60's breakdown row; the project counts.

**Couldn't place:** the rollback statement (put in the verdict's reasoning); "the docs Survey global named" (it may cover source-map, I can't tell).
