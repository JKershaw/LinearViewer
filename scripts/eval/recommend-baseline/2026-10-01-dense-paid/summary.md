# LIN-1693 dense recommendation sweep — 2026-10-01 (RESCORED offline)

harness: `scripts/eval/eval-dense.mjs` · models: openai/gpt-5.6-sol, openai/gpt-5.4-mini, openai/gpt-5-mini, google/gemini-2.5-flash-lite, qwen/qwen3.6-flash · K=1 · cap $10
runs: 200 · spend: $6.6675 recorded (≤$7.0647 corrected bound)

**Production-fitness (errors count as failures): 133/200 (67%); lab view (errors excluded): 133/189 (70%) on 11 errors.**

| model | runs | errors | prod-acc (all) | prod small | prod dense | lab-acc (ok only) | LIN-2149 descent | prompt-ok | mean $/call | dense $/call | p50 lat | p90 lat |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openai/gpt-5.6-sol | 40 | 0 | 27/40 (68%) | 17/30 (57%) | 10/10 (100%) | 27/40 (68%) | 1/1 | 40/40 | $0.0896 | $0.1985 | 18542ms | 28195ms |
| openai/gpt-5.4-mini | 40 | 0 | 29/40 (73%) | 23/30 (77%) | 6/10 (60%) | 29/40 (73%) | 1/1 | 40/40 | $0.0257 | $0.0580 | 3379ms | 6463ms |
| openai/gpt-5-mini | 40 | 0 | 30/40 (75%) | 23/30 (77%) | 7/10 (70%) | 30/40 (75%) | 1/1 | 38/40 | $0.0139 | $0.0259 | 24246ms | 32234ms |
| google/gemini-2.5-flash-lite | 40 | 11 | 13/40 (33%) | 10/30 (33%) | 3/10 (30%) | 13/29 (45%) | 0/1 | 29/29 | $0.0046 → ≤$0.0104 | $0.0079 → ≤$0.0115 | 3399ms | 5720ms |
| qwen/qwen3.6-flash | 40 | 0 | 34/40 (85%) | 26/30 (87%) | 8/10 (80%) | 34/40 (85%) | 1/1 | 39/40 | $0.0098 | $0.0187 | 14863ms | 22654ms |

### Confusion by expected action (lab runs, current labels)

| model | expect | got | n |
|---|---|---|---|
| openai/gpt-5.6-sol | implement|implementation | implement | 4 |
| openai/gpt-5.6-sol | implement|implementation | plan-review | 1 |
| openai/gpt-5.6-sol | implement|implementation|plan | implement | 1 |
| openai/gpt-5.6-sol | plan|plan-review|research | research | 1 |
| openai/gpt-5.6-sol | breakdown | plan-review | 2 |
| openai/gpt-5.6-sol | close-out | close-out | 2 |
| openai/gpt-5.6-sol | review | review | 4 |
| openai/gpt-5.6-sol | implement | defer | 3 |
| openai/gpt-5.6-sol | implement | plan-review | 4 |
| openai/gpt-5.6-sol | implement | implement | 1 |
| openai/gpt-5.6-sol | blocked|implement|implementation | blocked | 1 |
| openai/gpt-5.6-sol | blocked|implement|implementation | implement | 1 |
| openai/gpt-5.6-sol | blocked | blocked | 2 |
| openai/gpt-5.6-sol | retrospective-audit | retrospective-audit | 4 |
| openai/gpt-5.6-sol | breakdown|plan|research | research | 1 |
| openai/gpt-5.6-sol | plan|research | research | 2 |
| openai/gpt-5.6-sol | breakdown|implement | plan-review | 1 |
| openai/gpt-5.6-sol | plan-review | plan-review | 2 |
| openai/gpt-5.6-sol | implementation | implement | 2 |
| openai/gpt-5.6-sol | plan | plan | 1 |
| openai/gpt-5.4-mini | implement|implementation | implementation | 1 |
| openai/gpt-5.4-mini | implement|implementation | implement | 2 |
| openai/gpt-5.4-mini | implement|implementation | breakdown | 1 |
| openai/gpt-5.4-mini | implement|implementation | retrospective-audit | 1 |
| openai/gpt-5.4-mini | implement|implementation|plan | implement | 1 |
| openai/gpt-5.4-mini | plan|plan-review|research | plan-review | 1 |
| openai/gpt-5.4-mini | breakdown | implement | 1 |
| openai/gpt-5.4-mini | breakdown | breakdown | 1 |
| openai/gpt-5.4-mini | close-out | close-out | 2 |
| openai/gpt-5.4-mini | review | review | 4 |
| openai/gpt-5.4-mini | implement | implement | 6 |
| openai/gpt-5.4-mini | implement | implementation | 2 |
| openai/gpt-5.4-mini | blocked|implement|implementation | implement | 1 |
| openai/gpt-5.4-mini | blocked|implement|implementation | close-out | 1 |
| openai/gpt-5.4-mini | blocked | context | 1 |
| openai/gpt-5.4-mini | blocked | plan | 1 |
| openai/gpt-5.4-mini | retrospective-audit | retrospective-audit | 4 |
| openai/gpt-5.4-mini | breakdown|plan|research | plan | 1 |
| openai/gpt-5.4-mini | plan|research | research | 1 |
| openai/gpt-5.4-mini | plan|research | plan | 1 |
| openai/gpt-5.4-mini | breakdown|implement | implement | 1 |
| openai/gpt-5.4-mini | plan-review | plan-review | 1 |
| openai/gpt-5.4-mini | plan-review | implement | 1 |
| openai/gpt-5.4-mini | implementation | implement | 2 |
| openai/gpt-5.4-mini | plan | plan | 1 |
| openai/gpt-5-mini | implement|implementation | implement | 4 |
| openai/gpt-5-mini | implement|implementation | plan-review | 1 |
| openai/gpt-5-mini | implement|implementation|plan | implement | 1 |
| openai/gpt-5-mini | plan|plan-review|research | research | 1 |
| openai/gpt-5-mini | breakdown | implement | 1 |
| openai/gpt-5-mini | breakdown | research | 1 |
| openai/gpt-5-mini | close-out | close-out | 2 |
| openai/gpt-5-mini | review | review | 4 |
| openai/gpt-5-mini | implement | implement | 7 |
| openai/gpt-5-mini | implement | plan-review | 1 |
| openai/gpt-5-mini | blocked|implement|implementation | → | 1 |
| openai/gpt-5-mini | blocked|implement|implementation | close-out | 1 |
| openai/gpt-5-mini | blocked | blocked | 1 |
| openai/gpt-5-mini | blocked | plan | 1 |
| openai/gpt-5-mini | retrospective-audit | retrospective-audit | 4 |
| openai/gpt-5-mini | breakdown|plan|research | research | 1 |
| openai/gpt-5-mini | plan|research | research | 2 |
| openai/gpt-5-mini | breakdown|implement | implement | 1 |
| openai/gpt-5-mini | plan-review | plan-review | 1 |
| openai/gpt-5-mini | plan-review | implement | 1 |
| openai/gpt-5-mini | implementation | implement | 2 |
| openai/gpt-5-mini | plan | plan | 1 |
| google/gemini-2.5-flash-lite | plan|plan-review|research | research | 1 |
| google/gemini-2.5-flash-lite | breakdown | implement | 1 |
| google/gemini-2.5-flash-lite | breakdown | plan | 1 |
| google/gemini-2.5-flash-lite | close-out | close-out | 1 |
| google/gemini-2.5-flash-lite | review | implement | 3 |
| google/gemini-2.5-flash-lite | review | review | 1 |
| google/gemini-2.5-flash-lite | implement | blocked | 1 |
| google/gemini-2.5-flash-lite | implement | implement | 3 |
| google/gemini-2.5-flash-lite | implement | plan | 1 |
| google/gemini-2.5-flash-lite | blocked|implement|implementation | review | 1 |
| google/gemini-2.5-flash-lite | blocked|implement|implementation | implement | 1 |
| google/gemini-2.5-flash-lite | implement|implementation | implement | 2 |
| google/gemini-2.5-flash-lite | blocked | review | 1 |
| google/gemini-2.5-flash-lite | blocked | blocked | 1 |
| google/gemini-2.5-flash-lite | retrospective-audit | close-out | 2 |
| google/gemini-2.5-flash-lite | retrospective-audit | review | 1 |
| google/gemini-2.5-flash-lite | retrospective-audit | implement | 1 |
| google/gemini-2.5-flash-lite | breakdown|plan|research | implement | 1 |
| google/gemini-2.5-flash-lite | plan|research | plan | 1 |
| google/gemini-2.5-flash-lite | breakdown|implement | implement | 1 |
| google/gemini-2.5-flash-lite | plan-review | `implement` | 1 |
| google/gemini-2.5-flash-lite | implementation | implement | 1 |
| google/gemini-2.5-flash-lite | plan | plan | 1 |
| qwen/qwen3.6-flash | implement|implementation | implement | 4 |
| qwen/qwen3.6-flash | implement|implementation | breakdown | 1 |
| qwen/qwen3.6-flash | implement|implementation|plan | implement | 1 |
| qwen/qwen3.6-flash | plan|plan-review|research | research | 1 |
| qwen/qwen3.6-flash | breakdown | breakdown | 1 |
| qwen/qwen3.6-flash | breakdown | plan-review | 1 |
| qwen/qwen3.6-flash | close-out | close-out | 2 |
| qwen/qwen3.6-flash | review | review | 4 |
| qwen/qwen3.6-flash | implement | implement | 8 |
| qwen/qwen3.6-flash | blocked|implement|implementation | context | 1 |
| qwen/qwen3.6-flash | blocked|implement|implementation | blocked | 1 |
| qwen/qwen3.6-flash | blocked | blocked | 2 |
| qwen/qwen3.6-flash | retrospective-audit | retrospective-audit | 4 |
| qwen/qwen3.6-flash | breakdown|plan|research | breakdown | 1 |
| qwen/qwen3.6-flash | plan|research | plan | 2 |
| qwen/qwen3.6-flash | breakdown|implement | implement | 1 |
| qwen/qwen3.6-flash | plan-review | plan-review | 1 |
| qwen/qwen3.6-flash | plan-review | implement | 1 |
| qwen/qwen3.6-flash | implementation | implement | 2 |
| qwen/qwen3.6-flash | plan | plan | 1 |

### Per expected-action (all models pooled, lab)

| expect | dense | descentExpect | accuracy |
|---|---|---|---|
| implement|implementation |  | LIN-APB-pos | 17/22 (77%) |
| implement|implementation|plan |  | LIN-APB-neg | 4/4 (100%) |
| plan|plan-review|research |  | LIN-APB-diverged | 5/5 (100%) |
| breakdown |  | FIX-830-pos | 2/10 (20%) |
| close-out |  | FIX-812-approve-ledger | 9/9 (100%) |
| review |  | FIX-812-noreview | 17/20 (85%) |
| implement |  | HAR-616 | 25/37 (68%) |
| blocked|implement|implementation | dense | LIN-1892 | 5/10 (50%) |
| blocked | dense | LIN-3059 | 6/10 (60%) |
| retrospective-audit | dense | LIN-3107 | 16/20 (80%) |
| breakdown|plan|research |  | LIN-215 | 4/5 (80%) |
| plan|research |  | LIN-202 | 9/9 (100%) |
| breakdown|implement |  | LIN-489 | 4/5 (80%) |
| plan-review |  | PR-1603-gated-recorded | 5/9 (56%) |
| implementation |  | PR-1603-clean-small | 0/9 (0%) |
| plan |  | PR-1603-request-changes-1 | 5/5 (100%) |

---

**Cost correction (1 Oct).** These summaries were generated by the pre-fix harness, which
dropped the spend of failed/retried attempts. The 11 `google/gemini-2.5-flash-lite` error
runs each made two paid attempts (first + one retry); none were written to
`runs.jsonl`/`calls.jsonl`, so gemini's recorded spend ($0.1327) and `$/call` ($0.0046)
exclude them. Recovery from OpenRouter is not possible for this sweep (no generation ids
recorded; per-model daily activity needs a provisioning key on a completed UTC day and the
key is shared with production, so it is contaminated). Bound: 22 lost attempts × gemini's
max observed per-call ($0.0181) ≤ **$0.3972**, giving corrected figures:

- main sweep recorded **$6.6675 → ≤$7.0647**;
- gemini mean **$0.0046 → ≤$0.0104**/call, dense **$0.0079 → ≤$0.0115**/run.

The other four models had zero error runs. Success-after-retry runs are not identifiable
from the committed rows; the §9 `usage_daily` cross-check bounds *all* unrecorded spend
that day, including any such loss, at ≤$0.0564, below the $0.3972 bound used here.
`runs.jsonl` is the raw record and is deliberately unchanged; this file is annotated, not
regenerated (RESCORE cannot recover spend that was never written). The recommendation is
unchanged.
