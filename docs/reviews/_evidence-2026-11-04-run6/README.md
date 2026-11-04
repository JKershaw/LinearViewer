# Evidence: Seams & Tangles review, run 6 (LIN-4231)

Window: `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e` (run 5's measured commit, the baseline) to `d7ceb373444f9efbc027656132352d247535aa5e` (origin/main at measurement, unchanged since the ticket was minted). 8 commits. Every tool was run from the repo root against committed git objects, with `node_modules` present (`acorn`). Guide paths are repo-relative, so each `areaMapSource` and `guide` field points into this folder. Run 5's `_evidence-2026-11-04/` is not touched.

## Guides (byte copies of `scripts/code-shape/areas.json`)

| file | source | git blob (`git hash-object` = `git rev-parse "<sha>:scripts/code-shape/areas.json"`) | sha256 (prefix) |
|---|---|---|---|
| `areas.old-5334c81a.json` | `git show "5334c81a7207b9f2cc85ca429a2c6b18e1635c0e:scripts/code-shape/areas.json"` | `816b2e66aeafdd84fb05d21cc005c55a0f2c6735` | `502d3ff0ea0579ea` |
| `areas.head-d7ceb373.json` | `git show "d7ceb373444f9efbc027656132352d247535aa5e:scripts/code-shape/areas.json"` | `642e9405beb0aee05916bf072547fdf653d42966` | `e3194f52a76ed595` |

- The old guide is byte-identical to run 5's HEAD guide copy (`cmp` against `_evidence-2026-11-04/areas-5334c81a.json`).
- The HEAD guide differs from the old guide by two lines (LIN-4201, `2ee4e600`). It adds `cost-read|row-usage|lineage-membership` to "Runs & dispatch" and `workspace-kpis-cache` to "Reports & operator tools".

## Tool runs (code × guide, all four combinations)

From the repo root, `E=docs/reviews/_evidence-2026-11-04-run6`, `<code>` ∈ {`5334c81a7207b9f2cc85ca429a2c6b18e1635c0e`, `d7ceb373444f9efbc027656132352d247535aa5e`}, `<g>` ∈ {`old-5334c81a`, `head-d7ceb373`}:

```
node scripts/code-shape/seams.mjs . <code> $E/areas.<g>.json > $E/seams-code-<code8>-guide-<g>.json 2> $E/seams-code-<code8>-guide-<g>.stderr
node scripts/code-shape/cochange.mjs . <code> --areas $E/areas.<g>.json --days 60 > $E/cochange-code-<code8>-guide-<g>-days60.json 2> $E/cochange-code-<code8>-guide-<g>-days60.stderr
node $E/edge-dump.mjs . <code> $E/areas.<g>.json > $E/edges-code-<code8>-guide-<g>.json
```

- Every run exited 0. The seams `.stderr` files are empty. Each cochange `.stderr` holds the tool's one-line summary.
- `git rev-parse --is-shallow-repository` returned `false`.
- `edge-dump.mjs` is a byte copy of `_evidence-2026-11-04/edge-dump.mjs` (checked with `cmp`), which was itself run 4's generator.
- **Witness:** the cross-area edge count of each edge dump equals the seams `links` total for the same code and guide: 1262, 1249, 1275 and 1259.

## Derived figures

- `compare-run6.mjs` reads only the files in this folder, plus the tool's own `compileGuide` / `readCommit(inScope)` over committed objects.
  - It is needed for catch-all membership and for per-file importer counts, because `seams.mjs` reports only area file counts and cross-area entry files.
  - Run as `node $E/compare-run6.mjs . $E > $E/compare-run6.md`.
- `compare-run6.md` is its output. It covers:
  - scope and tool limits;
  - the headline per combination;
  - the knot-pair table and knot groups;
  - catch-all members and their diffs;
  - area file counts and entry files per area;
  - importers by area for the named files;
  - the placement vs code decomposition, and the directed area links that differ;
  - file-level edges added or removed by code, and the edges whose labels change with the guide;
  - the cochange tables, with run 5 §6 alongside, and no-link pairs.
- `cochange-window-commits-{5334c81a,d7ceb373}.txt` list the commits in each cochange window. They were produced by the same `git log <sha> --first-parent --since=<windowStart> --until=<windowEnd>` the tool uses, printed with `--format=%H`. Of these, 846 are shared, 28 appear only at `5334c81a` (all dated 2026-09-05) and 8 only at `d7ceb373` (the window's 8 commits).

## Supplementary figures (not in the tool JSON)

- `supplementary-figures.py` reads committed git objects at the two pinned SHAs and the edge dumps in this folder, and prints the figures the tools do not report.
  - Run from the repo root: `SD_DIR=<simple-dispatcher clone> python3 docs/reviews/_evidence-2026-11-04-run6/supplementary-figures.py . > docs/reviews/_evidence-2026-11-04-run6/supplementary-figures.txt`.
  - Its output, `supplementary-figures.txt`, has these sections:
    - S0: window facts and the line counts of `cost-read.js`;
    - S1: `lib` → `routes`;
    - S2: route → route edges (run 5's definition);
    - S3: F7, using run 4's heuristic;
    - S4: F6 globals and script lists;
    - S5: N8;
    - S6: carried anchors and loader injection sites;
    - S7: Runs → Pages edges;
    - S8: cost-family edges in F1;
    - S9: the `workspace-` pattern;
    - S10: LIN-4200 scripts;
    - S11: cochange window overlap;
    - S12: the commits behind the no-link pairs;
    - S13: Simple Dispatcher module format;
    - S14: the Survey place-ledger rows, read only;
    - S15: entry files per area for every combination.
- `external-state-2026-11-04.txt`: the Linear states (read through the workspace proxy) and GitHub PR states (`gh pr view`) that the report's §8 cites, read on 2026-11-04 at about 18:39Z.
- `pr-2275-prod-imports.txt`: the production import lines changed by the open PR #2275 (LIN-4226) at head `911513a2`. It is read only and backs the report's "next run" notes.
