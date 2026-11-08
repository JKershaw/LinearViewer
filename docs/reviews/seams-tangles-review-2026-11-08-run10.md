# Seams & Tangles Review — 2026-11-08, run 10 (delta vs run 9)

Task: LIN-4387 · Parent: LIN-3549 · Operator note: LIN-4349 (first live run under the LIN-4379 contract) · Previous: `seams-tangles-review-2026-11-06-run9.md` (run 9, LIN-4323, PR #2333, merge `fa3bd87a`) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`, HEAD versions at both commits · Evidence: `docs/reviews/_evidence-2026-11-08-run10/` (see its `README.md`). "E/" below means that folder.

Review-only. The changes in this PR are this report, E/, and one note entry in `docs/areas/other-features.md`. No code, config, guide (`docs/areas/areas.json`) or other doc was edited.

## Headline

- **Area by area, better or worse:** **LLM & prompts: worse in count, benign in kind** (F1 31/37 → 31/49). **Runs & dispatch: worse in count, benign in kind** (same knot). **Other features: worse** (a new Medium pair opened through `lib/as-asked-seal.js`). **Agent API: worse** (the same new pair; Agent API ↔ LLM 37/4 → 43/4). **Auth & workspaces: worse, Low–Medium** (N3, through the `workspace-` prefix item). **Pages, Browser code, Platform, Task model, Reports: unchanged or near it.** **Providers: two new edges into `description-edit.js` (from LLM), two into the sample-data leaf `fixture-parent.js` (from Auth and Agent API).** **Wiring: four new composition edges, all downward.**
- **The import graph grew by 76 edges and lost none** (E/`edges-code-*`). Links 1272 → 1316. Knot pairs 12 → 13; the knot group is the same 9 areas. **No `lib/` → `routes/` import exists at either commit.**
- **Changes since run 9, by consequence (§3):**
  1. **New `seam:runner-contract` across two repos (Medium, new, outside the import graph).** `lib/runner-kit/contract.json` grew by 374 lines (LIN-4384, LIN-4378) and is pinned by sha256 (`602ab014…`) in this repo and in simple-dispatcher's `test/fixtures/runner-contract.json`. The broker's 429 policy (`EXCHANGE_RETRIES = 2`, `EXCHANGE_MAX_WAIT_SECONDS = 60`) is held as constants in both repos. LIN-4378 also moved the Agent API's `proxyLimiter` from a per-address budget to a per-proven-credential budget (`routes/proxy.js`). No import edge shows any of this. **Ranked first among the window's new items**: it changes what a builder must edit in two repos and the rate-limit budget every Agent API consumer sees. It is not a knot count, so it is not in F1's ledger row.
  2. **F1 `knot:agents-chat<->runs` (High, unchanged severity).** The count went 31/37 → 31/49. Ten of the twelve new Runs → LLM edges land on modules that import at most two things, so the kind of coupling did not change; the count did.
  3. **New `knot:agent-api<->other-features` (Medium, new).** Two edges, one each way, opened by `lib/as-asked-seal.js`, which the placement test pins in the catch-all on purpose. N1 `knot:other-features-catch-all` goes 17 → 18. A proposal closes it (§7), but it reverses a deliberate pin, so it is an owner decision, not a tidy.
  4. **N3 `knot:auth->llm` (Low–Medium, worse).** 4/3 → 6/4, through `lib/workspace-api-mocks.js` (in Auth only by its `workspace-` prefix) and `lib/workspace-preferences.js`.
  5. **New watches:** `hub:openrouter.js` (33 importers in 7 areas, up from 30), `hub:workspace-preferences.js` (16 → 20 importers, all cross-area), `hub:dispatch-factory.js` (outbound 14 → 18). **New healthy seams:** `seam:as-asked` (a door by design), the leftover step, the call budget, and LIN-4358's catalog cluster.
- **Change coupling: 891 / 393 / 76 → 929 / 413 / 76.** The window is a strict superset (0 commits left, 38 entered), so this is 38 themed commits, not a trend. The 19 no-link pairs are the same 19. Every pair that grew has an import link, so none is a candidate seam.
- **Follow-ups minted: none** (§9). Every finding is either owned by an open ticket, a watch, or a note entry.
- **Notes:** one Waiting entry added to `docs/areas/other-features.md` (the seal). No entry for `llm-and-prompts.md` or `runs-and-dispatch.md`: the F1 growth is vocabulary-leaf growth that gives a builder no rule to follow (§3.1).
- **Adversarial second read:** Tier 2, fresh-context sub-agent (§Adversarial Second-Read).

## 0. What was measured

- **Commits.**
  - Baseline: `90542b2c79016d2a1d64f75cb5d3e9037080eae7` (run 9's measured commit).
  - Measured: `bad9d719ba01ffea2ba5339c32ea354e67bf5682`, origin/main when the build started (2026-11-08). The research stage measured `32da8d58`. Since then main gained `5ef9484f6` (LIN-4378 close-out tidy), `3d2046ac8` (#2369) and `bad9d719b` (#2367, LIN-4358 model facts from the OpenRouter catalog). **The research figures are superseded.** The build measured afresh; where it differs from research the difference is named (§12).
- **One guide, two registries.** The product registry `docs/areas/areas.json` (LIN-4371) is blob `4011e82a` at HEAD and was used for both commits. Run 9's guide, `scripts/code-shape/areas.json` (blob `642e9405`), is what the code-shape tool read at the baseline; it was removed from `scripts/code-shape` in the window. Both files are in E/.
- **Guide-only checks** (recorded apart from code movement):
  - At the baseline, run 9's guide and the HEAD registry give **identical** seams and cochange JSON (apart from the commit and path fields). **The guide edit alone moves nothing at the baseline.**
  - At HEAD, the one registry edit in the window (#2367 adds `catalog-rate` to the LLM & prompts pattern) moves LLM 83 → 84, Other 19 → 18, links 1318 → 1316, and the LLM ↔ Other pair (4,2) → (2,2). That is a guide movement, not code movement (E/`seams-code-bad9d719*-guide-research-registry.json`).
- **Tools.** Both tools changed in the window as a refactor (`claimedBy` moved into `code-shape-lib.mjs`; the default guide path now resolves through `lib/prompts/area-registry-path.js`, LIN-4383; the guide moved, LIN-4371). The run-9 reproduction: the HEAD tool at `90542b2c` with run 9's guide gives run 9's seams JSON and cochange JSON key for key, apart from the commit, `areaMapSource`, and (cochange) the window dates. **Tool change: none in the outputs measured here.**
- **Scope.** Files in the tool's scope: 544 → 554 (+10, the new production files, §1). **0 parse failures, 0 non-literal dynamic imports, 0 unmapped source files, 4 unresolved relative imports** (all in `routes/test.js`, F8), at both commits. The unmapped set (docs and tests, outside the source remit) is 6220 → 7216; no source file is unmapped.
- **Direction rule.** `lib/` → `routes/` imports: 0 at both commits.
- **Window.** `90542b2c..bad9d719b`: 38 first-parent commits entered, none left (E/`cochange-window-commits-*`). Production files changed (`lib routes public server.js`): **98** (88 modified, 10 added), +5244 / −1486.

## 1. Changes since run 9 (first)

**Import graph (E/`edges-code-*`, the `edgeList` diff is the complete change):**

| | run 9 `90542b2c` | run 10 `bad9d719` |
|---|---|---|
| files in scope | 544 | 554 |
| file edges (total / cross-area) | 2056 / 1272 | 2132 / 1316 |
| edges added / removed | — | **+76 / −0** |
| intra-area edges | 784 | 816 |
| knot pairs / group | 12 / 9 areas | **13** / 9 areas (same members) |
| area membership (LLM, Runs, Other, Providers) | 78, 108, 17, 36 | **84, 110, 18, 37** |

**New production files (A rows):** `lib/as-asked.js`, `lib/as-asked-seal.js`, `lib/size-of-move.js`, `lib/call-budget.js`, `lib/catalog-rate.js`, `lib/dispatch-leftover.js`, `lib/dispatch-leftover-hook.js`, `lib/prompts/leftover-words.js`, `lib/prompts/area-registry-path.js`, `lib/sample-data/fixture-parent.js`. (Run 9's ticket list had nine; `catalog-rate.js` came in #2367.) Mapped: LLM 6, Runs 2, Providers 1, Other 1.

**Changed production files by area** (through the registry, first match wins; this is where the notes were looked at first):

| area | files changed | what moved | finding |
|---|---|---|---|
| LLM & prompts | 26 | as-asked, size-of-move, leftover-words, call-budget, catalog-rate, model-pricing, periodicals | F1; hubs §2 |
| Runs & dispatch | 23 | leftover step, dispatch-factory, dispatch-store (+434 lines), wake; runner-kit contract (+374) and broker (+69) | §3.0 (runner contract); F1; `hub:dispatch-factory.js`; `hub:dispatch-store.js` |
| Agent API (proxy) | 17 | as-asked and size-of-move guards, preamble, instructions | new pair (§3.2); F4 unchanged |
| Web routes | 10 | `workspace-api-steps`, `dashboard-summaries`, `settings`, `workspace-api-prompts` | new edges to `openrouter.js` and `workspace-preferences.js` |
| Providers | 5 | `description-edit`, `fixture-parent` (sample data), interface | new edges into both (§3.3) |
| Front end: server-rendered pages | 5 | render and settings files | **nothing found**: no new edge touches a page file |
| Front end: browser code | 5 | `brief`, `close-out`, `recap`, `flight-companion`, `llms.txt` | **nothing found** beyond F6 (unchanged, §3.6) |
| Auth, accounts & workspaces | 3 | `workspace-api-mocks`, `workspace-preferences`, `workspace-change-log` | N3 (§3.3) |
| Other features | 2 | `as-asked-seal.js` (new), `key-state-holders.js` | new pair and N1 (§3.2) |
| Reports & operator tools | 1 | `pricing-conformance-sweep.js` (→ `catalog-rate.js`) | **nothing found**: Reports → LLM 5 → 6, the right direction |
| Wiring (server.js) | 1 | four new imports | §3.8 |
| Task model; Platform & plumbing | 0 | — | **nothing changed** |

## 2. The import graph: placement versus code

**Knot pairs** (`aToB / bToA`), run 9 → run 10, with the group unchanged:

| pair | run 9 | run 10 | delta |
|---|---|---|---|
| LLM & prompts ↔ Runs & dispatch | 31/37 | **31/49** | F1, count worse (§3.1) |
| Agent API ↔ Other features | — | **2/1** | **new** (§3.2) |
| Agent API ↔ LLM & prompts | 37/4 | 43/4 | + the proxy guards' edges |
| Agent API ↔ Providers | 20/3 | 21/3 | +1 (`proxy-compute` → `fixture-parent`) |
| Auth ↔ LLM & prompts | 4/3 | **6/4** | N3, worse (§3.3) |
| Auth ↔ Providers | 12/1 | 13/1 | +1 (`workspace-api-mocks` → `fixture-parent`) |
| LLM & prompts ↔ Providers | 11/4 | 13/4 | the LIN-3923 knot; both new edges point LLM → Providers (`as-asked`, `size-of-move` → `description-edit`), not the wrong way |
| LLM & prompts ↔ Other features | 2/1 | 2/2 | +1 (`as-asked-seal` → `as-asked`) |
| Other features ↔ Runs & dispatch | 6/5 | 6/6 | +1 (`dispatch-factory` → `as-asked-seal`) |
| Auth ↔ Pages; Pages ↔ Other; Pages ↔ Runs; Agent API ↔ Runs | 14/11; 9/8; 13/8; 45/10 | unchanged | — |

**Wrong-way and direction checks.** `lib/` → `routes/`: 0. Runs → Pages: 8 at both commits. No new edge runs from a page file or from Runs into a page renderer. Wiring's four new edges go down (to Runs and LLM), which is what a composition root does.

**Doors and hubs** (in / out, cross-area in brackets; E/`edges-code-*`):

| module | run 9 | run 10 | note |
|---|---|---|---|
| `lib/as-asked.js` (new) | — | **in 24 (12 cross, 5 areas), out 1** | a door by design (§3.5) |
| `lib/openrouter.js` | in 30 (22 cross, 7 areas), out 9 (2 cross), 2068 lines | **in 33 (25 cross, 7 areas), out 10 (2 cross), 2210 lines** | new watch (§3.4); the three new importers are `routes/dashboard-summaries.js`, `routes/proxy-compute.js`, `routes/workspace-api-steps.js` |
| `lib/workspace-preferences.js` | in 16 (cross, 5 areas), out 4 | **in 20 (all cross, 5 areas), out 5** | new watch |
| `lib/dispatch-factory.js` | out 14 (10 cross) | **out 18 (14 cross)** | new watch |
| `lib/task-page-loader.js` (N2) | in 8 (7 cross), out 20 (9 cross) | in 8 (7 cross), **out 21 (10 cross)** | worse by one (→ `as-asked.js`) |
| `lib/periodicals.js` | in 8 (8 cross, 4 areas), out 1, 1259 lines | in 8, out 2 (both intra-LLM), **1318 lines** | watch, not crossed (§3.4) |
| `lib/dispatch-store.js` | in 8 (7 cross), out 10 (3 cross), 4090 lines | in 8, out 10, **4524 lines**; graph unchanged | size is Code Quality's |
| `lib/openrouter-catalog.js` (LIN-4358) | in 10 (9 cross) | in 12 (9 cross, 5 areas), out 1 | a LIN-4358 cluster (§3.5) |
| `lib/run-controls.js`, `lib/tree.js`, `lib/cost-read.js`, `lib/proxy-scopes.js`, `lib/prompt-templates.js` | unchanged | unchanged | — |
| `server.js` | out 200 (4713 lines) | **out 204 (4757 lines)** | §3.8 |

**Hubs at the wrong altitude.** None found. The one door that is wide in and narrow out (`lib/as-asked.js`) is a vocabulary leaf, not a hub.

## 3. Findings, severity-ranked, trend-framed

### 3.0 `seam:runner-contract` (two repos) · **Medium** · **new as named, outside the graph**

- **What moved.** `lib/runner-kit/contract.json` +374 lines (LIN-4384, `936f52b7d`: report and sentinel rows, a shape check and a hash tripwire; LIN-4378, `f7d1923e6` and `5ef9484f6`: the `exchange` and `forward` rows that carry the brokers' 429 policy). `lib/runner-kit/broker.mjs` +69 / −16: a 429 on the bootstrap exchange is retried up to `EXCHANGE_RETRIES = 2` times, with waits capped at `EXCHANGE_MAX_WAIT_SECONDS = 60` (`broker.mjs:96–97`).
- **Two repos hold it.** The contract's sha256 is `602ab014062857bfba3e9aa543088472c3ba5dbc7cb0673da909e67ed727eb40` (checked at HEAD by `shasum -a 256`). It is pinned here (`tests/unit/runner-kit-contract.test.js:48`, with a failure message that names the re-copy) and in simple-dispatcher (`test/runner-contract.test.js:50`, `FIXTURE_SHA256`, beside `LV_COMMIT = 3d2046ac…`, the LinearViewer commit it was copied from). Simple-dispatcher's `harbour-token-mcp-server.js:55–56` holds the same two constants, and its test imports them (`test/harbour-token-mcp-server.test.js:25`). **Both pins match the current bytes.** A contract edit here therefore means a re-copy and a re-pin in another repo. The import graph cannot show that edge.
- **Per-credential limiter.** `routes/proxy.js` (`proxyLimiterKey`, around lines 249–261): the Agent API's `proxyLimiter` used to count per address (its old comment says consumers behind one address share it, a DoS mitigation). It now keys on the bearer's sha256 once that credential has proved itself, and falls back to the address otherwise. Every Agent API consumer's budget changed shape. `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` pins the limiter's own numbers (60 a window, per credential, `Retry-After` at most 60).
- **What is not pinned.** The limiter's 60-second window and the broker's 60-second wait cap are matched by comment only. The LIN-4378 test checks the limiter's numbers, not their match to the broker; `tests/unit/runner-kit-broker.test.js:980` checks the retry count, not the cap against the limiter. Recorded as a Waiting entry in `docs/areas/agent-api.md`.
- **Why it ranks first.** It is the largest change in the window that the graph does not show: a two-repo pin, a shared retry policy and a changed budget for every Agent API caller. F1 stays the High knot on the ledger; this is the new item a builder is most likely to miss. The Runs & dispatch note does not get a Lesson for the pin, because the test failure message already states the rule; a note would copy it.

### 3.1 F1 `knot:agents-chat<->runs` · **High** · **worse in count, benign in kind** (31/37 → 31/49)

Twelve new edges go from Runs & dispatch to LLM & prompts. Ten of the twelve land on modules that import at most two things: `as-asked.js` (six, from `completion-signals`, `dispatch-factory`, `follow-on-ratio`, `plan-review-round-trips`, `task-page-loader`, `task-stack`), `should-mock-ai.js` (two, out 0), `size-of-move.js` (one, out 2), `prompts/leftover-words.js` (one, out 0). The other two are `dispatch-leftover → prompt-templates.js` (`deriveDispatchKind`, the kind vocabulary) and `dispatch-factory → recommendation-facts.js`. LLM → Runs is unchanged at 31. So the number moved and the kind of coupling did not: Runs reads shared vocabulary from LLM, and the vocabulary is now used by more Runs modules. Severity stays High because the count is the knot's measure. Nothing here changes a builder's rule, so no note entry: the research question (whether a rule for these leaves binds a builder) was answered no. The leaves need to stay import-light; that is already what they are.

### 3.2 New `knot:agent-api<->other-features` · **Medium** · **new as named**, with N1 `knot:other-features-catch-all` · **Medium** · **17 → 18**

`lib/as-asked-seal.js` is in the catch-all by a pin in `tests/unit/area-map-placement.test.js` (lines 69–72: "Its seal (as-asked-seal.js, the create lanes) is not moved with it"). It is imported by `routes/proxy-writes.js` (Agent API) and by `routes/workspace-api-feedback.js` and `routes/workspace-api-issue-write.js` (Web routes), and it imports `lib/proxy-graphql-errors.js` (Agent API) and `lib/as-asked.js`. The new pair is Agent API → Other 2 and Other → Agent API 1. The `dispatch-factory → as-asked-seal` edge (Runs → Other, 6/6) is the same seal.

The seal's own header says what it is: the two decisions every sealing lane makes the same way. Its placement in Other is deliberate, and the pin says so. **Recommendation for the guide's owner, not a tidy:** the placement that would close the pair is `as-asked-seal.js` → LLM & prompts (proposal P10a, §7), which needs the pin changed, and moves this note's entry to `llm-and-prompts.md` (277 bytes free there, so that entry needs distilling first). The note entry in `docs/areas/other-features.md` records it as a size of move.

### 3.3 N3 `knot:auth->llm(model-routing)` · **Low–Medium** · **worse** (4/3 → 6/4)

Three new edges: `lib/workspace-api-mocks.js` → `lib/as-asked.js` (the mock lane), `lib/workspace-preferences.js` → `lib/size-of-move.js` (sizePolicy's size reading), and `lib/recommendation-input.js` → `lib/workspace-preferences.js` (LLM → Auth, 3 → 4). `workspace-api-mocks.js` is in Auth only by its `workspace-` prefix (run 9's "map hygiene: workspace- prefix" item), so the prefix now also drives a knot count. Its sibling edge, `workspace-api-mocks.js` → `fixture-parent.js`, moves Auth ↔ Providers 12/1 → 13/1. The file is a mock lane kept in production `lib/`, and the prefix is what puts it in Auth; the prefix item is the cause to fix, not the edges. No ticket owns it at mint; no note cites an Auth file yet (`auth-accounts-and-workspaces.md` is not created, because no builder rule comes out of it). Reported here.

### 3.4 Watches (not findings on their own)

- **`hub:openrouter.js` · Low–Medium · new as named (watch).** 33 importers in 7 areas (25 cross-area), up from 30 (22). Three new importers are routes, which is the normal direction. The module is the one OpenRouter client, so a door by design; the watch is the 2210-line module and the count. Its outbound edges are 10 (2 cross-area). Report only; no note.
- **`hub:workspace-preferences.js` · Low–Medium · new as named (watch).** 20 importers, all cross-area, from 5 areas (16 at run 9). Outbound 5. `sizePolicy` lives here, and so does the `workspace-` prefix's effect in N3. Watch.
- **`hub:dispatch-factory.js` · Low–Medium · watch.** Outbound 14 (10 cross) → 18 (14 cross): the seal, the plan read, the mock checks and the vocabulary leaves (as in §3.1). Watch the breadth, not a split.
- **`hub:periodicals.js` · Low–Medium · watch, not crossed.** 1259 → 1318 lines; importers unchanged (8, in 4 areas); outbound 1 → 2, both intra-LLM (now `as-asked.js`). Stage 2 of a Periodical (LIN-4379) adds an output mode, `areaNotes` bullets, as template text. Run 9's trigger was "a further content kind"; judged not crossed. Second read to test that judgement (§Adversarial Second-Read).
- **`hub:dispatch-store.js` · Low–Medium · unchanged in the graph.** Lines 4090 → 4524; graph 8 in / 10 out. Size is Code Quality's (`code-quality-review-2026-11-04.md`).
- **N2 `hub:task-page-loader.js` · Medium · worse by one** (out 20 → 21, 9 → 10 cross) through `as-asked.js`. Watch.

### 3.5 New seams, measured healthy

- **`seam:as-asked`.** `lib/as-asked.js` is a pure owner, guarded only on the proxy lane, **by design**: `routes/proxy-writes.js` (`refusedByAsAsked`) says the session lane (`routes/workspace-api-issue-write.js`, a full-body PATCH, unguarded), direct provider edits and the first-dispatch seal are people's lanes. A documented boundary; healthy.
- **`seam:leftover-step`.** `lib/dispatch-leftover.js` is pure; `lib/dispatch-leftover-hook.js` is the I/O, built once in `server.js` and handed to both feedback entrances. The store keeps generic held-wake primitives (LIN-4383). Healthy. Its one F1 edge is the kind vocabulary (§3.1).
- **`seam:call-budget`.** `lib/call-budget.js` has one importer, `lib/openrouter.js`, and imports `openrouter-catalog.js` (intra-LLM). Healthy leaf.
- **LIN-4358 catalog cluster** (`openrouter-catalog.js`, `catalog-rate.js`, `model-pricing.js`, `model-routing-harnesses.js`). Twelve importers of `openrouter-catalog.js` in 5 areas, and `server.js` now imports `model-pricing.js` and `model-routing-harnesses.js` directly. Measured healthy as a cluster: one owner (LLM & prompts), with the registry edit recorded in §0. Not ranked.

### 3.6 F6 `knot:browser-window-globals` · **Medium** · **unchanged** (67 → 67)

Counted as `window.X =` lines in `public/` (a grep, not the run-8 strict method; the run-9 figure is 67 at both commits, so the count did not move). Five `public/` files changed (+58 / −19) with no new global. The test-only `window.LiveConsoleLane` from run 9 is still there. Unchanged level.

### 3.7 `seam:periodical-mint` residue · **Medium, owned** (LIN-4318, Backlog)

`lib/dispatch-entrance.js` still reads prompt text for the grant (`isAutopilotVariant(prompt)`, the `declaresPeriodicalGrant` call). Unchanged; no new ticket.

### 3.8 Wiring, guide hygiene and unchanged knots

- **`wiring: server.js` · Low, watch.** 4713 → 4757 lines; outbound 200 → 204. The four new edges are `dispatch-leftover-hook.js`, `wake-credential.js`, `model-pricing.js` and `model-routing-harnesses.js`. The composition root growing is expected; LIN-1249 (Backlog) owns decomposition.
- **Guide hygiene · Low (pre-existing).** `wake-credential` is named in Auth's pattern, but Runs' `wake-[^/]*` claims it first, so Auth's name is dead. No area file to cite (it is the registry's issue), so it goes in the closing comment only.
- **F3 `knot:providers->upward`, F4 `knot:runs->agent-api(proxy-preamble)`, F8, N4, N5, N6, `hub:tree.js`:** unchanged in the edge data (F4's pair stays 45/10; F8 stays 4 unresolved; `hub:run-controls.js` 21 in; `hub:cost-read.js` 11 in / 7 out; `hub:tree.js` 8 in). Providers → LLM stays 4.
- **Not re-measured this run:** F5 (routes as libraries, dashboard, 53), F7 (dead imports, `routes/proxy.js`), N7, N8, N9, N11, N12, `seam:stage-contract`, `map:stage-kind-roster`, `hub:render-run-steps.js`. Their numbers came from run 9's supplementary figures (E/`supplementary-figures.py`), which hard-code run 9's commits and must be adapted before a re-run. Carried as run 9 measured them; this is a disclosed gap.

## 4. Ways in and rebuild readiness

- **Ways in.** Checked on the entry-file sets (files another area imports) at both commits: **no area lost an entry file.** Gained: LLM & prompts `as-asked.js`, `size-of-move.js`, `catalog-rate.js`, `prompts/leftover-words.js`; Other `as-asked-seal.js`; Providers `sample-data/fixture-parent.js`; Runs `dispatch-leftover-hook.js`. The new doors are `as-asked.js` (24 in, by design), `openrouter-catalog.js` (12 in, one owner) and `workspace-preferences.js` (20 in, the watch in §3.4).
- **Rebuild readiness.** What stops each area from being rebuilt is unchanged in kind. LLM & prompts gained six files and the catalog cluster; the vocabulary leaves are small and cheap to lift. Runs & dispatch gained the leftover step (healthy) and grew through `dispatch-store.js` (Code Quality's). Other features is homeless by pin (§3.2). Auth is wider than its name (§3.3).
- **Per-area judgement is limited to the edge data in this run**; a full per-area readiness read was not redone (disclosed in §12).

## 5. The seams the import graph does not show

- **Data-carried seam: the leftover heading.** Checked by `tests/unit/lin-4374-review-leftover-read.test.js`, which reads the leftover word from the one spelling in `lib/prompts/leftover-words.js`. Passes at HEAD (run in §12).
- **Route-to-tool seams** (a route reads a prompt's text, or a client holds a token's shape) are not in the graph. The window's `public/llms.txt` change (LIN-4369) names scoping's new job and is text, not a seam.
- **Simple Dispatcher clone**: read for the runner contract only. Its `FIXTURE_SHA256`, its harbour-token broker constants and the contract's 429 rows all match this repo at HEAD (§3.0). It was not read for LIN-4322 (nested paging), which is known only through its import edges.
- **Seams have no full home in the notes yet.** The notes carry what binds a builder or waits in an area; the cross-area seams in this report are in this report only, except the one Waiting entry in `other-features.md`.

## 6. Change coupling beside import coupling

`cochange.mjs --days 60`, same registry at both commits (E/`cochange-code-*`).

| | run 9 `90542b2c` | run 10 `bad9d719` |
|---|---|---|
| changes / multi-area / pairs / unmapped files | 891 / 393 / 76 / 6220 | **929 / 413 / 76 / 7216** |
| window | 2026-09-07 → 2026-11-06 | 2026-09-09 → 2026-11-08 |
| shallow | false | false |

- **Window.** 0 commits left, 38 entered (strict superset). One burst of themed work (the LIN-4358 catalog, the As-asked/size/leftover work), not a trend. With n = 38, read the moves as one burst.
- **Biggest moves** (run 9 → run 10): LLM + Runs 89 → 105 (+16); Agent API + Runs 107 → 119 (+12); Agent API + LLM 66 → 77 (+11); LLM + Web routes 74 → 81 (+7); Runs + Web routes 112 → 118 (+6); Agent API + Auth 31 → 35; Auth + LLM 21 → 25; Agent API + Providers 14 → 18; Other + Runs 33 → 37; Front end pages + Runs 94 → 96 (+2 unrelated). **Every pair that grew has an import link**, so none is a candidate seam.
- **No-link pairs: 19 → 19**, the same set (browser code with pages, web routes, runs, wiring, LLM and others; Task model with several). Largest: Browser + Pages 138 (F6). None is new.
- **Unmapped +996**: docs and tests (E/`unmapped-paths-*.txt`). No source file is unmapped.
- **Share of changes that touch more than one area:** 413 / 929 = 44.5% (run 9: 393 / 891 = 44.1%).

## 7. Guide proposals (labelled experiments; nothing edited)

Each proposal is a registry copy in E/ (`areas.proposal-*.json`) measured with the HEAD tool at HEAD and at the baseline. Nothing is applied. Entry-relocation cost is stated for each, since the registry now keys the area notes too.

| proposal | change | links | pairs | Other | LLM files | F1 | group | entries to move |
|---|---|---|---|---|---|---|---|---|
| HEAD registry | — | 1316 | 13 | 18 | 84 | 31/49 | 9 | — |
| **P10a** | `as-asked-seal.js` → LLM & prompts | 1315 | **12** | 17 | 85 | 31/50 | 9 | the Other entry (§3.2) → `llm-and-prompts.md` |
| P7min | `stage-writes.js` → LLM & prompts (run 9's proposal) | 1315 | 13 | 17 | 85 | 31/49 | 9 | — |
| **P7min + P10a** | both | 1314 | **12** | **16** | 86 | 31/50 | 9 | as P10a |
| P10b | `as-asked`, `as-asked-seal`, `size-of-move` → Providers | 1326 | 12 | 17 | 82 | **31/42** | 9 | Providers grows to 40 |
| P10c | new "Ticket text" area (those three plus `description-edit`) | 1326 | 13 | 17 | 82 | 31/42 | **10** | a new note would be needed |

**Reading.** P10a closes the new pair and is the clean edit, but it reverses a deliberate LIN-4371 pin (`tests/unit/area-map-placement.test.js`), so it is a proposal for the guide's owner. P10b and P10c show that F1's count is vocabulary growth: they move the knot, and P10b pushes the LLM ↔ Providers knot up. **No proposal is recommended for F1.** P7min + P10a is the smallest Other and pair count; P10a alone is the smallest change that closes the pair.

## 8. Existing tickets and carried items

Read via the workspace proxy at build time (state, not comments). PR state via `gh`.

- **LIN-4318** (Backlog): the periodical mint by id; owns the text-keyed grant residue (§3.7).
- **LIN-4028** (In Progress) and **PR #2185** (OPEN, last updated 2026-10-30): would add `routing-ruling.js` to the catch-all (N12).
- **LIN-4358** (In Progress): the catalog cluster (§3.5). Its registry edit is §0.
- **LIN-3923** (Backlog): the LLM ↔ Providers knot (now 13/4).
- **LIN-4193, LIN-3738, LIN-3737, LIN-3555, LIN-3736, LIN-3922** (Backlog): seams and map items, unchanged.
- **LIN-4258, LIN-4259** (Backlog): prompt-template items, unchanged.
- **LIN-1249** (Backlog): decompose `server.js`.
- **LIN-4349** (In Progress): the Periodicals run; the operator note's target. **LIN-4379** and **LIN-4383** (Done).

No new ticket was filed for any finding (§9).

## 9. Follow-ups minted: none

This run filed no Linear issue. Its Linear writes are the summary comment on LIN-4387 and one comment on LIN-4349, both requested by the ticket and the dispatch. Findings with no area file to cite (`wake-credential`) go in the closing comment only.

## 10. Trend ledger

Stable names are run 9's, where the row existed. New names are marked **new**.

| name | severity | run 9 (`90542b2c`) | run 10 (`bad9d719`) | delta |
|---|---|---|---|---|
| `seam:runner-contract` (two repos) | Medium | — | pinned both sides; 374 contract lines; limiter per credential | **new** (§3.0) |
| F1 `knot:agents-chat<->runs` | High | 31/37 | **31/49** | worse in count, benign in kind (§3.1) |
| F6 `knot:browser-window-globals` | Medium | 67 | 67 | unchanged (§3.6) |
| N1 `knot:other-features-catch-all` | Medium | 17 | **18** | worse (§3.2) |
| `knot:agent-api<->other-features` | Medium | — | **2/1** | **new** (§3.2) |
| `seam:periodical-mint` | residue Medium (LIN-4318) | 4 → 5 lanes | unchanged | owned, unchanged (§3.7) |
| `hub:periodicals.js` | Low–Medium, watch | 8 in; 1259 lines | 8 in; 1318 lines; out 1 → 2 | watch, not crossed (§3.4) |
| N6 `hub:cost-read.js` | Medium, watch | 11 in (7 cross); 762 lines | 11 in (7 cross); 7 out | unchanged |
| `hub:dispatch-store.js` | Low–Medium | 8 in (7 cross); 10 out; 4090 lines | 8 in; 10 out; 4524 lines | graph unchanged; size is Code Quality's |
| `wiring: server.js` | Low, watch | 4713 lines; out 200 | 4757 lines; out 204 | unchanged in kind (§3.8) |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | pair 45/10 | 45/10 | unchanged |
| F3 `knot:providers->upward` | Medium | Providers → LLM 4 | 4 | unchanged; LLM ↔ Providers 11/4 → 13/4 (LIN-3923) |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | not re-measured | disclosed (§3.8) |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 unused of 96 | not re-measured | disclosed |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 | unchanged |
| N2 `hub:task-page-loader.js` | Medium | 8 in (7 cross); 20 out (9 cross) | 8 in (7 cross); 21 out (10 cross) | worse by one (§3.4) |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 4/3 | **6/4** | worse (§3.3) |
| N4 `hub:run-controls.js` | Medium, watch | 21 in | 21 in | unchanged |
| N5 `knot:task-model` | healthy | 2 files | 2 files | unchanged (no change in window) |
| `hub:tree.js` | watch | 8 in (6 cross) | 8 in (6 cross) | unchanged |
| `map hygiene: workspace- prefix (Auth)` | Low | 14 files | 14 files; now drives N3 | worse in effect (§3.3) |
| `hub:workspace-preferences.js` | Low–Medium, watch | 16 in (all cross) | **20 in** (all cross, 5 areas) | **new as named** (§3.4) |
| `hub:openrouter.js` | Low–Medium, watch | 30 in (22 cross) | **33 in** (25 cross); 2210 lines | **new as named** (§3.4) |
| `hub:dispatch-factory.js` | Low–Medium, watch | out 14 (10 cross) | **out 18** (14 cross) | **new as named** (§3.4) |
| `door:as-asked` | healthy | — | 24 in (12 cross, 5 areas) | **new** (§3.5) |
| `seam:leftover-step`, `seam:call-budget`, LIN-4358 catalog cluster | healthy | — | as §3.5 | **new** |
| `guide hygiene: wake-credential` | Low | — | shadowed explicit name, pre-existing | **new as named** (§3.8) |
| F2 `knot:runs<->page-renderers(render-swipe)` | retired | — | — | retired (run 4) |

**Change-coupling top pairs** (run 9 → run 10):

| pair | run 9 | run 10 | Δ |
|---|---|---|---|
| Browser code + Pages | 137 | 138 | +1 (no import link; F6) |
| Agent API + Runs | 107 | 119 | +12 (import links) |
| Runs + Web routes | 112 | 118 | +6 |
| LLM + Runs | 89 | 105 | +16 |
| Browser code + Web routes | 100 | 102 | +2 (no import link; F6) |
| Pages + Web routes | 96 | 98 | +2 |
| Pages + Runs | 94 | 96 | +2 |
| Web routes + Wiring | 92 | 93 | +1 |
| Browser code + Runs | 87 | 89 | +2 (no import link; F6) |
| Runs + Wiring | 82 | 84 | +2 |

Totals: 891 / 393 / 76 → 929 / 413 / 76. No-link pairs 19 → 19.

## 11. Sibling hand-offs

- **Drift & Coherence** (LIN-4324, run 5, 2026-11-06): the `periodicals.js` content hand-off from run 9 §11 is **still open**: no Drift run has happened since. The anchor exemption it also named is settled by LIN-4316 (Done). Not re-ranked here.
- **Code Quality**: function size, and the growth of `dispatch-store.js` (4524 lines) and `openrouter.js` (2210 lines). Cross-linked, not re-ranked.
- **Stability**: per-file churn is not measured here.
- **Comprehension Debt, API Quality**: no overlap found in this window's seams.

## 12. Measurement notes

- **Commits and guides.** Baseline `90542b2c79016d2a1d64f75cb5d3e9037080eae7`; HEAD `bad9d719ba01ffea2ba5339c32ea354e67bf5682`. Blobs: run 9's guide `642e9405`, HEAD registry `4011e82a`, research registry `c988f5c5`. Full list in E/README.md.
- **Reproductions.** The HEAD tool at the baseline with run 9's guide: seams and cochange JSON equal run 9's files key for key (apart from commit, `areaMapSource`, and cochange window dates). The guide-only check at the baseline: identical.
- **Corrections to research (E/ and the research comment).** Edges +70 → **+76**; cross-area links 1313 → **1316**; production files changed 86 → **98** (the ten added files include `catalog-rate.js`, which came in #2367); Other 18 at HEAD unchanged; the research's "strict superset" held. Research's figures at `32da8d58` are superseded by this run's measurements at `bad9d719`.
- **Not done in this run** (the build's plan asked for them; they are disclosed here instead): the run-8 strict F6 method (the grep count above is used); `supplementary-figures.py` re-run (hard-codes run 9's commits); LIN-4322 (nested paging) read only through its import edges. The Simple Dispatcher clone was read for the runner contract (§3.0), not for the rest of its contract tests.
- **Second read.** The first fresh-context read named the runner contract as the largest missed item and disagreed with the first draft's ranking; §3.0 and the ranking above were changed in place (§Adversarial Second-Read).
- **Tests run locally.** `npm run test:unit` at HEAD `bad9d719`: 24513 tests, 0 failing (log in the build session). `tests/unit/area-notes.test.js` passes with the `other-features.md` edit, and the note is under its 6144-byte cap.
- **Parse and unresolved counts** are reported, not hidden: 0 parse failures, 0 non-literal dynamic imports, 0 unmapped source, 4 unresolved relative imports (F8).
- **Test run.** `tests/unit/area-notes.test.js` and `tests/unit/lin-4374-review-leftover-read.test.js` run locally before the PR (result in the PR description).

## Adversarial Second-Read

- **Tier:** 2 (a fresh-context sub-agent with no memory of the report-writing turn; read-only; it could re-run the tools).
- **Question (verbatim):** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's answer (in full, as returned):**

  > ANSWER: The `lib/runner-kit/` pair, `contract.json` and `broker.mjs`, as changed by f7d1923e6 (LIN-4378: the broker waits out a rate-limited bootstrap exchange, and the proxy limiter is keyed per proven credential). Related commits in the window are 5ef9484f6 (the 429 policy gets one owner in the contract) and 936f52b7d (LIN-4384: sha256 pin and sentinel rows).
  >
  > WHY:
  > - The runner-kit diff is +427/−16, and `contract.json` gains 374 lines. The contract is byte-copied to simple-dispatcher's `test/fixtures/runner-contract.json`. `tests/unit/runner-kit-contract.test.js:48` pins `CONTRACT_SHA256 = 602ab014…`, and `shasum -a 256 lib/runner-kit/contract.json` matches it at HEAD. Any edit here forces a cross-repo re-copy and re-pin, an edge the import graph cannot show.
  > - `broker.mjs` now retries a 429 bootstrap exchange up to `EXCHANGE_RETRIES = 2` times, with waits capped at `EXCHANGE_MAX_WAIT_SECONDS = 60`. The same policy is pinned against simple-dispatcher's `harbour-token-mcp-server.js`, which I could not read. On the Harbour side, `routes/proxy.js` (around lines 249–261) sets `proxyLimiter` to `windowMs: 60000`, `max: 60`, keyed per proven credential. That matches the broker's 60 s cap, but the match rests on a comment, and I found no test that enforces it.
  > - The report files this under "Runs & dispatch, 23 files" in §1 without naming it. §3 has no finding for it. §5 and §12 say the Simple Dispatcher clone was "not read in this run". The contract has 14 `exchange`/`forward` rows, which I counted.
  > - The report calls F1 "benign in kind". This item changes how a builder must edit two repos and changes the rate-limit budget for every Agent API consumer, so it has more consequence for coupling and for builder work than F1's vocabulary-leaf count.
  > - Not checked: I did not re-run `seams.mjs`, and I did not verify the report's zero `lib/` to `routes/` claim or its 38-commit count.
  >
  > VERDICT: DISAGREE. The largest item is the runner-kit / LIN-4378 cross-repo pin, which the report discloses as unread but does not rank or name.
  >
  > Checked and correct: the report's claim that `as-asked-seal.js` is pinned to Other, which matches `tests/unit/area-map-placement.test.js` lines 69–72, and the 98 changed production files (+5244/−1486), which matches `git diff --stat`.

- **Author's check of the reader's points.** Confirmed: the contract's hash matches at HEAD and in simple-dispatcher's fixture; both repos hold the broker constants; `routes/proxy.js` keys the limiter per credential. Partly wrong: a test does exist for the limiter (`tests/unit/lin-4378-proxy-limiter-per-credential.test.js`), but it pins the limiter's numbers, not their match to the broker's cap, so the reader's "no test enforces it" stands for the match only. The "23 files" and "not read" points were right and are fixed (§1, §3.0, §5, §12). The reader's `lib/` → `routes/` and 38-commit checks were not re-run by it, and were checked by the author: 0 and 38 (§0, §6).
- **Ruling on the reader's ranking.** Adopted: the runner contract ranks first among the window's new items (§3.0). F1 keeps its High severity on the ledger; it is no longer presented as the window's largest item.

- **Verdict:** DISAGREE.
- **Differed from top finding:** YES (the first draft ranked F1 first; the reader named the runner contract).
- **Disposition:** fixed in place (§3.0 added and ranked first; §1, §5, §10, §12 and `agent-api.md` updated).
