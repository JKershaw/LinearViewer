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
