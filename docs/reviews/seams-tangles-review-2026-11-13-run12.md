# Seams & Tangles Review — 2026-11-13, run 12 (delta vs run 11)

Task: LIN-4444 · Parent: LIN-4344 · Previous: `seams-tangles-review-2026-11-10-run11.md` (run 11, LIN-4402, PR #2384, merge `3b1b57b15`) · Tools: `scripts/code-shape/seams.mjs` and `cochange.mjs`, HEAD versions (both unchanged in the window) · Evidence: `docs/reviews/_evidence-2026-11-13-run12/` (see its `README.md`). "E/" below means that folder.

Review-only. This PR changes this report, E/, one Waiting entry added in `docs/areas/llm-and-prompts.md` (the live-stage wait, §3.10) and one Waiting entry extended in `docs/areas/runs-and-dispatch.md` (the `landingPrUrls` entry, §3.0a). No entry is removed. No code, config, guide (`docs/areas/areas.json`), tool or other doc was edited. simple-dispatcher was read, not edited, and has no edit or PR from this run.

## Headline

- **Ranked first: a landing-reader split on agent notes (High, new, reproduced; §3.0a).** The second read raised it, and I reproduced it. After an approved review, an agent note (first line `autopilot:`) that cites a *new* PR adds that PR to the blind read's landing (`landingPrUrls` does not drop agent notes) while not counting as work after review (`isLandingEvidence` drops them), so a blind read is offered over a PR no review covered; the same note as a plain comment sends the ticket back to review. The comment in `lib/recommendation-facts.js` says the two readers agree. It is the only in-window finding that changes a recommendation output. Frequency in production is not measured.
- **Structure is unchanged in kind.** The same 13 reciprocal pairs, the same nine-area cycle, no pair opened or closed. Six directed counts moved, all in pairs already among the thirteen: F1, Agent API ⇄ LLM, F4, Pages → Runs, Pages → Other, and F3 (LLM → Providers).
- **F1 `knot:agents-chat<->runs` (LLM & prompts ⇄ Runs & dispatch), High: 32/50 → 38/55.** The Runs → LLM side is mostly vocabulary: five of the six added edges import `prompts/*-words.js` or `leftover-words.js`. The LLM → Runs side gained six edges, all reading run state, all in the recommendation layer. Run 11 said look-first was the first LLM module to read run state. That was wrong: at run 11's commit `openrouter`, `recommendation-input`, `recommendation-facts` and `chat-tools` already did (§3.1). So the kind is not new; the count moved, and one of the new reads sits on a Runs dispatch refusal (`recommendation-live-wait`).
- **Agent API ⇄ LLM: 43/4 → 46/4 (Medium).** The three new Agent API → LLM edges are two vocabulary imports and one import of the live-wait refusal code. The reverse four edges are unchanged; `applyDefaultDispatchHarness` remains the routing-policy import, owned by LIN-4155.
- **F4 Agent API → Runs: 44 → 48 (Medium).** Six edges added, two removed. Cost reads now enter through `lib/task-cost-read.js` from the routes (`routes/proxy-compute.js`, `routes/proxy.js`), which is the right direction.
- **F3 LLM → Providers: 14 → 15 (Medium), Providers → LLM 4.** The ticket research said "unchanged at 15/4"; the rerun says the head is 15/4 and the baseline was 14/4, so the trend is worse by one edge (§3.3).
- **Pages → Runs 13 → 15; Pages → Other 9 → 10 (Low, watch).** The new timeline renderer depends on run logic, which is the right direction; no run module imports a timeline renderer. It does depend on `lib/cost-format.js`, a catch-all file (§3.9).
- **N1 catch-all: 18 → 18, the same 18 files.** All ten new production files are matched by a registry pattern; none fell through (§2.3).
- **Guide edits are recorded apart from code movement.** The guide's own change moves no import figure. It moves fourteen co-change pairs by 1–4 (the removed `task-cost` alias and the new task-cost, timeline and session-roles files). Under the same registry, the import graph reads the same at both commits.
- **Co-change, 60 days, same registry: 942/418/76 → 914/399/76.** The fall in browser ⇄ pages (138 → 128) is the window sliding, not a change in coupling: twelve commits left the window and two entered, and the arithmetic reconciles exactly (§6). LLM ⇄ Runs rose 108 → 112 and Agent API ⇄ Runs 122 → 124. The same 19 pairs lack an import link, and none of the seven non-browser ones moved. No candidate seam is new.
- **New watches:** `lib/recommendation-live-wait.js` (a Runs refusal placed in LLM, §3.10); `lib/run-ledger.js` (cross-area importers 2 → 7, §3.10); `lib/openrouter.js` (outbound 11 → 13, now reaching run state through the recommendation modules, §3.10).
- **New tool blind spot, Low:** the seven registered Reports scripts are outside `seams.mjs`'s scope, and four of their imports reach into `lib/` (§0, §3.11).
- **simple-dispatcher: unchanged.** Its scratch reader gives 52 files, 20 directed links, 6 reciprocal pairs at both commits, with identical edges. Its three commits touch its own notes and test file. The runner contract hash is `602ab014…` at both LinearViewer commits and both simple-dispatcher commits. The 60-second limiter window and the 60-second broker wait cap still match by comment only, and the leftover no-halt contract row is still absent.
- **Notes.** One Waiting entry added (`llm-and-prompts.md`: live-stage wait placement); one extended (`runs-and-dispatch.md`: the `landingPrUrls` entry, §3.0a); no entry removed (the `llm-and-prompts.md` `recommendation-input` five-builders entry was re-verified and stays, §9); the run 11 `agent-api` entry on `applyDefaultDispatchHarness` was removed by LIN-4418 as a double home of LIN-4155 and stays out. The carried `agent-api` limiter entry, the `runs-and-dispatch` no-halt entry and the `recommendation-input` entry are re-verified (§9).
- **Experiments.** Three labelled registry experiments reproduce the ticket's figures and are all negative: moving the sequence modules gives F1 35/59; isolating the words gives 38/49; a new sequence area gives 29/53 with three new reciprocal pairs. None is proposed as the F1 fix (§3.1, §7).
- **Adversarial second read:** Tier 2, a fresh-context sub-agent (§Adversarial Second-Read).

## 0. What was measured

**Commits.**

| repo | commit | role |
|---|---|---|
| LinearViewer | `e2d4659c4bf07ed266735f718e85232e5f2a6458` | run 12 head (origin/main, read 13 Nov 2026) |
| LinearViewer | `b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754` | run 11's measured commit (baseline) |
| simple-dispatcher | `af9b496d57f042972b912a30eb8c4d1164bbab77` | head (origin/main) |
| simple-dispatcher | `5d8489e7fd8434f0e69af7df11a3746790abbe64` | run 11's head (baseline) |

The window is `b315e0e8f..e2d4659c4`: 35 first-parent commits, 67 files under `lib/`, `routes/`, `public/` and `server.js` (+3201 / −841; 10 added, 57 modified).

**Registries.** One registry for every LinearViewer head and baseline measurement: `docs/areas/areas.json` at the head (E/`areas.head-registry.json`). The guide-only check is separate (below).

**Guide-only check.** Run `b315e0e8f` with its own run 11 registry (E/`areas.run11-registry-b315e0e8f.json`) against the head registry: `links`, `knots` and `areas` are identical; only `areaMapSource` differs (E/`seams-code-…-guide-run11.json`). The guide's edit moves no import figure. Under co-change it moves 14 pairs by 1–4 (§6).

**Scope and could-not-read counts (LinearViewer).**

| commit | files in scope | parse failures | unresolved relative imports | non-literal dynamic imports | unmapped source files | links | reciprocal pairs | cycle groups |
|---|---|---|---|---|---|---|---|---|
| head `e2d4659c4` | 566 | 0 | 4 (F8) | 0 | 0 | 2180 edges, 1342 cross-area | 13 | 1 (9 areas) |
| baseline `b315e0e8f` | 556 | 0 | 4 (F8) | 0 | 0 | 2135 edges, 1314 cross-area | 13 | 1 (9 areas) |

Co-change: `shallow` false at both; `unmappedFiles` 8855 (head) and 8061 (baseline), docs and evidence, which the code-only registry does not map by design.

**Reports scripts outside the import tool's scope.** The registry names seven scripts under Reports (`scripts/code-shape/retention.mjs`, `retention-core.mjs`, and `scripts/stability-measures*.mjs`). `seams.mjs` reads `server.js`, `lib/`, `routes/` and `public/` only, so these seven are not measured. Four of their imports reach into `lib/`: `stability-measures-blind.mjs` (`lib/run-ledger.js`, `lib/prompts/blind-read-words.js`), `stability-measures-seat.mjs` (`lib/dispatch-terminal.js`) and `stability-measures.mjs` (`lib/prompts/area-note-format.js`) (E/`supplementary-figures-run12.txt` S8). Two of the four are already Lessons in `reports-and-operator-tools.md` (`countWaiting`, `parseBlindRead`), so no note entry is added (§9).

**simple-dispatcher.** `seams.mjs` reads 0 of its 52 root-level CommonJS files: its scope and its `import` reader cannot see `require`. The scratch reader from run 11 (E/`require-graph.mjs`, unchanged) reads all 52, with 0 unmapped, 0 unresolved and 0 non-literal `require`, at both commits. Edges are identical across the window.

**Tools.** `scripts/code-shape/seams.mjs` and `cochange.mjs` are unchanged. The only file under `scripts/code-shape` that changed is `wrappers.test.mjs` (a test). The run 10 edge-dump script reads the same committed objects as run 11 did.

## 1. Changes since run 11 (first), then the window

### 1.1 Guide edits (recorded apart from code movement)

`docs/areas/areas.json` changed in the window, in two places (E/`guide-diff-since-run11.patch`):
- **Runs & dispatch** gained `task-cost-read`, `task-timeline` and `session-roles`, and dropped the bare `task-cost` alternative. The alias named a file that no longer exists (`lib/task-cost.js`). Run 11's N8 row, "the `task-cost` alias", is settled in the guide. Prose and comments still name `lib/task-cost.js` (§3.13).
- **Reports & operator tools** gained `^scripts/stability-measures(-core|-tracker|-blind|-seat)?\.mjs$`.

Guide-only effect, measured in E/`supplementary-figures-run12.txt` S2–S3 and S9:
- Import graph: none. Links, knots and areas are identical with either registry.
- Co-change: fourteen pairs move by 1–4 when the same baseline commit is read under the HEAD registry instead of run 11's. They are the pairs with Runs & dispatch or Other features: Agent API ⇄ Other 17 → 20, Other ⇄ Runs 37 → 41, Pages ⇄ Other 31 → 34, LLM ⇄ Other 16 → 18, Other ⇄ Web 33 → 34, Other ⇄ Wiring 27 → 28, Other ⇄ Reports 5 → 7, Browser ⇄ Other 28 → 30, Agent ⇄ Runs 123 → 122, Runs ⇄ Web 120 → 119, Runs ⇄ Wiring 85 → 84, Pages ⇄ Runs 97 → 96, Browser ⇄ Runs 90 → 89, LLM ⇄ Runs 109 → 108. Published run 11 pair figures are therefore not interchangeable with run 12's under the new guide; the comparison in §6 uses the HEAD registry for both commits.

### 1.2 The window: ten new production files

| file | registry area (by pattern) | what it is (from its header or exports) |
|---|---|---|
| `lib/task-timeline.js` | Runs & dispatch | the session timeline for one task (LIN-4405) |
| `lib/render-task-timeline.js` | Front end: server-rendered pages | the renderer of the timeline |
| `lib/task-cost-read.js` | Runs & dispatch | one task's whole-life cost read, lifted from `/cost` (LIN-4404) |
| `lib/session-roles.js` | Runs & dispatch | session role labels (LIN-4405) |
| `lib/dispatch-leftover-answer.js` | Runs & dispatch | the leftover answer's proxy refusal and its retirement line (LIN-4414) |
| `lib/recommendation-blind-read.js` | LLM & prompts | the blind-read stage's recommendation facts (LIN-4422, LIN-4436–4438) |
| `lib/recommendation-live-wait.js` | LLM & prompts | the live-stage wait and its 409 refusal (LIN-4392) |
| `lib/prompts/area-note-format.js` | LLM & prompts | the area-note format: `NOTES_DIR`, `countWaiting` (notes infrastructure) |
| `lib/prompts/blind-read-words.js` | LLM & prompts | blind-read headings, verdict words and kind |
| `lib/prompts/survey-words.js` | LLM & prompts | survey headings |

All ten match a pattern (no catch-all fall-through). The census of N1 is unchanged (§2.3).

### 1.3 Knots that moved (head vs baseline, same registry)

| pair (a → b / b → a) | run 11 (`b315e0e8f`) | run 12 (`e2d4659c4`) | Δ | finding |
|---|---|---|---|---|
| LLM & prompts → Runs & dispatch / back | 32 / 50 | **38 / 55** | +6 / +5 | F1 (§3.1) |
| Agent API → LLM & prompts / back | 43 / 4 | **46 / 4** | +3 / 0 | §3.1b |
| Agent API → Runs & dispatch / back | 44 / 10 | **48 / 10** | +4 / 0 | F4 (§3.2) |
| LLM & prompts → Providers / back | 14 / 4 | **15 / 4** | +1 / 0 | F3 (§3.3) |
| Pages → Runs & dispatch / back | 13 / 8 | **15 / 8** | +2 / 0 | §3.9 |
| Pages → Other features / back | 9 / 8 | **10 / 8** | +1 / 0 | §3.9 |

Unchanged: Agent API ⇄ Other 2/1; Agent API ⇄ Providers 21/3; Auth ⇄ Pages 14/11; Auth ⇄ LLM 5/3; Auth ⇄ Providers 13/1; LLM ⇄ Other 2/2; Other ⇄ Runs 6/6; Runs → Agent API 10.

## 2. The import graph: direction, hubs, ways in

### 2.1 Direction checks

- `lib/` → `routes/`: 0 edges at both commits.
- Edges into `server.js`: 0 (`server.js` is a composition root; its outbound edges are §3.10).
- Renderers imported from outside Pages/Web/Auth/Reports: the carried ones are `lib/task-page-loader.js` and `lib/task-state.js` importing `render-run-steps.js` for `fmtDuration` (LIN-4154's family), and `routes/live-console.js`, `routes/runner-setup.js` (Runs-registered routes importing their own renderers). None is new (E/S7: 20 such edges at both commits).
- Run logic importing renderers, the class run 11 asked about: no new instance. The one new edge that touches a renderer on the Pages side is `lib/render-task-page.js` → `lib/render-task-timeline.js`, inside Pages; the timeline renderer's own new edges point from the renderer to run logic, which is the right way round, and no run module imports it.
- Platform & plumbing: a leaf at both commits (0 cross-area out).
- Providers → LLM: 4 at both commits. LLM → Providers rose by one.
- Agent API → LLM and Agent API → Runs both carry vocabulary imports (`prompts/*-words.js`, `leftover-words.js`, `dispatch-leftover-answer.js` constants), and proxy writes call Runs' check functions (`checkBlindRead`, `checkLeftoverAnswer`, `landingPrUrls`). The second is a route calling a domain rule, the right direction, and it is the proxy refusal that the leftover answer's Waiting entries describe.

### 2.2 Hubs and doors (in / cross-area in / outbound / cross-area out, baseline → head; lines)

| file | baseline | head | lines | note |
|---|---|---|---|---|
| `lib/run-ledger.js` | 6 / 2 / 0 / 0 | **11 / 7 / 2 / 2** | 433 → 728 | §3.10 |
| `lib/openrouter.js` | 33 / 25 / 11 / 2 | 33 / 25 / **13** / 2 | 2242 → 2254 | §3.10 |
| `lib/recommendation-live-wait.js` | — | **4 / 3 / 1 / 1** | 80 (new) | §3.10 |
| `lib/recommendation-look-first.js` | 3 / 2 / 7 / 3 | **1 / 0 / 8 / 4** | 228 → 184 | in-degree improved |
| `lib/recommendation-blind-read.js` | — | 1 / 0 / 6 / 5 | 79 (new) | §3.10 |
| `lib/periodicals.js` | 8 / 8 / 1 / 0 | 9 / 8 / 1 / 0 | 1353 → 1416 | watch (Drift & Coherence owns content) |
| `lib/task-page-loader.js` | 8 / 7 / 21 / 10 | 9 / 8 / 22 / 10 | 1544 → 1578 | N2, unchanged in kind |
| `lib/cost-read.js` | 11 / 7 / 7 / 2 | 12 / 7 / 7 / 2 | 762 → 854 | N6 watch |
| `lib/recent-runs.js` | 3 / 3 / 3 / 2 | 5 / 5 / 4 / 3 | 127 → 141 | run-state reader for LLM and Web |
| `lib/run-view.js` | 15 / 11 / 5 / 1 | 17 / 12 / 5 / 1 | 561 → 570 | |
| `lib/prompt-template-defs.js` | 2 / 0 / 8 / 2 | 1 / 0 / 11 / 3 | 1271 → 1372 | §3.10 (LLM catalog reads Runs) |
| `lib/proxy-preamble.js` | 11 / 10 / 6 / 4 | 11 / 10 / 6 / 4 | 931 → 950 | F4 owner LIN-3738 |
| `lib/providers/state-map.js` | 29 / 27 / 1 / 0 | 30 / 28 / 1 / 0 | 117 | F3 target |
| `lib/dispatch-factory.js`, `lib/dispatch-store.js`, `lib/workspace-preferences.js`, `lib/run-controls.js`, `lib/tree.js` | unchanged | unchanged | 1408, 4530, 511, 152, 684 | Code Quality owns size |
| `lib/as-asked.js` | 25 / 12 / 1 / 1 | 25 / 12 / 1 / 1 | 350 → 348 | door, healthy |
| `routes/proxy-writes.js` | 1 / 0 / 15 / 12 | 1 / 0 / 17 / 14 | 908 → 976 | |
| `routes/proxy-compute.js` | 1 / 0 / 26 / 25 | 1 / 0 / 25 / 24 | 1682 → 1633 | `/cost` now calls `readTaskCost` |
| `server.js` | 0 / 0 / 204 / 204 | 0 / 0 / **205** / 205 | 4757 → 4769 | LIN-1249 owns decomposition |

Full set in E/`supplementary-figures-run12.txt` S5.

### 2.3 N1: the catch-all

Other features files with a cross-area edge: 18 at both commits, the same 18 (`as-asked-seal`, `cost-format`, `dashboard-refresh`, `home-pipeline`, `home-row-states`, `home-rows`, `home-view`, `key-state-holders`, `key-state`, `live-anchor`, `ruling-settled`, `ruling-standing`, `stage-writes`, `subtree-index`, `task-facts-holder`, `task-state`, `usage-snapshot-intake`, `waiting-section`). The window added no file to the catch-all. Its files are as run 11 described (§3.2b).

### 2.4 Where the import graph's areas and the guide's names differ

- `lib/prompts/*` is LLM & prompts by prefix. `lib/prompts/blind-read-words.js` and `survey-words.js` are vocabulary used by Runs (`run-ledger`, `recent-runs`, `plan-review-round-trips`), so they are Runs' inputs that the registry files under LLM. That is the F1 Runs → LLM vocabulary (§3.1).
- `lib/recommendation-live-wait.js` is LLM by the `^lib/recommendation-` prefix, while its refusal is a Runs dispatch rule (§3.10).
- `lib/prompts/area-note-format.js` is notes infrastructure filed under LLM by prefix, with no in-scope importer; its one importer is a Reports script outside the tool's scope (§7, P-AN1).
- `lib/render-task-timeline.js` is correctly in Pages, though it imports four Runs modules.
- The `workspace-` prefix puts `lib/workspace-*.js` files in Auth. All five Auth → LLM edges leave such files (`workspace-api-mocks.js`, `workspace-change-log.js`, `workspace-preferences.js` ×3), so the prefix drives N3 (§3.8, §3.14).

## 3. Findings, severity-ranked, trend-framed

Ordering: severity first, then the window's movement. Stable names are run 9's, 10's and 11's where the row existed; new names are marked **new**. §3.0a is placed first: it is High and reproduced, and it is the only in-window finding that changes a recommendation.

### 3.0a `seam:landing-reader-agent-note` (`lib/recommendation-facts.js` ⇄ `lib/run-ledger.js`) · **High** · **new (in-window, reproduced)**

- **What.** Two readers decide what counts as landed work on a ticket's trail. `isLandingEvidence` (`lib/recommendation-facts.js:85`) excludes agent notes (`isAgentNote`, line 60: a first line opening `autopilot`, `plan posted`/`plan revised`, or `revision N — addresses plan-review`), blind reads and Survey reports. `landingPrUrls` (`lib/run-ledger.js:555`, new in this window with LIN-4437/4438) excludes blind reads and Survey reports but not agent notes. The recommendation step reads both: `blindReadStep` (`lib/recommendation-blind-read.js:63`) returns nothing when `facts.workAfterReview` is true (that uses `isLandingEvidence`), and its landing comes from `landingPrUrls`.
- **Effect, reproduced** (E/`landing-agent-note-repro.mjs` and `.txt`, run from the repo root with the HEAD modules). After an approved review, with PR 41 cited in an earlier summary, a later comment cites a *new* PR 42:
  - an `autopilot:`-prefixed note (`agentNewPr`): `landingPrUrls` = [41, 42], `workAfterReview: false`, and `blindReadStep` returns `blind-read`, its `why` listing PRs 41 and 42 (42 is covered by no review);
  - the same text as a plain comment (`plainNewPr`): `landingPrUrls` = [41, 42], `workAfterReview: true`, and `blindReadStep` returns no step.
  The defect is that the agent note adds PR 42 to the landing without counting as work after review, so a blind read is offered over a PR no review covered. The same-PR case (a note re-citing PR 41; `autopilotNote` vs `plainNote` in the same file) is not the defect: `landingPrUrls` returns [41] in both and `noNote` gives the same result as `autopilotNote`, because dropping agent notes from `workAfterReview` is designed behaviour (they never count as a reply).
- **The comment says the readers agree.** `recommendation-facts.js` (its `isLandingEvidence` comment, lines 82–84) says every reader of the predicate "agrees, and agrees with lib/run-ledger.js landingPrUrls, which skips the same two". The two it names are excluded in both. The agent-note exclusion is not mirrored, and the comment does not say so.
- **Not pinned.** `tests/unit/lin-4438-blind-read-gate.test.js` pins rows 14 and 15 (an audit re-citing a landing PR; a foreign PR before the first review). `docs/areas/runs-and-dispatch.md` carries those two as Waiting. No row covers an agent note.
- **Where it sits in time.** The agent-note exclusion in `isLandingEvidence` predates the window. `landingPrUrls` does not exist at the baseline (it arrived with LIN-4437/4438), so the disagreement is in-window.
- **Severity High, with a caveat.** The step gates whether close-out waits on a blind read, so a wrong offer changes the path a ticket takes. Production frequency is not measured. The code's own comment names autopilot step records as agent notes, so the opener is not hypothetical. If production trails never open that way, this drops to a documented Waiting-level skew.
- **Intent is open.** Either `landingPrUrls` should drop agent notes as well, or `isLandingEvidence` should count them. That is the owners' call; this report does not pick one.
- **Filed.** As a third, unpinned case in the existing `docs/areas/runs-and-dispatch.md` Waiting entry on `landingPrUrls` (§9). No ticket.

### 3.0 `seam:runner-contract` (two repos) · **Medium** · **carried, unchanged** (run 11 §3.0)

- **What it is.** `lib/runner-kit/contract.json` in LinearViewer and `test/fixtures/runner-contract.json` in simple-dispatcher are byte-identical, and both sides pin the sha256 `602ab014062857bfba3e9aa543088472c3ba5dbc7cb0673da909e67ed727eb40` (E/`contract-sha.txt`: the head, the baseline, and both simple-dispatcher commits). Pinned on each side by `tests/unit/runner-kit-contract.test.js` and `test/runner-contract.test.js`.
- **The unpinned match, carried.** The server limiter window (`routes/proxy.js:257`, `windowMs: 60 * 1000`) and the broker's wait cap (`lib/runner-kit/broker.mjs:97`, `EXCHANGE_MAX_WAIT_SECONDS = 60`) are still two 60-second numbers in two files whose only link is a comment. simple-dispatcher's counterpart is `harbour-token-mcp-server.js:55–56` (`EXCHANGE_RETRIES = 2`, `EXCHANGE_MAX_WAIT_SECONDS = 60`). The `agent-api.md` Waiting entry is still true (§9).
- **Severity stays Medium.** Unchanged from run 11.

### 3.0b `seam:leftover-resume-contract` (two repos) · **Low** · **carried** (run 11 §3.0b)

- **What.** The leftover step (`lib/dispatch-leftover.js`) posts a follow-up to a finished build's session. In simple-dispatcher the same follow-up resumes a COMPLETED session.
- **Still unpinned.** The contract has 66 rows at both sides, identical to run 11. The follow-up rows are `pause` and `stop` (halt) rows, plus `unknown repo on a follow-up` (`not-checked`, session live). No row pins "a follow-up to a finished, unhalted session is claimed and resumed". The gap is the same; the window added resumed work (the leftover answer, LIN-4414), not a new contract row.
- **Filed as a Waiting entry in `runs-and-dispatch.md`**, re-verified (§9).

### 3.1 F1 `knot:agents-chat<->runs` (LLM & prompts ⇄ Runs & dispatch) · **High** · **carried; count worse; kind not new, widened into the recommendation layer**

- **Count.** 32/50 at run 11's commit → **38/55** at the head. Run 10 was 31/49 (run 11's ledger).
- **What moved.** Edges, file level (E/`edge-diff-B-to-H.txt`, S4):
  - Runs → LLM added six, five of them vocabulary: `dispatch-leftover-answer.js` → `leftover-words.js`; `plan-review-round-trips.js`, `recent-runs.js`, `run-ledger.js` → `blind-read-words.js`; `run-ledger.js` → `survey-words.js`. The sixth is `dispatch-entrance.js` → `recommendation-live-wait.js` (a function, `liveWaitRefusal`). One Runs → LLM edge was removed (`dispatch-entrance.js` → `recommendation-look-first.js`).
  - LLM → Runs added six, all reads of run state, by named import: `recommendation-blind-read.js` → `run-ledger.js` (`landingPrUrls`), → `run-closeout-state.js` (`closeOutWaitsOn`), → `recent-runs.js` (`isLiveRun`); `recommendation-live-wait.js` → `recent-runs.js` (`isLiveRun`); `recommendation-look-first.js` → `run-ledger.js` (`isSurveyReport`); `prompt-template-defs.js` → `run-ledger.js` (`landingPrUrls`, `prOf`).
- **Kind: the correction to run 11.** Run 11 wrote that the look-first route was "the first LLM-to-Runs read of run state rather than vocabulary". That is wrong at run 11's own commit. LLM already read run state, many times over: `openrouter.js` → `recent-runs.js`; `recommendation-input.js` → `recent-runs.js`; `recommendation-facts.js` → `run-ledger.js`, `plan-review-round-trips.js`; `chat-tools.js` → ten Runs modules (`dispatch-factory`, `follow-up-dispatch`, `live-console`, `loop-supersede`, `pipeline-loops`, `session-summary`, `task-stack`, `unanswered-decisions`, `observer-sweep`, `dispatch-session-read`); `prompts/revision-brief.js` → `run-ledger.js`; `prompts/runner-kickoff.js` → `dispatch-store`, `workspace-halt`, `runner-kit/*`; `audit.js`, `scan.js`, `prompt-formatters.js`, `model-routing-*` likewise. Run 11's F1 kind was not new, and this run does not make it new.
- **What is new in kind (judgement, Medium-weight).** The six new LLM → Runs reads sit in the recommendation layer, and one of them is a dispatch decision. `dispatch-entrance.js` (Runs) calls `liveWaitRefusal` from `recommendation-live-wait.js` (LLM), which answers the 409 `STAGE_IN_FLIGHT` for a second stage beside a live one, and `isLiveRun` in `recent-runs.js` (Runs) decides what is live. So a Runs guard is held in LLM and reads Runs. Three areas hold it: Runs enforces, LLM decides, Agent API and Web describe (§3.10). Severity stays High because the count is the knot's measure and this is its widest move since run 10. The second read reads the five vocabulary edges as constant imports, a placement cost rather than a defect; that is why F1 is not ranked above §3.0a, though it stays High (§Adversarial Second-Read).
- **Experiments (E/`areas.exp-A…`, `areas.exp-B…`, `areas.exp-C…`).** Each is a registry change, labelled, not applied; the figures reproduce the ticket's.
  - **A: sequence modules to Runs** (`recommendation-look-first`, `-blind-read`, `-live-wait`): LLM ⇄ Runs **35/59**. The count falls on one side and rises on the other; the pair stays a knot. Negative.
  - **B: vocabulary leaves to their own area** (`blind-read-words`, `survey-words`, `leftover-words`): LLM ⇄ Runs **38/49**. The Runs → LLM count falls by six, the edges into the three word files, but the leaves become a separate area that Runs still imports. It is a relabelling, not a seam removed. Negative as a fix.
  - **C: a new Recommendation sequence area** (the three sequence modules plus `recommendation-facts`, `recommendation-input`): LLM ⇄ Runs **29/53**, and three new reciprocal pairs (LLM ⇄ Recommendation sequence 6/6, Providers ⇄ Recommendation sequence 3/3, Recommendation sequence ⇄ Runs 9/2) and a cycle group of ten. Negative.
  - **D (an extra check): `recommendation-live-wait` alone to Runs.** LLM ⇄ Runs **38/54**, Agent API → Runs 49, Agent API → LLM 45. One edge in each direction; the placement question is real but small in count. Not proposed as an F1 fix.
- **Builder rule.** None yet. The sequence reads run history from the LLM layer by design (LIN-4370), and the guard is split across three areas (§3.10). Writing a rule here would be a rule about the placement, not the count, and the note entry in §9 records the placement as a size of move.
- **Watch.** `recommendation-live-wait.js`, `recommendation-blind-read.js`, `run-ledger.js` (§3.10).

### 3.1b `knot:agent-api<->llm` (Agent API ⇄ LLM & prompts) · **Medium** · **worse in count, kind unchanged** (run 11 §3.1b)

- **Count.** Agent API → LLM **43 → 46**; LLM → Agent API **4** (unchanged). File-level crossings 47 at run 11, 50 at the head (E/`seams-code-*`).
- **Added.** `lib/proxy-instructions.js` → `prompts/blind-read-words.js`, `prompts/leftover-words.js` (vocabulary), and `lib/recommendation-live-wait.js` (the refusal code `STAGE_IN_FLIGHT_CODE`, a constant the catalog's text names). `proxy-instructions.js` is the catalog that describes the routes; the new imports are the words it describes.
- **Reverse, unchanged, four edges.** `lib/model-routing.js` and `lib/model-routing-harnesses.js` import `applyDefaultDispatchHarness` from `lib/proxy-preamble.js` (line 154), which is routing policy in an Agent API file; `lib/chat-tools.js` imports from the same preamble (`shouldUseMcpTokenField`); `lib/prompts/runner-kickoff.js` imports `proxy-scopes.js`. The first is ticket-owned: LIN-4155 (Backlog) is "move `applyDefaultDispatchHarness` out of `lib/proxy-preamble.js` so model routing stops importing Agent API". Run 11's Waiting entry for it duplicated that ticket and was removed by LIN-4418 (`66fe58e1b`). It stays out of the notes (§9).
- **Severity Medium.** Unchanged from run 11.

### 3.2 F4 `knot:runs->agent-api(proxy-preamble)` (Agent API → Runs & dispatch) · **Medium** · **worse in count (44 → 48), better in one respect**

- **Count.** Agent API → Runs **44 → 48**; Runs → Agent API **10** (unchanged).
- **Added (six).** `routes/proxy-compute.js` → `lib/task-cost-read.js` (`readTaskCost`); `routes/proxy.js` → `lib/task-cost-read.js` (`LINEAGE_QUERY_LIMIT`); `lib/proxy-instructions.js` → `lib/run-ledger.js` (`BLIND_READ_CODES`) and `lib/dispatch-leftover-answer.js` (`LEFTOVER_ANSWER_CODES`, `retiresExamples`); `routes/proxy-writes.js` → `lib/dispatch-leftover-answer.js` and `lib/run-ledger.js` (the proxy's refusals).
- **Removed (two).** `routes/proxy-compute.js` no longer imports `lib/lineage-membership.js` or `lib/request-usage-loader.js`; the `/cost` reads now go through `lib/task-cost-read.js`. The route still takes the usage loader as an injected dependency (`deps.requestUsageLoader`, line 46).
- **Direction.** Both new cost edges are routes importing a lib read: the right way round. `/cost` and the task timeline now make the same read (`lib/task-cost-read.js`; LIN-4404, LIN-4405), which is what the window set out to do.
- **Still owned.** `lib/proxy-preamble.js` out of Agent API: LIN-3738 (Backlog).

### 3.3 F3 `knot:providers->upward` (LLM & prompts → Providers, and back) · **Medium** · **worse by one edge (14 → 15); reverse unchanged at 4**

- **Count.** LLM → Providers **15** (run 11: 14); Providers → LLM **4** (unchanged).
- **The new edge.** `lib/recommendation-blind-read.js` → `lib/providers/state-map.js`. `state-map.js` is a leaf (one outbound edge) with 30 importers, so the added edge reads a provider state mapping from a recommendation fact.
- **Ticket.** LIN-3923 (Backlog) decides this knot. Its title says "now 11/4", which is stale at both figures; the decision is still its own.
- **Correction to research.** The ticket's research summary said F3 was "unchanged at 15/4". The rerun gives 14/4 at the baseline and 15/4 at the head. Run 11's ledger row (14/4) is right; the trend is worse by one.

### 3.4 N1 `knot:other-features-catch-all` · **Medium** · **unchanged** (18 → 18)

- The same eighteen files (§2.3). All ten new files match a pattern, so none fell through in this window. The earlier R19 count in `integration-surface-maturity-review-2026-11-10.md` was about its own window and is not re-measured here beyond N1's unchanged 18.

### 3.5 `knot:agent-api<->other-features` · **Medium** · **carried, unchanged** (2/1)

- `routes/proxy-writes.js` and `lib/proxy-graphql-errors.js` (Agent API) with `lib/as-asked-seal.js` (Other features). The seal's placement is pinned in `tests/unit/area-map-placement.test.js`; moving it is an owner decision (P10a, §7). The `other-features.md` Waiting entry is still true; not re-read in full.

### 3.6 F6 `knot:browser-window-globals` · **Medium** · **unchanged** (67 → 67)

- `window.X =` assignments in `public/`: 67 at both commits (E/`supplementary-figures-run12.txt` S11). Browser-code pairs without an import link moved with the window (§6), not with new globals.

### 3.7 `seam:periodical-mint` residue · **Medium, owned** (LIN-4318, Backlog) · **unchanged**

- `lib/dispatch-entrance.js:1226` still decides the periodical grant from prompt text: `declaresPeriodicalGrant({ kind, periodicalId, autopilot: isAutopilotVariant(prompt) })`. LIN-4318 owns it. No new ticket.

### 3.8 N3 `knot:auth->llm(model-routing)` · **Low–Medium** · **unchanged** (5/3)

- Five edges, all from `lib/workspace-*.js` files that the registry puts in Auth by the `workspace-` prefix. The map-hygiene item is carried (§3.14). No edge moved in the window.

### 3.9 Pages ⇄ Runs and Pages → Other · **Low, watch** · **worse by two and one**

- **Pages → Runs 13 → 15 (+2).** Both new edges are from `render-task-timeline.js` (new): to `run-view.js` and to `task-page-loader.js`. A renderer that imports run logic is the right way round. Nothing in Runs imports the timeline renderer (E/S7).
- **Pages → Other 9 → 10 (+1).** The new edge is `render-task-timeline.js` → `lib/cost-format.js`, a catch-all file, one of N1's eighteen. The timeline now depends on a catch-all file for its money formatting. `cost-format.js` has eight importers: seven Pages renderers and `lib/ship-biscuit.js` (LLM). Small; it is the file to give a home when the catch-all is tidied.
- **Carried, not re-filed:** `lib/task-page-loader.js` and `lib/task-state.js` import `fmtDuration` from `render-run-steps.js` (a renderer): LIN-4154 (Backlog) owns it.

### 3.10 New watches from the live-stage wait and the run-state readers · **Low–Medium** · **new**

- **`lib/recommendation-live-wait.js` (new, watch; note entry in §9).** 80 lines. Its refusal (`liveWaitRefusal`, 409 `STAGE_IN_FLIGHT`) is a Runs dispatch rule: `lib/dispatch-entrance.js` enforces it (line 1731), `routes/workspace-api.js` imports it, `lib/proxy-instructions.js` imports its code, and `lib/openrouter.js` (`codeRouteOf`) feeds it to every recommendation surface. Its run-state test, `isLiveRun`, is in `lib/recent-runs.js`. Placed in LLM by `^lib/recommendation-`. The file's own header says the rule is shared by every surface; that sharing is the cross-area shape. Not a knot by itself. Its size of move is a Runs home (P-LW1, §7); measured as experiment D, it moves F1 by one edge.
- **`lib/run-ledger.js` (watch).** Cross-area importers 2 → 7 (5 LLM modules: `prompt-template-defs`, `prompts/revision-brief`, `recommendation-blind-read`, `recommendation-facts`, `recommendation-look-first`; 2 Agent API: `proxy-instructions`, `routes/proxy-writes`). Its size went 433 → 728 lines (Code Quality owns size). Its landing readers disagree with `isLandingEvidence` in the two pinned cases (LIN-4438; carried in `runs-and-dispatch.md`; owned by Drift & Coherence per the research) and in a third, unpinned case that is §3.0a. The reader is now a shared dependency of LLM's recommendation and prompt code, so the words it parses (`blind-read-words.js`, `survey-words.js`) cross the same boundary.
- **`lib/openrouter.js` (watch).** Outbound 11 → 13: it now imports `recommendation-blind-read.js` and `recommendation-live-wait.js` as intra-LLM edges, and through them reaches run state (`recent-runs.js`, `run-ledger.js`). The OpenRouter client is a door by design (33 in, 25 cross-area), so the watch is the breadth, not a split.
- **`lib/prompt-template-defs.js` (new, Low).** A catalog of prompt definitions now imports `landingPrUrls` and `prOf` from `run-ledger.js` (the blind-read template reads PRs from the trail, per the comment at line 1280). The read is by design; the catalog holding a Runs reader is the watch. Not a note entry.
- **`lib/recommendation-look-first.js` (improved).** In-degree 3 → 1 (only `openrouter.js` imports it now; `dispatch-entrance.js` and `routes/workspace-api.js` moved to the live-wait). Outbound 7 → 8; 228 → 184 lines.
- **`lib/periodicals.js` (watch, not crossed).** 1353 → 1416 lines; one new importer (`recommendation-look-first.js`). Drift & Coherence owns the content hand-off (run 10 §11).
- **`server.js` (Low, watch).** Outbound 204 → 205: it imports `createTaskTimelineReader` and `createTimelineFragmentReader` from `lib/task-timeline.js` to wire the timeline into the routes; 4757 → 4769 lines. The composition root grew by 12 lines in a window that added ten files; LIN-1249 (Backlog) owns decomposition.

### 3.11 `seam:reports-scripts-out-of-scope` (tool scope) · **Low** · **new**

- Seven registered Reports scripts are outside `seams.mjs`'s scope, and four of their imports reach into `lib/` (§0). The tool therefore cannot see Reports → Runs or Reports → LLM edges, which the Reports note already documents as Lessons in two cases (`countWaiting`, `parseBlindRead`). Closing comment and the scope proposal (P-T1, §7); not a note entry.

### 3.12 Ticket-owned items, carried (report only; not re-filed in notes)

- **LIN-4155** (Backlog): `applyDefaultDispatchHarness` out of `lib/proxy-preamble.js` (§3.1b).
- **LIN-3738** (Backlog): `lib/proxy-preamble.js` out of Agent API (F4).
- **LIN-3923** (Backlog): the LLM ⇄ Providers decision (F3, §3.3).
- **LIN-4154** (Backlog): `fmtDuration` out of `render-run-steps.js` (§3.9).
- **LIN-4318** (Backlog): Periodical mint by id (§3.7).
- **LIN-1249** (Backlog): `server.js` decomposition (§3.10).
- **LIN-4028** (In Progress): routing ruling; not a seam finding here.

### 3.13 Stale `lib/task-cost.js` references · **Low** · **new**

- `lib/model-routing-spend.js:5` and `lib/wall-clock-summary.js:109` name `lib/task-cost.js`, which the guide and the code no longer have. `tests/unit/task-cost.test.js` is titled "Unit tests for lib/task-cost.js", and `tests/unit/lin-2253-instructions-cost-gate-prose.test.js` and `tests/unit/runner-kit-helper.test.js:20` name it too. `tests/unit/area-map-placement.test.js:22` records the retirement. These are comments and titles, not placements, so they bind no change; closing comment only.

### 3.14 Map hygiene · **Low** · **carried**

- `map:wake-credential`: `lib/wake-credential.js` is in Runs by `^lib/(…|wake-[^/]*|…)`, which comes before Auth in the registry, so the name Auth's pattern carries is dead. Closing comment only (no area file to cite for the guide itself).
- `map hygiene: workspace- prefix (Auth)`: drives N3 (§3.8). Carried.

## 4. Ways in and rebuild readiness

Per area at the head (files · internal imports · cross-area in / out · entry files). Baseline in brackets where it moved.

| area | files | internal | cross in | cross out | entry | rebuild readiness and what stops it |
|---|---|---|---|---|---|---|
| Runs & dispatch | 114 [110] | 206 [198] | 260 [246] | 182 [177] | 97 [94] | Not ready to move. Highest in-degree; F1 and F4 are its knots; three new files (task timeline, cost read, session roles) give the cost and timeline reads a home. |
| LLM & prompts | 91 [86] | 100 [94] | 265 [257] | 86 [78] | 76 [74] | Not ready. F1's LLM side; the recommendation layer now holds a Runs guard (§3.10). Its note entries are the placement evidence. |
| Platform & plumbing | 25 | 2 | 285 [283] | 0 | 23 | Ready as a leaf: no outbound cross-area edge. |
| Front end: server-rendered pages | 92 [91] | 289 [286] | 104 [102] | 182 [178] | 56 [55] | Ready within its own area. Knots with Auth (14/11), Runs (15/8) and Other (10/8). |
| Web routes | 38 | 31 | 22 | 402 [399] | 22 | Ready as a routing layer; out-degree 402 means every route change touches its owners. |
| Auth, accounts & workspaces | 64 | 115 | 188 | 38 | 57 | Ready as a seam. Its sharpest knot is N3 (5/3), driven by the `workspace-` prefix. |
| Providers | 37 | 40 | 130 [129] | 14 | 32 | Ready except F3 (Providers → LLM 4): LIN-3923 decides it. |
| Agent API (proxy) | 32 | 45 | 34 | 169 [162] | 13 | Ready once F4 (proxy-preamble, LIN-3738) and the routing helper (LIN-4155) move. Its limiter↔cap seam travels with it. |
| Other features (catch-all) | 18 | 6 | 37 [36] | 26 | 17 | Not a unit of rebuild: homeless files by design. N1 is its only knot. |
| Reports & operator tools | 8 | 3 | 8 | 35 | 6 | Ready; small. Its scripts sit outside the import tool (§3.11). |
| Task model | 2 | 1 | 9 | 3 | 2 | Ready; a healthy leaf. |
| Front end: browser code | 44 | 0 | 0 | 0 | 0 | Not a seam in the import graph (classic scripts). F6 is its only knot. Rebuild needs F6's global set retired first. |
| Wiring (server.js) | 1 | 0 | 0 | 205 [204] | 0 | The composition root. Ready only after LIN-1249. |

## 5. The seams the import graph does not show

- **The runner contract (two repos).** §3.0. Its sha is pinned both sides; its limiter↔cap match is not. The graph cannot show it.
- **The leftover step's resume of a finished session (two repos).** §3.0b.
- **The Reports scripts' imports from `lib/`.** Four edges the tool does not read (§0, §3.11). Two are already Lessons in the Reports note.
- **The live-stage refusal's three-area shape.** §3.10. The graph shows its edges (dispatch-entrance → live-wait → recent-runs; Agent API and Web → live-wait) but not that they are one rule.
- **Shared ticket ids** are mentions, not code coupling. Not re-measured this run; the run 11 figure (38 of 123) stands for the baseline.

## 6. Change coupling beside import coupling

**LinearViewer, 60 days** (`cochange.mjs --days 60`, HEAD registry for both commits; E/`cochange-code-*`).

| | baseline `b315e0e8f` | head `e2d4659c4` |
|---|---|---|
| changes | 942 | 914 |
| touching 2+ areas | 418 | 399 |
| pairs | 76 | 76 |
| unmapped files | 8061 | 8855 |
| shallow | false | false |

Under run 11's registry the baseline reads 942 / 418 / 76 / 8061, as published; the pair figures differ by the fourteen guide-only moves (§1.1).

**Window reconciliation (E/`supplementary-figures-run12.txt` S10).** The two windows share 879 commits; the baseline window has 63 commits the head does not, and the head has 35 the baseline does not. The moves in the top pairs are reproduced exactly by adding and removing those commits:

| pair | baseline | − baseline-only | + head-only | head |
|---|---|---|---|---|
| Browser ⇄ Pages | 138 | −12 | +2 | **128** |
| Browser ⇄ Web | 103 | −10 | +1 | **94** |
| Agent ⇄ Runs | 122 | −4 | +6 | **124** |
| LLM ⇄ Runs | 108 | −6 | +10 | **112** |
| Web ⇄ Runs | 119 | −6 | +4 | **117** |

Read the browser movements as the window's slide, not a change in coupling. Read the LLM ⇄ Runs movement as real: ten commits entered the window that touch both areas, against six that left.

**The top pairs at the head** (60 days): Browser ⇄ Pages 128 (no link, F6); Agent ⇄ Runs 124 (link); Runs ⇄ Web 117 (link); LLM ⇄ Runs 112 (link, F1); Browser ⇄ Web 94 (no link); Pages ⇄ Web 96; Browser ⇄ Runs 88 (no link); Web ⇄ Wiring 89; Runs ⇄ Wiring 84; Pages ⇄ Runs 96.

**Pairs with no import link:** 19 at both commits, the same 19 (E/S3, S9). Twelve are browser-code pairs (F6). The other seven did not move at all: Agent ⇄ Reports 14, Other ⇄ Reports 7, Providers ⇄ Reports 2, Agent ⇄ Task 2, Auth ⇄ Task 2, Task ⇄ Web 2, Task ⇄ Wiring 1.

**Candidate seams from change coupling: none new.** Every pair that grew and has no link is a browser-code pair, and none of the seven non-browser no-link pairs moved. Other ⇄ Reports (no link) is the one no-link pair the guide edit moved: 5 under run 11's registry, 7 under the HEAD registry (§1.1).

**simple-dispatcher, 60 days** (E/`cochange-sd-*`): 104 changes, 50 touching 2+ areas, 15 pairs, 243 unmapped at `5d8489e`; 100, 46, 15 and 240 at `af9b496`. The same 15 pairs. Loop ⇄ Test harnesses (the `e2e-*.js` process boundary) remains the one co-change pair without a `require` link, as run 11 described.

## 7. Guide proposals (labelled; nothing edited)

Recorded apart from code movement. None is applied. No test, check or count is added to enforce the guide.

- **P-SD1 `shutdown.js` placement (simple-dispatcher), carried.** `shutdown.js` is in State but requires `feedback.js` (Stop hook) and `signal-guard.js` (Reapers). Its reciprocal pairs (State ⇄ Stop hook 10/1, State ⇄ Reapers 14/1) are unchanged. Not a code tangle; a placement.
- **P10a `as-asked-seal.js` → LLM & prompts, carried.** Closes Agent API ⇄ Other (2/1). Needs `tests/unit/area-map-placement.test.js:69–72` changed, which reverses a deliberate pin. Owner's decision.
- **P-LLM1 split the LLM catch-all, carried, with negative evidence.** The LLM area holds the Periodical engine and the recommendation code; its note is at 3949 of 6144 Lessons bytes. Experiments A, B and C (§3.1) each reassign the sequence modules or the vocabulary, and each either raises F1's Runs-side count, leaves it, or creates new reciprocal pairs. **Do not propose reassignment as the F1 fix.** A Periodical or recommendation area remains a tidy for its own sake, not a seam removal.
- **P-LW1 give the live-stage wait a Runs home, new.** Moves `lib/recommendation-live-wait.js` (and its refusal) from LLM to Runs. Measured as experiment D: F1 38/54, Agent API → Runs 49, Agent API → LLM 45. A placement fix for one rule, small in count; it is a larger tidy (a size of move) recorded in the note and the closing comment. It does not address F1.
- **P-XN1 a cross-area and cross-repo notes home, carried.** `LEFTOVER_RULE` gives a leftover one home in one repo; a seam between areas or repos has none. The runner contract is still filed in LinearViewer's notes with simple-dispatcher's side in prose. Not closed.
- **P-T1 `seams.mjs` CommonJS and a scope flag, carried, extended.** The tool reads `import` and scopes `server.js|lib|routes|public`. Two additions: a `require` reader (E/`require-graph.mjs` is the working sketch), and `scripts/` in scope for the seven Reports scripts, whose four `lib/` imports are the evidence (§3.11). The tool is not edited here.
- **P-REV1 review cadence and compaction for `docs/reviews/`, carried.** 173 entries now, growing faster than the code they measure.
- **P-AN1 `lib/prompts/area-note-format.js` placement, new.** Notes infrastructure filed under LLM & prompts by `^lib/prompts/`, with no in-scope importer (its one importer is `scripts/stability-measures.mjs`, outside the tool's scope). Proposal: file it under Reports, or give `^lib/prompts/` a notes exception. Low.
- **P-R1 and P-L1** (proposed in this ticket's research comment) are carried as P-T1 (extended) and P-AN1 respectively.

## 8. Existing tickets and carried items

Re-read at the head, 13 Nov:

| ticket | state | relation |
|---|---|---|
| LIN-4155 | Backlog | `applyDefaultDispatchHarness` out of `proxy-preamble.js` (§3.1b; the removed run 11 entry) |
| LIN-3738 | Backlog | `proxy-preamble.js` out of Agent API (F4) |
| LIN-3923 | Backlog | LLM ⇄ Providers decision (F3); its title's "11/4" is stale |
| LIN-4154 | Backlog | `fmtDuration` out of `render-run-steps.js` (§3.9) |
| LIN-4318 | Backlog | Periodical mint by id (§3.7) |
| LIN-1249 | Backlog | `server.js` decomposition (§3.10) |
| LIN-4193 | Backlog | cost modules into an area (no new edge in the window) |
| LIN-3555, LIN-3736, LIN-3737 | Backlog | "Seams:" tickets, carried; no change |
| LIN-4028 | In Progress | routing ruling; not a seam finding |
| LIN-4392 | Done | the live-stage wait (origin of `recommendation-live-wait.js`) |
| LIN-4402 | Done | run 11 |
| LIN-4418 | Done | the Test Coverage review that removed run 11's `applyDefaultDispatchHarness` entry |
| LIN-4442 | Done | Stability run 6 (the new Reports scripts; `stability-review-2026-11-13.md`) |

Findings already filed as tickets stay in this report only.

## 9. Notes and follow-ups

**Edited in this PR (`docs/areas/llm-and-prompts.md` and, after the second read, `docs/areas/runs-and-dispatch.md`).**
- **Added, Waiting:** `lib/recommendation-live-wait.js`: the live-stage refusal is a Runs dispatch rule placed in LLM by prefix; three areas hold it; a size of move (P-LW1). Source: this report.
- **Extended, Waiting (`docs/areas/runs-and-dispatch.md`, the `lib/run-ledger.js` `landingPrUrls` entry):** a third, unpinned case, the agent-note split of §3.0a. The entry keeps its two pinned cases; the extension cites this report.
- **Removed, Waiting:** none.

**Re-verified, no edit.**
- `docs/areas/llm-and-prompts.md`, the `lib/recommendation-input.js` Waiting entry (the five hand-built contexts): still true. `lib/dispatch-entrance.js:1587`, `routes/proxy-compute.js:315` and `:474`, and `routes/workspace-api-prompts.js:239` build the `generatePrompt` context by hand.
- `docs/areas/agent-api.md`, the limiter↔cap Waiting entry (run 10; carried): still true. `routes/proxy.js` line 257 holds the 60-second window (it was 256 at run 11); `lib/runner-kit/broker.mjs:97` holds the 60-second cap. Still by comment.
- `docs/areas/runs-and-dispatch.md`, the no-halt follow-up Waiting entry (run 11): still true (§3.0b).
- `docs/areas/agent-api.md`, the run 11 entry on `applyDefaultDispatchHarness`: removed by LIN-4418, which named LIN-4155 as the double home. The entry was true and still is; it stays out.
- `docs/areas/reports-and-operator-tools.md`: no entry. Its Lessons already state the two `lib/` imports the Reports scripts make (`countWaiting`, line 11; `parseBlindRead`, line 36).

**Not touched, with reason.**
- `docs/areas/other-features.md` (the as-asked-seal entry, carried), `front-end-pages.md`, `web-routes.md`, `front-end-browser.md`, `wiring.md`, `platform-and-plumbing.md`, `auth-accounts-and-workspaces.md`: not edited. Their entries were not all re-read against the window; the limit is stated in §12. (There is no Providers note.)

**Not an entry, on purpose.**
- The F1 kind (§3.1), the Pages/Other directions (§3.9), the run-ledger and openrouter watches (§3.10), the Reports scope gap (§3.11), the stale `lib/task-cost.js` comments (§3.13): watches, placements and comments that bind no builder's change now. Each is in the closing comment or in this report.

**Closing comment (to the person) carries:** the larger tidy P-LW1; the findings with no area file to cite (`map:wake-credential`, the Reports scope gap, P-XN1's missing seams home); the stale `task-cost.js` references; Supply Chain's unowned limiter-keying seam (the limiter keys by proven credential; a dependency-and-supply review question, not a note).

**No ticket is minted.** Waiting entries, not tickets, route the outside finds (`CONSEQUENCE_TEST`). No find here breaks, blocks, or touches safety.

## 10. Trend ledger

Stable names are the ledger's own. Severity is this run's. "Δ run 11" is against `b315e0e8f`, measured under the HEAD registry (guide-only figures are in §1.1).

| name | severity | run 11 (`b315e0e8f`) | run 12 (`e2d4659c4`) | Δ run 11 |
|---|---|---|---|---|
| `seam:runner-contract` (two repos) | Medium | pinned both sides; limiter↔cap by comment | same; sha `602ab014…` at both repos' commits | **carried** (§3.0) |
| `seam:leftover-resume-contract` (two repos) | Low | no halt-free follow-up row | same; 66 rows both sides | **carried** (§3.0b) |
| F1 `knot:agents-chat<->runs` (LLM & prompts ⇄ Runs & dispatch) | High | 32/50 | **38/55** | **worse in count; kind not new, widened into the recommendation layer** (§3.1) |
| `seam:landing-reader-agent-note` (`isLandingEvidence` ⇄ `landingPrUrls`) | High, new | — | reproduced; an agent note citing a new PR adds it to the blind read's landing without counting as work after review | **new** (§3.0a) |
| `knot:agent-api<->llm` | Medium | 43/4 | **46/4** | worse in count; kind unchanged (§3.1b) |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 44/10 | **48/10** | worse in count; cost reads better (§3.2) |
| F3 `knot:providers->upward` | Medium | 14/4 | **15/4** | worse by one; reverse 4 (§3.3) |
| N1 `knot:other-features-catch-all` | Medium | 18 | 18 | unchanged (§3.4) |
| `knot:agent-api<->other-features` | Medium | 2/1 | 2/1 | unchanged (§3.5) |
| F6 `knot:browser-window-globals` | Medium | 67 | 67 | unchanged (§3.6) |
| `seam:periodical-mint` | Medium, owned (LIN-4318) | unchanged | unchanged | unchanged (§3.7) |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 5/3 | 5/3 | unchanged (§3.8) |
| Pages ⇄ Runs (`knot:pages<->runs`, added this run; run 11 had no row) | Low, watch | 13/8 | **15/8** | worse by two; direction right (§3.9) |
| Pages → Other | Low, watch | 9 | **10** | worse by one; `cost-format` (§3.9) |
| `seam:live-stage-wait` (`recommendation-live-wait.js`) | Low–Medium, new | — | Runs refusal in LLM; 3 areas | **new** (§3.10) |
| `hub:run-ledger.js` | Low–Medium, watch | 6 in (2 cross) | **11 in (7 cross)** | **worse; new LLM importers** (§3.10) |
| `hub:openrouter.js` | Low–Medium, watch | 33 in (25 cross); out 11 | 33 in; **out 13** | watch (§3.10) |
| `hub:recommendation-look-first.js` | watch | 3 in (2 cross); 228 lines | **1 in (0 cross)**; 184 lines | **improved** (§3.10) |
| `hub:periodicals.js` | Low–Medium, watch | 8 in; 1353 lines | 9 in; 1416 lines | watch (§3.10) |
| `hub:workspace-preferences.js` | Low–Medium, watch | 16 in | 16 in | unchanged |
| `hub:dispatch-factory.js` | Low–Medium, watch | out 18 (14 cross) | unchanged | unchanged |
| `hub:dispatch-store.js` | Low–Medium | 7 in (6 cross); 4530 lines | unchanged | unchanged |
| N2 `hub:task-page-loader.js` | Medium | 8 in (7 cross); out 21 | 9 in (8 cross); out 22 | worse by one in-edge (§3.9) |
| N4 `hub:run-controls.js` | Medium, watch | 21 in | unchanged | unchanged |
| N6 `hub:cost-read.js` | Medium, watch | 11 in | 12 in | watch (§3.10) |
| `hub:tree.js` | watch | 8 in | unchanged | unchanged |
| `door:as-asked` (`lib/as-asked.js`) | healthy | 25 in (12 cross) | unchanged | healthy |
| `wiring: server.js` | Low, watch | 204 out; 4757 lines | 205 out; 4769 lines | watch (§3.10) |
| `seam:reports-scripts-out-of-scope` (tool scope) | Low | — | four `lib/` imports unread | **new** (§3.11) |
| stale `lib/task-cost.js` references | Low | — | comments and test titles | **new** (§3.13) |
| `map:wake-credential` (guide hygiene) | Low | shadowed name | shadowed name | carried (§3.14) |
| `map hygiene: workspace- prefix (Auth)` | Low | drives N3 | drives N3 | carried (§3.14) |
| `prompt-template-defs.js` reads `run-ledger.js` | Low, watch | — | 2 Runs readers in a catalog | **new** (§3.10) |
| `lib/prompts/area-note-format.js` placement | Low | — | LLM by prefix, Reports-only importer | **new** (P-AN1, §7) |
| `seam:as-asked`, `seam:leftover-step`, `seam:autopilot-precedence`, LIN-4358 catalog cluster | healthy | as run 11 | as run 11 | unchanged |
| simple-dispatcher `seam:runner-contract` side and its require graph | baseline | 52 files; 20 links; 6 pairs | identical | **unchanged** (§0, §6) |
| simple-dispatcher `shutdown.js` placement | guide finding | 2 reciprocal pairs from one file | unchanged | **carried** (P-SD1) |
| simple-dispatcher Loop ⇄ Test harnesses (process boundary) | baseline | 14 co-changes, no require link | 15 pairs; same | **carried** (§6) |
| simple-dispatcher co-change total | baseline | 104 changes, 50 multi-area, 15 pairs | 100, 46, 15 | moved with the window (§6) |

**All thirteen reciprocal knot pairs** (run 11 → head, same registry). The ledger rows above cover those with a finding; the rest are unchanged.

| pair (a → b / b → a) | run 11 | run 12 | ledger |
|---|---|---|---|
| Agent API ⇄ LLM & prompts | 43/4 | 46/4 | §3.1b |
| Agent API ⇄ Other features | 2/1 | 2/1 | §3.5 |
| Agent API ⇄ Providers | 21/3 | 21/3 | unchanged |
| Agent API ⇄ Runs & dispatch | 44/10 | 48/10 | F4 (§3.2) |
| Auth ⇄ Front end: pages | 14/11 | 14/11 | unchanged |
| Auth ⇄ LLM & prompts | 5/3 | 5/3 | N3 (§3.8) |
| Auth ⇄ Providers | 13/1 | 13/1 | unchanged |
| Front end: pages ⇄ Other features | 9/8 | 10/8 | §3.9 |
| Front end: pages ⇄ Runs & dispatch | 13/8 | 15/8 | §3.9 |
| LLM & prompts ⇄ Other features | 2/2 | 2/2 | unchanged |
| LLM & prompts ⇄ Providers | 14/4 | 15/4 | F3 (§3.3) |
| LLM & prompts ⇄ Runs & dispatch | 32/50 | 38/55 | F1 (§3.1) |
| Other features ⇄ Runs & dispatch | 6/6 | 6/6 | unchanged |

## 11. Sibling hand-offs

- **Stability** (`stability-review-2026-11-13.md`, LIN-4442, run 6): the five stability-measure scripts (LIN-4420–4424, LIN-4439) are placed in Reports, which is why Reports now has four `lib/` imports the import tool does not read (§3.11). Its area-coupling hand-off points here; it is not re-flagged.
- **Drift & Coherence** (`drift-coherence-review-2026-11-10.md`): the `periodicals.js` content hand-off (run 10 §11) is still open; the landing-reader disagreement behind `lib/run-ledger.js` is theirs. Its run 10 covers the runner-contract cross-repo verdicts.
- **Code Quality** (`code-quality-review-2026-11-04.md`): size of `dispatch-store.js` (4530 lines), `run-ledger.js` (728), `proxy-compute.js`, `task-page-loader.js` (1578). The seam view defers.
- **Integration & Surface Maturity** (`integration-surface-maturity-review-2026-11-10.md`, R19): the eighteen fell-through files it recorded are now mapped at HEAD (§3.4).
- **Test Coverage Gap** (`test-coverage-gap-2026-11-11.md`, LIN-4418): removed run 11's `applyDefaultDispatchHarness` entry as a double home of LIN-4155 (§9). Right call; LIN-4155 is Backlog and names the same helper.
- **Documentation** (`documentation-review-2026-11-10.md`): its Waiting entries in `agent-api.md` (catalog gaps, the `per token` wording) are still present; not re-verified this run.
- **Design & Interface** (`design-interface-review-2026-11-08.md`): not re-read this run.
- **simple-dispatcher's side** of every item above has no report series in simple-dispatcher; this report and E/ are its baseline.

## 12. Measurement notes

- **Research figures corrected.**
  - F3: "unchanged at 15/4" → 14/4 at the baseline, 15/4 at the head (§3.3).
  - F1 kind: run 11's claim that look-first was the first LLM → Runs run-state reader was wrong (§3.1). Four others read run state at run 11's commit.
  - LIN-3923's title "now 11/4" is stale at both figures.
  - Experiment C's membership is the one that reproduces the ticket's 29/53: the three sequence modules plus `recommendation-facts` and `recommendation-input`. The first membership tried (three modules only) gave 32/54 and two new pairs.
- **Guide-only figures** are separate from code movement everywhere they appear (§1.1, §6).
- **The landing reproduction** (§3.0a) uses the test file's review and summary shapes. An earlier fixture with a loose review line was not recognised as a review, and an unapproved review never reaches the gate; both were corrected before the result above was taken. The first-pass report wrote this split off as "carried… no rule is broken". That was wrong: the split is in-window and changes output.
- **Scope of re-verification.** The two carried note entries, the removed entry's double home, the Reports lesson lines, and the entries of the notes this PR touches were checked. The window changed 38 production files that the notes cite; I did not re-read every cited entry against them. Entries in `other-features.md`, `front-end-pages.md`, `web-routes.md` and `runs-and-dispatch.md` citing window-changed files (for example `lib/dispatch-store.js`, `lib/run-closeout-state.js`, `routes/proxy-writes.js`) remain unverified for truth. The next run's note pass should start there.
- **The HEAD tools reproduce run 11's evidence** at the baseline: `seams.mjs` under run 11's registry gives run 11's links and knots, and `cochange.mjs` gives 942 / 418 / 76 / 8061 (E/).
- **The run 11 supplementary script was not re-run.** It is hard-coded to run 10 and run 11's SHAs. Its figures are re-derived in E/`supplementary-figures-run12.py`, which reads this folder's own evidence and committed objects.
- **Setup.** `acorn` was missing in the measuring worktree; `npm ci --ignore-scripts` fixed it. Nothing else.

## Adversarial Second-Read

- **Tier:** 2 (accepted): a fresh-context general-purpose sub-agent with no memory of the report-writing turn. It had read access to both clones, the report and the evidence folder, and the question below. It was told not to trust the report's conclusions and to check them against the repositories.
- **Question (verbatim):** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's answer (in full, lightly trimmed for form):**

> **1. The item.** The window's largest unreported defect is a split in the landing question, inside the recommendation layer. `lib/recommendation-blind-read.js` (new in this window, 79 lines) decides whether to offer a blind read. `blindReadStep` returns early on `facts.workAfterReview`, which `lib/recommendation-facts.js:85-86` (`isLandingEvidence`) computes. That predicate drops any comment whose first line matches `autopilot`, `plan posted` or `revision N`. The same function then names `landingPrUrls(comments)` (`lib/run-ledger.js:555-572`) as the landing, and that function does not drop agent notes. The result depends on how an agent's comment opens. The comment at `recommendation-facts.js:82-84` says the two readers "agree", and that is false.
>
> **2. Evidence.** `git log --first-parent -S "agrees with lib/run-ledger.js landingPrUrls" b315e0e8f..e2d4659c4 -- lib/recommendation-facts.js` returns only `eb14b7fff` (LIN-4438). A trail of an approved review, an `autopilot:` note citing PR 7 and a person's comment citing PR 8 gives `landingPrUrls` = `[pull/7, pull/8]`, `isLandingEvidence` per comment = `[true,false,true]`, and the landed PR per the facts = `pull/8`. The same review with PR 7 in an `autopilot:` note vs a plain note gives a `blind-read` step vs `null`. `tests/unit/lin-4438-blind-read-gate.test.js:52` and rows 14–15 pin two skews only; `docs/areas/runs-and-dispatch.md:92-98` lists the same two. The agent-note-prefix case is in neither. Edge counts reconcile (LLM→Runs 32+6=38; Runs→LLM 50+6−1=55), so F1's arithmetic is right; it measures edges, not this predicate split.
>
> **3. Why the report missed or misfiled it.** §1.2 lists `recommendation-blind-read.js` as a new file, and §4 gives its figures, but no section reviews its logic. §3.10 files the landing-reader split as "carried… owned by Drift & Coherence… Watch, not finding: no rule is broken." That is wrong on two counts: the split was introduced in this window, and it changes recommendation output. The report repeats the Waiting entry's "two cases" wording without testing whether it is complete.
>
> **4. Confidence.** High that the behaviour is real and in-window (reproduced). Medium on severity, because I could not measure how often real agent notes open with `autopilot`. This would change my mind if sampled production comments never open that way, which would reduce it to a documented Waiting-level skew. It would also change if `workAfterReview` excluding agent notes is intended design, in which case the fix is to make `landingPrUrls` drop them too.
>
> Candidates the reader rejected: `lib/agent-status-store.js` lost `listSessions` and `listTaskThreads` in merge `94893cc35` (benign; no production caller at baseline; misfiled commit scope, not mentioned); `lib/task-timeline.js` (+506, size only); `public/task-page.js` calling `window.api` and `window.initLocalTimes`, guarded by `typeof` as elsewhere; the `.mjs` runner files are inside the tool's scope; the simple-dispatcher window touches notes and one test and no seam.
>
> **5. Ranking.** The reader would rank the landing-reader split first, ahead of F1, and disagrees with the report's ranking. It holds F1 at High as a placement count, but notes five of its six new Runs→LLM edges are constant imports and experiments A–C are negative, so F1 is a placement cost rather than a defect.

- **Check of the reader's claims (by me, after the reply):**
  - The split is real. `isLandingEvidence` (`recommendation-facts.js:85–86`) excludes agent notes; `landingPrUrls` (`run-ledger.js`) excludes blind reads and Survey reports only. The comment at `recommendation-facts.js:82–84` says "agrees" and "skips the same two".
  - Reproduced with the HEAD modules and the test file's review and summary shapes (E/`landing-agent-note-repro.txt`), in the multi-PR case: `agentNewPr` → `landingPrUrls` [41, 42], `workAfterReview false`, `blindReadStep` `blind-read`; `plainNewPr` → `workAfterReview true`, no step. The same-PR cases (`autopilotNote`, `plainNote`, `noNote`) show designed agent-note behaviour and are not the defect.
  - "Introduced in this window" holds for `landingPrUrls`, which is absent at the baseline. The agent-note exclusion in `isLandingEvidence` predates the window; the mismatch is new because the second reader is new.
  - Multi-PR trail rebuilt (review stage): reproduces.
  - The reader's severity doubt stands: production frequency is not measured.
- **Response.** Fixed in place. §3.0a added and ranked first; the headline, §3.10 and the §10 ledger updated; the existing `runs-and-dispatch.md` Waiting entry extended with the third, unpinned case; the reproduction saved into E/. I did not adopt the reader's F1 demotion: F1 stays High as the knot's measure, and I note its placement-cost reading in §3.1. The reader's "largest item" call is one judgement; the report keeps its own ranking of the other findings.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
