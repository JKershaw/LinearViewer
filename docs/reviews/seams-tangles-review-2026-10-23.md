# Seams & Tangles Review — 2026-10-23 (run 3, delta vs the 2026-10-20 run)

Task: LIN-3832 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-10-20.md` (LIN-3735) · Tool: `scripts/code-shape/seams.mjs` (unchanged since `6d3b5cfd`)

Review-only: no code, config, guide or doc edits beyond this report and `docs/reviews/_evidence-2026-10-23/`.

**Headline: a quiet window. Nothing opened, closed or reversed. Five cross-area links grew by one each, all in the right direction. The one new result is retrospective, not a movement in this window: LIN-3604 (`47d87055`, an ancestor of `6d3b5cfd`) is now apportioned (the 10-20 §8 leftover), which re-grades 10-20's F1 "worsened" as a relocation. No new follow-ups are minted.**

## 0. What was measured

- **Commits:** HEAD `5b32864e14ec02b3c258fa3cf8cc7807eaf0bbb7` (`origin/main`) against `6d3b5cfd52d1f354c8eea09ccbbc1ded9081d93a` (the 10-20 measured commit). 51 commits between them; the mint-time check of `c832f79b` was not trusted and everything was rerun at HEAD.
- **Tool runs** (`node scripts/code-shape/seams.mjs . <sha> <guide>`), raw JSON in `docs/reviews/_evidence-2026-10-23/`:
  - four runs, both guides × both commits: `seams-code-<sha>-guide-<sha>.json`, with the guides copied as `areas-6d3b5cfd.json` / `areas-5b32864e.json` (byte copies of `scripts/code-shape/areas.json` at each commit);
  - two runs for LIN-3604 alone, HEAD guide, at `47d87055^` (`15191460`) and `47d87055`: `seams-lin3604-*.json`.
- **Scope at HEAD:** 462 files (+3 added, 0 removed in scope; the three `public/*.min.js` deleted by LIN-3787 are outside the tool's `.min.js` rule). 0 parse failures. 4 unresolved relative imports (`routes/test.js` → `tests/fixtures/*-harness.js`, unchanged, Drift's). 0 non-literal dynamic imports. 0 unmapped files. `lib/` → `routes/` imports: **0**.

## 1. The four runs, and which guide is the series

| code \ guide | `6d3b5cfd` guide | HEAD guide |
|---|---|---|
| `6d3b5cfd` | 459 files · 968 links · 11 pairs · group 7 | 459 · 968 · 11 · 7 (identical) |
| `5b32864e` | 462 · 976 · 11 · 7 | 462 · **973** · 11 · 7 |

The series stays **the committed guide at both commits** (HEAD guide), as in 10-20.

- **Guide effect, apart from code:** at `6d3b5cfd` the two guide edits move nothing (968 = 968, no link differs). At HEAD the old guide reads 976 because the `^lib/` "Other features" catch-all swallows the two new files (`harbour-token-format.js`, `vendor-assets.js`), adding Agent API→Other 3 and Wiring→Other 1 and removing Wiring→Platform 1. Both guide edits (LIN-3795, LIN-3787) were made in the same PR as the file, so in-PR guide upkeep worked; the catch-all is still the thing that would have mis-filed them.
- **Code movement (HEAD guide, 968 → 973):** five links each +1, none opened or closed:

| link | change | from |
|---|---|---|
| Runs → Platform | 53 → 54 | LIN-3805 (`dispatch-store` → `errors`) |
| Reports → Platform | 8 → 9 | LIN-3811 (`kpi-daily-rollup` → `db-indexes`; landed after the mint) |
| Web routes → Providers | 28 → 29 | LIN-3798 (`routes/test.js` → `linear-fetch`) |
| Wiring → Auth | 45 → 46 | LIN-3774/3790 (`server.js` → `connection-secondary-remint`) |
| Wiring → Platform | 12 → 13 | LIN-3787 (`server.js` → `vendor-assets`) |

All five point down to plumbing or out from the wiring root. 11 two-way pairs and a knot group of 7, both unchanged.

## 2. Findings (severity-ranked, deltas first)

Ledger names are those of 10-20 §2 / §9.

### F1 (High, **unchanged — and 10-20's "worsened" re-read as a relocation**) — LLM & prompts ↔ Runs & dispatch 23/23
- **Apportioned (closes the 10-20 §8 leftover).** LIN-3604 alone (`47d87055^` → `47d87055`, HEAD guide) takes cross-area links **898 → 886 (−12)**, 13 pairs at both. Agent API→Runs 46 → 34, Agent API→LLM 38 → 33, Agent API→Auth 15 → 13, Agent API→Platform 28 → 27, Agent API→Providers 18 → 17; Runs→LLM 18 → 22, Runs→Agent API 7 → 9, Runs→Platform 44 → 46, Runs→Providers 7 → 8. The prompt and kind-vocabulary imports that Agent API routes used to make moved into `lib/dispatch-entrance.js`. So the +5 Runs→LLM that 10-20 called "worsened" are the same imports relocated, and the net effect of LIN-3604 is a clear improvement. 10-20's F1 delta should read "unchanged; relocation".
- The real back edges are unchanged: `observer-state-store → recap-cache`, `task-page-loader → brief-cache` (LIN-3736), and the `openrouter` summary callers. LIN-3736 is not landed.
- Not re-flagged: duplicate `stableStringify` copies are Drift's.

### F2 (High, **unchanged**) — task ordering lives in a renderer (Pages↔Runs)
`lib/render-swipe.js` is imported for ordering/flattening by `render-ship`, `render-swim`, `roadmap`, `task-stack` (and `server.js` for the page). Code unchanged. **LIN-3554 has an owner call** (a new "Task model" area, `graph-features.js` relabelled into it) and is now a child concern of LIN-3754. When it lands it edits `areas.json`, so the run after it must again keep guide effect apart from code movement.

### F3 (Medium, **unchanged**) — Providers reach upward
Same edges: `providers/{github,jira}/index.js → proxy-ref-resolver` (LIN-3555), `providers/linear/index.js → proxy-wire` (LIN-3737), `→ openrouter`, `providers/{jira,linear,local}/index.js → tree.js`, `providers/jira/oauth.js → token-refresh`. None landed.

### F4 (Medium, **unchanged**) — Runs → Agent API through `proxy-preamble`
Nine importer files outside Agent API's own use; same list as 10-20. The LIN-3604 apportioning shows its two "new" edges came with −12 Agent API→Runs, so they are a by-product of a good move rather than drift. LIN-3738 stands, not landed.

### F5 (Medium, **unchanged**) — routes used as libraries
`task-chat`/`test`/`workspace-api → dashboard`, `workspace-api → proxy`, `dashboard`/`flight-companion → dispatch`. Router-of-routers (`proxy.js` → sub-routers, `provider-auth-routers.js`, `workspace-api`) is composition, not a finding.

### F6 (Medium, **unchanged counts; ownership slightly better; tool-blind**) — browser seam
40 non-min `public/` scripts at both commits; `window.X =` in `public/common.js` unchanged at 48; 33 `lib/`+`routes/` files mention `scripts:`. DOMPurify, marked and Chart.js are no longer committed `.min.js`: `lib/vendor-assets.js` (Platform) serves them from `node_modules` at the same URLs (`VENDOR_ASSETS`, `lib/vendor-assets.js:30`), so no renderer changed and the third-party globals now have a server owner. Still not visible to the import graph.

### F7 (Low, **unchanged**) — dead-import inflation (LIN-2600)
Ticket still Backlog; not re-scanned.

### F8 (Low, **slightly deeper**) — production loads `routes/test.js`
`server.js:134` now takes a second export, `installTestTokenLinearTransport` (called at `server.js:1112`), and `routes/test.js:38` imports `setLinearFetchImpl` from `lib/linear-fetch.js` (the Web routes→Providers +1 above). The wiring root now installs a test transport out of a route file. The production→test-fixture half belongs to Drift; the route-as-library half is Seams'.

### Observations that are not findings
- **`lib/errors.js` hub 43 → 44** cross-area importers (7 areas). It grew (23 exports) but its only import is `node:crypto`: a leaf hub cannot knot. Size is Code Quality's.
- **`harbour-token-format` text contract** (mirrored by comment/test in `lib/secret-scan.js` and `lib/runner-kit/runner.mjs`, no import edge): Drift's (`L8` in `drift-coherence-review-2026-10-23.md`). Cross-link only.
- **`lib/runner-kit/`**: claimed by Runs (`^lib/runner-kit/`), imports only `node:*`; its only outside importer is `lib/prompts/runner-kickoff.js` (part of F1's LLM→Runs weight).
- **Simple Dispatcher:** still out of remit. It is flat CommonJS (`dispatcher.js`: 33 `require(`, 0 `import`), and the tool reads ES `import` only. Drift claiming SD covers its cross-repo contract, not import direction. No tool built.

## 3. Hubs

Unchanged except `errors.js` (above). Watch list unchanged: `providers/state-map.js` 22, `workspace.js` 27, `openrouter` 16, `prompt-templates` 14, `tree.js` 5.

## 4. Ways in and rebuild readiness (changes first)

No area's readiness changed. Changes of note: **Platform** gains `vendor-assets.js` (a new way in for browser libs, same URLs; it `statSync`s the three `node_modules` files at boot, `lib/vendor-assets.js:48`, so a missing package now fails startup — a single boot-time failure point, not an import edge); **Auth** gains `connection-secondary-remint.js` (imports Auth only, wired from `server.js`); **Agent API** gains `harbour-token-format.js` (imported by Agent API files only). `lib/dispatch-entrance.js` is imported by `routes/dispatch.js`, `routes/proxy-dispatch.js` and `routes/proxy-kickoff.js` (and `lib/dispatch-factory.js`): it is the front door for dispatch *entrance* decisions, not for the Runs area, and it makes many outgoing edges (F1/F4). Readiness grades are as in 10-20 §9 below.

## 5. Tool blind spots (what it could not read)

4 unresolved imports (all `routes/test.js` fixtures); browser globals and `scripts:` wiring in `public/`; 14 `scheduler.register` jobs in `server.js` (timing, not imports); text contracts with no import edge; Simple Dispatcher (CommonJS). No parse failures, no dynamic imports, no unmapped files.

## 6. Guide edits since 10-20 vs guide proposals (kept apart from code)

- **Edits (2):** `harbour-token-format` added to Agent API (LIN-3795); `vendor-assets` added to Platform (LIN-3787). Both new files; neither moves a figure at `6d3b5cfd`.
- **Proposals, still unadopted, nothing enforces them:** retire the empty "Other features" catch-all (this window re-proves why); put routes in one layer; split "LLM & prompts" into two layers. LIN-3554 will add a "Task model" area.

## 7. Existing tickets and follow-ups

Checked against the code, not ticket state. **None landed.**

| ticket | finding | state | in code at HEAD |
|---|---|---|---|
| LIN-3736 | F1 hashing helpers | Backlog | not landed |
| LIN-3737 | F3 `collectIssueAttachments` | Backlog | not landed |
| LIN-3738 | F4 `proxy-preamble` | Backlog | not landed |
| LIN-3555 | F3 `RefResolutionError` | Backlog | not landed |
| LIN-2600 | F7 | Backlog | not landed |
| LIN-3554 | F2 | Backlog (owner call made) | not landed |
| LIN-3755 (under LIN-3754) | Auth↔Pages `findWorkspaceByUrlKey` | Todo | not landed |

**Minted this run: 0.** Seam moves landed only in the 10-13 → 10-20 window; since then none of the run-2 or run-1 follow-ups moved, except LIN-3554/3755, which moved because a purpose-parent (LIN-3754, the UI flank) pulled them. More one-move tickets of the same kind would grow an unworked pile. Suggestion for the operator (not an action here): give LIN-3736/3737/3738/3555 a purpose-parent the way LIN-3754 did, or park them explicitly. LIN-3829 (rebuild-kit check) does not touch `seams.mjs` as far as this review read.

## 8. Adversarial Second-Read

- **Tier:** 2 (fresh-context sub-agent with no memory of the report-writing turn).
- **Question:** "What is the largest item in this window (6d3b5cfd..5b32864e) that this report missed or misfiled?"
- **Reader's answer:** nothing material missed or misfiled. The largest in-window item is LIN-3787 (vendored client libs into `lib/vendor-assets.js`), already covered in §0, F6 and §4; the reader suggested one more line on its boot-time `statSync` failure point (added to §4). The reader read the full `lib/`, `routes/`, `server.js` import diff and found no cross-area edge beyond the five +1 links and no back edge, and reproduced 459/462 files, 968/973 links, 11 pairs, group 7, the five deltas and LIN-3604 898 → 886. It noted the 976 old-guide figure was not rerun and that F1 is a retrospective correction (LIN-3604 predates the window), so the headline was reworded.

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place

## 9. Trend ledger

Format: `name | kind | severity | delta`. Series = HEAD guide at both commits.

```
metric:files-in-scope                      | 462 | +3 (459)
metric:parse-failures                      | 0   | unchanged
metric:unresolved-relative-imports         | 4   | unchanged
metric:non-literal-dynamic-imports         | 0   | unchanged
metric:unmapped-files                      | 0   | unchanged
metric:cross-area-import-links(HEAD guide) | 973 | 968 -> 973
metric:two-way-area-pairs(HEAD guide)      | 11  | unchanged
metric:knot-group-size(of 12 areas)        | 7   | unchanged
metric:lib-to-routes-imports               | 0   | unchanged
knot:agents-chat<->runs(chat-tools)        | High   | unchanged (10-20 "worsened" re-read as LIN-3604 relocation)
knot:runs<->page-renderers(render-swipe)   | High   | unchanged
knot:providers->upward(openrouter,ref-resolver,proxy-wire) | Medium | unchanged
knot:runs->agent-api(proxy-preamble)       | Medium | unchanged
knot:routes-as-libraries(dashboard)        | Medium | unchanged
knot:browser-window-globals(common.js)     | Medium | unchanged (48 -> 48; vendor libs now server-owned)
knot:dead-import-inflation(routes/proxy.js)| Low    | unchanged
knot:production-loads-routes/test.js       | Low    | slightly deeper (second export; routes/test.js -> linear-fetch)
hub:tree.js                                | -      | unchanged
hub:providers/state-map.js                 | watch  | unchanged
hub:errors.js                              | watch (leaf) | new (43 -> 44)
area:browser-code                          | low-readiness  | unchanged
area:server-rendered-pages                 | medium         | unchanged
area:agent-api                             | medium         | unchanged
area:runs-and-dispatch                     | low-medium     | unchanged
area:llm-and-prompts                       | medium         | unchanged
area:auth-accounts-workspaces              | medium         | unchanged
area:providers                             | highest        | unchanged
area:platform-and-plumbing                 | high           | unchanged
area:reports-and-operator-tools            | high           | unchanged
area:web-routes                            | medium         | unchanged
area:other-features                        | n/a            | unchanged (empty; catch-all to retire)
area:wiring-server.js                      | n/a            | unchanged
```
