# LIN-3309 pass bar — raw outputs

Model: `openai/gpt-5.6-sol`, the workspace's `recommend` setting (every served-model field in these files reads it, or `code-route` where code settled the route and no model was called). Harness: `scripts/eval/jev-routing-eval.mjs` with `ARMS=3 K=6 ROUTING_ONLY=1`, the shipping routing-only path (`getRecommendation({briefWriter, deadline: 0})`). Every column uses this branch's harness and fixtures; only `lib/` differs:

- `HEAD` = `origin/main` `98f766cc`
- `prev` = this branch's previous head `654b417e` (the narrowed version)
- `PR` = `b4190f03` (agent notes are not replies; a landed implementation ends plan-review routing)

| folder | what |
|---|---|
| `focused-head/`, `focused-prev/`, `focused-pr/` | the 22-fixture pass-bar set (`ONLY=NSC-,PR-1603-`) |
| `sweep-pr/` | the full 92-fixture corpus on the PR (includes a second sample of the 22) |
| `sweep-head/` | HEAD on the other 70 fixtures, run as 6 parallel chunks and merged by fixture id (`results.json`; one `report-chunk-N.md` per chunk) |

## Focused pass-bar set (K=6)

| fixture (gold) | HEAD 98f766cc | prev 654b417e | this PR b4190f03 |
|---|---|---|---|
| NSC-LIN-2950-R2 (`plan`) | 0/6 (blocked×6) | 6/6 (plan×6) [code] | 6/6 (plan×6) [code] |
| NSC-LIN-2954 (`blocked`) | 6/6 (blocked×6) | 6/6 (blocked×6) | 6/6 (blocked×6) |
| NSC-LIN-2950-GO (`plan`) | 2/6 (blocked×4, plan×2) | 6/6 (plan×6) | 6/6 (plan×6) |
| NSC-LIN-2950-HOLD (`blocked`) | 6/6 (blocked×6) | 6/6 (blocked×6) | 6/6 (blocked×6) |
| NSC-LIN-2950-NOTE (`blocked`) | 6/6 (blocked×6) | 6/6 (blocked×6) | 6/6 (blocked×6) [code] |
| NSC-LIN-2950-LATEST-REPLY (`plan`) | 3/6 (blocked×3, plan×3) | 6/6 (plan×6) | 6/6 (plan×6) |
| NSC-LIN-3309-REVISED (`plan-review`) | 0/6 (plan×6) | 6/6 (plan-review×6) [code] | 6/6 (plan-review×6) [code] |
| NSC-LIN-3309-NOW (`plan`) | 6/6 (plan×6) | 6/6 (plan×6) [code] | 6/6 (plan×6) [code] |
| NSC-LIN-3309-R2-REV (`plan-review`) | 0/6 (blocked×6) | 6/6 (plan-review×6) | 6/6 (plan-review×6) [code] |
| NSC-PR-1603-RC1-REV (`plan-review`) | 0/6 (plan×6) | 6/6 (plan-review×6) [code] | 6/6 (plan-review×6) [code] |
| NSC-PR-1603-RC1-HOLD (`blocked`) | 6/6 (blocked×6) | 6/6 (blocked×6) | 6/6 (blocked×6) |
| NSC-PR-1603-RC1-FC-RULING (`plan`) | 6/6 (plan×6) | 6/6 (plan×6) | 6/6 (plan×6) |
| NSC-LIN-2950-GO-REV (`plan-review`) | 0/6 (blocked×5, breakdown×1) | 6/6 (plan-review×6) | 6/6 (plan-review×6) |
| NSC-PR-1603-APPROVE-LANDED (`review`) | 6/6 (review×6) | 6/6 (review×6) | 6/6 (review×6) |
| NSC-LIN-3309-LANDED (`review`) | 6/6 (review×6) | 6/6 (review×6) | 6/6 (review×6) |
| PR-1603-gated-recorded (`plan-review`) | 6/6 (plan-review×6) | 6/6 (plan-review×6) | 6/6 (plan-review×6) |
| PR-1603-gated-rederive (`plan-review`) | 6/6 (plan-review×6) | 6/6 (plan-review×6) | 6/6 (plan-review×6) |
| PR-1603-clean-small (`implement`) | 6/6 (implement×6) | 6/6 (implement×6) | 6/6 (implement×6) |
| PR-1603-verdict-approve (`implement`) | 6/6 (implement×6) | 6/6 (implement×6) | 6/6 (implement×6) |
| PR-1603-request-changes-1 (`plan`) | 6/6 (plan×6) | 6/6 (plan×6) [code] | 6/6 (plan×6) [code] |
| PR-1603-request-changes-2 (`plan`) | 0/6 (blocked×6) | 6/6 (plan×6) [code] | 6/6 (plan×6) [code] |
| PR-1603-request-changes-3 (`blocked`) | 6/6 (blocked×6) | 6/6 (blocked×6) [code] | 6/6 (blocked×6) [code] |
| **aggregate** | **89/132 (67.4%)** | **132/132 (100.0%)** | **132/132 (100.0%)** |

The full sweep's second, independent K=6 sample of these 22 on the PR also reads 132/132.

## The rest of the corpus (70 fixtures, K=6): the regression check

HEAD 352/420 (83.8%) → PR 360/420 (85.7%), +1.9 points. No fixture drops by any amount. Changed fixtures: FIX-830-neg 1→3, LIN-2944 2→6, LIN-3059 5→6, SYN-22 5→6.

Whole corpus: HEAD 441/552 (79.9%) → PR 492/552 (89.1%).
