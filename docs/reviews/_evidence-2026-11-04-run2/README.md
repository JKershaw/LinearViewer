# Evidence: Drift & Coherence Review, 2026-11-04 run 2 (LIN-4232)

Report: `docs/reviews/drift-coherence-review-2026-11-04-run2.md`.

Window:
- LinearViewer `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e..d7ceb373444f9efbc027656132352d247535aa5e`.
- simple-dispatcher `502901c3e9a36b90eeafd95f23b59f35ef80c195..d8d186c07113d6e61e3489e38f1210d0b0624cad`.

Every tool ran from the LinearViewer root against committed git objects, and both HEADs were unmoved for the whole run.

## Guides (byte copies of `scripts/code-shape/areas.json`, via `git show "${sha}:scripts/code-shape/areas.json"`)

- `areas-d7ceb373.json`: the HEAD guide, **fixed for both census runs**. sha256 `e3194f52a76ed595a93ce3aa11b259dfce84114230f99596784243a7d994159f`, git blob `642e9405`.
- `areas-5334c81a.json`: the 11-04 HEAD guide. sha256 `502d3ff0ea0579ea5139ee82d483fa1da3bb97eee4dfc264d17fb8a2c9d0e195`, git blob `816b2e66`. It is byte-identical to `../_evidence-2026-11-04/areas-5334c81a.json` (Seams run 5).
- The diff between them is LIN-4201's two-line placement: `cost-read|row-usage|lineage-membership` go to "Runs & dispatch", and `workspace-kpis-cache` goes to "Reports & operator tools".

## Census runs (`scripts/code-shape/census-review.mjs`)

```
node scripts/code-shape/census-review.mjs . <commit> <previous> \
  --areas docs/reviews/_evidence-2026-11-04-run2/areas-<guide>.json \
  --include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'
```

- `census-W1-…` is this window under the HEAD guide (the reading). `census-W2-…` is the same window under the old guide.
- `census-R1-…` reproduces 11-04 (its window under its guide). `census-R2-…` is 11-04's window under the HEAD guide.
- Each `.stderr` holds the tool's one-line summary.
- `census-compare.txt` and `census-compare.py` hold the guide-vs-code split and the site-drift comparison. The first site-drift line in `census-compare.txt` joins on (detector, decision) only and reports one false "file set changed" (G0173). Two groups share that decision text. The corrected join, on (detector, decision, files), is appended below it: 74 identical, 32 shifted, 0 changed.

## Import graph

- `import-walker.mjs` is a re-implementation of the 11-03/11-04 scratch walker. It covers static `import` / `export … from` over `server.js`, `lib/` and `routes/`, reads git blobs with the repo's `acorn`, and computes Tarjan SCCs; dynamic `import()` is counted separately. Run it as `node import-walker.mjs <repo> <sha>`. It reproduces `015aa4c6` (486 / 1,993 / 2 / 6+6 / 0 / 53) and `5334c81a` (493 / 2,026 / 2 / 6+6 / 0 / 53) exactly.
- Outputs: `import-graph-5334c81a.json`, `import-graph-d7ceb373.json`, and `import-graph-diff.txt` (SCC members and the edge diff).

## Other files

- `res-status-count.txt`: `res.status(` counts at `015aa4c6`, `5334c81a` and `d7ceb373`. 275 covers routes/ plus server.js; 250 covers routes/ alone.
- `stale-ground.txt`: `git diff --numstat` and `git log` for the files the task names as "no diff in the window", in both repos.
- `linear-search-beat3.txt`: the Linear `/search` phrases and hits used for the duplicate-ticket check (the report's Follow-ups table).
- `linear-search-beat4.txt`: the searches run before minting LIN-4234 (the account-erasure inventory gap found by the adversarial second-read).
- `notes-beat1.md` and `notes-beat2.md`: the grounding and seam-reading notes the report was written from. Where a note and the report differ, the report is the corrected reading.
