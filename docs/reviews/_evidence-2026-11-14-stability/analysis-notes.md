# Stability Review run 7 (2026-11-14): analysis notes

Pins: LV `163efc069` (base, run 6's head) → `fb358dbda` (head, `origin/main` at run time). SD `af9b496` → `7d5fe7d`.
Repo checkouts: LinearViewer on `feat/lin-4483-stability-review-run-7` (from `origin/main`); simple-dispatcher beside it, at `origin/main`.

These are the one-off reads behind the report. The measured rows are in `reading.json` and `table.txt`, written by the committed
tool (`scripts/stability-measures.mjs`). Everything below is a git, `gh` or proxy read, recorded here so it can be re-run.
Nothing here is a new measuring script. Per-landing sums are over first-parent landings, `git log --first-parent -m --numstat --no-renames`,
restricted to `server.js lib routes public` (the tool's scope is the `.js`/`.cjs`/`.mjs` subset of that path set, applied per file).
Whitespace-ignored figures use `-w` on the same command.

## 1. Tool reproduction (per-landing sums, plain)

| source | added | deleted |
|---|---|---|
| tool `churn` row (`reading.json`) | 8,237 | 6,726 |
| this file's per-landing sum of the same scope (`landings-churn.tsv`) | 8,237 | 6,726 |

## 2. Whitespace-only share (same scope, per landing)

| slice | added | deleted | deleted per added |
|---|---|---|---|
| plain | 8,237 | 6,726 | 0.82 |
| `-w` | 4,448 | 2,937 | 0.66 |
| whitespace-only (plain − `-w`) | 3,789 | 3,789 | — |

Whitespace-only lines are 46% of added and 56% of deleted lines in the tool's scope. They are almost entirely re-indentation in
`public/flight-companion.js` (+1,974 / −1,964 plain, +45 / −35 with `-w`), `public/task-page.js` (+900 / −913 vs +92 / −105),
and `public/workspace-kpis.js`.

Endpoint diffs differ from the per-landing sums, as expected (intermediate churn inside the window): `git diff --shortstat 163efc069 origin/main -- server.js lib routes public`
gives 8,151 / 6,254 plain and 4,601 / 2,704 with `-w`, but that pathspec includes non-`.js` files under those directories.

## 3. Sub-windows split at North star v4 (`4b5001ddf`, 13 Nov 12:01Z)

Git-only readings with `HARBOUR_LOCAL_BASE` unset (`subwindow-pre-v4.*`, `subwindow-post-v4.*`):

| window | landings | net prod lines | comment-only share | Waiting total | Waiting harbour | Waiting runner |
|---|---|---|---|---|---|---|
| `163efc069..4b5001ddf` | 4 | +0 (one line) | 39.74% → 39.74% | 110 → 120 (+10) | 98 → 107 (+9) | 12 → 13 (+1) |
| `4b5001ddf..fb358dbda` | 29 | +1,511 | 39.74% → 39.86% | 120 → 120 (0) | 107 → 108 (+1) | 13 → 12 (−1) |

Production churn is almost entirely post-v4: the four pre-v4 landings are two reviews, the stability run 6 report and the north star,
with one production line changed.

## 4. Tidy programmes (parent of each landing's ticket, from the tracker)

Parents read with `GET /issues/{id}`: LIN-4447 (Done, 10 children + LIN-4475 via piece 8), LIN-4448 (In Progress, 7 of 7 children Done),
LIN-4463 (In Progress; LIN-4471, LIN-4472 Done), LIN-4446 (Done), LIN-4445 (In Progress; LIN-4452 In Progress). Per-programme
aggregates (production scope, plain / `-w`):

| programme | landings | docs-only landings | prod added | prod deleted | net | deleted per added | `-w` net |
|---|---|---|---|---|---|---|---|
| LIN-4447 Runs & dispatch | 12 | 4 | 1,638 | 1,384 | +254 | 0.84 | +254 |
| LIN-4448 LLM & prompts | 7 | — | 2,390 | 1,890 | +500 | 0.79 | +500 (ws del/add 0.68) |
| LIN-4463 front-end modules | 5 | — | 3,070 | 3,056 | +14 | 1.00 | +14 (ws 216 / 202) |
| LIN-4446 shared formatter | 1 | — | 195 | 182 | +13 | 0.93 | +13 |
| LIN-4445 Jira (feature) | 4 | — | 943 | 213 | +730 | 0.23 | +730 |
| other (north star, reviews) | 4 | — | 1 | 1 | 0 | — | 0 |

Tidy programmes (LIN-4447 + 4448 + 4463 + 4446): 25 landings, of which 6 are docs-only; net production +781. Jira feature net +730.
Total +1,511, matching the tool's `lines` row.

Landings by class: 25 tidy (19 code, 6 docs-only: a886fb506, 23ebfcb4a, 5cf4f6aa2, 2aab32bf0, 0092d8d9e, cfd152fa4), 4 Jira feature, 4 governance / reviews / north star.

## 5. Real deletions, moves and new homes (file line counts, `163efc069` → `fb358dbda`)

| file | base | head | change | note |
|---|---|---|---|---|
| `lib/completion-signals.js` | 367 | 29 | −338 | two landings, LIN-4467 (−246/+14) and LIN-4470 (−111/+4) |
| `lib/run-ledger.js` | 728 | 489 | −239 | `landingPrUrls` moved to `lib/run-trail.js` (LIN-4458) |
| `lib/prompt-template-defs.js` | 1,372 | 1,114 | −258 | data halves moved to `lib/prompts/stage-kinds.js` (594) and `stage-catalogue.js` (30) |
| `lib/cost-read.js` | 854 | 769 | −85 | |
| `lib/recommendation-facts.js` | 737 | 662 | −75 | |
| `lib/run-closeout-state.js` | 455 | 421 | −34 | one landing rewrote 307 of 468 lines (d52c676fa) |
| `lib/dispatch-store.js` | 4,530 | 4,571 | +41 | three touches |
| `public/flight-companion.js` | 2,200 | 2,204 | +4 | converted to module; plain churn 1,974/1,964, `-w` 45/35 |
| `public/task-page.js` | 959 | 930 | −29 | converted to module; `-w` 92/105 |
| `public/cost-format.js` | 34 | deleted | −34 | logic to `public/cost-format-global.js` (13) and shared module |
| `lib/recommendation-live-wait.js` | 80 | renamed | — | → `lib/run-live-wait.js` (97), R075 |

New production files: 12 added (plus `run-live-wait.js` as the rename), 1,724 lines, largest `lib/prompts/stage-kinds.js` (594),
`lib/run-trail.js` (422), `lib/providers/jira/as-asked-region.js` (198).

## 6. Rebuild filter (run 6's rule: one landing deletes ≥50% of a file's prior lines, `d≥20`, JSON and `_evidence` excluded)

Plain: 15 events. With `-w`: 10 events. Classified by hand:

- Moves or removals (7): `public/cost-format.js` (92676b1fe), `tests/unit/cost-format-parity.test.js` (92676b1fe),
  `lib/recommendation-live-wait.js` (c174185f6), `tests/unit/workspace-kpis-cost-order.test.js` (17faa83f4),
  `tests/unit/cost-format-consumers.test.js` (b8e2a0aad), `lib/prompt-template-defs.js` (8fea3869f, 1,129 out / 870 in via new homes).
  Whole-file moves to replacement modules rather than deletions in place.
- Whitespace-only conversions (4, drop out under `-w`): `public/workspace-kpis.js` (92676b1fe, 17faa83f4), `public/task-page.js` (0cf05ce8f), `public/flight-companion.js` (b8e2a0aad).
- Real deletions or rewrites (4): `lib/completion-signals.js` (8fea3869f, fb358dbda), `lib/run-closeout-state.js` (d52c676fa, 307 out / 258 in), `lib/prompts/stage-intent.js` (8fea3869f, 39 of 60).
- Docs (1): `docs/areas/llm-and-prompts.md` (fb358dbda, 102 of 175, Waiting entries settled).

## 7. Test suite

- Runtime `ℹ tests` (unit-job logs, `gh run view --job <id> --log`, the job "Unit tests" on each head):
  - base `163efc069` run `43327645957`, job `131564063322`: **25,350** tests, 4,645 suites, 0 failing
  - head `fb358dbda` run `43582360225`, job `132409597478`: **26,038** tests, 4,764 suites, 0 failing
  - Δ +688 (+2.7%) over 33 landings: 20.8 per landing (run 6: 578 / 35 = 16.5 per landing)
- `*.test.js` under `tests/unit`: `git ls-tree` 1,247 → 1,282 (+35, +2.8%). Run 6: 1,227 → 1,247 (+20, +1.6%).
- 38 unit test files added (`git log --first-parent --diff-filter=A`). Static `test(`/`it(` calls in them: 386. Files whose names
  are census, characterization, witness, inventory, module, import, layout, owners or shared-modules: 13 files, 132 calls (34%).
  Static counts, not runtime counts. Per-file counts are in the scratchpad analysis only.

## 8. CI

- `test.yml` on `main`, successful runs for all 33 landing heads: 33 of 33 runs exist with `conclusion: success`, including
  `c205190fd` (run `43454782230`, `updatedAt − startedAt` 5.85 min).
- The committed tool's listing, `gh run list --workflow test.yml --branch main --status success --created <window> --limit <GH_LIMIT>`,
  omits `43454782230`. Reproduced: with `--status success --limit 200`, 200 rows, none for `c205190fd`; with `--created 2026-11-13`, 29 rows,
  none for `c205190fd`; with no `--status`, the run is listed; `gh run view 43454782230` reports `conclusion: success`.
  The tool therefore prints `ci` as 32 of 33 with one unreadable landing. The report prints the tool's row as written.
- Declared `ci` medians: whole window 5.72 (n = 32); post-v4 5.7 (n = 28 + the omission); pre-v4 5.91 (n = 4).

## 9. Cost per finished task, by stage kind (proxy `GET /issues/{id}/cost`, 25 finished tasks)

Raw responses: `cost-per-task-raw.json`. Sums use `workerSessions[].costUsd`. The declared `cost` row uses `totalUsd`, so the figures differ by about $0.15–0.20.

| stage kind | sessions per task (this) | $ per task (this) | run 6 sessions / $ per task (33 tasks) |
|---|---|---|---|
| implementation | 0.88 | 4.77 | 1.00 / 7.06 |
| custom | 0.36 | 2.31 | — |
| review | 1.08 | 1.76 | 0.97 / 1.59 |
| autopilot | 0.60 | 1.39 | — |
| close-out | 1.00 | 1.04 | 0.91 / 1.45 |
| scoping | 0.92 | 1.03 | (prefix 0.66 / 0.65 in 8 Nov) |
| blind-read | 1.00 | 1.02 | 0.12 / 0.14 |
| research | 0.12 | 0.99 | 0.27 / 2.26 |
| survey-task | 0.76 | 0.92 | (prefix) |
| survey-place | 0.80 | 0.92 | (prefix) |
| look-first prefix (survey-task + survey-place + scoping) | 2.48 | 2.88 | 2.64 / 2.84 |
| plan | 0.28 | 0.40 | — |
| plan-review | 0.20 | 0.35 | — |
| breakdown | 0.04 | 0.05 | — |

Totals: median $15.10 and mean $16.96 over the 25 summed sessions (declared row: $15.25 / $17.17). Median sessions 8.
Excluding the three Periodical report tickets (LIN-4442, 4443, 4444): median $14.82 over 22 tasks.

Run 6's breakdown is over its 33 tasks, which included nine Periodical tasks. The populations differ; compare the levels, not the deltas as precise figures.

## 10. Other reads

- Open LV PRs at run time: #2446 (LIN-4468 notes, opened 13 Nov 22:37Z, still open), #2451 (LIN-4478 paper, 14 Nov 09:52Z), #2452 (LIN-4479 paper, 14 Nov 09:58Z).
  Nine older open PRs (#1099–#2344) are unchanged in the window.
- PR burst: 25 merged PRs created 13 Nov 14:00Z–22:00Z; median create-to-merge 36.3 min (n = 25).
- Area notes (`docs/areas`), landings touching it: `526bca66c^..9574d537` 20 of 26 (77%); `9574d537..163efc069` 28 of 35 (80%); `163efc069..fb358dbda` 29 of 33 (88%).
  Lines added: 698 / 26 = 26.8; 754 / 35 = 21.5; 700 / 33 = 21.2 per landing. Bytes: 33,916 → 65,654 (+94%) in run 6; 65,654 → 97,835 (+49%) here.
- Hot-file touch counts (window, excluding `_evidence`): `docs/architecture/source-map.md` 19 (run 6: 10), `docs/areas/runs-and-dispatch.md` 18 (13),
  `docs/areas/llm-and-prompts.md` 11 (17), `lib/proxy-instructions.js` 7 (7), `routes/proxy-compute.js` 5, `server.js` 5 (run 6: 1 landing), `routes/proxy.js` 3 (2),
  `routes/proxy-writes.js` 4, `routes/workspace-api-issue-write.js` 4, `lib/dispatch-store.js` 3 (1), `lib/periodicals.js` 2 (4), `lib/runner-kit/runner.mjs` 1 (0).
- Source-map coupling: 11 of 11 landings that add or delete a production file also touch `docs/architecture/source-map.md`.
- `docs/reviews` landings: 3 of 33 (run 6: 11 of 35). Periodical report landings: LIN-4442, LIN-4443, LIN-4444.
- `docs/papers`: 50,563,894 bytes at both pins, 0 touches. `docs/reviews`: 89,101,944 → 93,039,039 bytes (+3.94 MB; run 6 +4.7 MB).
  `docs/plans`: 657,613 → 832,515 bytes (+175 KB, survey reports). `experiments/`: 590 files, 22,248,016 bytes at both pins.
  `.github/`: unchanged (`git diff --stat 163efc069 origin/main -- .github` empty).
- Silent files (run 6 `stagnation`): `lib/harbour-spawn.js` 228, `lib/providers/registry.js` 90, `lib/render-custom-prompts.js` 133, unchanged, 0 touches.
- Periodic timers: `server.js:1035` (`setInterval` catalog refresh) and `server.js:4710` (`setInterval` hourly cleanup); run 6 had `:4708`.
- Prompt budget: `FROZEN_TOTAL_BYTES` 378,915 → 396,064 (+17,149, +4.5%). Per the constant's own comment, LIN-4467 is +17,969 "moved in from unbudgeted files";
  LIN-4469 −465 then −355 in the same constant's comment. The net is mostly re-budgeting, not new text.
  `prompt-template-defs.js` ceiling 120,682 → 98,917 (LIN-4467, data halves moved out); `prompt-formatters.js` 48,509 → 48,752.
- Comments in the production diff: 2,762 added comment-like lines, 488 of which cite a `LIN-` ticket (most of the 488 in `public/flight-companion.js`, 59).
- SD (simple-dispatcher): `1616b19` (#339, docs +6), `47fb6af` (#340, LIN-4474: `hook.js` 23 lines, `transcript.js` +31, one new test file 122 lines, docs),
  `7d5fe7d` (#341, LIN-4476: `test/fixtures/runner-contract.json` +398, `test/runner-contract.test.js` +136).
  `opencode-runner.js`, `dispatcher.js`, `reapers.js`: 0 touches. `hook.js`, `transcript.js`: 1 touch each.
- Contract pairing: LV `302edafc3` (#2448, LIN-4475) changes `lib/runner-kit/contract.json` (+398) and `lib/runner-kit/runner.mjs` (+55);
  SD `7d5fe7d` (#341) changes the runner contract fixture (+398). Same-window runtime-contract changes in both repos.
- Declaration citation drift: `docs/reviews/stability-measures/README.md` cites `landingPrUrls` in `lib/run-ledger.js`; it is now defined in `lib/run-trail.js` (line 420),
  which `scripts/stability-measures-blind.mjs` imports. The declaration says the code is right. Stale citations also remain in
  `docs/areas/reports-and-operator-tools.md`, `docs/architecture/source-map.md`, `docs/architecture/prompt-system.md` and `docs/proxy-integration.md`.
- Revert check: subject search for `revert|undo|retire|supersede|roll ?back` over the window: one hit, `c205190fd` (LIN-4454 "retire dispatchModelOf"). True reverts: 0 in LV and SD.
- Tracker states read at run time: LIN-4447 Done; LIN-4448 In Progress (7 of 7 children Done); LIN-4463 In Progress (2 of 2 children Done); LIN-4445 In Progress;
  LIN-4452 In Progress; LIN-4441 not re-read this run.

## 11. Second-read corrections (added after the fresh reader's DISAGREE)

- Whitespace-ignored run 6 comparison (`git log --first-parent -m -w --numstat --no-renames -- server.js lib routes public`, tool `.js` scope):
  - run 6 `9574d537..163efc069` (35 landings): 3,243 added, 950 deleted → 92.7 and 27.1 per landing
  - this window `163efc069..fb358dbda` (33 landings): 4,448 added, 2,937 deleted → 134.8 and 89.0 per landing
  - added per landing: ×1.44 whitespace-ignored (×2.7 plain); deleted per landing: ×3.3 whitespace-ignored (×7.3 plain)
  - share of base, added only: 0.065% (4,448 / 33 / 209,077) against 0.045% (3,243 / 35 / 206,784)
- Blind-read sessions per finished task: `cost-per-task-raw.json`, count of `kind == 'blind-read'` per task is 1 for all 25 tasks.
  Median sessions 8 with it, 7 without (mean 7.04 without); run 6's median was 7.
