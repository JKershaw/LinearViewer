# LIN-1693 dense recommendation sweep — 2026-10-01 (RESCORED offline)

harness: `scripts/eval/eval-dense.mjs` · models: openai/gpt-5.6-sol, openai/gpt-5.4-mini, openai/gpt-5-mini, google/gemini-2.5-flash-lite, qwen/qwen3.6-flash · K=1 · cap $10
runs: 40 · spend: $0.6051

**Production-fitness (errors count as failures): 29/40 (73%); lab view (errors excluded): 29/40 (73%) on 0 errors.**

| model | runs | errors | prod-acc (all) | prod small | prod dense | lab-acc (ok only) | LIN-2149 descent | prompt-ok | mean $/call | dense $/call | p50 lat | p90 lat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen/qwen3.6-flash | 20 | 0 | 16/20 (80%) | 0/0 (-) | 16/20 (80%) | 16/20 (80%) | 2/2 | 19/20 | $0.0170 | $0.0187 | 16783ms | 22085ms |
| openai/gpt-5-mini | 20 | 0 | 13/20 (65%) | 0/0 (-) | 13/20 (65%) | 13/20 (65%) | 2/2 | 19/20 | $0.0105 | $0.0115 | 27772ms | 36216ms |

### Confusion by expected action (lab runs, current labels)

| model | expect | got | n |
|---|---|---|---|
| qwen/qwen3.6-flash | implement|implementation | breakdown | 1 |
| qwen/qwen3.6-flash | implement|implementation | implement | 5 |
| qwen/qwen3.6-flash | blocked|implement|implementation | close-out | 2 |
| qwen/qwen3.6-flash | blocked|implement|implementation | blocked | 2 |
| qwen/qwen3.6-flash | blocked | context | 1 |
| qwen/qwen3.6-flash | blocked | blocked | 1 |
| qwen/qwen3.6-flash | retrospective-audit | retrospective-audit | 8 |
| openai/gpt-5-mini | implement|implementation | implement | 3 |
| openai/gpt-5-mini | implement|implementation | plan-review | 1 |
| openai/gpt-5-mini | implement|implementation | research | 2 |
| openai/gpt-5-mini | blocked|implement|implementation | close-out | 3 |
| openai/gpt-5-mini | blocked|implement|implementation | plan | 1 |
| openai/gpt-5-mini | blocked | blocked | 2 |
| openai/gpt-5-mini | retrospective-audit | retrospective-audit | 8 |

### Per expected-action (all models pooled, lab)

| expect | dense | descentExpect | accuracy |
|---|---|---|---|
| implement|implementation | dense | LIN-3125 | 8/12 (67%) |
| blocked|implement|implementation | dense | LIN-1892 | 2/8 (25%) |
| blocked | dense | LIN-3059 | 3/4 (75%) |
| retrospective-audit | dense | LIN-3107 | 16/16 (100%) |

---

**Cost correction (1 Oct).** Recorded spend **$0.6051** is unchanged: this run had **0
error runs**, so the pre-fix harness's dropped failed-attempt cost does not apply here.
Hidden success-after-retry runs are not identifiable from the committed rows (each
successful attempt records one call per hop), so the figure is exact for successful runs
and otherwise unquantified; the main sweep's bound covers the known gemini loss.
