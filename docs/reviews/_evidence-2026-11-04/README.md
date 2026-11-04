# Evidence: Seams & Tangles review, run 5 (LIN-4208)

Window: `015aa4c6acbc008d7fa73c32beec1528b7f59511` (run 4's measured commit, the baseline) to `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e` (origin/main at measurement). 15 commits. Every tool was run from the repo root against committed git objects. Guide paths are repo-relative, so each `areaMapSource` points into this folder.

## Guides (byte copies of `scripts/code-shape/areas.json`)

- `areas-015aa4c6.json`: the old guide. Byte-identical to run 4's HEAD guide (`_evidence-2026-11-03/areas-015aa4c6.json`, checked with `cmp`).
- `areas-5334c81a.json`: the HEAD guide. Differs from the old guide by one line: `request-usage-[^/]*` added to the "Runs & dispatch" pattern (LIN-4198, `9cc5ff9c`).

## Measured runs (the series)

Commands, from the repo root (`A=015aa4c6…`, `B=5334c81a…`):

```
node scripts/code-shape/seams.mjs . <commit> docs/reviews/_evidence-2026-11-04/areas-<guide>.json > seams-code-<code>-guide-<guide>.json
node scripts/code-shape/cochange.mjs . <commit> --areas docs/reviews/_evidence-2026-11-04/areas-<guide>.json --days 60 > cochange-code-<code>-guide-<guide>-days60.json
```

- `seams-code-{015aa4c6,5334c81a}-guide-{015aa4c6,5334c81a}.json`: four seams runs (code × guide). Each `.stderr` is the tool's stderr (empty).
- `cochange-code-{015aa4c6,5334c81a}-guide-{015aa4c6,5334c81a}-days60.json`: four change-coupling runs, 60-day window. `.stderr` holds the one-line summary.

## Labelled experiments (not edits to `areas.json`)

- `areas-proposal-P1b-placed-17.json`: the HEAD guide with the 17 catch-all files placed. Run 4's P1 placement of its 12 files (4 to Runs, 4 to Task model, 4 to Pages), plus the five files added this window: `cost-read.js` and `founder-lookup.js` to Runs; `cost-format.js`, `key-state.js` and `key-state-holders.js` to Platform. Run with seams at both commits: `seams-code-{015aa4c6,5334c81a}-guide-proposal-P1b-placed-17.json`.
- `areas-proposal-P3-rebuild-to-reports.json`: the HEAD guide with `^experiments/rebuild-[^/]+/` added to "Reports & operator tools" (run 4's P3). Run with cochange at both commits (`cochange-code-{015aa4c6,5334c81a}-guide-proposal-P3-days60.json`) and seams at HEAD (`seams-code-5334c81a-guide-proposal-P3-rebuild-to-reports.json`). Seams is unaffected by design, since `experiments/` is outside its scope.

## Generators and derived figures

- `edge-dump.mjs` (byte copy of run 4's committed generator): file-level import edges with area labels. Run as `node edge-dump.mjs . <commit> <guide>`:
  - `edges-code-015aa4c6-guide-5334c81a.json`
  - `edges-code-5334c81a-guide-5334c81a.json`
  - `edges-code-015aa4c6-guide-015aa4c6.json` (its cross-area count, 1227, equals the seams link total at that commit and guide. Its `edgeList` matches run 4's dump; the files differ only in the guide path recorded in the header.)
- `unmapped-by-topdir.mjs` (byte copy of run 4's generator): not re-run this window; the unmapped totals are read directly from the cochange JSON (`unmappedFiles`).
- `hub-and-edge-figures.py`: reads the edge dumps and prints hub importer counts, door importers, route→route edges, lib→routes edges and the cost-read/cost-format importer lists. Output: `hub-and-edge-figures.txt`.
- `file-edge-diff.py`: diffs the file-level edge lists of the two commits under the HEAD guide (added and removed cross-area edges, and area-pair deltas). Output: `file-edge-diff.txt`.
- `seams-pair-table.txt`: the knot-pair table for each seams run, plus the P1b runs, extracted from the seams JSON.

## Measurement witnesses

- Seams, all runs: 0 parse failures; 4 unresolved relative imports (all in `routes/test.js`: `tests/fixtures/{local,github,github-projects,jira}-harness.js`); 0 non-literal dynamic imports; 0 unmapped files.
- Catch-all membership was enumerated independently by first-match of each guide over `git ls-tree` (in-scope `lib/`, `routes/`, `public/`, `server.js`, `.js`/`.mjs`): 12 at `015aa4c6`, 17 at `5334c81a` (HEAD guide), matching the tool.
- `lib/` → `routes/` imports: 0 (`git grep` for `../routes/` and `./routes/` from `lib/`, at both commits).
- Simple Dispatcher (`/Users/autopilot/development/simple-dispatcher-workspaces/789fd9d2-…/simple-dispatcher`, read directly, not by the tool): `dispatcher.js` has 35 `require(` and 0 `import`/`export` lines; `package.json` has no `"type"` field.
