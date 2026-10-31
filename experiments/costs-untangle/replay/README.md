# Costs replay judge (LIN-3937)

An independent replay that judges a change to the cost code. It runs the old commit and the new commit on the same recorded inputs, each in its own `node` process under a frozen UTC clock, and compares every cost figure each surface emits, and every server-rendered cost page byte for byte. It is not a unit test and is not in `npm run test:unit`.

```
node experiments/costs-untangle/replay/replay.mjs --old <sha> --new <sha> [--seed 7] [--n 2000] [--out <file>]
node experiments/costs-untangle/replay/selfcheck.mjs --old <sha> --new <sha> [--n 2000] [--seeds 7,11] [--out <file>]
```

Exit codes: `replay` 0 = every surface identical, 1 = differs, 2 = tool failure. `selfcheck` 0 = identity, floors and planted faults hold, and coverage meets its 90% hard floor.

## How it works

| File | Role |
|---|---|
| `replay.mjs` | CLI. Snapshots each commit with `git archive` into a folder under the OS temp directory (`COSTS_REPLAY_WORK` overrides it; outside the checkout, so the repo's own tests never walk it), generates the scenarios once, runs both sides, diffs per surface. |
| `side.mjs` | One side, in its own process: `TZ=UTC`, env scrub (`WEEKLY_BUDGET_*` included), network guard, loads that tree's modules by absolute path, freezes the clock at each scenario's instant, seeds randomness, runs every surface. `NODE_V8_COVERAGE` is set by the parent. |
| `surfaces.mjs` | The surface table: one adapter per cost surface (22 of them, §"Surfaces"). Each calls the production functions of one tree. |
| `gen.mjs` | Seeded generator: one world per index (`Rng(seed, 'gen', i)`), reproducible at any `--n`. Worlds include the rate catalog, stored observation docs and OpenRouter usage, not only dispatch rows. |
| `edge.mjs` | Hand-written worlds, one per branch the generator does not reliably reach. |
| `canon.mjs` | Key-order-aware canonical JSON: insertion order is significant; `undefined`, `NaN`, `±Infinity`, `-0`, `Date`, `Map`, `Set` and functions are tagged, not dropped or coerced. |
| `mutants.mjs` | The planted faults: one per decision–site pair (`../decisions.md` §3), plus two D9 formatter faults. Each is one exact text replacement, asserted to occur once. `expect` is the set of surfaces the call graph says read the site. |
| `selfcheck.mjs` | The three checks, the floors, and the coverage. |
| `coverage.mjs` | Line coverage of every function that holds a §3 site, from V8 block coverage. |

Both sides load the same kit: `memCollection` from `../../replay-kit/lib/gen-kit.mjs` (the kit's MangoDB matcher and aggregation, so `$match`, `$group` and `$last` run for real), and `hermetic.mjs` (`freezeClock`, `pinEnv`, `installNetworkGuard`).

## The three checks

1. **Identity.** Old against old, on two seeds, must give 0 differences.
2. **Planted faults.** Each reachable mutant is applied to a copy of the new tree and must be caught at exactly the surfaces its `expect` names. A mutant caught nowhere, or caught at a different set, is reported, never tuned away.
3. **Non-vacuity.** Each surface has a floor: the share of scenarios in which it emits a real figure (a priced rate, a non-null cost, a rendered USD figure). A run where everything collapses to zero or to an empty page cannot pass as "identical".

Coverage of every function that holds a §3 site is reported alongside (target 95%, hard floor 90%).

## Surfaces

Cost figures, read through the production functions:

- `rate`, `usage`, `lineage`, `termMarked`, `gauge`: the pure builders (`computeUsageCostUsd`, `groupDispatchLineages`, `computeTerminalMarkedTaskCost`, `computeWeeklyBudgetGauge`).
- `taskCost`, `cost`: `buildTaskCost` per ticket, and `GET /api/proxy/issues/:id/cost` over HTTP through `createProxyRoutes`.
- `callLog`, `callRecord`: the call-log store's summaries, and the calls as `record()` writes them.
- `pricingHint`: the picker's price hint, over the cached catalog.
- `effort`: the effort read-out's sums.
- `spendByJob`: Settings › Models spend per job (`agentSpendByJob`, `harbourSpendByJob`), over `listInHorizon`.
- `observationStored`: the observation store's served sessions, by builder version.
- `run`: each run's view (`buildRunView`) over the production loop builder.
- `openrouterUsage`: a streamed OpenRouter call through `streamChat`, with the transport and recorder injected (`setFetchImpl`, `setLlmCallRecorder`).

Rendered pages, compared by the SHA-256 of their exact bytes, with the USD figures they show beside the hash:

- `healthHtml` (S2), `effortHtml` (S8), `modelsHtml` (S6), `sessionHtml` (S9, one per run), `workspaceKpisHtml` (S7), `publicKpisHtml` (S3), `observationHtml` (S10).

A page can carry its figures as data for its script (the observation page's `__OBSERVATION_DATA__`), so a numeric cost field in the markup also counts as a shown figure.

## Collections, and why the store shape matters

The KPI pages and the workspace read go through the kit's collection aggregation. The store returns instants as `Date`s, and a collection compares a `$gte` bound against a `Date`, so the judge hands those readers the production shape (`storeShape`, `surfaces.mjs`). The pure builders keep the strings the `/dispatch` JSON carries. A first draft did not do this, and the workspace page read empty for every world.

## Changes to the replay kit (`experiments/replay-kit/lib`)

- `sides.mjs`: `REPO` is the checkout that holds the kit (`path.resolve(<lib dir>, '../../..')`), not `/home/user/LinearViewer`.
- `gen-kit.mjs`: `MangoCollection` is imported relatively (`../../../node_modules/...`), not from `/home/user/LinearViewer`.
- `hermetic.mjs`: `DEFAULT_SCRUB` also scrubs `WEEKLY_BUDGET_*`, which `lib/weekly-budget.js` reads.

**Behaviour where the paths were hard-coded.** Both derived paths equal the old hard-coded ones in the original layout (checked by `path.resolve` on `/home/user/LinearViewer/experiments/replay-kit/lib/...`: `REPO` is `/home/user/LinearViewer`, and the MangoDB import is `/home/user/LinearViewer/node_modules/@jkershaw/mangodb/dist/collection.js`). So an existing replay resolves the same files in that layout.

**Existing replays (`experiments/rebuild-rung*/replay`) not run.** They need snapshot directories under `replay-kit/snapshots/<sha>`, which this checkout does not have, and they failed before reaching the kit's changed lines (`spawn … ENOENT` on a missing `cwd`). That failure predates these changes. The path equality above is the reason to expect no change; a run on a checkout that has the snapshots is the follow-up.

## Figures

From `selfcheck.mjs --old f1190392 --new d58b77f6 --n 2000 --seeds 7,11` (exit 0). The production tree is the same at both: `git diff f1190392 HEAD -- lib routes public server.js` is empty.

- **Identity:** 0 differences on seed 7 and on seed 11, 2,036 scenarios each (2,000 seeded worlds plus 36 edge worlds), across 22 surfaces.
- **Planted faults:** 46 of 46 reachable mutants caught at exactly their expected surfaces, 0 caught nowhere, 0 at an unexpected surface. By decision: D1 5/5 · D2 4/4 · D3a 2/2 · D3b 5/5 · D4 7/7 · D5 5/5 · D6 9/9 · D7 2/2 · D8 5/5 · D9 2/2. Not run: 1 (`public/flight-companion.js`, browser). Excluded under §1: 2.
- **Catches per surface** (how many mutants each surface caught): modelsHtml 18 · spendByJob 16 · publicKpisHtml 14 · cost 13 · termMarked 13 · workspaceKpisHtml 13 · effortHtml 12 · gauge 12 · taskCost 12 · effort 11 · run 11 · sessionHtml 11 · usage 7 · callLog 5 · rate 4 · healthHtml 4 · pricingHint 3 · observationHtml 3 · lineage 2 · observationStored 1 · openrouterUsage 1 · callRecord 1.
- **Non-vacuity floors:** all met. The thinnest is the public `/kpis` page, which shows its cost only at five priced finished tasks: 128 of 2,036 scenarios against a floor of 102 (5%).
- **Coverage:** 98.2% (978 of 996 lines) over every function that holds a §3 site; target 95%, hard floor 90%. Below 100%: `llm-call-log.js` `record` 23/30 (the insert path; the judge records with no collection), `effort-readout.js` `computeEffortReadout` 135/143, `observation-sessions-store.js` `findByWorkspace` 18/21 (its read-error path).
- **Base → head replay:** `replay.mjs --old f1190392 --new d58b77f6 --n 2000 --seed 7`: 0 differences over 2,036 scenarios, every surface, exit 0.

How the judge got here, recorded rather than hidden. The first full run had six mutants off their expected sets. Three were expectation errors, corrected from the code: `windowedSpend` calls `reduceLineageCost` and the workspace KPIs read the read window, so the workspace page reads those two sites; the per-issue sum feeds a field the public page does not draw. Three were generator gaps, fixed in `gen.mjs`: no rich world used a dated model id, the exact 272,000-token threshold, or the one model with a long-context tier (`openai/gpt-5.5`), and none had a failed lineage for the done gate. Two earlier fidelity bugs were also fixed before that: the KPI readers got ISO strings where the store returns Dates (the workspace page read empty), and generated rows carried no session target (the run page saw few runs).

## Blind spots (named, not hidden)

- **Browser code** (not run from node): `public/flight-companion.js` (D4, S11) and the browser formatter in `public/observation.js` (D9). A node import has no DOM.
- **Fakes shared by both sides**: the MangoDB engine (`memCollection`), the dispatch store fake and the call-log fake are the same code for old and new. A bug in them cannot appear as a difference. The dispatch store fake reproduces the query semantics the routes use (AND of filters, `total` before `limit`); it does not reproduce the real store's indexes or ordering.
- **Production row shapes**: the scenarios come from the documented shapes, not production data. Reading production rows is a live call this ticket does not make.
- **Concurrency**: `Promise.all` interleavings are not explored; fakes resolve immediately.
- **Coverage method**: a line counts as covered when a non-space character on it ran (V8 block coverage). A function's lines are found by brace matching. It is an approximation of line coverage, not istanbul.
- **Test-capture tier, dropped.** The plan's third input tier replays the calls the 16 cost-exercising unit-test files make. It is not built. The reason: those fixtures are hand-written to pass the code under test, so they add shapes the generator and the edge worlds already produce, not reach; the per-site reach is measured directly (every §3 site has a mutant with a caught-at set), which is the question the tier was meant to answer. The review allows an explicit drop with a reason; this is it.

## Adding a surface (moves 3 and 4)

Add an adapter to `SYNC_SURFACES` or `ASYNC_SURFACES` in `surfaces.mjs`. It takes the loaded tree's modules and one recorded scenario, and returns plain data (or a rendered page through `htmlOut`). Do not touch the old side. A mutant whose site it reaches gets the surface added to its `expect`, derived from the call graph, before the run.
