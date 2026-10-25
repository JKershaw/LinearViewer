# Rung 7 — behavioural replay of `routes/workspace-api.js`

Target: `routes/workspace-api.js` at origin/main **16e7ae77e8fba0874c5776e2421ace6da3b2f474**
(4,673 lines / 2,816 code lines, 113 functions, worst handler `POST /api/feedback` = 57 decision
points). Pinned byte-identical (`git show origin/main:routes/workspace-api.js`) at
`replay/pinned/origin-main/workspace-api.js`. Nothing in `/home/user/LinearViewer` was modified
(only `git fetch origin main`); no network, no model/OpenRouter call, no Linear/GitHub/harbour.cat call.

```
S=/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad/rung7
node $S/replay/replay.mjs --new <dirOrFile> [--old $S/replay/pinned/origin-main] [--n 3000] [--seed 1]
     [--out f.json] [--coverage] [--lib DIR] [--tiers gen,edge,test] [--only <id>] [--dump f.jsonl]
node $S/replay/livetests.mjs --new <dirOrFile> [--all]       # the unit tests, live, per side (~65 s)
node $S/replay/selfcheck.mjs [--jobs 4] [--lib .]            # identity ×2 seeds + 24 mutants + 1 witness (~5 min)
node $S/replay/capture-tests.mjs                             # re-record pinned/test-calls.json
```
`--new` takes the rebuilt file, or a folder holding `workspace-api.js` (+ any helper modules it
imports relatively — they become part of the new side; sibling route files present in that folder
are taken from it too). `--lib` defaults to the repo root (HEAD: lib/, routes/, docs/ …) and must be a
tree with `lib/model-routing.js` (LIN-3853 or later); the `16e7ae77` snapshot predates it and the
replay exits 4 on it (LIN-3880). Exit 0 same / 1 different (or export
surface changed) / 2 tool failure. Run both `replay.mjs` and `livetests.mjs` on a rebuild.

Files: `requirements-notes.md` (every route, middleware, calls, responses, errors, logs, side
effects), `arm/old-shape.json` (kit `shape.mjs`), `replay/` (tool), `replay/reports/` (self-check,
live-test runs), `variant-text/` + `make-text-variant.mjs` (behaviour-identical, text-changed copy
used as a positive control and to find source-text tests).

## How it works
Built on the shared kit's new router support (`../replay-kit/lib/router/`, documented in
`../replay-kit/README.md`); rung-specific code is `replay/lib/{fakes,gen,edge}.mjs`.

- **Sides**: each side's file runs in a private copy of the WHOLE lib graph (`?side=` instances), so
  module state (commentDedupe / generations in `routes/proxy.js`, `decisionStampDedupe`, the
  OpenRouter catalog cache, the PR-status cache, provider registry) never leaks between sides.
- **Mounted as server.js mounts it**: urlencoded → `json({limit:'250kb'})` → session stand-in
  (data + `save(cb)`) → router → transcription of server.js's final error handler. Three app
  variants per side: `full` (deps exactly as server.js:2978 passes), `sparse` (every optional dep
  and the 503-guarded stores absent), `seams` (full + the LIN-3247/3248 test seams `runEvidence` /
  `closeOut`).
- **Fakes**: `workspaceFromUrl` / `getOpenRouterSource` transcribed from server.js; recorders for
  `workspaceOwnerCheck`, `adoptConnectionCredential`, `onTicketWrite`; 19 recording stores. The REAL
  provider registry (linear/local/jira/github/github-projects + 2 synthetic stub providers that
  reach the defensive capability branches) with every network method replaced by a recorder.
  **Seams**: `lib/openrouter.js` (getRecommendation, getRecommendationStream, streamChat,
  streamChatWithTools) and `lib/audit.js` (runAudit) are shimmed for every importer, so recap / brief /
  scan / feedback-title / roadmap logic runs for real against fake model text. Global `fetch`
  (image proxy, model catalog, GitHub PR reads) is recorded (Authorization digested) and answered
  from the scenario.
- **Virtual time**: keepalive flushes (20/25 s), 15 s SSE comments, the 180 s descent budget, 45 s
  context-fetch bound and client hang-ups all fire deterministically in no real time.
- **Compared per request**: status, body (key order ignored; SSE parsed into events), every header
  the handler sets (Content-Disposition, Cache-Control, X-Content-Type-Options, content-type, …),
  redirects (`location`), every provider/closure call with args, every store op with args (per
  store), seam calls (model/audit) with args, outgoing fetches (URL, method, headers, redirect mode),
  console lines (= the logged events), final session state + `save()` calls, unhandled rejections,
  errors reaching the final handler, what the server attempted after a client hang-up, the export
  surface (names, arity, `decisionStampDedupe` shape) and direct calls of the two exported helpers.

## Inputs (seed 1, `--n 3000`): 6,592 requests
| tier | count | what |
|---|---|---|
| gen | 3,000 | seeded, stratified over 44 forms (32 routes, 11 sub-router routes, unmatched/case/trailing-slash variants, direct export calls), every form ≥55; worlds vary NODE_ENV test/production, paid/free/blank/no OpenRouter key, session shapes (normal / no workspaces / empty / no account / owner vs member / features / free-tier flag / session key), 13 workspace shapes (Linear, test-token, local, Jira, ambiguous Jira, GitHub, GitHub Projects, mixed bindings + `?source`, connection-backed, providerless legacy, no token, 2 stub providers), owner-check verdicts, every provider/store/model failure shape, keepalive timing (`x-request-start`), client aborts, malformed bodies (bad JSON, null, arrays, text/plain, form, >250 kb, >12 MB). |
| edge | 3,241 | ≈ 390 targeted cases × 1–30 reps: auth middleware ×5 shapes ×5 on every route, every validation 400 in order, every capability 422, test-mode/mock-AI branches, dedupe pairs/triples, LIN-2933 recovery (durable + connection), stamp outcomes, keepalive-flushed errors, SSE descent/cycle/abort, image SSRF/host/traversal/raster/size/redirect cases, feedback lanes × owner refusals × run-limit × grant refusals, symbolic ref resolution, PartialWrite, close-out check/press with merged PRs and approved review ledgers. |
| test | 351 | every HTTP request the 94 origin/main unit-test files that mount the router send it (captured by `capture-tests.mjs`), replayed into a clean world. |
| live | 177 files / 5,399 tests | `livetests.mjs`: the unit tests themselves, run per side on a snapshot overlay. |

Per route ≥57 requests (smallest real route `POST /prompts/custom` 82; export calls 55/69). Every
observed (status, error code, keepalive-flushed status, SSE terminal event) pair is hit ≥5 times
except one client-abort artifact (`PATCH /issues NO_RESPONSE(server 404)`, 1).

## Self-check
`replay/reports/selfcheck.json` / `.log` (≈ 7 min, 4 jobs; identity 6,592 requests ≈ 40 s each):

| check | result |
|---|---|
| identity seed 1 (old vs an independent copy, gen 3,000 + edge 3,241 + test 351) | **0 differing**, exports identical |
| identity seed 7 | **0 differing** |
| positive control: `variant-text/` (comments stripped, `const`→`let`) | 0 differing (`reports/variant-text-replay.json`) |
| live tier, old vs old (177 test files, 5,399 tests) | 0 differing verdicts (9 tests fail identically on both sides from the snapshot environment: `lin-688-undici-not-a-dependency` (no lockfile in the snapshot) and `owner-backfill-script` (script env)) |
| m01 image credential sent for every provider | caught: egressFetch ×29 |
| m02 comment attribution text | caught: depCalls ×142, body ×104 |
| m03 feedback owner gate removed | caught: depCalls ×87, body ×15, store:dispatchQueueStore/proxyTokenStore ×9 |
| m04 scan-due page size 40→39 | caught: store:taskDecisionsStore ×67 |
| m05 sessions oldest-first | caught: body ×4 |
| m06 press 409 code renamed | caught: body ×12 |
| m07 onTicketWrite on every PATCH | caught: depCalls ×27 |
| m08 SSE `fetching_context` phase dropped | caught: body ×118 |
| m09 audit capability name | caught: body ×24 |
| m10 free-tier model clamp dropped (recap) | caught: store:workspacePreferencesStore ×9 |
| m11 retire outcomeBasisHash null | caught: store:taskDecisionsStore ×53, body ×26 |
| m12 image Cache-Control public | caught: header:cache-control ×36 |
| m13 detail section whitelist | caught: body ×6 |
| m14 stamp drops optionId | caught: store:dispatchQueueStore ×4 |
| m15 recovery session mutation (expiry dropped) | caught: session ×7 |

Every mutant is detected only on its own route. Line coverage of the old file (V8 precise),
identical on both seeds: **98.79 % (2,782/2,816)**; uncovered (all unreachable, see below): 468-471,
550-551, 763-765, 1725, 2128-2129, 2361-2364, 2367-2371, 2673-2676, 2975-2978, 3874-3875, 4324-4326.

## AI-path floors (LIN-3880)
The fakes were stale against LIN-3853: the workspace-preferences store had no `getRoutingTable`,
so POST scan, retire, recap and brief (and the recommend routes) died with a 500 before any model
call, and the replay still printed `differing: 0`. Now:

- the fake store answers `getRoutingTable` with `tableFromPreferences` over the scenario's
  preferences; the Principle 0 section answers `null` on `sc.ai.principleZero` (fail-closed arm);
- the generator sets per-operation model overrides and Principle 0 nulls; edge adds the seven verbs
  (`OPTIONS HEAD PUT DELETE PATCH GET POST`) on each AI path;
- every run counts what its requests reached (`model:<feature>`, `store:recordScan`,
  `arm:{p0Null,notConfigured,upstream503}:<family>`, `verb:<METHOD>:<family>`) and judges the
  totals against `AI_FLOORS` (replay-kit `router/ai-coverage.mjs`). A miss is exit 3 (`--ai-floor
  fail`, the default; `warn` and `off` also exist). The report prints what the new side reached.

Measured (`--n 3000`, seed 1, `--lib .` = HEAD): 6,672 requests (gen 3,000, edge 3,321, test 351);
new side reached `model:scan` 73, `model:scan-retire` 69, `model:recap` 85, `model:brief` 84,
`model:recommend` 226, `store:recordScan` 65; no `reading 'jobs'` error remains (the 407 remaining
500s are the scenario's injected faults, e.g. `kaboom`, `store down`). Identity: 0 differing, AI path
`pass`.

Limits of the floors: they are presence floors (at least one request per family and arm), not rates.
Partial vacuity (a few of many requests reaching the model) is caught by the per-route mutants
16–24, not by the floors. `REPLAY_STALE_FAKES=1` (today's kit) gives 0 differing and exit 3.

Self-check on HEAD (`reports/selfcheck-lin3880.json/.log`): identity ×2 pass; witness pass; mutants
16–24 caught on their own route; m01–m15 as before. Two checks fail that are not AI-path and were
not changed here: **m05** (sessions oldest-first) is not detected with the HEAD lib (the same
result on the pre-change kit from `git archive HEAD`, 0 differing), and **line coverage** of the
pinned file is 90.87 % (88.25 % on the pre-change kit) against the 95 % floor. The selfcheck exits 1
for those two; no floor was loosened.

## Source-text tests that read this file (keep green; `livetests.mjs` runs all of them)
Found by grep over `tests/unit` and confirmed live (`livetests.mjs` with the comment-stripped,
`const`→`let` copy in `variant-text/` — behaviour-identical, the replay shows 0 differences — fails
exactly the two marked ✱):

| test (tests/unit/…) | pins in routes/workspace-api.js |
|---|---|
| `free-tier-model-clamp-wiring` ✱ | every `resolveWorkspaceModel({` / `resolveAiOperationModel({` call LINE carries `forceDefault: isFreeTier`, except two exact display-only lines (incl. `const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recommend' })`) |
| `workspace-accesstoken-linear-egress-census` ✱ | exactly 2 `isActiveProviderLinear(workspace)` guards (audit + image), exactly 1 non-comment `runAudit(` line in routes/, image relay counted as an asset relay |
| `interactive-openrouter-chain-byte-identity` | exactly 6 `checkFreeTierGate(` calls in this file; every routes/lib file calling it is in the pinned map (a helper file in routes/ would fail it); no inline `sessionApiKey \|\| getPaidEnvKey() \|\| freeTierKey` |
| `lin-3383-runner-enqueue-census` | `createDispatchItem` sinks: count 2, only inside `enqueueFeedbackTriage(` / `enqueueFeedbackAutopilot(`, which are called only in the `router.post('/workspace/:urlKey/api/feedback'` handler, after `resolveRunnerOwnerRefusal(` |
| `lin-3134-declared-mint-census` | `declaredGrants: ['dispatch'],` exactly once (site M4); per-function census keys `function enqueueFeedbackTriage \| kind: 'triage'`, `function enqueueFeedbackAutopilot \| kind: 'autopilot'`, one `attachProxyContext` launch in the autopilot helper |
| `run-limit-gating` | file has `createDispatchItem(` + `runGate` and an `err.runLimit` relay |
| `lin-3130-create-dispatch-item-proxy-token-store-pin` | every `createDispatchItem({…})` literal has `proxyTokenStore` as a direct key |
| `lin-3124-pr3-checkpoint-c3` | `activeConnectionBackedBinding(workspace)?.connectionId`, `adoptConnectionCredential({`, `setBindingCredential(adoptedConnection.binding, adoptedConnection.credentialBag)`, `setWorkspaceCredential(workspace, adoptedConnection.credentialBag)`; imports `../lib/connection-binding.js` and no `../lib/connection-{credential,store,lifecycle,access}.js` |
| `lin-3136-enqueue-census`, `proxy-tokens-private-mint-source-pin`, `urlkey-holders`, `email-import-boundary`, `lin-2533-agent-status-extraction`, `proxy-endpoint-inventory-witness` | whole-`routes/` scans (no `mintGrantBootstrap`, `collection('…')` literals, no email imports, router registration inventories) — any new helper file under routes/ is scanned too |
| `comment-write-route` | `server.js` text: `app.use(createWorkspaceApiRoutes({ … ownerCredentialStore … }))` (keep the factory name and dep key) |

## Behaviour a rebuild must keep (security-sensitive)
- Image proxy (SSRF / XSS): `https://` only, exact hosts `uploads.linear.app|cdn.linear.app|linear.app`,
  no `..` in the pathname, `redirect: 'error'`, 10 MB cap, bytes sniffed (no SVG/HTML relay),
  `X-Content-Type-Options: nosniff`, `Cache-Control: private`; the Bearer credential goes ONLY to
  a Linear (or providerless) active workspace (LIN-1899) — `egressFetch` compares the header digest.
- Audit refuses a non-Linear workspace (422) so its credential never reaches api.linear.app.
- Feedback triage/autopilot: owner gate `resolveRunnerOwnerRefusal` (fail closed on seam errors)
  before any enqueue/mint; autopilot mints a declared `dispatch` grant (M4) owner-scoped to the
  session account; `createdBy`/`dispatchedBy` from the session, never the body; free-tier run gate.
- Comments: the upstream error message is never returned (classified `code/category/retryable/detail`
  only); logs carry credential fingerprints only; LIN-2933 recovery only for an auth rejection on the
  active Linear binding with no `?source`, never in test mode, never mirrored onto a connection-backed
  binding; the session is mutated/saved only on that path; dedupe + stamp-retry semantics.
- `?source` only selects among the workspace's own bindings (no cross-workspace credential).
- Close-out check/press: signed-in person session only (401 without account, 403 for proxy-token
  requests); Done is written only inside `closeOutSetsDone` bounds and once per recorded merge.
- AI routes: free-tier clamp to the default model (`forceDefault: isFreeTier`) and the 429 gate;
  retire decides only on its own re-scan text, never a client verdict; scan never persists on
  fail-closed/parse errors.

## Surprising findings in the OLD file (baseline, replayed as-is)
- **The leaf SSE stream has no descent budget**: `getRecommendationStream` gets only the client
  signal, so a hung model keeps `/recommend/:id/stream` open (15 s comments) until the client
  leaves; the JSON route and the descent path abort at 180 s. (Edges bound it with a virtual
  client abort.)
- Throws that escape the handlers to the final 500 `Internal server error`: a throwing
  `freeTierStore.tryUse` in `checkFreeTierGate` (outside the try on recommend, stream, recap, brief,
  scan, retire); a throwing `adoptConnectionCredential` (called in the comment route's catch,
  outside its inner try); `/recommend/status` prefs errors; a repeated `?url=` on `/image`
  (array → `startsWith` TypeError, 500 not 400).
- Connection-backed workspaces call the provider with an `undefined` call scope (side table not
  hydrated in this lane) until recovery hydrates it.
- Unreachable code (34 lines, the coverage gap): the 10 MB feedback-image check (the route parser's
  12 MB limit caps decoded images at ~9.4 MB), the model-catalog catch (`getModelCatalog` never
  rejects), `!result` after `generatePrompt` (`hasPrompt` guards it), the general-kickoff catch, the
  test-mode branch inside the (non-test-only) recovery, `buildContextGraph` null after a found root,
  mock-fixture maps over siblings/comments/children the fixtures don't have, and the Principle-0
  fail-closed arms (only when `docs/autopilot-operating-manual.md` is unreadable).
- The close-out check reads GitHub anonymously for Linear workspaces (`prReadToken` gives a token
  only for a bound GitHub repo).

## Limits
- Fakes are models: closures transcribed from server.js at 16e7ae77; providers are recorders (their
  real network code is not exercised); model text and GitHub/catalog responses are scenario data.
- Lib is shared code (both sides run the same snapshot lib, privately instanced); a rebuild that
  changes what it passes to lib shows up through the recorded calls/outputs.
- Mounted standalone: shadowing by routers server.js mounts earlier is not replayed.
- Sequential requests only; per-side state (dedupe caches, queue memory) makes order significant, so
  one real difference can cascade into later requests (look at the earliest id in a group).
- Unreachable lines (listed above) are not exercised by any input.
