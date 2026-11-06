# Seams & Tangles Review — 2026-11-06, run 9 (delta vs run 8)

Task: LIN-4323 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-11-05-run8.md` (run 8, LIN-4298, PR #2318, merge `8f97e18e`) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`, both unchanged in the window. Evidence: `docs/reviews/_evidence-2026-11-06-run9/` (see its `README.md`). "E/" below means that folder.

Review-only. The only changes are this report and its evidence folder. No code, config, guide (`scripts/code-shape/areas.json`) or other doc was edited.

## Headline

- **Better or worse, area by area** (the operator's question for this window): **LLM & prompts: better**, with a watch on `hub:periodicals.js`; **Runs & dispatch: better**; **Agent API: better**; **Pages: better, by a small margin** (one name rule instead of a copy, and one new one-way edge, Pages → LLM); **Browser code: mixed, mostly better**; **Other features, Web routes, Auth, Providers, Platform, Reports, Task model and Wiring: unchanged.**
- **The import graph moved by one edge.** `lib/render.js:28 → lib/periodicals.js` (Pages → LLM) is the only file edge added, and none was removed. Links 1271 → 1272. Knot pairs 12 → 12, knot group 9 → 9, F1 31/37, Other 17. The new edge points down the existing direction, and no `lib/` → `routes/` import exists at either commit.
- **Changes since run 8, severity-ranked (§3a):**
  1. **`seam:periodical-mint`** is a healthy seam (new as named). Its one residue is still a grant decision that reads prompt text (`dispatch-entrance.js:1227`). It is **Medium and owned by LIN-4318** (Backlog). No new ticket.
  2. **F6 `knot:browser-window-globals`** stays **Medium**, and is mixed, mostly better. The shared-global count moved by +1 (`window.LiveConsoleLane`, a test-only global), and 51 lines were deleted from `public/`, 50 of them method-presence guards by a crude token match, under a spelling rule held by an AST check.
  3. **`hub:periodicals.js`** is **Low–Medium, new as named, watch.** It is not a hub by graph shape (wide-in, narrow-out), but its content is now mixed and it has 8 importers in 4 areas.
- **Change coupling: 875 / 391 / 76 → 891 / 393 / 76.** Six pairs rose by +2 each, all from the two mint commits (`c491eca5`, `f2816e17`). The windows overlap 98.88% and the HEAD window is a strict superset. With n = 16 this is **not a trend**.
- **Follow-ups minted: none** (§9). Every finding is either owned by an open ticket or is a watch.
- **Adversarial second read:** Tier 2, fresh context (§Adversarial Second-Read).

## 0. What was measured

- **Commits.**
  - Baseline: `af55cb737ec4e63919bac65558b35498ede3d290` (run 8's measured commit).
  - Measured: `90542b2c79016d2a1d64f75cb5d3e9037080eae7`, origin/main at build time. The ticket was minted at `5c63aa261a2de891907c9b8d567f9932ed1985d0`. One tests-only commit (LIN-4311, `90542b2c`, PR #2330) landed before the build, so this run measured the new HEAD. The research-stage measurement at `5c63aa26` is kept in E/ (`*-5c63aa26*`). Every production figure is identical between the two commits (§12).
- **One guide.** `scripts/code-shape/areas.json` is blob `642e9405` at both commits. A byte-identical copy is E/`areas.head-5c63aa26.json` (checked with `cmp`), and every run uses it.
- **Tools unchanged.** `seams.mjs` (`34f11434`), `cochange.mjs` (`c3a39f37`), `cochange-core.mjs` (`763a37b8`) and `code-shape-lib.mjs` (`42a1e521`) have the same blobs at both commits.
- **Re-measured.** `seams.mjs` and `cochange.mjs --days 60` were re-run at both SHAs with the same guide. The `af55cb73` outputs equal the research-stage files and run 8's `seams-code-af55cb73` JSON, key for key, apart from the commit and guide-path fields.
- **Window.** `af55cb73..90542b2c`: 16 first-parent commits, from `ed46a714` (LIN-4300, 2026-11-05T20:06Z) to `90542b2c` (LIN-4311, 2026-11-06T11:12Z). Six of them touch `lib routes public server.js`:
  - `b389f9b0` LIN-4292, method-presence guards removed from `public/`;
  - `f742e5ac` LIN-4304, one spelling for DOM element access in `public/`, with a check;
  - `c491eca5` LIN-4313, a Periodical run minted by registry id through the proxy;
  - `f2816e17` LIN-4317, one rule for the periodical grant;
  - `8b84a8fe` LIN-4309 and `ff6a69fa` LIN-4310, suites moved onto `loadWorld`.

  Together they change 20 files, +368 / −109, and add or delete no production file. The rest is tests (LIN-4306, 4307, 4308, 4296, 4311; the fake-DOM moves) and docs (Drift run 4, Comprehension run 5, run 8, the Survey sync LIN-4314, the LIN-4315 paper and its evidence).
- **Scope.** Files in the tool's scope: 544 → 544. **0 parse failures, 0 non-literal dynamic imports, 0 unmapped source files, and 4 unresolved relative imports** (all in `routes/test.js`, F8), at both commits. The unmapped set (docs and tests, outside the guide's source remit) is 5746 → 6220 (§6).
- **Direction rule.** `lib/` → `routes/` imports: 0 at both commits.
- **Edge diff.** The complete file-level edge list changed by exactly one edge, added: `lib/render.js → lib/periodicals.js`. None removed. Intra-area edges 784 → 784.

## 1. Changes since run 8 (first)

1. **A new cross-area file edge: `lib/render.js:28 → lib/periodicals.js`** (Pages → LLM, `periodicalPromptName`; LIN-4313 `c491eca5`). Its two uses are `render.js:660` and `:674`, both `periodicalPromptName(...)`. Before the window `render.js` spelled the name itself (`` `${title} + Autopilot` `` at `render.js:673`, `af55cb73`), and the mint would have needed a second copy. Now both use `periodicalPromptName`, which has one owner in the registry. Area-level links: Pages → LLM 36 → 37. LLM → Pages stays 0, so no pair opens. No knot moved.
2. **`seam:periodical-mint`, new as named, healthy with one owned residue** (§3a.1).
3. **`hub:periodicals.js`, new as named, Low–Medium, watch** (§3a.3).
4. **F6 moved in kind, not in level** (§3a.2). `window.X =` assignments in `public/`: 66 → 67 (strict method). The one added line is `window.LiveConsoleLane` (`public/live-console.js:1367`).
5. **The test harness moved toward browser rebuild readiness** (not graded as an area; §5). Hand-written fake-DOM ratchet entries 25 → 10 → 7 (`af55cb73` → `5c63aa26` → `90542b2c`). Files that run `public/` scripts through `loadWorld` 40 → 57 → 60.
6. **Change coupling**: six pairs +2 each, from the two mint commits (§6). Not a trend.

## 2. The import graph: placement versus code

| commit | files | file edges (cross-area) | links | pairs | group | Other | F1 (LLM→Runs / Runs→LLM) | Pages ↔ Other | LLM ↔ Other | Pages → LLM |
|---|---|---|---|---|---|---|---|---|---|---|
| `af55cb73` (run 8) | 544 | 2055 (1271) | **1271** | 12 | 9 | 17 | 31/37 | 9/8 | 2/1 | 36 |
| `90542b2c` (run 9) | 544 | 2056 (1272) | **1272** | 12 | 9 | 17 | 31/37 | 9/8 | 2/1 | **37** |

Source: E/`compare-run9.md`, E/`edges-code-*`, E/`seams-code-*`.

- **Placement changes:** none. The guide is unchanged, so no area was edited and no file moved.
- **Code changes:** one cross-area file edge added (§1.1), none removed; intra-area edges 784 → 784.
- **Knot pairs.** The 12 pairs are the same as run 8, and the nine-area knot group is unchanged (E/`compare-run9.md`, "Knot pairs"). F1 (LLM ↔ Runs, 31/37) is unchanged, and so is the catch-all (N1, 17).
- **The guide gap (N1) and its labelled fix (P7min)** are re-measured at the new HEAD (§7). The catch-all membership is identical to run 8's 17 files.

## 3. Findings, severity-ranked, trend-framed

Ordering: §3a is what this window changed, ranked by severity. §3b is what it did not change. Names are run 8's stable ledger names (§10), plus two new names.

### 3a. Changed in this window

#### 3a.1 `seam:periodical-mint` — healthy seam; one residue, owned by LIN-4318 · **Medium residue** · **new as named**

- **The seam.** The new way in is `POST /api/proxy/periodicals/:id/mint` (`routes/proxy-dispatch.js:297–312`; route at `:310`; `requireGrant('dispatch')`). It does not write its own enqueue. It calls `enterPeriodicalMint` (`lib/dispatch-entrance.js:2040`), so Runs's entrance grows from **4 lanes to 5** (`enterSessionDispatch`, `enterProxyDispatch`, `enterRecommendDispatch`, `enterKickoff`, `enterPeriodicalMint`). The file's importers are unchanged: 3 in all, 2 cross-area, both from Agent API (`routes/proxy-dispatch.js`, `routes/proxy-kickoff.js`).
- **One of each rule:** one renderer (`renderPeriodicalPrompt`, `lib/periodicals.js`), one name rule (`periodicalPromptName`, used by `render.js:660, :674` and the mint), one lookup (`getPeriodical`), one grant rule (`declaresPeriodicalGrant`, `lib/dispatch-entrance.js:1218`). This is a better seam than the one that preceded it: the mint and the page render the same prompt from the same registry.
- **The residue.** On the session lane the grant variant is still learned from the rendered prompt text. `declaresDispatchGrant` calls `isAutopilotVariant(prompt)` (`lib/dispatch-entrance.js:1227`), which is an `includes` of `PERIODICAL_AUTOPILOT_TAIL` (`lib/periodicals.js:1131–1132`). It is the only call site in `lib routes server.js` (`git grep`). An authority decision therefore rests on a text contract between the browser's rendered prompt and Runs, and the import graph cannot see it.
- **Bound on the residue.** The grant is owner-checked at the mint. The session lane records the token's owner (`grantOwnerAccountId`, `lib/dispatch-entrance.js:814`), and the code comment at `dispatch-entrance.js:1225–1226` says "the owner check at the mint is the authority". The residue therefore decides *which* owner-held grant a session receives. It does not let a caller without the `dispatch` grant enqueue. The mint route's own grant (`routes/proxy-dispatch.js:310`, `requireGrant('dispatch')`) is text-free.
- **Why Medium, why not minted.** The residue gates a dispatch grant, so it is more than a shape note. But **LIN-4318** (Backlog, "The app mints Periodicals by id; no grant decision reads prompt text") already names the cure, and the code's own comment at `dispatch-entrance.js:1224` points to it. Minting again would duplicate it.
- **Related, not owned by this run.** LIN-1284 (Backlog) names the prompt-level tail as a fail-open v1 for the mint → kickoff handoff. It is the same tail, seen from the handoff side.

#### 3a.2 F6 `knot:browser-window-globals(common.js)` · **Medium** · **mixed, mostly better** (level unchanged; kind changed)

- **Assignments, run 8's strict method** (`window.X =` with no `==` or `===`): `public/` 66 → **67**; `public/common.js` 51 → 51. The loose series (which also matches `typeof` reads): `public/` 107 → 108; `public/common.js` 55 → 55.
- **The one added line:** `window.LiveConsoleLane = { laneNode };` (`public/live-console.js:1367`, LIN-4310 `ff6a69fa`). Its comment says "nothing else reads this global". Its only reader is a test helper, `tests/unit/helpers/live-console-world.js:34` (`world.window.LiveConsoleLane.laneNode`). So this is a **test-only browser global**, and the browser code now reaches a suite through `window` rather than through a copy of the markup. Severity **Low** as a direction note: it sits inside LIN-4254's in-flight fake-DOM moves (In Progress), and the ticket said it is not a separate ticket by default. It is recorded here and in §5.
- **Guards removed (LIN-4292 `b389f9b0`, LIN-4304 `f742e5ac`).** The method-presence guards across 13 `public/` files are gone (`git diff --stat` for `public/`: 55 insertions, 51 deletions). LIN-4304 holds the rule with `tests/unit/public-element-method-guards.test.js` (289 lines, AST-based). Its allow-list `PRESENCE_ALLOW` has **3 entries, all in `public/close-out.js`** (`:182–184`). LIN-4312 (In Progress, LIN-4254 piece 6) is named in that list to remove them.
- **Spelling, not seam.** `public/` nets +4 lines (55 inserted, 51 deleted): the global and its three-line comment. The other lines rewrite guarded calls. No markup attribute, event listener, or script list changed in the diff. `/cost-format.js` is still in 6 script lists, and Home's list still has 14 entries (`lib/render.js:384`, a line shift only).
- **Reads.** `prompt-section.js` reads `window.QuestionCards` at `:1030` and `:1043`, unchanged from run 8. A wider count (`git grep -o "window.QuestionCards"` over `public/`) is 23 at both commits; that is a different pattern from run 8's, so it is not compared with run 8.
- **Reading.** The browser code now trusts the DOM instead of bending to test stubs, and the fidelity burden moves to the shared fake (§5). That is mostly better. The one test-only global is the cost, and it is small. F6 stays **Medium** because the cross-script `window` coupling is still the way browser code is wired, and no change here removes it.

#### 3a.3 `hub:periodicals.js` · **Low–Medium** · **new as named; watch**

- **Graph shape.** Importers **7 (in 3 areas) → 8 (in 4 areas)**, all cross-area, with Pages added by the new edge. Outbound **1**, intra-LLM (`prompt-template-defs.js`). That is wide-in, narrow-out: everything points into `periodicals.js`, and it points at nothing outside LLM. By the graph it is not a new hub class.
- **Importers at HEAD** (`git grep "from '.*periodicals.js'"`): `lib/dispatch-entrance.js` (Runs; now 7 names, was 2), `lib/dispatch-validation.js` (Runs), `lib/periodical-report-gate.js` (Runs), `lib/render.js` (Pages), `routes/proxy-compute.js`, `routes/proxy-writes.js`, `routes/proxy.js` (Agent API), and `server.js` (Wiring).
- **Content.** The file now holds, side by side: the registry (`getPeriodical`, `getPeriodicals`), one prompt renderer for the UI and the mint, the prompt-name rule, the operator-note validator, and the `+ Autopilot` variant sniff (`isAutopilotVariant`, §3a.1). It grew **1151 → 1259 lines** (size is Code Quality's).
- **Guide fit.** The guide places it in LLM & prompts. That is correct for the registry and the renderer, and wrong for the grant sniff, which is Runs's concern. This is a content mix, not a placement error, and the guide proposes nothing for it.
- **Watch triggers.** Re-open if a sixth importing area appears, or if a further content kind is added to the file. Owners of the content and size: Drift (LIN-4324, In Progress, reads the same window) and Code Quality.

#### 3a.4 Anchor-resolver exemption for the Survey notebook · **Low** · **new in the window** (a check, not an import)

- **What changed.** LIN-4314 (`1d10f9b3`) synced `docs/plans/survey/` onto main. Its own commit message records the failure it caused: three new `CLAUDE.md:58` citations in `log.md` and `place-ledger.md` fail `tests/unit/docs-architecture-anchor-resolver.test.js`, "Known failure, not fixed here … resolving it needs a decision outside these paths". The same commit then adds `docs/plans/survey` to `DENYLIST_DIRS` (`tests/unit/docs-architecture-anchor-resolver.test.js:94`), so the resolver no longer checks that directory.
- **Why it is in this report.** It is a guard weakened to clear a failure, and it sits on a path the window changed. The report's remit is area direction, and this is not an area edge, so it is graded Low and not as a seam.
- **Owners.** The decision that caused it is LIN-4316 (Backlog, "Survey notebook is hand-mirrored from a research branch: decide one home"). Whether the guard should have been weakened is a Drift question (a check and its scope). Handed to **LIN-4324** (Drift run 5, In Progress), which reads this window. Not minted.

### 3b. Not changed in this window (run 8's ledger, in severity order)

#### F1 `knot:agents-chat<->runs(chat-tools)` · **High** · **unchanged (31/37)**

- The LLM ↔ Runs knot is 31 edges one way and 37 the other, as at run 8. The window did not extend the cost-family edges.
- Cost share: 6 of 31 LLM → Runs and 6 of 37 Runs → LLM edges touch the cost family (E/`supplementary-figures.txt` §S8). The same at both commits.

#### N1 `knot:other-features-catch-all(lib first-match)` · **Medium** · **unchanged (17; as at run 8)**

- The catch-all membership is identical to run 8's 17 files (E/`compare-run9.md`, "Catch-all"). Nothing was added to it in the window; `lib/stage-writes.js` (run 8's new member) is still there.
- Not worse as a map than at run 8. The run 8 "worsened" delta was already taken. The fix remains the guide proposal P7min (§7), not a code move.
- **Watch:** PR #2185 (LIN-4028, OPEN, last updated 2026-10-30) would add `lib/routing-ruling.js`, which is N12's file, and it also edits `lib/dispatch-entrance.js`, `lib/dispatch-factory.js`, `lib/proxy-instructions.js` and `lib/session-telemetry.js`.

#### F4 `knot:runs->agent-api(proxy-preamble)` · **Medium** · **unchanged (11 / 10)**

- Anchor `lib/proxy-preamble.js:153` (`applyDefaultDispatchHarness`), unchanged in the window. Owned: LIN-4155 (Backlog).

#### `map:stage-kind-roster` · **Low–Medium** · **unchanged (9 files, 4 areas)**

- `git grep -l survey-place` over `lib routes public server.js` names 9 files in 4 areas, as in run 8. Drift owns the decision (LIN-4299 is Done; LIN-4324 names this hand-off).

#### `seam:stage-contract` · **healthy** · **unchanged**

- No file of it changed in the window. Owned follow-ons LIN-4258 and LIN-4259 (both Backlog).

#### N6 `hub:cost-read.js` · **Medium (watch)** · **unchanged (11 in, 7 out; 762 lines)**

- Identical to run 8 in the tool output. Size is Code Quality's, and the read-contract widening recorded in run 8 is unchanged.

#### F3 · F5 · F7 · F8 · N2 · N3 · N4 · N5 · N7 · N8 · N9 · N11 · N12 · hubs · `server.js` · **unchanged**

Each is the same as run 8 in the tool output (E/`supplementary-figures.txt` §S1–S19, E/`compare-run9.md`):

- **F5** (route → route, Medium): 53, 3 cross-area.
- **F7** (dead named lib imports in `routes/proxy.js`, Low): 45 unused of 96.
- **F8** (production loads `routes/test.js`, Low): 4 unresolved relative imports.
- **N2** (`hub:task-page-loader.js`, Medium): 8 in (7 cross), 20 out (9 cross).
- **N4** (`hub:run-controls.js`, Medium, watch): 21 in.
- **N8** (deleted `task-cost` alias and 2 comments, Low): unchanged.
- **N9** (`door:request-usage-loader`, healthy): 7 importers.
- **N12** (`map:rulings-family-split`, Low): six areas, unchanged; PR #2185 would add a seventh.
- **`hub:dispatch-store.js`** (8 in, 10 out), **`hub:tree.js`**, **`hub:render-run-steps.js`**: unchanged.
- **`server.js`** (Wiring, Low, watch): 4,713 lines, 209 top-level imports, 30 inline `app.<verb>(` routes. Outbound by area identical. LIN-1249 owns it.

## 4. Ways in and rebuild readiness

Only what changed is written here. Entry files are `seams.mjs`'s (E/`supplementary-figures.txt` §S15–S16).

- **LLM & prompts: better.** One renderer, one name rule and one lookup for Periodicals now sit in `periodicals.js`. The entries are the registry's exports, and the file is wide-in (§3a.3). **Readiness:** better for the Periodical templates; the mixed content is the watch.
- **Runs & dispatch: better.** The entrance has five lanes through one shared module, and the periodical grant has one rule (`declaresPeriodicalGrant`). The session lane still reads prompt text (§3a.1). Its cost part still has no narrow way in (unchanged). **Readiness:** better for enqueue; unchanged for cost.
- **Agent API: better.** The mint route is a wrapper over `enterPeriodicalMint`, with no enqueue logic of its own, and no edge was added (`proxy-scopes.js` is still a leaf; the narrowing is `dispatch-validation.js:17`, `getPeriodical`).
- **Pages: better, by a small margin.** It reads the prompt-name rule from the registry, not a copy. It gains one one-way edge (Pages → LLM, 36 → 37), in the existing direction. **Readiness:** small improvement.
- **Browser code: mixed, mostly better.** No import edges (0), so its way in is still a script list plus `window.X` (F6). The window added one test-only way in (`window.LiveConsoleLane`) and removed the method-presence guards (50 of 51 deleted lines, by crude token match) under a spelling check. **Readiness:** better as a harness question (§5); F6 unchanged.
- **Other features: unchanged** (17 members; P7min still fixes it).

## 5. The seams the import graph does not show

- **The text-keyed grant decision** (§3a.1, `dispatch-entrance.js:1227`). An authority decision reads the prompt body (via `PERIODICAL_AUTOPILOT_TAIL`). It is the one call site, owned by LIN-4318.
- **The `.prompt-name` text the client reads** (`public/app.js:1508`, `:1548`). The client reads the rendered name as a *display label* for downloads and for the dispatch's `promptName`. It is not an input to a grant decision, so it is noted and not graded. It is now produced by one function on the server (`periodicalPromptName`), which is the change this window made.
- **Browser reads of an existing global** (F6). Unchanged in count; the one new global is test-only (§3a.2).
- **The fake-DOM test harness** (not an area; not graded). Hand-written fake-DOM entries in `tests/unit/fake-dom-census.test.js` (`HAND_WRITTEN_FAKE_DOM_FILES`, `:52`) fell **25 → 10 → 7**. The `loadWorld` count is **files under `tests/` whose text contains `client-world`** (`git grep -l client-world <sha> -- tests`): **40 → 57 → 60**. This is a text count, not a count of `loadWorld(` calls. A stricter count (only `loadWorld(` call sites, excluding helper modules) gives different totals; the direction is the same under either rule. Browser code has no import edges, so this harness is the only machine-checked way to exercise `public/` without a browser. It is the precondition run 8 named for refactoring F6, and the window moved it forward. LIN-4254 (In Progress) continues the moves; LIN-4311 (PR #2330) merged as `90542b2c`. The harness's own churn is Stability's, and any duplication in suites is Code Quality's. The harness is not graded as an area.

## 6. Change coupling beside import coupling

`cochange.mjs --days 60`, one guide, both commits (E/`cochange-code-*`).

- **Windows and overlap.** Baseline `2026-09-06T19:02Z → 2026-11-05T19:02Z`; HEAD `2026-09-07T11:12Z → 2026-11-06T11:12Z`. They share 59.326 of 60 days (**98.88%**). The HEAD window is a strict superset by commit: **0 commits left, 16 entered** (all 875 baseline-window commits are still in the HEAD window, S11). Every move is this window's own. With n = 16, **this is not a trend.**
- **Totals.** Changes **875 → 891**; touching two or more areas **391 → 393**; pairs **76 → 76**; `shallow: false` at both.
- **Unmapped files 5746 → 6220: +474, −0, all outside the source remit.** The exact sets are in E/`unmapped-paths-*.txt` (E/`unmapped-paths.mjs`):

  | directory | new unmapped paths |
  |---|---|
  | `docs/papers` | 383 (the LIN-4315 paper and its evidence) |
  | `docs/reviews` | 79 (run 8 and Drift run 4 evidence, Comprehension run 5, reports) |
  | `tests/unit` | 10 (fake-DOM moves; LIN-4311's two helpers) |
  | `tests/fixtures` | 2 |

  No source file is unmapped (`scope.unmappedFiles` for source is 0).

**Top pairs at HEAD, against run 8's values** (`af55cb73`, the baseline):

| pair | run 9 (`90542b2c`) | run 8 (`af55cb73`) | Δ | import link? |
|---|---|---|---|---|
| Browser code + Pages | 137 | 137 | 0 | no |
| Runs + Web routes | 112 | 112 | 0 | yes |
| Agent API + Runs | **107** | 105 | +2 | yes |
| Browser code + Web routes | 100 | 100 | 0 | no |
| Pages + Web routes | 96 | 96 | 0 | yes |
| Pages + Runs | **94** | 92 | +2 | yes |
| Web routes + Wiring | 92 | 92 | 0 | yes |
| LLM + Runs | **89** | 87 | +2 | yes |
| Browser code + Runs | 87 | 87 | 0 | no |
| Runs + Wiring | 82 | 82 | 0 | yes |
| Agent API + LLM | **66** | 64 | +2 | yes |

- **The six +2 pairs** (Agent API + Runs, Pages + Runs, LLM + Runs, Agent API + LLM, Pages + LLM 41 → 43, Agent API + Pages 34 → 36) come from `c491eca5` and `f2816e17`, the two mint commits. Each touches all four areas. That is one mint window, two changes. They are not a trend, and they all have import links, so none is a candidate seam.
- **The browser pairs did not move.** The four browser commits (LIN-4292, 4304, 4309, 4310) touched only `public/` and tests, which are unmapped or browser-only, so they make no area pair.
- **Candidate seam (unchanged).** Browser code + Pages (137) and browser code + Web routes (100) are still the largest pairs with no import link. The coupling runs through markup and `window.X`, which the graph cannot see (F6). This window shows browser code changing alone in four commits, which is the shape a seam would allow. Not new.
- **No-link pairs: 19 → 19** (of 76).

## 7. Guide proposals (labelled experiments; nothing edited)

None of these is a code move, and none is enforced by a test, check or count.

- **P7min — place `lib/stage-writes.js` in LLM & prompts (re-measured at HEAD; still recommended, not applied).** E/`guide-experiments-run9.txt`: links **1271**, Other **16**, LLM ↔ Other **1/1**, Agent API → LLM 37 → 38 (an existing direction). No pair opens. The result at `af55cb73` equals run 8's.
- **P2c (Costs & usage area), P1c, P1d, P2, P3, P4** — each stands as run 8 wrote it. None is measured again in this run.
- **No new proposal for `periodicals.js`.** Its content is mixed (§3a.3), but splitting it would be a code move with no gate to pass. The guide places it correctly for the registry. Recorded as a watch.

## 8. Existing tickets and carried items

States as read from the Harbour API on 2026-11-06 at build time; PR state from `gh pr view`.

| ticket | state | what it covers | this run |
|---|---|---|---|
| LIN-4318 | Backlog | the app mints Periodicals by id; no grant decision reads prompt text | **owns the residue** (§3a.1) |
| LIN-4312 | In Progress | LIN-4254 piece 6: close-out onto `loadWorld`, remove the close-out `typeof` seams | owns the 3 allow-listed guards |
| LIN-4254 | In Progress | move the not-attempted client-test stubs onto the shared fake | owns the in-flight harness moves, incl. `LiveConsoleLane`'s test consumer |
| LIN-4311 | Done | LIN-4254 piece 5 (`90542b2c`, PR #2330, merged) | landed in the measured HEAD |
| LIN-4313, LIN-4317 | Done | the periodical mint and the grant rule | the window's changes (§1) |
| LIN-4292, LIN-4304 | Done | guard removal and the DOM spelling rule | F6's "mixed, mostly better" (§3a.2) |
| LIN-4310, LIN-4309, LIN-4308 | Done | suites onto `loadWorld` | §5 |
| LIN-4324 | In Progress | Drift run 5, reads the same window | the sibling reading of this window; names run 8's hand-offs |
| LIN-4299 | Done | Drift run 4 | took none of run 8's hand-offs; `map:stage-kind-roster` now has an owner in LIN-4324 |
| LIN-4028, PR #2185 | In Progress; PR OPEN, last updated 2026-10-30 | recorded routing ruling; adds `lib/routing-ruling.js` | would add N12's file to the catch-all (N1) and touches `dispatch-entrance.js` |
| LIN-4193 | Backlog | name the cost modules into an area | P2c result was commented there in run 8; not adopted |
| LIN-4258, LIN-4259 | Backlog | stage-contract follow-ons | still the owners |
| LIN-4154, LIN-4155 | Backlog | `fmtDuration`; `applyDefaultDispatchHarness` | anchors `render-run-steps.js:258`, `proxy-preamble.js:153` unchanged |
| LIN-3922, 3923, 3736, 3737, 3738, 3555, 2600, 1249, 4235, 4238, 4244, 4302 | Backlog | `tree.js`, LLM ↔ Providers, stable-stringify, preamble credentials, attachments, `RefResolutionError`, dead imports in `routes/proxy.js`, `server.js`, `usage-snapshot-intake`, Home's F6 follow-ons, the verb list | unchanged; their anchors are in E/`supplementary-figures.txt` §S6 |
| LIN-1284 | Backlog | server-side wake-bridge for the mint → autopilot handoff | related to §3a.1; not this review's |

## 9. Follow-ups minted: none

Before deciding I searched Linear for the findings above (`GET /api/proxy/search`), at build time and again before this report was finalised. Terms: "LiveConsoleLane", "periodicals.js", "isAutopilotVariant", "PERIODICAL_AUTOPILOT_TAIL", "stage-writes", "hub:periodicals", "test-only global", "periodical grant", "seams", "anchor resolver", "DENYLIST_DIRS", "docs/plans/survey", "loadWorld". Results in the final pass: LIN-4316 (Backlog) owns the Survey notebook's home, which caused §3a.4; LIN-4324 (In Progress) is Drift's sibling reading of this window; LIN-4310 (Done) landed `LiveConsoleLane`. No open ticket names the test-only global, `hub:periodicals.js`, or the anchor-resolver exemption, and the exemption is handed to LIN-4324 rather than minted.

1. **`seam:periodical-mint` residue (text-keyed grant):** owned by **LIN-4318**. **Not minted.**
2. **F6 (`LiveConsoleLane`, guard removal):** the global is Low and sits inside LIN-4254's in-flight moves. The guard removal is a spelling rule with a check. A ticket to "reduce `window.X`" would not be one move. **Not minted.**
3. **`hub:periodicals.js`:** a watch, not a bar-crossing finding. Its content is Drift's and Code Quality's. **Not minted.**
   - **Anchor-resolver exemption (§3a.4):** Low; the decision is LIN-4316's and the check is LIN-4324's (Drift). **Not minted.**
4. **`map:stage-kind-roster`:** Drift's, via LIN-4324. **Not minted.**
5. **N1 (stage-writes gap):** a guide proposal (P7min), not a code move. **Not minted.**

Nothing in the window adds a `lib/` → `routes/` import, opens a knot pair, adds a wrong-way edge, or creates an unowned high-severity item. Zero follow-ups is the valid outcome.

## 10. Trend ledger

Names are run 8's stable names. `N1` keeps its name. `seam:periodical-mint` and `hub:periodicals.js` are new. None is retired.

| name | severity | run 8 (`af55cb73`) | run 9 (`90542b2c`) | delta |
|---|---|---|---|---|
| F1 `knot:agents-chat<->runs` | High | 31/37 | 31/37 | unchanged |
| F6 `knot:browser-window-globals` | Medium | 66 assignments (strict); loose 107; `prompt-section.js` QuestionCards reads 2 | 67 (loose 108); `prompt-section.js` reads 2 | **mixed, mostly better**: +1 test-only global (`LiveConsoleLane`); method-presence guards removed under a check; level unchanged |
| N1 `knot:other-features-catch-all` | Medium | 17 | 17 | unchanged; P7min re-measured (links 1271, Other 16, LLM ↔ Other 1/1) |
| `seam:periodical-mint` | healthy; residue **Medium (LIN-4318)** | — | 4 lanes → 5; one renderer, name rule, lookup, grant rule; text-keyed grant residue | **new as named**; residue owned |
| `hub:periodicals.js` | Low–Medium, watch | — | 8 importers in 4 areas (was 7 in 3); wide-in, narrow-out; 1259 lines (was 1151) | **new as named**; watch |
| N6 `hub:cost-read.js` | Medium, watch | 11 in (7 cross, 4 areas); 762 lines | same | unchanged |
| N10 `map:cost-family-split` | Low–Medium | P2c measured, not adopted | not re-measured | unchanged |
| N9 `door:request-usage-loader` | healthy, Low | 7 importers | 7 | unchanged |
| N11 `door:home-waiting` | healthy, Low | 1 read, 1 renderer | same | unchanged |
| N12 `map:rulings-family-split` | Low | 6 areas | 6 areas | unchanged (PR #2185 pending) |
| `seam:stage-contract` | healthy | vocabulary leaf + resolver + four entrances | same | unchanged |
| `map:stage-kind-roster` | Low–Medium | 9 files in 4 areas | 9 files in 4 areas | unchanged; LIN-4324 owns the hand-off |
| `hub:dispatch-store.js` | Low–Medium | 8 in (7 cross); 10 out | same | unchanged |
| `wiring: server.js` | Low, watch | 4,713 lines; 209 imports; 30 inline routes | same | unchanged |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 11 / 10 | 11 / 10 | unchanged |
| F3 `knot:providers->upward` | Medium | 4 | 4 | unchanged |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | 53 | unchanged |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 unused of 96 | same | unchanged |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 | unchanged |
| N2 `hub:task-page-loader.js` | Medium | 8 in (7 cross) / 20 out (9 cross) | same | unchanged |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 4 | 4 | unchanged |
| N4 `hub:run-controls.js` | Medium, watch | 21 in | 21 in | unchanged |
| N5 `knot:task-model` | healthy | 2 files | 2 files | unchanged |
| N7 `door:request-usage-intake` | healthy, Low | 3 | 3 | unchanged |
| N8 `map hygiene: deleted task-cost` | Low | alias + 2 comments | same | unchanged |
| `map hygiene: workspace- prefix (Auth)` | Low | 14 `workspace-*` files in Auth (17 named) | same | unchanged |
| `hub:tree.js` | watch | 8 in (6 cross) | same | unchanged |
| `hub:render-run-steps.js` (FU-1) | Medium | 4 in (2 cross) / 4 out (4 cross) | same | unchanged |
| F2 `knot:runs<->page-renderers(render-swipe)` | retired | — | — | retired (run 4) |

**Change-coupling top pairs** (values at `af55cb73` / `90542b2c`):

| pair | run 8 | run 9 | Δ |
|---|---|---|---|
| Browser code + Pages | 137 | 137 | 0 |
| Runs + Web routes | 112 | 112 | 0 |
| Agent API + Runs | 105 | 107 | +2 |
| Browser code + Web routes | 100 | 100 | 0 |
| Pages + Web routes | 96 | 96 | 0 |
| Pages + Runs | 92 | 94 | +2 |
| Web routes + Wiring | 92 | 92 | 0 |
| Browser code + Runs | 87 | 87 | 0 |
| LLM + Runs | 87 | 89 | +2 |
| Runs + Wiring | 82 | 82 | 0 |

Totals: 875 / 391 / 76 → 891 / 393 / 76. No-link pairs 19 → 19.

## 11. Sibling hand-offs

- **Drift & Coherence** owns decisions held in several places and file-level direction. Handed here, not graded:
  - LIN-4324 (Drift run 5, In Progress) reads this same window and owns the per-kind roster (`map:stage-kind-roster`);
  - the mixed content of `lib/periodicals.js` (§3a.3);
  - LIN-4320 (Backlog): CLAUDE.md's enqueue list omits `POST /periodicals/{id}/mint` (docs).
  - the anchor-resolver exemption for `docs/plans/survey` (§3a.4): a weakened check, handed to LIN-4324; its cause is LIN-4316's decision on the Survey notebook's home.
- **Code Quality** owns function size: `lib/periodicals.js` (1259 lines), `lib/dispatch-entrance.js` (2048), `lib/cost-read.js` (762) and `server.js` (4713).
- **Stability** owns churn; nothing here.
- **Simple Dispatcher** (outside `seams.mjs`). Its `origin/main` is `07c88f7a338b3e19a01070775e1f4d4cfc91f040` (2026-11-04T23:46:41Z), fetched at build time: `dispatcher.js` is still CommonJS (35 `require(` lines, no `import`/`export`), and 2 of its 371 JS files carry top-level `import`/`export`. No tool was built for it.

## 12. Measurement notes

1. **Commands.** Listed per file in E/`README.md`. Tools were run from the repo root with `scripts/code-shape/` at both SHAs, with `areas.head-5c63aa26.json` (blob `642e9405`).
2. **Reproduction.** The `af55cb73` seams JSON re-run here equals run 8's committed `seams-code-af55cb73-guide-head-af55cb73.json` apart from the commit and guide-path fields. At `5c63aa26` and `90542b2c` the seams and edge JSON are identical except the `commit` field. The cochange pairs are identical between `5c63aa26` and `90542b2c` (only the `changes` total moves, 890 → 891, from LIN-4311, a tests-only commit). The unmapped set grows by exactly the two LIN-4311 helpers.
3. **Edge and unmapped sets.** Complete for imports (the edge-list diff). For unmapped files, E/`unmapped-paths.mjs` reproduces the exact set `cochange.mjs` counts.
4. **Browser counts.** Strict `window.X =` counting (assignment lines; `=` only, not `==`/`===`). The loose pattern is kept for trend comparison and is not used to rank.
5. **Corrections to the research stage** (checked against the code at `90542b2c`):
   - `lib/proxy-scopes.js` changed only a header comment ("three" → "four enqueue mounts"). It is still a no-import leaf. The narrowing is `lib/dispatch-validation.js:17` (`getPeriodicals` → `getPeriodical`).
   - `lib/dispatch-entrance.js:68` imports **seven** names from `periodicals.js` at HEAD (it imported two at `af55cb73`).
   - "Other features worse as a map since run 8" in the research notes was wrong: the catch-all was already 17 at run 8, and it is unchanged at 17.
   - `main` moved by one tests-only commit (`90542b2c`, PR #2330) between research and build. PR #2330 is merged, not open.
   - The Simple Dispatcher clone's local `origin/main` ref was stale when first read; after `git fetch` it is `07c88f7a`, as the research said.
6. **Not done:** the app was not run and no e2e was run (source and git objects only). `lib/dispatch-entrance.js` was read in the LIN-4313 and LIN-4317 hunks and at the lines cited. `public/live-console.js` and `public/prompt-section.js` were read at the cited lines.

## Adversarial Second-Read

**Tier 2.** A fresh-context sub-agent (general-purpose, no memory of the report-writing turns). It was given the repository worktree, the two SHAs, the tool paths and README, the evidence folder (not its research notes), and the question. It was told to form its own answer from git and the tool output **before** opening the report, and not to open the research notes, the ticket or Linear. It did not see the research notes, the research comment, or this report until its own answer was written.

**Question:** *What is the largest item in this window that this report missed or misfiled?*

**The reader's answer, in full:**

> **Tier:** 2 (fresh-context sub-agent; did not see the research notes, the ticket, or the report-writing turn)
>
> **Your own answer, from step 1, before reading the report:** The largest item is the periodical grant still being decided from prompt text on the session lane. `lib/dispatch-entrance.js:1227` (`declaresDispatchGrant`) calls `isAutopilotVariant(prompt)`, which is `prompt.includes(PERIODICAL_AUTOPILOT_TAIL)` at `lib/periodicals.js:1131-1132`. The mint lane decides the same grant from the route's `autopilot` flag (`lib/dispatch-entrance.js:1218`, `declaresPeriodicalGrant`; route at `routes/proxy-dispatch.js:310`). It is the only text-keyed authority decision in the window, and commit `f2816e17` describes the grant as "one rule". Its blast radius is bounded: the grant is owner-checked at the mint, so it adds nothing beyond the `kind: 'autopilot'` grant the owner already has.
>
> **Differed from the report's top finding:** NO. My step-1 answer is the same residue as §3a.1.
>
> **Verdict:** DISAGREE, narrowly. The ranking and the top finding hold. The report misses one unowned change in the window and does not state the owner bound that its own severity rests on.
>
> **Largest item missed or misfiled:** The anchor-resolver exemption. `tests/unit/docs-architecture-anchor-resolver.test.js:94` adds `docs/plans/survey` to `DENYLIST_DIRS`. Commit `1d10f9b3` (LIN-4314, in the window) says three new `CLAUDE.md:58` citations in the Survey notebook fail that test and that "resolving it needs a decision outside these paths". A follow-up commit then exempts the whole directory. The report mentions LIN-4314 only as a docs item (line 34). It never mentions the failing check or the exemption, and it hands nothing to Drift (§11 hands off only LIN-4320). That contradicts its own claim that every finding is owned or a watch (§9, line 233).
>
> Calibration gap: §3a.1 (lines 72-73) rates the grant residue Medium but never says the owner check bounds it. The code comment at `lib/dispatch-entrance.js:1229-1230` says "the owner check at the mint is the authority", and the session declaration sets `grantOwnerAccountId` at `:814`. I did not trace the owner-check function itself.
>
> **Spot-checks:**
> - 16 first-parent commits; 6 touch lib, routes, public or server.js. Held.
> - Seams: only one link changed, `Front end: server-rendered pages -> LLM & prompts` 36 to 37, from `lib/render.js:28`. Link imports sum to 1271 to 1272. Knot pairs 12 to 12, cycle group 9 to 9, F1 31/37. Held.
> - Cochange: 875/391/76 to 891/393/76, six pairs +2 each, unmapped 5746 to 6220 (+474). Window overlap: all 875 baseline commits are in the HEAD window, 16 entered. Held.
> - Anchors: `render.js:28`, `:660`, `:674`; `proxy-dispatch.js:297-312` and `:310`; `dispatch-entrance.js:68`, `:1218`, `:1227`, `:2040`; `periodicals.js:1131-1132`; `dispatch-validation.js:17`; old name at `render.js:673` (baseline). All held.
> - File sizes: `periodicals.js` 1151 to 1259, `dispatch-entrance.js` 1944 to 2048. Held.
> - Importers: `periodicals.js` 7 in 3 areas to 8 in 4 areas. `dispatch-entrance.js` has 3 importers, 2 cross-area. Held (`routes/dispatch.js` is in Runs & dispatch under the guide).
> - `public/`: 13 files, +55/−51; guard allow-list has 3 entries, all in `close-out.js` at 182-184; `window.X =` strict 66 to 67, `common.js` 51 to 51. Held.
> - Fake-DOM ratchet 25 to 7. Held (the intermediate 10 was not checked).
> - `loadWorld`: 40 at baseline held, but 40 to 57 to 60 did not reproduce. HEAD gives 63 by name, 59 by call, 57 by name excluding helpers. Not a trend change, but the definition is unstated.
> - "4 unresolved relative imports, all in routes/test.js": the count holds. They are the four `tests/fixtures/*-harness.js` imports, which `seams.mjs` treats as out of scope.
> - Direction rule (0 `lib` to `routes` imports): held.
> - 500/500 pass at HEAD for the window-touched targeted suites.
> - Mint 201 body matches `proxy-instructions.js` and the docs.
> - Not checked: Linear tickets (out of scope), run 8 comparisons (not opened), the intra-area edge count 784.
>
> **Anything else the author should fix:**
> 1. Fill both "Adversarial Second-Read" placeholders (lines 237 and 318). The headline at line 17 says the Tier 2 read is included.
> 2. Remove or fill the "closing note" reference at line 225. No closing note exists.
> 3. Add the anchor-test exemption (`tests/unit/docs-architecture-anchor-resolver.test.js:94`, from `1d10f9b3`) with an owner or a hand-off to LIN-4324.
> 4. In §3a.1, state the owner-check bound and that the mint lane is text-free.
> 5. In §5/§12, define the `loadWorld` pattern and scope, or correct the 57 and 60.

**Author's judgement on the reader's answer.** I checked the reader's points against git and the code at `90542b2c`.

- **The miss is real and is fixed in place.** `1d10f9b3` (LIN-4314) adds `docs/plans/survey` to `DENYLIST_DIRS` at `tests/unit/docs-architecture-anchor-resolver.test.js:94`, to clear three `CLAUDE.md:58` failures that the commit message records as "Known failure, not fixed here". It is now §3a.4, graded Low, with the decision owned by LIN-4316 and the check handed to Drift via LIN-4324.
- **The owner bound is real and is now in §3a.1.** The session lane records the owner at `dispatch-entrance.js:814`, and the comment at `:1225–1226` says the owner check at the mint is the authority. The residue decides which owner-held grant a session receives. It does not let an un-granted caller enqueue.
- **The `loadWorld` counts are a text count, and the definition is now stated.** §5 gives it as files under `tests/` whose text contains `client-world` (40 → 57 → 60). The reader's other rules give other totals. The direction is the same under each.
- **The placeholders and the "closing note" reference are fixed.** The second read is in this single section. §9 now records the final search and its results.
- **Not changed.** The reader's top item was the same residue the report ranks first, and it agreed that the ranking holds. The reader's point that the mint lane is text-free is already in §3a.1 (`routes/proxy-dispatch.js:310`).

Adversarial second-read verdict: DISAGREE
Differed from top finding: NO
Disposition: fixed in place
