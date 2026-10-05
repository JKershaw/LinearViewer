# LIN-3107 — Jev routing-only evaluation report

- **Run at:** 2026-10-04T19:02:34.005Z
- **Jev model:** `typesafe/jev-1.13` · **incumbent:** `openai/gpt-5.6-sol`
- **Fixtures:** 14 (A=1 real frozen, B=8 recommend bundles, C=4 inline cases, D=1 widened) · **K=6**
- **Grading:** deterministic (no LLM judge); harness-side gold overrides only; frozen fixtures read-only.

## Decision rule
Jev is viable for step one if it is **statistically indistinguishable from or better than** the incumbent on the widened set, **or** a confidence-threshold hand-off reaches incumbent-level accuracy while Jev handles most calls alone. **A tie counts as a pass.**

## Result
**NO-GO** — branch `undefined`: undefined

## Heads-up on what each arm measures
- **Arm 1** = Jev choosing over the distilled state (the candidate).
- **Arm 2** = the incumbent (gpt-5.4-mini) choosing over the SAME distilled state — this is the **like-for-like step-one cost/latency comparator**.
- **Arm 3** = the incumbent over the raw state via the live `getRecommendation()`. Its latency and cost are the **full choose-and-write call** (it generates the whole `## Prompt`), so Jev's arm-1 cost is **not** a straight like-for-like replacement for arm 3's figure — arm 2 is.

## Hit rates (per run) and Wilson intervals
| arm | hits/runs | rate | Wilson 95% | loop-repeat | off-gold avoid |
|---|---|---|---|---|---|
| arm3 | 81/84 | 96.4% | [90.0%, 98.8%] | 0.0% | 0 |

## Paired comparison (per-fixture majority vote)

## Latency and cost
| arm | calls | latency mean/median/max (ms) | total cost (USD) | mean cost/call | in tok | out tok |
|---|---|---|---|---|---|---|
| arm3 | 84 | 4863/4008/14047 | $0.59182 | $0.007046 | 1683000 | 23072 |

## Calibration / confidence-threshold hand-off (arm 1 → arm 3)

## `defer` handling (eval-wide rule, identical across arms)
`defer` is eligible ONLY for a node with a real, non-terminal child (per `selectFocusSubtask`/`isTerminalState`);
a leaf `defer` is a miss for every arm; node `defer` is scored on the ACTION only. **Asymmetry:** arms 1/2 filter
`defer` at prompt time (it is withheld from the offered criteria on leaves), while arm 3's prompt-level vocabulary is
never filtered, so its defer-eligibility is checked at grading time. This is an eval choice, not the live contract:
lib/openrouter.js injects the full vocabulary into every prompt, leaves included.
- **arm3:** leaf defer 0/78, node defer 6/6
- **arm 3 `deferTo` agreement with `selectFocusSubtask` (diagnostic):** 6/6

## Normalization delta
`implementation` → `implement` rewrites observed in raw answers: **0** (both gold and every answer are normalized through the same seam).

## Gold overrides (harness-side, frozen files untouched)
- **LIN-385@breakdown** → expect ["plan-review"]: Third real criterion-(a) violation (binding review correction 1). Class B (fixtures/recommend/linearviewer.json), last touched 2026-06-22, before LIN-1603. A leaf with 0 children, 1 comment, no plan-review verdict; its plan says "Session-fit: does NOT fit one session. 4 sessions". The phrase grep in the plan missed it because it does not use the words "multiple session". Same LIN-1603 criterion-(a) provenance as LIN-571.

## Corpus provenance and exclusions
Verb-override corpus: `GET https://harbour.cat/api/proxy/search?q=verb%20override`, run 2026-09-26T21:16:42Z, grounded at `b5c528c4`, **50 hits (endpoint cap 50)**.

- Included: LIN-830
- **Cap disclosure:** The search endpoint caps at 50 results, so the true population of tickets carrying an autopilot verb-override note may exceed the 50 enumerated. Per the delegated ruling, the labelling budget is capped at this one reproducible query; real clean misses excluded by the cap (notably LIN-812's own two 2026-06-29 overrides) are named in their rows.

| identifier | disposition | rule | reason |
|---|---|---|---|
| LIN-2921 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-3020 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-2915 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-812 | excluded | RULING LABELLING CAP | CORRECTED (review): rule 3 is not the ground. Its only committed gold is the synthetic FIX-812-*; its own 2 real overrides (2026-06-29) are excluded under the delegated ruling's 'cap the case count and say where you cut' — a bounded labelling budget, stated plainly, not 'already covered'. _(corrected: was rule 3 (already covered))_ |
| LIN-2991 | excluded | 5 too entangled | Multiple overlapping override events / multi-PR / cross-repo / an aborted dispatch — no unambiguous single red moment. |
| LIN-830 | included | 7 real, clean, reconstructable, novel | Two recorded outcomes on its own trail; description authored once and never edited. Yields LIN-830@implement (override #1, 15:59:54Z) and LIN-830@review (override #2, 16:52:21Z). |
| LIN-977 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-1279 | excluded | 6 not reconstructable | Description edited in place after the override moment; the Linear API exposes no description revision history, so a byte-accurate freeze of what the engine saw is not reconstructable. |
| LIN-2649 | excluded | 5 too entangled | Multiple overlapping override events / multi-PR / cross-repo / an aborted dispatch — no unambiguous single red moment. |
| LIN-596 | excluded | 3 already covered | Gold already committed (fixtures/recommend/linearviewer.json LIN-596@implement). |
| LIN-976 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-2382 | excluded | 4 real engine miss, shape-duplicate — matches the 'research redo' CASES entry (scripts/eval-research-routing.mjs:447), already exercised | CORRECTED (review): rule 6 refuted — the research section (19:27) precedes the override (2026-08-29T19:30:38Z `research`→`implementation`), so the red-moment description is reconstructable; it is a real miss of the research-redo shape already exercised. _(corrected: was rule 6 (not reconstructable))_ |
| LIN-978 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-541 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-2720 | excluded | 2 explicit non-miss (first override) / 6 not reconstructable (second) | CORRECTED (review): first override is an operator pin ('not evidence of an engine miss'); the second, 2026-09-11T06:56:38Z, is a confirmed rule 6 (description pruned from 69,687 to 9,332 chars). Exclusion stands on those grounds. _(corrected: was flat rule 6)_ |
| LIN-1110 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-2361 | excluded | 6 not reconstructable | Description edited in place after the override moment; the Linear API exposes no description revision history, so a byte-accurate freeze of what the engine saw is not reconstructable. |
| LIN-2324 | excluded | 4 real engine miss, shape-duplicate — matches the 'research redo' CASES entry (scripts/eval-research-routing.mjs:447), already exercised | CORRECTED (review): rule 6 refuted — the research section (06:18) precedes the override (2026-08-28T06:22:29Z `research`→`review`); real miss of the research-redo shape already exercised. _(corrected: was rule 6 (not reconstructable))_ |
| LIN-2621 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-1656 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-1038 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-1197 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-1298 | excluded | no override event | ADDED (review): false-positive search hit — no comment contains 'verb override'; the only 'override' matches are CSS ('small overrides' 19:59:22Z; 'density override' 20:13:16Z). |
| LIN-973 | excluded | 6 not reconstructable | Confirmed (review): description was rewritten at 17:46, after the 17:41:54Z override. |
| LIN-1377 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-1206 | excluded | 4 shape-duplicate / 6 not reconstructable | Rule 4 stale-blocked-edge shape, and the description carries a later '## Implementation Plan (LIN-1206) — planned 2026-07-10' appended after the override. |
| LIN-1739 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-2713 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-2197 | excluded | 2 explicit non-miss (first) / 4 shape-duplicate (second) | First override 2026-08-22T11:29Z: 'not a demonstrable engine miss — the engine was not consulted'. Second 15:01Z is the stale-blocked-edge shape. |
| LIN-2773 | excluded | 4 real engine miss, shape-duplicate — the same shape is already exercised by another corpus member | Shape-duplicate of an already-committed member. |
| LIN-1026 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-2212 | excluded | 4 real engine miss, shape-duplicate — the same shape is already exercised by another corpus member | Shape-duplicate of an already-committed member. |
| LIN-777 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-1336 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | CORRECTED (review): this is rule 2, not rule 6 — at 2026-07-17T10:04:30Z the comment says 'human-authorised cap, not an engine miss'; its plan was appended before the override. _(corrected: was rule 6)_ |
| LIN-2127 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-2215 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-962 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-2214 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-827 | excluded | 5 too entangled | Multiple overlapping override events / multi-PR / cross-repo / an aborted dispatch — no unambiguous single red moment. |
| LIN-2667 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | CORRECTED (review): rule 2 — the first override was pinned on a 403 outage; the second is not a miss (PR merged 00:54:08, Done 00:55:07; the 01:01 comment says the override 'was written against a stale read'). _(corrected: was rule 6)_ |
| LIN-1684 | excluded | 2 explicit non-miss — the override comment states the engine was unavailable/failed, was not consulted, or was an operator/policy pin not correcting an observed miss | Override was a proactive/operator pin or the engine never got to choose. |
| LIN-873 | excluded | 6 not reconstructable | Description edited in place after the override moment; the Linear API exposes no description revision history, so a byte-accurate freeze of what the engine saw is not reconstructable. |
| LIN-1725 | excluded | 4 real engine miss, shape-duplicate — the same shape is already exercised by another corpus member | Shape-duplicate of an already-committed member. |
| LIN-1025 | excluded | 4 real engine miss, shape-duplicate — the committed LIN-420-landed-review.json / SYN-16 shape already exercises 'landed + CI-green + unmerged → review' | Shape-duplicate of an already-committed member. |
| LIN-573 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-1766 | excluded | 4 real engine miss, shape-duplicate — matches the LIN-596@implement / LIN-571 re-plan shape, already exercised | CORRECTED (review): rule 6 refuted — the plan has been the description since filing and precedes the override (2026-08-01T08:02:10Z `plan`→`implementation`); real miss of the re-plan shape already exercised. _(corrected: was rule 6 (not reconstructable))_ |
| LIN-1702 | excluded | no nameable state | No ticket identifiers named for the affected tasks; no frozen red moment is recoverable. |
| LIN-2385 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-776 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |
| LIN-275 | excluded | 1 mechanism/meta — discusses the override protocol, dispatch wire contract, or narration/rulings machinery itself, not a routing decision on that ticket | No routing decision recorded on the ticket itself. |

## Reproduce
```
OPENROUTER_API_KEY=<key> node scripts/eval/jev-routing-eval.mjs
DRY=1 ONLY=LIN-571 OUT_DIR=/tmp/jev-dry node scripts/eval/jev-routing-eval.mjs   # no-network pipeline check (non-canonical dir)
SELFTEST=1 node scripts/eval/jev-routing-eval.mjs            # recorder-correlation check, no spend
```
