# Rung 6b score — `lib/kpi-stats.js` design-first rebuild (LIN-3591, PR #1907, merged 91fca7dd)

Old = the replay's pinned copy of `1f8010a0` (`git log 1f8010a0..91fca7dd -- lib/kpi-stats.js` = 91fca7dd only;
none of the module's 9 imports changed in that range). The kit's `pin.mjs` was **not** used (its snapshot
overwrite bug): a fresh snapshot `replay-kit/snapshots/91fca7dd` was made with `ensureSnapshot`, and both
sides were pinned into a new folder with `pinCopy` (`arm/pin91.mjs`). The re-pinned old copy is
byte-identical to `replay/pinned/origin-main` apart from the snapshot path. Driver: `arm/replay91/replay.mjs`
(the rung6b cfg with the 91fca7dd snapshot); test files rediscovered on it (now 4: + `kpi-stats-pins`).

## 1. Replay (test + edge + gen tiers, n = 3000)
| run | inputs | differing | info-only | groups | export diff | network | new-side privacy findings |
|---|---|---|---|---|---|---|---|
| seed 1, old vs new | 3,193 (test 103, edge 90, gen 3000) | 2 | 0 | 3 | none | 0 | **0** (old 0) |
| seed 7, old vs new | 3,193 | 2 | 0 | 3 | none | 0 | **0** (old 0) |
| seed 1, old+fix vs new | 3,193 | **0** | 0 | 0 | none | 0 | 0 |
| seed 7, old+fix vs new | 3,193 | **0** | 0 | 0 | none | 0 | 0 |
| seed 1, old+fix vs new, edge+gen, `--coverage` | 3,090 | 0 | 0 | 0 | none | 0 | 0 |

Coverage: old 598/598 lines (blocks 300/306, the six known-unreachable arms), **new 463/463 lines, blocks 265/265**.

**Privacy scan first: 0 new-side findings on both seeds.** Caveat: the scan is also 0 on the *old* side,
i.e. blind to the one real leak class — `target.mjs` only ever generates numeric/`null`/`undefined`
free-tier `count`s. Targeted canary probe (`arm/probe-freetier.mjs`, 196 inputs of string/object/array
canary, `'7'`, `true`, NaN, ±Infinity counts): **old leaks a canary into output on 52/196, non-finite or
non-number counts on 132/196; new 0/0; old+fix 0/0.** The PR's own sweep did catch it (85 old-side findings).

### Difference groups (identical on both seeds)
| group | inputs | class | judgment |
|---|---|---|---|
| `return collectKpiStats $.freeTier.counts[]` | 1 (test: kpi-stats-pins #0) | (a) fix, listed | old `"07true0Infinity00"`, `"3leakword[object Object]2"` → new `0`, `5` |
| `test-outcome fail->pass` | 1 (kpi-stats-pins file) | (a) — the fix's own pin | fails on old with the message above, passes on new |
| `test-file-exit` 1 → 0 | 1 | (a) — same pin | |

No (b). No (c) observed (no console/error-text differences). **No `storeCalls` group at all**: every
pipeline, filter and projection deep-equals today's on all 3,193 inputs (with a real MangoDB aggregation),
and **output key order is identical too** (zero info groups) — the rewritten `$project` builder is exact.

### What the "free-tier count leak" was
Old: `freeTierByDay[doc.date] += doc.count || 0`. A non-numeric `count` is string-concatenated into the
public `freeTier.counts` (`0 + 'x'` → `'0x'`). So it is **both**: a counting/type bug whose consequence is a
privacy leak of stored content into the public `/kpis` page. But it is **latent**: `lib/free-tier-store.js`
writes `count` only via `$inc`, so no real document has a non-numeric count; it is reachable only by
fuzz/corrupt data. Fix: add only `Number.isFinite(doc.count)` (the module's `feedbackLen` idiom), reason
comment on `buildFreeTier`; side effect: `Infinity`/`NaN`/`true`/`'7'` now count 0 (none occur in real data).
Wrong by the module docblock ("only counts") and CLAUDE.md's `/kpis` line → class (a) is right. Patched
alone into the old copy (one line, `arm/replay91/pinned/old-patched`), both seeds: 0 differences.

## 2. Shape (kit `shape.mjs`, `arm/new-shape.json` vs `arm/old-shape.json`)
| | old 1f8010a0 | new 91fca7dd |
|---|---|---|
| lines total / code / comment / blank | 1068 / 598 / 421 / 49 | 967 / **463** / 441 / 63 (code −22.6%) |
| bytes | 51,220 | 47,179 |
| functions (decl / arrow) | 47 (16 / 31) | 78 (26 / 52) |
| cyclomatic total / decision points | 200 / 152 | 178 / 99 |
| max cyclomatic | `collectKpiStats` **77** | `categorizeProxyEvent` **9** (`collectKpiStats` 7) |
| units > 10 | categorizeProxyEvent (15), collectKpiStats (77) | none |
| longest function (code lines) | collectKpiStats 283 | collectKpiStats 70 |
| max nesting / imports / exports / top-level decls | 3 / 9 / 9 / 30 | 3 / 9 / 9 (same names) / 58 |
| string literals | 137 | 106 |

## 3. Run facts
- Files changed: 2 — `lib/kpi-stats.js` (717+/758− across both), `tests/unit/kpi-stats-pins.test.js` (new, 60 lines).
  No helper module. Tests added: 1 file / 1 test (the a1 pin); existing tests edited: 0. Fixes listed: 1 (a1).
- At 91fca7dd (temp worktree, removed): `lifetime-retention-contract-drift` 15/15, `lin3014-capture-kpis` 2/2;
  with kpi-stats, digest-feedback, pins: 161/161; `lin-3384-redaction-census` + `test-server-listen-bind` 24/24.
  PR CI: unit, 4 E2E shards, secret scan, CI success all green.
- Ticket refs: 25 distinct `LIN-` ids in old, the same 25 in new, 53 occurrences each — **all kept, none dropped**
  (LIN-1468 2→1, LIN-2325 4→5). The fix carries no `LIN-3591` ref in the module (the pin test has it).
- Verbatim (same measure as `verbatim/verbatim.mjs`, which has no single-ticket mode; `arm/verbatim-3591.mjs`,
  OLD = d2d7d818): new non-trivial lines 380, old 478, matched 148 → **38.9% of new verbatim in old**, 31.0% of
  old surviving; longest verbatim run **9** lines (the `dispatchOutcomes` return block / `asRate`). Within the
  design-first band (37–55% for 3566–3590; 86% for LIN-3592 is the outlier).
- Time: launched 23:14Z, PR opened 23:48Z, CI green 23:54Z, merged 00:02Z, Done ~00:03Z — about 49–50 min.
  No PR comments/reviews; no `DECISION:` in the PR body.

## 4. Prediction (`wt-branch/experiments/rebuild-rung6b/prediction-kpi-stats.md`) line by line
| line | prediction | actual | |
|---|---|---|---|
| 6 | not split ~85% | one PR, one commit | hit |
| 6 | merges ~80% | merged 00:02Z | hit |
| 6 | done without a ruling ~50% | no DECISION/ruling visible on the PR | hit (coin-flip) |
| 7 | 45–110 min | ~49 min | hit (low end) |
| 10 | 480–580 code lines (3–20% cut) | 463 (22.6% cut) | **miss** (cut deeper) |
| 10 | "pipelines long and distinct, little to share" | the five `$project` fields were built from one shared `$map`/`$cond` builder | rationale missed |
| 11 | worst function ≤ 30 ~70% | 9 (`collectKpiStats` 7) | hit, by a wide margin |
| 12 | 0 privacy leaks ~95% | 0 new-side findings, both seeds; probe 0 | hit |
| 12 | no value regression ~65% | none | hit |
| 12 | if a regression: windows or rewritten pipeline args as storeCalls | no storeCalls difference at all; windows identical | n/a (nothing to judge) |
Not predicted: a class-(a) fix (a latent free-tier privacy/type bug), and that our own scan baseline was blind to it.

## 5. For John
- Cleanest rung so far: 3,193 inputs × 2 seeds, the only behaviour change is the listed fix; exact store
  calls and key order; 100% line+block coverage of the new file; worst unit 77 → 9.
- The "leak" was real in form (string concatenation of stored data into public output) but unreachable with
  real data (`$inc`-only writes). Worth fixing on a privacy boundary; not evidence anything ever leaked.
- Our independent replay's privacy baseline ("0 old-side findings") was a generator gap, not a clean bill:
  free-tier `count` never got a canary. Fix `target.mjs` (canary-typed values in numeric fields) before the
  scan is quoted again; the rebuild's own replay was stronger here.
- Kit: `pin.mjs` should refuse (or wipe) a snapshot dir whose `SHA` differs instead of extracting over it.
