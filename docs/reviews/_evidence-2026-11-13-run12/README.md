# Evidence: Seams & Tangles run 12 (LIN-4444, 2026-11-13)

Evidence for `docs/reviews/seams-tangles-review-2026-11-13-run12.md`. Review-only: nothing here edits code, config, the guide or any tool. Every file is a tool output, a script in this folder, or a read of committed objects; no copies of source.

**Measured commits.**
- Run 12 head: `e2d4659c4bf07ed266735f718e85232e5f2a6458` (origin/main, read 13 Nov 2026).
- Run 11's measured commit (the baseline): `b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754`.
- simple-dispatcher: run 11's head `5d8489e7fd8434f0e69af7df11a3746790abbe64` (baseline) and head `af9b496d57f042972b912a30eb8c4d1164bbab77` (origin/main, read 13 Nov).

**Registries.**
- `areas.head-registry.json`: LinearViewer's `docs/areas/areas.json` at the head. The one registry for every head and baseline measurement (both commits).
- `areas.run11-registry-b315e0e8f.json`: the same file at the baseline. Used only for the guide-only check.
- `sd-areas-5d8489e.json`, `sd-areas-af9b496.json`: simple-dispatcher's `docs/areas/areas.json` at its two commits (identical across the window).
- `areas.exp-A-*`, `areas.exp-B-*`, `areas.exp-C-*`, `areas.exp-D-*`: labelled experimental registries (below). Not applied.

**Tools.** `scripts/code-shape/seams.mjs` and `cochange.mjs` as committed at the head. `git diff --name-status b315e0e8f e2d4659c4 -- scripts/code-shape` lists one file, `scripts/code-shape/wrappers.test.mjs` (a test, not a tool); the tools themselves are unchanged. `edge-dump.mjs` is run 10's, read from `_evidence-2026-11-08-run10/`. `require-graph.mjs` is run 11's scratch CommonJS reader, copied unchanged. `make-experiments.py` and `supplementary-figures-run12.py` are this run's scripts. `acorn` was installed with `npm ci --ignore-scripts` in the measuring worktree.

**Commands.** Run from the LinearViewer repo root. `H=e2d4659c4bf07ed266735f718e85232e5f2a6458`, `B=b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754`, `R=docs/reviews/_evidence-2026-11-13-run12`, `G=$R/areas.head-registry.json`, `G11=$R/areas.run11-registry-b315e0e8f.json`.

| file | what it is | command |
|---|---|---|
| `seams-code-$H-guide-head.json` (`.stderr`) | head, HEAD registry | `node scripts/code-shape/seams.mjs . $H $G` |
| `seams-code-$B-guide-head.json` | baseline, HEAD registry | `node scripts/code-shape/seams.mjs . $B $G` |
| `seams-code-$B-guide-run11.json` | baseline, its own (run 11) registry; equal to the line above in links, knots and areas (only `areaMapSource` differs) | `node scripts/code-shape/seams.mjs . $B $G11` |
| `cochange-code-$H-guide-head-days60.json` | co-change, 60 days, HEAD registry | `node scripts/code-shape/cochange.mjs . $H --areas $G --days 60` |
| `cochange-code-$B-guide-head-days60.json` | baseline, HEAD registry, same 60 days | `... cochange.mjs . $B --areas $G --days 60` |
| `cochange-code-$B-guide-run11-days60.json` | baseline under run 11's registry (reproduces run 11's 942 / 418 / 76 / 8061); the guide-only shift is the difference from the line above | `... cochange.mjs . $B --areas $G11 --days 60` |
| `edges-code-$H-guide-head.json`, `edges-code-$B-guide-head.json` (`.stderr`) | file-level edge dumps, HEAD registry | `node docs/reviews/_evidence-2026-11-08-run10/edge-dump.mjs . <sha> $G` |
| `edge-diff-B-to-H.txt` | the complete file-level edge difference, `+` added and `-` removed, with areas | written by `supplementary-figures-run12.py` |
| `cochange-window-commits-b315e0e8f.txt`, `cochange-window-commits-e2d4659c4.txt` | the first-parent commits in each 60-day window (942 and 914) | `git log <sha> --first-parent --format=%H` filtered to the window |
| `prod-files-since-run11.txt` | `git diff --name-status $B $H -- lib routes public server.js` (67 files; 10 added) | `git diff --name-status` |
| `guide-diff-since-run11.patch`, `guide-diff-since-run11.txt` | the guide's own change, `docs/areas/areas.json` (task-cost alias out; task-cost-read, task-timeline, session-roles in; stability-measures pattern in Reports) | `git diff $B $H -- docs/areas/areas.json` |
| `code-shape-changes-since-run11.txt` | `scripts/code-shape` changes in the window (one test file) | `git diff --name-status` |
| `contract-sha.txt` | sha256 of `lib/runner-kit/contract.json` at both LinearViewer commits and of simple-dispatcher's `test/fixtures/runner-contract.json` at both of its commits (all `602ab014…`) | `git show <sha>:<path> \| shasum -a 256` |
| `sd-areas-5d8489e.json`, `sd-areas-af9b496.json` | simple-dispatcher's registry at its two commits (the 5d8489e copy equals run 11's) | `git show <sha>:docs/areas/areas.json` |
| `require-graph-sd-5d8489e.json`, `require-graph-sd-af9b496.json` (`.stderr`) | scratch CommonJS reader on simple-dispatcher: 52 files, 0 unmapped, 0 unresolved, 0 non-literal, 157 file edges, 20 directed area links, 6 reciprocal pairs; identical at both commits | `node require-graph.mjs <sd> <sha> $R/sd-areas-<sha7>.json` |
| `cochange-sd-5d8489e-guide-sd-days60.json`, `cochange-sd-af9b496-guide-sd-days60.json` (`.stderr`) | simple-dispatcher co-change, 60 days: 104/50/15 → 100/46/15 | `node scripts/code-shape/cochange.mjs <sd> <sha> --areas <sd registry> --days 60` |
| `sd-changes-5d8489e-af9b496.txt` | simple-dispatcher's file changes in its window (3 commits: `docs/areas/README.md`, `docs/areas/loop-and-routing.md`, `test/area-notes.test.js`) | `git diff --name-status` |
| `seams-code-$H-exp-*.json` (`.stderr`), `seams-code-$H-exp-D-*.json` | the experiments, measured at the head | `node scripts/code-shape/seams.mjs . $H $R/areas.exp-<x>.json` |
| `supplementary-figures-run12.py` → `supplementary-figures-run12.txt` | the figures the report quotes (scope, pairs, guide-only, edge diff, hubs, catch-all, direction checks, Reports scripts, co-change and its window reconciliation, carried measures, simple-dispatcher) | `SD_DIR=<sd clone> python3 -I $R/supplementary-figures-run12.py . > $R/supplementary-figures-run12.txt` |

**Could-not-read counts, reported in the report (§0).**
- LinearViewer seams, both commits: parse failures 0; unresolved relative imports 4 (the same four as run 11, F8); non-literal dynamic imports 0; unmapped source files 0. In scope: 566 files at the head, 556 at the baseline.
- Co-change, both commits: `shallow` false; `unmappedFiles` 8855 (head) and 8061 (baseline). The registry is code-only, so docs and evidence are unmapped by design.
- simple-dispatcher: `seams.mjs` reads 0 of its 52 root-level CommonJS files (its scope and `import` reader cannot see `require`). The scratch reader above reads all 52.
- Scripts outside the import tool's scope: the seven registered Reports scripts (`scripts/code-shape/retention*.mjs`, `scripts/stability-measures*.mjs`) are not read by `seams.mjs`. Four of their imports reach into `lib/` and are listed in `supplementary-figures-run12.txt` (S8).

**Experiments (labelled, not applied; the three negative experiments of the ticket, plus one check).** Each is the HEAD registry with the named modules moved. Measured with `seams.mjs` at the head. The pair counts are `a→b / b→a`.
- **A `areas.exp-A-sequence-to-runs.json`**: `lib/recommendation-{look-first,blind-read,live-wait}.js` move from LLM & prompts to Runs & dispatch. LLM ⇄ Runs: **35/59** (head 38/55). Agent API ⇄ LLM 45/4, Providers → LLM 4, LLM → Providers 13. No new pair.
- **B `areas.exp-B-isolate-words.json`**: `lib/prompts/{blind-read,survey,leftover}-words.js` move to a new area "Prompt vocabulary" placed before LLM. LLM ⇄ Runs: **38/49**. Agent API → LLM 44. No new pair.
- **C `areas.exp-C-sequence-area.json`**: a new "Recommendation sequence" area holds the three sequence modules plus `lib/recommendation-{facts,input}.js`, placed before LLM. LLM ⇄ Runs: **29/53**; three new reciprocal pairs (LLM ⇄ Recommendation sequence 6/6, Providers ⇄ Recommendation sequence 3/3, Recommendation sequence ⇄ Runs 9/2); cycle group 10 areas.
- **D `areas.exp-D-live-wait-to-runs.json`** (an extra check, not one of the ticket's three): `lib/recommendation-live-wait.js` alone moves to Runs & dispatch. LLM ⇄ Runs **38/54**; Agent API → Runs 49 (from 48); Agent API → LLM 45 (from 46). Thirteen pairs, one cycle group of nine.

The three ticket experiments reproduce the figures recorded in the ticket's brief (35/59, 38/49, 29/53 with three new reciprocal pairs), which fixes their membership as above. None of them is proposed as the F1 fix (see the report, §3.1 and §7).

**What is not in this folder, on purpose.** No copies of run 11's files, no copies of source, no proposal registries beyond the labelled experiments. The adversarial reader's transcript is not in this folder; its answer is copied into the report's `## Adversarial Second-Read` section.
