# Evidence: Drift & Coherence review, 2026-11-05 run 3 (LIN-4250)

The report is `docs/reviews/drift-coherence-review-2026-11-05.md`. Window: LinearViewer `d7ceb373…` → `2eb73ae07fb7297fc0fa057a6198aa8cbe901558`, simple-dispatcher `d8d186c…` → `07c88f7a338b3e19a01070775e1f4d4cfc91f040`.

**Folder name.** The ticket named `_evidence-2026-11-05/`. Seams & Tangles run 7 (LIN-4249) merged its own evidence there first, so this review uses the `-drift` suffix. No file is shared between the two folders.

Every tool was run from the LinearViewer repo root against committed git objects. Set `E=docs/reviews/_evidence-2026-11-05-drift`.

| file | what it is | how it was made |
|---|---|---|
| `areas-2eb73ae0.json` | the one area guide for every census run (sha256 `e3194f52…`, blob `642e9405`) | `git show "2eb73ae0…:scripts/code-shape/areas.json"` |
| `census-W-code-2eb73ae0-vs-d7ceb373-guide-2eb73ae0.json`, `census-W.stderr` | the reading: 566 / 105 / 309 / 1 / 0 | `node scripts/code-shape/census-review.mjs . 2eb73ae0… d7ceb373… --areas $E/areas-2eb73ae0.json --include '^(server\.js$\|(lib\|routes\|public)/.*\.[cm]?js$)'` |
| `census-R-code-d7ceb373-vs-5334c81a-guide-2eb73ae0.json`, `census-R.stderr` | reproduction of 11-04b's W1 (JSON equal apart from the guide path) | the same command with `d7ceb373… 5334c81a…` |
| `census-compare.py`, `census-compare.txt` | the W statuses, the `mustRule` join (detector, decision, file set) and the groups that moved | `python3 $E/census-compare.py` |
| `import-walker.mjs` | the import walker, copied unchanged from `_evidence-2026-11-04-run2/` | — |
| `import-graph-d7ceb373.json`, `import-graph-2eb73ae0.json`, `import-walker-*.stderr`, `import-graph-diff.txt` | graph at both SHAs and their diff | `node $E/import-walker.mjs . <sha>` |
| `res-status-count.txt` | `res.status(` counts at both SHAs | `git grep -c` |
| `stale-ground.txt` | window logs, diffstats, and the 0-line-diff paths (guide, runner kit, runner prompt) | `git log` / `git diff --stat` in both repos |
| `ledger-carry-11-04b.tsv` | the 124 rows of 11-04b's compact trend ledger (row, stable name, severity, 11-04b delta); rows 25 and 30 parsed by hand | parsed from the 11-04b report |
| `ledger-touch-map.txt` | the carried rows whose ledger text names a file the window touched (84) | name match against the window's file list |
| `rulings-carry.py`, `rulings-11-05.tsv` | the 105 `mustRule` rulings (carried, joined, hunk-flagged) plus the departed G0217, re-ruled | `python3 $E/rulings-carry.py` |
| `ledger-11-05.tsv` | this edition's 129-row ledger | `build-report-tables.py` |
| `build-report-tables.py` | builds the report's ruling table, table-group list and ledger from the files above | `python3 $E/build-report-tables.py` |
| `ticket-states-beat1.txt` | per-ticket state, comments since the 11-04b close | `GET /api/proxy/issues/<id>` |
| `linear-search-beat2.txt`, `linear-search-beat3.txt` | every Linear search behind the Follow-ups section | `GET /api/proxy/search?q=` |
| `notes-beat1.md`, `notes-beat2.md` | working notes. Where they differ from the report, the report is the corrected reading | — |
