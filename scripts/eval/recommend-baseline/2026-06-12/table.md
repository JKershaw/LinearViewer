# Recommendation baseline — 2026-06-12

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, NOT deployed proxy)

| target | role | run | descent path | terminal | action | prompt len | stop |
|---|---|---|---|---|---|---|---|
| LIN-385 | epic | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | research | 2903 |  |
| LIN-385 | epic | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | research | 2641 |  |
| LIN-385 | epic | 3 | LIN-385 → LIN-389 | LIN-389 | breakdown | 2681 |  |
| LIN-385 | epic | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | research | 3062 |  |
| LIN-385 | epic | 5 | LIN-385 → LIN-389 | LIN-389 | breakdown | 2142 |  |
| LIN-385 | epic | 6 | LIN-385 | LIN-385 | implement | 3787 |  |
| LIN-389 | mid | 1 | LIN-389 | LIN-389 | breakdown | 3236 |  |
| LIN-389 | mid | 2 | LIN-389 → LIN-428 | LIN-428 | research | 3699 |  |
| LIN-389 | mid | 3 | LIN-389 → LIN-428 | LIN-428 | research | 2807 |  |
| LIN-389 | mid | 4 | LIN-389 → LIN-428 | LIN-428 | plan | 2670 |  |
| LIN-389 | mid | 5 | LIN-389 | LIN-389 | breakdown | 2560 |  |
| LIN-389 | mid | 6 | LIN-389 → LIN-428 | LIN-428 | plan | 3451 |  |
| LIN-428 | leaf (direct cross-check) | 1 | LIN-428 | LIN-428 | research | 2924 |  |
| LIN-428 | leaf (direct cross-check) | 2 | LIN-428 | LIN-428 | research | 2696 |  |
| LIN-428 | leaf (direct cross-check) | 3 | LIN-428 | LIN-428 | research | 3163 |  |
| LIN-428 | leaf (direct cross-check) | 4 | LIN-428 | LIN-428 | plan | 4013 |  |
| LIN-428 | leaf (direct cross-check) | 5 | LIN-428 | LIN-428 | research | 3246 |  |
| LIN-428 | leaf (direct cross-check) | 6 | LIN-428 | LIN-428 | research | 3494 |  |

## Deferred (config-blocked)

- **Harbour**: no proxy token (deferred — supply token+base via env) — HAR-149, HAR-545, HAR-616
