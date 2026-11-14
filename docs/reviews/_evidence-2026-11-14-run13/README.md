# Evidence: Seams & Tangles run 13 (LIN-4482, 2026-11-14)

Evidence for `docs/reviews/seams-tangles-review-2026-11-14-run13.md`. This run is review-only: nothing in this folder edits code, config, the guide or any tool. Every file here is one of three things: a tool output, a script kept in this folder, or a read of committed objects. No source is copied.

**Measured commits.**
- Run 13 head: `fb358dbda7f26ab44b3f58acb15886b21ac20950` (origin/main, read 14 Nov 2026; the mint commit).
- Baseline, run 12's measured commit: `e2d4659c4bf07ed266735f718e85232e5f2a6458`.
- simple-dispatcher: head `7d5fe7d9473232152365e6837ececcd6f2876987` and baseline `af9b496d57f042972b912a30eb8c4d1164bbab77` (run 12's head).

**Registries.**
- `areas.head-registry.json`: `docs/areas/areas.json` at the head. Every head and baseline measurement uses this one registry.
- `areas.run12-registry-e2d4659c4.json`: the same file at the baseline. It is byte-equal to run 12's `areas.head-registry.json` and is used only for the guide-only check.
- `sd-areas-7d5fe7d.json`, `sd-areas-af9b496.json`: simple-dispatcher's registry at its two commits. The two are identical.
- `areas.exp-*.json`: labelled experimental registries, written by `make-experiments.py` (described below). None is applied.

**Tools.**
- `scripts/code-shape/seams.mjs` and `cochange.mjs` as committed at the head. `git diff --name-status e2d4659c4 fb358dbda -- scripts/code-shape` is empty.
- `edge-dump.mjs` is run 10's, read from `docs/reviews/_evidence-2026-11-08-run10/`.
- `require-graph.mjs` is run 11's scratch CommonJS reader, copied unchanged from run 12's folder.
- `acorn` was installed with `npm ci --ignore-scripts`.

**Commands.** Run from the LinearViewer repo root, with:
- `H=fb358dbda7f26ab44b3f58acb15886b21ac20950`
- `B=e2d4659c4bf07ed266735f718e85232e5f2a6458`
- `R=docs/reviews/_evidence-2026-11-14-run13`
- `G=$R/areas.head-registry.json`
- `G12=$R/areas.run12-registry-e2d4659c4.json`
- `SD=<simple-dispatcher clone>`

| file | what it is | command |
|---|---|---|
| `seams-code-$H-guide-head.json` | head, HEAD registry | `node scripts/code-shape/seams.mjs . $H $G` |
| `seams-code-$B-guide-head.json` | baseline, HEAD registry | `node scripts/code-shape/seams.mjs . $B $G` |
| `seams-code-$B-guide-run12.json` | baseline, its own registry. Equal to run 12's published head file in links, knots, areas and scope, so the HEAD tools reproduce run 12 | `node scripts/code-shape/seams.mjs . $B $G12` |
| `edges-code-<sha>-guide-<head\|run12>.json` | file-level edge dumps (the cross-area total equals `seams.mjs`'s link total each time) | `node docs/reviews/_evidence-2026-11-08-run10/edge-dump.mjs . <sha> <registry>` |
| `edge-diff-B-to-H.txt` | the complete file-level edge difference, `+` added and `-` removed, with areas | written by `supplementary-figures-run13.py` |
| `cochange-code-$H-guide-head-days60.json`, `cochange-code-$B-guide-head-days60.json` | co-change, 60 days, HEAD registry | `node scripts/code-shape/cochange.mjs . <sha> --areas $G --days 60` |
| `cochange-code-$B-guide-run12-days60.json` | baseline under run 12's registry: 914 / 399 / 76 / 8855, as published | `... cochange.mjs . $B --areas $G12 --days 60` |
| `cochange-window-commits-H-only.txt` | the 32 commits that entered the 60-day window | written by `supplementary-figures-run13.py` |
| `contract-sha.txt` | sha256 of `lib/runner-kit/contract.json` at both LinearViewer commits, and of simple-dispatcher's `test/fixtures/runner-contract.json` at both of its commits (`602ab014…` at the baselines, `871ca615…` at the heads) | `git show "<sha>:<path>" \| shasum -a 256` |
| `contract-fold-and-rows.txt` | the eight fold-corpus files byte-compared across the repos (all the same); the contract's 86 rows by area; the four no-halt follow-up rows | shell and `python3`, from the working trees at the heads |
| `require-graph-sd-7d5fe7d.json`, `require-graph-sd-af9b496.json` | scratch CommonJS reader on simple-dispatcher: 52 files, 157 file edges, 20 directed links, 6 pairs; identical at both commits | `node $R/require-graph.mjs $SD <sha> $R/sd-areas-<sha7>.json` |
| `cochange-sd-*-guide-sd-days60.json` | simple-dispatcher co-change, 60 days: 100/46/15 → 102/46/15 | `node scripts/code-shape/cochange.mjs $SD <sha> --areas $R/sd-areas-<sha7>.json --days 60` |
| `landing-agent-note-repro.mjs` → `.txt` | run 12's reproduction re-run at HEAD. One import moved (`landingPrUrls` from `lib/run-trail.js`, LIN-4458). The agent note and the plain comment now agree | `node $R/landing-agent-note-repro.mjs` |
| `make-experiments.py` → `areas.exp-{E..J}-*.json`; `seams-code-$H-exp-*.json` | labelled registry experiments, measured at the head | `python3 -I $R/make-experiments.py $R`, then `node scripts/code-shape/seams.mjs . $H $R/areas.exp-<x>.json` |
| `experiments-summary.py` → `experiments-run13.txt` | each experiment's pair and link moves against the head | `python3 -I $R/experiments-summary.py $R > $R/experiments-run13.txt` |
| `f1-edge-kinds.py` → `f1-edge-kinds.txt` | F1's edges by target, and how many go into strict leaves (files that import nothing) | `python3 -I $R/f1-edge-kinds.py $R > $R/f1-edge-kinds.txt` |
| `supplementary-figures-run13.py` → `.txt` | the figures the report quotes: scope (S1), guide-only (S2), pairs (S3), the edge diff by direction (S4), hubs (S5), the catch-all and new files (S6), direction checks (S7), scripts outside the scope (S8), co-change (S9), window reconciliation (S10), F6 and carried measures (S11), the per-area rollup (S12) and simple-dispatcher (S13) | `SD_DIR=$SD python3 -I $R/supplementary-figures-run13.py . > $R/supplementary-figures-run13.txt` |

An empty `.stderr` file means that tool wrote nothing to stderr.

**Could-not-read counts (reported in §0 of the report).**
- LinearViewer seams, both commits: parse failures 0, unresolved relative imports 4 (F8), non-literal dynamic imports 0, unmapped source files 0. 577 files are in scope at the head and 566 at the baseline.
- Co-change, both commits: `shallow` false. `unmappedFiles` is 9015 at the head and 8855 at the baseline. These are docs and evidence, which a code-only registry leaves unmapped by design.
- simple-dispatcher: `seams.mjs` reads 0 of its 52 CommonJS files. The scratch reader reads all 52.
- Scripts outside the import tool's scope: 54 non-test `scripts/` files import `lib/`, and 4 of them are registered. The registered Reports scripts make 5 `lib/` imports. `scripts/gen-llms-catalogue.mjs` (new, no area) imports `lib/prompts/stage-catalogue.js` (S8).

**Experiments** (labelled, not applied; HEAD registry with the named files moved; measured at the head).
- **E**: `lib/stage-writes.js` → Agent API. 13 pairs. LLM ⇄ Other closes; Agent API ⇄ Other goes 6/1 → 1/1; Runs → Agent API 10 → 12; LLM → Agent API 4 → 5.
- **F**: `lib/stage-writes.js` → LLM. 13 pairs. LLM ⇄ Other closes; Agent API ⇄ Other goes to 1/1; Agent API → LLM 48 → 53; Runs → LLM 61 → 63.
- **G**: `lib/should-mock-ai.js` → Platform. 14 pairs, unchanged. Web → LLM 92 → 80, Runs → LLM 61 → 58, Agent API → LLM 48 → 47, Wiring → LLM 23 → 22.
- **H**: `lib/cost-format.js` and `lib/time-words.js` → Platform. 13 pairs: the guide-opened Pages ⇄ LLM closes. This reverses the LIN-4471 owner pin.
- **I**: `lib/as-asked-seal.js` → LLM, run 10's P10a re-measured. 13 pairs: Agent API ⇄ Other closes; LLM → Agent API 4 → 5; Runs → LLM 61 → 62.
- **J**: I and E together. 12 pairs: both catch-all pairs close.

**Not in this folder, on purpose.** No copies of run 12's files and no copies of source. The note verifier's and the adversarial reader's transcripts are not here. The adversarial reader's answer is copied into the report's `## Adversarial Second-Read` section.
