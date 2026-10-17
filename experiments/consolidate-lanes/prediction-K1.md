# Prediction for K1: untie Agent API ↔ pages by moving isBlocked to state-map

This prediction was written before the ticket was dispatched. Tree: `47d87055` (origin/main). Guide: `scripts/code-shape/areas.json` at `47d87055`, used unchanged for every run.

## The change being predicted

- `isBlocked`, with its doc comment, moves from `lib/tree.js:181-202` to `lib/providers/state-map.js`, after `isCompleted`. The body is byte-identical.
- `lib/tree.js` adds `isBlocked` to its existing state-map import (`:5`) and to its plain re-export (`:179`).
- `routes/proxy-compute.js:20` and `routes/proxy.js:79` import from `../lib/providers/state-map.js`.
- Comments:
  - the moved doc comment keeps LIN-330 and LIN-357, and gains one sentence naming the new home;
  - the LIN-174 note in `tree.js` gains `isBlocked`;
  - `lib/graph-features.js:149-154`: the location and the old cycle reason are corrected, and the `@param` example names state-map; the parameter stays;
  - `lib/linear.js:5-7`: the location claim for `isBlocked` is corrected (comment only).
- `areas.json` is not edited, and no function body changes. No test changes.

## Predicted measurements (seams.mjs before → after)

| Measure | Before | After |
|---|--:|--:|
| Files in scope | 432 | 432 |
| Unresolved / unmapped | 4 / 0 | 4 / 0 |
| Area→area link rows | 62 | 61 |
| Cross-area imports (distinct file pairs) | 887 | 887 |
| **Knots (two-way pairs)** | **18** | **17** |
| Knot groups | one of 9 | one of 9 (same areas) |

If a sibling seams ticket merged first, the knot count and the link rows start one lower per merged sibling, and cross-area imports start one higher if the periodical-marker ticket merged. The deltas below are unaffected.

**Pairs that change.**

| Pair | Before | After |
|---|---|---|
| Agent API (proxy) ↔ Front end: server-rendered pages | 2 / 1 | **gone** |
| Agent API (proxy) ↔ Providers | 17 / 6 | 19 / 6 |

**Links that change.**

| Link | Before | After |
|---|--:|--:|
| Agent → pages | 2 | 0 |
| Agent → Providers | 17 | 19 |

**Expected changes outside the knots.** These are by design.
- Entry files:
  - `lib/tree.js` loses Agent API as an importing area (15 importers → 13).
  - `lib/providers/state-map.js` gains Agent API (6 importers → 8).
- Area sizes are unchanged: no file moves between areas.

**New crossings:** two, `routes/proxy-compute.js` → `lib/providers/state-map.js` and `routes/proxy.js` → `lib/providers/state-map.js`. Both fall inside the existing Agent → Providers link, so they create **no new knot**.

**What stays:** pages → Agent remains a one-way link of 1, `lib/render-runner-setup.js` → `lib/proxy-scopes.js`.

## Verified in a copy

- The tree was exported with `git archive origin/main` into `copy/` and committed as a fresh repo (branch `base`).
- The change was committed on branch `k1`, and `seams.mjs` was run with the original `areas.json`.
- The "before" run is identical to `47d87055` on every number. Files:
  - `seams-base.json`
  - `seams-k1.json`
  - `seams-diff-k1.txt`
- All three sibling tickets merged together (branch `combined`) give 18 → 15, with each one's deltas unchanged (`seams-diff-combined.txt`).

## Lines changed (as verified in the copy)

`git diff --stat`: 6 files, +39 / −35 (branch `k1b`, which adds the `lib/linear.js` and `@param` comment fixes to `k1`; seams output identical to `k1`).

| File | + / − |
|---|---|
| `lib/providers/state-map.js` | +25 / 0 |
| `lib/tree.js` | +5 / −27 |
| `lib/graph-features.js` | +5 / −4 (comment only) |
| `lib/linear.js` | +2 / −2 (comment only) |
| `routes/proxy-compute.js` | +1 / −1 |
| `routes/proxy.js` | +1 / −1 |

Comment wording is the worker's, so the comment lines may differ by a few. The code lines may not.

## Behaviour change

**None.** The function lines are byte-identical. Only the doc comment's LIN-330 clause changed, which `diff` against the old block shows.

**Replay in the copy** (`tools/replay-k1.mjs`, output `replay-k1.txt`):
- Old `isBlocked` from an export of `47d87055` was compared with new `isBlocked` from an export of `k1`.
- **8,200 inputs, 0 differences.** The inputs:
  - every relation type crossed with every state value;
  - missing, null and non-array relation lists;
  - null entries, which throw identically;
  - every ordered pair of relations;
  - a throwing getter.
- Old against old: 0 differences. A mutant with the terminal check dropped differed on 453 inputs.
- The `isBlocked` from `tree.js` and from `recommendation-facts.js` is the same function object as state-map's, and so is `isTerminalState`.

**Unit tests in the copy, with non-loopback egress blocked:**
- **265 / 265** in the ticket's 9 named files (1.2 s), on both `k1` and `k1b`.
- **3,054 / 3,054** in every unit file that imports `tree.js`, `state-map.js`, `routes/proxy.js`, `routes/proxy-compute.js`, `graph-features.js`, `recommendation-facts.js` or `workspace-api-mocks.js` (139 files, 33 s).
- Full unit suite on the combined branch (all three tickets): **17,424 / 17,424**, plus `eval-dense` and `seams.test.mjs` 12 / 12 (215 s).

## Run time

- `seams.mjs`: about 0.8 s per run.
- The ticket's named unit tests: under 2 s.
- The full unit suite: about 3.5 min on this host.
- The worker's whole task: **under 45 minutes wall-clock** to an open PR. This is a prediction, not a measurement.

## Would falsify the prediction

- A knot count other than one lower than the start (18 → 17 at `47d87055`).
- Any new pair.
- A change to any pair beyond the two listed.
- A replay difference or a test failure.
- A reviewer finding that state-map is the wrong owner. The strongest counter-argument is the LIN-330 comment, which put `isBlocked` with the tree helpers. A reviewer would have to show that the blocked rule changes with tree layout rather than with issue-state meaning.
