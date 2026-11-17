# Step 9-autopilot notes

**Written:** run-177 (run, in task-131, ended `done`); decision-178 (decision, scope task-131, about question-162, decision-160, decision-161, decision-166; no `to`): records the autopilot's own withdrawal of ruling lin-4469-witness and its reason, and that merge no longer waits on John for it. Nothing revised or handed on.

**Looked up:** `find --text lin-4469-witness`, to map the ruling to a record. It is question-162, which review had **already ended `withdrawn`** at 23:17:22, after seeing the Linear row. So I did not end it again (that would be refused). The decision is there so the withdrawal reason sits in "stands" and covers the stale "merge waits on lin-4469-witness" lines in decision-161 and decision-166. `find --to autopilot --state open` returned nothing.

**Refusals:** none.

**What the output relied on that neither the brief nor a query gave:** the Linear ruling id `lin-4469-witness` and whether it was still open on Linear (the brief has only review's account). Also that the folds were built and CI was green at the moment of withdrawal: the brief shows CI green on 05b592742 only through review's text.

**What the brief carried that the stage didn't need:** almost everything. Review's whole re-review account (about 9KB), the lessons, the plan text, decision-109..144, finding-175 and check-158. The step needed only decision-160 (the fold answer) and the question.

**Couldn't place:** check-149 (by autopilot, to review, about move size) is still open. Review ran and did not answer it, and this step did nothing about it. I left it open.
