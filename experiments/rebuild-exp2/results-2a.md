# Experiment 2a results: a clean room through Harbour (LIN-3557)

15 October 2026. Scored against `prediction-2a.md` (committed in `f19efc24`, before launch) and alongside experiment 1's arms.

**The run:**

- **Clean room:** a frontier-tier sub-agent built the module in a sealed temporary folder, 16:58–17:09Z. The audit found 10 tool calls and 0 violations, and review re-ran the audit independently. The sub-agent added no tests.
- **Raw commit:** `3d76597f`, which passes 133/133.
- **Pipeline after the room:** the implementation stage's replay and classification found one regression and fixed it (`c712b2ea`, 5 tests). Review round 1 found two more, R1 and R2, which were fixed in `d2e0b8ff`. Review round 2 passed.
- **Merged:** `e7f7bd57` at 17:45Z. About 53 minutes from kickoff to merge.
- **Close-out:** blocked on a post-deploy Jira check that review asked for. Both rulings are pre-filled "accept without the live check" for John to press.
- **Follow-up:** LIN-3558 (Backlog) was filed for an existing bug the review surfaced.

## Shape

| | Original | A (exp 1) | B (exp 1) | 2a raw | 2a final |
|---|--:|--:|--:|--:|--:|
| Code lines | 322 | 302 | 275 | 282 | 284 |
| Comment lines | 457 | 273 | 306 | 315 | 318 |
| Functions | 60 | 64 | 60 | 73 | 73 |
| Longest function (code lines) | 43 | 37 | 29 | 28 | 29 |
| Deepest nesting | 4 | 3 | 2 | 2 | 2 |
| Decision points | 153 | 142 | 127 | **110** | **110** |
| Worst function's decision points | 28 | 26 | 24 | **12** | **12** |
| Functions over 10 decision points | 4 | 4 | 3 | 3 | 3 |
| Regular expressions | 29 | 26 | 16 | 18 | 18 |
| Planted-fault score (original 133 tests) | 87.0% | 86.8% | 85.4% | 82.0% | 82.2% |

On structure, 2a is the flattest version yet. Its worst function has 12 decision points against the original's 28, and it has the fewest decision points in total. The pipeline's fixes added only 2 code lines.

The planted-fault score is the lowest of the five. More small functions means more places a fault can hide from tests that were written for the old structure (inference).

## Behaviour (replay of 8,916 public inputs and 1,037 private real texts against the original)

| | B (exp 1) | 2a raw | 2a final |
|---|--:|--:|--:|
| Differing cells (public) | 3,477 | 3,605 | 3,343 |
| Groups (public) | 338 | 140 | 128 |
| Of which test-derived inputs | 54 cells | 48 | 45 |
| Real texts differing | 1 document | 1 document | 1 document |

**The one real-text difference** is a long code block (about 15,000 characters):

- the original drops its language;
- B keeps it, a fix;
- **2a raw turns the whole block into prose,** which is review's R1 regression;
- **2a final keeps it as code, with its language,** a fix.

Review's catch mattered on real data.

**What the pipeline caught:**

- **Implementation's classification** found 1 regression: a trailing-whitespace rule or closing fence made the writer emit documents its own gate refuses.
- **Review** found 2 more that the classification had folded into a "fix":
  - **R1:** an unclosed code fence became prose, and Markdown inside the code got reformatted, e.g. `__init__` lost its underscores;
  - **R2:** an indented rule became a paragraph.

  Review ran its own 200,000-input fuzz, checked the fixes against mutations, and audited isolation independently.

**What it missed: links with brackets in the URL.** The clean room produced exactly the same display regression as arm B, a broken link in Harbour. Implementation classified it as a "harmless escape change". Review noted that the href output had changed, but judged it only on the Jira round trip. Neither rendered the Markdown the way Harbour's dashboard does. **It's live on `main` now** (checked by hand through `marked`). Experiment 1's classification caught it only because that agent rendered every difference through `marked`.

## Against the prediction

| Prediction | Actual | |
|---|---|---|
| Room and launch without a hitch (≈75%) | yes | ✓ |
| Audit 0 violations (≈80%) | 0 of 10 | ✓ |
| A `DECISION:` at some point (≈40%) | yes, at close-out (the post-deploy Jira check) | ✓, for a different reason |
| Merges without John (≈60%) | merged; Done waits on John's ruling | ½ |
| 6–12 sessions, 60–150 min | 13 dispatches; 53 min to merge | faster |
| Raw code lines 240–330 | 282 | ✓ |
| Raw passes 133 (≈85%) | yes | ✓ |
| Raw 100–400 groups | 140 | ✓ |
| The bracket regression recurs (≈50%) | yes | ✓ |
| Known regressions fixed before merge (≈70%) | 3 regressions fixed; the bracket display missed | ✗ on the one that mattered most |
| Final code lines 260–340 | 284 | ✓ |
| Nesting and decision points at or below A (≈70%) | well below: 110 against 142 | ✓ |
| Planted-fault score 84–89% | 82.2% | ✗ (lower) |
| Added tests 3–15 | 5 | ✓ |
| "Classification is the main risk; a regression could be misclassed as a fix" | that's exactly what happened, twice (R1 by implementation, brackets by both stages) | ✓ |

## What it tells us

1. **A clean room runs through Harbour, simply.** A sealed folder, a sub-agent and a transcript audit worked first time, and review re-verified the isolation on its own.
2. **Harbour's pipeline did not make it worse; it made it better.** Review caught two regressions the clean room introduced and the implementation stage misclassified, one of them visible on real data. The structure stayed as clean as the raw output. This counters the worry that Harbour "can most likely only influence it negatively". Here, the influence was corrective.
3. **The weak point is judgement over differences, not the rebuild.** Every regression was visible in the replay. The misses were classification calls, made without looking at the output the way users see it.
4. **The contract is missing display.** The same bracket regression appeared in two independent clean rooms. The spec and tests describe the round trip, never what Harbour shows. That's precisely what 2b's test review is for.
5. **Two clean-room samples agree on structure.** B and 2a raw are both much flatter than the original and land at similar sizes (275 and 282 code lines). Their regressions overlap (brackets) and also differ (R1 only in 2a). Run-to-run variance is real, which is another argument for the contract over luck.
