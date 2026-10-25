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

## Router replays (`lib/router/`, added for rung 7 — `routes/workspace-api.js`)
Factored out of `../rung5c/replay` (dispatch routers) so later router rungs only write fakes +
scenarios. A target's `replay.mjs` calls `runRouterReplay(cfg)`; see `../rung7/replay` for a full
example.

| file | role |
|---|---|
| `router/harness.mjs` | `runRouterReplay(cfg)`: CLI (`--old --new --n --seed --out --coverage --lib --tiers --only --dump --keep-work --timeout-ms`), hermetic process (env scrub, non-loopback sockets blocked, global `fetch` recorded and answered by `cfg.fetchHandler`, seeded `Math.random`/`randomUUID`/`randomBytes` per request, console/unhandled capture), sides + hook, **seam shims**, import census, export-surface diff, real Express apps per side × `cfg.variants` on `127.0.0.1:0`, one HTTP request per scenario on virtual time (client aborts as virtual timers; server keeps running after a hang-up), body decoding (JSON / SSE events / text / bytes), per-request compare, aggregation (`perRoute` status histograms keyed by `cfg.statusKey`, `thinStatusPairs` <5, `slowRequests`), coverage, report; exit 0/1/2 |
| `router/hooks.mjs` | resolve hook: each side's copies live in `work/<run>/<side>/<subdir>/`; their imports resolve as if they sat in `<lib>/<subdir>/` and every lib module gets `?side=<label>` (a PRIVATE lib graph per side, sibling routes included); helper files present in the side's source folder are copied in on demand; `seams[<lib path>]` swaps that module, for every importer in the side, for a generated shim whose named exports call `cfg.seamHandler(ctx, rel, name, args, realFn)` (the rest re-exported live from the real module, loaded with `&seamreal=1`) |
| `router/prepare.mjs` | `resolveSide(spec, slots)` / `layoutSide(...)`: slot table `{slot: {file, factory, findBy?}}` |
| `router/common.mjs` | `snap`, `materialize` (`__err`, `__date`, `__setOf`, `__fromState` read from per-request state via `setStateGetter`), `buildError` kinds (gql/statusOnly/timeout/abort/network/cause/team/refResolution/partialWrite/coded/tagged/string/null), recording stores (`makeRecordingStore`: scenario `{ret}|{throw}|{seq}|{delayMs}|{hang}|{syncThrow}` or an arg-computed default), `recFn`, `runBehaviour` (hang/delay honour an AbortSignal found in the args via `signalIn`) |
| `router/vclock.mjs` | virtual `Date`/timers while a request runs (rung5c) + a virtual `AbortSignal.timeout` |
| `router/compare.mjs` | kinds: status, body, `header:*`, `header-derived:*`, depCalls, logEvent, credentialRegistry, egressFetch, fsAndTty, console, unhandledRejection, expressErrorHandler, **seamCalls**, **session**, serverResponse, `store:<name>` |
| `router/capture.mjs` + `capture-preload.mjs` | record every HTTP request the unit tests send to the router (method, URL, body, status, workspace provider kind / test-token flag) → `pinned/test-calls.json` |
| `router/livetests.mjs` | live unit-test tier: per side an overlay of the snapshot (`routes/`, `tests/`, `server.js` copied, the rest symlinked) with the side's file(s) in `routes/`; runs each selected test file per side and compares per-test TAP verdicts — the witness for direct-handler tests and source-text tests |
| `router/selfcheck.mjs` | `runRouterSelfcheck({toolDir, base, mutants})`: identity on N seeds with a coverage floor, then each mutant must be detected on its expected route only |
| `router/coverage.mjs` | V8 precise coverage → lines (rung5c) |
| `router/ai-coverage.mjs` | AI-path floors (LIN-3880): `evaluateAiCoverage({counts, floors, tiers, mode, only})` judges per-side counters a target's `cfg.aiCounters(sc, outcome)` produced against its `cfg.aiFloors` (`{key, min, needs: 'gen'|'edge'}`); a floor whose tier did not run is listed, not judged; `--ai-floor fail` (default) exits 3, `warn` prints, `off` records only |

Kit changes made for rung 7: `ensureSnapshot` now also archives `docs/` (lib reads
`docs/autopilot-operating-manual.md` at runtime; without it `buildScanMessages` fails closed and
every scan/retire answers 503). `docs/` was added to the existing `snapshots/16e7ae77` in place —
replays that ran on that snapshot before took the manual-missing fallback.

LIN-3880 (AI-path floors): a replay that never reaches a model call compared two 500s and read
`differing: 0`. `cfg.aiCounters` and `cfg.aiFloors` add a coverage judgement to every router run;
`runRouterSelfcheck({witnesses})` runs extra identity jobs under an env (`{id, env, expectExit}`)
and the identity check now also needs the coverage verdict `pass`. Targets without `aiCounters`
keep the old behaviour.
