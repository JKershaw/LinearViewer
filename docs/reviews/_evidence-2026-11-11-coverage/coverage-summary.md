# Coverage ground truth, 11 Nov 2026 (LIN-4418)

Measured at `b5950f704` (origin/main when this run started), Node v25.9.0, real Mongo on.

```
OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= MONGODB_TEST_URI=mongodb://localhost:27017 \
node --experimental-test-coverage --test --test-concurrency=5 \
  tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/*.test.mjs
```

Derived from `package.json` `test:unit` and `scripts/run-unit-tests.mjs` (the wrapper only
forwards the file list, blanks the two OpenRouter keys as `unitTestEnv` does, and caps local
concurrency, so the keys are blanked and concurrency set by hand here).

| | tests | pass | fail | line % | branch % | funcs % | duration |
|---|---|---|---|---|---|---|---|
| this run | 24,923 | 24,922 | 1 | 95.00 | 88.70 | 91.08 | 133 s |

The one failure is `scripts/code-shape/wrappers.test.mjs:258` ("without acorn each CLI that parses
code prints \"run npm install\" and exits 2"): `TMPDIR` in a dispatched session sits under the
simple-dispatcher checkout, whose `node_modules` holds acorn, so the "no acorn on the path" copy can
still resolve it. It fails identically with no mutant applied.

`coverage-table.tsv` is the full parsed per-file table (659 rows; test files are not rows).

## Trap 1: modules absent from the table

`git ls-files lib routes` (`.js`/`.mjs`) minus the table: **`routes/test.js` only** (mounted only
under `NODE_ENV=test`). It was eleven files at `0b5afa6f`.

## Import-only rows (funcs below 50%), added to the method this run

A module that is imported but never called now shows as a row with its declaration lines counted,
so a line percentage of 30 to 60 no longer means "executed".

| file | line | branch | funcs |
|---|---|---|---|
| `lib/render-audit.js` | 43.42 | 100.00 | 0.00 |
| `lib/render-custom-prompts.js` | 30.83 | 100.00 | 0.00 |
| `lib/render-templates.js` | 53.23 | 100.00 | 0.00 |
| `lib/custom-prompts-store.js` | 51.25 | 100.00 | 14.29 |
| `routes/legacy-redirects.js` | 63.38 | 100.00 | 28.57 |
| `lib/dispatch-session-read.js` | 100.00 | 86.67 | 44.44 |
| `routes/ship-biscuit.js` | 75.55 | 43.33 | 45.45 |

None is on an auth, money or data-integrity path.

## Fake-only DB modules

`fake-only-census.json`: of 62 `lib/**` modules that call a collection operation, 17 have no unit
file that imports them directly *and* loads a real engine. File-level heuristic: it misses a
fake-backed invariant inside a file that also opens a real engine (`lib/harbour-feedback-tokens.js`
is the known case).
