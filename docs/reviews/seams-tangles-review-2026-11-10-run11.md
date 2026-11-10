# Seams & Tangles Review — 2026-11-10, run 11 (delta vs run 10; first baseline for simple-dispatcher)

Task: LIN-4402 · Parent: LIN-4344 ("Harbour carries the loop", round 1) · Previous: `seams-tangles-review-2026-11-08-run10.md` (run 10, LIN-4387, PR #2372, merge `82fdb88be`) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`, HEAD versions (unchanged since `bad9d719`) · Evidence: `docs/reviews/_evidence-2026-11-10-run11/` (see its `README.md`). "E/" below means that folder.

Review-only. The changes in this PR are this report, E/, and one Waiting entry in `docs/areas/runs-and-dispatch.md` (distilled to fit the cap). No code, config, guide (`docs/areas/areas.json`), tool or other doc was edited. simple-dispatcher was read, not edited; it has no area-note edit and no PR from this run.

## Headline

- **LinearViewer is structurally unchanged since run 10.** Same 13 reciprocal knot pairs, same one 9-area cycle, no knot new or resolved. The movements are ±1 to ±4 on existing edges, and most of them are the window's new code reading the same modules it always read.
- **Area by area, against run 10.** **LLM & prompts ⇄ Runs & dispatch** (F1, High): 31/49 → **32/50**, a count rise, the kind mostly unchanged; the one new kind is the look-first route reading run history (§3.1). **Auth ⇄ LLM** (N3, Low–Medium): 6/4 → **5/3**, improved by LIN-4393, which removed the size-of-move setting's edges. **Agent API ⇄ Runs** (F4): 45/10 → **44/10**. **Web → Auth**: 69 → **67**. **Other features** (N1): 18 → **18**. **Pages, Browser code, Platform, Task model, Reports, Providers**: unchanged or ±1 on one edge.
- **Against the whole window** (`aec9e16be` → `b315e0e8f`, 39 first-parent commits, 103 production files, +5806/−1597): Runs → LLM 37 → 50, Agent API → LLM 37 → 43, Agent API ⇄ Other features opened at 2/1 (run 10 already reported it), Auth ⇄ LLM 4/3 → 5/3. Run 10 measured most of this; §1 gives only the post-run-10 moves.
- **Change coupling:** 929 / 413 / 76 → **942 / 418 / 76** (60 days). The same 19 pairs lack an import link. Every pair that grew and has a link is an ordinary cross-area pair; the browser pairs that grew without a link are F6.
- **One new finding, Low:** no contract row pins a follow-up to a finished session with no halt, but the leftover step (LIN-4373) resumes its build's session that way (§3.0b). Filed as a Waiting entry in `runs-and-dispatch.md`.
- **A knot the first draft dropped, now added (§3.1b):** Agent API ⇄ LLM & prompts, 43/4 and 47 crossings, the third-largest pair. Run 10's headline named it but no ledger row carried it. Its reverse edges include a routing helper, `applyDefaultDispatchHarness`, imported from the Agent API preamble by two LLM modules.
- **Carried and re-verified, not re-filed:** the runner-contract seam across two repos (§3.0; sha256 pinned on both sides, the limiter-window↔cap match still by comment), and the agent-api and other-features Waiting entries from run 10.
- **simple-dispatcher: baseline, no prior run.** `seams.mjs` reads **0 of 52** root-level CommonJS files (could-not-read, reported as such). A literal-`require` reader kept in E/ reads all 52: 0 unmapped, 0 unresolved, 0 non-literal; 20 directed area links; 6 reciprocal pairs, two of which come from one file, `shutdown.js`, placed in State (a guide-placement finding, not a code tangle). Co-change 104 / 50 / 15, 243 unmapped. 38 of its 123 ticket ids also occur in LinearViewer (a mention count, not coupling).
- **Notes.** One Waiting entry added to `runs-and-dispatch.md`, and the note distilled from 6142 to 6143 bytes (cap 6144) with every Lesson kept. `agent-api.md`, `other-features.md` and `llm-and-prompts.md` re-verified, no edit. The look-first and autopilot-precedence files produce no note entry (§3.5).
- **Adversarial second read:** Tier 2, fresh-context sub-agent (§Adversarial Second-Read).

## 0. What was measured

- **Commits.** Baseline: `bad9d719ba01ffea2ba5339c32ea354e67bf5682` (run 10's measured commit). Window start: `aec9e16be4afa9793a34cefe6a49a8eecd90736c` (last main commit before 7 Nov 00:00 UTC). Head: `b315e0e8f3e1e5f3b5d6e634e53c5dc83b41d754` (origin/main at the mint and at the PR's base; checked again at close-out). simple-dispatcher: `07c88f7a338b3e19a01070775e1f4d4cfc91f040` (window start), `5d8489e7fd8434f0e69af7df11a3746790abbe64` (head).
- **Research-stage figures** (the survey and research comments on the ticket) were re-run at these commits. Where a research figure was wrong it is named in §12.
- **One registry for every LinearViewer measurement:** `docs/areas/areas.json` at HEAD (E/`areas.head-registry.json`). Two checks recorded apart from code movement:
  - **Guide edit between `aec9e16be` and `bad9d719`.** The registry lived at `scripts/code-shape/areas.json` at `aec9e16be` (LIN-4371 moved it). Run with its own window-start registry (E/`areas.window-start-guide-aec9e16b.json`), `seams.mjs` gives the same areas and links as with the HEAD registry; only `areaMapSource` differs (E/`seams-code-aec9e16be…-guide-window-start.json` against `…-guide-head.json`). **The guide edit alone moved nothing.**
  - **Guide edits in `bad9d719..b315e0e8f`:** none. `git log bad9d719..b315e0e8f -- scripts/code-shape docs/areas/areas.json` is empty.
- **Tool changes:** none. `git diff --name-only bad9d719 b315e0e8f -- scripts/code-shape` is empty. The HEAD tool at `bad9d719` with the HEAD registry reproduces run 10's evidence (E/ holds the run-10 files; the seams JSON and the cochange JSON match run 10's `_evidence-2026-11-08-run10/` copies key for key, apart from `commit`, `areaMapSource` and the window dates).
- **Scope and could-not-read counts (LinearViewer):**

  | commit | files in scope | parse failures | unresolved relative imports | non-literal dynamic imports | unmapped source files | links | reciprocal pairs | cycle groups |
  |---|---|---|---|---|---|---|---|---|
  | `aec9e16be` (window start) | 544 | 0 | 4 | 0 | 0 | 69 | 12 | one 9-area group |
  | `bad9d719` (run 10) | 554 | 0 | 4 | 0 | 0 | 70 | 13 | one 9-area group |
  | `b315e0e8f` (head) | 556 | 0 | 4 | 0 | 0 | 70 | 13 | one 9-area group |

  The four unresolved relative imports are the same four as run 10 (F8, `routes/test.js`). Unmapped files outside the source remit (docs, evidence, tests): 7216 → 8061. None of them is source.
- **File-level edge diff, `bad9d719` → `b315e0e8f`** (E/`edges-code-*.json`, `edgeList`): **12 added, 9 removed**, net +3 (2132 → 2135). Listed in §2.
- **Direction rule.** `lib/` → `routes/` imports: 0 at all three commits. Run logic importing page renderers: `Runs → Pages` 8 → 8 (E/supplementary S7).
- **Supplementary figures** (carried rows, run 10's script adapted for the new commits and the HEAD registry for both; E/`supplementary-figures.txt`): F5 route→route 53 → 53; F7 `routes/proxy.js` named lib imports 96 → **91**, unused 45 → **40**; F6 `window.X =` in `public/` 108 → 108, assignments 67 → 67; N8 the `task-cost` alias still named in the guide, 2 comment references; N7/N9/N11 unchanged. Only `public/llms.txt` changed in `public/`.

## 1. Changes since run 10 (first), then the whole window

**Since run 10** (`bad9d719..b315e0e8f`, 13 first-parent commits; the themes from their merge titles): the look-first route (LIN-4370), Periodicals feeding the notes (LIN-4380), landed lane state (LIN-4381), the autopilot precedence leaf (LIN-4382), removing the size-of-move setting (LIN-4393), the area-notes pointer (LIN-4346), the review tail driving the review in place (LIN-4349), LIN-4358's after-reads, the Stability Review run 5 (LIN-4394, the window's last commit, `b315e0e8f`) and the Design & Interface review (LIN-4391, `3bfa70b29`).

- **38 production files** (`lib`, `routes`, `public`, `server.js`): 36 modified, **2 new**: `lib/recommendation-look-first.js` (228 lines, LLM & prompts) and `lib/prompts/autopilot-precedence.js` (40 lines, LLM & prompts). +1025 / −471.
- **Leads from the ticket, checked:**
  - *Where does `lib/recommendation-look-first.js` land, and does it open a new Recommendation/Runs ↔ notes edge?* It lands in LLM & prompts by the pattern. It opens **no** edge to the notes or to Periodicals. It opens three cross-area edges: `→ lib/recent-runs.js` (Runs), `→ lib/providers/state-map.js` (Providers) and `→ lib/utils/time.js` (Platform). `dispatch-entrance.js` (Runs) and `routes/workspace-api.js` (Web routes) import it.
  - *Did LIN-4393 shrink `hub:workspace-preferences.js`?* Yes: 20 → **16** importers (all cross-area), outbound 5 → 4, 572 → 511 lines (§3.4).
  - *Did `routes/proxy-compute.js` gain a crossing?* Yes, one: `→ lib/run-evidence.js` (Agent API → Runs). The file grew by 66 lines (§3.8).
  - *Did run 10's adversarial reader's gap (simple-dispatcher's side of the contract) close?* Not in this tool, and it cannot: see §5 and §3.0.

**Whole window** (`aec9e16be` → `b315e0e8f`): 103 production files, +5806 / −1597 (the ticket's figure, reproduced).

## 2. The import graph: placement versus code

**File-level edges that changed since run 10** (E/`edges-code-*.json`, `edgeList`):

| change | edge | areas | why it matters |
|---|---|---|---|
| + | `lib/recommendation-look-first.js` → `lib/providers/state-map.js` | LLM → Providers | new LLM→Providers edge (LLM ⇄ Providers 13 → 14) |
| + | `lib/recommendation-look-first.js` → `lib/recent-runs.js` | LLM → Runs | new LLM→Runs edge (F1, §3.1) |
| + | `lib/dispatch-entrance.js` → `lib/recommendation-look-first.js` | Runs → LLM | F1's other direction |
| + | `routes/workspace-api.js` → `lib/recommendation-look-first.js` | Web → LLM | a way in: the workspace API reaches the LLM layer through look-first. Web → LLM is 83 → 87 across the window and zero since run 10, because the `settings.js` edge below goes |
| + | `routes/proxy-compute.js` → `lib/run-evidence.js` | Agent API → Runs | Agent API → Runs 45 → 44 net, with the two removals below |
| + | `lib/prompts/autopilot-kickoff.js` → `lib/prompts/autopilot-precedence.js`; `lib/openrouter.js` → look-first; look-first → `lib/as-asked.js`, `lib/prompt-template-defs.js`, `lib/recommendation-facts.js`, `lib/size-of-move.js` | intra-LLM | the leaf and the route stay inside LLM & prompts |
| − | `lib/dispatch-entrance.js` → `lib/workspace-preferences.js` | Runs → Auth | Runs → Auth 31 → 30 |
| − | `lib/recommendation-input.js` → `lib/workspace-preferences.js` | LLM → Auth | LIN-4393; LLM → Auth 4 → 3 |
| − | `lib/workspace-preferences.js` → `lib/size-of-move.js` | Auth → LLM | LIN-4393; Auth → LLM 6 → 5 |
| − | `routes/settings.js` → `lib/workspace-preferences.js`; `routes/settings.js` → `lib/size-of-move.js`; `routes/workspace-api-prompts.js` → `lib/workspace-preferences.js` | Web → Auth / Web → LLM | LIN-4393's settings and prompt routes; Web → Auth 69 → 67 |
| − | `routes/proxy.js` → `lib/dispatch-store.js`; `routes/proxy.js` → `lib/periodical-runs.js` | Agent API → Runs | Agent API → Runs 45 → 44 |
| − | `lib/periodicals.js` → `lib/prompt-template-defs.js` | intra-LLM | `periodicals.js` outbound 2 → 1 |

Net: LLM ⇄ Runs +1/+1, Auth ⇄ LLM −1/−1, Agent API → Runs −1, Web → Auth −2, Runs → Auth −1, LLM ⇄ Providers +1/0, LLM → Platform +1. No knot pair opened or closed. `lib/` → `routes/`: none.

**Placement.** Every new production file has a pattern in the registry. Both new files land in LLM & prompts. The catch-all (`lib/` → Other features) gained no file since run 10. Its 18 files are unchanged (§3.2).

**Wrong-way dependencies.** Checked at HEAD: no `lib/` → `routes/` import; no run logic importing a page renderer (`Runs → Pages` 8, unchanged). One direction is worth naming and is not a new wrong way: the new `recommendation-look-first.js` → `recent-runs.js` edge is LLM reading Runs' history, which is the F1 direction (§3.1).

## 3. Findings, severity-ranked, trend-framed

Ordering: severity first, then the window's movement. Stable names are run 9's and run 10's where the row existed; new names are marked **new**.

### 3.0 `seam:runner-contract` (two repos) · **Medium** · **carried** (run 10 §3.0, unchanged)

- **What it is.** `lib/runner-kit/contract.json` (66 rows, 12 areas) is byte-identical to simple-dispatcher's `test/fixtures/runner-contract.json`. Both sides pin the sha256 `602ab014062857bfba3e9aa543088472c3ba5dbc7cb0673da909e67ed727eb40`: LinearViewer's `tests/unit/runner-kit-contract.test.js` and simple-dispatcher's `test/runner-contract.test.js`. Re-verified at HEAD (E/`contract-sha.txt`).
- **The 429 policy and the `[done]` PR choice are pinned**, with the same expected result on both sides (the `exchange` rows and the `report` rows). The research's "unpinned" claim about these was wrong and is corrected in §12.
- **The unpinned match, carried.** The server limiter window (`routes/proxy.js:256`, `windowMs: 60 * 1000`, per credential after proof, keyed at `routes/proxy.js:239–250`) and the broker's wait cap (`lib/runner-kit/broker.mjs:97`, `EXCHANGE_MAX_WAIT_SECONDS = 60`) are still two 60-second numbers in two files whose only link is a comment. The Waiting entry in `docs/areas/agent-api.md` is still true; it stays, and no second entry is added (§9).
- **Severity stays Medium.** It changes what a builder must edit in two repos and the budget every Agent API consumer sees. It is the first cross-repo item on the ledger, and it is carried, not new.

### 3.0b `seam:leftover-resume-contract` (two repos) · **Low** · **new** (coverage gap, not observed breakage)

- **What.** The leftover step (LIN-4373, `lib/dispatch-leftover.js`) posts a `leftover` follow-up to a finished build's own session, for `cli` and `web` targets (`RESUMABLE_TARGETS`, line 26). In simple-dispatcher the same follow-up resumes a completed session: `followup.js` `resolveFollowUpTarget` lets a COMPLETED session through to `resume` (the code path after the `AWAITING_FOLLOWUP` signal branch).
- **What the contract does not pin.** Every follow-up row in `lib/runner-kit/contract.json` sits under a halt: `pause` (claimed for a live session, failed with none) or `stop` (left for a live session, failed with none). The one row with no halt is the unknown-repo follow-up, which is `not-checked`. **No row pins "a follow-up to a finished session with no halt is claimed and resumed".** That is the leftover step's normal path, so a change to either side could move it without a contract failure.
- **What the contract's vocabulary already says.** `session: live` means a finished, resumable session in simple-dispatcher's suite: `test/runner-contract.test.js` builds a `COMPLETED` session for `live` (lines 104–107). So the value already covers the case; only the no-halt row is missing.
- **Verified before filing.** I read the rows, both suites' fixture builders, and the resolution path (`followup.js` lines 35–140). I did not run a break; the gap is that nothing would fail.
- **Where it is filed.** `docs/areas/runs-and-dispatch.md`, Waiting, cites `lib/runner-kit/contract.json` first (the area's own file), names the Seams & Tangles reading and cites this report second. Route: a row, or a named gap in the contract's note.

### 3.1 F1 `knot:agents-chat<->runs` · **High** · **carried, count up, kind mostly unchanged** (run 10: 31/49; now **32/50**)

- **Name reconciliation.** Run 10's stable name `knot:agents-chat<->runs` is kept for the ledger's continuity. It names the registry pair **LLM & prompts ⇄ Runs & dispatch** (the older "agents-chat" area name predates the registry). Nothing was silently renamed.
- **What moved.** LLM → Runs 31 → **32** (new: `recommendation-look-first.js` → `recent-runs.js`). Runs → LLM 49 → **50** (new: `dispatch-entrance.js` → `recommendation-look-first.js`). Since the window start: 31/37 → 32/50.
- **Kind.** Run 10 found the LLM ⇄ Runs edges were mostly vocabulary leaves (`as-asked.js`, `should-mock-ai.js`, `leftover-words.js`). The new LLM → Runs edge is different in one respect: it is the recommendation layer reading run history (`recent-runs.js`) to decide the look-first sequence. It is one edge, and it is the first LLM-to-Runs read of run state rather than vocabulary. Judgement: the kind has widened by one edge; severity stays High because the count is the knot's measure.
- **Builder rule.** None yet. The look-first route reads run history inside the LLM layer by design (the sequence is code, LIN-4370). A rule would be "a read of run history from LLM goes through `recent-runs.js`", which is what the code already does. No note entry (§9).
- **Watch.** `lib/recommendation-look-first.js` is the file to watch in run 12: it has 7 outbound and 3 inbound edges already, and it is the window's largest new coupling (§3.4).

### 3.1b `knot:agent-api<->llm` · **Medium** · **carried, added to the ledger this run** (43/4, 47 crossings, unchanged since run 10)

- **What it is.** Agent API → LLM 43 (37 at the window start), LLM → Agent API 4: 47 file-level crossings, the third-largest pair after F1 and F4. Run 10's headline named it (37/4 → 43/4), but no finding or ledger row carried it, so this run adds the row.
- **Kind: mostly vocabulary.** Agent API reads LLM vocabulary: `routes/proxy-writes.js` (`as-asked.js`, `size-of-move.js`), `lib/proxy-preamble.js` (`as-asked.js`, and `stage-writes.js` in Other features), `lib/proxy-instructions.js` (`as-asked.js`, `size-of-move.js`). This is the same kind as F1's leaves: the proxy's guards and its instruction text read the one definition of the heading and the record shape.
- **Reverse edges: one to name.** Of the four LLM → Agent API edges, `lib/model-routing.js:26` and `lib/model-routing-harnesses.js:21` import `applyDefaultDispatchHarness` from `lib/proxy-preamble.js` (line 154), the default-harness policy (it falls back to `DEFAULT_DISPATCH_HARNESS`). `lib/chat-tools.js:134` imports `shouldUseMcpTokenField` and related helpers from the same preamble. The registry places the preamble in Agent API by its `^lib/proxy-` prefix, so routing policy sits in an Agent API file and LLM depends on it. §2's wrong-way check (`lib/` → `routes/`) cannot see this kind.
- **Severity Medium** because the reverse dependency is one small helper, but the placement is the item. Routing: a Waiting entry in `docs/areas/agent-api.md` (the helper's home); no LLM note entry, since LLM only imports.

### 3.2 `knot:agent-api<->other-features` · **Medium** · **carried**, unchanged (2/1)

- The pair is `routes/proxy-writes.js` and `lib/proxy-graphql-errors.js` (Agent API) with `lib/as-asked-seal.js` (Other features). The seal sits in the catch-all by a deliberate pin in `tests/unit/area-map-placement.test.js:69–72`. The pin is quoted in the pin's own comment; a move reverses a deliberate placement and is an owner decision (proposal P10a, §7).
- The Waiting entry in `docs/areas/other-features.md` is still true (E/`seams-code-…` shows the same two edges). No edit.

### 3.2b N1 `knot:other-features-catch-all` · **Medium** · **unchanged** (18 → **18**)

- Method (matches run 10): Other features files with at least one cross-area edge. 18 at `bad9d719` and 18 at `b315e0e8f`, the same 18 files.
- The window added no production file to the catch-all. Its files with cross-area edges, at both commits: `as-asked-seal`, `cost-format`, `dashboard-refresh`, `home-pipeline`, `home-row-states`, `home-rows`, `home-view`, `key-state-holders`, `key-state`, `live-anchor`, `ruling-settled`, `ruling-standing`, `stage-writes`, `subtree-index`, `task-facts-holder`, `task-state`, `usage-snapshot-intake`, `waiting-section`.

### 3.3 N3 `knot:auth->llm(model-routing)` · **Low–Medium** · **improved** (6/4 → **5/3**)

- LIN-4393 removed the size-of-move setting's edges: `workspace-preferences` → `size-of-move`, `recommendation-input` → `workspace-preferences`, and the settings and prompt routes into both (§2). Auth ⇄ LLM now 5/3.
- The remaining Auth → LLM edges still include `lib/workspace-api-mocks.js` (in Auth by its `workspace-` prefix, not by its role; the "map hygiene: workspace- prefix" item from run 9 and run 10, still open, still drives this knot). Cause to fix: the prefix, not the edges.
- No note cites an Auth file (`auth-accounts-and-workspaces.md` does not exist, because no builder rule has come out of it). Unchanged.

### 3.4 Watches (not findings on their own)

- **`hub:workspace-preferences.js` · Low–Medium · improved.** 20 → 16 importers (all cross-area), outbound 5 → 4, 572 → 511 lines. LIN-4393 did this; the watch can narrow.
- **`hub:openrouter.js` · Low–Medium · watch.** 33 importers (25 cross-area), unchanged. Outbound 10 → 11 (the new intra-LLM edge to look-first). 2210 → 2242 lines. One OpenRouter client is a door by design; the watch is the size and breadth.
- **`lib/recommendation-look-first.js` · watch · new.** 228 lines; 3 inbound (2 cross-area: Runs `dispatch-entrance.js`; Web `routes/workspace-api.js`), 7 outbound (3 cross-area: Runs, Providers, Platform). It is a new way in from Web to the LLM layer and a new LLM read of Runs. Not a knot by itself; the second read (§Adversarial) is the right place to test whether it is over-coupled for a route.
- **`hub:periodicals.js` · Low–Medium · watch, not crossed.** 1318 → 1353 lines (LIN-4380: Periodicals feed the area notes); importers unchanged at 8; outbound 2 → 1 (the intra-LLM edge to `prompt-template-defs.js` went). Run 10's trigger ("a further content kind") was not crossed. The Drift & Coherence hand-off of the `periodicals.js` content is still open (§11).
- **`hub:dispatch-store.js` · Low–Medium · unchanged in kind.** 8 → 7 importers (7 → 6 cross-area), outbound 10, 4524 → 4530 lines. Size belongs to Code Quality (`code-quality-review-2026-11-04.md`).
- **`hub:dispatch-factory.js` · Low–Medium · unchanged.** 9 in (5 cross), 18 out (14 cross), 1408 lines. Watch the breadth, not a split.
- **N2 `hub:task-page-loader.js` · Medium · unchanged.** 8 in (7 cross), 21 out (10 cross), 1544 lines.
- **`hub:cost-read.js`, `hub:run-controls.js`, `hub:tree.js`, `hub:as-asked` (`lib/as-asked.js`).** Unchanged in the edge data: cost-read 11 in (7 cross) / 7 out; run-controls 21 in (19 cross); tree 8 in (6 cross); as-asked 25 in (12 cross, one more importer than run 10).
- **`wiring: server.js` · Low, watch.** 4757 lines (unchanged from run 10), 204 outbound (unchanged). The composition root did not grow this window. LIN-1249 (Backlog) owns decomposition.
- **`lib/dispatch-leftover-hook.js`.** 1 inbound, 5 outbound, 0 cross-area outbound; unchanged.

### 3.5 New seams, measured healthy

- **`seam:as-asked`.** `lib/as-asked.js` remains a pure owner guarded on the proxy lane, by design (run 10 §3.5), with 25 importers now. Healthy.
- **`seam:leftover-step`.** `lib/dispatch-leftover.js` is pure; `lib/dispatch-leftover-hook.js` is the I/O. Healthy, apart from §3.0b.
- **`seam:autopilot-precedence` (LIN-4382).** `lib/prompts/autopilot-precedence.js`: 40 lines, one importer (`autopilot-kickoff.js`), no outbound edges. A leaf. Healthy.
- **`seam:look-first-route` (LIN-4370).** The route in §3.4 is the window's only new coupling worth watching. Its cross-area edges from the LLM layer (to Runs, Providers and Platform) are the window's new LLM crossings; F1 and F3 carry them on the ledger.
- **LIN-4358 catalog cluster** (`openrouter-catalog.js`, `catalog-rate.js`, `model-pricing.js`, `model-routing-harnesses.js`): unchanged; one owner (LLM & prompts).

### 3.6 F6 `knot:browser-window-globals` · **Medium** · **unchanged** (67 → 67)

- Counted as `window.X =` assignments in `public/` (the run 10 grep method): 67 at both commits. Only `public/llms.txt` changed in `public/`, with no new global.
- The browser-code pairs without an import link are F6's coupling and grew by one each in four cases: Browser ↔ Web routes 102 → 103, Browser ↔ Runs 89 → 90, Browser ↔ LLM 48 → 49, Agent API ↔ Browser 46 → 47. Browser ↔ Pages stays at 138. These are classic scripts sharing globals, not an import seam.

### 3.7 `seam:periodical-mint` residue · **Medium, owned** (LIN-4318, Backlog)

- `lib/dispatch-entrance.js:1226` still reads prompt text for the grant: `declaresPeriodicalGrant({ kind, periodicalId, autopilot: isAutopilotVariant(prompt) })`. Unchanged. Owned by LIN-4318 (Backlog). No new ticket.

### 3.8 Ticket-named knots, unchanged or improved

- **F3 `knot:providers->upward`** · Medium · **unchanged in kind.** Providers → LLM stays 4. LLM → Providers 13 → 14 (the look-first edge, §3.4). LIN-3923 (Backlog) owns the decision.
- **F4 `knot:runs->agent-api(proxy-preamble)`** · Medium · **improved by one.** Agent API → Runs 45 → 44 (the two `routes/proxy.js` edges removed, one `proxy-compute.js` edge added); Runs → Agent API 10 → 10. LIN-3738 (Backlog) owns `proxy-preamble.js`.
- **F5 `knot:routes-as-libraries(dashboard)`** · Medium · **unchanged.** Route → route 53 → 53 (cross-area 3 → 3).
- **F7 `knot:dead-import-inflation(routes/proxy.js)`** · Low · **improved.** Named lib imports 96 → **91**, unused 45 → **40** (E/supplementary S3, run 10's heuristic).
- **F8 `knot:production-loads-routes/test.js`** · Low · **unchanged.** 4 unresolved relative imports, as run 10.
- **`map:wake-credential` (guide hygiene)** · Low · **unchanged.** `wake-credential` is named in Auth's pattern, but Runs' `wake-[^/]*` claims it first, so Auth's name is dead. Registry issue, no area file to cite: closing comment only.
- **`map hygiene: workspace- prefix (Auth)`** · Low · **unchanged** (§3.3).
- **`routes/proxy-compute.js` growth** (+66 / −13) · watch · one new crossing (`run-evidence.js`, Runs). Its error mapping repeats the same chain three ways: carried in the Agent API Waiting entries (run 10 and LIN-4358 review), not re-filed.

### 3.9 Ways in (summary)

The ways in are the `entryFiles` of each area (E/`seams-code-b315e0e8f…`, `areas[].entryFiles`): Agent API 13, Auth 57, Front end: pages 55, LLM & prompts 74, Other 17, Providers 32, Reports 6, Runs 94, Task model 2, Web routes 22, Platform 23, Wiring 0 (`server.js` only). The new way in this window is `routes/workspace-api.js` → `recommendation-look-first.js` (§3.4). Nothing else changed.

## 4. Ways in and rebuild readiness

Per area at HEAD (files · internal imports · cross-area in / out · entry files): from `seams-code-b315e0e8f…-guide-head.json`.

| area | files | internal | cross in | cross out | entry | rebuild readiness and what stops it |
|---|---|---|---|---|---|---|
| Runs & dispatch | 110 | 198 | 246 | 177 | 94 | Not ready to move. High in-degree (246 cross-area); F1 and F4 are its knots; its note is at cap. |
| LLM & prompts | 86 | 94 | 257 | 78 | 74 | Not ready. Largest area by files; the Periodical engine and recommendation code share its regex (proposal P-LLM1, §7). |
| Platform & plumbing | 25 | 2 | 283 | 0 | 23 | Ready as a leaf: no outbound cross-area edge; the in-degree is the point. |
| Front end: server-rendered pages | 91 | 286 | 102 | 178 | 55 | Ready within its own area. Its knots are with Auth (14/11), Runs (13/8) and Other (9/8). |
| Web routes | 38 | 31 | 22 | 399 | 22 | Ready as a routing layer, but out-degree 399 means every route change touches its owners. |
| Auth, accounts & workspaces | 64 | 115 | 188 | 38 | 57 | Ready as a seam. Its sharpest knot is N3 (Auth ⇄ LLM, 5/3), driven by the `workspace-` prefix; Auth ⇄ Pages and Auth → Providers are unchanged. |
| Providers | 37 | 40 | 129 | 14 | 32 | Ready except F3 (Providers → LLM 4): LIN-3923 decides it. |
| Agent API (proxy) | 32 | 45 | 34 | 162 | 13 | Ready once F4 (proxy-preamble) moves (LIN-3738). Its limiter↔cap seam (§3.0) travels with it, and so does the routing helper LLM imports from the preamble (§3.1b). |
| Other features (catch-all) | 18 | 6 | 36 | 26 | 17 | Not a unit of rebuild: homeless files by design. N1 is its only knot. |
| Reports & operator tools | 8 | 3 | 8 | 35 | 6 | Ready; small. |
| Task model | 2 | 1 | 9 | 3 | 2 | Ready; a healthy leaf (N5, unchanged). |
| Front end: browser code | 44 | 0 | 0 | 0 | 0 | Not a seam in the import graph (classic scripts). F6 is its only knot. Rebuild needs F6's global set retired first. |
| Wiring (server.js) | 1 | 0 | 0 | 204 | 0 | The composition root. Ready only after LIN-1249. |

## 5. The seams the import graph does not show

- **The runner contract (two repos).** §3.0. Its sha is pinned both sides; its limiter↔cap match is not. The graph cannot show it.
- **The leftover step's resume of a finished session (two repos).** §3.0b. The graph cannot show it; the contract's halt rows are the only pin.
- **The broker's 429 back-off and the `[done]` PR choice.** Pinned (§3.0). Not findings.
- **The `[done]`/leftover wording.** Harbour renders the leftover prompt; simple-dispatcher relays it and parses none of it (run 10 §5; re-read at HEAD, unchanged). A documentation link, not a behavioural seam.
- **Shared ticket ids** are mentions, not code coupling: 38 of simple-dispatcher's 123 distinct ticket ids in its 60-day first-parent subjects and bodies also appear in LinearViewer's (same start, `bad9d719`). Recorded as a baseline figure only.

## 6. Change coupling beside import coupling

**LinearViewer, 60 days** (`cochange.mjs --days 60`, HEAD registry; E/`cochange-code-*`):

| | `bad9d719` (run 10) | `b315e0e8f` (head) |
|---|---|---|
| changes | 929 | 942 |
| touching 2+ areas | 413 | 418 |
| pairs | 76 | 76 |
| unmapped files | 7216 | 8061 |
| shallow | false | false |

Window overlap: 59.76 of 60 days (99.6%). 929 commits are shared; 13 are new at HEAD. The unmapped count grew by 845, all docs and evidence (the registry is code-only); that is not coupling.

**Top pairs at HEAD (run 10 → HEAD), with whether the pair has an import link:**

| pair | run 10 | head | link |
|---|---|---|---|
| Front end: browser code ↔ server-rendered pages | 138 | 138 | no (F6) |
| Agent API ↔ Runs & dispatch | 119 | **123** | yes |
| Runs & dispatch ↔ Web routes | 118 | **120** | yes |
| LLM & prompts ↔ Runs & dispatch | 105 | **109** | yes (F1) |
| Browser code ↔ Web routes | 102 | 103 | no (F6) |
| Pages ↔ Web routes | 98 | 99 | yes |
| Pages ↔ Runs & dispatch | 96 | 97 | yes |
| Web routes ↔ Wiring | 93 | 93 | yes |
| Browser code ↔ Runs & dispatch | 89 | 90 | no (F6) |
| Runs & dispatch ↔ Wiring | 84 | 85 | yes |

**Pairs with no import link:** 19 at both commits, the same 19 (E/`cochange-*`). Browser code is in 12 of them (F6). The other seven are Agent API ↔ Reports 14, Other ↔ Reports 5, Providers ↔ Reports 2, and the Task model pairs (Agent API ↔ Task 2, Auth ↔ Task 2, Task ↔ Web routes 2, Task ↔ Wiring 1).

**Candidate seams from change coupling:** none new. Every pair that grew and has no link is a browser-code pair (F6). Every other growing pair has an import link.

**simple-dispatcher, 60 days** (`cochange.mjs` at `5d8489e` with its registry, E/`cochange-sd-*`): 104 changes, 50 touching 2+ areas, 15 pairs, 243 unmapped files, not shallow. This is its baseline. Top pairs: Loop ⇄ State 19, Reapers ⇄ State 17, Loop ⇄ Reapers 16, Loop ⇄ Test harnesses 14, Launch ⇄ State 11, Reapers ⇄ Test 11, State ⇄ Stop hook 11, State ⇄ Test 11, Loop ⇄ Stop hook 10, Reapers ⇄ Stop hook 10.

- **Loop ⇄ Test harnesses (14 co-changes, no require link).** The `e2e-*.js` harnesses drive the dispatcher as a process, not through `require`. A process boundary, the expected shape, and the one candidate seam in simple-dispatcher's change coupling.
- Of the 15 co-change pairs, 14 have a require link. The exception is that process boundary.

## 7. Guide proposals (labelled; nothing edited)

Recorded apart from code movement. None is applied. No test, check or count is added to enforce the guide (contract item 2).

- **P-SD1 `shutdown.js` placement (simple-dispatcher).** `shutdown.js` is registered in State, config & host process, but it requires `feedback.js` (Stop hook) and `signal-guard.js` (Reapers). Its two reciprocal pairs (State ⇄ Stop hook 1/10, State ⇄ Reapers 1/14) are one host-process orchestrator placed in a foundation area. Proposal: move `shutdown.js` to a host area, or rename State as "State, config & host process" with an explicit host note. Not a code tangle. Source: `docs/module-map.md:392` (the shutdown bullet) and the require reader's crossings in E/.
- **P10a `as-asked-seal.js` → LLM & prompts.** Closes the Agent API ⇄ Other features pair (2/1). Needs `tests/unit/area-map-placement.test.js:69–72` changed, which reverses a deliberate pin. Owner's decision.
- **P-LLM1 split the LLM catch-all.** `llm-and-prompts` holds the Periodical engine and the recommendation code as well as the LLM layer, which is why it fills first (6073 bytes). Proposal: a Periodical area or a recommendation area. This is a larger tidy, recorded here and in the closing comment, not a Waiting entry: the note is at its cap and an entry would need its own pruning first.
- **P-XN1 a cross-area and cross-repo notes home.** `LEFTOVER_RULE` and both READMEs give a leftover one home in one repo. A seam between areas or repos has none, so the runner contract is filed in LinearViewer's `agent-api.md` and `runs-and-dispatch.md` with simple-dispatcher's side named in prose, and its own `launch-and-harnesses.md` carries a Lesson on the same contract. Proposal: a contract area both registries name. (Also in the closing comment.)
- **P-SD2 simple-dispatcher's README Periodical paragraph.** `docs/areas/README.md` lacks LinearViewer's paragraph on how a Periodical entry names its source and its report. Proposal only.
- **P-T1 `seams.mjs` CommonJS and a scope flag.** The tool reads `import` and scopes `server.js|lib|routes|public`; simple-dispatcher is root-level `require`. Proposal: a `--scope` flag and a `require` reader (the scratch reader in E/ is the working sketch). The tool is not edited here.
- **P-REV1 review cadence and compaction for `docs/reviews/`.** 155+ entries and 43+ evidence folders grow faster than the code they measure (the ticket's own note). Proposal only.

## 8. Existing tickets and carried items

Re-read at HEAD (10 Nov):

| ticket | state | relation |
|---|---|---|
| LIN-3738 | Backlog | `proxy-preamble.js` out of Agent API (F4) |
| LIN-3923 | Backlog | LLM ⇄ Providers decision (F3); the knot is now 14/4 |
| LIN-4318 | Backlog | Periodical mint by id (`seam:periodical-mint`, §3.7) |
| LIN-4193 | Backlog | cost modules into an area (no new edge) |
| LIN-4028 | **In Progress** | routing ruling; recommend-and-dispatch ignores a set model |
| LIN-4258, LIN-4259 | Backlog | prompt work-mandate and write-policy wording |
| LIN-1249 | Backlog | `server.js` decomposition (wiring watch, §3.4) |
| LIN-4344 | Backlog | the parent loop this run baselines |
| LIN-4387 | Done | run 10 |
| LIN-4394 | Done | Stability Review run 5 (the window's last commit) |

Findings already filed as tickets stay in this report only. The new §3.0b is not a ticket; it is a Waiting entry.

## 9. Follow-ups minted: none

No task was minted. Routing per the periodical contract:

- **`docs/areas/runs-and-dispatch.md`:** one new Waiting entry, §3.0b. Distilled from 6142 to 6143 bytes: wording shortened in several Lessons and Waiting entries, no Lesson removed, no open claim dropped. The `lib/session-summary.js` entry was checked after an accidental cut and restored verbatim.
- **`docs/areas/agent-api.md`:** the limiter↔cap Waiting entry (run 10) re-verified; no edit.
- **`docs/areas/other-features.md`:** the as-asked-seal Waiting entry (run 10) re-verified; no edit.
- **`docs/areas/llm-and-prompts.md`:** no entry. The F1 rise has no builder rule (§3.1), and the note is at cap (6073 bytes).
- **simple-dispatcher:** no note edit and no PR. The baseline lives in this report. Its `launch-and-harnesses.md` entries (a Lesson on the 429 policy, LIN-4378, and a Waiting entry on trimming the B1–B5 witness cases) were re-verified: `harbour-token-mcp-server.js:55–56` holds `EXCHANGE_RETRIES = 2` and `EXCHANGE_MAX_WAIT_SECONDS = 60`, and `test/harbour-token-mcp-server.test.js` still has the B1–B5 cases. Both still true; no edit.

## 10. Trend ledger

Stable names are run 9's and run 10's where the row existed. Severity is this run's. "Δ run 10" is against `bad9d719`. simple-dispatcher rows are marked **baseline** (no prior run).

| name | severity | run 10 (`bad9d719`) | run 11 (`b315e0e8f`) | Δ run 10 |
|---|---|---|---|---|
| `seam:runner-contract` (two repos) | Medium | pinned both sides; limiter↔cap by comment | same | **carried** (§3.0) |
| `seam:leftover-resume-contract` (two repos) | Low | — | no follow-up-to-finished-session row (no halt) | **new** (§3.0b) |
| F1 `knot:agents-chat<->runs` (= LLM & prompts ⇄ Runs & dispatch) | High | 31/49 | **32/50** | worse in count, kind mostly unchanged (§3.1) |
| `knot:agent-api<->llm` | Medium | 43/4 (named in the headline only) | 43/4 | **added to the ledger** (§3.1b); unchanged since run 10 |
| `knot:agent-api<->other-features` | Medium | 2/1 | 2/1 | unchanged (§3.2) |
| N1 `knot:other-features-catch-all` | Medium | 18 | 18 | unchanged (§3.2b) |
| F6 `knot:browser-window-globals` | Medium | 67 | 67 | unchanged; four no-link pairs +1 (§3.6) |
| `seam:periodical-mint` | Medium, owned (LIN-4318) | unchanged | unchanged | unchanged (§3.7) |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 6/4 | **5/3** | improved (§3.3) |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 45/10 | **44/10** | improved by one (§3.8) |
| F3 `knot:providers->upward` | Medium | 4 | 4 | unchanged; LLM → Providers 13 → 14 (§3.8) |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | 53 | unchanged (§3.8) |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 unused of 96 | 40 unused of 91 | improved (§3.8) |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 | unchanged (§3.8) |
| `hub:periodicals.js` | Low–Medium, watch | 1318 lines; out 2 | 1353 lines; out 1 | watch, not crossed (§3.4) |
| `hub:openrouter.js` | Low–Medium, watch | 33 in (25 cross); out 10 | 33 in (25 cross); out 11; 2242 lines | watch (§3.4) |
| `hub:workspace-preferences.js` | Low–Medium, watch | 20 in | **16 in**; out 4; 511 lines | improved (§3.4) |
| `hub:dispatch-factory.js` | Low–Medium, watch | out 18 (14 cross) | out 18 (14 cross) | unchanged (§3.4) |
| `hub:dispatch-store.js` | Low–Medium | 8 in (7 cross); 4524 lines | 7 in (6 cross); 4530 lines | in-degree −1 (§3.4) |
| N2 `hub:task-page-loader.js` | Medium | 8 in (7 cross); out 21 | unchanged | unchanged (§3.8) |
| N4 `hub:run-controls.js` | Medium, watch | 21 in | 21 in | unchanged (§3.4) |
| N6 `hub:cost-read.js` | Medium, watch | 11 in (7 cross); 7 out | unchanged | unchanged (§3.4) |
| `hub:tree.js` | watch | 8 in (6 cross) | unchanged | unchanged (§3.4) |
| `door:as-asked` (`lib/as-asked.js`) | healthy | 24 in (12 cross) | 25 in (12 cross) | healthy (§3.5) |
| `seam:autopilot-precedence` | healthy | — | leaf: 40 lines, 1 in, 0 out | **new** (§3.5) |
| `hub:recommendation-look-first.js` | watch | — | 3 in (2 cross), 7 out (3 cross); 228 lines | **new** (§3.4) |
| `wiring: server.js` | Low, watch | 4757 lines; out 204 | 4757 lines; out 204 | unchanged (§3.4) |
| `map:wake-credential` (guide hygiene) | Low | shadowed name | shadowed name | unchanged (§3.8) |
| `map hygiene: workspace- prefix (Auth)` | Low | drives N3 | drives N3 | unchanged (§3.3) |
| `seam:as-asked`, `seam:leftover-step`, `seam:call-budget`, LIN-4358 catalog cluster | healthy | as run 10 | as run 10 | unchanged (§3.5) |
| simple-dispatcher `seam:runner-contract` side and its require graph | baseline | — | 52 files, 20 directed links, 6 reciprocal pairs | **baseline** (§5, §6) |
| simple-dispatcher `shutdown.js` placement | baseline, guide finding | — | 2 reciprocal pairs from one file | **baseline** (§7, P-SD1) |
| simple-dispatcher Loop ⇄ Test harnesses (process boundary) | baseline | — | 14 co-changes, no require link | **baseline** (§6) |
| simple-dispatcher co-change top pair (Loop ⇄ State) | baseline | — | 19 | **baseline** (§6) |

**All thirteen reciprocal knot pairs** (run 10 → head; E/`seams-code-*`). The ledger rows above cover five of them; the rest are unchanged except as shown:

| pair (a → b / b → a) | run 10 (`bad9d719`) | head (`b315e0e8f`) | ledger |
|---|---|---|---|
| Agent API ⇄ LLM & prompts | 43/4 | 43/4 | §3.1b |
| Agent API ⇄ Other features | 2/1 | 2/1 | §3.2 |
| Agent API ⇄ Providers | 21/3 | 21/3 | no row; unchanged |
| Agent API ⇄ Runs & dispatch | 45/10 | 44/10 | F4 |
| Auth ⇄ Front end: pages | 14/11 | 14/11 | no row; unchanged |
| Auth ⇄ LLM & prompts | 6/4 | 5/3 | N3 |
| Auth ⇄ Providers | 13/1 | 13/1 | no row; unchanged |
| Front end: pages ⇄ Other features | 9/8 | 9/8 | no row; unchanged (N1 region) |
| Front end: pages ⇄ Runs & dispatch | 13/8 | 13/8 | no row; unchanged |
| LLM & prompts ⇄ Other features | 2/2 | 2/2 | no row; unchanged |
| LLM & prompts ⇄ Providers | 13/4 | 14/4 | F3 (Providers → LLM unchanged at 4) |
| LLM & prompts ⇄ Runs & dispatch | 31/49 | 32/50 | F1 |
| Other features ⇄ Runs & dispatch | 6/6 | 6/6 | no row; unchanged |

**Change-coupling top pairs:** §6.

## 11. Sibling hand-offs

- **Drift & Coherence** (`drift-coherence-review-2026-11-06.md`): run 10 §11's hand-off of the `periodicals.js` content is still open. `periodicals.js` grew 35 lines this window (LIN-4380); the hand-off is not re-raised here (run 10 owns it; this run keeps it open).
- **Stability** (`stability-review-2026-11-08.md`, LIN-4394): inside this window, and its commit is the window's last (`b315e0e8f`). Churn is its remit; the per-file churn here is not re-measured.
- **Code Quality** (`code-quality-review-2026-11-04.md`): owns function and file size, including `dispatch-store.js` (4530 lines) and `proxy-compute.js`. The seam view defers to it.
- **Comprehension Debt** (`comprehension-debt-review-2026-11-05.md`) and **Design & Interface** (`design-interface-review-2026-11-08.md`, LIN-4391): their own remits. Nothing in the seam ledger overlaps with their findings beyond the look-first route, which a Design read of the autopilot precedence leaf would touch.
- **Simple-dispatcher's side** of every item above has no report series in simple-dispatcher; this report is the baseline (per the ticket's contract item 4).

## 12. Measurement notes

- **Research figures corrected.** The research comment said the broker's 429 policy and the `[done]` PR choice had "no shared pin". That was wrong at HEAD: both are pinned by the contract's `exchange` and `report` rows on both sides (§3.0). The survey's "unpinned behaviour" list was corrected the same way. The genuinely unpinned items are the limiter↔cap match (carried) and the no-halt follow-up (§3.0b, new).
- **Research's session-value question.** The research asked whether `session: live` covers a finished session. It does, in simple-dispatcher's suite (`test/runner-contract.test.js:104–107` builds a `COMPLETED` session for `live`). The gap is the missing no-halt row, not the vocabulary.
- **Research's `knot:agents-chat<->runs` naming.** Reconciled in §3.1.
- **N1 method.** Run 10's N1 = 18 reproduces as Other-features files with a cross-area edge (§3.2b), not as the pair total.
- **The HEAD tools reproduce run 10's evidence** (§0), and the window-start registry reproduces HEAD's links (§0).
- **Brief corrections.** A Code Quality report does exist (`code-quality-review-2026-11-04.md`). Run 10's stable name matches no registry name (§3.1).
- **simple-dispatcher's tool gap** is a fact about the tool, not a finding about simple-dispatcher: `seams.mjs` reads 0 files there (§0, §6), and the scratch reader in E/ is the baseline method for run 12.
- **Scratch reader.** `E/require-graph.mjs` is a short reader (86 lines) in the evidence folder, not a tool change. It reads committed objects only (`git ls-tree`, `git show`), counts non-literal `require(` as could-not-read, and maps both ends through simple-dispatcher's own `docs/areas/areas.json`, first match wins. It reproduces the research's counts exactly (52 files; 6 reciprocal pairs; 20 directed links).
- **Setup runs that failed and were fixed.** A zsh `$W:` expansion sent the window-start guide read to the wrong object; `sed -i` failed on macOS; and the adapted supplementary script had a commit-to-file mapping and a guide path left from run 10. Each was corrected and re-run, and none changed a figure in this report.

## Adversarial Second-Read

- **Tier:** 2 (accepted): a fresh-context general-purpose sub-agent with no memory of the report-writing turn, given read access to both clones and the question only (not this report's ranking, and not its conclusions). It was told to answer from the repositories, and could read the report to judge its coverage.
- **Question (verbatim):** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's answer (in full):**

> **1. Largest item missed: the Agent API (proxy) ⇄ LLM & prompts knot is absent from the report's ledger and findings.**
>
> At HEAD it is a reciprocal pair with 43/4 edges and 47 file-level crossings, the third-largest pair after F1 and F4. It has no row in the §10 trend ledger, no §3 finding, and no §2 mention. The only trace is §1's whole-window line, "Agent API → LLM 37 → 43". Run 10 named this pair explicitly ("Agent API ↔ LLM & prompts 37/4 → 43/4 … + the proxy guards' edges"), so run 11 dropped a tracked item. Eight of the 13 reciprocal pairs have no ledger row. Agent API ⇄ LLM is the largest of those by crossings.
>
> The crossings are mostly proxy code importing LLM vocabulary, and the report never examines them:
> - `routes/proxy-writes.js` imports `as-asked.js` and `size-of-move.js` (added in the window).
> - `lib/proxy-preamble.js` imports `as-asked.js` (added by LIN-4353/4360/4362). It also imports `stage-writes.js` (Other features), which the report does not mention.
> - `lib/proxy-instructions.js` imports `as-asked.js` and `size-of-move.js`.
>
> The wrong-way direction is also unexamined. Three LLM modules import from the Agent API preamble: `lib/model-routing.js:26`, `lib/model-routing-harnesses.js:21` and `lib/chat-tools.js:134`. The one imported by `model-routing.js` is `applyDefaultDispatchHarness` (`lib/proxy-preamble.js:154`), which is routing policy living in a file the registry places in Agent API via the `^lib/proxy-` prefix. The report's §2 wrong-way check only tests `lib/` → `routes/`, so it cannot see this.
>
> **2. Evidence**
>
> - `docs/reviews/_evidence-2026-11-10-run11/seams-code-b315e0e8f…-guide-head.json`, `knots.pairs`: `Agent API (proxy) <-> LLM & prompts 43/4 crossings 47`. The pairs list has 13 entries, and the report names only about 6 of them in its ledger.
> - Start, run 10 and head counts from the `…-window-start`, `…-bad9d719…` and `…-b315e0e8f…` seams JSON files: Agent→LLM 37/4, 43/4, 43/4.
> - `grep -n "43" docs/reviews/seams-tangles-review-2026-11-10-run11.md` returns only line 11.
> - `git diff aec9e16be…b315e0e8f -- routes/proxy-writes.js | grep "^+import"` shows the three new imports.
> - `grep -n "proxy-preamble" lib/model-routing.js lib/model-routing-harnesses.js lib/chat-tools.js` confirms the reverse imports.
> - Contract hash check: `shasum -a 256` gives `602ab014…` for both `lib/runner-kit/contract.json` and simple-dispatcher's `test/fixtures/runner-contract.json`, so the report's cross-repo claim holds.
>
> **3. Why it matters**
>
> The report's stated purpose is to track the window's knots, and it instead presents the largest unlisted cross-area knot as if it were covered by run 10. A builder reading the ledger would not learn that the proxy write guard and preamble depend on LLM vocabulary, or that the LLM layer depends on the proxy preamble.
>
> **4. Confidence: medium.** I am confident the pair is missing from the ledger and findings. I am less sure it is the single largest item, because I did not check every Front-end, Auth and Providers pair in full, and the "misfiled" part (routing policy in `proxy-preamble.js`) is a judgement call. This would change my mind if the report or the ticket set a knot threshold that excludes 43/4, or if the owner decided the proxy's use of LLM vocabulary is by design, as with `as-asked`. Neither is stated in the report.

- **Check of the reader's claims (by me, after the reply):** the 43/4 pair with 47 crossings, the 13-pair list, the three imports `model-routing.js:26`, `model-routing-harnesses.js:21`, `chat-tools.js:134`, and `applyDefaultDispatchHarness` at `proxy-preamble.js:154` all hold. The report's first draft did not carry the pair, which is the miss.
- **Response.** Fixed in place: §3.1b added, the pair added to the §10 ledger, a full thirteen-pair table added, a Waiting entry added to `docs/areas/agent-api.md` for the reverse routing import, and the §4 readiness row updated. The reader's "largest" call is one judgement; the report keeps its own ranking (the runner contract first, carried) and records the reader's pick as §3.1b at Medium, not above it. The reader's "misfiled" point about `proxy-preamble.js` is recorded as a placement question, not a re-filing of the preamble.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
