# Seams & Tangles Review — 2026-10-20 (run 2, first delta vs the 2026-10-13 baseline)

Task: LIN-3735 · Parent: LIN-3549 · Baseline: `seams-tangles-review-2026-10-13.md` (LIN-3552) · Tool: LIN-3550, tree reader since LIN-3638

Review-only: no code, config, guide or doc edits beyond this report and `docs/reviews/_evidence-2026-10-20/`.

## 0. What was measured

- **Commits:** HEAD `6d3b5cfd52d1f354c8eea09ccbbc1ded9081d93a` (`origin/main`, unchanged since mint; nothing landed on the cited paths since the ticket was created) and baseline `6597d6e059fda7d15ada99b29dcc47842f734c98`.
- **Tool:** `scripts/code-shape/seams.mjs . <commit> <guide>` at HEAD, run **four times** (code × guide). Raw JSON in `docs/reviews/_evidence-2026-10-20/seams-{baseline,head}-code-{baseline,head}-guide.json`; the two guides are copied beside them (`areas-guide-*.json`, byte copies of `areas.json` at each commit). A fifth, diagnostic run (F4) uses the HEAD guide with `lib/proxy-preamble.js` mapped to Runs & dispatch: `seams-head-code-head-guide-preamble-in-runs.json` with its guide `areas-guide-head-6d3b5cfd-preamble-in-runs.json`.
- **Scope at HEAD:** 459 files (+31 added, −1 deleted since baseline); 0 parse failures; 4 unresolved relative imports (all `routes/test.js:13,19,25,32` → `tests/fixtures/*-harness.js`, unchanged, Drift's to own); 0 non-literal dynamic imports; 0 unmapped files.
- **Tool check (third source of difference?):** No. HEAD's tool with the baseline guide at `6597d6e0` is deep-equal to `docs/reviews/_evidence-2026-10-13/seams-committed-guide.json` (429 files, 4 unresolved, 897 links, 19 pairs, group of 9; only `areaMapSource` differs). LIN-3638 did not move any figure.
- **Direction rule:** re-confirmed **0 `lib/` → `routes/` imports** (grep of `lib/` for imports reaching `routes/` returns nothing; the tool agrees).

## 1. The four runs, and which guide is the series

| code \ guide | baseline guide (11 areas) | HEAD guide (12 areas) |
|---|---|---|
| `6597d6e0` (baseline) | 429 files · 897 links · **19 pairs** · group 9 | 429 · 896 · **14** · group 8 |
| `6d3b5cfd` (HEAD) | 459 · 992 · **20** · group 8 | 459 · 968 · **11** · group 7 |

The two guides appear to point opposite ways (19→20 against 14→11). They don't:

- **Code movement, same under both guides:** 3 pairs resolved, none created. Agent API↔Pages (LIN-3606 `6ae4c0e4`: `routes/proxy{,-compute}.js` stop importing `tree.js`); Agent API↔Web routes (LIN-3717 `d10e7398`: `proxy-flight-companion`/`proxy-rulings` stop importing `dashboard`/`flight-companion`); Providers↔Runs (LIN-3600 `f885f44c`: `pr-state-store` no longer imports `run-evidence`). No pair worsened into a new one.
- **Guide edit alone at the baseline commit:** 19 → 14 (LIN-3708, 3716, 3720, 3729, 3730; "Other features" 9 → 0, new "Reports & operator tools", `proxy-fetch` to Platform, `tree.js` no longer a page).
- **Why the baseline guide reads +1:** new files fall into its stale `^lib/` catch-all ("Other features" 9 → 25) or the wrong area, which manufactures Auth↔Other, Auth↔Platform, Auth↔Runs and Pages↔Other pairs. That is a map artefact, not code.

**Series from now on: the HEAD (committed) guide, re-based at 14 at `6597d6e0`; 19 → 20 is kept only as the continuity bridge.** Guide edits are recorded here apart from code movement (§6).

## 2. Findings (severity-ranked, deltas first)

Severity as at baseline. Delta vocabulary: new / unchanged / improved / worsened / resolved. Edge counts are HEAD guide, `aToB/bToA`.

### F1 (High, **worsened**) — LLM & prompts ↔ Runs & dispatch: 25/18 → **23/23**
- **Improved:** LIN-3728 moved `deriveFollowUpDispatch` to `lib/follow-up-dispatch.js:90`; that file now mentions `chat-tools` only in comments. **LIN-3553 is stale** (move done).
- **Worsened (edge counts only):** LIN-3604 `lib/dispatch-entrance.js` (a large new consolidation lib pulled out of `routes/dispatch.js` and `routes/workspace-api.js`; see the second-read note in §8: it is also the largest structural move in the window and arguably a new Runs front door, so the edge count understates a mostly right-direction change) added five Runs→LLM edges (`chat-request`, `periodicals`, `prompt-templates`, `prompts/autopilot-kickoff`, `recommend-recurse`). Runs→LLM is now 23 edges from 15 Runs files, equal to LLM→Runs. Most of the Runs→LLM weight is the right-way prompt/kind vocabulary (`prompt-templates`, `autopilot-kickoff`); the *back* edges that matter for a seam are `observer-state-store → recap-cache` (`stableStringify`, `lib/recap-cache.js:27`), `task-page-loader → brief-cache` (`hashContext`, a re-export of `recap-cache`), and the `openrouter` summary callers (`run-paragraph`, `run-summary`, `session-summary`). The first two are **pure hashing helpers** — unchanged since baseline.
- LLM→Runs is still dominated by orchestration: `chat-tools.js` 9 of 23, `prompts/runner-kickoff.js` 4. "LLM & prompts holds two layers" (baseline §4) is still true and still unadopted.
- Cross-link: the duplicate `stableStringify` in `lib/run-summary-cache.js:32` is Drift's.

### F2 (High, **unchanged**) — Run/ordering logic lives in renderers (Pages↔Runs 6/8 → 7/8)
`lib/task-stack.js:32` and `lib/roadmap.js:9` still import ordering from `./render-swipe.js` (**LIN-3554 still valid**); LIN-3579 rebuilt the renderers without moving it. `task-page-loader ↔ render-run-steps`, `live-console → timeline-zoom` unchanged; Runs→Pages also reaches `render.js`/`render-*` from `routes/live-console.js` and `routes/runner-setup.js` (routes using renderers: right way, listed for completeness). Improved side-effect: `roadmap → render-swipe` is now the **only** LLM→Pages back edge (16/7 → 16/1).

### F3 (Medium, **unchanged, and misfiled at baseline**) — Providers reach upward
- `providers/{github,jira}/index.js → proxy-ref-resolver` (`RefResolutionError`, lines 64/100) and `providers/linear/index.js:30 → openrouter` (two caps): unchanged.
- **Correction of baseline F3:** `providers/linear/index.js:32 → proxy-wire.js` (`collectIssueAttachments`, defined `lib/proxy-wire.js:285`) is a **third** Providers→Agent API back edge, present at baseline and missed. The baseline claim that the `RefResolutionError` edges are "the whole reason" Providers↔Agent API closes was wrong: **LIN-3555 alone does not open the pair** (19/3 stays closed by `proxy-wire`). LIN-3555 needs the `proxy-wire` caveat (or a sibling move).
- Also unchanged: `providers/{jira,linear,local}/index.js → tree.js` (3 edges, `selectFocusSubtask`; Pages↔Providers 21/4 → 26/3), and `providers/jira/oauth.js → token-refresh` (Auth). The Auth↔Providers knot is closed by that single edge; Auth→Providers (12) is one-way otherwise.
- LLM↔Providers moved 5/2 → 12/1 purely from right-way LLM→Providers imports of `providers/state-map.js` (see hubs); the single back edge is the `openrouter` caps.

### F4 (Medium, **new**) — Runs → Agent API through `proxy-preamble` (Agent API↔Runs 44/7 → 42/9)
Nine Runs→Agent API back edges, two new from LIN-3604 (`dispatch-entrance → proxy-preamble`, `→ proxy-graphql-errors`); other importers `dispatch-factory`, `follow-up-dispatch`, `wake-credential`, `routes/dispatch.js` (3), `consumer-poll-warning`. `lib/proxy-preamble.js` is not mainly a prompt builder. It is 822 lines, most of it the dispatch credential/grant provisioning surface (`provisionBootstrapToken`, `provisionResumeCredential`, `attachProxyContext`, the grant-refusal taxonomy); only `buildProxyContextPreamble` is prompt text. Its Runs importers take `provisionResumeCredential`, `isStructuralGrantRefusal`, `shouldUseMcpTokenField` and `applyDefaultDispatchHarness`, and the file itself imports `proxy-tokens.js` and `proxy-scopes.js` (Agent API). It has 8 importers across three areas. So F4 is "Runs consumes the Agent API's token/grant machinery", not a prompt builder misplaced. **Simulated move** (`lib/proxy-preamble.js` mapped to Runs & dispatch in a copy of the HEAD guide, measured at `6d3b5cfd`; evidence `seams-head-code-head-guide-preamble-in-runs.json`): Agent API↔Runs goes 42/9 → 42/6 and the pair count stays 11, so the move reduces back edges but does **not** open the pair. The remaining Runs→Agent API edges are `proxy-preamble → proxy-scopes`/`proxy-tokens` (both created by the move itself), `routes/dispatch.js → proxy-scopes`/`proxy-tokens`, `dispatch-entrance → proxy-graphql-errors` and `consumer-poll-warning → proxy-scopes`. This is a different knot from F1/F3 and should not be folded into the Providers work. Also `chat-tools → proxy-preamble` and `prompts/runner-kickoff → proxy-scopes` (LLM→Agent API, unchanged).

### F5 (Medium, **improved**) — Routes used as libraries
LIN-3717 removed the `dashboard`/`flight-companion` imports from `flight-companion`, `proxy-flight-companion`, `proxy-rulings`. Still present (unchanged): `task-chat → dashboard`, `workspace-api → dashboard` (`settleWithConcurrency`), `workspace-api → proxy` (`commentDedupe`), `{dashboard,flight-companion} → dispatch` (`dispatchQueueLimiter`), `test → dashboard`. Agent API↔Web routes resolved (§1).

### F6 (Medium, **slightly worse; tool-blind**) — Browser seam and server wiring
`public/` is classic scripts with no imports: 40 files (was 36); `window.X =` assignments in `public/common.js` 46 → 48; files under `lib/` and `routes/` mentioning `scripts:` 31 → 33. "Not wired by imports" ≠ isolated; a browser rebuild must preserve every global. `server.js` (the composition root, 174 imports into other areas) registers the scheduler sweeps (`createObserverSweepRun`, `createCredentialInvariantSweepRun`, `createPricingConformanceSweepRun`, `createLivenessAlarmSweepRun`, `createCiWakeSweepRun`, `server.js:73-82,801`); the tool shows only Wiring→X edges, never what ticks when. Narrative only; nothing imports `server.js`, so no direction problem.

### F7 (Low, **unchanged**) — Dead-import inflation (LIN-2600)
`routes/proxy.js` still carries dead named imports (a rough regex re-scan gives 51 of 114 named, a lower bound, same as the baseline's rough figure). Existing ticket **LIN-2600** (Backlog); noted, not minted. Series figures not corrected.

### F8 (Low, **unchanged**) — `routes/test.js` loaded in production
`server.js:133` imports `routes/test.js`, which imports four `tests/fixtures/*-harness.js`. Drift's; recorded because it is the whole unresolved-import count.

### Drift & Coherence hand-offs, read at area altitude (no knot)
- **L7 CI-wake sweep → Auth** (`lib/ci-wake-sweep.js` imports `credential-invariant-sweep`, `workspace-lookup`, …): Runs→Auth is **25 edges one-way** (Auth→Runs: 0 under the HEAD guide). Closes no pair.
- **L3 `connection-credential → providers/github/app-auth`:** Auth→Providers is 12/1; the only back edge is `jira/oauth → token-refresh`. One-way except that edge; closes no new knot.

## 3. Hubs

Fan-in from several areas (HEAD guide): `utils/html.js` 56, `errors.js` 43, `utils/time.js` 38, `workspace.js` 27, `feature-defaults.js` 23, **`providers/state-map.js` 22 (new)**, `providers/registry.js` 19, `render.js` 18, `openrouter.js` 16, `public-origin.js` 15, `workspace-preferences.js` 14, `prompt-templates.js` 14, `chat-request.js` 14.
- **`tree.js` fan-in 15 → 5: improved** (LIN-3606 `isBlocked`, LIN-3727 focus-child picker out; it is no longer a watch-list hub).
- **`providers/state-map.js` is the new hub** (importers 10 at baseline → 29 files / 22 counted cross-area, from 7 areas). It sits in Providers but is a state vocabulary, so every area importing it is the right way, but it makes Providers a dependency of nearly everything. Credited commits: LIN-3606, LIN-3612, with LIN-3656/3659/3674/3680 repointing callers; exact per-commit attribution of the 10 → 29 growth was not apportioned. Watch it; do not promote.
- Watch list otherwise: `workspace.js` 28 → 27, `openrouter.js` 16 → 16, `prompt-templates.js` 14 → 14, all unchanged.

## 4. Ways in and rebuild readiness (changes first)

| Area (files, HEAD guide) | Way in | Readiness | Delta / what blocks it |
|---|---|---|---|
| Browser code (40) | none by imports; `renderPage({scripts})` + `window.*` | low, unmeasurable | worse (F6) |
| Server-rendered pages (72) | `render.js` 18, `render-pages.js` 11, `tree.js` 5; 45 entry files | medium | improved: `tree.js` no longer the second door; F2 remains |
| Agent API (29) | `proxy-preamble` 8, `proxy-scopes` 4, `proxy-ref-resolver` 3; 12 entry files | medium | F3 `proxy-wire`, F4 `proxy-preamble` |
| Runs & dispatch (96) | 85 entry files; `dispatch-entrance.js` (LIN-3604) is emerging as a front door for dispatch decisions, not yet for the area (`runner-owner-gate` 8, `dispatch-store` 6, `dispatch-terminal` 6) | low–medium | largest and widest; F1 worsened |
| LLM & prompts (70) | `openrouter` 16, `chat-request` 14, `prompt-templates` 14; 61 entry files | medium | two layers in one name (unadopted) |
| Auth, accounts & workspaces (61) | `workspace.js` 27, `public-origin` 15, `workspace-preferences` 14 | medium | Auth↔pages 12/15 unchanged (pages call auth helpers, auth flows render pages) |
| Providers (36) | `state-map` 22, `registry` 19, `models` 11: a clear front door | highest | F3 upward reaches (4 edges + `tree.js` ×3 + `token-refresh`) |
| Platform & plumbing (25) | `utils/html` 56, `errors` 43, `utils/time` 38 | high | healthy; `kpi-stats`/`milestone-funnel` mislabel resolved by guide |
| Reports & operator tools (7, **new**) | `kpi-stats` 3 | high (small) | new area from baseline §7; in the knot group via Reports→Auth (5) → Pages (12) → Reports (2) |
| Web routes (22) | one entry file each (`dashboard`, `flight-companion`, …) | medium | F5 improved |
| Other features (0) | — | n/a | emptied by LIN-3720; catch-all `^lib/` should be retired (§6) |
| Wiring (1) | it is the root | n/a | F6, F8 |

## 5. Tool blind spots (what it could not read)

4 unresolved imports (`routes/test.js` → `tests/fixtures/*`, by construction); `public/` globals and `scripts:` strings; `server.js` scheduler wiring (tool reports edges, not timing); dead-import phantom links (F7); the **guide itself** (areas assigned by regex over paths, so a stale catch-all manufactured 4 pairs in §1, net +1 against the 3 that code movement resolved). **Simple Dispatcher:** still out of remit — `JKershaw/simple-dispatcher` is flat CommonJS (33 `require(` and 0 `import` in `dispatcher.js`), the tool reads ES `import` only. Still a tool gap with no ticket; no tool built.

## 6. Guide edits since baseline vs guide proposals (kept apart from code)

Adopted since baseline (all baseline §7 proposals 1-3 and 6; LIN-3708, 3716, 3720, 3729, 3730): `tree.js` out of pages, `proxy-fetch` to Platform, KPI readers to "Reports & operator tools", "Other features" emptied. **Still unadopted:** (4) all `routes/*` in one route layer; (5) split "Agents & chat orchestration" out of "LLM & prompts". Proposal for next run: retire the empty "Other features" catch-all so it cannot swallow new `lib/` files again. Guide is a guide, not a rule; `areas.json` is unchanged in this PR.

## 7. Existing tickets and follow-ups

- **LIN-3553** — stale: superseded by **LIN-3728** (Done). Commented; no mint.
- **LIN-3554** — valid, unchanged (F2). **LIN-2600** — open (F7). **LIN-3555** — valid but insufficient: `proxy-wire` caveat added by comment (F3).
- Seam work that moved knots (credited as code movement): LIN-3600, 3606, 3612, 3717, 3727, 3728; LIN-3604 is the one landing that worsened a knot (F1, F4).
- **Follow-ups minted (≤3, one move each, duplicates searched first; none duplicates 3553/3554/3555/2600):**
  - **F-D (LIN-3736):** move `stableStringify` and `hashContext` from `lib/recap-cache.js` down to plumbing (`lib/utils/`) so `observer-state-store` and `task-page-loader` stop importing the LLM area. Removes 2 of the Runs→LLM back edges.
  - **F-E (LIN-3737):** move `collectIssueAttachments` out of `lib/proxy-wire.js` to a provider-neutral module so `providers/linear` stops importing the Agent API area (completes what LIN-3555 starts).
  - **F-F (LIN-3738):** move `lib/proxy-preamble.js` (the dispatch credential/grant provisioning surface, plus the preamble text) out of the Agent API area to Runs & dispatch, so the Runs/LLM/route importers stop pointing up for it. It takes Agent API↔Runs back edges 9 → 6 and does **not** open the pair (simulated in F4); the rest sit in `proxy-scopes`/`proxy-tokens`/`proxy-graphql-errors`.

## 8. Adversarial Second-Read

- **Tier:** 2 (fresh-context sub-agent, no memory of the report-writing turn; given the draft report, repo and tool output).
- **Question:** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's answer (condensed):** The LIN-3604 `lib/dispatch-entrance.js` consolidation (new, ~1.8k lines; `routes/dispatch.js` 2041 → 1462 lines, `routes/workspace-api.js` 4673 → 3782; header says it imports nothing from routes; imported by `dispatch-factory`, `routes/proxy-kickoff.js`, `routes/proxy-dispatch.js`) is the biggest structural move in the window and mostly a move in the right direction. The draft filed it only as a regression (+5 Runs→LLM edges) and as an F4 `proxy-preamble` source, and did not say Runs now has a candidate front door or that the route layer shrank. Smaller misses: `workspace-api.js` rewrite, new `lib/account-erasure.js`, the `scripts/code-shape/*` tool family, LIN-3619 token-revocation Auth changes (not sized). Nine file:line claims spot-checked: all accurate (one path lacked its `lib/` prefix). The reader did not re-run the tool or the §1 figures, and did not measure the net edge effect of LIN-3604.
- **Checked and fixed in place:** F1 and the Runs row in §4 now say the edge count understates a mostly right-direction consolidation and that `dispatch-entrance` is an emerging front door. I did not independently apportion LIN-3604's net effect on cross-area edges; that stays open for the next run. The other smaller items are file-size or tool-family matters owned by Code Quality, Stability or Drift and are not Seams findings.
- Adversarial second-read verdict: DISAGREE
- Differed from top finding: YES
- Disposition: fixed in place

## 9. Trend ledger

Format: `name | kind | severity | delta`. Series = HEAD guide at both commits; re-based at 14 at `6597d6e0`.

```
metric:files-in-scope                      | 459 | +30 (429)
metric:parse-failures                      | 0   | unchanged
metric:unresolved-relative-imports         | 4   | unchanged
metric:non-literal-dynamic-imports         | 0   | unchanged
metric:unmapped-files                      | 0   | unchanged
metric:cross-area-import-links(HEAD guide) | 968 | 896 -> 968
metric:two-way-area-pairs(HEAD guide)      | 11  | rebased 14 -> 11 (baseline-guide bridge 19 -> 20)
metric:knot-group-size(of 12 areas)        | 7   | rebased 8 -> 7 (baseline-guide bridge 9 -> 8)
metric:lib-to-routes-imports               | 0   | unchanged
knot:agents-chat<->runs(chat-tools)        | High   | worsened (25/18 -> 23/23; follow-up-dispatch edge resolved by LIN-3728)
knot:runs<->page-renderers(render-swipe)   | High   | unchanged
knot:providers->upward(openrouter,ref-resolver,proxy-wire) | Medium | unchanged (proxy-wire edge newly recognised)
knot:runs->agent-api(proxy-preamble)       | Medium | new
knot:routes-as-libraries(dashboard)        | Medium | improved
knot:browser-window-globals(common.js)     | Medium | worsened (46 -> 48)
knot:dead-import-inflation(routes/proxy.js)| Low    | unchanged
knot:production-loads-routes/test.js       | Low    | unchanged
hub:tree.js                                | -      | improved (15 -> 5)
hub:providers/state-map.js                 | watch  | new (22 cross-area importers)
area:browser-code                          | low-readiness  | worsened
area:server-rendered-pages                 | medium         | improved
area:agent-api                             | medium         | unchanged
area:runs-and-dispatch                     | low-medium     | unchanged
area:llm-and-prompts                       | medium         | unchanged
area:auth-accounts-workspaces              | medium         | unchanged
area:providers                             | highest        | unchanged
area:platform-and-plumbing                 | high           | unchanged
area:reports-and-operator-tools            | high           | new
area:web-routes                            | medium         | improved
area:other-features                        | n/a            | resolved (emptied; catch-all to retire)
area:wiring-server.js                      | n/a            | unchanged
```

Stable-name mapping: `knot:providers->upward(openrouter,ref-resolver,proxy-wire)` = baseline `knot:providers->upward(openrouter,ref-resolver)`. F-numbers shifted because F4 is new: baseline F4→F5, F5→F6, F6→F7, F7→F8.
