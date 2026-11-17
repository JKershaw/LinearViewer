# Notes: 1-survey-task (task-60, LIN-4450)

**Written** (all `in` task-60, 13:44:56–13:45:02):
- run-66 run: account, then ended `done`.
- question-67 → implementation: the end-line rule (`*…*` only vs any marks). `about` plan-54.
- question-68 → implementation: the empty fence breaks D1/fixed point. Fix the codec or exclude it. `about` plan-54.
- check-69 → John: a live probe, before any code, that the digest survives below-the-line edits. `about` plan-54, plan-56, task-62.
- finding-70 → implementation: bulk reads and `getIssue` reads differ.
- finding-71 → implementation: measure the serialized property for the bytes/characters limit. `about` decision-63, plan-54.

Nothing revised, ended or handed on. Nothing was addressed to me.

**Looked up:** `show` task-60 and task-53; open findings, questions, checks and runs; `find --text` (fence, codeBlock, live, end line, digest, normalis); decision-65, plan-56 and lessons. I was checking for duplicates (none) and who holds a Jira credential (decision-65: no build session does, so check-69 goes to John).

**Refusals:** none.

**What my real output relied on that neither the brief nor a query gave me:** the code at 4b5001ddf. That covers the line numbers (484, 863/873, 1049, 1064, 1267), the behaviour of `hasMarkerLine`/`sealForFiling`, the `adf.js` header claim, `adfHasUnrenderableContent`, the codec runs and their outputs (`_em_`, `- a`, `\***x**\*`), how the fake client merges, LIN-2019, and Atlassian's limit pages. I also relied on knowing that `origin/main` was still the grounding commit.

**What the brief carried that I didn't need:** lessons 5, 6, 16 and 47, and the area list with its open counts.

**Couldn't place:** whether John or implementation should get the probe if implementation has its own Jira site. I chose John.
