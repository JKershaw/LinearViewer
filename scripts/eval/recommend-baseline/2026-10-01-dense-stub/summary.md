# LIN-1693 dense recommendation sweep — 2026-10-01 (STUB dry run)

harness: `scripts/eval/eval-dense.mjs` · models: openai/gpt-5.6-sol, openai/gpt-5.4-mini, openai/gpt-5-mini, google/gemini-2.5-flash-lite, qwen/qwen3.6-flash · K=1 · cap $10
runs: 200 · spend: $0.0000

| model | runs | action-acc | descent-acc | prompt-ok | errors | mean $/run | p50 latency |
|---|---|---|---|---|---|---|---|
| openai/gpt-5.6-sol | 40 | 35/40 (88%) | 40/40 (100%) | 40/40 | 0 | $0.0000 | 1ms |
| openai/gpt-5.4-mini | 40 | 35/40 (88%) | 40/40 (100%) | 40/40 | 0 | $0.0000 | 1ms |
| openai/gpt-5-mini | 40 | 35/40 (88%) | 40/40 (100%) | 40/40 | 0 | $0.0000 | 1ms |
| google/gemini-2.5-flash-lite | 40 | 35/40 (88%) | 40/40 (100%) | 40/40 | 0 | $0.0000 | 1ms |
| qwen/qwen3.6-flash | 40 | 35/40 (88%) | 40/40 (100%) | 40/40 | 0 | $0.0000 | 1ms |

### Per expected-action

| expect | descentExpect | accuracy |
|---|---|---|
| implement|implementation | LIN-APB-pos | 10/10 (100%) |
| implement|implementation|plan | LIN-APB-neg | 5/5 (100%) |
| plan|plan-review|research | LIN-APB-diverged | 5/5 (100%) |
| breakdown | FIX-830-pos | 10/10 (100%) |
| close-out | FIX-812-approve-ledger | 10/10 (100%) |
| review | FIX-812-noreview | 20/20 (100%) |
| implement | HAR-616 | 20/40 (50%) |
| implementation | LIN-3125 | 35/35 (100%) |
| blocked | LIN-3059 | 10/10 (100%) |
| retrospective-audit | LIN-3107 | 20/20 (100%) |
| breakdown|plan|research | LIN-215 | 5/5 (100%) |
| plan|research | LIN-202 | 5/10 (50%) |
| breakdown|implement | LIN-489 | 5/5 (100%) |
| plan-review | PR-1603-gated-recorded | 10/10 (100%) |
| plan | PR-1603-request-changes-1 | 5/5 (100%) |
