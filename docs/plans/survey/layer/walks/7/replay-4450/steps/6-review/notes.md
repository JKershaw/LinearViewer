# 6-review notes (task-60, LIN-4450)

**Written:** verdict-100 (review, approve-with-notes, on change-84@2; the output said "Approve — conditional on close-out discharging the ledger"); finding-101 → close-out (oversize log-line test fix); check-102 → task-62 (live property PUT/GET); check-103 → task-62 (first Jira-native dispatch); run-104 (done).
**Revised:** check-90 (sharper right/wrong condition, `3.` added); finding-91 → close-out (v2 no-op, v3 readdressed); change-84 → close-out (v3 no-op, v4 readdressed).
**Ended done:** finding-70, finding-74, finding-99.

**Looked up:** open records addressed to review; `show --task task-60`; check-69, check-90, finding-75/79/22, change-84 (to avoid duplicating the live-digest check); existing verdicts (none from review to supersede); open close-out records.

**Refusals:** none. One silent miss: `revise … --to close-out` was accepted, but `--to` was ignored and `to` stayed `review`. I redid both with `{"to":"close-out"}` in the JSON. Those two writes come after the run ended (:37, :38).

**What the output relied on that neither brief nor query gave:** the PR diff and the code at f9fa4a80c (the 9 getIssue calls, workspace-api-audit.js:35's predicate, test line ~262, the exact log string), local test runs and mutations, `git log -30` regression history, origin/main cfd152fa4 merge state, CI job list, the LIN-4445 departure comment text.

**Brief carried but not needed:** the squash-commit message and area-notes diff, with its close-out commit, which postdates the review; the lessons 5/6/16/47; area counts; the full asked text of task-53.

**Couldn't place:** "conditional approve" (no such outcome); the rollback note (put in verdict reasoning); review never ruled on finding-91's source-map point.
