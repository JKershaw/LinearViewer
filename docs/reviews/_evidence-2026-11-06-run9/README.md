# Evidence: Seams & Tangles run 9 (LIN-4323, 2026-11-06)

Evidence for `docs/reviews/seams-tangles-review-2026-11-06-run9.md` (written at the build stage). Review-only; nothing here edits code, config or the guide.

**Measured commits.**
- Baseline: `af55cb737ec4e63919bac65558b35498ede3d290` (run 8's measured commit).
- Measured (HEAD): `5c63aa261a2de891907c9b8d567f9932ed1985d0` (origin/main at measurement, 2026-11-06 ~11:10Z; the same commit the ticket was minted at).

**Guide.** One area guide serves both commits: `areas.head-5c63aa26.json`, a byte copy of `scripts/code-shape/areas.json` (blob `642e9405` at both commits, and byte-identical to run 8's `areas.head-af55cb73.json`). Checked with `cmp`.

**Tools (unchanged in the window, same blobs at both commits).** `seams.mjs` `34f11434`, `cochange.mjs` `c3a39f37`, `cochange-core.mjs` `763a37b8`, `code-shape-lib.mjs` `42a1e521`.

**Run 8 reproduces.** At `af55cb73` the seams JSON, cochange JSON, edge dump and P7min proposal run equal run 8's files key for key apart from the guide-path string (`areaMapSource` / `guide`). `cochange-window-commits-af55cb73.txt` and `unmapped-paths-af55cb73.txt` are byte-identical to run 8's.

Run from the repo root. `E=docs/reviews/_evidence-2026-11-06-run9`, `G=$E/areas.head-5c63aa26.json`.

## Files

| file | what it is | command |
|---|---|---|
| `areas.head-5c63aa26.json` | byte copy of the one guide used for every run | `git show af55cb73:scripts/code-shape/areas.json` (same blob at HEAD) |
| `seams-code-{af55cb73,5c63aa26}-guide-head-5c63aa26.json` (`.stderr`) | import graph at each commit | `node scripts/code-shape/seams.mjs . <sha> $G` |
| `cochange-code-{af55cb73,5c63aa26}-guide-head-5c63aa26-days60.json` (`.stderr`) | change coupling, 60 days | `node scripts/code-shape/cochange.mjs . <sha> --areas $G --days 60` |
| `cochange-window-commits-{af55cb73,5c63aa26}.txt` | the first-parent commits in each 60-day window | `git log <sha> -s --first-parent --format=%H --since=<windowStart> --until=<windowEnd>` |
| `edge-dump.mjs` | byte copy of run 8's file-level edge dumper | `node $E/edge-dump.mjs . <sha> $G` |
| `edges-code-{af55cb73,5c63aa26}-guide-head-5c63aa26.json` | every file-level import edge with its areas; the `edgeList` diff is the complete import change (1 added, 0 removed) | `edge-dump.mjs` at each commit |
| `unmapped-paths.mjs`, `unmapped-paths-{af55cb73,5c63aa26}.txt` | byte copy of run 8's script and the exact file sets behind `unmappedFiles` (5746 and 6218) | `node $E/unmapped-paths.mjs . <sha> $G` |
| `compare-run9.mjs` → `compare-run9.md` | the run 8 → run 9 comparison, built only from the JSON above (run 8's `compare-run8.mjs` with SHAs and labels changed) | `node $E/compare-run9.mjs . $E > $E/compare-run9.md` |
| `supplementary-figures.py` → `supplementary-figures.txt` | sections S0–S19 (run 8's definitions, SHAs and labels changed; S16 adds the window's hubs `periodicals.js`, `dispatch-entrance.js`, `proxy-scopes.js`, `dispatch-validation.js`, `proxy-instructions.js`, `routes/proxy-dispatch.js`, `stage-writes.js`) | `SD_DIR=../simple-dispatcher python3 -I $E/supplementary-figures.py . > $E/supplementary-figures.txt` |
| `guide-experiments-run9.py` → `guide-experiments-run9.txt`, `areas.proposal-P7min-stage-writes.json`, `seams-code-*-guide-proposal-P7min-stage-writes.json` | run 8's P7min proposal re-measured at both SHAs (proposal guide byte-identical to run 8's) | `python3 -I $E/guide-experiments-run9.py write`, `seams.mjs` at each SHA with the proposal guide, then `… summary` |
| `RESEARCH-NOTES.md` | the research stage's notes and extra commands (the report supersedes its prose) | — |

The `seams` stderr files are empty; the `cochange` ones are one line.
