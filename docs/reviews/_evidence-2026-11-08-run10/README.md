# Evidence: Seams & Tangles run 10 (LIN-4387, 2026-11-08)

Evidence for `docs/reviews/seams-tangles-review-2026-11-08-run10.md`. Review-only; nothing here edits code, config or the guide.

**Measured commits.**
- Baseline: `90542b2c79016d2a1d64f75cb5d3e9037080eae7` (run 9's measured commit).
- Measured (HEAD): `bad9d719ba01ffea2ba5339c32ea354e67bf5682` (origin/main when the build started, 2026-11-08; #2367, LIN-4358). Files carry `bad9d719ba01…` in their names; the window and unmapped lists are shortened to `bad9d719`.
- Research-stage registry, kept for comparison: `32da8d583…` (`areas.research-registry-32da8d58.json`). Its figures are superseded by the HEAD measurements; see the report §12.

**Guides.**
- `areas.head-registry.json`: the product registry `docs/areas/areas.json` at HEAD (blob `4011e82a`). It is the one registry used for every HEAD and baseline measurement of the window. Checked with `cmp` against the working tree.
- `areas.run9-guide-90542b2c.json`: `scripts/code-shape/areas.json` at the baseline (blob `642e9405`, run 9's guide). Used only for the run-9 reproduction and the guide-only check.
- `areas.proposal-*.json`: five labelled proposal registries derived from the HEAD registry (not applied anywhere). P10a: `as-asked-seal` → LLM & prompts. P7min: `stage-writes` → LLM & prompts. P7min-P10a: both. P10b: `as-asked`, `as-asked-seal`, `size-of-move` → Providers. P10c: a new "Ticket text" area for those three plus `description-edit`.

**Tools.** The HEAD versions of `scripts/code-shape/seams.mjs` and `cochange.mjs`, run from the HEAD worktree. `edge-dump.mjs` and `unmapped-paths.mjs` are byte copies of run 9's scripts (`cmp` equal).

Run from the repo root. `E=docs/reviews/_evidence-2026-11-08-run10`, `H=bad9d719ba01ffea2ba5339c32ea354e67bf5682`, `B=90542b2c79016d2a1d64f75cb5d3e9037080eae7`, `G=$E/areas.head-registry.json`.

## Files

| file | what it is | command |
|---|---|---|
| `areas.head-registry.json` | HEAD registry (the one guide for HEAD and baseline) | `git show $H:docs/areas/areas.json` |
| `areas.run9-guide-90542b2c.json` | run 9's guide (baseline) | `git show $B:scripts/code-shape/areas.json` |
| `areas.research-registry-32da8d58.json` | research-stage registry | `git show 32da8d583:docs/areas/areas.json` |
| `seams-code-$B-guide-run9.json` (`.stderr`) | baseline with run 9's guide: reproduces run 9's seams JSON key for key | `node scripts/code-shape/seams.mjs . $B $E/areas.run9-guide-90542b2c.json` |
| `seams-code-$B-guide-head.json` | baseline with the HEAD registry (the guide-only comparison against the run-9 guide is equal) | `node scripts/code-shape/seams.mjs . $B $G` |
| `seams-code-$H-guide-head.json` | HEAD with the HEAD registry | `node scripts/code-shape/seams.mjs . $H $G` |
| `seams-code-$H-guide-research-registry.json` | HEAD with the research registry: isolates the #2367 registry edit (catalog-rate → LLM) | `node scripts/code-shape/seams.mjs . $H $E/areas.research-registry-32da8d58.json` |
| `seams-code-<sha>-proposal-<P>.json` | the five proposals at both commits | `node scripts/code-shape/seams.mjs . <sha> $E/areas.proposal-<P>.json` |
| `cochange-code-$B-guide-run9-days60.json` | cochange, baseline, run 9's guide; reproduces run 9's cochange (apart from window dates) | `node scripts/code-shape/cochange.mjs . $B --areas $E/areas.run9-guide-90542b2c.json --days 60` |
| `cochange-code-$B-guide-head-days60.json` / `cochange-code-$H-guide-head-days60.json` | cochange at both commits, the HEAD registry for both | `node scripts/code-shape/cochange.mjs . <sha> --areas $G --days 60` |
| `cochange-window-commits-90542b2c.txt` / `cochange-window-commits-bad9d719.txt` | the first-parent commits in each window (891 and 929) | `git log <sha> -s --first-parent --format=%H --since=<windowStart> --until=<windowEnd>` |
| `edge-dump.mjs` (byte copy of run 9's) | every file-level import edge with its areas | `node $E/edge-dump.mjs . <sha> $G` |
| `edges-code-$B-guide-head.json`, `edges-code-$H-guide-head.json` | edge dumps; the `edgeList` diff is the complete import change (+76 / −0) | as above |
| `unmapped-paths.mjs` (byte copy of run 9's), `unmapped-paths-90542b2c.txt`, `unmapped-paths-bad9d719.txt` | the exact file sets behind `unmappedFiles` (6220, 7216) | `node $E/unmapped-paths.mjs . <sha> $G` |

Every `.stderr` file is empty except the cochange ones, which hold the one-line summary.

## What was checked against run 9

- `seams-code-$B-guide-run9.json` equals `docs/reviews/_evidence-2026-11-06-run9/seams-code-90542b2c-guide-head-5c63aa26.json` key for key, apart from `commit` and `areaMapSource`.
- `cochange-code-$B-guide-run9-days60.json` equals run 9's `cochange-code-90542b2c-guide-head-5c63aa26-days60.json` apart from `commit`, `areaMapSource`, and the window dates.
- `seams-code-$B-guide-head.json` equals `seams-code-$B-guide-run9.json` apart from `commit` and `areaMapSource`: the guide-only edit moves nothing at the baseline. The same holds for the cochange pair.

## Not in this folder

- `supplementary-figures.py` (run 9's S0–S19) was **not** re-run: it hard-codes run 9's commits and its S13 needs the Simple Dispatcher clone. The report says which ledger items were carried from run 9 for this reason.
- The run-8 strict F6 method: the report uses a grep count of `window.X =` lines in `public/`, which is 67 at both commits.
