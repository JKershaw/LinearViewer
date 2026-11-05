# Evidence: Seams & Tangles review, run 7 (LIN-4249)

Window: `d7ceb373444f9efbc027656132352d247535aa5e` (run 6's measured commit, the baseline) to `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (origin/main at the ticket's mint time, and still origin/main when measured on 2026-11-05 at about 08:00Z). 11 commits. Every tool was run from the repo root against committed git objects, with `node_modules` present (`acorn`). `git rev-parse --is-shallow-repository` returned `false`. Run 6's `_evidence-2026-11-04-run6/` and every other 2026-11-04 file are untouched.

## Guide (byte copy of `scripts/code-shape/areas.json`)

| file | source | git blob | note |
|---|---|---|---|
| `areas.head-2eb73ae0.json` | `git show "2eb73ae0…:scripts/code-shape/areas.json"` | `642e9405beb0aee05916bf072547fdf653d42966` | same blob at `d7ceb373`; byte-identical (`cmp`) to run 6's `areas.head-d7ceb373.json` |

The guide did not change in the window (`git diff d7ceb373 2eb73ae0 -- scripts/code-shape/` is empty), so one guide serves both commits and every difference below is code.

## Tool runs

From the repo root, `E=docs/reviews/_evidence-2026-11-05`, `G=$E/areas.head-2eb73ae0.json`, `<code>` ∈ {`d7ceb373…`, `2eb73ae0…`}:

```
node scripts/code-shape/seams.mjs . <code> $G > $E/seams-code-<code8>-guide-head-2eb73ae0.json 2> $E/seams-code-<code8>-guide-head-2eb73ae0.stderr
node scripts/code-shape/cochange.mjs . <code> --areas $G --days 60 > $E/cochange-code-<code8>-guide-head-2eb73ae0-days60.json 2> $E/cochange-code-<code8>-guide-head-2eb73ae0-days60.stderr
node $E/edge-dump.mjs . <code> $G > $E/edges-code-<code8>-guide-head-2eb73ae0.json
node $E/compare-run7.mjs . $E > $E/compare-run7.md
```

- Every run exited 0. The seams `.stderr` files are empty; each cochange `.stderr` holds the tool's one-line summary.
- **Reproduction of run 6.** The `d7ceb373` seams and cochange JSON here equal run 6's `*-code-d7ceb373-guide-head-d7ceb373*` JSON key for key, apart from the `areaMapSource`/`guide` path strings. The `d7ceb373` edge list equals run 6's edge list exactly.
- `edge-dump.mjs` is a byte copy of run 6's (itself run 4's generator).
- **Witness:** each edge dump's cross-area count equals the seams `links` total for the same commit: 1259 and 1269.
- `compare-run7.mjs` reads only this folder plus the tool's own `compileGuide` / `readCommit(inScope)`. It is needed for catch-all membership and file-level edges, which `seams.mjs` does not list. `compare-run7.md` is its output.
- `cochange-window-commits-{d7ceb373,2eb73ae0}.txt` list each cochange window's commits (`git log <sha> --first-parent --since=<windowStart> --until=<windowEnd> --format=%H`, the tool's own query). The `d7ceb373` list is byte-identical to run 6's. 840 commits are shared; 14 appear only at `d7ceb373` (11 dated 2026-09-05, 3 dated 2026-09-06 before 06:00Z) and 11 only at `2eb73ae0` (this window's 11 commits).

## Supplementary figures (beat 2 onward; not in the tool JSON)

- `supplementary-figures.py` reads committed git objects at the two pinned SHAs and the JSON in this folder. Sections S0–S15 keep run 6's definitions (`_evidence-2026-11-04-run6/supplementary-figures.py`), so the figures compare mechanically. S16–S19 are new: named hubs and doors, top files by cross-area importers, `server.js` outbound by area, and the browser seam (script lists, `window.HomePlacement`, the `ruling-settled` code).
  - Run from the repo root: `SD_DIR=<simple-dispatcher clone> python3 -I docs/reviews/_evidence-2026-11-05/supplementary-figures.py . > docs/reviews/_evidence-2026-11-05/supplementary-figures.txt`.
  - S13 read Simple Dispatcher `origin/main` at `07c88f7a338b3e19a01070775e1f4d4cfc91f040`. S14 read `origin/claude/cool-rubin-6acj5j` at `23edd667eff4bdd547c930adf8fe2578fac5464e`, read only.

## Guide experiments (labelled proposals; the committed guide is not edited)

- `guide-experiments.py write` writes `areas.proposal-P7min-new-files.json` (the window's two new catch-all files placed) and `areas.proposal-P1d-placed-16.json` (every catch-all file placed) from `areas.head-2eb73ae0.json`, by appending one pattern to each named area.
- Each proposal guide was run through `seams.mjs` at both commits:
  `node scripts/code-shape/seams.mjs . <code> $E/areas.proposal-<P>.json > $E/seams-code-<code8>-guide-proposal-<P>.json 2> $E/seams-code-<code8>-guide-proposal-<P>.stderr`
  Every run exited 0, and every `.stderr` file is empty.
- `guide-experiments.py summary > guide-experiments.txt` prints files, links, pairs, groups and the catch-all count for the HEAD guide and both proposals at both commits.
- Nothing here is a test, check or count that enforces the guide.

## External state

- `external-state-2026-11-05.txt` records the ticket states, 21 Linear searches (`GET /api/proxy/search`) and PR #2185, as read on 2026-11-05 for the follow-up decision.
