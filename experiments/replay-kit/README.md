# replay-kit — shared harness for behavioural replays of one Harbour module

Factored out of `../rung5d/replay` (pipeline-loops: in-process tiers, fresh module per input,
coverage, mutant self-check) and `../rung5a/replay` (dispatch factory: live per-side test tier with
dependency recording). Used by `../rung6a/replay` (task-page-loader) and `../rung6b/replay`
(kpi-stats). It never writes to `/home/user/LinearViewer`, makes no network calls (non-loopback
connects, DNS and `fetch` are blocked and counted) and no model calls.

## What a target supplies
```
<dir>/replay/
  replay.mjs      cfg {name, here, main, sha, snapshotDir, pinnedDir, targetFile, factories,
                  excludeTests, topKinds}  →  runReplay(cfg)
  selfcheck.mjs   mutants [{id, name, pairs:[[from,to]], expect:'detect'|'finding'|'info', kind}]
                  → runSelfcheck(cfg, mutants)
  target.mjs      generate(seed, i) → scenario;  edgeCases() → [scenario];
                  createWorld(spec, io) → {depName: fake};  inspect(ctx) → findings (optional)
  pinned/origin-main/<main>   (node ../../replay-kit/pin.mjs <sha> lib/<main> <outDir>)
```
A scenario is pure data: `{id, tier, family, world, steps:[{fn, args}]}`. `fn` is an export path
(`collectKpiStats`, `__internal.x`) or a method of an earlier step's result (`$0.loadTaskPage`).
In `args`, `{$dep:'name'}` becomes `world[name]` and `{$step:i}` step i's result.

## Pieces (`lib/`)
| file | role |
|---|---|
| `sides.mjs` | `ensureSnapshot` (git archive of `<sha>` lib/routes/tests/public/server.js/scripts/content + `node_modules` link), `pinCopy` (git show + line-preserving import rewrite to the snapshot), `layoutSide` (old/new work trees: a side's own helper files stay relative and side-local; other relative imports → absolute snapshot URLs) |
| `hooks.mjs` | resolve hook: `?inst=` propagation inside a side tree (fresh module graph per scenario) and the test-tier redirect of the snapshot's target URL to a recording shim |
| `hermetic.mjs` | TZ=UTC + env scrub, frozen clock (`Date`, `Date.now`; `instanceof Date` kept for cloned Dates), seeded `Math.random`/`crypto.randomUUID` per step, network guard |
| `runner.mjs` | runs one scenario on one fresh module instance: outcome (return/throw/resolve/reject), value (canon), key order, aliasing, console, dep calls, input mutation, store-result mutation, unhandled rejections, target findings; `describeExports` |
| `canon.mjs` | canonical JSON of any value (sorted keys; Date/Map/Set/NaN/-0/undefined/holes tagged; deps opaque as `{$dep}`; function names dropped, arity kept) + diff + alias index |
| `compare.mjs` | per-step diff kinds: outcome, async-shape, error, return, console, storeCalls, input-mutation, store-result-mutation, unhandled-rejection, import-side-effects, target findings (e.g. `privacy-leak`); info kinds: key-order, alias, storeCalls:order, pureCalls |
| `worker.mjs` | worker thread for the edge/gen tiers (both sides per scenario, coverage folding) |
| `test-live.mjs`, `test-record.mjs`, `test-preload.mjs` | **test tier**: discovers unit-test files whose import graph reaches the target (cached in `pinned/test-files.json`), runs each once per side from the snapshot (cwd = snapshot) under the hermetic preload, records every call to every export (and `<factory>().<method>` calls) with deps recorded through the args (AsyncLocalStorage), compares call-by-call plus TAP pass/fail and exit code |
| `coverage.mjs` | V8 precise coverage via `node:inspector`, folded per file across module instances and workers (from rung5d) |
| `gen-kit.mjs` | `Rng(seed, tier, index)`, `canary()`/`CANARY_RE`, `recordDep()` (records calls, hands out results, wraps returned cursors), `deliver()` failure modes, `memCollection()` (in-memory MangoDB collection — real matcher/projection/aggregation — or `mango-noagg`, `mock`, `mock-naive` flavours with injected failures), `stringsIn()` |
| `replay-cli.mjs` | the CLI (`--old --new --n --seed --out --coverage --jobs --tiers --only --detail --rediscover-tests --now`), aggregation into groups / infoGroups / per-side findings, export-surface diff, coverage report; exit 0 same / 1 differ (or new-side finding, or export diff) / 2 tool failure |
| `selfcheck-cli.mjs` | identity on two seeds with coverage ≥ 95 % (lines of the pinned file), then each mutant |

## Notes
- Shared modules come from the **snapshot**, not the checkout: `/home/user/LinearViewer` is at
  f4749b91 while origin/main is 1f8010a0 (pipeline-loops and four renderers differ).
- Findings are per side. A finding only one side has is also a difference; old-side findings are
  printed with `!!` and listed under `report.findings.old` (a baseline problem, not a regression).
- Dep calls of injected pure helpers (`recordDep(..., {pure:true})`) are info, not differences.
- Limits: fakes are models; the test tier is the real-store witness only for what tests exercise;
  `Promise.all` interleavings are not explored (fakes resolve immediately).
