# Rung 5d score: `lib/pipeline-loops.js` design-first rebuild (LIN-3578, PR #1901)

Old `f4749b91` → merged `4ee0a2c7`. Scored 2026-10-16 with the independent replay (`S/rung5d/replay`), the shape kit, git and the PR body.
The repo's HEAD stayed at `f4749b91`. A temporary worktree was used only to run tests, then removed.

## 1. Replay (independent harness, 3,795 inputs per seed: test 751 / edge 44 / gen 3,000)

Setup: `new/pipeline-loops.js` = `git show 4ee0a2c7:lib/pipeline-loops.js`, with its six `./x.js` imports rewritten to `file:///home/user/LinearViewer/lib/x.js`, the same rewrite the pinned copy has. There is no helper module, and all six imported modules are byte-identical between `f4749b91` and `4ee0a2c7`.
Reports: `replay-seed1.json`, `replay-seed7.json` (+ `.log`). Exports diff 0. Network attempts 0. Capture fidelity 751/751.
Coverage with `--coverage`: old 800/800 lines; new 634/634 lines, blocks 571/573 (unhit: L363 `|| []` and L1034 `|| {}`, both defensive).

| seed | differing inputs | (a) | (b) | (c) | info-only inputs (key-order reports) |
|---|---|---|---|---|---|
| 1 | 18 (test 0, edge 2, gen 16) | 17 | 0 | 1 | 649 (790) |
| 7 | 18 (test 0, edge 2, gen 16) | 17 | 0 | 1 | 645 (806) |

**Discriminator run.** `oldfix/` is the old file with the PR's single fix applied on one line (L659): a lean row with no digest derives from `deriveLoopFacingFacts(feedbackWithHarvestedAbort([], abort), dispatchedAt)`. Results for `oldfix` vs `new`:
- seed 1 and seed 7: **1 differing input each**, the TypeError wording below;
- **0 info**: the key-order reports disappear as well.

So every value difference and every key-order report traces to the one listed fix. Reports: `replay-oldfix-vs-new-seed{1,7}.json`.

### Difference groups (seed 1 / seed 7 input counts)

| group (signature) | s1 | s7 | example (before → after) | class | reason |
|---|---|---|---|---|---|
| `_buildLoops $[].telemetry.runtime.completedAt` (+terminalStatus, terminalCompletedAt, wakeMarker, runtime.ms) | 12 | 13 | edge:18 lean target, aborted: `terminalStatus null → 'aborted'`, `terminalCompletedAt null → 09:09Z`, `runtime.ms null → 540000` | (a) | The PR's listed fix: a lean abort now reaches a digest-less target. Lean now equals non-lean, as the LIN-3011 comments promise. |
| `_buildLoops $[].terminalStatus` (target has no own dispatch runtime change) | 1 | 2 | gen:1699: `terminalStatus/wakeMarker null → 'aborted'` | (a) | Same fix. |
| `getLoopsForWorkspace $[].telemetry.runtime.completedAt` | 2 | 2 | gen:132 lean: `null → 2026-09-13T10:37Z`, `aborted` | (a) | Same fix, seen through the public reader. |
| `_buildSessions $[].completedAt` / `getSessionsForWorkspace $[].completedAt` | 2+1 | 2+1 | gen:1007: session `completedAt null → 2026-09-02T10:58Z` | (a) | Same fix. Session `completedAt` follows the loop terminal (the PR lists this). |
| `_buildSessions $[].loops[].terminalStatus` | 0 | 1 | gen:1814: `null → 'aborted'` | (a) | Same fix. |
| `getSessionsForIssues $.length` | 1 | 0 | gen:280 (lean, HAR-104): **1 session → 3**. Old: autopilot `disp-7327a8` (terminal null) claims 5 loops. New: the autopilot is `aborted` at 21:52Z, so its window closes, and the 3 later review loops form 2 sessions of their own. | (a)* | A consequence of the fix: the aborted autopilot's session window now ends. The same input run **non-lean gives 3 sessions on both old and new**, so new lean = non-lean. |
| `_buildSessions $.length` | 1 | 0 | gen:2475: 6 sessions → 13 (first session's loops 15 → 1) | (a)* | Same mechanism. Disappears under `oldfix`. |
| `error _buildLoops TypeError→TypeError` | 1 | 1 | edge:7: `agentStatusEntries is not iterable` → `entries is not iterable` | (c1) | Error wording only, same class. Only a direct `_buildLoops` call with a non-iterable list reaches it; `_fetchWorkspaceData` coerces non-arrays to `[]`. |
| info: `key-order … telemetry` (5 signatures) | 790 | 806 | lean no-digest `telemetry`: `metrics, producedArtifacts, runtime` → `runtime, metrics, producedArtifacts` (the non-lean order) | info | Listed by the PR as information. It vanishes under `oldfix`. No alias or `storeCalls:order` info anywhere. |

\* **Grouping changes are (a), but the PR understates them.** The PR's fix row mentions loop terminal facts and "the session's `completedAt`". It does not say that a lean, digest-less, aborted **autopilot** run now closes its session window, which changes session count and membership for lean callers (dashboard feed, materializer). This is correct by the lean = non-lean contract, and it is what non-lean always did.

Nothing differs in console output, store calls, input mutation or unhandled rejections, and no test-tier input differs on either seed.

## 2. Shape (kit `shape.mjs`, acorn from `S/rebuild-exp1/kit/node_modules`; `new-shape.json`, `old-shape-recheck.json` = `old-shape.json`)

| | old | new | Δ |
|---|---|---|---|
| total lines / code / comment | 1,868 / 800 / 967 | 1,125 / 634 / 409 | code −20.8%, comments −58% |
| functions | 50 | 86 | +36 |
| cyclomatic total | 439 | 387 | −11.8% |
| decision points (total − functions) | 389 (kit field 388) | 301 (kit field 300) | −22.6% |
| worst function | `_buildLoops` 113 (221 code lines) | `_loopRecord` 29 (49 code lines) | −74% |
| second worst | `_buildSessions` 76 (170 cl) | `_loopFactsFromDigest` 20 (28 cl) | −74% |
| next | getSessionsForIssues 34, _loopFactsFromDigest 23 | getSessionsForIssues 17, _buildLoops 15, _claimAutopilotSessions 15 | |
| max nesting | 5 | 4 | |
| units with cyclomatic > 10 | 7 | 10 | more, but all ≤ 29 |

The PR's own size table counts differently (362 → 275 decision points, `_loopRecord` 28). The direction is the same.
The kit's `if` count drops from 130 to 73 and `forOf` from 40 to 27. `||`/`&&`/`??`/ternary are nearly unchanged (186 → 171).
LIN refs in comments: 51 → 34 unique. Dropped refs include LIN-1261, 2182, 2991, 2996, 313, 509, 594, 615, 1003, 1005, 1025, 1461, 1468, 1728, 2187, 3126, 3157 and 3242. All five refs the ticket names (2232, 3328, 3011, 1393, 623) are kept.

## 3. Run facts (PR #1901 and git)

- **Files changed: 2.** `lib/pipeline-loops.js` was replaced (+721/−1464) and `tests/unit/pipeline-loops-pins.test.js` was added (+135). No helper module, and no caller, `source-map.md` or `areas.json` was edited. One squash commit.
- **Tests.** One new file with 4 tests: two fix pins (live and history digest-less targets), one no-abort control and one with-digest guard. The PR says these were observed failing on the unfixed module. **No existing test file was edited**, as the ticket required.
- **Fixes listed: 1.** A lean abort now reaches a target with no digest. No (b) and no (d) rows remain.
- **Edges kept, flagged "looks wrong":**
  - the `__anchor__:` prefix collision;
  - every abort row warning "malformed" once;
  - epoch-0 `dispatchedAt` → `null`.
- **Earlier regression the builder caught and fixed:** `_matchAgentStatusToLoop` window bounds with an Invalid Date.
- **Census pins kept as written.**
  - `const timed = (p) => {` is at L850, directly above `listItems` (L855) and `listHistory` (L856).
  - `redigestHistoryRows` (L922) holds the single raw `historyCollection…find(`, with no other header in between.
  - Run at `4ee0a2c7`: `lin-3384-redaction-census`, `pipeline-loops-pins`, `pipeline-loops`, `pipeline-sessions`, 238/238 pass.
- **Not run locally (per the PR):** `test:hermetic`, because `scripts/code-shape/seams.test.mjs` lacks acorn on base. CI covered it.
- **No `BUILDER_VERSION` bump.** The PR argues this in its Q1.
- **Timing (given):** kickoff 16:35Z, merged 17:42Z (GitHub `merged_at` 17:42:56Z), 67 min, 11 dispatches, one implementation run, no split, no rulings.
- **The builder's own replay:** seed 20261016, 5,000 generated plus 1,128 captured inputs, 18 fix inputs, 1,163 key-order reports, 18 planted mutants caught. The independent replay agrees on everything: only the fix, plus one wording-only TypeError the PR's table does not list.

## 4. Prediction vs outcome (`wt-branch/experiments/rebuild-rung5d/prediction-pipeline-loops.md`)

| line | prediction | outcome | |
|---|---|---|---|
| baseline | 800 code lines, 388 DP, worst `_buildLoops` 113 / `_buildSessions` 76 | confirmed by re-run | ✓ |
| not split (~80%) | — | one implementation run, no split | hit |
| merges (~80%) | — | merged 17:42Z | hit |
| no ruling (~50%) | — | no rulings | hit |
| 50–120 min | — | 67 min | hit |
| 560–720 code lines (10–30% cut) | — | 634 (−20.8%) | hit |
| decision points −20–35% | — | −22.6% (389→301; kit 388→300) | hit (lower half) |
| worst function ≤ 40 (~60%) | — | 29 (`_loopRecord`) | hit |
| census pin kept (~90%) | — | kept, census test passes | hit |
| no regression in my replay (~70%) | — | 0 (b) on seeds 1 and 7 | hit |
| "if one ships, odd edges (anchor, null ties, epoch-0)" | — | none shipped; all three edges kept and flagged | n/a (conditional) |

9/9 scored lines hit, plus the baseline. The calls were mostly central and range-based. The decision-point cut landed near the bottom of its range.

## 5. Notes for John

- **Clean rung.** The replay shows zero regressions across 7,590 inputs, 100% line coverage on both files, and every value difference reproduced by applying the single listed fix to the old file.
- **The one fix has a wider visible effect than the PR's table says.** For lean callers, an aborted autopilot whose row has no digest (e.g. still queued) now ends its session window. Later loops on the same issue then form their own sessions (seen as 1 → 3 and 6 → 13 sessions). That is what non-lean already showed, so it is (a). Stored materialized sessions may hold the old grouping until rebuilt; the PR argued no `BUILDER_VERSION` bump.
- **More, smaller functions (50 → 86).** The worst function falls from 113 to 29. Comment lines fell 58%, and 17 ticket references disappeared, though all five the ticket named remain.
- **One unlisted (c1).** The TypeError text for a non-iterable status list changed: `agentStatusEntries` → `entries`. Only direct `_buildLoops` calls can see it.
