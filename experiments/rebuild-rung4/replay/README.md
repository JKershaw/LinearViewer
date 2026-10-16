# proxy write-side behavioural replay (rung 4)

This tool checks that two versions of three Harbour routers behave the same.

| `--files` name | File | Factory | Surface |
|---|---|---|---|
| `writes` | `routes/proxy-writes.js` | `createProxyWriteRoutes` | 13 bearer-token write forms (issues, description append/replace, comments plus alias, attachments, relations, labels) |
| `rulings` | `routes/proxy-rulings.js` | `createRulingsRoutes` | `GET /api/proxy/rulings` and suggest-dismissal / suggest-answer |
| `tokens-admin` | `routes/proxy-tokens-admin.js` | `createTokensAdminRoutes` | session-cookie token mint/list/revoke, events, credential-health |

Both versions get the same seeded stream of HTTP requests and the same
recording fake world. The tool then compares what each one does. It is a
sibling of `../../rung3/replay`, which it leaves untouched, and is generalised
to cover several files at once. It makes no network calls beyond loopback and
never modifies `/home/user/LinearViewer`.

```
node replay.mjs --old <dirOrFiles> --new <dirOrFiles> [--files writes,rulings,tokens-admin]
                [--seed 1] [--n 3000] [--out report.json]
node replay.mjs --self-check [--base pinned/origin-main] [--files …] [--seed 1] [--n 3000] [--out selfcheck.json]

other flags:
  --repo <dir>       repo whose lib/, routes/ and node_modules/ both sides share (default /home/user/LinearViewer)
  --only <i>         replay just request i (use with one --files entry); full old/new detail in files.<slot>.onlyDetail
  --timeout-ms <ms>  per-request timeout (default 5000)
  --jobs <k>         self-check child runs in parallel (default 4)
  --keep-work        keep work/run-<pid>/{old,new}/routes/
  --quiet            no progress or unattributed console output on stderr
```

- `--n` is the number of requests **per file**.
- `--old` and `--new` each take either a folder or a comma-separated list of
  files. A file fills a slot by its canonical name (also `.mjs`) or, failing
  that, by which factory it exports.
- `pinned/origin-main/` holds the three files from `origin/main` at `06ec62b7`,
  made with `git -C /home/user/LinearViewer show origin/main:routes/<f>`.
  `pinned/proxy.js.ref` holds that commit's `routes/proxy.js`, which the fakes
  transcribe.

Exit codes:

| Mode | Code | Meaning |
|---|---|---|
| replay | 0 | finished, whatever diffs it found |
| replay | 3 | import, factory or input failure |
| self-check | 0 | every check passed |
| self-check | 1 | at least one check failed |

## How it works

### 1. Sides and module resolution

Each side's router files are copied to `work/run-<pid>/<side>/routes/`. The
side folder gets a `package.json` with `"type":"module"`. A resolve hook,
`lib/hooks.mjs`, handles every import made from a side's tree in this order:

1. A relative import that already exists in the tree resolves there.
2. Otherwise, if the same relative path exists in the side's **source
   folder**, the file is copied in on demand and resolved there. Any name
   works; a rebuild can add a helper such as `routes/write-shapes.js`.
3. Otherwise the import resolves as if the importer sat in `<repo>/routes/`.
   This covers `../lib/*`, `./dashboard.js` and `express`, so both sides share
   one instance of every repo module.

The rebuild's helpers are therefore compared as a set. This was tested with a
helper that itself imports `../lib/errors.js`: it resolved with `via:
side-copied`, the run showed 0 diffs, and the helper got its own coverage
entry.

The import census (`importSideEffects`) records, for each slot and side:

- env vars read
- new globals and handles
- console output and sockets
- modules first loaded
- how side-relative specifiers resolved

The census is order-dependent. At `06ec62b7` the `rulings` import pulls in
`routes/dashboard.js`, loading 155 modules and reading `NODE_ENV`,
`NODE_V8_COVERAGE` and `OPENROUTER_API_URL`. The `writes` and `tokens-admin`
imports have no side effects.

### 2. Mounting, as in production

`installAsyncErrorForwarding()` from `lib/async-errors.js` runs before any
router is built. Each app is assembled in this order:

1. `express.urlencoded({extended:false})`
2. `express.json({limit:'250kb'})` (server.js:975-976)
3. an express-session stand-in that sets `req.session` from the scenario
4. the router
5. a transcription of server.js's final four-argument error handler

The error handler uses the real `clientErrorStatus`, `clientErrorMessage`,
`jsonError` and `serverError`. Its HTML pages are stubbed, and stacks are
reduced to name and message.

There is **one app per (side, file, optional-dep variant)**, each on its own
`127.0.0.1:0` port:

| File | Variants |
|---|---|
| `writes` | `harbourCommentsStore` and `onTicketWrite` present or `null` |
| `rulings` | `sessionsFeedCache`, `dismissalSuggestionsStore` and the task/shelf stores present or `null` |

### 3. Fakes (`lib/fakes.mjs`)

The deps transcribe the real closures in `routes/proxy.js`:

- `authenticateProxyToken`: read vs readWrite tokens, runner copies carrying
  `take`+`dispatch` grants, rejected tokens with or without a descriptor,
  store throws
- `requireWriteScope`, against the real `READ_WRITE`
- `resolveProviderAccess`, which stamps fingerprint, expiry, source and
  provider
- `denyIfUnsupported`, `denyIfMissingRead`, `workspaceUnavailable` and
  `writeRejected`
- `graphqlErrorStatus`, including the transient 401→503 rule over registry
  state
- `logEvent`, with full witness/suspect logic writing to
  `proxyEventStore.recordEvent`
- `resolve{Team,State,Project,Label}Input`, using the real
  `lib/proxy-ref-resolver.js`
- `refResolutionFailed` and `partialWriteFailed`, using the real
  `RefResolutionError` and `PartialWriteError`

`workspaceFromUrl` transcribes server.js.

Stores and the rest:

- **Stores** are recording proxies. Every op is recorded with its arguments,
  and the result comes from the scenario (return, throw or sequence).
- **`commentDedupe` / `commentDedupeGenerations`** are real
  `createDedupeCache()` / `createGenerationTracker()` instances, **one per
  app**, wrapped so that `get`, `set`, `current` and `bump` are recorded. They
  persist across requests, as in production. `crypto.randomUUID`, used for
  generation tags, is drawn from the per-request seeded `Math.random`, so both
  sides mint identical tags.
- **Rulings loops are not faked.** The real `getLoopsForWorkspace` rebuilds
  them from seeded `dispatchQueueStore.listItems/listHistory` and
  `agentStatusStore.listStatus` rows, shaped like
  `tests/unit/proxy-rulings-routes.test.js`. The rows cover decision entries
  with and without options, answered, dismissed, withdrawn, reversed and
  malformed stamps, terminal markers, lineages, `followUpTo`, bookkeeping and
  `issueSource`. Each row carries a fresh digest from the real
  `digestFeedback`. Task decisions, newest-scan, shelves (loop-scoped or wide,
  active or lapsed) and standing suggestions come from their stores.
- **`sessionsFeedCache`** models `keyFor`, `get`, `set`, `peek` and `clear`.
  `get` can hit, miss (running the real producer) or throw. `keyFor` and
  `clear(urlKey)` are recorded as store ops.
- **Limiters** are recorders that can answer 429. The token-mint limiters
  evaluate **this side's** exported `isDefaultCopyMint`. Exported constants
  and functions are also diffed (`exportsDiff`).
- **`onTicketWrite`** is fire-and-forget. It is recorded, may call
  `readBack()` (recording `provider.fetchIssueContext`), and may throw. After
  each response the harness flushes 6 `setImmediate`, one timer tick and 2
  more `setImmediate` before it snapshots the calls.
- **Determinism and hermeticity:**
  - The clock is frozen at `2026-10-01T12:00:00Z`, so `generatedAt` and `now`
    are stable.
  - Proxy env vars are scrubbed.
  - Any non-loopback `connect` is blocked and counted.
  - `globalThis.fetch` is recorded and refused.
  - `DISPATCH_OWNERLESS_BROKER_COMPAT` is set per request.

### 4. Requests

| File | How requests are chosen |
|---|---|
| `writes` | **Stratified.** The 13 forms rotate, and every 40th request is an unmatched method/path. Within a form, requests rotate through 40 intent slots: half are `free` (fully random) and half force one outcome on a canonicalised valid request. The forced outcomes are: each provider error class (401, 503-transient, 404, 429, 500, 504, userError 400, thrown `null`), `RefResolutionError`, `PartialWriteError`, rejected write, limiter 429, malformed JSON, body over 250kb, auth failure, read scope, no workspace token, unsupported capability, trashed, a dedupe hit, a huge image, and attachment description and embed over-length. |
| `rulings`, `tokens-admin` | Weighted random. |

The random draws cover:

- IDs: valid, malformed, unicode, bad percent-encoding
- every body field: valid, missing, wrong type, oversized, control characters,
  unicode
- body encodings: JSON, charset, urlencoded, `text/plain`, octet-stream,
  malformed, `null`/array JSON, over 250kb
- huge attachment bodies, a handful per run: 10MB+1 decoded (route 413) and
  over the route's 14mb parser
- path-shape variants
- sessions: no workspaces, foreign or invalid `urlKey`, no account,
  `features.proxy` off, a throwing session
- every copy purpose, `runner` alias, `grants` refusal, bootstrap and
  ownerless-compat combination, and mint/revoke refusal codes

### 5. Comparison (`lib/compare.mjs`)

| Kind | What is compared |
|---|---|
| `status` | HTTP status |
| `body` | Deep compare; key order ignored, array order significant |
| `header:*` | Every header except date and connection ones |
| `header-derived:*` | `etag` and `content-length` |
| `providerCalls` | Method and arguments, including write inputs (buffers as length+sha1) |
| `logEvent` | Endpoint, status, note, and the raw options argument, e.g. `{ skipWitness: true }` |
| `store:<name>` | Every op of that store in order, with arguments (and return value for wrapped real instances) |
| `depCalls` | Dep closures and their arguments |
| `credentialRegistry` | Registry calls |
| `egressFetch` | Outbound fetches |
| `console` | Console output |
| `unhandledRejection` | Unhandled rejections |
| `expressErrorHandler` | Errors that reached the error handler |

Diffs are grouped by (route, kind), each group with an example. Re-run any
request alone with `--only <i> --files <slot>`.

## Report

| Field | Contents |
|---|---|
| `summary` | Totals |
| `files.<slot>.summary` | Per-file totals |
| `files.<slot>.perRoute[route].requests` | Request count |
| `files.<slot>.perRoute[route].oldStatus` / `newStatus` | Status histograms |
| `files.<slot>.perRoute[route].statusLogPairs` | `"<status> \| logEvent <statuses>"` → count |
| `files.<slot>.perRoute[route].tags` | Outcome tags, e.g. rulings `rows>0`, `resolution:withdrawn`, `suggested:answered`, `effect:record`; writes `intent:*`, `deduped`, `onTicketWrite`; token `code:*` and `profile:*` |
| `files.<slot>.thinStatusLogPairs` | Pairs seen fewer than 5 times |
| `files.<slot>.differences[]` | The difference groups |
| `coverage.<side>.<file>` | Line coverage |
| `importSideEffects` | The import census |
| `exportsDiff` | Differences in exported constants and functions |

## Self-check results

`pinned/origin-main`, `--n 3000` per file. The run takes about 62s with 4
jobs. Reports are in `reports/`.

| Check | Mutation | Diffs, seed 1 | Diffs, seed 7 |
|---|---|---|---|
| writes / rulings / tokens-admin identity | none | 0 / 0 / 0 | 0 / 0 / 0 |
| writes.a-status | invalid relation type 400→422 | 12 | 12 |
| writes.b-field | dedupe hit drops `deduped` | 19 | 20 |
| writes.c-write-arg | `updateIssueLabels` order `[new, ...cur]` | 75 | 74 |
| writes.d-store-op | `commentDedupe.set` removed | 64 | 64 |
| rulings.a-status | decisionLoopId miss 404→410 | 104 | 104 |
| rulings.b-field | GET drops `count` | 788 | 780 |
| rulings.c-write-arg | `proposedOutcome: 'answer'` | 56 | 50 |
| rulings.d-store-op | dismissal `sessionsFeedCache.clear` removed | 56 | 59 |
| tokens-admin.a-status | revoke unknown 404→410 | 37 | 65 |
| tokens-admin.b-field | mint drops `providerDisplayName` | 392 | 386 |
| tokens-admin.c-write-arg | default scope `'read'`→`'readWrite'` | 186 | 188 |
| tokens-admin.d-store-op | `listCredentialHealth` removed | 361 | 347 |

Every mutant is detected in its expected kind, with no off-target routes.

### Coverage

V8 precise coverage is converted to lines, as in rung 3.

| File | Seed 1 | Seed 7 |
|---|---|---|
| `proxy-writes.js` | 100% (693/693) | 98.1% |
| `proxy-tokens-admin.js` | 100% (253/253) | 100% |
| `proxy-rulings.js` | 97.46% (230/236) | 97.46% |

The rulings lines left uncovered are 303-305 and 399-401, the `!decisionId`
guards. They cannot be reached through Express, because a `:decisionId` route
parameter is never empty.

### Floor

At seed 1:

- Each write form gets 225 requests, rulings forms get 945-1009, and token
  forms get 451-1021.
- Every (status, logEvent) pair on a real route is hit at least 5 times,
  except one: append `404 | -` (×1), an upper-case path-variant probe.
- The other thin pairs are on unmatched paths.

## Limits

- **The deps are models.** They are transcriptions of the `routes/proxy.js`
  closures and `server.js` middleware at `06ec62b7`, not the code itself.
  - A rebuild that changes the dep contract (new or renamed deps, argument
    order) shows up as diffs, usually TypeError 500s, not as a silent pass.
  - A rebuild that drops a dep from `createProxyRoutes`'s mount is not caught,
    because `proxy.js` itself is not replayed.
- **Lib changes are not compared.** `lib/` and other `routes/` files come from
  the repo checkout. Only files present in the side folders differ.
  - Shared lib state can leak between sides. `pipeline-loops`' warn-once
    malformed-row lines would fire only for whichever side runs first, so they
    are kept out of the comparison (`rec.libConsole`).
- **No real persistence.** No Mongo, real rate limiter, real session store or
  CSRF is involved. These routes have no CSRF middleware at `origin/main`; the
  only CSRF in server.js is on email login. The lean self-heal path of
  `pipeline-loops` is not run, because there is no `historyCollection`.
- **Sequential only.** Requests are sent one at a time, so races are not
  exercised. The dedupe cache persists across requests, which means one real
  difference can cascade into later comment-request diffs.
- **Random and stratified, not exhaustive.**
  - `rulings` and `tokens-admin` are randomly sampled.
  - The `writes` intents guarantee the floor only at `--n` of 3000 or more
    (at least 200 per form).
  - Check `thinStatusLogPairs` and coverage, and add seeds as needed.
- **Normalisation.** Stacks are stripped from console lines and error-handler
  logs. Unmatched paths are compared as Express's own 404 text. HTML pages are
  stubs.
- **Report trimming.** Examples cap arrays at 6 items and strings at 300
  characters. Use `--only` for full detail.
