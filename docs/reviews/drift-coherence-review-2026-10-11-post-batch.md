# Drift & Coherence Review — post-batch gauge, run of 2026-10-11 (trend vs the 2026-10-11 edition)

**Grounding.** Measured at `LinearViewer` `159909051a27172dcff4b57826b27cbc03807cd2` / `simple-dispatcher` `3dc08b5b587b897fa83e4c76cbdb23cd6eec2e82`. Both were re-fetched from `origin/main` before measuring; `simple-dispatcher` has **0 commits** since the previous edition. Every count below was measured at these SHAs, and the baseline counts were re-measured at `6df0fbd5` (the 10-11 edition's grounding) rather than copied from its prose.

**Why this edition exists.** It is the post-batch gauge reading for **LIN-3449** (the coherence loop). Between the 10-11 edition (LIN-3450, merged as `015b5748`) and this run, two consolidation batches landed: 11 PRs, #1823–#1833. LinearViewer moved `6df0fbd5` → `15990905` with 12 commits. 102 production files changed (+1,126 / −1,458 lines, net **−332**, which matches LIN-3449's −135 − 197). New modules: `lib/loose-json.js`, `lib/workspace-lookup.js`, `lib/utils/time.js`, `lib/should-mock-ai.js`, `lib/starter-seed.js`, `lib/dispatch-lineage.js`, `lib/dispatch-feedback-format.js` and `routes/provider-auth-routers.js`. `lib/*.js` has 270 top-level modules and `routes/*.js` has 49.

**File name.** A file for today's date already exists (`drift-coherence-review-2026-10-11.md`, the pre-batch edition), so this one carries a `-post-batch` suffix. There is precedent for a suffix in `design-interface-review-2026-06-20-lin568.md`. The pre-batch file is not modified.

**Review-only.** No code, config, secret or under-review doc was changed. The deliverables are this report, its branch and PR, and the Linear updates.

**Headline.** **Batches 1–2 did what they claimed on the gauge rows they targeted, and three of them are clean resolutions by a shape-based count as well:**
- `lib-import-cycles`: 4 SCCs → **0**.
- `provider-auth-router-upward-imports`: 5 edges → **0**, static and dynamic.
- The `maxSessionsPerTask` cap: 5 restatements → **1 constant**.

Two zeros come from an old command that cannot see the shape the residue now takes:
- **Error envelopes.** The 10-11 command reads 0, but **74** hand-built JSON error bodies go out through `keepalive.send(4xx/5xx, {error…})`. There were 73 at baseline: this residue was always invisible to the command, so it is *not* a regression from LIN-3460.
- **Workspace lookup.** By shape, 5 hand-rolled comparisons remain in `workspace-urlkey.js` and `live-console.js`. All 5 were present at 10-11, and the guard that replaced the count pin still keys on the variable name.

The window's largest **newly recorded** item is LIN-3449's own batch-2 candidate 5: **the credential decision is still made in several places, and two of them give different answers.** After a headless token refresh, the owner session-scan lane returns `{ token: NEW, scope: OLD }`, and the proxy forwards the scope. This edition reproduced that at function level (finding 1). The runner-contract divergence (LIN-3451, High) is **unchanged**: the kit, SD and `docs/runner-prompt.md` did not move. No new import edge, cycle or cross-repo divergence was introduced by the window.

**Method notes (read before comparing counts).**
1. **Old commands are kept verbatim** next to every shape-based count. A row counts as *resolved* only when both agree.
2. **Cycles.** I used a Tarjan SCC walk over static `import` / `export … from` / side-effect imports of `lib/`, `routes/` and `server.js`, with a ~30-line scratch walker outside the repo; no tooling was added.
   - Run on a `git archive` of `6df0fbd5`, it **reproduces the 10-11 baseline exactly**: 377 nodes / 1,369 edges / 4 SCCs / 27 members, with the same member sets.
   - At HEAD it reads **385 nodes / 1,435 edges / 0 SCCs**.
   - Dynamic `import()` from `lib/` into `routes/` or `server.js`: 0.
   - The 6 new leaf modules, `routes/provider-auth-routers.js` and 6 former SCC members each loaded alone in a fresh `node` process (`NODE_ENV=test`): 14/14.
3. **Attribution.** There is no file split this window. Every importer and site delta is attributed to a named PR.
4. **Cross-repo rows and the credential audit** were re-verified by two fresh-context sub-agents working read-only. I re-checked their load-bearing claims myself (finding 1 was reproduced at function level). Their line-number corrections to the 10-11 edition are applied below.

---

## Batch verification (LIN-3449 batches 1–2)

| ticket | claim (LIN-3449 log) | measured at `15990905` | verdict |
|---|---|---|---|
| **LIN-3452** | 3 inline active-binding lookups → `activeConnectionBackedBinding` | All three now call the predicate: `credential-invariant-sweep.js:38`, `routes/workspace-api.js:1669` and `connection-credential.js:862`. That gives 11 calls in 6 files. The *second* copied rule from 10-11 is untouched: `legacyFallbackTarget` (`connection-credential.js:493-505`, "token match, else first") re-implements `selectIssueSourceBinding` (`lib/workspace.js:1163-1169`). It is a copy, not a divergence. The ticket did not name it. | **confirmed** (named scope); 1 sibling copy remains |
| **LIN-3114** | loose-JSON parse 7 → 1 (`lib/loose-json.js`) | 8 importers (the 7 named parsers plus `run-paragraph`, which uses `stripCodeFence`). Shape count: `lastIndexOf('}')` brace-slice appears only in the leaf, and no other fence-strip feeds `JSON.parse`. `lib/brief.js:81-83` keeps its own anchored whole-response fence strip for **prose**, which is a different contract (not flagged). | **confirmed** |
| **LIN-2389** | workspace-by-urlKey 18 → 1 (`lib/workspace-lookup.js`), count pin removed | The 09-26/10-11 command (`grep -rn "urlKey === urlKey"`) gives **2** raw lines: the leaf, plus the ticket-exempted referent match at `connection-credential.js:678`. 10 importers. **Shape count** (`.find/.some/.findIndex` comparing `.urlKey`): **5** workspace-by-key comparisons survive, all present at 10-11 and all named by it:<br>• `workspace-urlkey.js:240`: `live.some(w => w?.urlKey === key)`, a plain lookup<br>• `routes/live-console.js:58`: a plain lookup<br>• `workspace-urlkey.js:196`, `:256`, `:258`: compound predicates<br>The count pin was removed, but **a guard replaced it** (`tests/unit/lin-2389-workspace-lookup.test.js:101-157`, with 8 plant tests). It keys on the right-hand identifier being `urlKey`, so `key`-named comparisons escape it, which is the blind spot 10-11 flagged in the pin. `superseded-selection.js:51` now uses the finder (its evasion is fixed). | **partial** (old gauge 18 → 0; shape 5) |
| **LIN-3453** (3454/3455/3456) | tolerant timestamp parse 18 → 1 (`toEpochMs`) | The ticket's command (`git grep -l -E 'function (toMillis\|toMs\|_epoch)\('`) returns **0**. `toEpochMs` (`lib/utils/time.js:21`) has **30 importers**. The census lost two admission lines, both this decision's ("Copied verbatim from", "Formerly duplicated"). **Shape residue:** 3 private **Date-returning** tolerant parses in `lib/` with *different* junk semantics:<br>• `liveness-alarm-store.js:287` `toDate` passes an Invalid Date *instance* through<br>• `pipeline-loops.js:264` `_toDate` nulls it<br>• `session-telemetry.js:66` `_toDate` nulls it<br>The plan routed Date-returning helpers out of scope. LIN-3457 (census guard) was canceled. | **confirmed** (named class); 3 Date-returning twins remain (new low row) |
| **LIN-3459** | `shouldMockAi` 5 → 1; 4-node routes cycle gone | 1 definition (`lib/should-mock-ai.js:21`), 8 importers; the routes SCC is gone (Tarjan). The neighbouring **AI-availability gate** that consumes it is untouched: 13 inline copies, and two route families key it on *different* mock predicates (finding 4). | **confirmed**; sibling decision remains |
| **LIN-2388** | 6- and 2-member `lib/` SCCs gone | 0 SCCs. The new leaves `dispatch-lineage.js` and `dispatch-feedback-format.js` each define their exports once; `sameHead` is defined once (`run-closeout-state.js:22`). | **confirmed** |
| **LIN-675** | `lib/` → `routes/` 5 → 0; 15-member provider SCC gone | 0 static and 0 dynamic `lib/` → `routes/` or `server.js` edges. The wiring is one table at the composition root (`routes/provider-auth-routers.js:21-27`). It re-lists provider names next to the registry (`lib/providers/index.js`) but throws at boot on a missing row (`:38-40`), so it is not drift. `render-swipe.js:23` now imports `lib/starter-seed.js`. | **confirmed** |
| **LIN-3460** | 93 hand-written JSON error replies → 0 | The 10-11 command returns **0**. Importers of `lib/errors.js`: 35 → **43**. `res.status(<variable>).json(`: **8** route sites (they forward pre-built bodies). **Reshaped residue the command never saw:** **74** `keepalive.send(4xx/5xx, { error … })` (73 at `6df0fbd5`; the +1 is `routes/proxy.js` `keepalive.send(409, { error: err.message, ...refusal })`), plus 8 pre-built `{ status, body: { error } }` producers (`routes/proxy.js:1687-1694`, `lib/follow-up-dispatch.js:68-161`). The ticket's scope was the command, so this is a gauge blind spot, not an unmet claim. | **confirmed by its gauge; partial by shape** (finding 3) |
| **LIN-3461** | per-task cap → one fixed failsafe (`MAX_FRESH_SESSIONS_PER_TASK`); `maxSessionsPerTask` refs 0 | One constant (`lib/dispatch-factory.js:179`, value 30), one check (`:693`). `maxSessionsPerTask` appears in 0 production lines in `lib/`, `routes/`, `public/` and `server.js` (one comment remains at `dispatch-store.js:1576`), and in 0 lines in SD (it never existed there; `git log -S` is empty). The client sender in `public/common.js` was removed in the same PR. A stale doc row remains in `docs/v1.md:110` (hand-off). | **confirmed** |

**Batch-level reading:** 7 confirmed, 2 partial (LIN-2389 and LIN-3460, both on shape-based counts the old gauge cannot see), 0 regressed.

---

## Findings (severity-ranked; delta vs the 2026-10-11 edition)

### 1. `credential-decision-multiplicity` — **HIGH — NEW row** (LIN-3449 candidate 5; previously recorded only as the narrower `connection-binding-predicate-drift`)

**The decision:** which credential a workspace or binding uses, and from which copy. It is still made in several places that rank differently. LIN-3452 removed one copy of the *binding* rule; the *credential-source* rule was never consolidated.

- **Representations.** At least 6 durable or session copies of a provider credential exist:
  - the session scalar (`workspace.accessToken` / `credentials.token`)
  - the legacy `binding.credentials`
  - the per-request side-table (`connection-binding.js:25-27`)
  - owner-credentials under the legacy key (`owner-credential-store.js:14`)
  - owner-credentials keyed by connection (`:519/547`)
  - the Connection row (`connection-credential.js:371/446`)

  On top of those sit a 30 s token cache (`server.js:2611`) and the superseded-fingerprint registry (`superseded-selection.js`).
- **Choosers.** At least 7 functions choose the binding (`activeConnectionBackedBinding`, `selectActiveBinding`, `isActiveBinding`, `remintActiveCredential`, `findActiveInstallationId`, `selectIssueSourceBinding`, `legacyFallbackTarget`).
  - With several bindings and no token match, `selectActiveBinding` **refuses** (AMBIGUOUS), while `selectIssueSourceBinding`, `legacyFallbackTarget` and `remintActiveCredential` **pick the first**.
  - Two token-source precedences coexist by design. **E1** is `getWorkspaceToken` → `credentials.token ?? accessToken` (`lib/workspace.js:806-819`). **E2** is `getWorkspaceMirrorToken` → `accessToken` (`:844-848`); its own comment, `:836-839`, records that the two "genuinely diverge after the headless mirror".
  - Expiry ranking is written 3 times: `workspace-token-resolver.js:87`, `connection-access.js:32/56`, and `workspace-token-resolver.js:303`.
  - At least 4 lanes (browser, proxy/guest, owner-less `getWorkspaceAccessToken`, titles) reach different subsets of these.
- **A wrong answer, reproduced at function level** (scratch `node` run at HEAD, no file changes):
  1. Start from a legacy Linear workspace linked with token `OLD` via `linkProvider`.
  2. Run `mirrorRefreshedCredentialIntoOwnerRows` with `NEW` (`lib/workspace-token-refresh.js:135-136` writes only `accessToken` / `tokenExpiresAt`).
  3. Result: `getWorkspaceToken` → `OLD`, `getWorkspaceMirrorToken` → `NEW`, `getWorkspaceCallScope` → `"OLD"`.
  4. `selectOwnerWorkspaceToken` → `{ token: "NEW", scope: "OLD" }`. The scan reads E2 for the token but `getWorkspaceCallScope` (E1) for the scope at `workspace-token-resolver.js:150-155`.
  5. The proxy forwards `scope ?? token` (`routes/proxy.js:812`), so it sends **the pre-refresh token**, which the refresh ran because it was expired or within 5 minutes of expiry.

  The end-to-end reach (a legacy Linear row, a headless refresh, and a session-scan resolve after the 30 s cache) is **not reproduced**.
- **The sweep is a symptom.** `lib/credential-invariant-sweep.js` (LIN-2236) logs three store pairings that can disagree (`:116-148`, `:162-167`). It does *not* watch the E1/E2 pair, the Connection mirror against its record (LIN-3295), or the legacy copy against the LIN-3127 Connection copy.
- **Legacy bindings never convert.** `convertToConnectionBacked` returns legacy whenever `prior !== 'none'` (`connection-credential.js:1274`), so every reader keeps both arms. `persist-binding-sibling-seams` is still 7, and the fallback bodies differ by seam:
  - `auth.js:309/436` write the legacy owner credential and a Connection
  - `jira-auth.js:328` writes a Connection with `omitToken`
  - `jira-auth.js:700` writes a Connection only
  - `account-merge.js:169` writes a Connection and, if there is a refresh token, the legacy owner credential
- **Cost.** Any change to "which credential" touches 4+ lanes, the count pins (`tests/unit/lin-3124-pr1-count-pins.test.js:116-187`) and a hash-pinned selector. This is the LIN-3275/3276 incident family; LIN-3277 says it ran through more than a dozen tickets. Open residues: LIN-3287, LIN-3295, LIN-2484, LIN-1921, LIN-1981.
- **Owning tickets.**
  - LIN-2150 (Todo, "Migration path off per-workspace credentials") is the vehicle for the whole decision, and has been **updated, not minted**.
  - No ticket names the E1/E2 scope/token split. It is **minted** as a single-decision batch-3 candidate (see Follow-ups).

### 2. `runner-contract-semantics-cross-repo` — **HIGH — UNCHANGED** (LIN-3451, Backlog, unmoved)

SD has 0 commits, `git diff 6df0fbd5..HEAD -- lib/runner-kit/` is empty, and `docs/runner-prompt.md:219` still says halts are binding "with Simple Dispatcher's meaning". Every row of the 10-11 divergence table re-verifies unchanged: halt ×4, target, repo, other row fields, markers, the 2000-char cap and the wake regex. Harbour-side line moves:
- `dispatch-store.js` `pollAvailable` is at `:1017-1018` → `listItems` `:886`
- `WAKE_FEEDBACK_REGEX` is at `dispatch-terminal.js:63`
- `run-view.js:136` holds the wake regex copy

**Corrections to the 10-11 edition** (found by this run's sub-agent and checked):
- SD never reads `item.cascade`; Harbour expands cascades itself (`routes/dispatch.js:308`, `dispatch-store.js:2035`).
- `maxSessionsPerTask` never existed in SD. The "other row fields" list should not have named either.
- SD's stop text is `dispatcher.js:605` and its halt-stop log is `:2028` (10-11 cited 603 and 2027).
- SD's stale wake-regex citation is at `feedback.js:19` and still says `:53`, now 10 lines off.

The new failsafe 409 `TASK_SESSION_RUNAWAY` (LIN-3461) fires on enqueue only, and neither runner enqueues, so it is not a cross-repo exposure. LIN-3460's envelope moves kept every body byte-identical, and the runner-facing `routes/runner-kit.js:30,37` now uses `notFound.json`, so that is not a cross-repo exposure either. **LIN-3451 updated** with the corrections.

### 3. `routes-error-envelope-fragmentation` — **MEDIUM — old gauge RESOLVED (93 → 0); reshaped residue named**

The 10-11 command (verbatim, below) returns **0**, and `lib/errors.js` importers rose 35 → 43. The decision ("what a JSON error reply looks like, written once") is not yet one place:

`grep -rnE "res\.status\(4[0-9][0-9]\)|res\.status\(5[0-9][0-9]\)" routes/*.js server.js | grep "\.json(" | grep -v routes/test.js`

- **Second writer, 74 sites:** `keepalive.send(<4xx|5xx>, { error … })`. By file: `workspace-api` 37, `proxy-compute` 10, `dashboard` 9, `proxy-dispatch` 9, `proxy` 4, `ship-biscuit` 4, `http-keepalive` 1. `lib/http-keepalive.js:92-99` legitimately needs its own transport (after a flush the status rides in the body as `statusCode`), but the *body* is hand-built at every site. There were **73 at `6df0fbd5`**: the 10-11 command never saw them, so the 10-11 "93" understated the residue by ~74. That is not a regression.
- **Pre-built bodies:** 8 `{ status, body: { error } }` producers (`routes/proxy.js:1687-1694`, `lib/follow-up-dispatch.js:68,81,101,156,161`), sent through 8 `res.status(<var>).json(body)` sites. `follow-up-dispatch.js:101` hand-builds the `{error, code, category, retryable}` shape that `errorEnvelope` (`lib/errors.js:178`) exists to build; `errorEnvelope` has 2 callers.
- **HTML error pages — two writers** (closes the 10-11 stated gap; new row `html-error-page-two-writers`). `lib/errors.js` `htmlError` (reached via `.html()` at **9** sites in `server.js` and `routes/workspace.js`) and `lib/render-pages.js:602` `renderErrorPage` (**62** sites) render *different* pages: `htmlError` has no header and an "Error N" title; `renderErrorPage` has the Harbour header, an action button and a diagnostic block. On top of those are 4 raw-text 500/404 replies (`dashboard.js:1295,2542,2712`, `task-share.js:78`). These counts are identical at `6df0fbd5`. The rendered difference goes to Design & Interface; the two authorities are ours.
- **Cost.** Adding a field to the JSON error envelope is one place for the 96 converted sites and **74 + 8** places elsewhere. Choosing the HTML error page is two modules that already disagree.
- **Ticket.** LIN-3460 is Done; its scope was the command. The keepalive residue is **minted** as a batch-3-shaped single decision.

### 4. `ai-availability-gate-duplication` — **MEDIUM-LOW — NEW row** (neighbour of LIN-3459)

LIN-3459 consolidated *"is the AI mocked?"*. The decision that consumes it, *"is AI available for this request, and with which OpenRouter key?"*, is restated:
- **Two key resolvers:** `routes/proxy.js:115` `resolveProxyLLM` and `lib/chat-request.js:55` `resolveChatCredential`. They are equivalent except for the no-key case (`undefined` vs `null`).
- **13 inline "not configured → 503" gates:** `routes/workspace-api.js:836,1063,2016,2259,2624,2945`; `proxy-compute.js:389,1106,1212,1388,1493`; `proxy-dispatch.js:1138`; `proxy-flight-companion.js:201`.
- **The two route families key the gate differently:**
  - `workspace-api` uses `!shouldMockAi(workspace) && … && !process.env.OPENROUTER_FREE_TIER_KEY`.
  - The proxy routes use `!isTestMode && … && !isFreeTier`, where `isTestMode` is test-token only.

  So under `NODE_ENV=test` a local-provider session is AI-mocked on `/workspace/:k/api/recap` but 503s on `/api/proxy/recap`. That is inferred from code, not reproduced; production behaviour is equivalent.
- **The data-mock predicate** `NODE_ENV === 'test' && accessToken === 'test-token'` is inlined **34** times (38 at `6df0fbd5`; −4 by LIN-3459's file moves). This is a separate, legitimately distinct decision (`routes/workspace-api.js:330-338` says so), but it has no one place either.
- **Cost:** a 13-place edit, across 5 files with two predicate dialects, to change when the AI is "configured".
- **Ticket:** none. **Minted** (third follow-up).

### 5. `provider-resolution-incantation` — **LOW — IMPROVED** (18 → 0 by the old command; 5 by shape)

See the LIN-2389 row. The residue is all in `lib/workspace-urlkey.js` (a module that itself decides *keys*, not lookups) and `routes/live-console.js:58`. **Gauge validity:** the replacement guard keys on the identifier `urlKey`, so it repeats the evasion surface 10-11 found in the pin. Next edition: keep both counts. Not promoted.

### 6. `dispatch-entrance-field-duplication` — **MEDIUM-LOW — IMPROVED** (cap part resolved)

The cap restatements (5 sites at 10-11) are gone (LIN-3461). What remains, all unchanged at `6df0fbd5`:
- 15 field-validator lines across 5 files (`routes/proxy-dispatch.js` 8, `routes/dispatch.js` 4, `proxy-kickoff`, `dispatch-validation`, `proxy-instructions` 1 each). Examples: `waitForFollowUps must be a boolean` ×3, at `dispatch.js:343` and `proxy-dispatch.js:304,730`.
- 3 doc→item projections in the store (`dispatch-store.js:1140,2214,3246`).
- The census's top no-import-edge co-change pairs over 09-26 → now are still `dispatch-store` / `routes/dispatch` (13), `dispatch-store` / `proxy-dispatch` (12) and `dispatch` / `proxy-dispatch` (12).

Not promoted (LIN-3339 remains the vehicle).

### 7. `connection-binding-predicate-drift` — **LOW-MEDIUM — IMPROVED**

The main rule is resolved (LIN-3452). The copied selector `legacyFallbackTarget` remains; it is folded into finding 1's binding-chooser list.

### 8. `tolerant-date-parse-date-twins` — **LOW — NEW row**

These are the 3 Date-returning private parses listed in the LIN-3453 row. Their junk semantics differ: `liveness-alarm-store.js:287` returns an Invalid Date instance unchanged. Each is equivalent to `toEpochMs(v) == null ? null : new Date(ms)`. Two inline closures (`consumer-poll-warning.js:72`, `observation-sessions-store.js:197`) also re-derive the parse. Cost: a fourth junk-input behaviour beside the one LIN-3453 settled. Not promoted.

### 9. Resolved this window (by both the old command and a shape count)

- `lib-import-cycles`: 0 SCCs.
- `provider-auth-router-upward-imports`: 0 edges.
- The `shouldMockAi` copies: 1 definition.
- The loose-JSON copies: 1 owner.
- The `maxSessionsPerTask` restatements: 0.

### 10. Unchanged (re-measured)

| row | measurement |
|---|---|
| `production-to-test-fixture-imports` | **7** static (`server.js:132-134`, `routes/next-run.js:32`, `task-chat.js:33`, `workspace-api-roadmap.js:25`, `workspace-api.js:94`), plus the dynamic `routes/proxy.js:143` and the harness route |
| `sse-frame-writer-duplication` | 2 copies beside `lib/sse.js:23` (`routes/workspace-api.js:1019`, `workspace-api-roadmap.js:38`); LIN-2663 tracks it, not minted |
| `ui-divergences-registry-staleness` | native `confirm(` **10** |
| `simple-dispatcher-api-base-duplication` | SD 2 (`config.js:17`, `feedback.js:5`); Harbour's inline `${req.protocol}://${req.get('host')}` 30 |
| `periodical-report-filename-convention-split` | `periodicals.js:881`; this edition's suffix is a second precedent |
| `run-page-identity-scrape` | `public/session.js:740,868` (LIN-3349, unmoved) |
| `target-vocabulary` | 7 bracketed lists unchanged |
| `owner-word-collision` | 4 sites (`routes/workspace-api.js` now `:4364/4373` through an injectable default) |
| `run-family-render-primitives` | 2/38 |
| `server-formatter-duplication` | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 |
| `wake-marker-regex-copies` | 3 |
| `runner-liveness-assumption` | `liveness-detectors.js:81` |
| `persist-binding-sibling-seams` | 7 |

### 11. Gauge-validity notes for LIN-3449 (not findings)

- **Batch 1 added three source-scan guards** before the agreed "no new guards, sweeps or count pins" style:
  - `tests/unit/lin-2389-workspace-lookup.test.js:101-157`, with 8 plants
  - `tests/unit/lin-3452-active-binding-single-predicate.test.js:68+`
  - `tests/unit/loose-json.test.js:70-82`

  Batch 2 added none. The census's sync-pinning test count holds at 34; it does not classify these three.
- **Census (repo-native, as instructed).**
  - `admissions` at `15990905`: **123** (125 at `6df0fbd5`). There are 0 new admission lines; the 2 that went are LIN-3453's.
  - `coupling --since 2026-10-11`: 0 pairs (13 PRs, too thin).
  - Widened to `--since 2026-09-26`: 341 pairs, 250 with no import edge. The top unlinked pairs are the dispatch-entrance trio (finding 6), `public/common.js` ↔ `public/prompt-section.js` (11) and `lib/proxy-instructions.js` ↔ `routes/proxy-dispatch.js` (9). The proxy-instructions pair is the catalogue text restating the route contract, which Documentation Review owns.
  - `mirrored`: 0 of the 11 window PRs (consolidation PRs delete lines; they don't mirror them).
  - TODO/FIXME added this window: 0.
- **Not flagged (coincidental similarity).** The one-line `bindings.find(b => b.provider === p && b.scope === s)` appears 5× (`held-connection.js:280`, `connection-credential.js:1269`, `connection-store.js:724`, `workspace.js:750`, `connection-binding.js:147`). It is a composite-key lookup, not a ranked choice. `openrouter.js:1140,1414` are two SSE *readers* of one stream format (Data & Fetch).

**Gaps stated.**
- SD-internal duplication was not re-audited; SD has 0 commits.
- Duplicated decisions among `public/` classic scripts remain invisible to the import walk and to most of the census.
- Finding 1's end-to-end production reach and finding 4's test-time divergence are inferred from code, not reproduced.

---

## Cross-repo contract verdicts (Harbour · SD · runner kit)

| field | verdict at `15990905` / `3dc08b5` | delta vs 10-11 |
|---|---|---|
| halt | Meaning still differs 4 ways (SD `dispatcher.js:1654`, `pacing.js:28,106`, `followup.js:40`; kit `runner.mjs:186-242`); parity claim still at `docs/runner-prompt.md:219` and `runner.mjs:181-185` | unchanged (High) |
| sentinel / `DECISION` / markers | Kit still cannot emit `[pending]`/`[decision]`; 1 cross-party pin; wake regex ×3 un-imported (authority `dispatch-terminal.js:63`) | unchanged; SD citation now 10 lines stale |
| `target` | SD `targets.js:16-19`; Harbour runner poll unfiltered (`proxy-runner.js:94` → `dispatch-store.js:1017` → `:886`); 7 LV lists | unchanged |
| `repo` | SD alone validates (`dispatcher.js:159-187`, `admission.js:33-37`); kit ignores | unchanged |
| row fields SD acts on, kit ignores | `queueIfBusy` (`followup.js:107`), `waitForFollowUps`, `subscription`, `force` | unchanged; **corrected**: `cascade` and `maxSessionsPerTask` removed from the list (SD never read them) |
| `harness` | Kit hard-codes `'claude-code'` (`runner.mjs:58,120-122`) | unchanged (low) |
| 2000-char feedback cap | SD truncates (`feedback.js:6`), kit throws (`runner.mjs:75`), Harbour 400 (`dispatch-feedback-validation.js:17`) | unchanged |
| error envelope on runner-facing routes | `routes/runner-kit.js:30,37` now `notFound.json`, bytes identical; SD parses only `retryable`/`code`/`detail` on poll (`queue.js:78-83`); kit reads status only | **improved** (adoption), no drift |
| per-task cap | Harbour-only failsafe 409 `TASK_SESSION_RUNAWAY` on enqueue; neither runner enqueues | new, no cross-repo exposure |
| `kind`, `terminal`, `effort`, `model`, status enum | Clean | held |
| API base | SD 2 copies; kit takes `baseUrl` from the server | unchanged |
| liveness | `ACTIVE_FRESH_MS` (`liveness-detectors.js:81`) assumes SD heartbeats; kit posts none | unchanged (inferred) |
| CI | LV Node 20, `ci-success` `needs:[unit,e2e,secret-scan]`; SD Node 22 (`ci.yml:43`), no aggregate | unchanged |

---

## Sibling Hand-offs

- **Documentation Review.**
  - `docs/runner-prompt.md:219` parity claim (unchanged)
  - `docs/v1.md:110` still describes the per-task `maxSessionsPerTask` budget LIN-3461 removed
  - `lib/workspace-lookup.js:4-6` header says renderers "sit in an import cycle", but there are 0 SCCs since LIN-675
  - `lib/connection-binding.js:11-12` "only one module writes" (`routes/workspace-api.js:1678-1679` also writes)
  - `server.js:2839` says `getWorkspaceAccessToken`'s only caller is `routes/test.js`, but it has 6 calls in 5 files
  - SD `feedback.js:19` cites `dispatch-terminal.js:53` (now `:63`)
  - SD `docs/module-map.md` / `CLAUDE.md` still don't mention the runner kit
  - LIN-3451's body cites pre-window line numbers
- **Design & Interface:** the two HTML error pages render differently (`htmlError` vs `renderErrorPage`, finding 3). Pills, buttons and details in the run/task page family are unchanged.
- **Test Coverage:**
  - the three batch-1 source-scan guards (§11)
  - LIN-3449's "remake tests against clean modules" idea
  - the E1/E2 divergence (finding 1) is pinned *as intended* by `tests/unit/lin-3124-pr1-s0-characterization.test.js:163`
- **Code Quality:** the runner kit's missing HTTP timeouts (`runner.mjs:590-602`, unchanged).
- **Security Review:**
  - the unchecked share `issueId` (unchanged)
  - `getWorkspaceAccessToken` without an owner (`server.js:2841-2857`, called from `dispatch-factory.js:801`) scans every account's sessions and can return another account's token for a legacy workspace. Inferred, not reproduced; this is a trust-boundary question rather than a coherence one.
- **API Quality:** the new 409 `TASK_SESSION_RUNAWAY` is documented (`docs/proxy-integration.md:2638`) but not named in the autopilot kickoff prompt.
- **Data & Fetch Architecture:** the two OpenRouter SSE stream readers in `lib/openrouter.js`.
- **Dependency & Supply-Chain:** nothing.

---

## Follow-ups (highest severity only)

Written in LIN-3449's agreed child-ticket style: one decision, the behaviour settled up front, and Done when one place decides, every caller uses it and the old copies are deleted. No guards, sweeps or count pins. Linear was searched before minting.

**Minted:**
- **LIN-3464** — *One current token for a legacy workspace: retire the E1/E2 split so a headless refresh is seen by every reader* (finding 1). This is the smallest single decision inside candidate 5, and it carries a wrong answer reproduced at function level.
- **LIN-3465** — *Keepalive error replies through `lib/errors.js`: retire the 74 hand-built `keepalive.send(4xx/5xx, {error})` bodies* (finding 3). Bytes unchanged; it is the same shape as LIN-3460.

**Updated, not minted:**
- **LIN-2150** — the credential decision in full. It is the nearest existing vehicle for candidate 5: migrate legacy bindings, then delete the legacy arms and the sweep.
- **LIN-2427** — the AI-availability gate (finding 4). This ticket already names `resolveProxyLLM`; the update records the second resolver, the 13 gates and the two mock dialects.
- **LIN-3451** — the runner contract is unchanged, plus the line and row corrections.

**Not promoted:**
- findings 5–8 (below the cut, or residue of a ticket that is now Done)
- the HTML error-page split (recorded in finding 3; LIN-3465 names it as out of scope)
- the unchanged rows

## Ticket trend — the promotion path converted

| ticket | state at dispatch | change this window |
|---|---|---|
| LIN-675 (provider-seam SCC, upward edges) | Done | **converted** after ≥ 3 unmoved editions: 5 → 0 edges, SCC gone |
| LIN-2388 (lib cycles) | Done | **converted**: 6- and 2-member SCCs gone |
| LIN-2389 (urlKey lookup) | Done | **converted** on its gauge (18 → 0); shape residue 5; its count pin was replaced by a guard |
| LIN-3452 (active-binding copies, minted 10-11) | Done | converted within hours of minting |
| LIN-3114 / LIN-3453 / LIN-3459 / LIN-3460 / LIN-3461 | Done | converted (batch tickets); LIN-3457 (census guard) Canceled |
| LIN-3451 (runner contract, minted 10-11) | Backlog | unmoved (parked by LIN-3449); updated with corrections |
| LIN-2663 (SSE copies) | Backlog | unmoved; still 2 |
| LIN-3349 (run-page rebuild) | Backlog | unmoved; owns `run-page-identity-scrape` |
| LIN-3339 (One job, many paths) | In Progress | no commits; last comment 10-08; the coherence loop has overtaken it as the consolidation vehicle |
| LIN-3074 (halt copy / runbook) | Backlog | unmoved |
| LIN-3347 (SD dead repo-guard refs) | Backlog | unmoved (SD 0 commits) |

The 10-11 edition observed that "the promotion path is still not converting". This window reverses that: every standing Drift & Coherence follow-up in `lib/` (LIN-675, 2388, 2389), plus 6 other decisions, closed in under five hours (merges 10:47–15:26 BST). All of them were scoped as one decision per ticket. The open items are the cross-repo row (deliberately parked) and two Backlog tickets that were never put in a batch.

---

## Adversarial Second-Read

*Pending: recorded after the report and follow-ups are written (see the LIN-3462 verdict comment).*

---

## Compact trend ledger

`07-12` was never recovered (lost edition, task LIN-1231): every 07-12 cell is `not recovered` and nothing is interpolated. Row names are stable. The 43 rows of the 10-11 ledger are carried in order and new rows are appended. The `10-11` column is the pre-batch edition at `6df0fbd5`; `10-11 post-batch` is this run at `15990905`. Severity is this run's grade.

| finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | 2026-10-11 | 10-11 post-batch | delta |
|---|---|---|---|---|---|---|---|---|
| `lib-import-cycles` | resolved | clean | not recovered | 3 elementary cycles / 3 modules / 5 edges (latent) | kpi 3 (unchanged) + **new 2-node `dispatch-store ↔ digest-feedback`** (latent) | 4 SCCs / 27 members: provider 15 + **6 (kpi + dispatch/digest merged via `milestone-funnel`)** + new `run-evidence↔run-closeout-state` + new 4-node routes cycle (latent, 27/27 load alone) | **0 SCCs / 0 members** (385 nodes / 1,435 edges); walker reproduces 10-11 baseline exactly at `6df0fbd5`; 0 dynamic upward imports | **resolved** (LIN-2388, LIN-675, LIN-3459) |
| `provider-auth-router-upward-imports` | resolved | 2 edges, no cycle | not recovered | 4 edges, all inside static cycles; SCC 13 (re-measured by this run at `292ac962`; not stated in the 08-29 edition) | 4 edges; **SCC 13→15** (+`github-install-flow`, +`render-settings`) | SCC 15 (unchanged); edges **4→5** (+`render-swipe.js:23`→`routes/workspace.js`) | **0** `lib/`→`routes/`/`server.js` edges (static and dynamic); SCC 15 gone; one wiring table `routes/provider-auth-routers.js:21` | **resolved** (LIN-675) |
| `routes-error-envelope-fragmentation` | medium | 5 importers, ~53 residue | not recovered | 14 importers, 68 residue (routes-only); `dashboard.js` half-adopter | 26 importers but **adoption flat** (11 from the `proxy.js` split); residue **76 → 87** matched-SHA; `flight-companion.js` **0 → 8** | 35 importers (no split artifact; 8 born-adopters + 1 genuine); residue **87→93** (`task-chat` +4, `runner-kit` +2) | 10-11 command **0** (LIN-3460); 43 importers; shape: **74** `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`, never seen by the command) + 8 pre-built `{status,body}` + 8 `res.status(<var>).json(` | **old gauge resolved; reshaped residue named (not a regression)** |
| `production-to-test-fixture-imports` | medium-low | — | not recovered | 7 sites | 7 sites | 7 sites | 7 sites | unchanged |
| `periodical-report-filename-convention-split` | medium-low | — | not recovered | id↔filename join non-mechanical | same | same (`periodicals.js:881`) | same (`periodicals.js:881`); this edition adds a `-post-batch` suffix | unchanged |
| `dispatch-kind-vocabulary-cross-repo` | — | — | not recovered | 3 hardcoded keys | 3-key subset | `NO_BOOTSTRAP_KINDS` deleted (LIN-3199); bare `'wake'` literal only (18 lines / 10 files) | held resolved (SD 0 commits) | held |
| `provider-resolution-incantation` | low | 4 sites | not recovered | 16 sites | **17 sites** (18 raw incl. canonical helper body) | **18 sites** (21 raw lines); new `superseded-selection.js:53` written to evade the count pin | 09-26 command **2** raw lines (leaf + exempt referent) = 0 hand-rolled; **shape: 5** (`workspace-urlkey.js:196,240,256,258`, `live-console.js:58`); pin replaced by a name-keyed guard | **improved** (18→0 old cmd; 5 by shape) |
| `ui-divergences-registry-staleness` | low | — | not recovered | registry 4 / actual 6 | registry 4 / actual **9** | native `confirm()` **9→10** (`proxy.js:389`) | native `confirm()` 10 | unchanged |
| `simple-dispatcher-api-base-duplication` | low | — | not recovered | 2 | 2 | 2 (kit takes `baseUrl` from server) | 2 | unchanged |
| `cross-repo-halt-vocabulary` | **high** | — | not recovered | — | independently-defined `{pause,stop}` / `{mode,setAt,setBy}`; LIN-3074 | value single-authority; **meaning diverges 4 ways** SD↔kit; docs claim parity; LIN-3074 covers copy only | meaning diverges 4 ways (SD 0 commits, kit diff empty); `runner-prompt.md:219` parity claim stands | unchanged |
| `cross-repo-sentinel-decision-marker-vocabulary` | **medium** | — | not recovered | — | grammar split clean; word vocabulary duplicated | kit cannot emit `[pending]`/`[decision]`; wake regex ×3 un-imported; 1 cross-party pin | kit cannot emit `[pending]`/`[decision]`; wake regex authority `dispatch-terminal.js:63`, 3 copies; SD cite 10 lines stale | unchanged |
| `target-vocabulary` | **medium** | — | not recovered | — | 3 disagreeing LinearViewer lists + inline copies; SD owns runner set | LV 17 lines / 9 files (+`runner-owner-gate.js:22`); 3 lists persist; kit/Harbour poll unfiltered vs SD `cli`/`web` | 7 bracketed lists unchanged; 16 lines / 9 files (this run's method; 10-11's 17 not reproducible) | unchanged |
| `sse-frame-writer-duplication` | low | — | not recovered | — | 2 byte-identical copies of canonical `lib/sse.js:23 sendSSE` | 2 copies; **LIN-2663** tracks (not minted) | 2 copies (LIN-2663) | unchanged |
| `routes-proxy-decomposition` | — | — | not recovered | — | `routes/proxy.js` 7,315→1,591 lines, 11 injected sub-routers | held (`proxy.js` 11 sub-routers); no new split this window | held | held |
| `cross-repo-repo-list` | **medium-low** | — | not recovered | deliberate | deliberate; LIN-2974 Done | Harbour list **deleted** (LIN-3333); SD alone validates; kit ignores `item.repo`; LIN-3347 SD-side only | unchanged | unchanged |
| `ci-convention-split-across-repos` | informational | — | not recovered | Node 20 vs 22 | same; `ci-success` `needs:[unit,e2e,secret-scan]` | same (Node 20 vs 22; `ci-success` `needs:[unit,e2e,secret-scan]`) | same | unchanged |
| `semicolon-style-split` | low (informational) | unchanged | not recovered | unchanged | unchanged | unchanged (not re-measured; no style change observed) | not re-measured (new `routes/provider-auth-routers.js` omits semicolons) | unchanged |
| `client-escape-html-duplication` | — | resolved | not recovered | held | held | held (1 definition) | held (not re-measured; `public/` diff touches only `common.js`/`observation.js`) | held |
| `client-shared-helper-duplication` | — | largely resolved | not recovered | resolved, held | held | held (`formatElapsed` pair noted under `server-formatter-duplication`) | held | held |
| `client-section-fetch-idiom-duplication` | — | resolved | not recovered | held (19 files) | held (**20 files**) | held (**23 files**) | held (24 files by `git grep -l window.api`, same at `6df0fbd5`) | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | not recovered | held | held | held (module absent) | held | held |
| `store-module-uniformity` | — | clean (10) | not recovered | clean (22) | clean (**24**) | **32/33** (33 stores); 1 naming outlier `pr-state-store` | 33 stores (no new store) | held |
| `server-side-escaping` | — | clean (26) | not recovered | clean (45) | clean (**46**) | clean (**55**) | 55 importers | held |
| `dispatch-payload-centralization` | — | clean (5) | not recovered | clean (8) | clean (8) | clean (**5** by the 09-26 command; the 09-26 "8" was mis-stated) | held (not re-measured) | held |
| `renderer-provider-abstraction` | — | clean | not recovered | clean | clean | held (not re-measured beyond provider seam) | held (not re-measured) | held |
| `cache-module-family` | — | — | not recovered | clean | clean (7) | clean (7, two families) | held (not re-measured) | held |
| `lib-components-primitive-adoption` | — | not assessed | not recovered | clean (30/30) | clean (**31/31**) | **36/38** (2 fragment modules) | 36/38 | held |
| `state-store-write-seam` (SD) | — | not assessed | not recovered | clean | clean | clean (incl. 3 new SD modules) | held (SD 0 commits) | held |
| `phase-vocabulary-centralization` (SD) | — | not assessed | not recovered | clean, exemplary | clean, exemplary | clean (incl. 3 new SD modules) | held (SD 0 commits) | held |
| `target-harness-axis-orthogonality` | — | not assessed | not recovered | clean | clean | clean | held | held |
| `test-seam-separation` | — | not assessed | not recovered | clean | clean | clean | held | held |
| `css-token-layer` | — | not assessed | not recovered | clean, 1 ratified outlier | does not reproduce (sibling-owned) | sibling-owned (Design & Interface) | sibling-owned | routed |
| `runner-contract-semantics-cross-repo` | **high** | — | not recovered | — | — | **NEW: kit re-implements SD reactions; diverged on halt ×4, target, repo, markers** | unchanged on every row (LIN-3451, Backlog); corrections: `cascade`/`maxSessionsPerTask` never read by SD | unchanged |
| `connection-binding-predicate-drift` | low-medium | — | not recovered | — | — | shared predicate + 3 inline copies lacking stale-marker guard; +1 copied selector | 3 copies → predicate (11 calls / 6 files); `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains | **improved** |
| `run-page-identity-scrape` | medium | — | not recovered | — | — | `session.js:738-742,866` task id from neighbouring widget; LIN-3349 | `session.js:740,868`; LIN-3349 | unchanged |
| `dispatch-entrance-field-duplication` | medium-low | — | not recovered | — | — | `maxSessionsPerTask` ×5; fields re-serialised 6×/4× | cap restatements 5→**0** (one constant, LIN-3461); field validators 15 lines / 5 files and store projections ×3 unchanged | **improved** (cap resolved) |
| `owner-word-collision` | low | — | not recovered | — | — | `viewerIsOwner:true` ×4 = "session member" | 4 sites | unchanged |
| `run-family-render-primitives` | low | — | not recovered | — | — | 2 fragment modules hand-build pills/buttons/details | 2/38 | unchanged |
| `persist-binding-sibling-seams` | low | — | not recovered | — | — | ×7 sibling seams | 7 seams; fallback bodies differ (feeds `credential-decision-multiplicity`) | unchanged |
| `server-formatter-duplication` | low | — | not recovered | — | — | `formatDuration`/`formatUsd`/`formatElapsed` copies | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | unchanged |
| `wake-marker-regex-copies` | low | — | not recovered | — | — | 3 new LV copies, none import `dispatch-terminal.js:61` | 3 (`run-view.js:136`, `liveness-detectors.js:130`, `task-page-loader.js:60`) | unchanged |
| `runner-liveness-assumption` | low | — | not recovered | — | — | `ACTIVE_FRESH_MS` assumes SD heartbeats; kit posts none (inferred) | `liveness-detectors.js:81`; kit posts no heartbeat | unchanged |
| `workspace-urlkey-consolidation` | — | — | not recovered | — | — | `deriveUrlKey` used by all 7 bind arms; per-arm derivations deleted (LIN-3382); Linear `org.urlKey | held (module untouched) | held |
| `credential-decision-multiplicity` | **high** | — | not recovered | — | — | — | ≥6 credential copies, ≥7 binding choosers, E1/E2 token precedences; session-scan returns `{token:NEW, scope:OLD}` after headless refresh (function-level repro); sweep watches 3 pairings | **new row** (LIN-3449 candidate 5) |
| `keepalive-error-envelope-writer` | medium | — | not recovered | — | — | — | 74 hand-built `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`) | **new row** (pre-existing, newly measured) |
| `html-error-page-two-writers` | low-medium | — | not recovered | — | — | — | `htmlError` 9 vs `renderErrorPage` 62 (+4 raw text), pages differ | **new row** (closes 10-11 gap) |
| `ai-availability-gate-duplication` | medium-low | — | not recovered | — | — | — | 2 OpenRouter key resolvers; 13 inline 503 gates, 2 mock dialects; data-mock predicate inline ×34 (38 at `6df0fbd5`) | **new row** |
| `tolerant-date-parse-date-twins` | low | — | not recovered | — | — | — | 3 private Date-returning parses (`liveness-alarm-store:287`, `pipeline-loops:264`, `session-telemetry:66`), junk semantics differ | **new row** |
| `timestamp-parse-consolidation` | — | — | not recovered | — | — | — | `toEpochMs` 30 importers; ticket grep 0 (LIN-3453) | **resolved** |
| `loose-json-consolidation` | — | — | not recovered | — | — | — | 1 owner, 8 importers; no brace-slice elsewhere (LIN-3114) | **resolved** |
| `ai-mock-predicate-consolidation` | — | — | not recovered | — | — | — | `shouldMockAi` 1 definition, 8 importers (LIN-3459) | **resolved** |
| `batch-guard-residue` | informational | — | not recovered | — | — | — | 3 batch-1 source-scan guards (lin-2389, lin-3452, loose-json); batch 2 added none | **new row** (gauge validity) |


*Measured at `LinearViewer` `15990905` / `simple-dispatcher` `3dc08b5`. Next run: re-ground every row against HEAD, not against this prose. Keep both the old command and the shape-based count for `routes-error-envelope-fragmentation` (add the `keepalive.send` count) and for `provider-resolution-incantation`. Keep the Tarjan walk (`lib-import-cycles` is now 0; a single new SCC would be news). Watch items: LIN-3464/3465 in batch 3; whether `credential-decision-multiplicity` gets a migration plan (LIN-2150); whether LIN-3451 is unparked.*
