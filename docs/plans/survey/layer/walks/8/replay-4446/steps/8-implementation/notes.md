# Notes: 8-implementation (task-8)

**Written:** change-52 (PR #2423 @24de9abc9, to review, about plan-26, decision-27/28/29); check-53 (to review: re-run serving tests against HEAD, about check-31); check-54 (to review: verify items the report doesn't mention); finding-55 (to John: slice result and named gaps, about check-15); run-56 (done).
**Ended:** check-19, check-34 `done` (witnessed in output), `--into` change-52. check-31 `handed-on` into check-53. check-32, 33, 35, 36 and finding-47..50 `handed-on` into check-54.
**Left open:** check-15 (John), finding-20/21/30 (project), plan-26, decisions.

**Lookups:** `find --kind change` and `--text 2423` (no existing change for the PR); `find --in task-8 --state open` (what was addressed to me); `find --kind run` (prior runs); `find --to project`, `--kind lesson` (nothing relevant); final `find --to implementation --state open --count` = 0.

**Refusal:** `{"error":"field about does not belong to change"}`: I had put `about` at the top level of the JSON. Fixed by moving it under `"links":{...}`, same time reused.

**Relied on but given by neither:** the output's evidence words ("mutation checks", "real-server 404s", "serving tests not run against HEAD") had to be mapped to check-31/32/34 by guessing. The output says nothing about findings 47–50, check-33, FORMAT_ALLOW, cost-format.test.js, the CLAUDE.md trim or the Waiting entries (finding-30), so I could not close them.

**Brief carried but not needed:** the full plan-26 text (about 8 KB), decision-24/27 detail, verdict-46 reasoning, the index entries finding-20/21.

**Couldn't place:** the CI-green claim, beyond the end reasons.
