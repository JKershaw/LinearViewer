# Seams & Tangles Review — 2026-11-14, run 13 (delta vs run 12)

Task: LIN-4482 · Previous: `seams-tangles-review-2026-11-13-run12.md` (run 12, LIN-4444, PR #2419, squash `5e09b5643`) · Tools: `scripts/code-shape/seams.mjs` and `cochange.mjs`, HEAD versions (unchanged in the window) · Evidence: `docs/reviews/_evidence-2026-11-14-run13/` (start with its `README.md`). "E/" below means that folder.

Review-only. This PR changes this report, E/, and the area notes listed in §9. No code, config, guide (`docs/areas/areas.json`), tool or other doc was edited. simple-dispatcher was read, not edited; no finding lands in its notes, so it has no PR from this run.

## Headline

- **Run 12's top finding is resolved.** `seam:landing-reader-agent-note` (High in run 12) was fixed by LIN-4458: `lib/run-trail.js` now holds one comment classifier, and the agent-note row reads `work: cites-new-pr`, citing "Seams §3.0a". Run 12's reproduction, re-run at HEAD with the moved import, gives the same answer for the agent note and the plain comment (`workAfterReview true`, no blind-read step). `tests/unit/lin-4458-trail-characterization.test.js` pins it (§3.0a).
- **Three more run 12 rows are resolved or settled in code.** P-LW1 was carried out: the live-stage wait is `lib/run-live-wait.js` in Runs, with no outbound import (§3.10). The leftover follow-up now has a contract row ("follow-up to a finished session with no halt", claimed on both sides), so `seam:leftover-resume-contract` is closed (§3.0b). The limiter window is now read against the contract's cap by `tests/unit/proxy-limiter-window-contract.test.js` (LIN-4468), which removes the unpinned half of `seam:runner-contract` (§3.0). LIN-4154 is settled in substance: `fmtDuration` lives in `lib/time-words.js`, and no Runs or Other module imports a renderer for it (§3.9). LIN-4154 itself is still Backlog. This report does not edit it.
- **No new High.** F1 stays the top-ranked knot. It is **High, worse in count (38/55 → 41/61) and better in kind.** On the LLM → Runs side, six LLM modules now read one Runs door, `run-trail.js`, where five used to read `run-ledger.js` and two read `recent-runs.js`. The Runs refusal that run 12 found held in LLM has moved to Runs. Of the eleven new Runs → LLM edges, nine import vocabulary: stage-kind records and word leaves. One swaps `llm-call-log.js` from one cost file to another. One reads the template registry for `stageWrites` (§3.1).
- **The largest new cross-area shape is `hub:stage-writes.js` (Medium, new; §3.2b).** LIN-4468's write gate turned `lib/stage-writes.js`, a catch-all file, into the stage write-allowance table. Three areas read it. Its cross-area importers went from 2 to 8, and it grew from 40 to 146 lines. It accounts for the whole of Agent API → Other (2 → 6), for Runs → Other's rise (5 → 7), and for keeping LLM ⇄ Other open. The guide gave the gate (`stage-write-gate.js`) a home in Agent API and left its table in the catch-all. Labelled experiments E and F (Agent API or LLM as its home) each close LLM ⇄ Other, and each adds edges to an existing knot.
- **F3 is worse in the reverse direction: Providers → LLM 4 → 6, LLM → Providers 15 → 14 (Medium; §3.3).** One new edge is the Jira as-asked region importing the `as-asked.js` door, which is by design (LIN-4450). The other is `lib/providers/jira/index.js` importing `extractPeriodicalGateId` from `lib/periodicals.js`, the 1,428-line Periodical engine. A provider now reads a Harbour feature's marker in order to decide how many comments to fetch. This run adds a note entry for it.
- **The pair count rose from 13 to 14, and the rise is the guide's edit, not code.** The guide moved `lib/cost-format.js` into Pages, which re-files one edge, `lib/ship-biscuit.js` → `cost-format.js`, as LLM → Pages, and that opens Pages ⇄ LLM (37/1). Under one registry, the 14 pairs are the same at both commits. No code change opened or closed a pair. The cycle group is still the same nine areas (§1.1).
- **The browser area has import edges for the first time: Browser → Pages, 0 → 6 (Low, the right direction; §3.6).** Five pages are ES modules that import two served leaves, `lib/cost-format.js` and `lib/time-words.js`. The leaves come through an allow-list, and tests pin them as leaves with a front-end owner. F6 (window globals) is unchanged at 67. Browser ⇄ Pages, the second-busiest co-change pair (133), now has its first import link. `scripts/code-shape/README.md` line 10 ("`public/` holds classic scripts with no import statements") is now stale.
- **N1 went 18 → 16, all of it from the guide's edit** (`cost-format`, `usage-snapshot-intake`). Under one registry, the set is the same 16 at both commits. Pages → Other went 10 → 3, also from the guide alone (§2.3).
- **Co-change, 60 days, same registry: 914/399/76 → 945/420/76.** One commit left the window and 32 entered, and the arithmetic reconciles exactly. Agent API ⇄ Runs is now the top pair (124 → 135). LLM ⇄ Runs went 112 → 122 and Agent API ⇄ LLM 81 → 91. Pairs with no import link went 19 → 18, because Browser ⇄ Pages gained one. No candidate seam is new (§6).
- **Added to the ledger, not new in code:** `seam:reap-window` (two repos). Harbour's `REAP_INACTIVITY_MS` copies simple-dispatcher's environment-configurable 7-day record window. LIN-2201 (Backlog) owns it, so it is listed in this report only (§3.0c).
- **simple-dispatcher's require graph is unchanged:** 52 files, 157 file edges, 20 directed links and 6 pairs, identical at both commits. `hook.js` swaps one named import from `transcript.js` within the same pair. Both repos' contract copies hash to `871ca615…`, which is 86 rows, including a new `fold` area of 14. The eight transcript-corpus files the fold rows name are byte-identical across the repos, and both sides pin them by sha256 (§3.0).
- **Notes.** Two entries were added: `other-features.md` (the `stage-writes.js` placement) and `providers.md` (the Jira → Periodical-engine import). One settled entry was removed (the `stage-writes.js` header, already fixed). Eight entries that were untrue in one clause were corrected across `agent-api.md`, `other-features.md`, `runs-and-dispatch.md` and `front-end-pages.md`. This closes run 12's §12 limit: 65 entries were re-verified (§9). No ticket was minted.
- **Adversarial second read:** Tier 2, a fresh-context sub-agent (§Adversarial Second-Read).

## 0. What was measured

**Commits.**

| repo | commit | role |
|---|---|---|
| LinearViewer | `fb358dbda7f26ab44b3f58acb15886b21ac20950` | run 13 head (origin/main, read 14 Nov 2026; equal to the mint commit) |
| LinearViewer | `e2d4659c4bf07ed266735f718e85232e5f2a6458` | run 12's measured commit (baseline) |
| simple-dispatcher | `7d5fe7d9473232152365e6837ececcd6f2876987` | head (origin/main; equal to the mint commit) |
| simple-dispatcher | `af9b496d57f042972b912a30eb8c4d1164bbab77` | run 12's head (baseline) |

The window is `e2d4659c4..fb358dbda`: 32 first-parent commits, 137 files under `lib/`, `routes/`, `public/` and `server.js` (+8151 / −6254). 12 files were added, one was renamed (`recommendation-live-wait.js` → `run-live-wait.js`) and one was deleted (`public/cost-format.js`). Outside the tool's scope, `scripts/gen-llms-catalogue.mjs` was added.

**Registries.** Both commits are measured with one registry: `docs/areas/areas.json` at the head (E/`areas.head-registry.json`). The guide-only check is separate (§1.1).

**Scope and could-not-read counts (LinearViewer; E/`supplementary-figures-run13.txt` S1).**

| commit, registry | files in scope | parse failures | unresolved relative imports | non-literal dynamic imports | unmapped source files | edges (cross-area) | reciprocal pairs | cycle groups |
|---|---|---|---|---|---|---|---|---|
| head `fb358dbda`, HEAD registry | 577 | 0 | 4 (F8) | 0 | 0 | 2257 (1370) | 14 | 1 (9 areas) |
| baseline `e2d4659c4`, HEAD registry | 566 | 0 | 4 (F8) | 0 | 0 | 2180 (1334) | 14 | 1 (9 areas) |
| baseline `e2d4659c4`, its own registry | 566 | 0 | 4 | 0 | 0 | 2180 (1342) | 13 | 1 (9 areas) |

The last row reproduces run 12's published `seams.mjs` output exactly (links, knots, areas and scope; S1). So the HEAD tools reproduce run 12's evidence.

**Co-change** (S9). `shallow` is false at both commits. `unmappedFiles` is 9015 at the head and 8855 at the baseline. These are docs and evidence, which the code-only registry does not map, by design.

**Scripts outside the import tool's scope** (S8). `seams.mjs` reads `server.js`, `lib/`, `routes/` and `public/` only. At the head, 54 non-test files under `scripts/` import `lib/`, and four of them are registered to an area. The registered Reports scripts make five `lib/` imports, up from four: `stability-measures-blind.mjs` now also imports `lib/run-trail.js`. The new `scripts/gen-llms-catalogue.mjs` imports `lib/prompts/stage-catalogue.js` and writes `public/llms.txt`. It has no area (§3.11).

**simple-dispatcher.** `seams.mjs` reads 0 of its 52 root-level CommonJS files. The scratch reader (E/`require-graph.mjs`, run 11's, unchanged) reads all 52, with 0 unmapped, 0 unresolved and 0 non-literal `require` at both commits (S13).

**Tools.** `git diff --name-status e2d4659c4 fb358dbda -- scripts/code-shape` is empty. The edge dump is run 10's (`docs/reviews/_evidence-2026-11-08-run10/edge-dump.mjs`). Its cross-area total equals `seams.mjs`'s link total at every commit and registry above.

## 1. Changes since run 12 (first), then the window

### 1.1 Guide edits (recorded apart from code movement)

`docs/areas/areas.json` changed in four places (LIN-4457, LIN-4465, LIN-4468, LIN-4471, LIN-4472):
- Pages gained `cost-format` and `time-words`.
- Agent API gained `stage-write-gate`.
- Runs gained `item-stage-stamp`, `usage-snapshot-intake` and `cost-read(?:-calls)?`.
- LLM gained `code-routes`.

**What the guide edit alone moved** (run 12's commit under its own registry against the HEAD registry; S2):
- **Import graph.** Ten edges were re-filed. Seven Pages renderers' edges into `cost-format.js` became internal. `lib/ship-biscuit.js` → `cost-format.js` became **LLM → Pages**. `dispatch-store.js` → `usage-snapshot-intake.js` became internal to Runs, and `server.js` → `usage-snapshot-intake.js` became Wiring → Runs. As a result, Pages → Other went 10 → 3, LLM → Other 2 → 1, Runs → Other 6 → 5 and Wiring → Other 9 → 8, while Wiring → Runs went 48 → 49 and LLM → Pages 0 → 1.
- **Pairs.** **Pages ⇄ LLM (37/1) is opened by the guide alone**, through that one ship-biscuit edge. No pair was closed. So the 13 → 14 in the pair count is the map, not code.
- **N1:** 18 → 16 (`cost-format`, `usage-snapshot-intake` left the catch-all).
- **Co-change:** seven pairs move by 1 (Agent API ⇄ Pages, Pages ⇄ LLM, Pages ⇄ Other, Pages ⇄ Runs and Pages ⇄ Web each +1; Other ⇄ Runs and Other ⇄ Wiring each −1). The totals do not move (914 / 399 / 76).

### 1.2 The window: new production files

| file | registry area | what it is (from its header) |
|---|---|---|
| `lib/run-trail.js` | Runs | the one comment classifier and the one trail pass (LIN-4458); the landing readers moved here from `run-ledger.js` |
| `lib/run-live-wait.js` (renamed from `recommendation-live-wait.js`) | Runs | the live-stage wait, moved to Runs by LIN-4459 (P-LW1) |
| `lib/stage-write-gate.js` | Agent API | the proxy's per-operation write gate (LIN-4468) |
| `lib/item-stage-stamp.js` | Runs | the write allowance a dispatch row's token carries (LIN-4468) |
| `lib/code-routes.js` | LLM | the ordered `CODE_ROUTES` list `codeRouteOf` iterates (LIN-4465) |
| `lib/cost-read-calls.js` | Runs | the Harbour calls cost read, split out of `cost-read.js` (LIN-4457) |
| `lib/dispatch-feedback-kinds.js` | Runs | the feedback-entry kinds, one table (LIN-4455) |
| `lib/prompts/stage-kinds.js` | LLM | one record per stage kind; the per-kind tables become views (LIN-4467) |
| `lib/prompts/stage-catalogue.js` | LLM | the public catalogue rendered from the records (LIN-4467) |
| `lib/prompts/prompt-context.js` | LLM | the one prompt-context projection (LIN-4470) |
| `lib/providers/jira/as-asked-region.js` | Providers | the Jira "As asked" region, the only reader and writer of both copies (LIN-4450) |
| `lib/time-words.js` | Pages | duration and relative-time words, shared by server and browser (LIN-4472) |
| `public/cost-format-global.js` | Browser | the one bridge from the shared formatter to classic scripts (LIN-4446) |

Every file matches a registry pattern, so none fell through to the catch-all. The guide gave a home to each file that would otherwise have landed there.

### 1.3 Knots that moved (code only: both commits, HEAD registry)

| pair (a → b / b → a) | run 12 (`e2d4659c4`) | run 13 (`fb358dbda`) | Δ | finding |
|---|---|---|---|---|
| LLM ⇄ Runs | 38 / 55 | **41 / 61** | +3 / +6 | F1 (§3.1) |
| Agent API ⇄ Other | 2 / 1 | **6 / 1** | +4 / 0 | §3.2b, §3.5 |
| Agent API ⇄ LLM | 46 / 4 | **48 / 4** | +2 / 0 | §3.1b |
| Agent API ⇄ Runs | 48 / 10 | **50 / 10** | +2 / 0 | F4 (§3.2) |
| LLM ⇄ Providers | 15 / 4 | **14 / 6** | −1 / +2 | F3 (§3.3) |
| Pages ⇄ Runs | 15 / 8 | **16 / 8** | +1 / 0 | §3.9 |
| Other ⇄ Runs | 6 / 5 | **6 / 7** | 0 / +2 | §3.2b |

Directed links that moved and belong to no pair: Browser → Pages 0 → 6; Web → LLM 87 → 92; Web → Runs 91 → 93; Web → Platform 55 → 56; Agent API → Platform 30 → 31; Runs → Platform 61 → 60; Runs → Providers 10 → 11 (S3, and S4 for every file-level edge).

Unchanged: Agent API ⇄ Providers 21/3; Auth ⇄ Pages 14/11; Auth ⇄ LLM 5/3; Auth ⇄ Providers 13/1; Pages ⇄ LLM 37/1 (the guide-opened pair); Pages ⇄ Other 3/8; LLM ⇄ Other 1/2.

## 2. The import graph: direction, hubs, ways in

### 2.1 Direction checks (S7)

- `lib/` → `routes/`: 0 edges at both commits. Edges into `server.js`: 0.
- **Renderers imported from Runs, Other, LLM, Providers, Agent API or Platform:** 6 → 4. The two that left are `lib/task-page-loader.js` and `lib/task-state.js` → `render-run-steps.js`, LIN-4154's pair. Both now import `fmtDuration` from `lib/time-words.js`, a Pages leaf. The four that remain are Runs-registered routes rendering their own pages (`routes/live-console.js`, `routes/runner-setup.js`), carried and by design.
- **Browser → `lib/` through the serving bridge (new).** Six edges, all from `public/` to two Pages leaves (§3.6). No `lib/` or `routes/` file imports `public/`, and no browser file imports another browser file.
- Platform & plumbing is still a leaf: 0 cross-area out.
- Providers → LLM rose by two (§3.3).
- **A table in the catch-all, read by three areas.** `lib/stage-writes.js` has 8 cross-area importers: Agent API ×5, Runs ×2 and LLM ×1 (§3.2b).
- **A test-mode predicate filed under LLM.** `lib/should-mock-ai.js` is in LLM by name. Its cross-area importers went 11 → 17 (Web ×12, Runs ×3, Agent API ×1, Wiring ×1). Most of the window's new ones import `isHermeticTestToken`, the hermetic test-token check, not the AI mock (§3.12).

### 2.2 Hubs and doors (in / cross-area in / outbound / cross-area out; lines; baseline → head; S5)

| file | baseline | head | lines | note |
|---|---|---|---|---|
| `lib/run-trail.js` | — | **11 / 8 / 3 / 2** | 422 (new) | new door: 6 LLM, 1 Agent API, 1 Web importer (§3.10) |
| `lib/run-ledger.js` | 11 / 7 / 2 / 2 | **8 / 4 / 1 / 1** | 728 → 489 | improved: readers moved to `run-trail.js` |
| `lib/stage-writes.js` | 2 / 2 / 0 / 0 | **8 / 8 / 0 / 0** | 40 → 146 | catch-all leaf table (§3.2b) |
| `lib/should-mock-ai.js` | 11 / 11 / 0 / 0 | **17 / 17 / 0 / 0** | 39 → 40 | test predicate, LLM by name (§3.12) |
| `lib/run-live-wait.js` | (was `recommendation-live-wait`, 4 / 3 / 1 / 1) | **6 / 4 / 0 / 0** | 80 → 97 | in Runs; a leaf now (§3.10) |
| `lib/prompts/stage-kinds.js` | — | 8 / 3 / 4 / 1 | 594 (new) | one record per kind; imports leaves only |
| `lib/time-words.js` | — | 8 / 4 / 0 / 0 | 47 (new) | served leaf (§3.6) |
| `lib/cost-format.js` | 8 / 1 / 0 / 0 | 12 / 5 / 0 / 0 | 46 | served leaf; 4 browser importers (§3.6) |
| `lib/cost-read.js` | 12 / 7 / 7 / 2 | 8 / 3 / 7 / 1 | 854 → 769 | improved: call reads moved to `cost-read-calls.js` |
| `lib/cost-read-calls.js` | — | 5 / 4 / 1 / 1 | 105 (new) | Runs file whose import and most callers are elsewhere (its own header says so) |
| `lib/openrouter.js` | 33 / 25 / 13 / 2 | 33 / 25 / 12 / 3 | 2254 → 2240 | cross-out +1: `run-trail.js` |
| `lib/periodicals.js` | 9 / 8 / 1 / 0 | **10 / 9** / 2 / 0 | 1416 → 1428 | new importer: Jira provider (§3.3) |
| `lib/proxy-instructions.js` | 1 / 0 / 9 / 7 | 1 / 0 / 11 / 9 | 1325 → 1346 | the catalog now reads the stage records and the allowance table |
| `lib/prompt-template-defs.js` | 1 / 0 / 11 / 3 | 1 / 0 / 12 / 3 | 1372 → 1114 | shrank: the per-kind facts moved to the records |
| `lib/completion-signals.js` | 2 / 2 / 3 / 3 | 2 / 2 / 1 / 1 | 367 → 29 | now a view of the records |
| `lib/recommendation-facts.js` | 11 / 6 / 7 / 4 | 11 / 6 / 8 / 5 | 737 → 662 | reads the trail from `run-trail.js` |
| `lib/run-closeout-state.js` | 5 / 2 / 0 / 0 | 7 / 3 / 3 / 2 | 455 → 421 | now reads `providers/state-map.js` and blind-read words |
| `lib/task-page-loader.js` | 9 / 8 / 22 / 10 | 9 / 8 / 22 / 10 | 1578 → 1557 | N2; the renderer import is now a leaf import |
| `lib/dispatch-store.js`, `lib/dispatch-factory.js`, `lib/workspace-preferences.js`, `lib/run-controls.js`, `lib/tree.js` | unchanged in degree | unchanged | 4571, 1417, 511, 152, 684 | Code Quality owns size |
| `lib/as-asked.js` | 25 / 12 / 1 / 1 | 24 / 12 / 1 / 1 | 348 → 352 | door, healthy |
| `routes/proxy-writes.js` | 1 / 0 / 17 / 14 | 1 / 0 / 19 / 16 | 976 → 1036 | gate and trail reads |
| `routes/proxy-compute.js` | 1 / 0 / 25 / 24 | 1 / 0 / 27 / 26 | 1633 → 1584 | |
| `server.js` | 0 / 0 / 205 / 205 | 0 / 0 / 205 / 205 | 4769 → 4771 | LIN-1249 owns decomposition |

### 2.3 N1: the catch-all

Other-features files with a cross-area edge (S6):
- run 12 as published: 18
- the baseline under the HEAD registry: 16
- the head: 16, the same set as the baseline

The two that left are the guide's edit. The window moved no file into or out of the catch-all. The set at the head: `as-asked-seal`, `dashboard-refresh`, `home-pipeline`, `home-row-states`, `home-rows`, `home-view`, `key-state-holders`, `key-state`, `live-anchor`, `ruling-settled`, `ruling-standing`, `stage-writes`, `subtree-index`, `task-facts-holder`, `task-state`, `waiting-section`.

In the window, `stage-writes` is the one whose cross-area traffic changed (§3.2b).

### 2.4 Where the import graph's areas and the guide's names differ

- **`lib/cost-format.js`, `lib/time-words.js`** are filed under Pages (LIN-4471, pinned by `tests/unit/served-leaf-owners.test.js` to a front-end area). Their importers are the browser (6 edges), Pages, Runs (`task-page-loader`), Other (`task-state`) and LLM (`ship-biscuit`). The LLM importer is the edge that opens Pages ⇄ LLM. Experiment H (both leaves to Platform) closes that pair and keeps the others. It also reverses LIN-4471's pin, which was chosen so that the served leaves read the front-end notes. Labelled, not proposed (§7).
- **`lib/should-mock-ai.js`** is LLM by name. Of its 17 importers, the window's new ones import `isHermeticTestToken`, a test-token check (§3.12; experiment G).
- **`lib/stage-writes.js`** is homeless by default. It is a leaf that three areas read (§3.2b).
- **`lib/prompts/area-note-format.js`** (P-AN1) now has an in-scope importer, `lib/dispatch-leftover-answer.js` (Runs), for the one cited-path predicate (LIN-4470). It is still notes infrastructure filed under LLM by prefix. The edge adds to F1's Runs side (§7).
- **The `workspace-` prefix** still drives N3 (5/3), unchanged.

## 3. Findings, severity-ranked, trend-framed

Ordering: severity first, then the window's movement. Stable names follow runs 9–12. New names are marked **new**. Resolved rows are listed where their run 12 row was, so the ledger reads straight across.

### 3.0a `seam:landing-reader-agent-note` · run 12 **High** → **resolved** (LIN-4458)

- **What run 12 found.** `isLandingEvidence` dropped agent notes, while `landingPrUrls` did not. As a result, an `autopilot:` note citing a new PR joined the landing without counting as work after review, and a blind read was offered over a PR that no review had covered.
- **What changed.** LIN-4458 ("one trail pass") replaced both readers with one table in `lib/run-trail.js`. Its rows declare `landing`, `landed` and `work`. The `agent-note` row is `landing: all, landed: never, work: cites-new-pr`, and the readings comment names "a new PR is, Seams §3.0a". `landingPrUrls` moved to `run-trail.js` with no re-export.
- **Reproduction at HEAD** (E/`landing-agent-note-repro.mjs`, the run 12 script with its one import moved; output E/`landing-agent-note-repro.txt`):
  - `agentNewPr` gives `workAfterReview true`, landing [41, 42] and no step. At run 12 it gave `false` and `blind-read`.
  - `plainNewPr` is unchanged.
  - The same-PR cases (`autopilotNote`, `plainNote`, `noNote`) are unchanged, which is designed behaviour.
- **Pinned.** `tests/unit/lin-4458-trail-characterization.test.js` ("an agent note after review that cites a new PR is work after review (Seams §3.0a …)"). The census `tests/unit/lin-4458-comment-kind-census.test.js` fails on a kind test written outside the table.
- **Note.** The `runs-and-dispatch.md` `landingPrUrls` entry, with its three cases, was pruned by LIN-4458. Its remaining stated limit, row 15 (a foreign PR before the first review), is now the `lib/run-trail.js` entry in that note, and it is still true. Nothing for this run to prune.

### 3.0 `seam:runner-contract` (two repos) · Medium → **Low** · **improved**

- **The pin, re-verified.** `lib/runner-kit/contract.json` and simple-dispatcher's `test/fixtures/runner-contract.json` hash to `871ca615f627a02611957489f3abc83498f1dca64af07259800a174148ba23a2` at both heads. Both were `602ab014…` at both baselines (E/`contract-sha.txt`). The table went from 66 to 86 rows (E/`contract-fold-and-rows.txt`). It gained four `halt` rows (the `session` vocabulary `running | finished | stopped | none`), two `report` rows and a new `fold` area of 14 rows.
- **The fold, a new pinned cross-repo seam.** The fold rows compare the kit's transcript fold (`runner.mjs` `transcriptRequestRecords`) with simple-dispatcher's `walkRequestRecords`. Eight of them name corpus files by sha256. The eight files exist in both repos, under `tests/fixtures/runner-kit/transcript-corpus/` and under simple-dispatcher's `test/fixtures/transcript-corpus/<case>/<stage>/`, and they are byte-identical (E/`contract-fold-and-rows.txt`). simple-dispatcher's `pinFold` checks each corpus file against its row's sha256, and its tamper test keeps that check wired. So the corpus is held in two places and pinned on both sides.
- **The limiter ↔ cap match is now pinned.** `routes/proxy.js` exports `PROXY_LIMITER_WINDOW_MS` (60 000). `tests/unit/proxy-limiter-window-contract.test.js` (LIN-4468) asserts that it equals the contract's `exchange` cap row × 1000, and that the kit waits the cap out. The broker (`lib/runner-kit/broker.mjs` `EXCHANGE_MAX_WAIT_SECONDS = 60`) and simple-dispatcher's `harbour-token-mcp-server.js` (`EXCHANGE_MAX_WAIT_SECONDS = 60`) are each pinned to the same rows. The `agent-api.md` Waiting entry for this was removed in the window by LIN-4468's branch. That is correct.
- **What remains.** simple-dispatcher's note `stop-hook-and-relay.md` records that since LIN-4474 retired `columnProblems`, nothing in that repo checks a copied row's shape, and that a re-pin moves the sha anyway. The re-copy relies on a stated step. That entry is simple-dispatcher's own and is true. It is not re-filed here.
- **Severity: Low, improved.** Both of run 12's open points are now pinned.

### 3.0b `seam:leftover-resume-contract` (two repos) · Low → **resolved** (LIN-4475)

- The contract now has the row run 12 asked for, "follow-up to a finished session with no halt", with `sd: claimed` and `kit: claimed`. It also has the running, stopped and no-session cases, each with its declared difference. The `runs-and-dispatch.md` no-halt Waiting entry is gone from the note (LIN-4475's branch). That is correct.

### 3.0c `seam:reap-window` (two repos) · **Low, ticket-owned (LIN-2201)** · **added to the ledger** (not new in code)

- Harbour's `REAP_INACTIVITY_MS = 7 * 86400000` (`lib/unanswered-decisions.js`) copies simple-dispatcher's record window, `REAP_INACTIVITY_MS` (`config.js`). On the simple-dispatcher side it can be configured by environment. Nothing checks that the two agree, and the contract has no row for it. simple-dispatcher's `state-and-config.md` carries it as Waiting, and Harbour's comment names LIN-2201 (Backlog), which owns it.
- **Why it is new to this ledger.** Runs 1–12 did not list it. This run widened the search into simple-dispatcher's notes for cross-repo seams the contract does not cover. This one was the only find. It stays in the report only, because a ticket owns it.

### 3.1 F1 `knot:agents-chat<->runs` (LLM ⇄ Runs) · **High** · **worse in count, better in kind**

- **Count.** 38/55 → **41/61** (E/`edge-diff-B-to-H.txt`, S4). Run 11 was 32/50.
- **LLM → Runs, +10 −7.**
  - **Five are swaps onto the new trail door:** `openrouter`, `prompt-template-defs`, `prompts/revision-brief`, `recommendation-blind-read`, `recommendation-facts` and `recommendation-look-first` now import `run-trail.js`, and three of their `run-ledger.js` imports and two `recent-runs.js` imports are gone.
  - **Two follow from P-LW1:** `code-routes.js` and `recommendation-blind-read.js` import `run-live-wait.js`. Before, the rule lived in LLM.
  - **Two are swaps to narrower files:** `model-routing-spend.js` → `cost-read-calls.js` replaces `cost-read.js`, and `prompts/runner-kickoff.js` → `dispatch-feedback-kinds.js` replaces `dispatch-store.js`.
  - Distinct Runs targets went 27 → 30. `run-trail.js` now takes 6 of the 41 edges (E/`f1-edge-kinds.txt`).
- **Runs → LLM, +11 −5.**
  - **Nine of the additions are vocabulary:** `stage-kinds.js` ×2 (`completion-signals`, `run-view`: the per-kind tables became views), `blind-read-words.js` ×4 (`pipeline-churn`, `run-closeout-state`, `run-trail`, `run-view`), `survey-words.js` (`run-trail`, moved from `run-ledger`), `prompts/area-note-format.js` (`dispatch-leftover-answer`, the one cited-path predicate) and `prompts/prompt-context.js` (`dispatch-entrance`, the one prompt context).
  - **Two are not vocabulary.** `cost-read-calls.js` → `llm-call-log.js` is a swap from `cost-read.js`. `item-stage-stamp.js` → `prompt-templates.js` reads `stageWrites`, a lookup over the template registry, although the value is on each stage-kind record.
  - **Removed:** `completion-signals.js` → `as-asked.js` and `size-of-move.js` (now through the records), `cost-read.js` → `llm-call-log.js`, `dispatch-entrance.js` → `recommendation-live-wait.js`, and `run-ledger.js` → `survey-words.js`.
- **Kind: better.**
  - The one Runs guard that run 12 found decided in LLM (`liveWaitRefusal`) has moved to Runs, and `dispatch-entrance.js` no longer imports LLM for it.
  - The LLM recommendation layer reads the trail through one door, `run-trail.js`, which imports only two word leaves and `run-ledger.js`. Before, it read two Runs readers that disagreed (§3.0a).
  - The added Runs → LLM edges are mostly the window's consolidation working as intended: tables that became views of one record now import the record.
- **Severity stays High.** The count is the knot's measure, and both sides grew. The second reads of runs 12 and 13 can weigh that against the kind. The "better" rests on the file-level reading above, not on a score.
- **Experiments.** Run 12's experiments A–C (moving the sequence or the words) were negative, and this run does not repeat them. Experiment G (§3.12) moves `should-mock-ai.js` to Platform, which takes three Runs → LLM edges away (61 → 58). It is a placement fix, not an F1 fix.
- **Direction between files** (for example `item-stage-stamp.js` reading the registry rather than the record) is Drift & Coherence's altitude. It is listed here as evidence for the kind, not filed.

### 3.1b `knot:agent-api<->llm` (Agent API ⇄ LLM) · **Medium** · **worse by two, kind unchanged**

- Agent API → LLM went **46 → 48**. Added: `proxy-instructions.js` → `prompts/stage-kinds.js` (the verb list is derived from the records, LIN-4467), `routes/proxy-compute.js` → `prompts/prompt-context.js` (LIN-4470) and → `should-mock-ai.js` (`isHermeticTestToken`). Removed: `proxy-instructions.js` → `recommendation-live-wait.js`. The constant now comes from `run-live-wait.js`, in Runs.
- The reverse is unchanged at **4**. `applyDefaultDispatchHarness` (`lib/proxy-preamble.js`) is still imported by `model-routing.js` and `model-routing-harnesses.js`, which LIN-4155 (Backlog) owns.

### 3.2 F4 `knot:runs->agent-api(proxy-preamble)` (Agent API → Runs) · **Medium** · **worse by two**

- Agent API → Runs went **48 → 50**; Runs → Agent API is unchanged at **10**.
- Added: `proxy-instructions.js` → `run-live-wait.js` (P-LW1's move: the edge used to go to LLM), `routes/proxy-compute.js` → `cost-read-calls.js` (replacing the edge into `cost-read.js`), and `routes/proxy-writes.js` → `run-trail.js` (the proxy's blind-read and landing checks).
- Each one is a route or catalog importing a domain read, which is the right direction. `lib/proxy-preamble.js` moving out of Agent API is still LIN-3738 (Backlog).

### 3.2b `hub:stage-writes.js` (the stage write-allowance table in the catch-all) · **Medium** · **new**

- **What.** `lib/stage-writes.js` was a 40-line vocabulary leaf at run 12, with two importers (`prompt-template-defs.js`, `proxy-preamble.js`). LIN-4468 ("proxy refuses writes outside the stage's allowance") made it the allowance table: `STAGE_WRITE_OPS`, `stageWriteAllows`, `ISSUE_PATCH_FIELDS` and the `WRITES` vocabulary. It is now 146 lines with **8 cross-area importers**: Agent API ×5 (`proxy-instructions`, `proxy-preamble`, `proxy-tokens`, `stage-write-gate`, `routes/proxy-writes`), Runs ×2 (`item-stage-stamp`, `routes/dispatch`) and LLM ×1 (`prompts/stage-kinds`). No pattern matches it, so it sits in Other features.
- **What it moves.**
  - All of **Agent API → Other 2 → 6** (four new edges into it).
  - **Runs → Other 5 → 7** (two).
  - It keeps **LLM ⇄ Other** open (1/2): LLM's only edge into Other is `stage-kinds.js` → `stage-writes.js`.
  - It is now the larger reason Agent API ⇄ Other is a pair. Five of the six Agent API → Other edges go to it, and one goes to `as-asked-seal.js`.
- **What the window did with the guide.** It gave the gate (`stage-write-gate`) and the stamp (`item-stage-stamp`) homes, and left their table in the catch-all. The README asks that a new production file get a home in the same change. `stage-writes.js` is not new, so no rule was broken. Its role changed, though, and its placement did not follow.
- **Experiments (labelled, not applied; E/`experiments-run13.txt`).**
  - **E, to Agent API** (beside the gate): pairs 14 → 13. LLM ⇄ Other closes, and Agent API ⇄ Other goes to 1/1 (only the seal). The cost: Runs → Agent API 10 → 12, which is F4's reverse, and LLM → Agent API 4 → 5, which is the side LIN-4155 is meant to shrink.
  - **F, to LLM** (beside `stage-kinds.js`): pairs 14 → 13. LLM ⇄ Other closes and Agent API ⇄ Other goes to 1/1. The cost: Agent API → LLM 48 → 53 and Runs → LLM 61 → 63, which is F1.
  - **J, E plus run 10's P10a** (the seal to LLM): pairs 14 → 12. Agent API ⇄ Other and LLM ⇄ Other both close. The cost: LLM → Agent API 4 → 6, Runs → Agent API 10 → 12, and Runs → LLM 61 → 62.
- **Reading.** Each home for the table removes a catch-all pair and adds weight to a knot that already exists. None opens a pair. Choosing between E and F decides whether the allowance is the proxy's policy or the stage record's vocabulary. That is an owner's decision about the guide, not a builder rule. The size of move is a one-line registry edit plus a placement pin.
- **Filed.** A Waiting entry in `docs/areas/other-features.md` (§9). No ticket.

### 3.3 F3 `knot:providers->upward` (LLM ⇄ Providers) · **Medium** · **LLM → Providers better by one; Providers → LLM worse by two**

- **Count.** LLM → Providers went **15 → 14**: `recommendation-blind-read.js` → `providers/state-map.js` left, because the close-out reading moved into `run-closeout-state.js`, in Runs, which gives Runs → Providers 10 → 11. Providers → LLM went **4 → 6**.
- **New edge 1, by design.** `lib/providers/jira/as-asked-region.js` → `lib/as-asked.js` (`AS_ASKED_HEADING`, `AS_ASKED_END`, `sealAsAsked`, `splitAsAsked`). `as-asked.js` is the door for the block (24 importers). The provider note's first Lesson makes the region module the only code that knows both copies (LIN-4450).
- **New edge 2: a provider reads a feature marker from the Periodical engine.** `lib/providers/jira/index.js` imports `extractPeriodicalGateId` from `lib/periodicals.js` (1,428 lines, LLM). In `_periodicalGateComments`, Jira walks all comments for the last 20 only when a description carries the Periodical gate marker (LIN-4451). The marker's regex is in the engine. Its other readers are `lib/periodical-report-gate.js` (Runs) and `routes/proxy-writes.js` (Agent API). So the provider depends on the engine, and on its whole import surface, for one regex.
- **Ticket.** LIN-3923 (Backlog) owns the knot's LLM → Providers side (context caps, focus-child). The new Jira → engine edge is the other direction, and LIN-3923 does not name it. Filed as a Waiting entry in `docs/areas/providers.md` (§9), where the change would start. The other side is LLM's `lib/periodicals.js`. Seams have no full home in the notes yet (P-XN1).

### 3.4 N1 `knot:other-features-catch-all` · **Medium** · **18 → 16 by the guide; code unchanged (16 → 16)**

- §2.3. The window's only change inside the catch-all is `stage-writes.js`'s role (§3.2b).

### 3.5 `knot:agent-api<->other-features` · **Medium** · **worse: 2/1 → 6/1**

- The four new Agent API → Other edges are all into `stage-writes.js` (§3.2b). The reverse edge is still `as-asked-seal.js` → `proxy-graphql-errors.js`.
- Run 10's P10a (the seal to LLM, experiment I) still closes the pair. The only Other → Agent API edge leaves with the seal, leaving Agent API → Other 5/0. It also adds LLM → Agent API 4 → 5 and Runs → LLM 61 → 62. The `other-features.md` entry's "2/1" figure is updated in §9. Its claim that the move closes the pair still holds.

### 3.6 Browser → Pages (the serving bridge) · **Low, the right direction** · **new edges**; F6 `knot:browser-window-globals` · **Medium** · **unchanged (67)**

- **The edges.** `public/cost-format-global.js`, `flight-companion.js`, `observation.js` and `workspace-kpis.js` import `../lib/cost-format.js`. `public/observation.js` and `task-page.js` import `../lib/time-words.js`. Five `public/` files are ES modules (S11), up from 0.
- **Direction: right.** A browser page importing a pure leaf that the server also runs is the one-implementation outcome the browser note's Lessons set out (LIN-4446, LIN-4471). Several things hold it in place:
  - The leaves are served one file each through `SHARED_MODULES` (`lib/vendor-assets.js`). A file not on the list is a 404.
  - `tests/unit/shared-modules.test.js` keeps each one a leaf.
  - `tests/unit/served-leaf-owners.test.js` keeps each one in a front-end area.
  - `tests/unit/front-end-import-layout.test.js` keeps `public/` flat, so a `../lib/` specifier resolves to the same file in the browser and in Node.
  Nothing on the server imports `public/`.
- **Who owns the leaves.** The guide files both under Pages, so the browser area's first import edges are to Pages, and the serving bridge's importers (§2.4) are Pages, Runs, Other, LLM and the browser. Experiment H (both leaves to Platform) closes the guide-opened Pages ⇄ LLM and removes one edge each from Pages ⇄ Other and Pages ⇄ Runs. It also reverses LIN-4471's pin, which was chosen so that the leaves read the front-end notes. This run records it and does not propose it.
- **F6.** `window.X =` assignments in `public/` are 67 at both commits. One writer moved: `public/cost-format.js` (deleted) became `public/cost-format-global.js`, the one bridge, inventoried by `tests/unit/bridge-inventory.test.js`. The five module pages write no globals. Some still read classic globals bare (the browser note's `public/observation.js` entry). F6 counts writes, so it does not see that coupling.
- **Co-change.** Browser ⇄ Pages (133) is no longer a pair without an import link (§6).
- **Tool prose.** `scripts/code-shape/README.md` line 10 says that `public/` holds classic scripts with no import statements and that the browser area therefore shows no edges. That is untrue at HEAD. `seams.mjs` reads the six edges correctly, because its scope already included `public/`. Only the prose is stale. No area file can be cited for it, so it goes to the closing comment.

### 3.7 `seam:periodical-mint` residue · **Medium, owned** (LIN-4318, Backlog) · **unchanged**

- `lib/dispatch-entrance.js:1230` still calls `declaresPeriodicalGrant({ kind, periodicalId, autopilot: isAutopilotVariant(prompt) })`.

### 3.8 N3 `knot:auth->llm(model-routing)` · **Low–Medium** · **unchanged** (5/3)

### 3.9 Pages ⇄ Runs · **Low, watch** · **+1 (15 → 16)**; LIN-4154 settled in substance

- **The new edge.** `lib/render-task-page.js` → `lib/run-closeout-state.js` (the close-out decision, LIN-4460): a renderer reading run logic, which is the right way round.
- **Runs → Pages is unchanged at 8, and its kind improved.** `task-page-loader.js` and `task-state.js` (Other) used to import `fmtDuration` from a renderer (`render-run-steps.js`). Both now import it from the leaf `lib/time-words.js` (LIN-4472). `render-run-steps.js` no longer defines it.
- **LIN-4154** ("move fmtDuration out of lib/render-run-steps.js so task-state and task-page-loader stop importing a renderer") is done by that change. The ticket is still Backlog. This report records the settlement and does not edit the ticket.
- **Carried in the Runs note, and still true:** `fmtWhen` stays in `task-page-loader.js`, so `lib/components/time.js` and `render-task-timeline.js` import a page helper from Runs.

### 3.10 The live-stage wait, the trail door and other watches · **Low–Medium**

- **`seam:live-stage-wait` · run 12 Low–Medium → resolved in placement (P-LW1, LIN-4459).** `lib/run-live-wait.js` is in Runs. It has no outbound import, and its importers are `dispatch-entrance.js` (Runs), `code-routes.js` and `recommendation-blind-read.js` (LLM), `proxy-instructions.js` (Agent API) and `routes/workspace-api.js` (Web). The refusal is enforced and decided in one area. Two things stay open, both moved into the Runs note by LIN-4459 and both still true: the race (a read, not a claim), and the two homes for the run-outcome words (`QUEUED`/`RUNNING` here, the rest in `recent-runs.js`).
- **`hub:run-trail.js` · new, watch.** 11 importers, 8 of them cross-area (six LLM, `routes/proxy-writes.js`, `routes/workspace-api-issue-write.js`). It is a deliberate door. Its header says that the box, guard, route and prompt "cannot disagree about which PRs are the task's", and that `run-ledger.js` imports nothing from it, so the two never form a cycle. That is checked: `run-trail.js` → `run-ledger.js` only. The watch is its breadth.
- **`hub:run-ledger.js` · improved.** Cross-area importers went 7 → 4, and the file went from 728 to 489 lines.
- **`hub:openrouter.js` · watch.** Outbound went 13 → 12, and cross-area out went 2 → 3 (`run-trail.js`).
- **`hub:periodicals.js` · watch.** It has one new importer, the Jira provider (§3.3), and grew from 1416 to 1428 lines. Drift & Coherence closed its content hand-off from its side (run 7). The coupling stays here.
- **`hub:recommendation-look-first.js` · unchanged.** 1 in, 0 cross; 184 → 180 lines.
- **`hub:cost-read.js` (N6) · improved.** Cross-area in went 7 → 3. The calls read moved to `cost-read-calls.js` (LIN-4457).
- **`prompt-template-defs.js` reads the trail · carried.** It now reads `run-trail.js` instead of `run-ledger.js`, and went from 1372 to 1114 lines.
- **`wiring: server.js` · watch.** 205 out, 4771 lines. LIN-1249 owns it.

### 3.11 `seam:reports-scripts-out-of-scope` (tool scope) · **Low** · **worse by two**

- The registered Reports scripts make five `lib/` imports, up from four. `stability-measures-blind.mjs` added `lib/run-trail.js` (S8).
- The new `scripts/gen-llms-catalogue.mjs` imports `lib/prompts/stage-catalogue.js` and writes the catalogue section of `public/llms.txt`. A unit test checks that output byte for byte. The script matches no registry pattern, so it has no area, and its notes are unowned.
- Overall, 54 non-test `scripts/` files import `lib/` and 4 are registered. The tool sees none of these edges. This goes to the closing comment and to P-T1, not to a note. The script has no area file, and the README keeps the registry free of `scripts/` patterns on purpose.

### 3.12 `map:should-mock-ai` (a test predicate filed under LLM) · **Low** · **new**

- **What.** `lib/should-mock-ai.js` holds `shouldMockAi`, the AI mock gate, and `isHermeticTestToken`, the hermetic `test-token` check, added by LIN-4361 and made the one helper for the inline checks by LIN-4450 (`2bf788b6d`) in this window. The `should-mock-ai` name in LLM's pattern files both under LLM. Its cross-area importers went 11 → 17. The window's new ones (`routes/proxy-compute.js`, `workspace-api-audit`, `-issue-read`, `-issue-write`, `-prompts`, `-steps`) import `isHermeticTestToken`. That one change accounts for most of **Web → LLM 87 → 92** (5 of 6 added edges), and for one of Agent API → LLM's two.
- **Experiment G** (the file to Platform): no pair moves. 17 cross-area edges leave LLM: Web → LLM 92 → 80, Runs → LLM 61 → 58, Agent API → LLM 48 → 47, Wiring → LLM 23 → 22. Platform stays a leaf, because the file imports nothing.
- **Reading.** This is a map item, not a code tangle. The test-token check is plumbing. Proposed as P-MK1 (§7). No note entry: the guide is not a builder's to change, and `agent-api.md` already carries the inline-check entry this helper belongs to (§9).

### 3.13 Ticket-owned items, carried (report only)

- **LIN-4155** (Backlog): `applyDefaultDispatchHarness` out of `proxy-preamble.js` (§3.1b).
- **LIN-3738** (Backlog): `proxy-preamble.js` out of Agent API (F4).
- **LIN-3923** (Backlog): LLM ⇄ Providers (F3). Its title's "11/4" is stale at both commits.
- **LIN-4154** (Backlog): settled in code by LIN-4472 (§3.9).
- **LIN-4318** (Backlog): Periodical mint by id (§3.7).
- **LIN-1249** (Backlog): `server.js` decomposition.
- **LIN-2201** (Backlog): the reap window (§3.0c).
- **LIN-3555, LIN-3736, LIN-3737** (Backlog): re-checked. The four exports they name are where the tickets say: `RefResolutionError` in `lib/proxy-ref-resolver.js`, `stableStringify`/`hashContext` in `lib/recap-cache.js` (with a second `stableStringify` in `lib/run-summary-cache.js`), and `collectIssueAttachments` in `lib/proxy-wire.js`. Unchanged.
- **LIN-4193** (Backlog): the cost modules. `cost-read-calls.js` got its home in Runs with LIN-4457, beside `cost-read.js`. `weekly-budget.js` is unchanged.

### 3.14 Stale `lib/task-cost.js` references · **Low** · **carried, unchanged**

- `lib/model-routing-spend.js:5`, `lib/wall-clock-summary.js:102`, `tests/unit/task-cost.test.js:2`, `tests/unit/lin-2253-instructions-cost-gate-prose.test.js` and `tests/unit/runner-kit-helper.test.js:20` still name it. These are comments and titles, so they go to the closing comment only.

### 3.15 Map hygiene · **Low** · **carried**

- `map:wake-credential`: `lib/wake-credential.js` still maps to Runs. Auth's pattern still names it, and that name is dead (first match wins). Closing comment only.
- `map hygiene: workspace- prefix (Auth)`: drives N3, carried.

## 4. Ways in and rebuild readiness

Per area at the head: files, internal imports, cross-area in and out, and entry files (files other areas import). The baseline is in brackets where it moved (S12).

| area | files | internal | cross in | cross out | entry | rebuild readiness and what stops it |
|---|---|---|---|---|---|---|
| Runs & dispatch | 120 [115] | 226 [207] | 269 [261] | 189 [181] | 102 [98] | Not ready to move: F1 and F4. Its doors got clearer: `run-trail.js` is the trail reader for every caller, and `run-live-wait.js` holds its own guard. Its entry files went 98 → 102. |
| LLM & prompts | 94 [91] | 113 [100] | 280 [265] | 88 [86] | 78 [76] | Not ready: F1's other side. The stage-kind record is a clear new way in (8 importers). Inbound cross-area grew by 15, of which 6 are `should-mock-ai.js` (§3.12) and 3 are `stage-kinds.js`. |
| Platform & plumbing | 25 | 3 [2] | 286 [285] | 0 | 23 | Ready as a leaf. |
| Front end: server-rendered pages | 94 [93] | 299 [296] | 111 [105] | 176 [175] | 57 | Ready within its area. It now owns two served leaves read from five areas, including the browser (§3.6). Knots: Auth 14/11, Runs 16/8, Other 3/8, and Pages ⇄ LLM 37/1 (guide-opened). |
| Web routes | 38 | 31 | 22 | 410 [402] | 22 | Ready as a routing layer. |
| Auth, accounts & workspaces | 64 | 115 | 188 | 38 | 57 | Ready as a seam. N3 (5/3) unchanged. |
| Providers | 38 [37] | 42 [40] | 130 | 16 [14] | 32 | Ready except F3. Providers → LLM went 4 → 6, one edge of it into the Periodical engine (§3.3). |
| Agent API (proxy) | 33 [32] | 48 [45] | 34 | 178 [169] | 13 | Ready once F4 (LIN-3738), LIN-4155 and now the allowance table's home (§3.2b) are settled. The limiter ↔ cap seam is pinned now (§3.0). |
| Other features (catch-all) | 16 | 6 | 33 [27] | 26 | 15 | Not a unit of rebuild. Inbound grew by six, all into `stage-writes.js`. |
| Reports & operator tools | 8 | 3 | 8 | 35 | 6 | Ready; small. Its scripts are outside the import tool (§3.11). |
| Task model | 2 | 1 | 9 | 3 | 2 | Ready; a healthy leaf. |
| Front end: browser code | 44 | 0 | 0 | 6 [0] | 0 | It is now an importer: 5 module pages, 6 edges to served leaves. Rebuild still needs F6's 67 global writes retired. The browser note's Lessons give the order (page modules top down, the bridge only shrinks). |
| Wiring (server.js) | 1 | 0 | 0 | 205 | 0 | The composition root. Ready only after LIN-1249. |

## 5. The seams the import graph does not show

- **The runner contract and its fold corpus (two repos).** Pinned on both sides; the limiter ↔ cap match is now pinned too (§3.0).
- **The reap window (two repos).** Not pinned; LIN-2201 (§3.0c).
- **The scripts' imports from `lib/`.** 54 files, 4 registered (§3.11).
- **The served leaves' second runtime.** The import graph shows `public/` → `lib/` edges. It does not show that the same file then runs in two runtimes, with the leaf rule as its contract. Tests hold that contract (§3.6).
- **Shared ticket ids** are mentions, not code coupling. Not re-measured.

## 6. Change coupling beside import coupling

**LinearViewer, 60 days** (`cochange.mjs --days 60`, HEAD registry for both commits; E/`cochange-code-*`, S9).

| | baseline `e2d4659c4` | head `fb358dbda` |
|---|---|---|
| changes | 914 | 945 |
| touching 2+ areas | 399 | 420 |
| pairs | 76 | 76 |
| unmapped files | 8855 | 9015 |
| shallow | false | false |

Under run 12's own registry, the baseline reads 914 / 399 / 76 / 8855, as published. Seven pairs differ by 1, and that is the guide-only effect (§1.1).

**Window reconciliation (S10).** The two windows share 913 commits. One baseline commit dropped out and 32 head commits entered (E/`cochange-window-commits-H-only.txt`). Every pair checked reconciles exactly: Agent API ⇄ Runs 124 + 11 = 135, LLM ⇄ Runs 112 + 10 = 122, Agent API ⇄ LLM 81 + 10 = 91, Browser ⇄ Pages 128 + 5 = 133, Runs ⇄ Web 117 + 7 = 124, Other ⇄ Runs 41 + 4 = 45, Agent API ⇄ Other 21 + 3 = 24. This time the moves are the window's own work, not the slide: almost nothing left the window.

**The top pairs at the head:** Agent API ⇄ Runs 135 (link); Browser ⇄ Pages 133 (**link, new**); Runs ⇄ Web 124; LLM ⇄ Runs 122 (F1); Pages ⇄ Runs 100; Pages ⇄ Web 100; Browser ⇄ Web 94 (no link); Agent API ⇄ LLM 91; Browser ⇄ Runs 91 (no link); Web ⇄ Wiring 91.

Read beside the knots, the three pairs that grew most (Agent API ⇄ Runs +11, LLM ⇄ Runs +10, Agent API ⇄ LLM +10) are the three corners of the LIN-4448 consolidation: stage records, write gate and trail pass. Each corner is linked by imports in both directions, and each is a knot (F4, F1, `agent-api<->llm`). The co-change confirms that those knots are where merges queue.

**Pairs with no import link: 19 → 18.** Browser ⇄ Pages gained its first link (§3.6). Eleven browser pairs remain (F6), led by Browser ⇄ Web 94 and Browser ⇄ Runs 91. Of the seven non-browser no-link pairs, one moved: Agent API ⇄ Reports 14 → 15. The other six (Other ⇄ Reports 7, Agent API ⇄ Task, Auth ⇄ Task, Providers ⇄ Reports, Task ⇄ Web 2 each, Task ⇄ Wiring 1) did not move.

**Candidate seams from change coupling: none new.** Agent API ⇄ Reports (15) is the largest non-browser no-link pair. Of its 15 changes, 14 touch Reports' `lib/` files (`kpi-stats.js` ×8, `account-erasure.js` ×4, `workspace-kpi-stats.js` ×3) beside proxy files, in cost and token work. The one added in the window is LIN-4458, which touched `scripts/stability-measures-blind.mjs` (a script the import tool does not read, §3.11). It is the same pair run 12 carried, one change larger.

**simple-dispatcher, 60 days** (E/`cochange-sd-*`): 100 / 46 / 15 / 240 at `af9b496`, and 102 / 46 / 15 / 241 at `7d5fe7d`. The pairs are the same 15. Loop ⇄ Test harnesses (13) is still the one co-change pair with no `require` link, the `e2e-*.js` process boundary.

## 7. Guide proposals (labelled; nothing edited)

These are recorded apart from code movement. None is applied. No test, check or count is added to enforce the guide.

- **P-SW1: give `lib/stage-writes.js` a home, new (§3.2b).** Experiment E (Agent API) or F (LLM). Either closes LLM ⇄ Other and takes Agent API ⇄ Other to 1/1. E costs Runs → Agent API +2 and LLM → Agent API +1. F costs Agent API → LLM +5 and Runs → LLM +2. With P10a (experiment J), both catch-all pairs close (14 → 12 pairs). This is an owner's decision about whose the allowance is.
- **P-MK1: file `lib/should-mock-ai.js` under Platform & plumbing, new (§3.12).** Experiment G: no pair moves, and 17 cross-area edges stop pointing into LLM. It also makes Web → LLM read as prompt and AI use again.
- **P10a: `as-asked-seal.js` → LLM, carried, re-measured.** It still closes Agent API ⇄ Other (experiment I). At HEAD it costs LLM → Agent API +1 (the seal's `proxy-graphql-errors` import), on the side LIN-4155 shrinks. It still needs `tests/unit/area-map-placement.test.js` changed. Owner's decision.
- **Experiment H: the served leaves to Platform, recorded, not proposed.** It closes the guide-opened Pages ⇄ LLM. It reverses LIN-4471's deliberate front-end owner pin (`tests/unit/served-leaf-owners.test.js`), whose reason (the leaves read the browser note's rules) still holds.
- **P-SD1 `shutdown.js` placement (simple-dispatcher), carried.** Unchanged: State ⇄ Stop hook 10/1, State ⇄ Reapers 14/1.
- **P-LLM1 split the LLM catch-all, carried** with run 12's negative evidence. Not an F1 fix.
- **P-LW1, done** (LIN-4459, §3.10). Retired.
- **P-XN1 a cross-area and cross-repo notes home, carried.** This run's two cross-area entries (§3.2b, §3.3) are filed under the area where a change would start, with the other side named. The reap window shows the gap from the other side: simple-dispatcher's note carries it, Harbour's notes do not, and a ticket owns it.
- **P-T1 `seams.mjs` CommonJS and scope, carried and extended.** Add the `require` reader (E/`require-graph.mjs`), and either bring `scripts/` into scope or name the 54 `lib/`-importing scripts as out of scope in the output. Separately, the README's "classic scripts with no import statements" line needs correcting (§3.6). The tool is not edited here.
- **P-REV1 review cadence and compaction, carried.** `docs/reviews/` now has 177 entries.
- **P-AN1 `lib/prompts/area-note-format.js` placement, carried, changed.** It now has one in-scope importer in Runs (`dispatch-leftover-answer.js`, for `isCitedPath`), plus `scripts/stability-measures.mjs`. Filing it under Reports would make that edge Runs → Reports, which would open a new direction. Recorded as weaker than in run 12.

## 8. Existing tickets and carried items

Re-read at HEAD, 14 Nov:

| ticket | state | relation |
|---|---|---|
| LIN-4155 | Backlog | `applyDefaultDispatchHarness` (§3.1b) |
| LIN-3738 | Backlog | `proxy-preamble.js` out of Agent API (F4) |
| LIN-3923 | Backlog | LLM ⇄ Providers (F3); title figure stale |
| LIN-4154 | Backlog | settled in code by LIN-4472 (§3.9); not edited |
| LIN-4318 | Backlog | Periodical mint by id (§3.7) |
| LIN-1249 | Backlog | `server.js` decomposition |
| LIN-2201 | Backlog | reap window (§3.0c) |
| LIN-4193 | Backlog | cost modules into an area (§3.13) |
| LIN-3555, LIN-3736, LIN-3737 | Backlog | "Seams:" tickets; unchanged |
| LIN-4448 | In Progress | the LLM consolidation whose pieces are this window |
| LIN-4447 | Done | the Runs consolidation |
| LIN-4444 | Done | run 12 |

Findings already filed as tickets stay in this report only.

## 9. Notes and follow-ups

**Where the note pass looked.** It started from the files changed between `e2d4659c4` and HEAD, mapped through the registry. Then it took every Waiting entry citing a file changed since run 11's commit, which covers run 12's §12 limit. A fresh-context sub-agent checked each entry of `runs-and-dispatch.md`, `other-features.md`, `front-end-pages.md`, `web-routes.md`, `agent-api.md` and `platform-and-plumbing.md` (65 entries) against HEAD, and I checked every non-true verdict myself before editing. `llm-and-prompts.md`, `providers.md` and `front-end-browser.md` were read in full for this report's findings.

**Added (two entries).**
- `docs/areas/other-features.md`: `lib/stage-writes.js` as the allowance table three areas read, homeless in the catch-all, with the measured homes (§3.2b, P-SW1). Source: this report.
- `docs/areas/providers.md`: `lib/providers/jira/index.js` imports the Periodical engine for one marker regex (§3.3). The other side is `lib/periodicals.js` (LLM). Source: this report.

**Removed (one entry, settled).**
- `docs/areas/other-features.md`, the `lib/stage-writes.js` header entry (LIN-4467 leftovers). The header already says what the entry asked for (`lib/stage-writes.js` line 2 names the stage-kind records; `stage-intent.js` is not named). The slot now holds the new placement entry.

**Corrected (untrue in one clause; each correction is marked in the note).**
- `other-features.md`, `lib/as-asked-seal.js`: "2/1" → 6/1. The claim that moving the seal closes the pair still holds (experiment I), with five one-way edges left.
- `agent-api.md`, `routes/proxy-compute.js` (error mapping): the handlers share `streamedFailureReply` now (LIN-4460 leftovers) and `failureOf` is gone. The substring matching is the part still waiting.
- `agent-api.md`, `routes/proxy-compute.js` (test-token): "about 16 inline sites … the helper only two modules import" → eleven production modules call `isHermeticTestToken`, and one inline comparison is left (`routes/test.js`). The transport-injection idea still waits.
- `agent-api.md`, `lib/proxy-instructions.js` (catalog `kind` contract): "misses 23" → `DISPATCH_KINDS` has 24 kinds, and `autopilot`, `defer` and `periodical` are neither template keys nor `custom`.
- `agent-api.md`, `routes/proxy-model-routing.js`: since LIN-4468, reading stages get a 403 on the routing writes (`requireWriteScope('modelRouting')`). The risk now applies to unstamped and `work`-stamped readWrite keys.
- `runs-and-dispatch.md`, `lib/run-live-wait.js` (two homes): `'aborted'` is in `LINEAGE_TERMINAL_STATUSES` (`lib/dispatch-lineage-status.js`), not in `recent-runs.js`, and look-first imports only `WAITING_ON_A_PERSON`.
- `runs-and-dispatch.md`, `lib/run-view.js`: `STAGE_LABELS` is defined in `lib/run-view.js`, built from the records' `label`. It is not in `stage-kinds.js`.
- `front-end-pages.md`, `lib/mask-secrets-in-html.js`: "providers has no note" → the Providers note exists and has no mask entry.

**Re-verified, no edit.**
- `web-routes.md`, `routes/dashboard-rulings.js`: both surfaces now call one reduction (`collectUnansweredDecisions` is `reduceUnansweredDecisions(...).rows`; `readRulingStanding` reaches the same function; LIN-4024). Their inputs still differ (the loop set, enrichment, suggestions). Whether that leaves the entry's "counted differently" concern open is the area's call, so it is left for the next change in that file rather than pruned here.
- `runs-and-dispatch.md`: the `run-trail.js` row-15 limit, the live-wait race, `fmtWhen` and the other 17 entries are true. The landing and no-halt entries that runs 11 and 12 filed were already pruned by LIN-4458 and LIN-4475. That was right.
- `agent-api.md`: the limiter ↔ cap entry was removed on LIN-4468's branch, and it is now pinned by test (§3.0). That was right.
- `llm-and-prompts.md`: LIN-4470 settled the `recommendation-input.js` five-builders entry that run 12 re-verified (one prompt context, `lib/prompts/prompt-context.js`), and moved the live-wait entry to Runs. Both are right.
- `platform-and-plumbing.md`: all entries true, including `lib/vendor-assets.js` (`SHARED_MODULES`).
- Could not be verified without a render, a live run or a mutation run (left as written): the Settings control counts, the Jira picker overflow and the run-chat link timing (`front-end-pages.md`), and the task-share "0 of 84" (`web-routes.md`).

**Not an entry, on purpose.**
- F1's kind (§3.1), Browser → Pages (§3.6), the hubs (§3.10) and the guide-opened Pages ⇄ LLM (§1.1): watches and map effects, which bind no builder.
- `map:should-mock-ai` (§3.12): a guide proposal (P-MK1). The helper's own entry is in `agent-api.md`.
- Resolved rows (§3.0a, §3.0b, the live-stage wait) need no entry.
- Ticket-owned items (§3.13, including LIN-2201's reap window) stay in this report only.
- The scripts' scope gap (§3.11) and the stale `scripts/code-shape/README.md` line (§3.6): no area file to cite. Closing comment.

**Closing comment (to the person) carries:**
- the larger tidies P-SW1 (the allowance table's home) and P-MK1 (`should-mock-ai.js` to Platform);
- the findings with no area file to cite: the stale code-shape README line, the scripts' scope gap with the unregistered `scripts/gen-llms-catalogue.mjs`, `map:wake-credential`, the stale `lib/task-cost.js` comments, and P-XN1;
- LIN-4154's settlement in code (the ticket is open; this run does not edit it).

**No ticket is minted.** No find here breaks something, blocks work, or touches safety (`CONSEQUENCE_TEST`).

## 10. Trend ledger

Stable names are the ledger's own. Severity is this run's. "Δ run 12" is measured against `e2d4659c4` under the HEAD registry. Guide-only figures are in §1.1.

| name | severity | run 12 (`e2d4659c4`) | run 13 (`fb358dbda`) | Δ run 12 |
|---|---|---|---|---|
| `seam:landing-reader-agent-note` | — (was High) | split reproduced | one classifier; repro agrees | **resolved** (LIN-4458; §3.0a) |
| `seam:runner-contract` (two repos) | Low (was Medium) | sha `602ab014…`; limiter↔cap by comment | sha `871ca615…` both; 86 rows; fold corpus byte-identical and pinned; limiter↔cap pinned by test | **improved** (§3.0) |
| `seam:leftover-resume-contract` (two repos) | — (was Low) | no halt-free follow-up row | row present, claimed both sides | **resolved** (LIN-4475; §3.0b) |
| `seam:reap-window` (two repos) | Low, owned (LIN-2201) | not in ledger | 7-day copy, unpinned | **added** (not new in code; §3.0c) |
| F1 `knot:agents-chat<->runs` | High | 38/55 | **41/61** | **worse in count, better in kind** (§3.1) |
| `knot:agent-api<->llm` | Medium | 46/4 | **48/4** | worse by two (§3.1b) |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 48/10 | **50/10** | worse by two (§3.2) |
| `hub:stage-writes.js` | Medium, new | 2 importers (2 cross); 40 lines | **8 (8 cross)**; 146 lines | **new** (§3.2b) |
| F3 `knot:providers->upward` | Medium | 15/4 | **14/6** | LLM side better by one; Providers side worse by two (§3.3) |
| N1 `knot:other-features-catch-all` | Medium | 18 (16 under HEAD registry) | 16 | guide −2; code unchanged (§3.4) |
| `knot:agent-api<->other-features` | Medium | 2/1 | **6/1** | **worse** (§3.5) |
| F6 `knot:browser-window-globals` | Medium | 67; 0 module pages | 67; 5 module pages | unchanged count (§3.6) |
| Browser → Pages (served leaves) | Low | 0 | **6** | **new edges, right direction** (§3.6) |
| Pages ⇄ LLM | Low (map) | not a pair under run 12's registry | 37/1 | **opened by the guide alone** (§1.1) |
| `seam:periodical-mint` | Medium, owned (LIN-4318) | unchanged | unchanged | unchanged (§3.7) |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 5/3 | 5/3 | unchanged (§3.8) |
| Pages ⇄ Runs | Low, watch | 15/8 | **16/8** | +1, right direction; Runs → Pages now a leaf (§3.9) |
| Pages → Other | Low, watch | 10 (3 under HEAD registry) | 3 | guide −7; code unchanged (§1.1) |
| `seam:live-stage-wait` | — (was Low–Medium) | Runs refusal in LLM | `run-live-wait.js` in Runs, a leaf | **resolved in placement** (P-LW1; §3.10) |
| `hub:run-trail.js` | watch, new | — | 11 in (8 cross) | **new door** (§3.10) |
| `hub:run-ledger.js` | watch | 11 in (7 cross); 728 lines | 8 in (4 cross); 489 lines | **improved** (§3.10) |
| `hub:openrouter.js` | watch | out 13 | out 12 (cross 3) | watch (§3.10) |
| `hub:recommendation-look-first.js` | watch | 1 in; 184 lines | 1 in; 180 lines | unchanged |
| `hub:periodicals.js` | Low–Medium, watch | 9 in; 1416 lines | 10 in; 1428 lines | watch; new provider importer (§3.3) |
| `hub:workspace-preferences.js` | watch | 16 in | 16 in | unchanged |
| `hub:dispatch-factory.js` | watch | out 18 (14 cross) | unchanged | unchanged |
| `hub:dispatch-store.js` | Low–Medium | 7 in (6 cross); 4530 lines | 5 in (5 cross); 4571 lines | in-degree −2 |
| N2 `hub:task-page-loader.js` | Medium | 9 in (8 cross); out 22 | unchanged; renderer import → leaf | kind better (§3.9) |
| N4 `hub:run-controls.js` | watch | 21 in | unchanged | unchanged |
| N6 `hub:cost-read.js` | watch | 12 in (7 cross) | 8 in (3 cross) | **improved** (§3.10) |
| `hub:tree.js` | watch | 8 in | unchanged | unchanged |
| `door:as-asked` | healthy | 25 in (12 cross) | 24 in (12 cross) | healthy |
| `map:should-mock-ai` | Low, new | 11 cross in | 17 cross in | **new** (§3.12) |
| `wiring: server.js` | Low, watch | 205 out; 4769 lines | 205 out; 4771 lines | watch |
| `seam:reports-scripts-out-of-scope` | Low | 4 `lib/` imports unread | 5, plus unregistered `gen-llms-catalogue.mjs` | **worse** (§3.11) |
| `tool:code-shape-readme-public` | Low, new | true | line 10 stale | **new** (§3.6) |
| stale `lib/task-cost.js` references | Low | comments and titles | same | carried (§3.14) |
| `map:wake-credential` | Low | shadowed name | shadowed name | carried (§3.15) |
| `map hygiene: workspace- prefix (Auth)` | Low | drives N3 | drives N3 | carried (§3.15) |
| `prompt-template-defs.js` reads the trail | Low, watch | `run-ledger.js` | `run-trail.js` | carried, door now single (§3.10) |
| `lib/prompts/area-note-format.js` placement (P-AN1) | Low | Reports-only importer | +1 Runs importer | changed (§7) |
| LIN-4154 (`fmtDuration`) | owned | renderer import | leaf import | **settled in code; ticket open** (§3.9) |
| `seam:as-asked`, `seam:leftover-step`, `seam:autopilot-precedence`, LIN-4358 catalog cluster | healthy | as run 12 | as run 12 | unchanged |
| simple-dispatcher require graph | baseline | 52 files; 157 edges; 20 links; 6 pairs | identical | **unchanged** (§0) |
| simple-dispatcher `shutdown.js` placement (P-SD1) | guide finding | 2 pairs from one file | unchanged | carried |
| simple-dispatcher Loop ⇄ Test harnesses | baseline | 13, no require link | 13, no require link | carried (§6) |
| simple-dispatcher co-change total | baseline | 100 / 46 / 15 | 102 / 46 / 15 | window (§6) |

**All fourteen reciprocal knot pairs** (run 12 as published | run 12 commit under the HEAD registry | head; S3):

| pair (a → b / b → a) | run 12 published | run 12, HEAD registry | run 13 | ledger |
|---|---|---|---|---|
| Agent API ⇄ LLM & prompts | 46/4 | 46/4 | 48/4 | §3.1b |
| Agent API ⇄ Other features | 2/1 | 2/1 | **6/1** | §3.5 |
| Agent API ⇄ Providers | 21/3 | 21/3 | 21/3 | unchanged |
| Agent API ⇄ Runs & dispatch | 48/10 | 48/10 | 50/10 | F4 (§3.2) |
| Auth ⇄ Front end: pages | 14/11 | 14/11 | 14/11 | unchanged |
| Auth ⇄ LLM & prompts | 5/3 | 5/3 | 5/3 | N3 |
| Auth ⇄ Providers | 13/1 | 13/1 | 13/1 | unchanged |
| Front end: pages ⇄ LLM & prompts | — | 37/1 | 37/1 | guide-opened (§1.1) |
| Front end: pages ⇄ Other features | 10/8 | 3/8 | 3/8 | guide (§1.1) |
| Front end: pages ⇄ Runs & dispatch | 15/8 | 15/8 | 16/8 | §3.9 |
| LLM & prompts ⇄ Other features | 2/2 | 1/2 | 1/2 | §3.2b |
| LLM & prompts ⇄ Providers | 15/4 | 15/4 | 14/6 | F3 (§3.3) |
| LLM & prompts ⇄ Runs & dispatch | 38/55 | 38/55 | 41/61 | F1 (§3.1) |
| Other features ⇄ Runs & dispatch | 6/6 | 6/5 | 6/7 | §3.2b |

## 11. Sibling hand-offs and overlaps

- **Drift & Coherence run 7** (`drift-coherence-review-2026-11-13.md`, LIN-4443): it closed `hub:periodicals.js` from its side and kept "coupling structure stays with Seams". This run keeps the coupling: one new importer (§3.3). It named the live-wait race and the cited-path predicate. The race is now a Runs Waiting entry, still true. The predicate became one (`isCitedPath`, LIN-4470), which is why Runs now imports `area-note-format.js` (§2.4). Not re-flagged. The file-level direction in §3.1 (`item-stage-stamp.js` → the template registry) is its altitude and is listed only as evidence.
- **The paired area-read series** (`docs/plans/survey/area-read.md`, `area-read-method-as-run.md`, `area-read-reports/`; LIN-4453, LIN-4462, LIN-4464): fresh readers score one area's readability on a hashed sample, against a control area. It does not read coupling between areas, so the two series do not double-flag. One surface sits between them and neither owns it. The kit's control, Pages, imports the work areas (it tracks four such files by blob only), and this window's guide edit added two files to Pages, the served leaves (§1.1). Whether the control's universe moved under the kit's frozen registry blob is the kit's question to answer.
- **Stability run 6**: its area-coupling hand-off points here. Covered by §6. Per-file churn stays with Stability.
- **Onboarding** (R4-9, the runner setup page's cross-repo seam): carried in `front-end-pages.md`, not re-flagged.
- **Test Coverage Gap** (2026-11-11): no new hand-off.
- **Code Quality**: size of `dispatch-store.js` (4571), `task-page-loader.js` (1557), `routes/proxy-compute.js` (1584) and `public/observation.js` stays theirs.
- No sibling report landed after this task was minted (HEAD equals the mint commit).

## 12. Measurement notes

- **Mint-time leads checked.** 14 pairs at both commits: confirmed, and the guide alone opened Pages ⇄ LLM. F1 41/61, Agent API → Other 6, Agent API ⇄ LLM 48/4, Agent API → Runs 50, Providers → LLM 6, LLM → Providers 14, Runs → Other 7, Runs → Providers 11, Pages → Runs 16, Web → LLM 92 and Browser → Pages 6: all confirmed. Files went 566 → 577, unresolved imports are 4 at both commits, and parse failures, non-literal imports and unmapped files are all 0: confirmed. The cycle group is the same nine areas: confirmed.
- **The landing reproduction** needed one change to run 12's script: `landingPrUrls` is imported from `lib/run-trail.js`, because LIN-4458 moved it with no re-export. Nothing else changed.
- **The experiment script** wraps each area's whole pattern in the negative lookahead. A first version prefixed only the first alternative, and so failed to exclude `should-mock-ai.js` from LLM's second alternative. Its assertion caught that before any figure was taken.
- **Leaf counting** in E/`f1-edge-kinds.txt` treats a file as a leaf only when it imports nothing in scope. Word modules that import other word modules (`leftover-words.js` imports `area-note-format.js`) therefore count as non-leaf there. The prose in §3.1 classifies edges by what they import, and E/ lists every edge.
- **Scope of re-verification.** See §9 for the notes and entries re-read.

## Adversarial Second-Read

(Filled after the second read.)
