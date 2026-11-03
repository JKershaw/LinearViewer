# Evidence: Seams & Tangles review, run 4 (LIN-4152)

Measured at `015aa4c6acbc008d7fa73c32beec1528b7f59511` (origin/main, plan baseline) against `5b32864e14ec02b3c258fa3cf8cc7807eaf0bbb7` (run 3, the 2026-10-23 review). Every tool was run from the repo root against committed git objects. Guide paths are repo-relative, so each `areaMapSource` is `docs/reviews/_evidence-2026-11-03/...`.

## Guides (byte copies of `scripts/code-shape/areas.json` at each commit)

- `areas-5b32864e.json`: the old guide (run 3's). Byte-identical to `_evidence-2026-10-23/areas-5b32864e.json`.
- `areas-015aa4c6.json`: the HEAD guide. This is the series guide.

## Measured runs (the series)

Commands, from the repo root:

```
node scripts/code-shape/seams.mjs . <commit> docs/reviews/_evidence-2026-11-03/areas-<guide>.json > seams-code-<code>-guide-<guide>.json
node scripts/code-shape/cochange.mjs . <commit> --areas docs/reviews/_evidence-2026-11-03/areas-<guide>.json --days 60 > cochange-code-<code>-guide-<guide>-days60.json
```

- `seams-code-{5b32864e,015aa4c6}-guide-{5b32864e,015aa4c6}.json`: four seams runs (code × guide).
- `cochange-code-{5b32864e,015aa4c6}-guide-{5b32864e,015aa4c6}-days60.json`: four change-coupling runs, 60-day window.

## Labelled experiments (not edits to `areas.json`)

These are guide variants run on HEAD code, for the report's guide-effect section. They are proposals and do not change the repo's guide.

- `areas-proposal-P1-catchall-placed.json`: experiment P1. Places the 12 `^lib/` catch-all files by the role mapping in the research comment (§4): 4 to Runs, 4 to Task model, 4 to Pages.
- `areas-proposal-P2-plus-tree-and-model-routing.json`: experiment P2. Moves `lib/tree.js` from Pages to Task model, and gives `lib/model-routing*.js` its own area ("Model routing") ahead of LLM & prompts.
- `seams-code-015aa4c6-guide-proposal-P1-catchall-placed.json` and `seams-code-015aa4c6-guide-proposal-P2-plus-tree-and-model-routing.json`: seams runs on HEAD code under each experiment guide.

## Generators (committed, so the derived figures can be regenerated)

- `unmapped-by-topdir.mjs`: breaks down the files `cochange.mjs` leaves unmapped, by top-level directory. Output: `cochange-015aa4c6-unmapped-by-topdir.json`. Its `distinctUnmappedFiles` must equal the cochange `unmappedFiles` for the same commit, guide and window (5123 at HEAD, checked).
- `edge-dump.mjs`: file-level import edges, using `seams.mjs`'s own scope and the same specifier rules. Output: `edges-code-015aa4c6-guide-015aa4c6.json` and `edges-code-5b32864e-guide-015aa4c6.json`. Its cross-area edge count must equal the seams `links` total (1227 and 976, checked). Hub importer counts and outbound cross-area imports come from these files.

## Reproducibility witness

All four seams runs and all four cochange runs were re-run from the committed guide copies into a scratch directory and compared with `cmp`. All eight were byte-identical. The old-guide, old-code seams run also deep-equals `_evidence-2026-10-23/seams-code-5b32864e-guide-5b32864e.json` once `areaMapSource` is removed.

## Headline counts (from these files)

| code \ guide | old guide | HEAD guide |
|---|---|---|
| `5b32864e` | 462 files · 973 links · 11 pairs · group 7 | 462 · 976 · 11 · 9 |
| `015aa4c6` | 528 · 1241 · 14 · 8 | 528 · 1227 · 12 · 9 |

Every run: 0 parse failures, 4 unresolved relative imports (`routes/test.js` → `tests/fixtures`), 0 non-literal dynamic imports, 0 unmapped files. `lib/` → `routes/` imports: 0 (`git grep` at HEAD).

Change coupling, 60-day window:

| code \ guide | changes | touching 2+ areas | pairs | unmapped files |
|---|---|---|---|---|
| `5b32864e` (HEAD guide) | 808 | 343 | 74 | 4575 |
| `015aa4c6` (HEAD guide) | 899 | 398 | 76 | 5123 |

Unmapped files at HEAD, by top-level directory: `docs` 2875 (`docs/reviews` 2430), `tests` 1287, `experiments` 560, `scripts` 347, `prototypes` 39, root files 11, `.github` 2, `content` 1, `plans` 1.
