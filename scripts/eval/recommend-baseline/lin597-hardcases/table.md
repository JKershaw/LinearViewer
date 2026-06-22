# Recommendation baseline — 2026-06-22

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 17/18 (94%) |
| descent-correct rate | 18/18 (100%) |
| distinct expected next-actions | 4 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| breakdown|plan|research | LIN-215 | 6/6 (100%) |
| plan|research | LIN-202 | 5/6 (83%) |
| breakdown|implement | LIN-489 | 6/6 (100%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 1 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3375 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 2 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 2777 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 3 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3479 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 4 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3141 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 5 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3061 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 6 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 2765 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 1 | LIN-202@research | LIN-202 | implementation | research/plan | ✗ | ✓ | 1830 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 2 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2205 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 3 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2086 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 4 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2476 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 5 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2908 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 6 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2264 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 1 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2227 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 2 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2702 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 3 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2437 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 4 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 3206 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 5 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 3132 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 6 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2616 |  |
