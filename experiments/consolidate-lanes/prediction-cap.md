# Prediction: bound the unit suite's local CPU share

Grounded at LinearViewer `origin/main` = `47d87055`.

## Files
| File | Change | Lines (approx.) |
|---|---|---|
| `scripts/run-unit-tests.mjs` | new: `unitTestConcurrency`, `nodeTestArgs`, a dry-run flag, guarded `main` that spawns `node --test` and forwards the exit code; the header notes `CI` truthiness (matches `playwright.config.js:17-23`) and Node ≥ 20.10 | +50 |
| `tests/unit/run-unit-tests.test.js` | new: tests of the pure functions, plus one spawned dry run (env `{ ...process.env, CI: 'true' }` minus `UNIT_TEST_CONCURRENCY`, placeholder files, gives an argv with no flag); binds no server | +65 |
| `package.json` | `test` (`:7`) and `test:unit` (`:9`) go through the wrapper | 2 changed |
| `CLAUDE.md` | `:22` (−15 bytes) and `:23` (+148 bytes) changed in place; it stays at 110 lines, 10,587 → 10,720 of 12,000 bytes | 2 changed |
| `docs/architecture/configuration.md` | optional: one test-only `UNIT_TEST_CONCURRENCY` line | 0–1 added |

Total: 4–5 files, about 115 lines added and 4 changed.

## Tests
- New: about 10 cases in `tests/unit/run-unit-tests.test.js`:
  - the override wins;
  - an invalid override is refused;
  - an empty override counts as unset;
  - a non-empty `CI` (including `false`) gives no flag;
  - an unset or empty `CI` counts as local;
  - the local value is `floor(cpus/2)`, with a floor of 1;
  - `nodeTestArgs` puts the flag only when `n` is given, keeps file order, and throws on an empty list;
  - the spawned dry run's argv is exactly `['--test', ...files]`.
- Existing tests touched: **0**. No test pins `package.json` script text. `tests/unit/claude-md-line-budget.test.js` must stay green after the CLAUDE.md edits.
- The hermetic positive control (`scripts/assert-unit-suite-hermetic.mjs:170-171`) needs no change, because the wrapper only adds an install.

## Out of scope (listed, untouched)
- `scripts/survey-tests-mutate.mjs:18,24-27`
- `scripts/survey-tests-reporter.mjs:2`
- `lib/periodicals.js:281`
- prompt text

## Load figure
On 8 CPUs, three sessions go from 21 test processes to 12, about 2.6× the cores down to 1.5×. `UNIT_TEST_CONCURRENCY` is the lever beyond that.

## Run time
About 20–40 min. That covers writing the module and the test, one full local suite run (about 3–5 min at the bounded concurrency), the PR, and waiting on CI.

## Rulings
0.
