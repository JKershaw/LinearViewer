# Notes: 9-autopilot (task-128)

**Written:** run-173 (run, stage autopilot; account = copy of `real/9-autopilot.md`), linked `about` question-158, ended `done`. Nothing else written, revised or ended.

**Looked up:** `find --kind question --in task-128` and `find --text lin-4469-witness` to find the ruling the output withdraws: question-158 (to John). `get question-158` showed it already ended `withdrawn` at 23:17:23 by review (into verdict-168), after the output's 23:17:16. Ending it again would be refused and would repeat what is there. `find --to autopilot --state open` came back empty.

**Refusals:** `add run {... "about":["question-158"]}` → `{"error":"field about does not belong to run"}`. Added the run without it, then used `link run-173 about question-158`.

**Relied on outside brief/queries:** the store id of the ruling. The brief names `lin-4469-witness` only in passing (finding-172, verdict-168's reasoning). It never shows question-158, because the question was already ended and so is left out of parts 3, 4 and 7. Finding it took a text search. The output also relied on John's lin-4469-cuts answer (decision-156) and CI being green, which the brief did carry.

**Brief carried but not needed:** almost all of it: the full ask and plan, decisions 106 to 137, the project counts, findings 143 and 164, the Fix 1 and 2 findings, check-162 and verdict-168's long reasoning. The stage only withdrew one ruling.

**Couldn't place:** the 7-second gap. The output's withdrawal (23:17:16) comes before review's record of it (23:17:23), but review's record names review 042f607d as the source, not autopilot. I left it as it is.
