# workspace-api router replay (rung 7) — tool folder

Full description, inputs, self-check results, source-text tests, security notes and limits:
`../README.md`. Kit pieces: `../../replay-kit/lib/router/` (see `../../replay-kit/README.md`).

```
node replay.mjs --new <dirOrFile> [--old pinned/origin-main] [--n 3000] [--seed 1] [--out f.json]
                [--coverage] [--lib DIR] [--tiers gen,edge,test] [--only <id>] [--dump f.jsonl]
                [--ai-floor fail|warn|off]   # fail (default): exit 3 when the AI path was not exercised
node livetests.mjs --new <dirOrFile> [--old pinned/origin-main] [--all] [--jobs 6] [--out f.json]
node selfcheck.mjs [--n 3000] [--seeds 1,7] [--mutant-n 1500] [--jobs 4] [--lib DIR]   # identity, 24 mutants, 1 witness
node capture-tests.mjs [--repo <snapshot>] [--jobs 6]
```

`--lib` defaults to the repo root and must be a tree with `lib/model-routing.js` (LIN-3853 or later); the 16e7ae77 snapshot predates it and exits 4.

| file | role |
|---|---|
| `replay.mjs` | cfg for `runRouterReplay`: slot, seams (openrouter ×4, audit.runAudit), managed env, app variants, server.js middleware + final error handler transcriptions, statusKey, tags |
| `lib/fakes.mjs` | deps as server.js:2978 passes them (variants full/sparse/seams), recording stores (workspace preferences answer `getRoutingTable` from the scenario's preferences, LIN-3880; `REPLAY_STALE_FAKES=1` drops that default to reproduce the pre-fix kit; the dispatch store answers `listItemsWithPrompt`/`listHistoryWithBodies` from the scenario's `listItems`/`listHistory`, LIN-3934), provider registry patch + 2 synthetic stub providers, seam handler (model text / events / abort-aware; the Principle 0 section, `null` on `sc.ai.principleZero`), fetch responder (image, catalog, GitHub), AI-path counters and floors (`aiCountersFor`, `AI_FLOORS`) |
| `lib/gen.mjs` | seeded generator: 44 forms, fixtures, route table + `routeKeyFor`; per-operation model overrides (`aiModelOverrides.byKind`) and `principleZero: null` draws on scan/retire/recap/brief/recommend |
| `lib/edge.mjs` | ≈390 targeted edge cases, plus the Principle 0 fail-closed arm on scan and retire and the seven verbs on each AI path (LIN-3880); test-tier replay of `pinned/test-calls.json` |
| `livetests.mjs` | live unit-test tier (overlay per side) |
| `selfcheck.mjs` | identity ×2 seeds + 24 mutants + 1 witness |
| `pinned/origin-main/workspace-api.js` | the OLD side (16e7ae77, byte-identical) |
| `pinned/origin-main/workspace-api-prompts.js` | its prompts sub-router at the same commit (byte-identical, LIN-3934): without it `./workspace-api-prompts.js` resolves to `--lib`, whose copy has held the prompt-generation routes since LIN-3842 and shadows the pinned ones |
| `pinned/test-calls.json` | 351 requests from 94 unit-test files |
| `reports/` | selfcheck.json/.log (pre-LIN-3880 record), selfcheck-lin3880.json/.log (with the AI-path floors, mutants 16–24 and the vacuity witness), selfcheck-lin3934.json/.log (green under `--lib .`), livetests-*.json, variant-text-replay.json |
