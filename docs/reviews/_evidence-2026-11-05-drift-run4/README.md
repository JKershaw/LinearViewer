# Evidence: Drift & Coherence review, 2026-11-05 run 4 (LIN-4299)

The report is `docs/reviews/drift-coherence-review-2026-11-05-run4.md`.
Window: LinearViewer `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` .. `af55cb737ec4e63919bac65558b35498ede3d290` (29 commits; 10 touch production). SD: `07c88f7a338b3e19a01070775e1f4d4cfc91f040` = origin/main, 0 commits in the window.

Run every tool from the LinearViewer repo root against committed git objects. `E=docs/reviews/_evidence-2026-11-05-drift-run4`.

| file | what it is | how it was made |
|---|---|---|
| `areas-2eb73ae0.json` | the one area guide for every census run (sha256 `e3194f52…`, blob `642e9405`; identical at HEAD) | `git show 2eb73ae0…:scripts/code-shape/areas.json` |
| `census-R-code-d7ceb373-vs-5334c81a-guide-2eb73ae0.json`, `census-R.stderr` | reproduction of 11-05's reproduction of 11-04b's W1 (equal to 11-05's JSON apart from the guide path) | `node scripts/code-shape/census-review.mjs . d7ceb373… 5334c81a… --areas $E/areas-2eb73ae0.json --include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'` |
| `census-W-code-2eb73ae0-vs-d7ceb373-guide-2eb73ae0.json`, `census-W.stderr` | the 11-05 reading, reproduced (566 / 105 / 309 / 1 / 0) | the same with `2eb73ae0… d7ceb373…` |
| `census-HEAD-code-af55cb73-vs-2eb73ae0-guide-2eb73ae0.json`, `census-HEAD.stderr` | the run-4 reading (566 / 105 / 309 / 1 / 0) | the same with `af55cb73… 2eb73ae0…` |
| `census-compare.py`, `census-compare-run4.txt` | W statuses, the mustRule join and the groups that moved | `python3 -I $E/census-compare.py $E/census-HEAD-…json docs/reviews/_evidence-2026-11-05-drift/census-W-…json` |
| `census-table-groups-run4.tsv` | the 309 table groups with their status against 2eb73ae0 | from the HEAD census JSON |
| `import-walker.mjs` | the import walker, copied unchanged from `_evidence-2026-11-05-drift/` | `node $E/import-walker.mjs . <sha>` |
| `import-graph-2eb73ae0.json`, `import-graph-af55cb73.json`, `import-walker-*.stderr` | the graph at both ends (499/2,051/2 and 500/2,053/2; SCCs 6+6 same members; upward 0/0; route→route 53). The edge diff is two edges into `lib/stage-writes.js` | as above |
| `res-status-count.txt` | `res.status(` counts at both ends (275, 275) | `git grep -c` |
| `window-files-all.txt`, `touched-production-files.txt` | the window's touched files (all 416; production 24) | `git diff --name-only 2eb73ae0 origin/main [-- lib routes public server.js]` |
| `ledger-11-05.tsv` | 11-05's 130-row trend ledger (copied from `_evidence-2026-11-05-drift/`) | — |
| `ledger-touch-map-run4.txt` | the ledger rows whose text names a window-touched production file (18; basename match; row 121 added by hand) | name match against `touched-production-files.txt` |
| `rulings-11-05.tsv`, `rulings-carry-run4.py`, `rulings-run4.tsv` | the 105 mustRule rulings joined to this run's groups; the join and the hunk check against `git diff -U0 2eb73ae0 origin/main` (none flagged; 34 real, 29 borderline, 42 noise) | `python3 -I $E/rulings-carry-run4.py <HEAD census JSON> <11-05 W JSON> docs/reviews/drift-coherence-review-2026-11-05.md $E/rulings-run4.tsv` |
| `ruling-table-run4.md` | the generated 105-row ruling table, spliced into the report | from `rulings-run4.tsv` |
| `build-ledger-run4.py`, `ledger-run4.tsv` | the 135-row run-4 ledger: the 130 carried rows with deltas, plus rows 131–135 | `python3 $E/build-ledger-run4.py` |
| `notes-beat1-verdicts-from-code.md` | the "Better or worse, by area" verdicts, written from the code **before** the Survey place ledger was read | — |

Not in this folder, by design: the Survey place ledger (`origin/claude/cool-rubin-6acj5j`, read-only; the agreement lines are in the report), and the second-read transcript (in the report, Adversarial Second-Read).
