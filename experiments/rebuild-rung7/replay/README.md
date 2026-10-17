# workspace-api router replay (rung 7) — tool folder

Full description, inputs, self-check results, source-text tests, security notes and limits:
`../README.md`. Kit pieces: `../../replay-kit/lib/router/` (see `../../replay-kit/README.md`).

```
node replay.mjs --new <dirOrFile> [--old pinned/origin-main] [--n 3000] [--seed 1] [--out f.json]
                [--coverage] [--lib DIR] [--tiers gen,edge,test] [--only <id>] [--dump f.jsonl]
node livetests.mjs --new <dirOrFile> [--old pinned/origin-main] [--all] [--jobs 6] [--out f.json]
node selfcheck.mjs [--n 3000] [--seeds 1,7] [--mutant-n 1500] [--jobs 4] [--lib DIR]
node capture-tests.mjs [--repo <snapshot>] [--jobs 6]
```

| file | role |
|---|---|
| `replay.mjs` | cfg for `runRouterReplay`: slot, seams (openrouter ×4, audit.runAudit), managed env, app variants, server.js middleware + final error handler transcriptions, statusKey, tags |
| `lib/fakes.mjs` | deps as server.js:2978 passes them (variants full/sparse/seams), recording stores, provider registry patch + 2 synthetic stub providers, seam handler (model text / events / abort-aware), fetch responder (image, catalog, GitHub) |
| `lib/gen.mjs` | seeded generator: 44 forms, fixtures, route table + `routeKeyFor` |
| `lib/edge.mjs` | ≈390 targeted edge cases; test-tier replay of `pinned/test-calls.json` |
| `livetests.mjs` | live unit-test tier (overlay per side) |
| `selfcheck.mjs` | identity ×2 seeds + 15 mutants |
| `pinned/origin-main/workspace-api.js` | the OLD side (16e7ae77, byte-identical) |
| `pinned/test-calls.json` | 351 requests from 94 unit-test files |
| `reports/` | selfcheck.json/.log, livetests-*.json, variant-text-replay.json |
