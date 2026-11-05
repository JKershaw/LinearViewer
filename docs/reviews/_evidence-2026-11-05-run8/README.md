# Evidence: Seams & Tangles run 8 (LIN-4298, 2026-11-05)

Evidence for `docs/reviews/seams-tangles-review-2026-11-05-run8.md`. Review-only; nothing here edits code, config or the guide.

**Measured commits.**
- Baseline: `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (run 7's measured commit).
- Measured (HEAD): `af55cb737ec4e63919bac65558b35498ede3d290` (origin/main when measured).

**Guide.** One area guide serves both commits: `areas.head-af55cb73.json`, a byte copy of `scripts/code-shape/areas.json` at `af55cb73` (blob `642e9405`, the same blob at `2eb73ae0`). Checked with `cmp`.

**Tools (unchanged in the window, same blobs at both commits).** `seams.mjs` `34f11434`, `cochange.mjs` `c3a39f37`, `cochange-core.mjs` `763a37b8`, `code-shape-lib.mjs` `42a1e521`. Re-running `seams.mjs` and `cochange.mjs` at both commits reproduced every `seams-code-*` and `cochange-code-*` JSON here byte for byte.

Run from the repo root. `E=docs/reviews/_evidence-2026-11-05-run8`, `G=$E/areas.head-af55cb73.json`.

## Files

| file | what it is | command |
|---|---|---|
| `areas.head-af55cb73.json` | byte copy of the one guide used for every run | `git show af55cb73:scripts/code-shape/areas.json` |
| `seams-code-2eb73ae0-guide-head-af55cb73.json` (`.stderr`) | import graph at the baseline | `node scripts/code-shape/seams.mjs . 2eb73ae0 $G` |
| `seams-code-af55cb73-guide-head-af55cb73.json` (`.stderr`) | import graph at HEAD | `node scripts/code-shape/seams.mjs . af55cb73 $G` |
| `cochange-code-2eb73ae0-guide-head-af55cb73-days60.json` (`.stderr`) | change coupling, 60 days, baseline window | `node scripts/code-shape/cochange.mjs . 2eb73ae0 --areas $G --days 60` |
| `cochange-code-af55cb73-guide-head-af55cb73-days60.json` (`.stderr`) | change coupling, 60 days, HEAD window | `node scripts/code-shape/cochange.mjs . af55cb73 --areas $G --days 60` |
| `cochange-window-commits-{2eb73ae0,af55cb73}.txt` | the commits in each 60-day window (first line is the measured commit) | `git log --first-parent --diff-merges=first-parent --format=%H --since=… --until=…` |
| `edge-dump.mjs` | byte copy of run 7's file-level edge dumper | `node $E/edge-dump.mjs . <sha> $G` |
| `edges-code-2eb73ae0-guide-head-af55cb73.json`, `edges-code-af55cb73-guide-head-af55cb73.json` | every file-level import edge with its areas; their `edgeList` diff is the complete import change (2 added, 0 removed) | `edge-dump.mjs` at each commit |
| `unmapped-paths.mjs`, `unmapped-paths-{2eb73ae0,af55cb73}.txt` | the exact file set behind `unmappedFiles` (5416 and 5746), one path per line. The script uses the tool's own modules and git log call | `node $E/unmapped-paths.mjs . <sha> $G` |
| `compare-run8.mjs` → `compare-run8.md` | the run 7 → run 8 comparison, built only from the JSON above | `node $E/compare-run8.mjs . $E > $E/compare-run8.md` |
| `supplementary-figures.py` → `supplementary-figures.txt` | sections S0–S19: window facts, browser globals, per-kind files, hubs, Survey ledger rows. Reads git objects at pinned SHAs | `SD_DIR=<simple-dispatcher clone> python3 -I $E/supplementary-figures.py . > $E/supplementary-figures.txt` |
| `guide-experiments-run8.py` → `guide-experiments-run8.txt` | labelled guide proposals, not adopted: P7min-stage-writes, P2c-costs-area, P2c+P7min. Writes `areas.proposal-*.json`, which are not byte copies of the committed guide | `python3 -I $E/guide-experiments-run8.py write`, then `seams.mjs` at each SHA with each proposal guide, then `… summary` |
| `seams-code-*-guide-proposal-*.json`, `edges-code-af55cb73-guide-proposal-P2c+P7min.json` | the proposal runs. Re-run on 2026-11-05: byte-identical | as above |
| `RESEARCH-NOTES.md` | the research stage's command notes (kept as written; the report supersedes its prose) | — |

The `.stderr` files are the tools' one-line summaries. The `seams` stderr files are empty; the `cochange` ones are one line.

## Checks made when the report was written

- **Tool reproduction.** Both `seams.mjs` runs and both `cochange.mjs` runs were re-run at the two SHAs with the same guide. Output matched the files here byte for byte. Run 7's own figures were reproduced at `2eb73ae0` in run 7's evidence (`docs/reviews/_evidence-2026-11-05/`).
- **Edge diff.** `edgeList` at `2eb73ae0` has 2053 edges; at `af55cb73`, 2055. The two added edges are `lib/prompt-template-defs.js → lib/stage-writes.js` (LLM → Other features) and `lib/proxy-preamble.js → lib/stage-writes.js` (Agent API → Other features). None removed.
- **Unmapped set.** `unmapped-paths-*.txt`: 331 paths new at HEAD, 1 gone. The new ones are 233 `docs/papers`, 63 `docs/reviews`, 17 `tests/unit`, 12 `docs/plans`, 2 `tests/e2e`, 2 `scripts`, 1 `tests/fixtures`, 1 `experiments`.
- **Browser globals.** Strict `window.X =` assignments in `public/`: 66 at both commits; in `public/common.js`: 51 at both. No such line was added or removed in the window (`git diff -U0 2eb73ae0 af55cb73 -- public`). The loose pattern (`supplementary-figures.txt` §S4) gives 107 at both; it also counts `typeof window.X` reads, so it is not used for trend.
- **Per-kind files.** `git grep -l survey-place` over `lib routes public server.js` at `af55cb73`: 9 files (LLM 4, Runs 3, Agent API 1, browser code 1).
- **`lib/stage-writes.js`.** Imports nothing. Imported by `lib/prompt-template-defs.js:42` and `lib/proxy-preamble.js:14`.

## Edits made to the copied research files

- Run-7 labels in `compare-run8.mjs`, `supplementary-figures.py` and their outputs were corrected to run 8. The baseline is named as run 7's measured commit. Both outputs were regenerated and differ only in those labels.
- `guide-experiments.py` (a run-7 copy with no run-8 output) was removed.
- `unmapped-paths.mjs` and its two outputs were added.

No file under `docs/reviews/_evidence-2026-11-05/` (run 7) or `_evidence-2026-11-05-drift/` was touched.
