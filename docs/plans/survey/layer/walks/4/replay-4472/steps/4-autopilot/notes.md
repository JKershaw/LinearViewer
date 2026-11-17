# Notes: 4-autopilot (task-28)

**Written / changed**
- decision-66 (new, decision, scope task-28): extract the served duration/relative-time leaf first. Links `answers` question-63, `on` task-1@1 (the ask it quotes), `about` decision-32@1.
- question-63 (to John): ended `answered`, settled by autopilot as an engineering call.
- decision-32: revised to v2, dropping the stale "no serving change" phrase; its reason points to decision-66.
- finding-60 (to area-49, "not this task's: leaf extraction"): ended `handed-on` into decision-66, since the work now lands in this task.
- run-67: added, then ended `done`.

**Looked up**: question-63, decision-64 and decision-32 (what the question was about and what it contradicts); tasks (to see whether LIN-4471 has a record: it is task-27, done); records naming `SHARED_MODULES` (found decision-18, question-52 and finding-60); records linking to decision-32 (nothing is `on` it, so the revise makes nothing stale).

**Refusals**: none.

**Relied on outside brief/query**: that the `/lib/` serving path and allow-list checks had *landed* with LIN-4471. The store only shows task-27 as done and decision-18 as a design decision, with no change record or merged ref. Also John's standing direction that autopilot may settle engineering questions addressed to John. The ask says so, but nothing in the store says autopilot may answer a question whose `to` is John.

**Brief carried but not needed**: the plan piece's witness table, the module-semantics risks, the review's amended notes, and findings 50–59 and check-54 (all implementation detail).

**Couldn't place**: my real comment was posted on LIN-4463 (task-1), but I filed the decision in task-28, because its scope is this piece.
