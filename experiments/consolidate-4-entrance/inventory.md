# 4a inventory: unit tests that read the dispatch entrance as source text (at d349e78c)

**Entrance set E** = `routes/dispatch.js` (1,963 lines, 26 route registrations), `routes/proxy-dispatch.js` (1,773 lines, 6; it holds `POST /api/proxy/recommend-and-dispatch` at :766), `routes/proxy-kickoff.js` (569 lines, 4), and `lib/dispatch-entrance.js` (45 lines). The three routers are the rung 5c files (LIN-3592, PR #1906, `d2d7d818`; the last commit to touch any of the four). `lib/dispatch-entrance.js:10-12` says each entrance keeps "its own reads, enqueue calls, credential mints, gates and replies, because the source-text censuses pin them by the route they sit in".

## How this list was made (reproducible, nothing written to the repo)

1. **Trace.** `git archive d349e78c` extracted into the work folder, `node_modules` symlinked. Then the whole unit suite (`tests/unit/*.test.js`, 17,256 tests) ran with a preload (`trace/preload.mjs`). The preload logs every `readFileSync`/`readFile`/`readdir` of an E file made from test code (module loading excluded), plus `git grep`/`rg` execs, and blocks non-loopback sockets. Result: **35 test files read E as text** (`trace/readers2.txt`). The only failures were the 6 `task-page-links` tests, which need a git checkout; the extracted tree has none. The first trace missed `run-limit-gating`, whose path is `routes//dispatch.js`. Paths are now normalised.
2. **Move probe.** This tests "would it block one shared authority?". It serves test-side readers a consolidated version of E (`probe/build-probe.mjs`, `probe/probe-preload.mjs`); imports still load the real code. In that version each router keeps only:
   * its imports;
   * its module-scope `rateLimit` declarations;
   * its factory signature;
   * every registration line with its middleware chain, the handler replaced by a one-line forward.

   Every other line moves into `lib/dispatch-entrance.js` (`router.<verb>(` becomes `handlers.<verb>(`). A variant also gives the authority the routers' imports (`probe/build-probe-imports.mjs`) and fails on exactly the same tests. Result: **37 tests in 11 files fail when the code moves**, and nothing else does (`probe/newly-failing.txt`). The mutation witnesses of a failing scanner pass vacuously under the probe, so they are classed with their scanner, not by the probe.
3. **Assumption behind every C below:** 4b keeps, in the three route files:
   * the registrations and their middleware chains;
   * the factory signatures and dependency lists;
   * the module-scope limiter declarations.

   If 4b moves any of these, the rows marked "registration" turn into blockers.

## Counts

| Class | Test cases | Files |
|---|---|---|
| **A**: convert to a behaviour test | **26** | 9 |
| **B**: keep, loosen to "holds wherever the code lives" (E as one unit) | **20** | 8 |
| **C**: keep as is | **17** | 9, plus 17 whole-tree scan files |
| Not a pin: `import-graph.test.js` | 0 (fixtures only; it reads no tree file) | 1 |

That is 63 test-level pins in 18 files that key on E (5c's 17 plus `lin-2533-agent-status-extraction`), plus 17 files of whole-tree scans that pass the probe: 35 files in all. The 5c record's "17 source-text tests plus 6 whole-tree scans" (`experiments/rebuild-rung5c/arm/score.md` §3) matches the 17 files. It lists `import-graph` as a scan, but that file reads no tree file. It misses 13 whole-tree readers: connection-access-guard, docs-architecture-anchor-resolver, email-import-boundary, lin-3124-pr1/pr2/selector-body-hashes, lin-3125 ×4, lin-3136-copy-surface-census, lin-688-undici, secret-scan.

**B rule (applies to every B row).** A loosened census treats E as one unit, so a call may move between the four files without failing. Inside E it does not fix the **number** of calls, because a fixed count would re-pin 5c's structure (5 `createDispatchItem` calls, 3 follow-up arms…). It asserts only that E has at least one call of each kind. Every E call must still meet the location-free shape checks:
* `proxyTokenStore` as a direct key;
* inline, spread-free `fields`;
* follow-ups mint only through `provisionResumeCredential`;
* no `mintGrantBootstrap(`, `grantDeclaration`, `grantRefusal` or `.addItem(`.

Outside E nothing loosens. **The "a new unaudited site inside E" detection that the counts gave moves to route sweeps** (N1–N3 below), which enumerate routes from `router.stack` (express 4.22.1), not from a hand-written list.

**One sink, two lanes.** After 4b one authority call can serve the session lane and the proxy lane. Examples: `createDispatchItem` is owner-gated for sessions but token-scoped for proxies; `listItems` is redacted for sessions but a projection for proxies. Per-file verdict tables (lin-3383, lin-3384) cannot express that, so per-lane verdicts must live in behaviour tests. That is why every security census below is B *plus* an A sweep, never B alone.

**Order (security pins, no exceptions).**
1. Each replacement (behaviour test or sweep) lands while its old pin is unchanged and green.
2. It is then shown failing with the guard removed, in a scratch copy outside the repository.
3. Only in a later commit is the old pin loosened, re-targeted or deleted.

A count inside E becomes "≥1" only after the sweep replacing it has been shown failing on a planted unlisted route. If a replacement can't be shown failing, the old pin stays as it is.

**Mixed pins.** Some tests pin E and non-E sites together: fingerprint :117 and :214, lin-3130 :145, run-limit-gating :234, lin-3136-enqueue-census :59. Only the E part changes; the non-E assertions stay byte for byte.

**Count-drift witnesses that plant inside E** (lin-3384 :196, lin-3134 :740) are re-targeted to two plants: an unlisted route in E, which must fail a sweep, and a new reader or sink kind in E, which must fail the B census. lin-3383 :407 and :494 plant outside E and stay unchanged.

**One doc goes stale.** `docs/architecture/dispatch-and-proxy.md:30-31` says the lin-3383 census "fails on any unlisted sink". The ticket allows updating exactly those lines: the census then fails on an unlisted sink kind, and N3 catches an unlisted route.

## New behaviour tests 4a adds (referenced as N1–N7)

| # | Test | Guards | Replaces |
|---|---|---|---|
| N1 | **Redaction canary sweep.** Covers every E route that reads a row, enumerated from the three routers' `router.stack`. The canary is built at runtime (HB prefix, 43 characters) and is never written as a token-shaped literal: the `harbour-bootstrap-token` rule (`lib/secret-scan.js:233-236`) is part of `secret-scan`, which `ci-success` needs (`.github/workflows/test.yml:139`). It is stored as each row's `bootstrapToken` and embedded in the prompt as `Authorization: Bearer <canary>`, which is what `maskBootstrapTokens` masks. Every read is driven as a non-owner session and as another account's proxy token. `bootstrapToken` must be null or absent on every session read, owner included (`lib/dispatch-session-redaction.js:56`). The canary must be absent from every response except `GET /api/dispatch/poll` and `POST /api/dispatch/take/:itemId`, which must carry it. Explicit exceptions: the owner's own prompt is unmasked today (`lib/dispatch-session-redaction.js:63-65`), and so is `…/:id/prompt` for the dispatcher's own token (`lin-3384-bootstrap-token-redaction.test.js:158`, `:266`). A route the sweep has no row for fails (closed set). The sweep passes on today's code; it is shown failing with the mask removed. | LIN-3384 | lin-3384 :166 per-site verdicts, :223 |
| N2 | **Proxy dispatch-grant sweep.** Every POST/PATCH/DELETE layer of the proxy composer (`buildApp`, `tests/unit/lib/proxy-fake-deps.js`). Each is called with a `readWrite` token lacking `dispatch`, and with a `read` token, using an enqueue-shaped body. Nested routers are walked through `layer.handle.stack` (the composer mounts groups with `router.use`, `routes/proxy.js:1275-1609`). Only routes are listed from the stack; every request goes over HTTP (LIN-2505), and the enumerated count is asserted. Assert `addItem`/`expandCascadeAborts` are never called; the three enqueue paths answer 403 `DISPATCH_GRANT_REQUIRED` to the `readWrite` token. | LIN-3136 C1 | lin-3136-enqueue-census :59, :63 |
| N3 | **Session runner-owner sweep.** Every layer of `createDispatchRoutes` from `routes/dispatch.js` (26 routes, asserted), a non-owner session, a runner target. No runner-state sink is called (`addItem`, `expandCascadeAborts`, `setWorkspaceHalt`, `clearWorkspaceHalt`, `removeItem`, `trimSessionBudget`, `revokeToken`) except where the sweep's own table (one row per route, with a reason) marks it member-reachable. Verdicts: owner-gated / member-reachable (dash and local rows, `lin-3398-session-runner-gates.test.js:146-152`) / dispatch-token / feedback-token / read-only. An unlisted route fails. | LIN-3383/3398/3408 | lin-3383 :333 gate-before-sink |
| N4 | **Projection key sets.** `GET /api/proxy/dispatch` and `GET /api/proxy/dispatch/:id`, with a row carrying every stored field plus canary keys (`bootstrapToken`, `prompt`, `grantDeclaration`, `grantRefusal`, an unknown key). The list item's keys must equal the 15-key set. `formatDispatchWatch` spreads `closedProjection(item.bookkeeping)` (`routes/proxy-dispatch.js:243`) and adds `feedback` conditionally, so the watch pins the exact key set for one fixed queued fixture row as a literal. It must carry `sessionId` (the value, or `null`) and none of the canaries. | LIN-1870-F4, LIN-2975, LIN-2885, LIN-3134 S0 | passage :95, :123; default-path :556 |
| N5 | **Dispatch-token mint chain.** Non-owner → 403 `GRANT_OWNER_ONLY`, `dispatchTokenStore.createToken` never called. Unknown workspace → owner seam and `createToken` never called. With `NODE_ENV=production` for the request (the limiter's `skip` is read per request, `routes/dispatch.js:120`), the 6th POST in the window → 429, and neither `workspaceFromUrl` nor the owner seam runs. `tokenCreationLimiter` is module-scope (`:113`), so this case runs in its own file, from fresh process state, with exactly five prior POSTs; `NODE_ENV` is restored in a `finally`. | LIN-3137 | lin-3137 :130 |
| N6 | **Session threading.** `POST /workspace/:urlKey/api/dispatch` with `composedRunMarker` + `issueIdentifier`. The injected `getWorkspaceAccessToken` spy is called with `(urlKey, <that request's session>)`; the factory's guard calls it at `lib/dispatch-factory.js:449`. | LIN-3124 D16 | lin-3124-pr3 :100 |
| N7 | **No-credential guard.** Kickoff and both recommend-and-dispatch arms, with `resolveProviderAccess` returning `{ token: null, reason: 'not_connected' }`. Expect 503 via `workspaceUnavailable`; `denyIfUnsupported`, `resolvePromptIssueContext`, `getWorkspaceOpenRouterKey` and `addItem` are never called. No existing test covers this for these two entrances (checked: proxy-workspace-envelope covers `/issues` and `/stack` only). | LIN-1980 | fingerprint :214 |

Existing behaviour tests that already carry an A property: 4a shows each one failing under the mutation, cites it, and adds no duplicate.

| File | Covers |
|---|---|
| `lin-3383-owner-only-entries.test.js:77-140` | `POST …/dispatch`: a non-owner gets 403 `RUNNER_OWNER_ONLY` for fresh, web, follow-up, abort and cascade, and `addItem`/`expandCascadeAborts` are never called |
| `lin-3398-session-runner-gates.test.js:95-195` | halt POST/DELETE, item delete, trim, dispatch-token revoke |
| `lin-3134-followup-sites.test.js:340-363, 487-590` | the F2(4) and attach-arm matrix for branches B1–B4 and A1–A4, which are all four E follow-up arms |
| `lin-3134-wake-declared.test.js:378` | the dispatch.js feedback builder |
| `lin-3135-broker-refire-declared.test.js:306-620` | the broker, sections 1–10 |
| `lin-3136-m1-kickoff-declared.test.js`, `lin-3136-m2-session-declared.test.js` | the declared launches and the grant-less leaves |
| `lin-3136-dispatch-gate.test.js:76-160` | criteria 1–3 and 5 |
| `lin-3384-bootstrap-token-redaction.test.js:150-290` | session list, history and trim; proxy prompt; runner paths |
| `proxy-dispatch-defaults.test.js:525-600` | the run limit on the proxy lanes |
| `run-limit-gating.test.js:144-200` | the run limit on the session lane |

## The table

Columns:
* **Blocks?** "yes" means it failed the move probe; "reg." means it depends on registration lines staying in the route files.
* **Shown failing by:** the mutation to apply in a scratch copy, outside the repo, and the test that must then fail.

### lin-3384-redaction-census.test.js: LIN-3384 AC3 (LIN-2954 S1.5), LIN-3398 rows

| Test | Pins in E | Guards | Blocks? | Class → action | Shown failing by |
|---|---|---|---|---|---|
| :166 the live tree matches the table | 13 rows keyed `file :: nearest anchor`, with exact call counts (`TABLE` :105-145). Examples: `dispatch.js :: /workspace/:urlKey/api/dispatch/:sessionId/trim` 2 (:1393/:1395), `:: host` 1 (:462, under `async function host(` :432), `:: refuse` 1 (under `const refuse = (` :1762); `proxy-dispatch.js :: /api/proxy/dispatch` 3 (:1429, :1430, :1486); `proxy-kickoff.js :: parentRun` 1 (:279-280). Redacted bodies must call `redactSessionItem(s)(`; runner bodies must not mention `redactSession`. | No store read hands a live bootstrap token to a session or proxy reader; runners keep it (LIN-3384) | yes | **B + N1.** Non-E rows unchanged. E rows become one unit: E holds ≥1 of each reader (`listItems`, `listHistory`, `getItemStatus`, `trimSessionBudget`, `pollAvailable`, `takeItem`) and no reader outside the set. The redacted/runner/projection verdicts move to N1. | Replace `redactSessionItems(result.items, …)` at `dispatch.js:1088` with `result.items` → N1 (history) fails. Add `redactSessionItem` to the take reply at :1876 → N1 (take must hold the canary) fails. Add `...i,` to the list map at `proxy-dispatch.js:1524` → N1 fails. |
| :175 verdicts are from the closed set and all four redacted routes are present | `filter(R).length === 4`: 3 dispatch.js rows + `proxy-dispatch.js :: …/:id/prompt` | The redacted set never shrinks silently | coupled to :166 | **B.** Count R rows outside E plus the N1 redacted routes. | Drop a redacted route from N1's table → the closed-set check fails |
| :196 M4b an extra call inside an already-classified handler | exact text `const items = await dispatchQueueStore.listItems(workspace.urlKey);` (`dispatch.js:1009`) | Count drift is detected | yes | **B.** Plant an unknown reader name, or a reader outside the set, in the E text | The planted copy fails the E-unit check |
| :223 M3 removing the redactor from a redacted handler | exact text at `dispatch.js:1088` | History is redacted | yes | **A** → N1 history case, plus `lin-3384-bootstrap-token-redaction :164` | The same edit → both fail |
| :186 M4 a new session route returning getItemStatus unredacted | plants before `  router.get('/api/dispatch/poll'` (`dispatch.js:1634`) | Unlisted sites are detected | reg. | **C.** Still valid after B (an unknown site in E fails). | n/a |
| :170 no file outside the store calls `_formatItem(` | whole tree, including E | Formatter confined to the store | no | **C** | n/a |

### lin-3383-runner-enqueue-census.test.js: LIN-3383 (LIN-2954 S1.4), LIN-3398, LIN-3408, LIN-3409

| Test | Pins in E | Guards | Blocks? | Class → action | Shown failing by |
|---|---|---|---|---|---|
| :333 the live tree: every sink is in the table, every gated sink is behind its gate | `MEMBERS` :87-153. dispatch.js: `createDispatchItem` 1 (:696) and `expandCascadeAborts` 1 (:628), each after `resolveRunnerOwnerRefusal(` (:510) inside the `router.post('/workspace/:urlKey/api/dispatch'` text (:483); `setWorkspaceHalt` (:1300), `clearWorkspaceHalt` (:1320), `removeItem` (:1347), `trimSessionBudget` (:1395), `revokeToken` (:1505), each after `refuseNonOwner(` (:1290/:1313/:1345/:1393/:1502) in its own registration text; `addFeedback` (:1936) token-scoped. proxy-dispatch: 3 `createDispatchItem` (:575/:963/:1227) and 1 `expandCascadeAborts` (:501), token-scoped. kickoff: 1 (:345). | Every session-reachable runner-state write is owner-gated (cli/web) or token-scoped | yes | **B + N3.** Non-E members unchanged. E becomes one member per sink with ≥1 hits and verdict "entrance (behaviour-gated)". Gate-before-sink is proven by N3 plus the existing owner-only-entries and lin-3398 tests. Token-scoped: N2. | Gate negated at :510 (`await (async () => null)(`) → owner-only-entries non-owner rows fail (201, not 403). Each `refuseNonOwner(` → `(async () => false)(` → lin-3398 non-owner tests fail. An unlisted runner-state route added to a scratch copy of the router → N3 fails. |
| :355 removing the Dispatch route gate fails the census | exact text `const enqueueRefusal = await resolveRunnerOwnerRefusal(` (`dispatch.js:510`) | Owner-only runner enqueue | yes | **A** → `lin-3383-owner-only-entries :87` (5 request shapes) | The same edit → 5 rows fail |
| :360 moving the cascade expansion above the gate | comment text `      // LIN-3383 owner-only runner enqueue.` (:505) | The cascade write sits after the gate | yes | **A** → owner-only-entries "a cascade abort" row (asserts `expandCascadeAborts` count 0) | Move :628's call above :510 → it fails |
| :437 removing a session-route gate (halt POST/DELETE, delete, trim, revoke) | `await refuseNonOwner(` inside each registration's text | LIN-3408 owner-only lanes | yes | **A** → `lin-3398-session-runner-gates :96, :123, :136, :167, :188` | Same edit per route → the matching test fails |
| :455 moving a session store write above its gate | exact text `      if (await refuseNonOwner(req, res, row?.target)) return;\n` (:1345) | Delete writes nothing for a non-owner | yes | **A** → lin-3398 :136 "nothing removed" | Move :1347 above :1345 → it fails |
| :499 the new verdicts stay bounded to their one file | uses `routes/dispatch.js` only as a planted placeholder; ends `deepEqual(scanSinks(TREE), [])` | Verdict vocabulary | coupled to :333 | **C** (green again once :333 is B) | n/a |

### lin-3134-declared-mint-census.test.js: LIN-3138 (LIN-3134 T2-i), LIN-3135 R2, LIN-3136 T3

| Test | Pins in E | Guards | Blocks? | Class → action | Shown failing by |
|---|---|---|---|---|---|
| :105 F3 the production writers are exactly the three declared launch literals | `declaredGrants: ['dispatch'],` exactly once in `proxy-kickoff.js` (:378, M1) and `dispatch.js` (:832, M2) (+ M4 in workspace-api) | Only M1/M2/M4 declare a grant; declared minting stays inert elsewhere | yes | **B.** E holds exactly 2 such literals (M1+M2): this is the one count kept, because it is a writer allow-list, not a structure. Behaviour backing: lin-3136-m1/m2 and the m1 "leaf launches stay grant-less" tests. | Delete :832 → m2 "owner's autopilot dispatch declares" fails. Add the literal at `proxy-dispatch.js:635` → m1 "a plain POST /dispatch launch … declares nothing" fails. |
| :110, :115, :131 F3 mutations | plants keyed to `routes/proxy-dispatch.js`/`routes/dispatch.js`; exact-text removal in kickoff | Writer set closed | yes (message prefix) | **B.** Re-key messages to E | Planted copies still fail |
| :530 10 calls; the 6 follow-up-carrying ones are exactly the Class F set; every `fields` is inline, spread-free | `FOLLOWUP_SITES` (:327-334) keyed `file \| route \| kind text`, `NON_FOLLOWUP_CALLS`; total `=== 10` | Follow-up enqueues are a closed set; `followUpTo` can't arrive via a spread | yes | **B.** E as a unit: ≥1 call per kind text (`kind` / `kind: effectiveKind` / `kind: 'autopilot'`); inline/spread-free for every call; non-E sites unchanged. :537 and :542 stay as witnesses. | A spread planted into an E call → fails |
| :549 every follow-up call is clean (a–e) | per call: first `provisionResumeCredential(` inside `(followUpTo ? {` (`dispatch.js:767-770`) or `if (isFollowUp) {` (`proxy-dispatch.js:610/982/1256`); no `attachProxyContext(`/`declaredGrants` before; `attach:` passed (`dispatch.js:783`) | A follow-up never mints a fresh launch credential (that would bypass the recorded owner and grant) | yes | **A** → lin-3134-followup-sites F2(4) "declared: grant-bearing resume from the recorded owner" and "leaf: today's exact plain arguments" for B1–B4/A1–A4. The (a–e) scanner stays as a B check over every E call carrying `followUpTo`. | Each witness's edit (below) → the matching F2(4) row fails |
| :558, :564, :569, :575, :580, :586 C2(iii) mutations 1–5 | exact strings, e.g. `"          if (isFollowUp) {\n            return provisionResumeCredential({"` (10/12 spaces, `proxy-dispatch.js:610-611`), `                  attach: wantProxyContext` (18 spaces, `dispatch.js:783`) | same | yes | **A.** Each mutation re-run against followup-sites. Make the B scanner's anchors whitespace-tolerant. | Attach-first in finalizePrompt → "declared" rows fail. Helper outside the predicate → "leaf" rows fail (an extra mint). `attach:` dropped → the attach-arm rows (:555, :566) fail. |
| :595 C2(iv) wake-credential calls the helper; …both builders remain | `buildWakeCredentialProvisioner(` in `routes/dispatch.js` (:1913) and proxy-runner | The feedback wake mints through the helper (Class F 11th member) | yes | **A** → `lin-3134-wake-declared :378` (drives `/api/dispatch/feedback/:id`) | Replace :1913's builder with `() => null` → :378 fails |
| :609 C2(v)/C3 no unlisted, stale or drifted entry; :613 C3 class set | `MINT_SITE_TABLE` (:460-485) keyed `file \| construct [kind] \| arm \| fn` (`KICKOFF`, `PD_*`, `SESSION`, broker); class counts `followup-helper 6/10, refire 1, M1 1, M2 1, M3 3` | Every credential-mint call site is classified | yes | **B.** E keyed by `[kind] \| arm \| fn` with ≥1; classes kept as a set, not as counts, inside E | A new mint fn call planted in E text → "unlisted" |
| :635 mutation 1 (v) | exact gate text | same | yes | **B** (re-target to E) | as above |
| :726, :730, :735, :740, :746 R2 broker witness and mutations | `router.post('/api/dispatch/broker-token'` (:1708) text: one inline `proxyTokenStore.createToken(` (:1842) with keys `kind, scope, label, ttl, createdBy`; one `provisionResumeCredential(` (:1808) with `dispatchStore`, `followUpTo: itemId`, `urlKey`, `label: 'refire-broker'` and no grant/attach key | The broker mints grant-less unless a record exists, and then only through the helper, which re-reads the record (LIN-3135; ruling lin3135-f3c4-census-conflict = B) | yes | **A** → lin-3135-broker-refire-declared §1 (byte-identical grant-less mint), §2/§2b (helper re-reads), §4/§6 (no fallback) | Add `grants: ['dispatch']` at :1842 → §1 fails. Pass `grantDeclaration: lookup.record` at :1808 → §2b fails. Second helper call → §2 spy count fails. |
| :751 a direct `mintGrantBootstrap(` in routes/dispatch.js | absence in dispatch.js | No grant mint bypasses the helper | yes | **B.** Absence over all of E | Plant in the authority text → fails |
| :793 a fifth, direct `.addItem(` writer | asserts `censusC2`/`censusClassification` clean on the live tree | Writer set closed | coupled | **B** (passes once :530/:609 are B) | as written |
| :141 C4 grantDeclaration/grantRefusal only in the five mechanism modules; :790 exactly four `.addItem(` writers; :829 no aliased addItem | whole tree, including E | Declared-mint tokens confined; E never enqueues around the factory | no | **C.** The authority must not name these either. | n/a |

### Other pin files

| Test | Pins in E | Guards | Blocks? | Class → action | Shown failing by |
|---|---|---|---|---|---|
| **lin-3130-create-dispatch-item-proxy-token-store-pin** :145 all call sites pass `proxyTokenStore` at depth 1 | every `createDispatchItem(` in routes+lib has a direct `proxyTokenStore` key; total `=== 10` | Consumer recency folds the runner's take-grant token (LIN-3130 S2a L2) | no (tolerant), but the `=== 10` blocks merging calls | **B (E part only).** The 5 non-E calls stay exactly as pinned; E holds ≥1; the per-call key check is unchanged | Drop the key from one E call → fails |
| **run-limit-gating** :234 every gated lane file passes runGate … and relays `err.runLimit` | the `routes/` files with `createDispatchItem(` + `runGate` are exactly `dispatch.js, proxy-dispatch.js, proxy-kickoff.js, workspace-api.js`, each with `mapDispatchRefusal(`/`relayDispatchRefusal(`/`err.runLimit` | Every run-gated lane relays the run limit as 429/503, not 500 (LIN-3238) | yes | **B (E part only).** E counts as one lane holder (routes ∪ authority); `workspace-api.js` stays pinned as today. Behaviour backing: run-limit-gating :145/:163 (session) and proxy-dispatch-defaults :525-600 (proxy lanes, kickoff, both r&d arms). | Remove the `mapDispatchRefusal` branch at `dispatch.js:953` → :145 fails (500, not 429) |
| **lin-3136-enqueue-census** :59 the live tree: 4 sinks, all under the three gated POST handlers | each `createDispatchItem(` in `routes/proxy-*.js` sits under a two-space `router.post(` line holding `proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'),` (`proxy-dispatch.js:411/:766`, `proxy-kickoff.js:206`); counts {3, 1} | No proxy-token route enqueues without the dispatch grant (LIN-3136 C1) | yes | **A** → N2 (the sweep replaces C1's exhaustiveness for E). C1 is kept for non-E `routes/proxy-*.js`. | Delete `requireGrant('dispatch'),` at `proxy-kickoff.js:206` → N2 fails (201, `addItem` called) |
| lin-3136-enqueue-census :63 mutation: gate removed from a mount | exact text in kickoff | same | yes | **A** → N2 | as above |
| **lin-3136-dispatch-gate** :168 (×3 mounts) exactly one `router.post`, with the grant after the scope; :180 the reads carry no grant gate | registration lines `proxy-dispatch.js:411, :766`, `proxy-kickoff.js:206`; GET lines :1393, :1597, :1704 | The grant middleware and order on the mount; reads open to `read` tokens (LIN-3136 12(a), 5) | reg. | **C.** Registrations stay in the route files; criteria 1–3, 5 and 12(b)/(c) in the same file are behavioural. | n/a |
| **proxy-tokens-private-mint-source-pin** :127 … dispatch on exactly the three enqueue mounts | `requireGrant('dispatch')` text in `routes/`: proxy-dispatch ×2, kickoff ×1 | Grant mounts are a closed set (LIN-3129/3131/3136) | reg. | **C** | n/a |
| **proxy-credential-fingerprint-stamping** :103 every routes/proxy*.js `resolveProviderAccess` call passes `req` third | scans `routes/proxy*.js` only | The chokepoint can stamp `resolvedCredentialFingerprint`, so `markSuspect` fires (LIN-1980) | no, but a moved call would escape the scan | **B.** Add `lib/dispatch-entrance.js` to the scanned set | Plant `resolveProviderAccess(a, b)` in the authority text → fails |
| fingerprint :117 each of the 9 direct sites destructures `provider` | partition compute 7 + kickoff 1 (`proxy-kickoff.js:242`) + proxy-dispatch 1 (`proxy-dispatch.js:862`) = 9 | Provider attribution (LIN-2044); no stray direct site | yes | **B (E part only).** Compute stays exactly 7 and `routes/proxy.js` 0, byte for byte; E holds ≥1; every direct site in proxy files ∪ authority uses the destructure | Plant a non-destructuring direct call in E → fails |
| fingerprint :214 each direct site checks `!accessToken` immediately after the resolve | text window after :242 → `if (!accessToken)` (:246); after :862 → (:866) | Nothing runs on a request whose provider resolution failed (LIN-1980) | yes | **A (E part only)** → N7. The `assertOrderingGuard` calls for `routes/proxy-compute.js` (7) and `routes/proxy.js` (0) stay unchanged. | Delete the `if (!accessToken) {…}` block at kickoff :246 (or :866) → N7 fails (no 503; spies called) |
| fingerprint :221 endpoint tags present in their own file | `'/api/proxy/autopilot/kickoff'` in kickoff, `'/api/proxy/recommend-and-dispatch'` in proxy-dispatch | Plan coverage sanity | reg. | **C** (the literals are in the registration lines) | n/a |
| **proxy-endpoint-inventory-witness** :608 the ROWS table covers exactly the URL forms derived from proxy route sources | `router.<verb>(` occurrences in `routes/proxy-*.js`, comments included (kickoff 4, proxy-dispatch 6) | Every registration has a behavioural row (LIN-679 PR-0, LIN-3218) | reg. | **C.** Note for 4b: a `router.` mention in a comment changes the count. | n/a |
| **proxy-di-witness** :146 every factory's mount is complete; :222 exported = mounted factories | `export function createDispatchRoutes({`/`createKickoffRoutes({` signatures vs the mounts in `routes/proxy.js` | A dropped dependency can't become a runtime 500 (LIN-2543) | reg. | **C** | n/a |
| **passage-runner-contract-drift** :95 /dispatch list item is an exact field set that includes sessionId and maxTasks | slice `const items = filtered.slice(0, limit).map(i => ({` … `}));` (`proxy-dispatch.js:1524`), 15 keys | The list is an allow-list, so no `bootstrapToken` leak; sessionId and maxTasks are carried (LIN-1870-F4, LIN-2975, LIN-2885) | yes | **A** → N4 (list) | Add `...i,` (or delete `sessionId:`) in the :1524 literal → N4 fails |
| passage :123 formatDispatchWatch includes sessionId, scoped to its own function body | slice from `function formatDispatchWatch(item, meta = null, wakeShadow = null, liveConsumerLastSeenAt = null) {` (:197) to `function dispatchWatchChanged(` | The watch carries sessionId (LIN-1870-F4) | yes | **A** → N4 (watch) | Delete `sessionId: item.sessionId \|\| null` in :197's body → N4 fails |
| **lin-3134-default-path-characterization** :556 formatDispatchWatch and the list map contain no declared field or row spread | the same two slices; no `grantDeclaration`/`grantRefusal`/`...item`/`...i` | Projections never expose declared row fields (LIN-3134 S0) | yes | **A** → N4, which strengthens the file's own :413/:420 behaviour tests to an exact key set. **Note:** the file header (:1-33) says S0 "stays unedited through the rest of T2-i and T2-ii" and is "Additive only". Both phases (LIN-3138, LIN-3139) have merged. The ticket allows this one replacement and asks for one header line naming it. | Add `...item,` to formatDispatchWatch → N4 fails |
| **lin-3137-dispatch-token-preservation** :130 the POST mint chain is limiter → workspaceFromUrl → gate → createToken | registration regex at `dispatch.js:1425`; index order in the slice to :1478 of `tokenCreationLimiter`, `workspaceFromUrl`, `resolveOwnerMintRefusal` (:1436), `dispatchTokenStore.createToken` (:1461) | The dispatch-token mint is owner-only, and auth runs before the gate (LIN-3137 J5) | yes | **A** → N5. The file's :71 checks a non-owner mint's 403 but not that `createToken` is uncalled. | Move :1461 above :1436, or negate the refusal → N5 non-owner fails. Swap `tokenCreationLimiter, workspaceFromUrl` at :1425 → N5 limiter case fails (`workspaceFromUrl` reached). |
| **lin-3124-pr3-checkpoint-c2** :100 routes/dispatch.js threads the session into the done-guard | regex `getWorkspaceAccessToken: (k) => getWorkspaceAccessToken(k, req.session)` (:742) | The session decides which credential reads the anchor issue (D16 owner-blind lane) | yes | **A** → N6 | Drop `, req.session` at :742 → N6 fails (spy gets `undefined`) |
| **proxy-scopes-source-pin** :59 [routes/dispatch.js row] imports from `../lib/proxy-scopes.js` and uses the constant | `import { READ_WRITE } from '../lib/proxy-scopes.js'` (:46), `scope: READ_WRITE` (:1844) | One scope vocabulary, never a re-spelt literal (LIN-3129 S1) | yes | **B.** Not expressible as behaviour (`'readWrite'` and `READ_WRITE` are the same value). Rule: whichever E file holds the broker `proxyTokenStore.createToken(` imports `READ_WRITE` from lib/proxy-scopes and uses `scope: READ_WRITE`; no E file holds a `'readWrite'` literal (none does today). Behaviour backing: lin-3135 §1 asserts the minted scope. | Replace with `scope: 'readWrite'` → the B row fails (behaviour still passes, which is why it stays B) |
| **lin-2534-tokens-admin-extraction** :112 every `rateLimit(` in the scoped route files is a declaration | `routes/dispatch.js` in the file list; `= rateLimit(` at :87, :102, :113 | No per-request (bare) limiter (LIN-2534) | no (tolerant); a moved limiter would escape | **B.** Add `lib/dispatch-entrance.js` to the list | Plant a bare `rateLimit(` in the authority text → fails |
| **lin-2533-agent-status-extraction** :97, :101 agentStatusStore calls only in proxy-agent-status.js | absence in `routes/proxy-*.js`, including E | Agent-status store confined (LIN-2533) | no | **C** | n/a |

### Whole-tree scans: all C (they read E, key nothing to its location, and pass the move probe)

* connection-access-guard (with `tests/fixtures/connection-access-guards.js`)
* docs-architecture-anchor-resolver
* email-import-boundary
* interactive-openrouter-chain-byte-identity
* lin-3124-pr1-count-pins
* lin-3124-pr2-credential-census
* lin-3124-selector-body-hashes
* lin-3125-held-entry
* lin-3125-persist-held
* lin-3125-phase0-complete-installation
* lin-3125-phase1-held-entry
* lin-3136-copy-surface-census (reads `lib/` only)
* lin-3382-urlkey-class-guard
* lin-688-undici-not-a-dependency
* secret-scan (reads through `lib/secret-scan.js`)
* urlkey-holders
* task-page-links (`git grep` over `routes`; no E file matches its patterns)

`import-graph.test.js` (listed among 5c's scans) builds graphs from inline fixtures only, so it is not a pin.

## Security-relevant pins and how each ends up guarded

| Property | Old pin | After 4a | At least as strong because |
|---|---|---|---|
| Runner-state writes owner-only (LIN-3383/3398/3408/3409) | lin-3383 :333, :355, :360, :437, :455 | B census over E + N3 sweep + owner-only-entries + lin-3398 | Behaviour proves every known route refuses and writes nothing; the sweep fails on any new unclassified route, which the old census did by count |
| Proxy enqueue needs `dispatch` (LIN-3136) | lin-3136-enqueue :59, :63; dispatch-gate 12(a); private-mint :127 | N2 + dispatch-gate criteria 1–3; 12(a)/:127 kept (C) | N2 covers every composer route, not only lines under `router.post` |
| Declared mints only at M1/M2 (+M4) (LIN-3136/3134) | lin-3134 :105 | B (the exact writer count in E is kept) + m1/m2 tests | The count stays; behaviour adds the semantic check |
| Follow-ups mint only through the resume helper (LIN-3134 Class F) | lin-3134 :549-:586, :609-:635 | followup-sites matrix + B scanner over E | Each witness edit is shown failing behaviourally |
| Broker re-mint bounds (LIN-3135) | lin-3134 :726-:751 | lin-3135 §1–§10 + B absence of `mintGrantBootstrap(` | as above |
| Dispatch-token mint owner-only (LIN-3137) | lin-3137 :130 | N5 | Adds `createToken` never called, and a real limiter run |
| Token never leaves a session/proxy read (LIN-3384) | lin-3384 :166, :223; passage :95/:123; default-path :556 | N1 + N4 + B census | A canary on every read route is stronger than "the handler body mentions the redactor" |
| Scope vocabulary (LIN-3129) | proxy-scopes dispatch.js row | B (import/usage wherever the broker mint lives) | unchanged strength |
| Session-scoped credential read (LIN-3124 D16) | lin-3124-pr3 :100 | N6 | Watches the call, not the text |
| No work after a failed credential resolution (LIN-1980) | fingerprint :214 | N7 + B scan of `req` third | Closes a behaviour gap (no test today) |

## Changes after the fresh-reader check (`fresh-reader.md`)

Every finding was re-checked against d349e78c before applying it.

**Applied:**
* 1, ordering;
* 2, mixed pins;
* 3, the canary built at runtime in the Bearer shape, with owner exceptions and secret-scan safety;
* 4, lin-3383 test lines :333/:355/:360/:437/:455/:499;
* 5, nested routers, HTTP only, enumerated counts;
* 7, where replacements go;
* 8, the probe described as text-only;
* 9, the doc line allowance;
* 10, the session-owner table verdicts;
* 11, `createDispatchRoutes` naming;
* 12, the limiter in its own file;
* 13, `read` tokens and `DISPATCH_GRANT_REQUIRED`;
* 14, the watch fixed-fixture key set;
* 15, header :1-33 and LIN-3138/LIN-3139;
* 16, the MINT_SITE_TABLE key and :460-485;
* 18, one hermetic run plus secret-scan;
* 19, "the only exception";
* 20, root `lib/`.

**Partly rejected:**
* **6.** lin-3383 :407 and :494 plant into `routes/collective.js` and `routes/proxy-halt.js`, outside E. Their counts stay exact, so they need no re-targeting. Only lin-3384 :196 and lin-3134 :740 are re-targeted.
* **8.** No attachment: the probe is described in the ticket instead.
* **17.** The coordinator's verbatim no-forks line is used as given, without the "Keep the operator's laptop usable" prefix and the reboot reason. The "Never pass a `repo` override" line is restored.
