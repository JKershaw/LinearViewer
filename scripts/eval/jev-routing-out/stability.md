# LIN-3107 — run-to-run stability of the go/no-go

The harness is stochastic across runs (the incumbent uses `temperature: 0` but the provider is
not fully deterministic; Jev exposes probabilities/confidence but samples an answer). Three
full widened-set runs were taken. The **K=5 run is canonical** (`results.json` / `report.md`);
the two K=3 runs are recorded here as a stability check.

**Provenance.** Only the canonical K=5 run has committed raw data (`results.json` / `report.md`,
`dryRun:false`, K=5). The two K=3 rows below are **recorded summaries only** — their raw per-run
results are not committed, so beyond the summary rows shown here they are not independently
reproducible from this repo. They are a stability check on the decision-rule branch, not a second
canonical run.

| run | K | arm1 (Jev) | arm2 (incumbent+distilled) | arm3 (incumbent+raw) | arm1-vs-arm3 McNemar p | go/no-go |
|---|---|---|---|---|---|---|
| 1 | 3 | 132/198 (66.7%) | 133/198 (67.2%) | 158/198 (79.8%) | 0.006 | **NO-GO** (worse) |
| 2 | 3 | 129/198 (65.2%) | 133/198 (67.2%) | 152/198 (76.8%) | 0.024 | **PASS (marginal)** via calibrated hand-off (threshold 0.45, 72% solo, combined 77.3% ≥ 76.8%) |
| 3 | **5** | **218/330 (66.1%)** | **216/330 (65.5%)** | **261/330 (79.1%)** | **0.006** | **NO-GO** (worse) |

The two K=3 runs disagree on the decision-rule branch: run 2's marginal hand-off pass (a
+0.5 pt combined-accuracy edge at a 28% hand-back rate) is within noise of the incumbent. The
higher-powered K=5 run resolves this: Jev is **13.0 pts worse** than the incumbent
(Newcombe paired-difference Δ = −0.167, 95% CI [−0.267, −0.067], McNemar p = 0.006), and **no
confidence threshold reaches incumbent accuracy while Jev solos most calls**. The K=5 NO-GO
agrees with the first K=3 run; the marginal K=3 pass does not survive more data.

A consistent, more useful signal sits alongside the headline: **arm1 ≈ arm2** across all runs
(K=5: 66.1% vs 65.5%, McNemar p = 0.579, Δ = +0.045 [−0.06, +0.149]). The incumbent *model* on
the distilled state performs about as well as Jev on it. But arms 2 and 3 differ in **two** ways
at once — the state format (distilled vs raw) **and** the whole live routing procedure: arm 3's
prompt carries `lib/prompts/meta-prompt-template.js`'s Steps 0–4 ("CRITICAL: Sequential Workflow
Decision"), while arms 1 and 2 receive only the per-action `aiHint` criteria. Eight of the twelve
cases where arm 1 missed and arm 3 hit are also arm-2 misses, and they are mostly Step-0/Step-1
review and research-vs-plan calls — the missing procedure explains those as well as the state
format does. This design therefore cannot separate a model-only from a representation-only from a
procedure-only cause. The supported statement is narrower: the incumbent's ~13-pt advantage belongs
to the **live meta-prompt package — raw state plus its Step 0–4 routing procedure — not the model**.
Jev does not close that gap, so the routing-only split is not supported on this evidence. (A
variant giving Jev the Step 0–4 procedure is untested and is John's call; only a GO would have
opened that follow-up.)
