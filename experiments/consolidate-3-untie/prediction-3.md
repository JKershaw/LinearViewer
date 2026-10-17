# Prediction for experiment 3: untie two knots by moving code to its owner

This prediction was written before the ticket was dispatched. Tree: `d349e78c`. Guide: `scripts/code-shape/areas.json` at `d349e78c`, used unchanged for every run.

## The change being predicted

**(b) Providers ↔ Runs & dispatch.** `summarizeChecks` and its two GitHub-vocabulary sets move from `lib/run-evidence.js:24-25` and `:31-44` to `lib/github-pr-status.js`.
- `lib/pr-state-store.js:19` imports it from there.
- `run-evidence.js` imports it through its existing `github-pr-status.js` import.
- The re-export is the worker's call. The preferred route is to repoint `tests/unit/run-evidence.test.js:13` and add no re-export. Either form gives identical seams output.

**(a) pages ↔ Other features.** `lib/home-swipe-prompt-opts.js` moves, whole, to `lib/render-prompt-opts.js`. The two importers, `lib/render.js:31` and `lib/render-swipe.js:24`, change their specifier.

`areas.json` is not edited, and no function body changes.

## Predicted measurements (seams.mjs before → after)

| Measure | Before | After |
|---|--:|--:|
| Files in scope | 432 | 432 |
| Unresolved / unmapped | 4 / 0 | 4 / 0 |
| Area→area link rows | 64 | 62 |
| Cross-area imports (distinct file pairs) | 902 | 899 |
| **Knots (two-way pairs)** | **20** | **18** |
| Knot groups | one of 9 | one of 9 (same areas) |

**Pairs that change.**

| Pair | Before | After |
|---|---|---|
| Providers ↔ Runs & dispatch | 1 / 7 | **gone** |
| Front end: server-rendered pages ↔ Other features | 2 / 1 | **gone** |
| Front end: server-rendered pages ↔ LLM & prompts | 14 / 7 | 15 / 7 |
| LLM & prompts ↔ Other features | 2 / 3 | 2 / 2 |

**Links that change.**

| Link | Before | After |
|---|--:|--:|
| Providers → Runs | 1 | 0 |
| pages → Other | 2 | 0 |
| pages → LLM | 14 | 15 |
| Other → LLM | 3 | 2 |

Runs → Providers stays at 7: `run-evidence.js` → `github-pr-status.js` is an edge that already exists.

**Expected changes outside the knots.** These are by design. The knot groups are unchanged.
- Area sizes: pages goes from 68 files / 219 internal imports to 69 / 221, and Other features from 10 files to 9.
- Entry files:
  - `lib/home-swipe-prompt-opts.js` leaves Other features' entry files.
  - `lib/run-evidence.js` loses Providers as an importing area (4 importers → 3).
  - `lib/prompt-templates.js` loses Other features as an importing area.

**New crossing:** one. `lib/render-prompt-opts.js` → `lib/prompt-templates.js` replaces the same import from the old path. It falls inside the existing pages → LLM link, so it creates **no new knot**.

**What stays:** Other → pages remains as a one-way link of 1, `lib/ship-journey.js` → `lib/ship-layout.js`. That import is in the right direction.

**Verified in a copy.** The tree was exported with `git archive d349e78c` into `tree/` and committed as a fresh repo. Each change was committed there in turn, on branch `combined`. `seams.mjs` was then run with the original `areas.json`. The "before" run is identical to HEAD on every number. The results are in these files:
- `seams-copy-before.json`
- `seams-combined-after.json`
- `seams-combined-diff.txt`

Each change was also measured on its own, and each gives 20 → 19:
- (a): `seams-copy-after.json`
- (b): `seams-alt-summarize.json`

## Lines changed (as verified in the copy)

`git diff --stat`: 6 files, +24 / −22, one of them a rename at 100% similarity.
- `lib/github-pr-status.js`: +18
- `lib/run-evidence.js`: +3 / −18, with the re-export kept
- `lib/pr-state-store.js`: +1 / −2
- `lib/render.js`: +1 / −1
- `lib/render-swipe.js`: +1 / −1

With the preferred route (repoint the test, no re-export), `run-evidence.js` loses 2 more lines and the test changes by 1 line. A separate fresh-reader simulation of both variants gave 20 → 18 each time, with byte-identical seams output.

## Behaviour change

**None.** The moved function and sets are byte-identical copies. The renamed module's content is unchanged.

**Replay in the copy.** The old `summarizeChecks`, read from the read-only checkout, was compared with the new one and with the re-export on 512 inputs. The inputs were:
- every GitHub conclusion and status value, plus `success`, `neutral`, `skipped`, mixed case, `undefined` and numbers;
- every ordered pair of those values;
- empty input and non-arrays.

All 512 were identical, and the re-export is the same function object (`replay-summarize.txt`). `buildPromptOpts` gave byte-identical JSON from the old and new paths for 3 inputs.

**Unit tests in the copy, with non-loopback egress blocked:**
- **251 of 251** in `render`, `render-swipe`, `home-top-task-parity`, `home-opened-task-characterization`, `lin-3013-swipe-lean-read-wiring`, `swipe-sort`, `github-pr-status`, `pr-state-store`, `render-run-evidence`, `run-evidence`, `run-evidence-route`, `run-evidence-seams` and `session-pr-state-poll`.
- **201 of 201** in the file-enumerating censuses and `seams.test.mjs`. These were run for (a).

## Run time

- `seams.mjs`: about 0.7–0.9 s per run.
- The targeted unit tests: under 1 s.
- The worker's whole task: **under 45 minutes wall-clock**, most of it the single full unit-suite run, the replay and opening the PR. This is a prediction, not a measurement.

## Would falsify the prediction

- A knot count other than 18.
- Any new pair.
- A change to any pair beyond the four listed.
- A replay difference or a test failure.
- A reviewer finding that either move put the decision with the wrong owner. For (a), the strongest counter-argument is the prompt-catalog half of the module, which would point to LLM & prompts as the owner. For (b), there is none known: the vocabulary is GitHub's, and `github-pr-status.js` builds the list it classifies.
