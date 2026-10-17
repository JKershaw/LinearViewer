# Dispatch routers behavioural replay (rung 5c)

This tool checks that two versions of Harbour's three dispatch routers behave
the same for every agent- or user-visible outcome:

| Slot | File | Factory | Mounted by |
|---|---|---|---|
| `session` | `routes/dispatch.js` | `createDispatchRoutes` (+ `dispatchQueueLimiter`) | `server.js:2336` — session lane `/workspace/:urlKey/api/dispatch*` and consumer lane `/api/dispatch/*` |
| `kickoff` | `routes/proxy-kickoff.js` | `createKickoffRoutes` | `routes/proxy.js:1576` |
| `proxyDispatch` | `routes/proxy-dispatch.js` | `createDispatchRoutes` | `routes/proxy.js:1580` (after the kickoff router) |

The OLD side is pinned at `origin/main` `1f8010a0` (`pinned/origin-main/`, made
with `git show origin/main:routes/<f>`, byte-identical to the checkout). It makes
no network calls, never calls a model, never mints a real token and never
enqueues a real dispatch. It never writes to `/home/user/LinearViewer`.

```sh
node replay.mjs --new <dirOrFiles> [--old pinned/origin-main] [--n 6000] [--seed 1]
                [--out report.json] [--coverage] [--lib DIR] [--tiers gen,edge,test]
                [--only gen:123] [--keep-work] [--quiet] [--timeout-ms 5000]
node selfcheck.mjs [--n 6000] [--seeds 1,7] [--mutant-n 3000] [--jobs 4] [--lib DIR]   # ≈ 5 min
node capture-tests.mjs [--repo DIR] [--jobs 6]   # re-record pinned/test-calls.json (≈ 1 min)
```

- `--old`/`--new` take a folder or a comma-separated file list. Files are found
  by name (`dispatch.js`, `proxy-dispatch.js`, `proxy-kickoff.js`, also `.mjs`);
  the kickoff router may also be found by its unique `createKickoffRoutes` export.
  Any other file in the side's folder that a router imports relatively (a new
  helper, any name) is copied in on demand and becomes part of that side.
- `--lib DIR`: the checkout whose `lib/` (and `node_modules/`, falling back to
  `/home/user/LinearViewer`'s when DIR has none) BOTH sides load. Default
  `/home/user/LinearViewer` (HEAD at writing: `f4749b91`, whose `lib/` matches
  `origin/main` except pipeline-loops/render-*, which these routes do not
  load). `lib/dispatch-factory.js` is being rebuilt in parallel (LIN-3580):
  point `--lib` at a checkout carrying the new factory to replay the routes on it.
- `--n` is the number of generated requests; the edge and test tiers add ~3,200
  and 1,238 more.
- Exit codes: 0 identical, 1 differences (or an export-surface change), 2 tool
  failure (import/factory/input). Report defaults to `work/report.json`.

## How it works

**Sides and module instances** (`lib/prepare.mjs`, `lib/hooks.mjs`). Each side's
three files are copied to `work/run-<pid>/<side>/routes/`. A resolve hook sends
every import the copies make into `<lib>/` and tags it `?side=<label>`, and the
tag propagates through everything those modules import. Each side therefore
owns a **private instance of the whole repo lib graph**: the factory's
task-done cache, the provider registry, the rate limiters' memory stores,
`lib/workspace-halt.js` state — nothing leaks from the old side into the new
one, while both sides run the same lib *code*. Bare packages (`express`,
`express-rate-limit`) stay shared.

**Mounting, as in production.** `installAsyncErrorForwarding()` runs (per side)
before any router is built. Each app is: response recorder →
`express.urlencoded({extended:false})` → `express.json({limit:'250kb'})` →
session stand-in → router(s) → a transcription of `server.js`'s final error
handler (real `clientErrorStatus`/`clientErrorMessage`/`jsonError`; HTML pages
stubbed). Apps per side, each on its own `127.0.0.1:0` port:

| Lane | Variants |
|---|---|
| session (`dispatch.js`) | `full`; `sparse` (every optional dep null, owner seam unwired); `noStores` (owner seam present, every optional store null) |
| proxy (`proxy-kickoff.js` then `proxy-dispatch.js`, one app, proxy.js order) | `full`; `sparse` (no dispatchTokenStore/presets/accountStore, kickoff gets no `getWorkspaceOpenRouterKey`); `noQueue` (no dispatchQueueStore) |

The halt router (`routes/proxy-halt.js`, mounted before these in proxy.js) is not
mounted, so `GET /api/proxy/dispatch/halt` reaches `/dispatch/:id` here.

**Fakes** (`lib/fakes.mjs`, pure data from the scenario):

- Session lane deps as `server.js` passes them: `workspaceFromUrl` (transcribed),
  `workspaceOwnerCheck`, `getWorkspaceAccessToken`, `fetchIssueContext`, and
  recording stores (queue, dispatch tokens, proxy tokens, user prefs, Harbour
  feedback tokens, workspace prefs, presets, halt, feed cache, task mode, free
  tier, accounts). The REAL provider registry is used (each side's), with every
  network method of each registered provider replaced by a recorder
  (`issueWriteGuard`, `fetchIssueContext` scenario-driven; anything else throws).
- Proxy lane closures transcribed from `pinned/proxy.js.ref`:
  `authenticateProxyToken` (over a recorded `proxyTokenStore.validateToken` /
  `describeRejectionCause`), `requireWriteScope`, `logEvent` (+ credential
  registry ops + `proxyEventStore.recordEvent`), `resolveProviderAccess`,
  `workspaceUnavailable`, `denyIfUnsupported`, `graphqlErrorStatus` (transient
  401→503 rule over scenario registry state), `relayDispatchRefusal` (real
  `mapDispatchRefusal`, real `keepaliveError`), `recommendErrorResponse`,
  `chargeFreeTierOrReject`, `logOpenRouterCredentialSource`; `requireGrant` is
  the real `lib/require-grant.js`. `computeRecommendation`,
  `resolvePromptIssueContext`, `getWorkspaceOpenRouterKey` are scenario-driven
  recorders (descent tables, throws, slow hops, hang-ups).
- Stores answer from the scenario (`{ret}`, `{throw}`, `{seq}`, `{delayMs}`,
  `{hang}`, `{syncThrow}`) or from a plausible default computed from the
  arguments. The queue keeps a **per-app memory** of enqueued rows, so the
  duplicate guard (`findRecentFreshDispatch`) fires across requests the way it
  does in production. `addFeedback` can call the route's wake-credential
  provisioner (`buildWakeCredentialProvisioner`) and record its result.
- Harbour OS: the staging file under `$TMPDIR/harbour-dispatch` (TMPDIR is a
  virtual `/replay-virtual-tmp`) and the `/dev/tty` OSC spawn write are
  intercepted at `fs` and recorded (path, bytes, sha1, mode; the parsed OSC
  payload); scenarios make the tty or the write fail.

**Virtual time** (`lib/vclock.mjs`). Each request starts its own virtual clock
(`clockBase`, 90 s apart per request). While it runs, `Date` and the global
timers are virtual: a timer fires only when the handler is idle-waiting (three
quiet event-loop turns, response not ended), in due order. So the 1500 ms
long-poll re-check, the keepalive's 25 s flush and 15 s heartbeats, the 1500 ms
poll-halt race, the factory's `valueWithin` fallbacks and the recommend descent
deadline all run deterministically in no real time. If the client goes away
(hang-up, abort), the server side keeps running on virtual time (up to 120 s)
so its logEvent/store calls/attempted reply are still observed.

**Hermetic**: proxy env scrubbed; managed env (`NODE_ENV`, `OPENROUTER_API_KEY`,
`OPENROUTER_FREE_TIER_KEY`, `DISPATCH_OWNERLESS_BROKER_COMPAT`,
`HARBOUR_FILE_POINTER_PILOT`) set per request (NODE_ENV=production on ~10%, so
the routes' own express-rate-limit limiters count and emit `RateLimit-*`
headers); non-loopback `connect` blocked and counted; `fetch` recorded and
refused; `Math.random`/`crypto.randomUUID` seeded per request.

## Inputs (seed 1, `--n 6000`)

| Tier | Count | What |
|---|---|---|
| `gen` | 6,000 | Seeded, stratified over 37 URL forms (36 routes + unmatched/case/slash variants, which are credited to the route Express actually reaches): every form ≥100 generated, weighted by complexity. Enqueue forms are 60% "clean" (valid, consistent bodies) and 40% free-random (wrong types, control chars, over-length, malformed JSON / null / array / text / form / >250 kb bodies, bad ids/urlKeys, missing/odd auth). The world varies session shapes, 7 workspace shapes (linear/local/github/ambiguous jira/mixed bindings/no token/no id), owner verdicts, dispatch grant present/absent (`[]`, missing, `take` only, string), scopes, every factory refusal (duplicate guard stateful + forced, budget/position/unverified, runaway, close-out, run limit/unverified), presets, prefs defaults, follow-up anchors and grant declarations (none/record/invalid/throw), mint outcomes and coded refusals, poll-recency token lists, recommend descents (leaf, descend, stuck, non-child, cycle, terminal, slow, unresolved, hang-up), keepalive timing via `x-request-start`, limiter blocks. |
| `edge` | 3,158 | ≈ 330 targeted cases × 5–33 reps: every validation 400 in order, every owner/grant/scope/auth gate on every form, aborts, cascades, follow-up attach/pbt/declared, M1/M2 declared launches and each coded refusal, Harbour OS spawn paths, file-pointer pilot (`readPlanBlock` in all three routes), long-poll change/timeout/vanish/terminal/closed/keepalive flush/client abort, keepalive-flushed refusals (`statusCode` in body), free-tier + paid-env LLM arms × every outcome, limiter bursts (33 session dispatches, 10 token mints in one virtual minute). |
| `test` | 1,238 | Every request the 104 unit-test files that exercise these routes send (recorded by `capture-tests.mjs` into `pinned/test-calls.json`: method, URL, auth/host presence, parsed JSON body), replayed into a clean world (owner session / readWrite+dispatch token, healthy stores). |

## What is compared, per request (`lib/compare.mjs`)

| Kind | Content |
|---|---|
| `status`, `body` | HTTP status; JSON body deep-compared (key order ignored); text bodies (kickoff/manual/passage prompt) by full text or sha256 |
| `header:*` / `header-derived:*` | every response header except date/connection (incl. `Retry-After`, `RateLimit-*`, content-type); etag/content-length separately |
| `store:<name>` | every store op with arguments, in order, per store (queue, tokens, prefs, presets, halt, feed cache, task mode, free tier, accounts, `proxyEventStore` = the audit event store) |
| `depCalls` | closure/seam calls with arguments (owner seam, workspace token, fetchIssueContext, registry provider methods, resolveProviderAccess, resolvePromptIssueContext, computeRecommendation, getWorkspaceOpenRouterKey, denyIfUnsupported, relay, provisioner results, hang-ups) |
| `logEvent` | endpoint, status, note and the raw options argument |
| `credentialRegistry` | registry ops logEvent/auth/resolve perform |
| `fsAndTty` | staging mkdir/write (path, bytes, sha1, mode) and the OSC spawn payload |
| `console`, `unhandledRejection`, `expressErrorHandler`, `egressFetch` | console lines (stacks/paths normalised), async faults, errors reaching the final handler, attempted fetches |
| `serverResponse` | what the server sent or attempted (status, ended, content-type, body), compared when either client saw no complete response |

Fire-and-forget work (task-mode record, audit writes) is flushed into the
request's record (6 setImmediate + a timer tick + 2 setImmediate) before
comparing. Export surfaces of all three modules are diffed too (`exportsDiff`).
Report: `summary`, `perRoute` (status histograms, `statusLogPairs`, outcome
tags), `edgeOutcomes` (per edge case), `thinStatusLogPairs` (<5 hits),
`differences` (grouped by route × kind with a trimmed example and ≤25 ids —
re-run one with `--only <id>` for full old/new detail), `coverage` (with
`--coverage`), `importSideEffects`.

## Self-check (`node selfcheck.mjs`) — results

`reports/selfcheck.json` / `reports/selfcheck.log` (≈ 4 min, 4 jobs):

| Check | Result |
|---|---|
| identity seed 1 (old vs an independent copy, all tiers) | 10,396 requests (gen 6,000 / edge 3,158 / test 1,238), **0 differing**, exports identical, ≈ 60 s |
| identity seed 7 | 10,396 requests, **0 differing** |
| d1 `dispatch.js` trim not-downward 409→422 | caught: status ×7 |
| d2 `dispatch.js` 201 drops `item.consumerLastSeenAt` | caught: body ×524 |
| d3 `dispatch.js` broker mint label `refire-broker`→`refire` | caught: store:proxyTokenStore ×118 |
| d4 `dispatch.js` DELETE …/halt loses its owner gate | caught: depCalls ×89, status ×43, store:workspaceHaltStore ×42, body, console |
| d5 `dispatch.js` task-mode record drops `surface` (fire-and-forget) | caught: store:taskModeStore ×4 |
| p1 `proxy-dispatch.js` list audits 200 as 201 | caught: logEvent ×115, store:proxyEventStore ×115 |
| p2 `proxy-dispatch.js` long-poll interval 1500→1000 ms | caught: body (waitedMs) ×30, store ×27 |
| p3 `proxy-dispatch.js` override arm drops `override: true` | caught: body ×153 |
| p4 `proxy-dispatch.js` defer refusal on `res` instead of the armed keepalive | caught: status/body/serverResponse/console/expressErrorHandler ×8 |
| k1 `proxy-kickoff.js` `waitForFollowUps` true→false | caught: store:dispatchQueueStore ×185 |
| k2 `proxy-kickoff.js` declaredSite `M1`→`M2` | caught: store:dispatchQueueStore ×176 |
| k3 `proxy-kickoff.js` GET goal cap 1000→999 | caught: body/content-length/etag ×8 |

Every mutant is detected only on its own route. Mutant runs use `--n 3000`
plus the full edge and test tiers.

Line coverage of the old files (V8 precise coverage → lines), identical on both seeds:

| File | Coverage | Uncovered |
|---|---|---|
| `dispatch.js` | 99.48% (1144/1150) | 181-182, 222-223, 1907-1908 (unreachable, see Limits) |
| `proxy-dispatch.js` | 99.70% (1002/1005) | 931-933 (unreachable) |
| `proxy-kickoff.js` | 100% (295/295) | none |

Floor (seed 1): the smallest URL form gets 137 requests; every (status,
logEvent) pair seen on a real route is hit ≥5 times (`thinStatusLogPairs` is
empty apart from the unmatched bucket). Import census: only `dispatch.js`'s
graph reads env at import (`OPENROUTER_API_URL`, plus `NODE_V8_COVERAGE`
under coverage); no console output, globals or sockets at import.

## Limits

- The deps are models: transcriptions of `routes/proxy.js` closures and
  `server.js` middleware at `1f8010a0`, not the code itself. A rebuild that
  changes the dep contract (renamed deps, argument order) shows up as diffs
  (usually TypeError 500s); a rebuild that changes what `proxy.js`/`server.js`
  pass is not replayed here.
- Lib changes are not compared: both sides load the same `--lib` code (in
  separate instances). Shared-state bugs *across* routers inside one side are
  visible only where they surface in these routes.
- Sequential requests only (no concurrency races). The per-app duplicate-guard
  memory means one real difference can cascade into later diffs on the same
  issue identifier (look at the earliest id in a group).
- Not reachable through HTTP and so uncovered: `dispatch.js` 181-182 / 222-223
  (`Bearer ` with an empty token — HTTP strips trailing whitespace from header
  values), 1907-1908 (`!resumed?.bootstrapToken` — the resume helper either
  returns a token or throws), `proxy-dispatch.js` 931-933 (`generatePrompt`
  returns null only for an unknown template, which `hasPrompt` already 400s).
- `express-rate-limit` per-IP limiters are real (module-level in
  `dispatch.js`) and counted only on `NODE_ENV=production` requests; the proxy
  limiter is a recorder (it lives in `proxy.js`).

## Source-text tests a rebuild must keep green (they read these files' text)

| Test (tests/unit/…) | Pins |
|---|---|
| `proxy-credential-fingerprint-stamping` | exactly 1 `const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req[, {…}]);` in kickoff and 1 in proxy-dispatch, each followed only by comments then `if (!accessToken)`; literal endpoint tags present |
| `lin-3136-enqueue-census` | `createDispatchItem(` sinks: proxy-dispatch 3, kickoff 1, each under a `requireGrant('dispatch')` POST |
| `lin-3136-dispatch-gate` | the three proxy GET registration lines carry no `requireGrant`/`requireWriteScope` |
| `lin-3383-runner-enqueue-census` | in dispatch.js, `resolveRunnerOwnerRefusal(` / `refuseNonOwner(req, res, row?.target)` precede every store write/enqueue sink |
| `lin-3384-redaction-census` | per-handler counts of store reads/projections keyed by route path or enclosing identifier (`host`, `refuse`, `parentRun`, `liveSeen`) |
| `lin-3134-declared-mint-census` | `declaredGrants: ['dispatch'],` literally in kickoff (M1) and dispatch.js (M2); follow-up arm keys per createDispatchItem block; broker `createdBy: req.dispatchTokenOwner,` and the `provisionResumeCredential({` call text |
| `lin-3134-default-path-characterization` | `function formatDispatchWatch(` … `\n}\n` and `const items = filtered.slice(0, limit).map(` … `}));` bodies are spread-free |
| `passage-runner-contract-drift` | proxy-dispatch list item exact field set; `formatDispatchWatch` body includes `sessionId` |
| `lin-3137-dispatch-token-preservation` | `router.post('/workspace/:urlKey/api/dispatch/tokens', tokenCreationLimiter, workspaceFromUrl,` and order limiter → `resolveOwnerMintRefusal` → `dispatchTokenStore.createToken` before the GET registration |
| `lin-3124-pr3-checkpoint-c2` | `getWorkspaceAccessToken: (k) => getWorkspaceAccessToken(k, req.session)` in dispatch.js |
| `proxy-scopes-source-pin` | dispatch.js imports `READ_WRITE` from `../lib/proxy-scopes.js` and uses `scope: READ_WRITE` |
| `run-limit-gating` | the files with `createDispatchItem(` + `runGate` are exactly dispatch/proxy-dispatch/proxy-kickoff/workspace-api, each with a refusal relay (`mapDispatchRefusal(` / `relayDispatchRefusal(`) |
| `lin-3130-create-dispatch-item-proxy-token-store-pin` | every `createDispatchItem({…})` call has `proxyTokenStore` as a direct key of an object literal |
| `lin-2534-tokens-admin-extraction` | every `rateLimit(` in dispatch.js is a `= rateLimit(` declaration |
| `proxy-endpoint-inventory-witness` | `router.<verb>(` registration counts across proxy route files (kickoff 4, proxy-dispatch 6) |
| `lin-2533-agent-status-extraction`, `interactive-openrouter-chain-byte-identity`, `urlkey-holders`, `proxy-tokens-private-mint-source-pin`, `import-graph` | whole-tree scans (`routes/proxy-*.js` needles, shared OpenRouter chain expr, `collection('…')` literals, createToken/requireGrant mounts, static import specifiers) |
