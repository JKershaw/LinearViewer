# Rung 6a score: lib/task-page-loader.js rebuild (LIN-3590, PR #1905, merged 16e7ae77)

Scored 2026-10-16 from git (`git show`, temp worktree since removed) and the PR via GitHub MCP. No model calls.

## Setup
- Old = the replay's pinned 1f8010a0 copy. `git log 1f8010a0..16e7ae77 -- lib/task-page-loader.js` gives only
  16e7ae77. But the range also holds b3bdccaf (LIN-3580), which rewrote `lib/dispatch-factory.js` and
  `lib/dispatch-validation.js`. Two of the loader's imports reach those files through further imports
  (`task-run-facts`, `effort-readout`). So both sides ran on a **new 16e7ae77 snapshot**
  (`replay-kit/snapshots/16e7ae77`), with the old file re-pinned onto it.
- The rung6a replay was copied to `arm/replay16/`, changing only the SHA and snapshot paths (`target.mjs` SNAP).
  Tests were rediscovered at 16e7ae77: 8 files. The 7 from before, plus the new `task-page-loader-pins` (6 calls).
- New = `arm/new/task-page-loader.js` (no helper module). Old+(a) = `arm/fixed/` (one-token patch, below).

## 1. Replay (tiers test, edge, gen; n 3000)
| run | inputs | differing | groups | exit |
|---|---|---|---|---|
| old vs new, seed 1 | 4,496 (test 1,383, edge 113, gen 3,000) | 4 | 4 | 1 |
| old vs new, seed 7 | 4,496 | 4 | 4 | 1 |
| old+(a) vs new, seed 1 | 4,496 | **0** | 0 | 0 |
| old+(a) vs new, seed 7 | 4,496 | **0** | 0 | 0 |

The same 4 groups appear in both seeds, and all 4 come from the test tier (`task-page-loader-pins.test.js`):
| group | count | before → after | class | reason |
|---|---|---|---|---|
| outcome `loadTaskPage` reject→resolve | 3 | rejects `TypeError: Cannot read properties of null (reading 'prUrl')` → `{ model }` with `closeOut.mergedBy` `'close-out'`/`'person'`/`null` | (a) | `readMergedBy` is documented "Never throws" (LIN-3248 F4). A null close-out event made the whole page reject. This is the PR's one listed fix. |
| storeCalls `loadTaskPage` | 3 | 5 dep calls → 7 (the page carries on past the merged-by read) | (a) | Follows from the same fix |
| test-outcome fail→pass | 1 | pins test `not ok` → `ok` | (a) | The pin for the fix |
| test-file-exit | 1 | exit 1 → 0 | (a) | Same |

- The fix patched alone into the old copy (`.filter(e => e && (closeOut.pr.url …`, the rebuild's own guard) leaves
  **0 differences in either seed**. Class (b): 0. Class (c): 0. Info-only: 0, so key order and aliasing are
  unchanged and there is no new sharing.
- The 113 edge and 6,000 generated inputs show no difference. The generator never produces a null close-out event,
  so only the pins test witnesses the fix.
- 3 mutants planted in the new file (edge+gen, seed 1), all caught: sentence cut `>`→`>=` 7 inputs, ready header
  on a truthy PR number 46, tracker read without `noDescend` 1,158.

## 2. Shape (kit `shape.mjs`, acorn from `rebuild-exp1/kit`)
| | old (1f8010a0) | new (16e7ae77) | change |
|---|---|---|---|
| lines total / code / comment | 776 / 441 / 289 | 923 / 488 / 366 | code +47 (+10.7%) |
| bytes | 37,235 | 41,735 | +12% |
| functions | 56 | 85 | +29 |
| top-level declarations | 22 | 50 | |
| cyclomatic total / decision points | 344 / 287 | 343 / 257 | dp −30 (−10.5%) |
| max nesting | 2 | 3 | |
| worst function | buildTaskPageModel 77 | buildTaskPageModel 13 | −83% |
| units over 10 | 7 | 4 | |

Worst: old buildTaskPageModel 77 (109L), deriveHeader 24, sessions λ 19, loadTaskPage 19; new buildTaskPageModel 13
(41L), createTaskPageLoader 12 (134L), deriveHeader 11 (7L), identityOf 11, toSession 10, toStage 10.

Decision points fell mostly in or/and (−22); defaulted params (35) unchanged. The PR's shape table matches exactly.

## 3. Run facts
- Files changed: 2. `lib/task-page-loader.js` (+564/−354 across the PR) and the new
  `tests/unit/task-page-loader-pins.test.js` (3 tests, 63 lines). No helper module. No existing test or fixture
  was edited (`git diff b3bdccaf 16e7ae77 --name-status`: M loader, A pins). Callers untouched. 11 exports and
  12 imports kept.
- Fixes listed: 1 (class (a), `readMergedBy` null event); also 4 "looks wrong, kept" and 3 dead/unneeded items.
- At 16e7ae77 (temp worktree) all pass: `render-task-page-golden` 30/30 (golden not regenerated), `task-page-links`
  6/6, pins 3/3, and the six lib scanners (anchor-resolver 81, email-import-boundary 7, lin-3136 20, lin-3382 12,
  lin-3383 27, lin-3384 11). Details in `source-text-tests.txt`.
- Ticket refs: 11/11 unique LIN refs kept, 0 dropped; uses 22 → 23 (one more LIN-3373). Comment lines 264 → 312.
- Process (from the PR): the first push (da913c6, 22:11Z) was an **in-place edit**. Review R1 sent it back
  ("in-place edit instead of a rebuild"), with R2 (no captured-call leg or real getLoopsForIssue) and R3 (a
  `deriveHeader` regression on non-array iterables). 5ce79a5 (22:41Z) is the real rebuild. Review F1 led to
  8c75fe5 (22:57Z), the liveRung spread. Merged at 23:04Z.
- The worker's own replay was heavier than asked (2 seeds, 13,200 inputs, 3 sides, 29 mutants vs one seed, ~1,000/export).
- "No parallel forks": neither the PR nor its comment says anything about it, so I can't verify it from here.

## 4. Prediction vs result
| prediction | result | |
|---|---|---|
| Not split (~85%) | one PR | hit |
| Merges (~85%) | merged 23:04Z | hit |
| Done without a ruling (~55%) | no DECISION/ruling in the PR. The plan was revised once at plan review, and the build was rejected once in code review (R1). | hit (counting review rounds as not rulings) |
| 45–100 min | 96 min (launched ~21:35Z, Done 23:12Z) | hit, at the top of the range |
| 330–420 code lines (5–25% cut) | 488 (+10.7%) | **miss**: grew instead of shrinking |
| Worst function ≤30 (~65%) | 13 | hit |
| Decision points down 20–35% | −10.5% | **miss** |
| My replay finds no regression (~70%) | 0 (b), 0 (c); only the listed (a) | hit |
| Refs kept ≥90% | 100% | hit |

7 hits, 2 misses, both on size: many small named functions (56 → 85) grew the lines while flattening the worst one.

## For John
- The behaviour is clean: across 2 seeds and 8,992 compared inputs, the only difference is the one listed fix,
  and that disappears when the fix is patched into the old copy.
- The cleanliness gain is concentration, not size: the worst function went 77 → 13 and units over 10 went 7 → 4.
  The file is 11% longer and has 52% more functions.
- The worker's first build was an in-place edit dressed as a rebuild. Only review R1 caught that. A plan or
  build gate that checks "rebuilt, not edited" is worth keeping. The PR itself reports 232 of 414 non-trivial
  lines still match the old file.
- Kit note: a shared-module change needs a new snapshot; `pin.mjs <sha> … <snapDir>` overwrites a snapshot dir whose
  SHA differs, so pin onto it with `pinCopy` directly.

Files (under rung6a/): `arm/report-s{1,7}.json`, `arm/report-fixed-s{1,7}.json`, `arm/run-*.log`, `arm/new-shape.json`,
`arm/sensitivity.txt`, `arm/source-text-tests.txt`, `arm/replay16/` (config), `arm/fixed/` (old+(a)).
