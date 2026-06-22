# Recommendation baseline — lin597-prefix-baseline

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 61/66 (92%) |
| descent-correct rate | 66/66 (100%) |
| distinct expected next-actions | 5 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| breakdown|plan|research | LIN-215 | 5/6 (83%) |
| plan|research | LIN-202 | 10/12 (83%) |
| breakdown|implement | LIN-489 | 6/6 (100%) |
| implement | LIN-428 | 30/30 (100%) |
| breakdown | LIN-385 | 4/6 (67%) |
| review | LIN-428 | 6/6 (100%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 1 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 2858 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 2 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3798 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 3 | LIN-215@plan | LIN-215 | implement | plan/research/breakdown | ✗ | ✓ | 2377 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 4 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 2820 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 5 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3813 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 6 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3754 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 1 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2083 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 2 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2478 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 3 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2631 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 4 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 3312 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 5 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 1845 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 6 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2365 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 1 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2528 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 2 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2399 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 3 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2510 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 4 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2834 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 5 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2461 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 6 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2550 |  |
| LIN-385 | epic (descent → LIN-428) | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2484 |  |
| LIN-385 | epic (descent → LIN-428) | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2481 |  |
| LIN-385 | epic (descent → LIN-428) | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2911 |  |
| LIN-385 | epic (descent → LIN-428) | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2491 |  |
| LIN-385 | epic (descent → LIN-428) | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2971 |  |
| LIN-385 | epic (descent → LIN-428) | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2454 |  |
| LIN-389 | mid (descent → LIN-428) | 1 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2395 |  |
| LIN-389 | mid (descent → LIN-428) | 2 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2654 |  |
| LIN-389 | mid (descent → LIN-428) | 3 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2396 |  |
| LIN-389 | mid (descent → LIN-428) | 4 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2663 |  |
| LIN-389 | mid (descent → LIN-428) | 5 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3493 |  |
| LIN-389 | mid (descent → LIN-428) | 6 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2326 |  |
| LIN-428 | leaf (descent → LIN-428) | 1 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3109 |  |
| LIN-428 | leaf (descent → LIN-428) | 2 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3260 |  |
| LIN-428 | leaf (descent → LIN-428) | 3 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3723 |  |
| LIN-428 | leaf (descent → LIN-428) | 4 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2335 |  |
| LIN-428 | leaf (descent → LIN-428) | 5 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3153 |  |
| LIN-428 | leaf (descent → LIN-428) | 6 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2632 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 1 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 2820 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 2 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3693 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 3 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 3100 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 4 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 2928 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 5 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3795 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 6 | LIN-385@plan | LIN-385 | plan | plan/research | ✓ | ✓ | 3548 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 1 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2272 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 2 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 1965 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 3 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 3176 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 4 | LIN-385@breakdown | LIN-385 | plan | breakdown | ✗ | ✓ | 3113 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 5 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2039 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 6 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2195 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 1 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2570 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 2 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2871 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 3 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2269 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 4 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2180 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 5 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2456 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 6 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2472 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 1 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3005 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 2 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2264 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 3 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2535 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 4 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2548 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 5 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2464 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 6 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2845 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 1 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2163 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 2 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2739 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 3 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2448 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 4 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2635 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 5 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3080 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 6 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2979 |  |
