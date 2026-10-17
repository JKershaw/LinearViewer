# Score: experiment 3 (LIN-3600, PR #1910)

Base `d349e78c` -> merge `f885f44c` (squash of PR head `ce9c9cfc`, trees identical).
Guide: `scripts/code-shape/areas.json`, unchanged by the PR (the whole `scripts/code-shape/` dir is unchanged).

## 1. Seams (`seams.mjs /home/user/LinearViewer <sha> scripts/code-shape/areas.json`)

Raw outputs: `seams-d349e78c.txt`, `seams-f885f44c.txt` (JSON). Compared with `tools/seams-compare.mjs`.

| Measure | d349e78c | f885f44c |
|---|--:|--:|
| Files in scope | 432 | 432 |
| Unresolved / unmapped / parse failures | 4 / 0 / 0 | 4 / 0 / 0 |
| Area->area link rows | 64 | 62 |
| Cross-area imports | 902 | 899 |
| **Knots** | **20** | **18** |
| Knot groups | one of 9 | one of 9, same 9 areas |

Pairs that changed (every one):
- GONE Providers <-> Runs & dispatch 1/7
- GONE Front end: server-rendered pages <-> Other features 2/1
- pages <-> LLM & prompts 14/7 -> 15/7
- LLM & prompts <-> Other features 2/3 -> 2/2
- **No new knot.** No other pair changed.

Links that changed: pages->LLM 14->15, pages->Other 2->0, Other->LLM 3->2, Providers->Runs 1->0. Runs->Providers stays 7; Other->pages stays 1.

Outside the knots: pages area 68 files / 219 internal -> 69 / 221; Other features 10 -> 9 files. Entry files: `lib/home-swipe-prompt-opts.js` leaves Other's entry list; `lib/run-evidence.js` loses Providers (importers 4 -> 3); `lib/prompt-templates.js` loses Other as an importing area (importers stay 14). Nothing else in `areas` differs.

The actual before/after JSON equals the prediction copy's `seams-copy-before.json` / `seams-combined-after.json` field for field, except `commit` and the `areaMapSource` string (absolute vs relative path).

Run time: 0.81 s and 0.85 s.

## 2. The diff

`git diff --stat`: 7 files, +24 / -24, one rename at 100% similarity.

| File | + / - |
|---|---|
| `lib/github-pr-status.js` | +18 / 0 (two sets + doc comment + function, after `fetchPrStatus`, before the LIN-3247 cache) |
| `lib/run-evidence.js` | +1 / -19 (import line gains `summarizeChecks`; sets, doc comment, function and one blank line removed) |
| `lib/pr-state-store.js` | +1 / -2 (two imports merged into one from `github-pr-status.js`) |
| `lib/home-swipe-prompt-opts.js` -> `lib/render-prompt-opts.js` | rename, 0 / 0 |
| `lib/render.js`, `lib/render-swipe.js` | +1 / -1 each (specifier) |
| `tests/unit/run-evidence.test.js` | +2 / -1 (import split: `summarizeChecks` now from `github-pr-status.js`) |

- Function bodies: none changed. The 16 moved lines (old `run-evidence.js:24-25,31-44`) are byte-identical to new `github-pr-status.js:227-228,230-243` (`cmp`).
- Re-export: **not kept**. The worker took the ticket's preferred route (repoint the one test). New `run-evidence.js` does not export `summarizeChecks`.
- Ticket refs / reason comments: none dropped. The only removed comment is the doc comment, which moved with the function. No `//` or `LIN-` line was deleted anywhere.
- Leftover copies: `summarizeChecks`, `FAILING_CONCLUSIONS`, `PENDING_CONCLUSIONS` and the `'startup_failure'` literal occur only in `lib/github-pr-status.js` (definitions), plus the two imports/calls and the test.
- Shim: none; `lib/home-swipe-prompt-opts.js` does not exist at `f885f44c`. No code file references the old path. The 18 historical mentions under `docs/papers/` and `experiments/` are unchanged, identical file-by-file count to base.
- `areas.json`, `ship-journey.js`, `ship-layout.js`, `source-map.md`, `llms.txt`: untouched.

## 3. Behaviour

Script `tools/replay.mjs`, output `replay-output.txt`. Old code is imported from `git archive d349e78c` (`tree-old/`), new code from `git archive f885f44c` (`tree-new/`). Results are compared as JSON of the return value, or the error class and message if it throws.

**summarizeChecks**, old `run-evidence.js` vs new `github-pr-status.js`:

| Input set | n | old vs new | old vs old | mutant: 'stale' dropped | mutant: no lowercasing |
|---|--:|--:|--:|--:|--:|
| seed 1 | 4,000 | **0** | 0 | 223 | 620 |
| seed 7 | 4,000 | **0** | 0 | 183 | 601 |
| every value + every ordered pair + throwing getters | 2,864 | **0** | 0 | 166 | 366 |

- Values used: every check-run conclusion (success, failure, neutral, cancelled, skipped, timed_out, action_required, stale, startup_failure), every check-run status (queued, in_progress, completed, waiting, requested, pending), and every commit-status state (error, failure, pending, success).
- Also: mixed and upper case, padded strings, unknown strings, fullwidth and dotless-i lookalikes, null, undefined, '', numbers, NaN, booleans, arrays, objects, a `toString` object, a String object, null/primitive/{} checks, and sparse holes.
- Non-arrays: null, undefined, string, number, true, {}, an array-like and a Set. Empty arrays are included too.
- All four outcomes are covered (unknown / passing / failing / pending), and both inputs with a throwing getter throw identically.

**buildPromptOpts**, old path vs new path:

| Input set | n | old vs new | old vs old | mutant: freeTier flipped |
|---|--:|--:|--:|--:|
| captured | 43 (7 distinct) | **0** | 0 | 43 |
| generated, seed 99 | 3,000 (2,726 distinct) | **0** | 0 | 3,000 |

- The captured inputs are the real arguments, logged by an instrumented scratch copy of `d349e78c` while it ran the `render`, `render-swipe`, `home-top-task-parity`, `home-opened-task-characterization`, `prompt-section-p0` and `lin-3013-swipe-lean-read-wiring` tests (154/154 pass).

**Unit tests:** the ticket's 10 named test files on an export of `f885f44c`: **248/248 pass**, in 1.5 s. This run was not under the hermetic socket guard.

## 4. Census (`dl1/census.mjs <repo> <sha> --areas-commit d349e78c`)

| | d349e78c | f885f44c |
|---|--:|--:|
| Files / functions | 432 / 3,011 | 432 / 3,011 |
| Groups / sites | 310 / 1,026 | 310 / 1,026 |
| Cross-area groups | 202 | 202 |
| Files involved | 264 | 264 |

- `byDetector` is identical.
- Group by group, nothing appeared or vanished. The comparison allowed for the rename and for line shifts in the edited files. Two adjacent groups only swapped ids (G0184 and G0185).
- The moved vocabulary sets were never in a census group (single site), so the census neither rewards nor penalises this change.

## 5. Timings and the PR record

| Event | Time (UTC) | Since kickoff |
|---|---|--:|
| Kickoff | 07:50:53 | 0 |
| Worker commit `ce9c9cfc` (single commit, author time) | 07:52:47 | 1 m 54 s |
| PR created | 07:53:50 | 2 m 57 s |
| Merged `f885f44c` | 08:06:50 | 15 m 57 s (13 m open) |

- **PR body and comments: not available locally.** Only git was allowed, and both the commit message and the squash message are a one-line subject plus a co-author trailer. So whether the PR pasted the seams before/after, the knot lines and the replay script/output, as the ticket required, is **unverified here**. Check it on GitHub.
- **Inference, not a measurement:** the full unit suite takes about 130-147 s on this host (`merge-unit.log`, `merge2-unit.log`). `seams.mjs` must run after the commit, and the commit-to-PR gap is 63 s. So a full-suite run before opening the PR, as the ticket asked, does not fit the timeline unless it ran elsewhere or faster. Kickoff-to-commit was 114 s for edits, the targeted tests and the replay.

## 6. Prediction, line by line

| # | Prediction line | Result |
|---|---|---|
| 1 | (b) `summarizeChecks` + two sets move to `github-pr-status.js` | HIT |
| 2 | `pr-state-store.js:19` imports it from there | HIT (merged into the existing line 18 import) |
| 3 | `run-evidence.js` uses it via its existing `github-pr-status.js` import | HIT |
| 4 | Re-export is the worker's call; preferred route is repoint the test, no re-export | HIT: preferred route taken |
| 5 | Either form gives identical seams output | HIT: actual (no re-export) == copy (re-export) |
| 6 | (a) module moves whole to `lib/render-prompt-opts.js` | HIT (100% rename) |
| 7 | Two importers change specifier | HIT |
| 8 | `areas.json` not edited | HIT |
| 9 | No function body changes | HIT |
| 10 | Files in scope 432 -> 432 | HIT |
| 11 | Unresolved / unmapped 4/0 -> 4/0 | HIT |
| 12 | Link rows 64 -> 62 | HIT |
| 13 | Cross-area imports 902 -> 899 | HIT |
| 14 | Knots 20 -> 18 | HIT |
| 15 | Knot groups one of 9, same areas | HIT |
| 16 | Providers <-> Runs 1/7 gone | HIT |
| 17 | pages <-> Other 2/1 gone | HIT |
| 18 | pages <-> LLM 14/7 -> 15/7 | HIT |
| 19 | LLM <-> Other 2/3 -> 2/2 | HIT |
| 20 | Links: Providers->Runs 1->0, pages->Other 2->0, pages->LLM 14->15, Other->LLM 3->2 | HIT (all four) |
| 21 | Runs -> Providers stays 7 | HIT |
| 22 | pages 68/219 -> 69/221; Other 10 -> 9 files | HIT |
| 23 | Entry files: three listed changes | HIT (all three, and nothing else) |
| 24 | One new crossing inside pages->LLM; no new knot | HIT |
| 25 | Other -> pages stays a one-way 1 | HIT |
| 26 | Copy before == HEAD on every number; combined-after is the result | HIT (equal field for field bar commit/path string) |
| 27 | Each change alone gives 20 -> 19 | Not re-tested (a single PR was merged) |
| 28 | `github-pr-status.js` +18 | HIT |
| 29 | `pr-state-store.js` +1/-2 | HIT |
| 30 | `render.js` / `render-swipe.js` +1/-1 | HIT |
| 31 | One rename at 100% | HIT |
| 32 | Preferred route: `run-evidence.js` loses 2 more lines than +3/-18, i.e. +1/-18 | MISS by one: +1/-19. The copy had left a double blank line; the worker removed it |
| 33 | Preferred route: test changes by 1 line | PARTIAL: +2/-1 (the import was split, not edited in place) |
| 34 | Implied totals (7 files, about +23/-23) | NEAR-MISS: 7 files, +24/-24 |
| 35 | Behaviour change: none; moved text byte-identical; renamed content unchanged | HIT |
| 36 | Replay identical; `buildPromptOpts` byte-identical | HIT (independent: 10,864 + 3,043 inputs, 0 diffs; self-check 0; mutants caught) |
| 37 | Re-export is the same function object | N/A (no re-export) |
| 38 | Targeted unit tests all pass | HIT (248/248 on the named set) |
| 39 | `seams.mjs` about 0.7-0.9 s | HIT (0.81 / 0.85 s) |
| 40 | Targeted unit tests under 1 s | MISS, marginal: 1.5 s for the ticket's 10 files. This is not the prediction's 13-file set |
| 41 | Whole task under 45 min | HIT: 16 min to merge, 3 min to PR |
| 42 | Falsifiers: knot count != 18, new pair, extra pair change, replay diff, test failure | None triggered |
| 43 | Falsifier: reviewer finds the wrong owner | Unassessed (no review text available locally) |

Tally: 36 hits, 1 partial, 1 near-miss, 2 misses (both small: one blank line and a test-timing bound), 3 not assessable.
