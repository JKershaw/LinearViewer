# Sibling repo JKershaw/simple-dispatcher, bounded grade (LIN-4418, 11 Nov 2026)

At `origin/main` `7d6c5c6` (67 commits after the previous run's `e2b4dcc`), using `npm test`'s own
`--require`s under native coverage:

```
node --experimental-test-coverage --require ./test/isolate-run.js --require ./test/state-cache-trap.js \
  --test test/*.test.js
```

| run | load | tests | pass | fail | skipped | line / branch / funcs |
|---|---|---|---|---|---|---|
| 1 | idle | 4,346 | 4,340 | 0 | 6 | 97.22 / 91.34 / 90.17 |
| 2-4 | idle | 4,346 | | 0 | 6 | |
| 5-6 | alongside the full Harbour unit suite (`--test-concurrency=5`) | 4,346 | | 0 | 6 | |

Previous run (`e2b4dcc`): 3,471 tests at 96.86 / 90.81 / 89.14, with two failures under
instrumentation only (LIN-2509 git-probe timeout, LIN-1420 W4 fetch call list). Neither recurred
in six runs.

`test/state-store.test.js` "never loses a field under many interleaved concurrent writers": research
(at the same sha) saw one failure under full-suite load (`field f6 was lost`). This run: 0 failures
in six full instrumented runs (two under heavy concurrent load) and 0 in 12 isolated runs
(`--test-name-pattern`). Not reproduced. The store's designed steal after `LOCK_TIMEOUT_MS = 5000`
(`state-store.js`, `acquireLock`) remains the plausible path if it recurs.

CI: the last 30 runs (2026-11-04 to 11-11) are all green; CI runs `npm test` only, on purpose
(`.github/workflows/ci.yml`, LIN-1580 / LIN-3160).
No mutation spikes were run on the sibling (bounded depth).
