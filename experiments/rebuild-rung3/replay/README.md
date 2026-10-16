# proxy-reads behavioural replay

This tool checks that two versions of Harbour's `routes/proxy-reads.js`
(`createReadRoutes`, the GET `/api/proxy/*` read surface) behave the same.
It sends both versions an identical seeded stream of requests, gives them the
same fake world, and compares what each one does. It needs no network beyond
loopback and makes no real calls to Linear, Jira, GitHub, OpenRouter or Harbour.

```
node replay.mjs <oldRoutesFile> <newRoutesFile> [--seed 1] [--n 3000] [--out report.json]
node replay.mjs --self-check [baseRoutesFile] [--seed 1] [--n 3000] [--out selfcheck.json]

other flags:
  --repo <dir>        repo whose lib/ and node_modules/ both copies share (default /home/user/LinearViewer)
  --only <i>          replay just request i, with full old/new detail in report.onlyDetail
  --timeout-ms <ms>   per-request timeout (default 3000)
  --keep-work         keep the private work dir (work/run-<pid>/{old,new}/proxy-reads.mjs)
  --quiet             no progress or unattributed console output on stderr
```

A pinned baseline copy:
`git -C /home/user/LinearViewer show origin/main:routes/proxy-reads.js > pinned/proxy-reads.origin-main.js`.
`pinned/` already holds the copy from `c2bc9a65`.

Exit codes: `0` means the run finished, whatever diffs it found. `3` means an
import or factory failure. In self-check mode, `1` means a check failed.

## What it does

1. **Copies.** Each file is copied to `work/run-<pid>/{old,new}/proxy-reads.mjs`.
   Relative imports (`'../lib/x.js'`) are rewritten to absolute `file:` URLs
   inside the repo. A module-resolution hook (`lib/hooks.mjs`) resolves the rest
   (`express`) as if the copy sat at `<repo>/routes/`. Both copies therefore
   share one instance of every lib module and of express.
   **Import census** (`report.importSideEffects`), per copy:
   - env vars read
   - new globals
   - new active handles or timers
   - console output
   - socket attempts
   - which modules the import loaded for the first time
   - the rewrites made, and the specifiers that needed the hook

   At `c2bc9a65` the import has no side effects. It loads 12 lib modules plus
   `node:crypto` and `node:https`.
2. **Fake deps.** These live in `lib/fakes.mjs`. They mirror the real closures
   in `routes/proxy.js` and are shaped after `tests/unit/lib/proxy-fake-deps.js`:
   - `authenticateProxyToken`: real header checks and 401 envelopes. It covers
     rejected tokens with and without a descriptor, and auth-store throws. On
     success it sets `proxyTokenId/UrlKey/Label/Scope/CreatedBy/Grants/WorkspaceId`.
   - `resolveProviderAccess`: stamps `resolvedCredentialFingerprint/ExpiresAt/Source`
     only when there is a token, and always stamps `resolvedProvider`. It applies
     the `scope ?? token` substitution and can throw.
   - `denyIfUnsupported` and `workspaceUnavailable`: the real logic, using the
     real `workspaceUnavailableEnvelope`.
   - `logEvent`: the real stage/witness/suspect logic, writing to `proxyEventStore.recordEvent`.
   - `graphqlErrorStatus`: the real mapping, including the 401→503 transient
     rule. The registry state (suspect, past-threshold, superseded) varies.
   - `proxyEventStore`: an in-memory Proxy that records every method call.
   - `proxyLimiter`: passes requests through, but each call is recorded.
   - **Egress:** the attachment relay's fetch goes to a seeded fake. It is wired
     in through `setProxyFetchImpl` and, on 20% of attachment requests, through
     `globalThis.fetch`.
   - **Hermetic and deterministic:** proxy env vars are scrubbed and any
     non-loopback `net.Socket.connect` is blocked and counted. `Date` is frozen
     at `2026-10-01T12:00:00Z`, and `Math.random` is seeded per request.
3. **Requests.** Each version is mounted on its own express app at
   `127.0.0.1:0`. The generator is `lib/gen.mjs`. Request `i` takes its PRNG
   stream from `(seed, i)`, so `--only i` reproduces it alone. Requests are sent
   one at a time: old, then new. The scenario is plain data, and each app builds
   it fresh, so in-place mutation by `flattenIssue` cannot leak between apps.

   | Area | What varies |
   |---|---|
   | Endpoints | all 14, including both aliases, unmatched paths, trailing-slash and upper-case path variants, and 2% HEAD requests |
   | IDs | UUIDs, `LIN-12`, `#55`, length 100 and 101, unicode, `%2F`, `%E0%A4%A` (bad encoding), `..`, NUL |
   | Query params | every one a handler reads (`teamId`, `limit`, `after`, `cursor`, `q`, `windowMs`, `source`), with edge values, arrays, `x[a]` objects and unknown params |
   | Provider results | empty, large (120 issues, 300 teams), null or missing fields, unicode, trashed and archived items, `truncated`-flagged team arrays, comments with bad dates, markdown upload links, missing or non-array `pageInfo`/`nodes` |
   | Provider errors | GraphQL 401/403/404/429/500, `statusCode`-only, `userError`, status-only, Timeout, Abort, network, `TeamNotFoundError`, `NotImplementedError`, a thrown string, a thrown null |
   | Provider shape | unsupported capabilities, missing methods, null provider |
   | Attachments | `md:`/`att:`/garbage handles; allowed, disallowed and malformed hosts; name hints; upstream status, content-type and content-length; oversized bodies; redirect and network throws |

4. **Comparison.** For each request it compares status and body (deep compare
   that ignores object key order; array order counts). It compares every header
   except `date/connection/keep-alive/transfer-encoding`. `etag` and
   `content-length` are reported separately as `header-derived:*`, because they
   follow from the body. It also compares these recorded sequences:

   | Kind | What is recorded |
   |---|---|
   | `providerCalls` | method and arguments, including `supports()` |
   | `logEvent` | endpoint, status, note |
   | `eventStore` | every `proxyEventStore` call with its arguments |
   | `depCalls` | `resolveProviderAccess` arguments, `denyIfUnsupported`, `workspaceUnavailable`, `graphqlErrorStatus` input and output, limiter |
   | `egressFetch` | URL and options |
   | `credentialRegistry` | registry calls |
   | `console` | console output |
   | `unhandledRejection` | unhandled rejections |
   | `expressErrorHandler` | errors that reached the Express error handler |

   Differences are grouped by `(endpoint pattern, kind)`. Each group gets a
   count, its first 25 request indexes, the body-path patterns involved, and one
   example: the request, the trimmed scenario, the difference, and the old and
   new outcomes.

## Reading the report

`report.json` contains these sections:

| Section | Contents |
|---|---|
| `summary` | request count, differing requests, number of groups, elapsed time, socket escapes |
| `perEndpoint` | request count and status histogram for each side |
| `differences[]` | the groups, largest first |
| `coverage` | line coverage of each copy |
| `importSideEffects` | the import census, per copy |

A rewrite that is meant to be behaviour-preserving should show
`differingRequests: 0`. When it doesn't, each group points at one cause.
Re-run that request with `--only <requestIndex>` to see everything.

## Self-check (`--self-check`)

Self-check runs child replays and checks two things:

- A file against itself shows 0 diffs.
- Each of four planted mutants is detected, and only on the endpoint it touches.

| Check | Mutation | Diffs seen (seed 1, n 3000) |
|---|---|---|
| identity | none | 0 |
| a-status | cycle detail not-found 404 → 410 | 20 (status, both aliases) |
| b-field | `/teams` drops `truncated` | 78 (body, plus 1 status where `fetchTeams` returns null) |
| c-provider-arg | `/search` `first: 50 → 49` | 89 (providerCalls) |
| d-logEvent | `/me` success `logEvent` removed | 94 (logEvent, eventStore, credentialRegistry) |

All five checks also pass with seed 7. Each full run of 3000 requests takes
about 7 seconds, and a whole self-check about 40 seconds.

**Coverage.** V8 precise block coverage is taken in-process through
`node:inspector`, so c8 is not needed. It is converted to lines with
v8-to-istanbul semantics: a line's count is that of the innermost range that
contains the whole line, and comment-only lines are not executable. At n=3000,
seeds 1 and 7, the result is **100% (448/448 lines)**.

Line 767 is reported as partially executed. Its `|| 'attachment'` fallback
cannot be reached, because `replace` never empties a non-empty string.

## Behaviour of the current code that the replay pins

On `GET /api/proxy/attachments/att:…`, the code awaits `resolveProviderAccess`
outside any try/catch. If that call throws, or the provider is null, the result
is an unhandled rejection and **no response**. Seed 1 shows this 14 times, as
`status: "NO_RESPONSE"` with `unhandledRejection` recorded. The harness destroys
the socket so the run keeps moving. A real server would hang until the client
times out.

## Limits

- **The deps are models.** They are transcriptions of the closures in
  `routes/proxy.js` at `c2bc9a65`, not the closures themselves. The real
  `resolveWorkspaceAccess`, registry and Mongo are never run.
  - A rewrite that changes the **dep contract** will not be adapted to. That
    includes new or renamed deps, a different argument order, or relying on
    another dep's side effects. Such a change shows up as diffs, usually
    TypeError 500s, not as a silent pass.
  - Only this one file is compared. `lib/` is shared from the repo checkout,
    so changes to lib modules are not compared.
- **The search is random, not exhaustive.** Rare branches depend on `--n` and
  the seed. Use the coverage list to confirm reach, and rerun with more seeds
  or a larger n.
- **No concurrency.** Requests are sequential and the limiter is a
  pass-through, so races, rate limiting and cross-request state are not
  exercised.
- **Errors are normalized.**
  - Express's `finalhandler` is replaced by a uniform JSON error handler, so
    stack-bearing HTML pages, which differ by path, don't show up as noise.
  - Express's own 404 HTML for unmatched paths is compared as text.
  - Thrown errors are compared by name and message, not by stack.
- **Coverage is approximate.** The comment stripper is approximate (strings,
  templates, regex literals). Coverage is line-level only, with no branch
  percentage, though partially executed lines are listed.
- **Reports are trimmed.** Example payloads cap arrays at 6 items and strings
  at 300 characters. Use `--only` for full detail.
