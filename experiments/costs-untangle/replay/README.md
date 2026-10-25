# Costs replay judge (LIN-3937)

An independent replay that judges a change to the cost code. It runs the old
commit and the new commit on the same recorded inputs, each in its own `node`
process under a frozen UTC clock, and compares every cost figure each surface
emits. It is not a unit test and is not in `npm run test:unit`.

```
node experiments/costs-untangle/replay/replay.mjs --old <sha> --new <sha> [--seed 7] [--n 2000] [--out <file>]
node experiments/costs-untangle/replay/selfcheck.mjs --old <sha> --new <sha> [--n 2000] [--seeds 7,11] [--out <file>]
```

Exit codes: `replay` 0 = every surface identical, 1 = differs, 2 = tool failure;
`selfcheck` 0 = all three checks hold.

## How it works

| File | Role |
|---|---|
| `replay.mjs` | CLI. Snapshots each commit with `git archive` into `work/<sha12>/` (gitignored), generates the scenarios once, runs both sides, diffs per surface. |
| `side.mjs` | One side, in its own process: `TZ=UTC`, env scrub (`WEEKLY_BUDGET_*` included), network guard, loads that tree's modules by absolute path, freezes the clock at each scenario's instant, seeds randomness, runs every surface. `NODE_V8_COVERAGE` is set by the parent. |
| `surfaces.mjs` | The surface table: one adapter per cost surface. Each calls the production functions of one tree; `cost` drives `GET /api/proxy/issues/:id/cost` over HTTP through `createProxyRoutes` with a store that ANDs its filters. |
| `gen.mjs` | Seeded generator: one world per index (`Rng(seed, 'gen', i)`), reproducible at any `--n`. |
| `edge.mjs` | Hand-written worlds, one per branch the generator does not reliably reach. |
| `canon.mjs` | Key-order-aware canonical JSON: insertion order is significant; `undefined`, `NaN`, `±Infinity`, `-0`, `Date`, `Map`, `Set` and functions are tagged, not dropped or coerced. |
| `mutants.mjs` | The planted faults: one per inventoried site (39 decision–site pairs, see `../decisions.md` §3). Each is one exact text replacement, asserted to occur once. `expect` is the set of surfaces the call graph says read the site, written before the run. |
| `selfcheck.mjs` | The three checks and the floors (below). |
| `coverage.mjs` | Line coverage of the inventoried cost functions, from V8 block coverage. |

Both sides load the same kit: `memCollection` from `../../replay-kit/lib/gen-kit.mjs` (the real MangoDB matcher and aggregation), and `hermetic.mjs` (`freezeClock`, `pinEnv`, `installNetworkGuard`).

## The three checks

1. **Identity.** Old against old, on two seeds, must give 0 differences. Each run is 2,030 scenarios (2,000 seeded worlds plus the edge worlds).
2. **Planted faults.** Each reachable mutant is applied to a copy of the new tree and must be caught at exactly the surfaces its `expect` names. A mutant caught nowhere, or caught at a different set, is reported, never tuned away.
3. **Non-vacuity.** Each surface must produce real figures in a floor share of scenarios (for example, a fully priced ticket total in at least 5% of scenarios). This catches the trap the spike found: a frozen clock that breaks `instanceof`, every lineage dropping out, and two sides that are equal only because both are zero.

Coverage of the inventoried functions is reported alongside (target 95%, hard floor 90%).

## Figures

See `work/selfcheck-2000.json` (written by the run; the PR quotes it). Final run (old = new = HEAD, the self-check's own identity and mutant checks): identity 0 differences on seeds 7 and 11, 2,031 scenarios each; every floor met; 24 of 39 pairs' mutants reachable, each caught at exactly its expected surfaces; coverage 100% of inventoried lines (653 of 653). The two-commit replay (`replay.mjs --old 4a6a4e50 --new <head>`) is run separately and its output quoted in the PR.

## Blind spots (named, not hidden)

- **Not run** (15 pairs; reasons in `mutants.mjs` and `../decisions.md` §6): browser code (`public/flight-companion.js`), the run page (`run-view.js`), the effort read-out, the `/kpis` public stats and workspace KPIs, the observation store and renderer, the OpenRouter response path (`extractUsage`, the picker hint), the persisted lineage status, the pricing sweep, and `llm-call-log` `record()` (needs an insert-capable collection).
- **Fakes shared by both sides**: the MangoDB engine (`memCollection`) and the dispatch store fake are the same code for old and new, so a bug in them cannot be seen as a difference. The store fake reproduces the query semantics the route uses (AND of filters, `total` before `limit`); it does not reproduce the real store's indexes or ordering.
- **Production row shapes**: the scenarios are generated from the documented shapes (raw store rows, the `/dispatch` formatted rows), not read from production. Reading production rows is a live call this ticket does not make; the question of how many OpenCode multi-turn lineages exist is a follow-up.
- **Concurrency**: `Promise.all` interleavings are not explored; fakes resolve immediately.
- **Coverage method**: a line counts as covered when a non-space character on it ran (V8 block coverage). A function's lines are found by brace matching, which ignores braces inside template literals spanning lines. It is an approximation of line coverage, good enough to find uncovered branches; it is not istanbul.
- **Rendered HTML**: the `/cost` surface is JSON. The ticket asks for rendered HTML to be compared too; no HTML surface is in this first version. This is a gap, not a pass.

## Adding a surface (moves 3 and 4)

Add an adapter to `SYNC_SURFACES` or `ASYNC_SURFACES` in `surfaces.mjs`. It takes the loaded tree's modules and one recorded scenario, and returns plain data. Do not touch the old side. A mutant whose site it reaches gets the surface added to its `expect`, derived from the call graph, before the run.

## Changes to the replay kit (`experiments/replay-kit/lib`)

Made so this judge can reuse the kit in any checkout:

- `sides.mjs`: `REPO` is the checkout that holds the kit (`import.meta.url` → `../../..`), not `/home/user/LinearViewer`.
- `gen-kit.mjs`: `MangoCollection` is imported relatively, not from `/home/user/LinearViewer`.
- `hermetic.mjs`: `DEFAULT_SCRUB` also scrubs `WEEKLY_BUDGET_*`, which `lib/weekly-budget.js` reads.

Checked: this judge runs `ensureSnapshot` (the `REPO` path) and `memCollection` (the MangoDB import), and `pinEnv` with the new scrub, on every run.

Not checked: the existing replays (`experiments/rebuild-rung*/replay`). They need snapshot directories under `replay-kit/snapshots/<sha>`, which this checkout does not have, and `replay-cli` does not create them, so a regression run failed before reaching the kit fixes (`spawn … ENOENT` on a missing `cwd`). That failure predates these changes. Whether those replays give identical results on a path-identical layout is not verified here.
