# Seams & Tangles Review — 2026-11-05, run 8 (delta vs run 7)

Task: LIN-4298 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-11-05.md` (run 7, LIN-4249, PR #2286, merge `a569b61c`) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`, both unchanged in the window. Evidence: `docs/reviews/_evidence-2026-11-05-run8/` (see its `README.md`). "E/" below means that folder.

Review-only. The only changes are this report and its evidence folder. No code, config, guide (`scripts/code-shape/areas.json`) or other doc was edited.

## Headline

- **Better or worse, area by area** (the operator's question for this window):
  - **LLM & prompts: better.** Each template now declares its route and its `writes` once; the one new edge goes to an unplaced leaf file.
  - **Agent API: better.** The dispatch preamble is kind-free and registry-free, keyed on a four-value `writes` vocabulary, with one endpoint-hint ladder. F4 is unchanged. Its one new edge goes to the same leaf.
  - **Runs & dispatch: slightly better.** One posting-key list in `cost-read.js`, and `dispatch-entrance.js` threads `writes` through. `cost-read.js` grew by 111 lines with no new import; its size is Code Quality's.
  - **Browser code: mixed.** Go state and the focus rule each have one owner, inside `public/prompt-section.js`. Cross-script reads of `window.QuestionCards` grew by one API member and one consumer site. Global assignments are unchanged (66 → 66).
  - **Other features: worse as a map.** One new file that no guide pattern names (`lib/stage-writes.js`) takes the catch-all from 16 to 17. It is a leaf with no imports, so the damage is a guide gap, not a tangle.
  - **Web routes: unchanged in its import edges**, but `routes/workspace-api-feedback.js` gained two `stageWrites` call sites (LIN-4251), riding existing edges.
  - **Pages, Auth, Providers, Platform, Reports, Task model, Wiring: unchanged** in shape and in measured figures.
- **The window barely moved the import graph.** 29 commits, 10 of them production. Two cross-area file edges were added and none removed, both into `lib/stage-writes.js`. Links 1269 → 1271. Knot pairs 12 → 12, knot group 9 → 9. No wrong-way edge and no `lib/` → `routes/` import at either commit. The report is short because the graph is nearly the same.
- **Placement versus code.** No guide edit and no moved file. The one area-level change is code meeting a guide gap: a new file the guide does not place (N1). Code-edge changes are the two edges into that file.
- **F1 (LLM ↔ Runs, High) did not move** this window: 31/37 at both commits. Run 7's one code-driven change stays in place.
- **Change coupling: 851 / 390 / 76 → 875 / 391 / 76**, on a 99.09% shared window. This is not a trend. The unmapped-file jump (5416 → 5746) is fully explained: every new unmapped path is outside the guide's source remit (docs, tests, scripts).
- **New named item:** `seam:stage-contract`, which is healthy and is the window's main positive result. Also a new `map:stage-kind-roster` (Low–Medium), handed to Drift (LIN-4299), which owns the duplicated decision.
- **The labelled P2c experiment** (a separate "Costs & usage" area) is measured and **not** recommended. It moves F1's cost half into a new Costs ↔ Runs knot. Comment on LIN-4193.
- **Follow-ups minted: none** (§9). The adversarial second read is in the `Adversarial Second-Read` section after §9: a fresh-context reader returned DISAGREE on one omission (the test harness), which is now in §5, and the report was fixed in place.

## 0. What was measured

- **Commits.**
  - Baseline: `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (run 7's measured commit).
  - Measured: `af55cb737ec4e63919bac65558b35498ede3d290`, origin/main at measurement. The ticket was minted at the same commit, and origin/main was unchanged when the evidence was re-run.
- **One guide.** `scripts/code-shape/areas.json` is blob `642e9405` at both commits, and a byte-identical copy is E/`areas.head-af55cb73.json`. Both runs use that copy, so every difference is code.
- **Tools unchanged.** `seams.mjs` (`34f11434`), `cochange.mjs` (`c3a39f37`), `cochange-core.mjs` (`763a37b8`) and `code-shape-lib.mjs` (`42a1e521`) have the same blobs at both commits. The sibling directories `scripts/code-shape/`, `lib/runner-kit/`, `docs/runner-prompt.md` and `docs/dispatch-integration.md` have empty diffs.
- **Re-measured, not copied.** Both `seams.mjs` runs and both `cochange.mjs --days 60` runs were re-run at the two SHAs. Each output matched E/ byte for byte. Run 7's JSON was reproduced at `2eb73ae0` by the run 7 evidence.
- **Window.** `2eb73ae0..af55cb73`: 29 commits over about 10.5 hours (2026-11-05 08:39Z, LIN-4249's run 7 report merge, to 19:02Z), 10 of them touching `lib routes public server.js`. That is 24 files, +717 / −178. Added: `lib/stage-writes.js`. Deleted: none. Outside those paths, 71 files under `tests/` changed (+47,315 / −7,874, mostly the fake-DOM moves; §5) and the rest is docs (the Survey, the LIN-4257 paper, run 7 and Drift run 3 evidence) and `docs/architecture/source-map.md`.
- **Scope.** Files in the tool's scope: 543 → 544. 0 parse failures, 0 non-literal dynamic imports, 0 unmapped source files, and 4 unresolved relative imports at both (all `routes/test.js`, F8).
- **Direction rule.** `lib/` → `routes/` imports: 0 at both commits.
- **Edge diff.** The complete file-level edge list changed by exactly two edges, both added (E/`edges-code-*`, compared `edgeList` for `2eb73ae0` and `af55cb73`).

## 1. Changes since run 7 (first)

1. **Two cross-area edges into `lib/stage-writes.js`** (LIN-4253 `d9c0f1ca`, changed again by LIN-4251 `2f0c9d5b`):
   - `lib/prompt-template-defs.js:42` (LLM → Other features);
   - `lib/proxy-preamble.js:14` (Agent API → Other features).

   `stage-writes.js` imports nothing. The preamble's imports (`proxy-preamble.js:10–14`) still include no template registry, so the header's claim (a one-way leaf) holds.
2. **The stage contract is narrower.** LIN-4248 (`29f14bf6`) put `SURVEY_KINDS = ['survey-task', 'survey-place']` inside the preamble, which is kind knowledge inside Agent API. LIN-4253 deleted it two hours later. `git grep SURVEY_KINDS` over `lib routes` is empty at HEAD. The resolver is `stageWrites(kind)` at `lib/prompt-templates.js:201`; four entrances pass its value down: `dispatch-entrance.js:1059` and `:1085`, `workspace-api-feedback.js:270` and `:335`.
3. **F4 unchanged** at 11 importers (10 cross-area from 3 areas). Its anchor `applyDefaultDispatchHarness` moved from `:152` to `:153` (LIN-4155's anchor line only; four importers, unchanged).
4. **Browser seam: assignments unchanged, reads grew.** `window.X =` assignments in `public/`: 66 → 66, and in `public/common.js`: 51 → 51. No such line was added or removed in the window (E/`supplementary-figures.txt` §S4). LIN-4293's focus rule added `focusInCard` to the `window.QuestionCards` API (`public/question-cards.js:545`), and `public/prompt-section.js` now reads `window.QuestionCards` at two sites (`:1030`, `:1043`) instead of one. The loose series count (100-style pattern, which also matches `typeof` reads) is 107 → 107, and is not used for trend.
5. **The cost read grew, with the same importers.** `lib/cost-read.js` 651 → 762 lines. Still 11 importers (7 cross-area from 4 areas) and 7 outbound (2 cross-area). `postingKeysOf` (`:55`) is the one posting-key list (LIN-4276). The "Pure" wording is still at `:36`.
6. **Go state is inside one file.** The LIN-4247 and LIN-4293 changes touch only `public/prompt-section.js`, `public/question-cards.js` and `public/llms.txt`. They do not cross Pages or Runs.
7. **Wiring, hubs and everything else: unchanged.** `server.js` is 4,713 lines with 209 imports and 30 inline routes, the same as run 7. The hubs and doors in E/`supplementary-figures.txt` §S16 have identical importer and outbound counts at both commits. F3, F5, F7, F8, N2–N5, N7–N9, N11 and N12 are unchanged in the tool output.

## 2. The import graph: placement versus code

| commit | files | links | pairs | group | Other | F1 (LLM→Runs / Runs→LLM) | Pages ↔ Other | LLM ↔ Other | Agent API → Other |
|---|---|---|---|---|---|---|---|---|---|
| `2eb73ae0` (run 7) | 543 | **1269** | 12 | 9 | 16 | 31/37 | 9/8 | 1/1 | 0 |
| `af55cb73` (run 8) | 544 | **1271** | 12 | 9 | **17** | 31/37 | 9/8 | **2/1** | **1** |

Source: E/`compare-run8.md`.

- **Placement changes:** none. The guide is unchanged, so no area was edited and no file moved. The catch-all grew because a new file (`stage-writes.js`) matches no pattern: code meeting a guide gap.
- **Code changes:** two cross-area file edges added and none removed; intra-area edges 784 → 784; total edges 2053 → 2055.
- **What the gap costs on the map.** Placing `stage-writes.js` in LLM & prompts (P7min, §7) returns LLM ↔ Other to 1/1 and gives links 1270. The only other change is Agent API → LLM 37 → 38, which is an existing direction. Platform is an equally valid home, because the file is a no-import leaf.
- **Knot pairs.** The 12 pairs are the same as run 7. Only LLM ↔ Other (1/1 → 2/1) and two directed links moved. The knot group is the same nine areas.

## 3. Findings, severity-ranked, trend-framed

Ordering: first the items this window changed, then unchanged items by severity. F1 is the High knot but did not move, so it follows the window's largest item, N1. Names are run 7's stable ledger names (§11), plus two new names.

### N1 — `knot:other-features-catch-all(lib first-match)` · **Medium** · **worsened, 16 → 17, by code into a guide gap** (run 7: Medium–High as a map)

- **The new member:** `lib/stage-writes.js` (`WRITES`: four values; a dependency-free leaf). It is the window's only new file, so it is the window's only area-level code movement.
- **Why not higher:** its two edges both point into a leaf with no imports, and no knot pair opens. Run 7's Medium–High rating came from two files that also grew Pages ↔ Other. Pages ↔ Other is 9/8 at both commits, so that part is not repeated.
- **Placement, not code, fixes it.** P7min (§7) is the labelled experiment: the catch-all returns to 16 for the run 7 members, LLM ↔ Other returns to 1/1, and no pair opens.
- **Watch:** PR #2185 (LIN-4028, still open) would add `lib/routing-ruling.js` to the catch-all (N12).
- **Owners:** no open ticket. The map ticket LIN-3720 is Done. The fix is a guide proposal (P7min), not a code move.

### F1 — `knot:agents-chat<->runs(chat-tools)` · **High** · **unchanged (31/37)**

- The LLM ↔ Runs knot is the same as run 7: 31 edges one way, 37 the other. The run 7 change (`model-routing-history → cost-read`) was not extended.
- Cost share: 6 of the 31 LLM → Runs edges and 6 of the 37 Runs → LLM edges touch the cost family (E/`supplementary-figures.txt` §S8). This is the same as at `2eb73ae0`.
- Survey: `place-ledger.md:35` (LIN-4226) is unaffected by this window.

### `map:stage-kind-roster` · **Low–Medium** · **new as named**

- Adding a stage kind means editing per-kind tables in several files, joined by string keys rather than imports, so the import graph cannot see the coupling. `git grep -l survey-place` over `lib routes public server.js` at HEAD names 9 files in 4 areas: LLM 4 (`llm-jobs`, `prompt-formatters`, `prompt-template-defs`, `prompts/stage-intent`), Runs 3 (`completion-signals`, `run-view`, `wall-clock-summary`), Agent API 1 (`proxy-instructions`) and browser code 1 (`public/llms.txt`).
- Each such table is held by a test that loops over the kinds. The coupling shows in change coupling, not in `seams.mjs`: Agent API + Runs 101 → 105, LLM + Runs 84 → 87, Agent API + LLM 61 → 64 (§6).
- **Altitude:** the duplicated decision (one roster, many tables) is Drift's. Drift run 4 (LIN-4299, In Progress) is the owner, and this review hands it the roster and records only the area-level coupling. Not minted.

### `seam:stage-contract` · **healthy** · **new as named**

- One vocabulary leaf (`lib/stage-writes.js`), one resolver (`prompt-templates.js:201`), four entrances (§1.2). The preamble keys on `writes`, not on kind (`proxy-preamble.js:205–238`), and throws on an unknown value (`:238`).
- The intra-window transient (`SURVEY_KINDS`) was removed in the same window it was added. This is the window's clearest "better" in a seam.
- Open follow-ons with owners: LIN-4258 (plan-review, review and retrospective-audit still get the work mandate) and LIN-4259 (derive each template's write-policy wording from `writes`). Both Backlog.

### F6 — `knot:browser-window-globals(common.js)` · **Medium** · **unchanged by assignment count (66 → 66); read coupling +1 member, +1 site**

- No `window.X =` line was added or removed. The one shared-global change in the window is `focusInCard` on the `QuestionCards` API, read in one more place in `prompt-section.js`.
- **In flight, not on main:** PR #2315 (LIN-4292, OPEN, last updated 2026-11-05 19:41Z) edits `public/common.js`, `dispatch.js`, `prompt-section.js` and `task-page.js` (30 insertions, 30 deletions) to remove method-presence guards. It may change the `typeof window.X` reads that the loose count matches. Re-measure when it lands.

### F1 cost half and the cost-area option — `map:cost-family-split` (N10) · **Low–Medium** · **measured; not adopted**

- The labelled experiment (P2c, E/`guide-experiments-run8.txt`) adds a "Costs & usage" area, first match wins, and claims 16 files. F1 shrinks 31/37 → 27/32, but a new two-way knot appears, **Costs ↔ Runs 7/10**, and the group grows 9 → 10. Costs ↔ LLM is 1/4.
- **Why:** Runs sits both below the cost code (lineage membership, dispatch terminal) and above it (run view, effort readout, dispatch store, `routes/dispatch`). A separate area moves the cut, not the coupling.
- **Recommendation:** do not adopt a separate cost area. Keep the cost files in Runs and place `cost-format` and `usage-snapshot-intake` per P1d. The result is posted as a comment on LIN-4193. No ticket is minted.

### N6 — `hub:cost-read.js` · **Medium** · **unchanged by import; grew in size; read contract widened (watch)**

- 11 importers (7 cross-area from 4 areas), 7 outbound (2 cross-area), identical at both commits. 651 → 762 lines. Size is Code Quality's.
- **The read contract changed without an import.** LIN-4263 (`6ff38cf5`) added `followUpTo` to the shared `LINEAGE_IDENTITY_PROJECTION` (`lib/dispatch-store.js:275`). Every lineage-identity reader gets the field, across Runs, KPI and proxy callers. Its comment (`:270–274`) says nothing in the membership or figure rules reads it. The opt-in `perDispatch` split is set only by `routes/proxy-compute.js`. This is a widened read, not a new edge, so it stays on watch and is not graded as a seam.
- The "Pure: no store, clock or network" header (`:36`) remains true only because the loader is passed in. The wording is Drift's (§12).

### F4 · F3 · F5 · F7 · F8 · N2 · N3 · N4 · N5 · N7 · N8 · N9 · N11 · N12 · hubs · `server.js` · **unchanged**

Each is the same as run 7 in the tool output (E/`compare-run8.md`, E/`supplementary-figures.txt` §S2–S18). The notable ones:

- **F4** (`knot:runs->agent-api(proxy-preamble)`, Medium): 11 / 10, anchor `:153`. The window did not add an importer.
- **F5** (route → route, Medium): 53, 3 cross-area.
- **N9** (`door:request-usage-loader`): 7 importers. The cost read now refuses to run without it (N6).
- **N11** (`door:home-waiting`): unchanged. `lib/home-row-states.js:112` still builds its own `createWaitingStanding` by default when none is passed. Production passes the shared one.
- **N12** (`map:rulings-family-split`, Low): six areas, unchanged. PR #2185 would add a seventh file to the catch-all.
- **`server.js`** (Wiring, Low, watch): 4,713 lines, 209 imports, 30 inline routes, all as in run 7. LIN-1249 owns it.

## 4. Ways in and rebuild readiness

Only what changed is written here. Entry files are `seams.mjs`'s (E/`supplementary-figures.txt` §S15).

- **LLM & prompts:** 69 of 78 files are entry files, unchanged. The stage contract now has a vocabulary consumer in this area. **Readiness:** unchanged, better for the template declarations.
- **Agent API:** 13 of 32 unchanged. The preamble has one endpoint-hint ladder and one `writes` table. It is still the Agent API side of F4. **Readiness:** better; the preamble is narrower.
- **Other features:** 15 of 16 → 16 of 17 entry files, because `stage-writes.js` is imported from two areas. **Readiness:** not applicable until the file is placed.
- **Runs & dispatch:** 93 of 108 unchanged. The cost part is still not behind a narrow way in. **Readiness:** low–medium, unchanged.
- **Browser code:** 0 imports, so no import graph to read. Its way in is still a script list plus `window.X` (F6).

## 5. The seams the import graph does not show

Two couplings in this window are invisible to `seams.mjs`:

- **String-keyed kind tables** (`map:stage-kind-roster`, §3). Adding a kind touched 9 files in 4 areas with no import between them. It shows only in change coupling.
- **Browser reads of an existing global** (F6). The `window.QuestionCards` read sites grew from one to two in one file, with no import edge.

Both are reported as coupling, not as wrong-way dependencies.

A third seam is outside the import graph by design: **the fake-DOM test harness** (LIN-4252, 4265–4285). It is the window's largest change by volume: 71 files under `tests/`, +47,315 / −7,874 lines, most of it moving client suites onto one shared fake. The pieces are `tests/unit/helpers/fake-dom.js` (860 lines), `tests/unit/helpers/client-world.js` (the vm loader) and `tests/unit/fake-dom-census.test.js` (686 lines, which keeps the count of hand-written fakes from growing). Tests are not areas in the guide, so `seams.mjs` does not read them, and this review does not grade them. It bears on two things it does grade: browser code has no import edges at all, so this harness is the only machine-checked way to exercise `public/` scripts without a browser, which is a precondition for refactoring F6. Its own churn belongs to the Stability review, and any duplication in the suites to Code Quality.

## 6. Change coupling beside import coupling

`cochange.mjs --days 60`, one guide, both commits (E/`cochange-code-*`).

- **Windows and overlap.** Baseline `2026-09-06T06:00Z → 2026-11-05T06:00Z`; HEAD `2026-09-06T19:02Z → 2026-11-05T19:02Z`. They share 59.457 of 60 days (99.09%), 846 commits. Five commits left at the start (all 2026-09-06, from the Flight Companion, Scan-due and levers work) and 29 entered at the end. **Not a trend.**
- **Totals.** Changes 851 → 875; touching two or more areas 390 → 391; pairs 76 → 76; `shallow: false` at both.
- **Unmapped files 5416 → 5746: +331, −1, all outside the source remit.** The exact sets are in E/`unmapped-paths-*.txt`, produced by E/`unmapped-paths.mjs` with the tool's own modules:

  | directory | new unmapped paths |
  |---|---|
  | `docs/papers` | 233 (235 of them from one commit, `e4fa8d34`, the LIN-4257 paper) |
  | `docs/reviews` | 63 (run 7 and Drift run 3 evidence) |
  | `tests/unit` | 17 (fake-DOM moves) |
  | `docs/plans` | 12 (Survey docs, `29f14bf6`) |
  | other | 2 `tests/e2e`, 2 `scripts`, 1 `tests/fixtures`, 1 `experiments` |

  One unmapped path left (`docs/reviews/capacity-levers-map-2026-08-15.md`). The guide maps source only, so this is not a guide defect.

**Top pairs at HEAD, against run 7's values** (run 7 values are its §6 table at `2eb73ae0`):

| pair | run 8 (`af55cb73`) | run 7 (`2eb73ae0`) | Δ | import link? |
|---|---|---|---|---|
| Browser code + Pages | 137 | 140 | −3 | no |
| Runs + Web routes | 112 | 111 | +1 | yes |
| Agent API + Runs | **105** | 101 | +4 | yes |
| Browser code + Web routes | 100 | 102 | −2 | no |
| Pages + Web routes | 96 | 98 | −2 | yes |
| Pages + Runs | 92 | 92 | 0 | yes |
| Web routes + Wiring | 92 | 93 | −1 | yes |
| Browser code + Runs | 87 | 86 | +1 | no |
| LLM + Runs | **87** | 84 | +3 | yes |
| Runs + Wiring | 82 | 82 | 0 | yes |

Agent API + Runs moved from fourth to third. Its rise and LLM + Runs's rise come from the window's stage-contract and cost commits that touch `proxy-preamble.js`, `prompt-templates.js`, `prompt-template-defs.js` or `cost-read.js`: `29f14bf6`, `d9c0f1ca`, `2f0c9d5b`, `0c3d3448`, `6ff38cf5`, `473cc865`.

The four pairs with Other features rose by exactly the number of window commits that touch both sides. `d9c0f1ca` and `2f0c9d5b` are the only window commits that touch Other-area files (`stage-writes.js`). Other + Runs 31 → 33, LLM + Other 11 → 13 and Agent API + Other 12 → 14 each rose by 2. Other + Web routes 29 → 30 rose by 1, because only `2f0c9d5b` also touches Web routes.

- **No-link pairs: 20 → 19.** The one that closed is Agent API + Other (now linked through `stage-writes`). That is an artefact of the guide gap, not a new seam.
- **Candidate seam (unchanged).** Browser code + Pages (137) and browser code + Web routes (100) are still the largest pairs with no import link. The coupling runs through markup and `window.X`, which the import graph cannot see (F6).
- **Falling browser pairs.** Browser + Pages and Browser + Web routes fell because the five commits that left the window were Flight Companion, Observation and Scan-due work on `public/` and page renderers. Not a seam change.
- **Agent API + Reports (14, no link)** is the cost read's shared dependency (`cost-read` is read by Reports and Agent API), unchanged in shape. It is not a missing seam.

## 7. Guide proposals (prose only; nothing is edited)

None of these is a code move, and none is enforced by a test, check or count.

- **P7min — place `lib/stage-writes.js` in LLM & prompts (measured; recommended).** It sits beside the templates that declare `writes`. Result (E/`guide-experiments-run8.txt`, `P7min-stage-writes`): links 1270; LLM ↔ Other 1/1; catch-all 16; no pair opens; Agent API → LLM 37 → 38. Platform is equally valid, since the file has no imports. The choice does not change any knot.
- **P2c — the Costs & usage area (measured; not recommended).** See §3. Keep the cost files in Runs.
- **P1d — place the catch-all files (run 7's proposal, still stands).** Run 7 measured it on the 16 files it had. It does not place `stage-writes.js`; P7min does.
- **P1c — hygiene (still stands).** Drop the dead `task-cost|` alias (N8). Narrow the `workspace-` pattern to the Auth files it means.
- **P2 (tree.js and model routing), P3 (`experiments/rebuild-*`), P4 (a rulings pattern)** — each still stands as run 7 wrote it. None is measured again in this run.

## 8. Existing tickets and the carried items

Checked against code at `af55cb73` and Linear state read on 2026-11-05 (ticket states from the Harbour API; PR state from `gh pr list`).

| ticket | state | what it covers | this run |
|---|---|---|---|
| LIN-4193 | Backlog | name the cost modules into an area; rename `weekly-budget.js` | **P2c result commented here**; do not adopt a separate cost area |
| LIN-4299 | In Progress | Drift run 4, on this window | **receives the per-kind roster** (§3) |
| LIN-4258, LIN-4259 | Backlog | stage-contract follow-ons (work mandate; write-policy wording) | still the owners; anchors unchanged |
| LIN-4154 | Backlog | `fmtDuration` out of `render-run-steps.js` | anchors unchanged (`render-run-steps.js:258`) |
| LIN-4155 | Backlog | `applyDefaultDispatchHarness` out of `proxy-preamble.js` | anchor now `:153` |
| LIN-3922, LIN-3923, LIN-3736, LIN-3737, LIN-3738, LIN-3555, LIN-2600, LIN-1249 | Backlog | `tree.js` re-export; LLM ↔ Providers knot; stable-stringify; preamble credential provisioning; attachments; `RefResolutionError`; dead imports in `routes/proxy.js`; `server.js` | unchanged; `server.js` and `proxy.js` numbers as in §1 |
| LIN-4235 | Backlog | delete the legacy `[usage]` fold after 2026-12-04 | may retire `usage-snapshot-intake` (P1d) |
| LIN-4238, LIN-4244 | Backlog | F6 client follow-ons of the Home feature | unchanged |
| LIN-4028, PR #2185 | In Progress; PR OPEN, last updated 2026-10-30 | recorded routing ruling | would add `lib/routing-ruling.js` to the catch-all (N12) and touches `dispatch-entrance.js`, `dispatch-factory.js`, `proxy-instructions.js`, `session-telemetry.js` |
| LIN-4292, PR #2315 | In Progress; PR OPEN, last updated 2026-11-05 19:41Z | remove method-presence guards in `public/` | not on main; touches F6's files; re-measure when it lands |
| LIN-4195, LIN-4176, LIN-4179, LIN-3720 | Done | cost rebuild; one cost read; catch-all map | why N6's two reads are not ticketed |

## 9. Follow-ups minted: none

Before deciding I searched Linear for the findings above, including "stage-writes", "stage kind", "per-kind", "Costs & usage", "window.X" and "seams". No ticket names the roster coupling, the stage-writes gap or the P2c result, and the closest tickets are owned (LIN-4299, LIN-4258, LIN-4259, LIN-4193).

1. **N1 (stage-writes gap):** a guide proposal (P7min), not a code move. **Not minted.**
2. **`map:stage-kind-roster`:** Drift owns the duplicated decision; LIN-4299 is in progress on this window. **Not minted.**
3. **P2c:** measured and not recommended. **Result commented on LIN-4193.** Not minted.
4. **F6:** the window's change is one read site and one API member, and the feature that caused it is finished. A ticket to "reduce `window.X`" would not be one move. **Not minted.**
5. **Stage contract:** LIN-4258 and LIN-4259 already own the follow-ons. **Not minted.**

Nothing in the window adds a `lib/` → `routes/` import, opens a knot pair, or adds a wrong-way edge on a placed map. Those are the things that would justify a new seam ticket in a window this size. Zero follow-ups is a valid outcome.

## Adversarial Second-Read

**Tier 2.** A fresh-context sub-agent with no memory of the report-writing turns. It was given the repository at the two SHAs, the window, the tools and the evidence folder (not its research notes), and the question. It was told to form its own answer from git and the tool output **before** reading the report, then compare. It did not read the Linear ticket or its comments.

**Question:** *What is the largest item in this window that this report missed or misfiled?*

**The reader's answer, in full:**

> **Verdict: DISAGREE**, on one item the report files as out of scope. The report's core ranking holds.
>
> **Your largest item (from step 1, before reading the report):** `d9c0f1ca` (LIN-4253). The preamble's input contract changed from stage `kind` to a template-declared `writes` value. Entrances now resolve it through `stageWrites(kind)` (`lib/prompt-templates.js:201`; `lib/dispatch-entrance.js:1085`; `routes/workspace-api-feedback.js:270, 335`), and `lib/proxy-preamble.js:14` imports the new leaf `lib/stage-writes.js`.
>
> **Differed from the report's top finding:** YES. The report ranks N1 (the catch-all placement of `stage-writes.js`) first. My item is the contract change in the same commit, which the report rates separately as "healthy" under `seam:stage-contract`. The ranking is still defensible.
>
> **Largest item missed or misfiled:** the fake-DOM test-seam consolidation, LIN-4265 through LIN-4283 (`591bb959`, `1b83bbff`, `069585bb`, and others).
> - It is the window's largest change by volume: 71 test files, +47,315 / −7,874 lines.
> - It adds new shared seams: `tests/unit/helpers/fake-dom.js` (860 lines), `client-world.js`, `live-console-world.js`, and `real-dispatch-disclosure.js`. Forty test files import the first two.
> - It adds an AST-based guard, `tests/unit/fake-dom-census.test.js`. Its ratchet list is 25 entries at HEAD, down from the 56-file baseline it landed with.
> - Browser code has zero import edges in `seams.mjs`, so this vm-over-fake-DOM harness is the only machine-checked seam over `public/`. That bears directly on "can be refactored."
> - The report dismisses it in one clause: "The rest is test-only (the fake-DOM moves)" (§1), plus 17 unmapped test paths (§6). It appears nowhere in the findings or the trend ledger.
> - Excluding tests from the import graph is defensible. Omitting a change this large from the findings is the miss.
>
> **Spot-checks:** window is 29 commits, 10 touching `lib routes public server.js`, +717 / −178 (held); edge diff is exactly two added edges into `stage-writes.js`, none removed (held); zero `lib/` → `routes/` imports at HEAD (held); knot pairs 12 → 12 (held); `cost-read.js` 651 → 762 (held); `proxy-preamble.js:14` and `prompt-template-defs.js:42` import `stage-writes` (held); `stageWrites` at `prompt-templates.js:201`, `SURVEY_KINDS` absent from `lib routes` at HEAD (held); `QuestionCards` reads at `prompt-section.js:1030, 1043` (held); `window.X` assignments in `public/common.js` 51 → 51 (held for that file only); "window spans about 13 hours from 06:00Z" (off: the earliest window commit is 08:39Z, so the span is about 10.5 hours); Linear and PR states in §8–9 (not verified by the reader).
>
> **Anything else the author should fix:**
> - §Headline says "Web routes … unchanged," but §1.2 shows `routes/workspace-api-feedback.js` now calls `stageWrites` at two sites (LIN-4251). Reword.
> - N6 (`cost-read.js`) is marked "settled." LIN-4263 (`6ff38cf5`) added an opt-in `perDispatch` mode that `routes/proxy-compute.js` sets. It also added `followUpTo` to the shared `LINEAGE_IDENTITY_PROJECTION` in `lib/dispatch-store.js`. That is a changed read contract across Agent API and Runs, and it deserves more than a size note.
> - Correct the window start time in §0.
>
> **Housekeeping:** an early command wrote `scratch-head-seams.json` into the workspace directory, outside the repo. I deleted it. All my outputs are in the scratchpad.

**Author's judgement on the reader's answer.** I checked the reader's facts against git. The window start was wrong (fixed, §0). The `followUpTo` read-contract change is real and was under-weighted as "settled" (fixed: N6 now says "read contract widened (watch)", with `dispatch-store.js:275`). The Web-routes headline was inconsistent with §1.2 (fixed). The fake-DOM harness is the largest change by volume and was missing from the findings. It is out of the import graph by design, so I did not grade it as a seam. I added it as §5's third item, with the numbers, and gave its reading for browser code's rebuild readiness. I did not rank it above N1, because it adds no edge between areas and creates no knot. The reader's "DISAGREE" is about omission, and that omission is now fixed. The reader's own top item (the stage contract in `d9c0f1ca`) is covered by `seam:stage-contract` and the preamble row in §1.2, and its ranking is left as written.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

## 11. Trend ledger

Names are run 7's stable names. `N1` keeps its name and gets a new delta. `seam:stage-contract` and `map:stage-kind-roster` are new. None is retired.

| name | severity | run 7 (`2eb73ae0`) | run 8 (`af55cb73`) | delta |
|---|---|---|---|---|
| F1 `knot:agents-chat<->runs` | High | 31/37 | 31/37 | unchanged |
| N1 `knot:other-features-catch-all` | Medium | 16 (Medium–High as a map) | 17 | **worsened** by one unplaced leaf (`stage-writes.js`); LLM ↔ Other 1/1 → 2/1 |
| F6 `knot:browser-window-globals` | Medium | 66 assignments (loose 107) | 66 (loose 107) | **unchanged** by assignments; `QuestionCards` read sites 1 → 2, API +1 member |
| N6 `hub:cost-read.js` | Medium | 11 in (7 cross, 4 areas); 651 lines | 11 in (7 cross, 4 areas); 762 lines; `followUpTo` added to the shared lineage projection | unchanged by import; read contract widened (watch); size is Code Quality's |
| N10 `map:cost-family-split` | Low–Medium | 12 of 68 | 12 of 68 | unchanged; P2c measured, not adopted |
| N9 `door:request-usage-loader` | healthy, Low | 7 importers | 7 | unchanged |
| N11 `door:home-waiting` | healthy, Low | 1 read, 1 renderer | same | unchanged |
| N12 `map:rulings-family-split` | Low | 6 areas | 6 areas | unchanged (PR #2185 pending) |
| `seam:stage-contract` | healthy | — | vocabulary leaf + one resolver + four entrances | **new as named**; the window's clearest "better" |
| `map:stage-kind-roster` | Low–Medium | — | 9 files in 4 areas | **new as named**; Drift owns (LIN-4299) |
| `hub:dispatch-store.js` | Low–Medium | 8 in (7 cross); 10 out | 8 in (7 cross); 10 out | unchanged by import |
| `wiring: server.js` | Low, watch | 4,713 lines; 209 imports; 30 inline routes | same | unchanged |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 11 / 10 | 11 / 10 | unchanged (anchor `:152 → :153`) |
| F3 `knot:providers->upward` | Medium | 4 | 4 | unchanged |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | 53 | unchanged |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 unused of 96 | same | unchanged |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 | unchanged |
| N2 `hub:task-page-loader.js` | Medium | 8 in (7 cross) / 20 out (9 cross) | same | unchanged |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 4 | 4 | unchanged |
| N4 `hub:run-controls.js` | Medium, watch | 21 in | 21 in | unchanged |
| N5 `knot:task-model` | healthy | 2 files | 2 files | unchanged |
| N7 `door:request-usage-intake` | healthy, Low | 3 | 3 | unchanged |
| N8 `map hygiene: deleted task-cost` | Low | alias + 2 comments | alias + 2 comments | unchanged |
| `map hygiene: workspace- prefix (Auth)` | Low | 14 `workspace-*` files in Auth (17 named); mocks 6 importers | same | unchanged |
| `hub:tree.js` | watch | 8 in (6 cross) | same | unchanged |
| `hub:render-run-steps.js` (FU-1) | Medium | 4 in (2 cross) / 4 out (4 cross) | same | unchanged |
| F2 `knot:runs<->page-renderers(render-swipe)` | retired | — | — | retired (run 4) |

**Change-coupling top pairs** (values at `2eb73ae0` / `af55cb73`):

| pair | run 7 | run 8 | Δ |
|---|---|---|---|
| Browser code + Pages | 140 | 137 | −3 |
| Runs + Web routes | 111 | 112 | +1 |
| Agent API + Runs | 101 | 105 | +4 |
| Browser code + Web routes | 102 | 100 | −2 |
| Pages + Web routes | 98 | 96 | −2 |
| Pages + Runs | 92 | 92 | 0 |
| Web routes + Wiring | 93 | 92 | −1 |
| Browser code + Runs | 86 | 87 | +1 |
| LLM + Runs | 84 | 87 | +3 |
| Runs + Wiring | 82 | 82 | 0 |

Totals: 851 / 390 / 76 → 875 / 391 / 76. No-link pairs 20 → 19.

## 12. Sibling hand-offs

- **Drift & Coherence** owns decisions held in several places, file-level direction, text contracts and comment truth. Handed here, not graded:
  - the per-kind roster (§3), now to LIN-4299;
  - N6's "Pure" wording (`lib/cost-read.js:36`);
  - the stale `lib/home-row-states.js:121` note on the task page's read (run 7 handed it over; unchanged);
  - the "two 409 codes" and settled-check copies (`place-ledger.md:91`).
- **Code Quality** owns function size, including `cost-read.js` (762 lines) and `server.js`.
- **Stability** owns churn; nothing here.
- **Survey (read only; not edited).** Branch `origin/claude/cool-rubin-6acj5j` at `2651606e`. The rows for this window agree with the numbers above: `place-ledger.md:133` (LIN-4248), `:146` (LIN-4253), `:149` (LIN-4251), `:161–163` (LIN-4263, LIN-4276, LIN-4277) and `:181` (LIN-4293). The F1 and N1 cross-links are the same as run 7's. The P2c result (§3) bears on the Survey's cost rows only as a measurement, not a verdict.
- **Simple Dispatcher** is still flat CommonJS. Its clone's HEAD is `07c88f7a` (2026-11-04T23:46:41Z) with no `import`/`export` in `dispatcher.js`. It stays outside `seams.mjs`, and no tool was built for it.
- **Harbour docs.** `docs/architecture/source-map.md` changed in the window (template count 17 → 19; `stage-writes.js` added). Recorded, not reviewed here.

## 13. Measurement notes

1. **Commands.** Listed per file in E/`README.md`. The tools were run from the repo root with `scripts/code-shape/`, at both SHAs, with `areas.head-af55cb73.json`.
2. **Reproduction.** The re-run outputs matched the files in E/ byte for byte. The three proposal guides were re-run at both SHAs and matched E/.
3. **Edge and unmapped sets.** Complete for imports (the edge-list diff). For unmapped files, E/`unmapped-paths.mjs` reproduces the exact set `cochange.mjs` counts.
4. **Browser counts.** Strict `window.X =` counting (assignment lines; `=`-only, not `==`/`===`). The loose pattern is kept for trend comparison with run 7 and is not used to rank.
5. **Not done:** the app was not run and no e2e was run (source and git objects only). `public/prompt-section.js` was read in the hunks that changed (Go state, the focus rule and the QuestionCards reads), not line by line.
6. **Evidence housekeeping.** Run 8's scripts were copied from run 7. Their run-7 labels were corrected to run 8, and they were regenerated with identical numbers. A leftover run-7 script was removed. No file under `_evidence-2026-11-05/` (run 7) or `_evidence-2026-11-05-drift/` was changed.
