# Evidence: Seams & Tangles run 9 (LIN-4323, 2026-11-06)

Evidence for `docs/reviews/seams-tangles-review-2026-11-06-run9.md`. Review-only; nothing here edits code, config or the guide.

**Measured commits.**
- Baseline: `af55cb737ec4e63919bac65558b35498ede3d290` (run 8's measured commit).
- Measured (HEAD): `90542b2c79016d2a1d64f75cb5d3e9037080eae7` (origin/main at build time, 2026-11-06 ~11:20Z; LIN-4311, a tests-only commit, landed after the ticket was minted).
- Research-stage measurement, kept for comparison: `5c63aa261a2de891907c9b8d567f9932ed1985d0` (the ticket's mint-time HEAD). Its files carry `5c63aa26` in the name. Every production figure at `5c63aa26` equals the `90542b2c` figure, apart from the commit field and the test-only unmapped paths (see "Reproduction").

**Guide.** One area guide serves every run: `areas.head-5c63aa26.json`, a byte copy of `scripts/code-shape/areas.json` (blob `642e9405` at all three commits, and byte-identical to run 8's `areas.head-af55cb73.json`). Checked with `cmp` against `git show af55cb73:scripts/code-shape/areas.json`.

**Tools (unchanged in the window, same blobs at both ends).** `seams.mjs` `34f11434`, `cochange.mjs` `c3a39f37`, `cochange-core.mjs` `763a37b8`, `code-shape-lib.mjs` `42a1e521`.

**Run 8 reproduces.** At `af55cb73` the seams JSON, cochange JSON, edge dump and P7min proposal run equal run 8's files key for key apart from the guide-path and commit fields. `cochange-window-commits-af55cb73.txt` and `unmapped-paths-af55cb73.txt` equal run 8's.

**Reproduction at the new HEAD.** `seams-code-90542b2c-*` equals `seams-code-5c63aa26-*` key for key apart from `commit`. `edges-code-90542b2c-*` equals `edges-code-5c63aa26-*` apart from `commit`. `cochange` pairs at `90542b2c` equal those at `5c63aa26`; the `changes` total moves 890 → 891 (LIN-4311). `unmapped-paths-90542b2c.txt` is `unmapped-paths-5c63aa26.txt` plus two paths, `tests/unit/helpers/task-page-body.js` and `tests/unit/helpers/task-page-loop.js` (LIN-4311).

Run from the repo root. `E=docs/reviews/_evidence-2026-11-06-run9`, `G=$E/areas.head-5c63aa26.json`, `H=90542b2c79016d2a1d64f75cb5d3e9037080eae7`, `B=af55cb737ec4e63919bac65558b35498ede3d290`.

## Files

| file | what it is | command |
|---|---|---|
| `areas.head-5c63aa26.json` | byte copy of the one guide used for every run | `git show af55cb73:scripts/code-shape/areas.json` (same blob at every measured commit) |
| `seams-code-{af55cb73,5c63aa26,90542b2c}-guide-head-5c63aa26.json` (`.stderr`) | import graph at each commit | `node scripts/code-shape/seams.mjs . <sha> $G` |
| `cochange-code-{af55cb73,5c63aa26,90542b2c}-guide-head-5c63aa26-days60.json` (`.stderr`) | change coupling, 60 days | `node scripts/code-shape/cochange.mjs . <sha> --areas $G --days 60` |
| `cochange-window-commits-{af55cb73,5c63aa26,90542b2c}.txt` | the first-parent commits in each 60-day window (891 at `90542b2c`) | `git log <sha> -s --first-parent --format=%H --since=<windowStart> --until=<windowEnd>` |
| `edge-dump.mjs` | byte copy of run 8's file-level edge dumper | `node $E/edge-dump.mjs . <sha> $G` |
| `edges-code-{af55cb73,5c63aa26,90542b2c}-guide-head-5c63aa26.json` | every file-level import edge with its areas; the `edgeList` diff is the complete import change (1 added, 0 removed, `af55cb73` → `90542b2c`) | `edge-dump.mjs` at each commit |
| `unmapped-paths.mjs`, `unmapped-paths-{af55cb73,5c63aa26,90542b2c}.txt` | byte copy of run 8's script and the exact file sets behind `unmappedFiles` (5746, 6218, 6220) | `node $E/unmapped-paths.mjs . <sha> $G` |
| `compare-run9.mjs` → `compare-run9.md` | the run 8 → run 9 comparison, built only from the JSON above, at `90542b2c` (run 8's `compare-run8.mjs` with SHAs and labels changed) | `node $E/compare-run9.mjs . $E > $E/compare-run9.md` |
| `supplementary-figures.py` → `supplementary-figures.txt` | sections S0–S19 at `90542b2c` (run 8's definitions; S16 adds the window's hubs `periodicals.js`, `dispatch-entrance.js`, `proxy-scopes.js`, `dispatch-validation.js`, `proxy-instructions.js`, `routes/proxy-dispatch.js`, `stage-writes.js`). S13 reads the Simple Dispatcher clone, which must be fetched first. | `SD_DIR=../simple-dispatcher python3 -I $E/supplementary-figures.py . > $E/supplementary-figures.txt` |
| `areas.proposal-P7min-stage-writes.json`, `seams-code-{af55cb73,5c63aa26,90542b2c}-guide-proposal-P7min-stage-writes.json` (`.stderr`) | run 8's P7min proposal (`lib/stage-writes.js` placed in LLM & prompts), measured at each commit | `python3 -I $E/guide-experiments-run9.py write`; `node scripts/code-shape/seams.mjs . <sha> $E/areas.proposal-P7min-stage-writes.json` |
| `guide-experiments-run9.py` → `guide-experiments-run9.txt` | the P7min summary at each commit (`summary` mode) | `python3 -I $E/guide-experiments-run9.py summary` |
| `RESEARCH-NOTES.md` | the research stage's notes (measured at `5c63aa26`); the report supersedes its prose, and its corrections are listed in the report's §12 | — |

The `seams` stderr files are empty; the `cochange` ones are one line.
