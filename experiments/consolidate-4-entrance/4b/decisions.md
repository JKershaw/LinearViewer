# #4b decision map: the dispatch entrance

Grounded at LinearViewer origin/main `15191460` (LIN-3601 / PR #1912 merged). Every file:line is at that commit. `git log d2d7d818^..15191460` touches none of the three route files, `lib/dispatch-entrance.js`, `lib/dispatch-factory.js`, `routes/proxy.js` or `server.js` except `d2d7d818` itself (LIN-3592), so the rung 5c record still describes the code.

## 0. The entrances

"Three entrances" are three files and four enqueue handlers. Two of them have two arms:

| Id | Handler | Registration | Body |
|---|---|---|---|
| **S** | session dispatch | `routes/dispatch.js:483` `router.post('/workspace/:urlKey/api/dispatch', dispatchQueueLimiter, workspaceFromUrl, …)` | `:484-999` |
| **P** | proxy dispatch | `routes/proxy-dispatch.js:411` `…, proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), …` | `:412-727` |
| **R** | recommend-and-dispatch; arms **Ro** (verb override, `kind` set, `:891-1094`) and **Rl** (LLM descent, `:1096-1372`) | `routes/proxy-dispatch.js:766` (same chain as P) | `:767-1382` |
| **K** | autopilot kickoff | `routes/proxy-kickoff.js:206` (same chain as P) | `:207-544`, body checks `kickoffBodyFailure` `:116-174` |

Module-scope helpers in the route files that only the entrances use: `isFreshDispatch`, `entryRungFailure`, `stopAtFailure`, `variantFailure` (`routes/dispatch.js:150-193`); `proxyContextPolicy` (`routes/proxy-dispatch.js:141-148`), `receiptFor` (`:161-179`), and in the factory `storeMissing` (`:352-357`, also used by the GET routes), `reject400` (`:360-363`, also used by the GET routes), `relayEnqueueFailure` (`:374-390`) and `runGateFor` (`:395-400`); `rejectBody` (`routes/proxy-kickoff.js:76-79`) and `kickoffBodyFailure` (`:116-174`). Already shared: `firstFailure` and `opaqueFieldError` (`lib/dispatch-entrance.js:25-45`).

The lanes differ by design. The session lane (S) authenticates a browser session, has no audit log, and gates on the workspace owner. The proxy lane (P, R, K) authenticates a proxy token, writes an audit event (`logEvent`) on every exit, and is gated by the `dispatch` grant in middleware. A lane difference is variation (b), never a bug, unless a ticket or comment says otherwise.

**What the C pins leave in the route files** (LIN-3601 PR; checked in the tests named). First, the registration lines with their middleware chains. For the three proxy POSTs, that means a block-bodied `async (req, res) => {` forwarder on the line itself: `lin-3136-dispatch-gate.test.js:165-178` (EXPECTED `:166`, comparison `:173`) compares the text after the path with `… requireGrant('dispatch'), async (req, res) =>`, optionally followed by ` {`. The independent #4a score found that a moved recommend-and-dispatch handler passes the full suite only in that form (`dl4/score/score.md`). The registrations are held by `lin-3136-dispatch-gate`, `proxy-tokens-private-mint-source-pin`, `proxy-endpoint-inventory-witness` and `lin-3137-dispatch-token-preservation`. The other C pins cover the factory signatures (`proxy-di-witness`), the module-scope `= rateLimit(` declarations (`lin-2534-tokens-admin-extraction`, `routes/dispatch.js:87,102,113`), and the endpoint tag literals (`proxy-credential-fingerprint-stamping` :232-242). The B censuses treat `routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js` and `lib/dispatch-entrance.js` as one unit "E" (for example `lin-3383-runner-enqueue-census.test.js:148`, `lin-3134-declared-mint-census.test.js:95`, `lin-3130-…-pin.test.js:39`). Their shape rules constrain how the authority can be written; see §3.

## 1. Decisions, step by step

Legend for "Kind": **copy** = the same rule at every site, differing only in lane plumbing (audit, transport); **copy + param** = the same decision with a named per-entrance input; **lane** = made in one lane only, nothing to consolidate across entrances.

| # | Decision | Sites (origin/main) | Kind | Divergences (class, §2) |
|---|---|---|---|---|
| D1 | Queue store missing → 503 `Dispatch is not available` + audit | P `routes/proxy-dispatch.js:412` and R `:767` via `storeMissing` `:352-357`; K inline `routes/proxy-kickoff.js:207-210`. S: none | copy | S has no check (b: `server.js:2336` always passes the store) |
| D2 | Read the body | S `req.body` `routes/dispatch.js:487`; P `req.body \|\| {}` `routes/proxy-dispatch.js:415`; R `:770`; K `routes/proxy-kickoff.js:213` | copy | V1 (c) |
| D3 | Verb shape: `isAbort`; abort excludes followUpTo; prompt required unless abort; target vocabulary | S `routes/dispatch.js:493`, `:498-502`; P `routes/proxy-dispatch.js:420`, `:423-426` | copy + param | target set S `DISPATCH_TARGETS` vs P `POLLED_TARGETS` (b) |
| D4 | Abort/cascade/kind/periodical/run-field checks, in order | S `routes/dispatch.js:552-582`, `:599`; P `routes/proxy-dispatch.js:431-466`. The rules are already single authorities (`lib/dispatch-validation.js:120-168`, `lib/dispatch-fields.js:191-212`); the **ordered list** is copied | copy | S adds the abort-target poll check `:553` because its target set includes `local` (b); P's set already is the poll set (comment `:427-430`) |
| D5 | `presetId` shape, then store lookup | S `routes/dispatch.js:587-592`; K `routes/proxy-kickoff.js:161-166` | copy | keyed by `workspace.urlKey` vs `req.proxyUrlKey` (lane) |
| D6 | Opaque execution fields (model, harness, effort) and the unknown-effort warning | S, P through `validateDispatchPayload` (`lib/dispatch-validation.js:228-237`, warning `:235-237`); R `routes/proxy-dispatch.js:792-801`; K `routes/proxy-kickoff.js:142-156` | copy | vDP also covers `terminal`; R and K accept no `terminal` (V4, d) |
| D7 | Issue identifier and sessionId rules | S, P: vDP length cap only (`lib/dispatch-validation.js:179`) and `validateSessionId` last (`:277`); R required + `isValidIssueId` `routes/proxy-dispatch.js:775-776`, sessionId `:825`; K `isValidIssueId` when present `routes/proxy-kickoff.js:128`, sessionId `:137` | copy + param | V5 (d) |
| D8 | A 400 answer | P, R `reject400` `routes/proxy-dispatch.js:360-363` (audit 400 then `badRequest`); K `rejectBody` `routes/proxy-kickoff.js:76-79` (same); S `badRequest.json` `routes/dispatch.js:503`, `:619` | copy | S no audit (b) |
| D9 | Who may enqueue. Placement: S's gate runs after D3 and before every other check, store read, provider call, run gate, mint, cascade expansion or write; if S's checks move into the authority, the gate is passed in as S's lane step there, and the authority fails closed (it throws on a session-lane call without the gate; it never skips it). P/R/K's gate stays on the registration line, and the authority's enqueue is reachable only from the four POST handlers. D27/D28's closures stay injected Agent API code whose calls may move into the authority, with every status, note and keepalive frame unchanged (note: the #4a proxy-grant sweep's "reaches no sink" checks pass vacuously for R and K, whose fixtures stop at a 404 issue lookup; only the explicit 403 `DISPATCH_GRANT_REQUIRED` checks catch a dropped gate there. The replay's `r-grant` and `k-grant` mutants do reach `addItem`) | S `resolveRunnerOwnerRefusal` `routes/dispatch.js:510-516` (LIN-3383), placed between the shape checks and the rest; P, R, K `requireGrant('dispatch')` in the registration chain (LIN-3136) | lane | (b). The S gate's position is part of its first-failure contract |
| D10 | Subscription default (`?? DEFAULT_SUBSCRIPTION`) | S `routes/dispatch.js:879`; P `routes/proxy-dispatch.js:491`; R `:848`; K `routes/proxy-kickoff.js:227` | copy | none |
| D11 | Cascade expansion (`expandCascadeAborts`, 201 `{success, cascade, ...result}`) | S `routes/dispatch.js:627-633`; P `routes/proxy-dispatch.js:500-507` | copy | `dispatchedBy` source and audit (lane) |
| D12 | Persisted kind-only `issueSource` | S `routes/dispatch.js:639-641`; P `routes/proxy-dispatch.js:537-539`; R `:877-879`; K `routes/proxy-kickoff.js:238`, `:266` | copy + param | V10 (d) |
| D13 | Resolve the provider credential for the named issue | R `routes/proxy-dispatch.js:862-873` and K `routes/proxy-kickoff.js:242-250`: resolve, `!accessToken` → `workspaceUnavailable`, `denyIfUnsupported(…'fetchIssueContext'…)`, `isTestMode`; R adds `fetchRecommendationContext` `:872`. P `:524-531`: resolve only when `!isAbort && (issueIdentifier \|\| repo)`, no 503. S: `resolveIssueBinding` `routes/dispatch.js:655-657` | copy + param | P permissive (b, LIN-1948, comment `:517-523`); V12 (d); S lane source (b) |
| D14 | Fetch the issue context; "not found" or null → 404 `Issue not found` + audit | Ro `routes/proxy-dispatch.js:902-915` (through the keepalive); K `routes/proxy-kickoff.js:251-264` (plain) | copy + param | transport (b): Ro has armed a keepalive |
| D15 | Dangling-referent guard → 422 `{error, code, issueIdentifier}` | S `routes/dispatch.js:654-662` (`danglingReferentBody`, `lib/dispatch-referent-guard.js:123-129`); P `routes/proxy-dispatch.js:541-550` (inline, same body, audit note) | copy | credential source and audit (lane); R and K fetch the issue instead, which 404s (b) |
| D16 | Repo stored verbatim (`repo \|\| null`, LIN-3333) | S `routes/dispatch.js:869`; P `routes/proxy-dispatch.js:556`; Ro `:944`; Rl `:1204`; K `routes/proxy-kickoff.js:234` | copy | none |
| D17 | Proxy-context prose append policy | P `routes/proxy-dispatch.js:561` and R `:856` via `proxyContextPolicy` `:141-148`; K `appendProxyContext !== false` `routes/proxy-kickoff.js:359`; S opt-in `attachProxy === true && !isAbort` `routes/dispatch.js:537` | copy + param | K is the no-follow-up case of the same rule; S is deliberately opt-in (b, LIN-1162) |
| D18 | Free-tier credential and run gate | S `routes/dispatch.js:689-695` (session key); P `routes/proxy-dispatch.js:572-574`; Ro `:895-896`, `:962`; Rl `:1096-1100`, `:1226`; K `routes/proxy-kickoff.js:335-344`. `buildRunGate({...})` literal ×2 (S, K) plus `runGateFor` `routes/proxy-dispatch.js:395-400` | copy + param | key source (b); V40 (c); call position differs per entrance (b, V41) |
| D19 | Plan block for the file-pointer pilot (LIN-3200) | S `routes/dispatch.js:717-733`; P `routes/proxy-dispatch.js:592-599`; Ro `:976`; Rl `:1245-1250`; K none. `ctx?.issue \|\| ctx \|\| {}` → `description \|\| null` ×3 (S `:731`, P `:597`, Rl `:1248`) | copy + param | source per arm (b); K none (c, V16); V18 (d) |
| D20 | Base URL `${req.protocol}://${req.get('host')}` | S `routes/dispatch.js:684`; P `routes/proxy-dispatch.js:601`; Ro `:987`, `:1005`; Rl `:1261`, `:1279`; K `routes/proxy-kickoff.js:229` | copy | none |
| D21 | Build the item: the `createDispatchItem` call | S `routes/dispatch.js:696`; P `routes/proxy-dispatch.js:575`; Ro `:963`; Rl `:1227`; K `routes/proxy-kickoff.js:345` | copy + param | S only: `applyDefaultHarness: false` `:702` (b, LIN-1111), `composedRunMarker` + done-guard deps `:739-743` (V37, d); S, K: `dispatchPresetsStore` + `presetId`; S, P: `terminal` (V4, d) |
| D22 | Mint the credential (`finalizePrompt`) | follow-up gate → `provisionResumeCredential`: S `routes/dispatch.js:767-802`, P `routes/proxy-dispatch.js:610-631`, Ro `:982-1003`, Rl `:1256-1277`. Launch → `attachProxyContext`: S `:803-859`, P `:632-674`, Ro `:1004-1024`, Rl `:1278-1298`, K `routes/proxy-kickoff.js:358-396`. Plain: S `{ prompt }` `:860`, P `:680`, Ro `:1028`, Rl `:1302`, K `:397` | copy + param | label `kickoff-bootstrap` (K `:370`, b); declared site M1 (K `:378-381`) / M2 (S `:830-837`, chosen by `launchesOrchestrator` `:524-528`) / none (P, R: M3 deferred to LIN-3099) (b); provider display source S `getProvider(...)` `:787-788`, `:820-822` vs proxy `declaredProviderDisplayName(req)` (b); S treats an unchanged prompt as failure `:795-799`, `:852-856` (b, LIN-525); S marks `launchRefusal` `:842` (b); follow-up mint rule S `:782` vs proxy `:621`, `:993`, `:1267` (b; V19 c) |
| D23 | The row's fields | S `routes/dispatch.js:861-893`; P `routes/proxy-dispatch.js:682-710`; Ro `:1030-1066`; Rl `:1304-1344`; K `routes/proxy-kickoff.js:399-434`. Normalisers repeated ×5: `target \|\| 'cli'`, `dispatchedBy`, `followUpTo \|\| null`, `force === true`, `sessionId \|\| null`, `queueIfBusy === true`, `waitForFollowUps === true`, `maxTasks ?? null`, `issueSource ?? null` | copy + param | promptName source (b); K `waitForFollowUps: true` `:411` (b, LIN-826); periodicalId precedence Ro `:925-927` = Rl `:1190-1192` (copy); variant S `:887` / K `:430` (b); stopAt S only (b); Rl stamps the terminal identifier `:1307` (b, LIN-327); V33 (c) |
| D24 | After the enqueue | S task-mode record `routes/dispatch.js:900-919`; S Harbour OS spawn `:923` | lane | S only (b) |
| D25 | The 201 receipt | S `routes/dispatch.js:930-945`; P `routes/proxy-dispatch.js:714-718`, Ro `:1075`, Rl `:1351-1356` via `receiptFor` `:161-179`; K `routes/proxy-kickoff.js:440-459`. Repeated parts ×3: `buildConsumerPollWarning` (S `:930`, `:162`, K `:440`), sparse `budgetPosition` (S `:941`, `:173`, K `:456`), sparse `warning` | copy + param | layout and key order per verb (b: each body is a published contract; rung 5c's key-order change was caught by its replay, `experiments/rebuild-rung5c/arm/score.md` §1 row 2); K `sessionId: item._id` `:446` (b, LIN-591); V29, V30 (c) |
| D26 | Map an enqueue failure | S `routes/dispatch.js:946-998`; P `:719-726` + `relayEnqueueFailure` `routes/proxy-dispatch.js:374-390`; Ro `:1076-1093`; Rl `:1357-1372`; R outer `:1373-1381`; K `routes/proxy-kickoff.js:460-543` | copy + param | tagged refusal: S `mapDispatchRefusal` `:953-957` vs proxy `relayDispatchRefusal` (`routes/proxy.js:841-854`), the same mapper (lane); attach-failed text S `:972` vs `PROXY_ATTACH_FAILED_MESSAGE` `routes/proxy.js:305` (b); V23 (d); V26 (d); S-only `anchorTerminalRefusal` `:987-989` and `composedRunMarkerInvalid` `:993-995` (c for the proxy lanes: only S passes `composedRunMarker`) |
| D27 | Audit every exit | P, R, K `logEvent(req, '<tag>', status[, note])` at each return; S none | lane | (b) |
| D28 | Keepalive and client-gone | R only: `routes/proxy-dispatch.js:897-898`, `:948-951`, `:1122-1124`, `:1211-1215` | lane | (b) |

**The store already normalises most of D10 and D23.** `lib/dispatch-fields.js:48-170` (`RUN_FIELDS`, applied by `addItem` at `lib/dispatch-store.js:385`) applies these rules to the persisted row:
* `target || 'cli'` (`:53`);
* `force === true` (`:100`);
* `maxTasks ?? null` (`:135`);
* `subscription || DEFAULT_SUBSCRIPTION` (`:161`);
* and others.

So the entrance copies are redundant *for the row*. They still matter because `createDispatchItem` reads the raw `fields` before the store does: `isFresh` at `lib/dispatch-factory.js:182-184`, and the duplicate and run-limit guards at `:226-230` and `:283-288`. The safe move is to write each normaliser once in the authority's `fields` literal and leave the store's rules alone. Retiring the entrance copies against `RUN_FIELDS` is a separate, cross-layer decision and out of scope.

Single-entrance decisions, already one site each and not in scope: S's local-host check `routes/dispatch.js:606-608`, `entryRung`/`stopAt`/`variant`/`surface` (`:601-604`); R's descent, AI availability and free-tier charge (`:1096-1174`); K's mode/variant/goal (`routes/proxy-kickoff.js:119-125`), its `parentRun` stopAt inheritance (`:279-282`) and the kickoff composition (`:284-320`).

**Count.** 28 decisions: 24 are made by two or more entrances (13 **copy**, 11 **copy + param**), and 4 are **lane** decisions (D9, D24, D27, D28). Sites per decision before, counted by hand from the table: D1 2, D2 4, D3 2, D4 2, D5 2, D6 3, D7 4, D8 3, D10 4, D11 2, D12 4, D13 3, D14 2, D15 2, D16 5, D17 3, D18 5, D19 4, D20 7, D21 5, D22 14 (4 gates, 5 attaches, 5 plain returns), D23 5, D25 3, D26 6. That is **96 sites for the 24 shared decisions**. Counting rule: a site is one place that writes the decision's rule itself, and a call to a shared helper is not a site (the helper is). For D18, the five places that build the run gate count; P, Ro and Rl reach it through `runGateFor`. For D26, the six catch chains or tails count; P's includes `relayEnqueueFailure`. The ticket carries this rule and a Count column.

## 2. Divergences and their class

Classes: (a) one copy is a bug; (b) deliberate variation, kept as a named parameter; (c) bounded fuzz, unreachable or harmless; (d) unclear, so keep today's behaviour and write it up (never DECISION/BLOCKED).

| Id | Divergence | Evidence | Class |
|---|---|---|---|
| V1 | S reads `req.body`, the proxy lanes `req.body \|\| {}` | `express.json` (and `express.urlencoded`) always leave an object; a JSON `null` body is refused by body-parser's strict mode | (c) |
| V4 | Field acceptance differs by verb. P ignores `presetId`, `attachProxy`, `entryRung`, `surface`, `stopAt`, `variant` and `composedRunMarker` without a 400, though its doc says "same body shape and validation" (`routes/proxy-dispatch.js:405-406`). R and K accept no `terminal`. No proxy verb type-checks `appendProxyContext` | code | (d): which fields a verb should accept is a product call |
| V5 | S and P only length-cap `issueIdentifier` (`lib/dispatch-validation.js:179` caps by `.length`, so a non-string passes and is stored); R and K require `isValidIssueId` (`lib/workspace.js:86-88`) | code | (d) |
| V10 | S stamps `issueSource` on an abort that names an issue (`routes/dispatch.js:639`); P never does (`routes/proxy-dispatch.js:537`, comment `:533-536` "a repo-only / issueless / abort request stamps nothing"). Both store `issueIdentifier` on such an abort (`dispatch.js:864`, `proxy-dispatch.js:685`) | code | (d): keep each, as a named parameter of the one authority |
| V12 | P resolves a provider for a repo-only dispatch (`|| repo`, `routes/proxy-dispatch.js:525`). That trigger came from the LIN-2886 repo guard, which LIN-3333 removed (`:552-555`). It still stamps `req.resolvedProvider`, so the attach names the provider (`:648`) | code + history | (d): dropping it changes the attach prose and removes a credential read |
| V16 | K passes no plan block | the pilot only runs for kind `implementation` (`lib/dispatch-factory.js:687`); K is `autopilot` | (c) |
| V18 | S's plan block reads through the workspace's ACTIVE provider (`getProviderForWorkspace`, `routes/dispatch.js:719`, and `getWorkspaceCallScope` `:726`). Its comment says this is "the same … pair the dangling-referent guard above uses" (`:712-714`), but since LIN-3335 the guard uses `resolveIssueBinding(workspace, issueSource)` (`:655`). P reads through the source-routed access (`:530`, `:593-596`) | code | (d): keep. The comment is (a), fixed |
| V19 | P's follow-up mint adds `!!prompt` (`routes/proxy-dispatch.js:621`); R's arms do not (`:993`, `:1267`) | a follow-up always has a prompt: abort + followUpTo is a 400 (`lib/dispatch-validation.js:120-122`), and prompt is required when not an abort (`proxy-dispatch.js:425`) | (c) |
| V22 | The attach-failed 503 text: S's own (`routes/dispatch.js:972`) vs `PROXY_ATTACH_FAILED_MESSAGE` (`routes/proxy.js:305`) | S's comment says it mirrors the client's old token-rate-limit message (`:959-961`) | (b) |
| V23 | A launch whose owner check is transiently unavailable (`OWNER_CHECK_UNAVAILABLE`, retryable, also carries `proxyAttachFailed`, `lib/proxy-preamble.js:487-491`). S checks coded launch refusals first and answers the owner-mint text with `retryable: true` (`routes/dispatch.js:962-970`); so does M4 (`routes/workspace-api.js:3098-3101`). K checks `proxyAttachFailed` first (`routes/proxy-kickoff.js:472`) and answers the token-rate-limit text. S's comment names this exact trap (`dispatch.js:963-966`) | `tests/unit/lin-3136-m1-kickoff-declared.test.js:215-221` pins K's answer ("the existing transient 503") | (d): keep (test-pinned); recommend aligning K with S and M4 in a follow-up |
| V24 | K and `relayEnqueueFailure` hard-code `retryable: false` on a structural refusal (`routes/proxy-kickoff.js:483`, `routes/proxy-dispatch.js:386`); S uses the vocabulary's value (`dispatch.js:969`) | every structural code has `retryable: false` in `lib/owner-mint-refusals.js:35-57`; only `OWNER_CHECK_UNAVAILABLE` is true (`:63`), and it is not structural (`lib/proxy-preamble.js:42-44`) | (c) |
| V25 | Structural-refusal text. A follow-up resume answers the raw `err.message`: P/R at `routes/proxy-dispatch.js:386`, S at `routes/dispatch.js:977`. A declared launch answers the shared human text from `codedGrantRefusalResponse`: K at `routes/proxy-kickoff.js:481-483`, S at `routes/dispatch.js:968-969` | resume against launch is the axis, not the lane (fresh-reader m4) | (b) |
| V26 | Upstream provider failure: R answers `{error: 'Failed to dispatch prompt', detail, ...graphqlErrorExtra}` at any status (`routes/proxy-dispatch.js:1087-1090`, `:1368-1371`, `:1377-1380`); K answers `{error, code, category, retryable, detail}` for 401/503 only, else a plain 500 (`routes/proxy-kickoff.js:500-542`); S and P plain 500 | code (LIN-2260 for R, LIN-2216/LIN-2363 for K) | (d): two envelopes for one failure; keep |
| V29 | `dispatchedAt` raw (S `:939`) vs `?.toISOString?.() \|\| raw` (`receiptFor` `:174`, K `:454`); `consumerLastSeenAt` raw (S `:940`) vs `\|\| null` | same JSON bytes: a Date serialises to its ISO string; the factory always sets `consumerLastSeenAt` (`lib/dispatch-factory.js:987-989`) | (c) |
| V30 | K's `maxTasks: item.maxTasks` (`:455`) vs `receiptFor`'s `?? null` (`:172`) | the store normalises `maxTasks` to null when absent (`lib/dispatch-store.js:385`, via `normalizeRunFields`) | (c) |
| V33 | R and K leave out fields S and P set (K: `issueId`, `issueTitle`, `issueUrl`, `followUpTo`, `force`, `abort`, `abortTo`, `cascade`, `periodicalId`, `queueIfBusy`; R: `abort`, `abortTo`, `cascade`, `maxTasks`) | the store writes `\|\| null` or normalises each (`lib/dispatch-store.js:385-391`) | (c) |
| V37 | Only S forwards `composedRunMarker` and the done-guard deps (`routes/dispatch.js:739-743`) | LIN-2775 Area 8 | (d) (part of V4) |
| V40 | K tolerates a missing `getWorkspaceOpenRouterKey` (`routes/proxy-kickoff.js:335-337`, default `null` `:67`); P and R call it unguarded | `routes/proxy.js:1576` and `:1580` always pass it | (c) |
| V41 | The free-tier key is read at a different point in each entrance: P after the referent guard (`:572`), Ro before the issue fetch (`:895`), Rl before the AI gate (`:1096`), K after the kickoff is built (`:335`) | a read that throws turns into a different answer depending on what ran first | (b): keep each entrance's order |

**(a) fixes, all comments.** None of them changes behaviour:
* A1 `routes/dispatch.js:594-596` cites "routes/proxy.js's kickoff-seam rule". The kickoff is in `routes/proxy-kickoff.js:172`, and the rule is `validateRunField` (`lib/dispatch-fields.js:191-196`).
* A2 `routes/dispatch.js:712-714`: see V18.
* A3 `routes/proxy-dispatch.js:509-516` says the provider resolution is shared with "repo validation (LIN-2886)" and guards "an already-known-bad repo". LIN-3333 removed that guard (`:552-555`).
* A4 `routes/proxy-dispatch.js:690-691` says "the validated/normalized repo (basename), never the raw caller value". It is stored verbatim (`:556`).
* A5 `routes/proxy-kickoff.js:231-232` says "inherit the project repo". `:234` stores the caller's repo verbatim.
* A6 `routes/proxy-dispatch.js:405-406` says "same body shape and validation" as S. See V4.
* A7 `routes/proxy-kickoff.js:187` lists the body fields but leaves out `model`, `harness`, `effort`, `presetId`, `maxTasks` and `issueSource`.

**Expected behaviour fixes: 0.** Every behaviour divergence is (b), (c) or (d). A behaviour bug the worker finds during the work goes to (d), written up, not fixed (ticket, revised before launch).

## 3. Authority shape and home

**Home: `lib/dispatch-entrance.js`** (area *Runs & dispatch*, `scripts/code-shape/areas.json`: `^lib/(dispatch-[^/]*…)\.js$`).
* *Ownership rule.* The rules in D1–D26 change only when the dispatch contract changes: which body a verb accepts, how a row is built, which credential a launch holds, which refusal a caller sees. That contract is owned by Runs & dispatch. `routes/dispatch.js` is already in that area, and `lib/dispatch-factory.js`, `lib/dispatch-validation.js`, `lib/dispatch-fields.js` and `lib/dispatch-refusal.js` sit beside it. The proxy-lane plumbing (`logEvent`, `relayDispatchRefusal`, `resolveProviderAccess`, `workspaceUnavailable`, `denyIfUnsupported`, `graphqlErrorStatus`, keepalive) stays owned by the Agent API and is *injected*: the closures are the deps the factories already receive.
* *One module, not several.* Every B census defines E as exactly these four files. A second authority file would have to be added to the E set in 9 test files: `proxy-scopes-source-pin`, `lin-3383`, `lin-3134`, `lin-3130`, `lin-3136-enqueue`, `run-limit-gating`, `fingerprint`, `lin-3384`, `lin-2534`. That is a test change for no gain.

**Shape.** `lib/dispatch-entrance.js` exports:
* the existing `firstFailure` and `opaqueFieldError`;
* shared check groups, each defined once and placed by each verb's list:
  * `verbShapeChecks` (D3);
  * `abortAndRunFieldChecks` (D4);
  * `presetChecks` (D5);
  * `executionFieldChecks` (D6, with the effort warning taken from `lib/dispatch-validation.js`, so vDP and the list share one warning);
  * `issueRefChecks` (D7).

  Each verb's ordered list stays a named, per-verb array, because order is each verb's first-failure contract.
* `resolveIssueAccess(deps, req, {required, issueSource, endpoint})` for D13. It holds the one `const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { source: … });` statement, followed by `if (!accessToken)`. The `proxy-credential-fingerprint-stamping.test.js:125-168` E-unit pin and `dispatch-entrance-no-token.test.js` hold it.
* `issueContextOr404` (D14), with the transport injected.
* `danglingReferentRefusal` (D15).
* `persistedIssueSource({isAbort, issueIdentifier, issueSource, stampOnAbort})` (D12; V10 kept as `stampOnAbort`).
* `runGateFor` (D18).
* `planBlockFrom(fetch)` (D19).
* `proxyContextPolicy` (D17).
* **one `enqueue(spec)`** for D16, D20, D21, D22 and D23. It holds the only `createDispatchItem({` call in E. The C2 census requires that call to have a direct `proxyTokenStore` key (`lin-3130`), an inline spread-free `fields` literal, and a `finalizePrompt` whose `provisionResumeCredential(` sits under `if (isFollowUp) {` and passes `attach:`, with `attachProxyContext(` after the gate. Any mint helper outside a `createDispatchItem({…})` call in E is keyed `E | - | <fn>`, and only the broker's `provisionResumeCredential` may be (`lin-3134-declared-mint-census.test.js:573-577`). So the mint must live *inside* the one call, not in a separate helper. The follow-up gate predicate must be a bare `isFollowUp` or `followUpTo` (`findGate`, `:417-428`), and the call text may hold no `declaredGrants` or `grantOwnerAccountId` before the gate closes (`:458`).

  **A text constraint survived inside the unit** (a finding for the write-up). `POST_DISPATCH_GATE` (`lin-3134-declared-mint-census.test.js:638`) is the exact two-line text: 10 spaces, `if (isFollowUp) {`, then 12 spaces, `return provisionResumeCredential({`. Three mutation tests plant on it through `plantInE` (`:701`, `:723`, `:783`), which asserts that the anchor exists somewhere in E. Today only P's copy matches (`routes/proxy-dispatch.js:610-611`).
  * #4a's inventory (`dl4/inventory.md`) classed this pin B, "re-target to E", for mutation 1 (v). For the C2(iii) mutations it classed it A, with "make the B scanner's anchors whitespace-tolerant".
  * At `15191460` the anchor is still exact text: loosened from a file to the unit, but not from a text to a behaviour.
  * The ticket prefers an authority that keeps that text. Otherwise the one check may be converted to a behaviour check: the mint sweep covers the property. That needs failing-then-passing evidence and the reason in the PR.

  The two declared launch literals stay as two lines `declaredGrants: ['dispatch'],` in E: a two-row table `{ M1: …, M2: … }`. F3 requires exactly 2 in E (`lin-3134-declared-mint-census.test.js:132-135`), and no other line in E may contain `declaredGrants`, comments included.
* `receipt(item, layout, extra)` for D25, with three named layouts (`session`, `proxy`, `kickoff`) that reproduce today's key order byte for byte.
* one `relayEnqueueFailure(err, lane, {keepalive, launchSubject, attachFailedMessage, classifyUpstream})` for D26. Each verb's order of checks is a named parameter: S checks the coded launch refusal before attach-failed; K checks attach-failed first (V23, d).

The route files keep:
* the registrations, middleware chains, factory signatures and module-scope limiters;
* the GET/DELETE/PATCH routes;
* thin POST handlers that build the lane context (`{urlKey, accountId, workspaceId, audit}`) and call the authority.

R's keepalive arming and descent, and K's composition and `parentRun` read, are single-entrance steps. They stay where they are, or move with their verb's handler body into named per-verb functions in the authority module; the worker chooses.

**Knot check** (`scripts/code-shape/seams.mjs` over an exported copy, committed, then measured):

| Tree | Pairs | Group | Links |
|---|---|---|---|
| origin/main `15191460` | 18 | 1 group of 9 | 62 |
| model A: `lib/dispatch-entrance.js` imports everything the authority needs (21 lib modules) | 18 | 9 | 62 |
| model B: A, plus the route files drop the imports the authority takes over | 18 | 9 | 62 |

There are no new pairs and no new links. Model A only raises counts on existing Runs & dispatch → {Agent API, Auth, LLM, Other features, Platform, Providers} links, because `routes/dispatch.js` already makes every one of those crossings. Model B also lowers Agent API → Runs & dispatch from 46 to 38 imports, and Agent API → LLM from 35 to 33. Files: `seams-base.json`, `seams-modelA.json`, `seams-modelB.json`; the tree is `tree/` (3 commits).
