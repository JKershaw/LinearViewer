# survey-task on task-57 (LIN-4450): notes

**Written** (all in task-57, all `about` plan-51):
- run-63 run, account = the saved output; ended `done`.
- finding-64 (to task-57): end-line rule mismatch between the node reader and `hasMarkerLine`/`splitAsAsked`.
- finding-65 (to task-57): empty fence breaks the "D1 never flags writer output" claim and the fixed-point test.
- check-66 (to task-57, also `about` plan-53): live probe before any code. Revised once so it names finding-64/65 by id.
- finding-67 (to task-57): bulk search vs `getIssue` reads differ.
- finding-68 (to task-57, also `about` decision-60): measure the property limit on the serialized string.
Nothing ended or handed on: nothing was addressed to survey-task, and decision-60 still stands.

**Looked up:** `show` task-57/task-50, `find --to survey-task`, `find --to project --text Jira`, lessons and records on seal/D1/codec/LIN-2019/localId (to avoid duplicates; only lesson-6 was related, and it doesn't conflict), plan-53/decision-62 (does the live probe already have a home? Partly: session 3 checks live after the build, not before it), finding-49.

**Refusals:** none.

**Relied on but not given:** the code at 4b5001ddf: line numbers, `hasMarkerLine`, `sealForFiling`, the `adf.js` header claim, how `adfHasUnrenderableContent` behaves, running the codec, and the fake client's merge behaviour. Also Atlassian's docs on the limit, LIN-2019, and the edit endpoint's support for `properties`.

**Brief carried but unneeded:** task-50's whole request text, and the plan-review notes 2 and 6 in full.

**Couldn't place:** who holds a Jira credential for the probe, so check-66 goes to task-57 with a fallback to John written in its text. The possible design change "on LIN-4445" is conditional, so it got no record.
