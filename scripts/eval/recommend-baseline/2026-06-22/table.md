# Recommendation baseline — 2026-06-22

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 63/72 (88%) |
| descent-correct rate | 72/72 (100%) |
| distinct expected next-actions | 5 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| implement | HAR-616 | 46/48 (96%) |
| plan|research | LIN-385 | 2/6 (33%) |
| breakdown | LIN-385 | 3/6 (50%) |
| review | LIN-428 | 12/12 (100%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| HAR-149 | epic (descent → HAR-616) | 1 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2737 |  |
| HAR-149 | epic (descent → HAR-616) | 2 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | review | implement | ✗ | ✓ | 2926 |  |
| HAR-149 | epic (descent → HAR-616) | 3 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2254 |  |
| HAR-149 | epic (descent → HAR-616) | 4 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3536 |  |
| HAR-149 | epic (descent → HAR-616) | 5 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2481 |  |
| HAR-149 | epic (descent → HAR-616) | 6 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2997 |  |
| HAR-545 | mid (descent → HAR-616) | 1 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2217 |  |
| HAR-545 | mid (descent → HAR-616) | 2 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2923 |  |
| HAR-545 | mid (descent → HAR-616) | 3 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3016 |  |
| HAR-545 | mid (descent → HAR-616) | 4 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2405 |  |
| HAR-545 | mid (descent → HAR-616) | 5 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2938 |  |
| HAR-545 | mid (descent → HAR-616) | 6 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2437 |  |
| HAR-616 | leaf (descent → HAR-616) | 1 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2119 |  |
| HAR-616 | leaf (descent → HAR-616) | 2 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2824 |  |
| HAR-616 | leaf (descent → HAR-616) | 3 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3097 |  |
| HAR-616 | leaf (descent → HAR-616) | 4 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2392 |  |
| HAR-616 | leaf (descent → HAR-616) | 5 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2718 |  |
| HAR-616 | leaf (descent → HAR-616) | 6 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2423 |  |
| LIN-385 | epic (descent → LIN-428) | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2468 |  |
| LIN-385 | epic (descent → LIN-428) | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3211 |  |
| LIN-385 | epic (descent → LIN-428) | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2728 |  |
| LIN-385 | epic (descent → LIN-428) | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2735 |  |
| LIN-385 | epic (descent → LIN-428) | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2202 |  |
| LIN-385 | epic (descent → LIN-428) | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2436 |  |
| LIN-389 | mid (descent → LIN-428) | 1 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3469 |  |
| LIN-389 | mid (descent → LIN-428) | 2 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3748 |  |
| LIN-389 | mid (descent → LIN-428) | 3 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3355 |  |
| LIN-389 | mid (descent → LIN-428) | 4 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2376 |  |
| LIN-389 | mid (descent → LIN-428) | 5 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3190 |  |
| LIN-389 | mid (descent → LIN-428) | 6 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2976 |  |
| LIN-428 | leaf (descent → LIN-428) | 1 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3589 |  |
| LIN-428 | leaf (descent → LIN-428) | 2 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3853 |  |
| LIN-428 | leaf (descent → LIN-428) | 3 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2512 |  |
| LIN-428 | leaf (descent → LIN-428) | 4 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2887 |  |
| LIN-428 | leaf (descent → LIN-428) | 5 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2496 |  |
| LIN-428 | leaf (descent → LIN-428) | 6 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3521 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 1 | LIN-385@plan | LIN-385 | plan | plan/research | ✓ | ✓ | 3493 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 2 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 3054 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 3 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 2874 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 4 | LIN-385@plan | LIN-385 | plan | plan/research | ✓ | ✓ | 4378 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 5 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 2972 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 6 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 2913 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 1 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 2747 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 2 | LIN-385@breakdown | LIN-385 | plan | breakdown | ✗ | ✓ | 3432 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 3 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2158 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 4 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 1937 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 5 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 2550 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 6 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2193 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 1 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2657 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 2 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2964 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 3 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2827 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 4 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2272 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 5 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2261 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 6 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2290 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 1 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2648 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 2 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2320 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 3 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2826 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 4 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2934 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 5 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2739 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 6 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2269 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 1 | LIN-596@implement | LIN-596 | plan | implement | ✗ | ✓ | 3981 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 2 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2400 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 3 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2496 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 4 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3440 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 5 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3202 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 6 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2917 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 1 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2629 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 2 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2502 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 3 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2242 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 4 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2564 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 5 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 1765 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 6 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2190 |  |
