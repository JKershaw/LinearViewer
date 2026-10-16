# Experiment 1 results: rebuilding `lib/providers/jira/adf.js`

15 October 2026. Scored against `prediction.md` and `scoring-plan.md`, both committed before launch (`782783c0`).

**The question (John):** does "the rebuild idea" have "legs", and "how to actually perform it in practice". **Success (John):** "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**The two arms:**

- **A (informed):** a regular Harbour ticket, LIN-3556. It merged as `269a6189` (PR #1891).
- **B (clean room):** one agent working from `SPEC.md` (every comment in the original, with the code removed) and the 133 codec tests. Its tool calls were audited: all 16 stayed inside its folder, with no git and no web.

## Headline

**Both rebuilds work.** Each passes all 17,019 unit tests and all 19 Jira end-to-end tests. They show two different characters.

- **A is a faithful, modest clean-up.** It behaves *identically* to the original on all 59,718 replayed calls, including malformed input. It's a little cleaner (code −6%, nesting 4→3). It ran through Harbour in 37 minutes with no human input.
- **B is cleaner by every measure.** Code is down 15%, nesting 4→2, regexes 29→16, and it never throws. It also fixes many of the original's bugs. But it has one real regression that the whole test suite missed: links whose URL contains brackets no longer display as links.

## Utility: does it match what came before?

| | A | B |
|---|---|---|
| Full unit suite (at `2a07f3ea`, with the version in place) | 17,019/17,019 | 17,019/17,019 |
| Jira e2e spec | 19/19 (CI) | 19/19 |
| Replay differences vs original (59,718 calls) | **0** | 3,479 cells in 340 groups |
| …on the 1,037 real ticket texts | 0 | 2 cells, both fixes |
| New tests added | 0 | 10, all of which pass on the original |

**B's 340 groups, classified** (full table in `classify.md`):

| Class | Groups | Cells |
|---|--:|--:|
| Malformed input only. The original throws; B degrades. B is worse in 2 cases. | 79 | 900 |
| An original bug fixed by B | 237 | 1,339 |
| A regression in B | 18 | 1,217 |
| Harmless | 5 | 22 |
| Unclear: John's call | 1 | 1 |

**What matters to a user:**

- **Regression: a link with brackets in its URL.** `…/wiki/Foo_(bar)` shows as raw text with a broken link. Checked by hand through `marked`. All 7 of the test suite's own bracket fixtures behave this way; the tests pass because they check the round trip, not the display. The fix is two regexes.
- **Regression: four-backtick code fences** get the language `` ` ``.
- **Fixes:**
  - a smart-link card's URL glued onto the next paragraph;
  - a code block's language lost in some fence layouts (the only real-text difference);
  - Jira's own empty list items changing on every save;
  - throwing on malformed input.
- **The unclear call:** B writes an empty list, heading or quote line as empty content, where the original wrote an empty text node, which ADF forbids. If Jira ever *stored* such nodes, B's gate would refuse later in-app edits of those descriptions. One test write against a real Jira site would settle it.

## Cleaner: cognitively simpler, less room for bugs, easy to maintain

| Measure | Original | A | B |
|---|--:|--:|--:|
| Code lines | 322 | 302 | 275 |
| Comment lines | 457 | 273 | 306 |
| Functions | 60 | 64 | 60 |
| Longest function (code lines) | 43 | 37 | 29 |
| Deepest nesting | 4 | 3 | 2 |
| Decision points | 153 | 142 | 127 |
| Worst function's decision points | 28 | 26 | 24 |
| Functions over 10 decision points | 4 | 4 | 3 |
| Regular expressions | 29 | 26 | 16 |
| Planted faults on every line: total | 645 | 613 | 451 |
| Planted faults: survived | 84 | 81 | 66 |
| Planted faults: score (killed + timeout) | 87.0% | 86.8% | 85.4% |

**The change probe** (nested bullet lists). A fresh agent made the same change to each version, without knowing which version it had.

| | Original | A | B |
|---|--:|--:|--:|
| `adf.js` lines added / removed | +122 / −25 | +80 / −16 | +80 / −19 |
| Separate places changed in `adf.js` | 15 | 11 | 13 |
| Time | ~11 min | ~6½ min | ~10 min |
| Probe agent's complaint | "refusal rules are spread across a docstring, a per-node switch and a document-edge check" | the gate's per-node rules can't see context | "whitespace trimming happens at several separate layers" |

All three probe agents independently found the same existing gaps: the gate permits a list holding a bare paragraph, and an empty list mid-document, and neither survives the round trip. That's one run per version, so treat small gaps as noise. The difference in lines added (about a third less for both rebuilds) is the one large, consistent signal.

## Process

**A, through Harbour:**

- 37 minutes from kickoff to merge.
- 5 worker sessions: plan, implementation, review, close-out, plus the autopilot.
- Models: plan, implementation and close-out on the mid tier; review and autopilot on the frontier tier. Implementation took 10½ minutes.
- One review round, which caught a dropped rationale; close-out restored it.
- No rulings, no tests added, no follow-up tickets.
- **It went against one instruction.** The ticket said not to build a comparison harness, but implementation ran a throwaway old-versus-new fuzz (120,000 cases) and committed nothing from it. That is very likely why A is exactly equivalent: the informed arm used the old code as an oracle.
- Cost reads as unpriced, because `lib/model-pricing.js` has no rows for these models. That's the known gap in `proposals.md`.

**B, clean room:** one session, 22 minutes measured (the agent estimated 45–60). Model: this session's subagent default.

The comparison is therefore "informed plus Harbour's pipeline" against "clean room, one session". It is not a clean comparison of informed against clean room.

## Against the prediction

| Prediction | Actual | |
|---|---|---|
| A merges without John (≈80%) | merged | ✓ |
| A: 5–10 sessions, 45–120 min | 5 sessions, 37 min | faster |
| A: 1–2 review rounds; `DECISION:` ≈25% | 1 round, none | ✓ |
| A adds tests (≈60%) | none | ✗ |
| A code lines 230–290 | 302 | ✗ (more timid) |
| A comment lines 150–300 | 273 | ✓ |
| A worst function ≤15; functions over 10 → 1–3 | 26; 4 | ✗ |
| A planted faults 82–92% | 86.8% | ✓ |
| A replay: 0 on test inputs; 0–5 unpinned groups | 0; 0 | ✓ |
| B passes the codec tests (≈90%), full suite (≈75%) | both | ✓ |
| B code lines 220–400 | 275 | ✓ |
| B 3–20 groups of unpinned differences | 340 (237 of them fixes) | ✗ far more, mostly fixes |
| B planted faults 78–92% | 85.4% | ✓ |
| B 30–90 min | 22 min | faster |
| The rebuilds take the change with fewer edits; a modest gap | about a third fewer lines added | ✓ |
| "The main lesson is about the tests" | B's bracket regression passed all 17,019 tests | ✓ |

## What this says about rebuilding

1. **The idea has legs.** Two independent rebuilds both kept the module working. One was a plain Harbour ticket that merged in 37 minutes with no human input.
2. **The two approaches find different things.**
   - **Informed rebuilding is safe but timid.** It used the old code as an oracle, matched it exactly (bugs included), and kept the old structure's complexity: it still has 4 functions over 10.
   - **Clean-room rebuilding is bolder.** It's cleaner and fixes real bugs, but it drifts wherever the tests don't look.
3. **A clean room is a test-gap detector.** B's one serious regression shows exactly where the tests are blind: they check that links round-trip, not how they display. The informed arm can never reveal that, because it copies behaviour.
4. **A rebuild is as safe as the boundary tests, and "strong" isn't the same as "complete".** These tests catch 87% of planted faults, and still missed the bracket display.
5. **The rebuilt code was easier to change.** Both rebuilds took a real feature with about a third less new code. That's one probe each, so it's suggestive rather than proven.

## Open for John

- **Keep A on `main` (as now), or swap in B?** Swapping in B would need the bracket fix and the empty-node call first.
- **B's fixes are worth having either way:**
  - the smart-link gluing;
  - the lost code-block language;
  - empty list items changing on save;
  - plus the pre-existing gate gaps all three probes found.
- **The method for the next rung.** One option combines the strengths: rebuild fresh (clean-room freedom), then replay against the old code before merging, and judge each difference the way this experiment did.
