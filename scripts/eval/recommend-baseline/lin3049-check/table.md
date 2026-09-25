# Recommendation baseline — 2026-06-29

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 14/18 (78%) |
| descent-correct rate | 18/18 (100%) |
| distinct expected next-actions | 4 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| implement|implementation | LIN-APB-pos | 6/6 (100%) |
| implement|implementation|plan | LIN-APB-neg | 6/6 (100%) |
| plan|plan-review | LIN-APB-diverged | 2/6 (33%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| LIN-APB-pos | breakdown child of an approved parent plan, carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict (expect -> implement/implementation: the approved slice is completed prep and the gate does not re-fire) | 1 | LIN-APB-pos | LIN-APB-pos | implementation | implement/implementation | ✓ | ✓ | 2323 |  |
| LIN-APB-pos | breakdown child of an approved parent plan, carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict (expect -> implement/implementation: the approved slice is completed prep and the gate does not re-fire) | 2 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2175 |  |
| LIN-APB-pos | breakdown child of an approved parent plan, carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict (expect -> implement/implementation: the approved slice is completed prep and the gate does not re-fire) | 3 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2009 |  |
| LIN-APB-pos | breakdown child of an approved parent plan, carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict (expect -> implement/implementation: the approved slice is completed prep and the gate does not re-fire) | 4 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2153 |  |
| LIN-APB-pos | breakdown child of an approved parent plan, carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict (expect -> implement/implementation: the approved slice is completed prep and the gate does not re-fire) | 5 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2350 |  |
| LIN-APB-pos | breakdown child of an approved parent plan, carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict (expect -> implement/implementation: the approved slice is completed prep and the gate does not re-fire) | 6 | LIN-APB-pos | LIN-APB-pos | implementation | implement/implementation | ✓ | ✓ | 2572 |  |
| LIN-APB-neg | breakdown child with a plain acceptance-criteria description and NO recorded Approve on the decomposed ticket's own trail (expect -> plan (sometimes implement: a pre-existing flake on small single-surface tickets); must NOT be given a false session-fit or plan-review-due:no claim) | 1 | LIN-APB-neg | LIN-APB-neg | implementation | plan/implement/implementation | ✓ | ✓ | 1807 |  |
| LIN-APB-neg | breakdown child with a plain acceptance-criteria description and NO recorded Approve on the decomposed ticket's own trail (expect -> plan (sometimes implement: a pre-existing flake on small single-surface tickets); must NOT be given a false session-fit or plan-review-due:no claim) | 2 | LIN-APB-neg | LIN-APB-neg | implementation | plan/implement/implementation | ✓ | ✓ | 1787 |  |
| LIN-APB-neg | breakdown child with a plain acceptance-criteria description and NO recorded Approve on the decomposed ticket's own trail (expect -> plan (sometimes implement: a pre-existing flake on small single-surface tickets); must NOT be given a false session-fit or plan-review-due:no claim) | 3 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1586 |  |
| LIN-APB-neg | breakdown child with a plain acceptance-criteria description and NO recorded Approve on the decomposed ticket's own trail (expect -> plan (sometimes implement: a pre-existing flake on small single-surface tickets); must NOT be given a false session-fit or plan-review-due:no claim) | 4 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1897 |  |
| LIN-APB-neg | breakdown child with a plain acceptance-criteria description and NO recorded Approve on the decomposed ticket's own trail (expect -> plan (sometimes implement: a pre-existing flake on small single-surface tickets); must NOT be given a false session-fit or plan-review-due:no claim) | 5 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1642 |  |
| LIN-APB-neg | breakdown child with a plain acceptance-criteria description and NO recorded Approve on the decomposed ticket's own trail (expect -> plan (sometimes implement: a pre-existing flake on small single-surface tickets); must NOT be given a false session-fit or plan-review-due:no claim) | 6 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1939 |  |
| LIN-APB-diverged | breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice (expect -> plan/plan-review: the gate addition re-derives on visible divergence; `implementation` is the failure this case exists to catch) | 1 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review | ✗ | ✓ | 2108 |  |
| LIN-APB-diverged | breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice (expect -> plan/plan-review: the gate addition re-derives on visible divergence; `implementation` is the failure this case exists to catch) | 2 | LIN-APB-diverged | LIN-APB-diverged | implement | plan/plan-review | ✗ | ✓ | 2027 |  |
| LIN-APB-diverged | breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice (expect -> plan/plan-review: the gate addition re-derives on visible divergence; `implementation` is the failure this case exists to catch) | 3 | LIN-APB-diverged | LIN-APB-diverged | plan | plan/plan-review | ✓ | ✓ | 2322 |  |
| LIN-APB-diverged | breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice (expect -> plan/plan-review: the gate addition re-derives on visible divergence; `implementation` is the failure this case exists to catch) | 4 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review | ✗ | ✓ | 2338 |  |
| LIN-APB-diverged | breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice (expect -> plan/plan-review: the gate addition re-derives on visible divergence; `implementation` is the failure this case exists to catch) | 5 | LIN-APB-diverged | LIN-APB-diverged | implementation | plan/plan-review | ✗ | ✓ | 2830 |  |
| LIN-APB-diverged | breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice (expect -> plan/plan-review: the gate addition re-derives on visible divergence; `implementation` is the failure this case exists to catch) | 6 | LIN-APB-diverged | LIN-APB-diverged | plan | plan/plan-review | ✓ | ✓ | 2148 |  |
