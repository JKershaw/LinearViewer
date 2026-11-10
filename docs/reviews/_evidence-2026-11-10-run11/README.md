# Evidence: Seams & Tangles run 11 (LIN-4402, 2026-11-10)

Evidence for `docs/reviews/seams-tangles-review-2026-11-10-run11.md`. Review-only: nothing here edits code, config, the guide or any tool. Every file is a tool output or a read of committed objects; no copies of source.

**Measured commits.**
- Baseline (run 10's measured commit): `bad9d719ba01ffea2ba5339c32ea354e67bf5682`.
- Window start: `aec9e16be4afa9793a34cefe6a49a8eecd90736c` (last main commit before 7 Nov 00:00 UTC).
- Head: `b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754` (origin/main at the mint and at the PR's base).
- simple-dispatcher: window start `07c88f7a338b3e19a01070775e1f4d4cfc91f040`, head `5d8489e7fd8434f0e69af7df11a3746790abbe64`. Read only; no prior run.

**Registries.**
- `areas.head-registry.json`: LinearViewer's `docs/areas/areas.json` at HEAD. The one registry for every HEAD and baseline measurement.
- `areas.run10-registry-bad9d719.json`: the same file at `bad9d719` (identical, `cmp`-equal to the HEAD registry).
- `areas.window-start-guide-aec9e16b.json`: `scripts/code-shape/areas.json` at the window start (the guide before LIN-4371 moved it). Used for the guide-only check.
- `sd-areas-5d8489e.json`: simple-dispatcher's `docs/areas/areas.json` at `5d8489e`.

**Tools.** `scripts/code-shape/seams.mjs` and `cochange.mjs` as at HEAD (unchanged since `bad9d719`: `git diff --name-only bad9d719 b315e0e8f -- scripts/code-shape` is empty). `edges-code-*.json` is the edge dump from run 10's `edge-dump.mjs`, read from `_evidence-2026-11-08-run10/`.

**Commands.** Run from the LinearViewer repo root. `H=b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754`, `B=bad9d719ba01ffea2ba5339c32ea354e67bf5682`, `W=aec9e16be4afa9793a34cefe6a49a8eecd90736c`, `G=docs/reviews/_evidence-2026-11-10-run11/areas.head-registry.json`.

| file | what it is | command |
|---|---|---|
| `seams-code-$H-guide-head.json` (`.stderr`) | head, HEAD registry | `node scripts/code-shape/seams.mjs . $H $G` |
| `seams-code-$B-guide-head.json` | baseline, HEAD registry; matches run 10's `seams-code-$B-guide-head.json` key for key except `commit`/`areaMapSource` | `node scripts/code-shape/seams.mjs . $B $G` |
| `seams-code-$W-guide-head.json` | window start, HEAD registry | `node scripts/code-shape/seams.mjs . $W $G` |
| `seams-code-$W-guide-window-start.json` | window start with its own guide; differs from the HEAD-registry run only in `areaMapSource` (the guide edit alone moved nothing) | `node scripts/code-shape/seams.mjs . $W $E/areas.window-start-guide-aec9e16b.json` |
| `cochange-code-$B-guide-head-days60.json`, `cochange-code-$H-guide-head-days60.json` | co-change, 60 days, HEAD registry; the baseline file matches run 10's file apart from the window dates | `node scripts/code-shape/cochange.mjs . <sha> --areas $G --days 60` |
| `cochange-window-commits-bad9d719.txt`, `cochange-window-commits-b315e0e8f.txt` | the first-parent commits in each 60-day window (929 and 942) | `git log <sha> -s --first-parent --format=%H --since=<windowStart> --until=<windowEnd>` |
| `edges-code-$B-guide-head.json`, `edges-code-$H-guide-head.json` | file-level edge dumps; the `edgeList` diff is the complete import change between the two (12 added, 9 removed) | `node <run10 evidence>/edge-dump.mjs . <sha> $G` |
| `prod-files-since-run10.txt` | `git diff --name-status bad9d719 b315e0e8f -- lib routes public server.js` (38 files; 2 added) | `git diff --name-status ...` |
| `supplementary-figures.py` (adapted from run 10's) and `supplementary-figures.txt` | carried rows (F5, F6, F7, N7, N8, N9, N11, hubs, Runs→Pages, F1 cost-family edges, workspace- prefix, coupling overlap, simple-dispatcher format) at both commits, HEAD registry | `SD_DIR=<simple-dispatcher clone> python3 -I supplementary-figures.py .` |
| `contract-sha.txt` | sha256 of `lib/runner-kit/contract.json` and simple-dispatcher's `test/fixtures/runner-contract.json` (identical) | `shasum -a 256` |
| `sd-areas-5d8489e.json` | simple-dispatcher's registry at `5d8489e` | `git show 5d8489e:docs/areas/areas.json` |
| `seams-sd-5d8489e…-guide-sd.json` (`.stderr`) | simple-dispatcher through the standard tool: 0 files in scope (the tool reads `import` in `server.js|lib|routes|public`; simple-dispatcher is root-level CommonJS). Recorded as a could-not-read count. | `node scripts/code-shape/seams.mjs <sd> 5d8489e $E/sd-areas-5d8489e.json` |
| `cochange-sd-5d8489e…-guide-sd-days60.json` (`.stderr`) | simple-dispatcher co-change, 60 days, its registry: 104 changes, 50 multi-area, 15 pairs, 243 unmapped, not shallow | `node scripts/code-shape/cochange.mjs <sd> 5d8489e --areas $E/sd-areas-5d8489e.json --days 60` |
| `require-graph.mjs` | the scratch CommonJS reader: literal `require('./x')` edges over root-level `*.js`, read from git objects only; counts non-literal `require(` as could-not-read; maps both ends through simple-dispatcher's registry (first match wins) | `node require-graph.mjs <sd> 5d8489e $E/sd-areas-5d8489e.json` |
| `require-graph-sd-5d8489e.json` | its output: 52 files, 0 unmapped, 0 unresolved, 0 non-literal; 157 file edges; 107 cross-area; 20 directed area links; 6 reciprocal pairs; crossings listed | as above |

**Could-not-read counts, reported in the report (§0 and §6).**
- LinearViewer seams (HEAD, all three commits): parse failures 0; unresolved relative imports 4 (the same four as run 10, F8); non-literal dynamic imports 0; unmapped source files 0.
- simple-dispatcher: `seams.mjs` 0 of 52 root-level files in scope (the tool's scope and its `import` reader cannot see CommonJS `require`). The scratch reader above reads all 52.
- Cochange: `unmappedFiles` 7216 → 8061 in LinearViewer (docs and evidence volume; the registry is code-only); 243 in simple-dispatcher. `shallow` false in both.

**What is not in this folder, on purpose.** No copies of run 10's files, no copies of source, no proposal registries (run 10 had five; this run proposes guide edits in prose only, §7). The adversarial reader's transcript is not in this folder; its answer is copied into the report's `## Adversarial Second-Read` section.
