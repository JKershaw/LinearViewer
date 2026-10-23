# API Quality Review — 2026-10-23

**Task:** LIN-3801 (periodical run, second in the series). **Type:** review-only — no code, docs
(other than this report), config, or secrets changed.
**Pinned HEADs (after a fresh `git fetch` of both repos):**
LinearViewer `b2199c7d` (`origin/main`); simple-dispatcher `e2b4dcc` (`origin/main`, read-only).
**Baseline:** `docs/reviews/api-quality-review-2026-06-25.md` (LIN-665, audited at `d9c51da`),
2,784 commits earlier. The repo's own dominant convention is the reference, as in June: the
`lib/errors.js` envelope `{ error, ...extra }` and its helpers, the proxy status mapping, and the
MAX_* input bounds. No imported ideal is applied.

**Method.** Every `file:line` below was re-read at `b2199c7d`; the research comment's leads on
LIN-3801 were treated as leads, not evidence. Five fresh-context readers each took one layer
(split proxy, new non-proxy routes, grant layer, docs-vs-code contract, runner as caller), and
the decisive claims were re-read at source by the author. Bounding queries are listed under
"Class check".

**Excluded explicitly:** `routes/test.js`. It is mounted only under
`if (process.env.NODE_ENV === 'test')` (`server.js:1101`), so it is not a caller-facing surface.
It holds all 80 of the remaining raw `res.status(4xx|5xx).json` sites.

**Headline.** The convention held through the split. No hand-written error envelopes are left
outside `routes/test.js`, `htmlError` is gone, the capability gate is 503-before-422 at every
site, and the grant layer is enforced by one shared helper with one refusal shape. The two
things that matter are on the machine-caller seam. The dispatch/runner lane turns database faults
into answers a caller must treat as final (class C1, HIGH, new), and non-Linear upstream statuses
still collapse to 500 across the proxy (class C2, HIGH, already ticketed as LIN-2040). No
cross-tenant or exploitable defect was found in the new auth, share and merge routes.

---

## June findings: disposition at `b2199c7d`

| June | Status | Evidence at HEAD | Ticket |
|---|---|---|---|
| H1 OpenRouter callback, no `state` | **Still open, re-rated LOW** | No nonce in `routes/openrouter-auth.js`. PKCE ties the code to the session verifier (`:87-91`, `:158`) and begin is a POST under `sameSite: lax` (`lib/session-options.js:37`). The security review of the same date rates it Low. Residual: a stale verifier is not cleared on failure exits (`:134-180`). | LIN-676 (Backlog) — cited, not re-minted |
| H2 capability gate before availability, writes | **Fixed** | `routes/proxy-writes.js:181` (503) precedes `:185` (422). Every split-file gate checks 503 first (see Design). | LIN-677 Done |
| LIN-938 (H2's read twin, `att:`) | **Fixed in code; ticket stale** | `routes/proxy-reads.js:477-481` checks workspace availability before `denyIfUnsupported('fetchAttachment')`; landed in LIN-3569 `06ec62b7`. | LIN-938 still Backlog — **recommend closing** |
| H3 / M5 / L8 Linear CLI JSON contract | **Moot** | `lib/linear-cli.js` deleted (LIN-580 `fe99566d`). The nearest machine-facing replacement is `SD: harbour-token-mcp-server.js` (JSON-RPC); gaps are LOW (see L11). | LIN-678 Canceled |
| M1 raw `error.message` in bodies | **Still open, class moved** | Class C3 below. | LIN-2288 covers recap/brief only |
| M2 envelope drift | **Fixed** | 0 raw sites outside `routes/test.js` (query below); keepalive sites go through `keepalive.send`/`keepaliveError` (`lib/errors.js:21-38`). | LIN-3460, 3465, 3466 Done |
| M3 `take` not retry-safe | **Still open, now duplicated** | `routes/dispatch.js:1378` and `routes/proxy-runner.js:161`, both over `takeItem`'s `findOneAndDelete` (`lib/dispatch-store.js:911`). Never ticketed in June. | **LIN-3806** (this run) |
| M4 `auth.js` upstream → 500 | **Still open, grown** | `routes/auth.js:189-194`, `:492`, `:504-508`; class C4. | none (report only) |
| L1 keepalive `statusCode` | **Fixed in code, doc half-open** | `lib/http-keepalive.js:95` appends `statusCode` after a flush. `docs/proxy-integration.md:1050,1710,2454` still say "single 200"; `lib/proxy-instructions.js:1166-1168` says 5xx only, though post-flush 404/429/499 also occur. | LIN-2712 (client never reads it) |
| L2 env var names on a public 503 page | **Still open, grown** | `routes/auth.js:62-65,111-114`; also `routes/jira-auth.js:127-131`, `lib/github-install-flow.js:300-306`. | none |
| L3 `workspace-api.js` raw json | **Fixed** | 0 raw sites. | LIN-3460 |
| L4 `/search` ignores `limit` | **Still open** (documented) | `routes/proxy-reads.js:250` `{ first: 50 }`, no `truncated`/`pageInfo`. | none |
| L5 `issueUrl`/`issueIdentifier` skip control-char guard | **Still open** | `CONTROL_CHAR_FIELDS` at `lib/dispatch-validation.js:216` omits them; length-only at `:183,185`. `POST /api/proxy/dispatch` also skips `isValidIssueId` (`lib/dispatch-entrance.js:294`, vs `:176` on the other lanes). | none |
| L6 200 for label add no-op vs added | **Still open** | `routes/proxy-writes.js:718,725,734`; the two bodies also differ in shape. | none |
| L7 recent-prompts GET/POST asymmetry | **Still open** | `routes/dispatch.js:591-592` returns `[]`, `:613-614` returns 503. | none |

---

## Severity-ranked findings

### 🔴 HIGH

#### H1 — Dispatch/runner lane: a store fault is answered as 404, 401 or an empty 200 (class C1)
**Ticketed: LIN-3805 (new).** `lib/dispatch-store.js` catches store errors and returns
`null`/`[]`/`false`; the routes map those to client-meaning answers. simple-dispatcher treats any
4xx other than 408/429 as final (`SD: feedback.js:49-56`) and never reads the body or
`Retry-After`, so a database blip becomes a permanent verdict.

| Member | Site | Caller sees |
|---|---|---|
| `takeItem` | `lib/dispatch-store.js:919-922` | 404 `routes/dispatch.js:1378`, `routes/proxy-runner.js:161` |
| `addFeedback` | `:2730-2732` | 404 `routes/dispatch.js:1444-1446`; post-`$push` steps (`_resolveEdgeDoc`, `addItem`) can throw after the entry is stored |
| `listItems` | `:810-812` | 200 `[]`; the route comment (`routes/dispatch.js:1114-1115`) says this case is a 500 |
| `_archiveItem` | `:1078-1079` | take returns 200 with no history row; every later feedback 404s |
| `getItemStatus` | `:534-535` | 404 on `GET /api/proxy/dispatch/:id/prompt` (`routes/proxy-dispatch.js:688-692`) |
| `removeItem` | `:867-868` | `false` |
| `validateToken` | `lib/dispatch-tokens.js:160-163` | 401 — **LIN-3699** (In Progress, token member only) |

Consequence: a terminal `[done]` post can be dropped as "final", the parent never wakes, and a
poll store fault reads as an empty queue, which hides a halt or outage from `SD: halt.js:32-45`.
LIN-2879 is the same loss seen from the runner side. Fix at the store contract (throw or typed
fault → retryable 503 in the route), not per route.

#### H2 — Non-Linear upstream status is lost and becomes 500 across the proxy (class C2)
**Already ticketed: LIN-2040 (Backlog). Not re-minted; escalated by comment.**
`graphqlErrorStatus` reads only `err.response?.status` (`routes/proxy.js:1152-1153`), but GitHub
and Jira set `err.status` (`lib/providers/github/client.js:54`, `lib/providers/jira/client.js:197,211`).
A real 401/403/404/429 from either provider reaches the agent as a bare 500 with no `retryable`.
`tests/unit/proxy-provider-error-attribution.test.js:128-131` admits it. Catalog impact (added to
LIN-2040): the instructions tell agents the status mapping is uniform. Siblings: LIN-3793
(`classifyUpstreamError`), LIN-1990.

### 🟠 MEDIUM

#### M1 — `take` and terminal feedback are not retry-safe (class C6)
**Ticketed: LIN-3806 (new; builds on LIN-3805).** Re-take by the same claimant after a lost
response answers 404 (`dispatch.js:1378`, `proxy-runner.js:161`) and the item is orphaned (no
release route — LIN-1715). A second terminal feedback is appended because history status stays
`taken` (`lib/dispatch-store.js:2387-2391`). Comment create has a dedupe
(`routes/proxy-writes.js`, `lib/proxy-dedupe.js`) — the pattern to copy. Other members of C6 not
promoted: `account-merge` confirm (M6), flight-companion approve-follow-up (no idempotency key),
relation create (`proxy-writes.js:675`, no dedupe), custom-prompt cap (`lib/custom-prompts-store.js`, check not atomic).

#### M2 — The write contract in the agent catalog is false in four places (class C5)
**Ticketed: LIN-3807 (new; links LIN-2048, LIN-2390, LIN-2816).**
* Create is documented as refusing unsupported fields with 400, "never silently dropped"
  (`lib/proxy-instructions.js:702`, `docs/proxy-integration.md:1942`), but non-UUID
  `assigneeId`/`parentId`/`cycleId` and invalid `priority` are skipped on a 201 and unknown keys
  ignored (`routes/proxy-writes.js:283,335-341`); `tests/unit/proxy-create-write-contract.test.js:165` pins the drop.
* PATCH: an all-unknown body is 400 "No valid fields to update" (`proxy-writes.js:399-400`) but a
  mixed body is 200 with the unknown key ignored. (Reproduced live in the research session:
  `{"state":"In Progress"}` → 400.)
* Jira is missing from both compatibility lists: create → 422, PATCH `projectId`/`parentId:null` →
  422, `priority` dropped (`lib/providers/jira/index.js:1123-1139`).
* The periodical-gate 409s (`PERIODICAL_REPORT_NOT_PERSISTED`,
  `PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED`; emitted at `proxy-writes.js:363-381`, defined at
  `lib/periodical-report-gate.js:123,137`) are undocumented; the status table's only write-endpoint
  409 is "trashed issue" (`lib/proxy-instructions.js:1090`).

Provider-neutrality decision: the create/PATCH asymmetry is a contract gap a caller can hit (it
did hit the research run), so the recommendation is to make PATCH refuse like create, not to
document the drop. Other C5 members, report only: LIN-2816 (catalog advertises gated reads
regardless of provider; `buildInstructions` takes no capability input, `:36`); labels `teamId` "ignored" on Jira
but 404 `TEAM_NOT_FOUND` (`proxy-reads.js:126-129`); undocumented `/issues/:id/prompt/:templateKey`
(`proxy-compute.js:277`) and `/snapshots[/diff]` (`:566,:599`); relative `GET /issue/{id}` cited but
absent (`proxy-instructions.js:163,195,720,755`); `blocked-by` relation accepted but undocumented
(`proxy-writes.js:57`); runner poll `halt` and exchange `grants` keys not in documented shapes;
"dispatchId from /api/dispatch/take" stale (`:779`); `docs/architecture/dispatch-and-proxy.md:36`
says proxy halt is "not yet covered (LIN-3409)" against `proxy-halt.js:10,122`, and `:70` says reads
go through the Linear provider; the TTL attribution at `proxy-instructions.js:1010-1012` names
`WORKING_TOKEN_TTL_SECONDS` for the bootstraps (`BOOTSTRAP_TOKEN_TTL_SECONDS` is used,
`lib/proxy-preamble.js:568`; both 48h today, latent). **No test compares the catalog to the
routes** for endpoints, capabilities, the PATCH drop table, Jira, or the error-code vocabulary.

#### M3 — Raw `error.message` / upstream text reaches a client body (class C3)
Partially ticketed (LIN-2288: recap/brief). Members with `file:line` are in the class check. A
sub-class picks the HTTP status by regex on the message text. Report only.

#### M4 — Upstream failure answered as 500 or 400 outside the proxy (class C4; June M4 grown)
Report only. Members in the class check. Auth, OAuth and session pages treat an upstream outage as
an application error, so callers see no `retryable` and no 502/503.

#### M5 — Rate limiting is per IP and per process, shared by every session on a host
`proxyLimiter` is 60/min on the express-rate-limit memory store (`routes/proxy.js:236-243`);
`feedbackLimiter` is 100/min per IP (`routes/dispatch.js:78-87`). The broker and every agent on one
host share one budget, the docs say only "60 requests per minute" and do not document
`Retry-After`/`RateLimit-*`, and the runner and broker ignore `Retry-After`
(`SD: harbour-token-mcp-server.js:285`). The runner's terminal retry window is about 7s against a 60s
limit window, while the hook bursts recap/tool/usage/marker posts just before `[done]`
(`SD: hook.js:2120-2129`, `SD: config.js:1157-1169`). No limiter at all on dispatch-token
`GET /api/dispatch/poll` (`routes/dispatch.js:1121`), `POST /api/dispatch/take/:itemId` (`:1365`),
`POST /api/dispatch/broker-token` (`:1195`), or `GET /api/proxy/instructions` (`proxy.js:1297`); tokens-admin
GET/DELETE are unlimited. LIN-2555 is adjacent. Production keying is **unbounded** — see Class check.

#### M6 — Account merge is not fully retry-safe, and refusals answer 500
`routes/account-merge.js:111-221`: a throw after the merge lets a resubmit re-run the bind and
convert steps; a crash inside `mergeAccounts` after `mergedInto` but before the rebind makes later
retries short-circuit as `alreadyMerged` (`lib/account-store.js:251-268`). The six merge refusals
return 500, not 409 (`account-merge.js:119`). Confidence: medium (no failure injected). Otherwise
the route is sound: it reads nothing from the body and re-checks both identities at confirm (`:98-100`).

#### M7 — Broker and token-exchange refusals collapse retryable and final
Harbour's retryable 503s ("…; retry", `routes/dispatch.js:1240,1312`) and `retryable:false` 403s are
mapped by the runner to `http-<status>`, tried once, then a token-less launch
(`SD: feedback.js:214-216`). The token exchange returns one 401 `PROXY_TOKEN_INVALID` for spent,
expired, unknown and owner-recheck failure (`routes/proxy-token-exchange.js:55`) while data
endpoints expose `bootstrap_only`/`expired`. The broker's own errors are text/plain and Harbour's
are JSON; the instructions tell agents to tell the broker's 403 from Harbour's by body
(`lib/proxy-instructions.js:1085-1088`), but the broker's 404/500/502 rows (`:1136-1138`) name no
content type; a spent-bootstrap 401 and a transient 429/500 both become the same 502; the broker uses bare `fetch`
with no timeout (`SD: harbour-token-mcp-server.js:102,240`). Mostly on the caller side (read-only
repo), so report only.

### 🟡 LOW
* **L1 (June H1, re-rated)** OpenRouter callback has no `state` — LIN-676.
* **L2 (June L2, grown)** env var names on public 503 pages (`auth.js`, `jira-auth.js`, `github-install-flow.js`) — see disposition.
* **L3 (June L4)** `/search` fixed at 50 (`proxy-reads.js:250`).
* **L4 (June L5)** control-char guard gaps on `issueUrl`/`issueIdentifier`; `POST /dispatch` skips `isValidIssueId`.
* **L5 (June L6)** label add: 200 for both no-op and added, differing shapes.
* **L6 (June L7)** recent-prompts GET `[]` vs POST 503.
* **L7** `workspaceFromUrl` returns an **HTML** 404 to `/api/` callers when the workspace is not in the session (`server.js:2469-2471`), although its own 400/401 arms branch on `/api/` (`:2449,2459`). Affects every `/workspace/:urlKey/api/*` route; `public/common.js:815` tolerates it.
* **L8** `proxy-flight-companion.js`: no capability gate and no upstream mapping — every failure is 500 (`:344`); its 429 body has no `error` key (`:312-328`).
* **L9** The scope 403 is a bare `{error}` with no `code` (`routes/proxy.js:614-619`) while the grant 403s carry `code`/`category`/`retryable` — two 403 shapes on one chain (documented at `docs/proxy-integration.md:135`).
* **L10** Store-missing/auth-store faults answer 500 where dispatch and recap answer 503: `proxy-halt.js:136,165`; `authenticateProxyToken` `proxy.js:608`.
* **L11** `harbour-token-mcp-server.js` JSON-RPC gaps (no -32700, batches dropped) — caller repo, informational.
* **L12** Input bounds: `?limit=abc` on tokens-admin `/events` passes `NaN` to the store (`proxy-tokens-admin.js:419`); `GET /dispatch?status=<unknown>` is 200 `[]` not 400 (`proxy-dispatch.js:381-387`); `/teams|projects|labels|cycles|states|heartbeats` are unbounded; unbounded share `source` (`task-share.js:299`), follow-up `prompt`/`sessionId` (`flight-companion.js:833-841`), custom-prompt `template` (`lib/custom-prompts-store.js:80`), roadmap `generate` `northStar` (`workspace-api-roadmap.js:604`, PUT caps it at `:105`).
* **L13** Roadmap chat spends a free-tier unit before validating the request (`workspace-api-roadmap.js:803` vs `:809-817`).
* **L14** `jira-auth` clears `state` only on success (`:724,791`), and every provider shares one `req.session.oauthState` slot.
* **L15** Custom prompt create returns 200, not 201; delete swallows DB errors as 404 (`lib/custom-prompts-store.js:136-142`).
* **L16** Dispatch limits (issues 50/250, stack 5/50, dispatch 20/100 at `proxy-dispatch.js:373`, agent/status 20/100, alarms 200/1000, credential-trail 50/100); the `/dispatch` clamp and its top-level `truncated` are not in the catalog.
* **L17** `proxy-compute.js` re-implements resolve→503→422 inline in 8 handlers (`:233,279,351,1038,1186,1323,1470`) instead of `providerRead`. Ordering is correct; this is duplication, not a defect, and belongs to code-quality.
* **L18** Runner mismatches judged low or uncertain: wake withdrawal reported as `{success:true}` (`lib/dispatch-store.js:2562-2569`; medium confidence); control characters in feedback `message` → final 400 (`lib/dispatch-feedback-validation.js:21,58`; the runner never strips, `SD: feedback.js:97-101`; frequency unknown).
* **L19** Dispatch-token auth 401s are bare `{error}` with no `code`/`retryable` (LIN-3699 covers the retryable half).

---

## Dimension verdicts

| Dimension | Verdict |
|---|---|
| **Design consistency** | **Good, with one structural caveat.** The split proxy shares one closure of helpers (`proxyLimiter :236`, `requireWriteScope :614`, `resolveProviderAccess :683`, `denyIfUnsupported :808`, `workspaceUnavailable :1039`, `graphqlErrorStatus :1148`, injected at `:1277-1611`). Capability-gate ordering is 503-before-422 at every site (reads `:113→:116`, `att:` `:477-481`, writes `:181→:185`, compute 8 sites, strict lanes `dispatch-entrance.js:840-846`). Divergences are L8, L10, L17. |
| **Input validation** | **Good.** Scope, grant and workspace checks precede mutation on every route read; MAX_* bounds are shared (`lib/issue-write-validation.js`) with two copies that have not drifted (`lib/dispatch-validation.js:20-27`, `proxy-dispatch.js:24`). Gaps are LOW (L4, L12). The write-field silent-drop is a validation *and* contract gap (M2). |
| **Error handling** | **Weak on one seam.** The envelope is uniform and no stack traces leak; `lib/async-errors.js` (installed `server.js:14-17`) routes a rejected async handler to a generic 500, lowering several findings. But store faults are collapsed into client answers (H1), provider statuses are lost (H2), and raw messages / 500-for-upstream remain (M3, M4). |
| **Contract robustness** | **Weak.** Idempotency exists for comment create only (M1); the catalog is not tied to the code and has no parity test (M2); rate limits and retry hints are under-documented (M5). |

---

## Class check

Where a finding names a class, the bound and every known instance:

* **C1 — store fault → client-meaning answer (dispatch/runner lane).** Bound: every `catch` in
  `lib/dispatch-store.js` that returns `null|[]|false`, `lib/dispatch-tokens.js`, and the route-side
  null→status mapping. Members: H1 table. Internal, not caller-visible as status:
  `dispatch-store.js:556,1319,1403,1515,1576,2816,2881,2978`. Out-of-class sibling:
  `custom-prompts-store.js:136-142`. Would be wrong if a route layer distinguished these nulls by
  another signal; `routes/dispatch.js:1378,1444` and `routes/proxy-runner.js:161` do not.
* **C2 — non-Linear upstream status lost → 500.** Bound: callers of `graphqlErrorStatus(`
  (`grep` count at HEAD: 14 matches in `routes/*.js`, including the definition). Witness: the test
  admission cited in H2. Owned by LIN-2040.
* **C3 — raw message / upstream text in a body.** Bound: `(error|err|e).message` across
  `routes/*.js` and `lib/github-install-flow.js`, minus `console.*` lines and messages the code wrote
  itself. Members: `proxy-compute.js:1176,1460` (LIN-2288); the OpenRouter `detail` path
  (`proxy.js:1537`; `proxy-compute.js:1164,1288,1304,1448,1571,1587`; raw upstream body via
  `lib/openrouter.js:1096`); `proxy.js:1269` (`partialWriteFailed` passes `err.cause.message`);
  `workspace-api.js:181-182` (`failureOf`, 17 call sites) plus `:1152,2035,2826,3535,3709,3768` and the
  SSE at `:1231`; `workspace-api-prompts.js:79,107`; `dispatch.js:1052,1083`; `collective.js:492`;
  `lib/github-install-flow.js:755,1132,1143` (via `githubErrorDiagnostic`, `lib/errors.js:383-387`).
  Status-by-regex sub-class: `dispatch.js:224`, `collective.js:489`, `workspace-api-prompts.js:78,106`,
  `workspace-api.js:180`, `proxy-compute.js:330,458,1159`, `proxy.js:1533`.
* **C4 — upstream failure → 500/400 outside the proxy.** Bound: the catch arms of the auth, OAuth
  and session-page routes. Members: `auth.js:189-194,492,504-508`; `github-install-flow.js:572,728`
  (500) and `:440,451` (400); `jira-auth.js:457-462` (500), `:284-289` (400); `openrouter-auth.js:153-212`
  (500), `:171` (400); `workspace-api-roadmap.js:631-637`; `task-edit.js:149-155`;
  `proxy-flight-companion.js:344`; `dispatch-entrance.js:636-640` (POST `/dispatch` falls back to 500).
* **C5 — catalog ≠ code.** Bound: endpoint diff (clean: every advertised path exists) plus
  write-contract claims plus error-code vocabulary. Members: M2 list. Undocumented codes:
  `RULING_NOT_FOUND`/`OPTION_NOT_FOUND`/`NO_OPTIONS_AVAILABLE` (`proxy-rulings.js:137,143,284`), the
  two periodical 409s, and the `WORKSPACE_UNAVAILABLE` fallback (`lib/errors.js:534`). Root seam: LIN-2048.
* **C6 — retry / double-submit safety on mutating routes.** Bound: *routes that mutate on POST and are
  documented or used as retryable* — this is a **walk, not a grep**, so completeness is by reading,
  not by query. Members: M1 list plus account-merge confirm (M6).
* **Grant layer (checked, no finding).** `requireGrant` (`lib/require-grant.js:44-62`, over
  `hasGrant` `lib/proxy-scopes.js:40`) has these `requireGrant(` mounts: `proxy-dispatch.js:315`
  and `:356`, `proxy-kickoff.js:103`, `proxy-runner.js:83` (path gate over poll/take/feedback/heartbeat),
  `proxy-runner-prompt.js:40`. The documented abort, cascade and follow-up enqueues ride on
  `POST /dispatch`. The refusal is uniform: `{error, code: DISPATCH_GRANT_REQUIRED|TAKE_GRANT_REQUIRED,
  category:'auth', retryable:false}`. Runner routes check `take` but not write scope — unreachable
  today because runner copies are always readWrite. Token lifetimes in the catalog match the code
  (48h/90d/1h/24h); the attribution slip is in M2. The second runner lane over the same queue
  (`/api/dispatch/*`, 90-day dispatch tokens) is outside the grant system by design; M5/L19 apply.
* **Unbounded: production rate-limit keying** (`trust proxy 1` vs the real reverse proxy). Shape (b):
  the population is a deployment fact, not source, so no sweep can bound it. Reported as unbounded.

**Queries re-run at `b2199c7d`:**
`grep -nE "res\.status\((4|5)[0-9]{2}\)\.json" routes/*.js | grep -v routes/test.js` → **0**; same
grep on `routes/test.js` → **80** (matches the research). `requireGrant(` walk as above.
`graphqlErrorStatus(` → 14 matches. Store catch sites re-read at the lines cited in H1.

---

## Seams with sibling periodicals

* **security-review-2026-10-23:** owns exploitability. H1-June is its Low; it covers urlKey
  uniqueness (LIN-3394), relevant to task-share's urlKey-scoped revoke. Nothing here re-files its items.
  `account-merge`, `task-share` and `email-auth` were read for contract defects: task-share is
  owner-gated (`:280-285`), rejects a malformed token before any read (`:142`) and returns one 404
  for unknown/revoked/owner-changed; `email-auth` uses nonces, a Sec-Fetch-Site check and an atomic consume.
* **integration-surface-maturity-2026-10-21:** the periodical gate is on PATCH only
  (`proxy-writes.js:374`); create is ungated (its finding). Here only the 409's absence from the
  catalog is recorded (M2).
* **test-coverage-gap-2026-10-23:** `require-grant`, `proxy-scopes` and `proxy-token-exchange` are at
  full coverage; `proxy-fetch` is uncovered (its C5). The absence of any catalog-vs-code parity test
  falls between the two reports and is claimed here (M2).
* **seams-tangles-2026-10-20 / code-quality-2026-10-20:** structural only; no overlap. L17 is handed to code-quality.

## Scope limits (not checked)
`routes/dashboard.js` (3,072 lines) beyond the envelope count (session-authed; envelope-only in
June); `routes/task-chat.js` and `routes/collective.js` behaviour beyond the error grep; whether
task-chat outside a run scope can enqueue (`task-chat.js:625`, uncertain); whether any Harbour job
re-wakes a parent after a lost terminal post. M6 and L18 were read, not failure-injected.

## Follow-ups minted (top-3 by severity; none duplicated)
Searched Linear for an existing ticket before each mint; none named these findings.

| Ticket | Finding | Links |
|---|---|---|
| **LIN-3805** | H1 — dispatch/runner store fault → retryable 503 (class C1) | LIN-3699, LIN-2879 |
| **LIN-3806** | M1 — take and terminal feedback retry safety (class C6). Separate from LIN-3805: C1 changes the store's fault contract, C6 changes success-path semantics, and merging them would hide the 404-vs-409 decision. | LIN-1715, LIN-3805 |
| **LIN-3807** | M2 — create/PATCH refuse unknown or malformed fields; Jira in compat lists; document periodical 409s (class C5) | LIN-2048, LIN-2390, LIN-2816 |

Not minted (cited): H2 → LIN-2040; June H1 → LIN-676; token member of C1 → LIN-3699; recap/brief
C3 → LIN-2288.

**Housekeeping:** LIN-938 is fixed in code by LIN-3569 `06ec62b7` (`routes/proxy-reads.js:477-481`);
recommended for closure with that citation. Comments posted on LIN-2040 (catalog impact, escalation)
and LIN-3699 (the C1 sibling list, so its fix does not stop at `validateToken`).

## Adversarial Second-Read

**Tier used:** Tier 2 (fresh-context sub-agent with no memory of the report-writing turn; Tier 1 is not available inside this runner). It was given only the report path and the question, not the research or the ranking.

**Question:** What is the largest item in this window that this report missed or misfiled?

**Reader's answer (in full):**
> I found no defect larger than the report's top item. The largest thing it misfiled is a process gap, not a code finding, and I haven't verified the other candidates below.
>
> Top finding (H1, store fault answered as a final 404): I agree it is the right top rank. `takeItem` catches any database error and returns `null` (`lib/dispatch-store.js:919-922`). `routes/dispatch.js:1378` turns that `null` into `notFound.json(res, 'Item not found or already taken')`, the same 404 the route sends for a claim that was genuinely lost. The caller treats every 4xx except 408 and 429 as terminal (`simple-dispatcher/feedback.js:49-56`), so a transient fault on `take` becomes a permanent verdict. `validateToken` has the same shape (`lib/dispatch-tokens.js:160-163`, tied to LIN-3699). I did not re-read the `addFeedback` and `listItems` rows, so I only partly confirm that H1 table.
>
> What it missed or misfiled: (1) The report was unfinished: the Adversarial Second-Read section was a placeholder, and the "no cross-tenant or exploitable defect" claim had had no adversarial pass. (2) Rate limiting (M5) looks under-rated, but I only checked part of it: `take`, `poll` and `broker-token` have no limiter while the sibling `heartbeat` and `feedback` routes do; I did not check the production keying claim (`trust proxy` is 1 at `server.js:1057`). (3) `routes/dashboard.js` (about 3,000 lines of session-authenticated routes) was not audited, as the report's own scope limits admit. (4) The C1 "internal" list (`dispatch-store.js:1319`, `:1403`, `:1515`, `:1576`) is probably fine: the run-count read reports `runsUsed: null`/`remaining: 0` deliberately (`free-tier-store.js:271-283`) and the duplicate-dispatch guard fails open by design (`dispatch-factory.js:229`).
>
> Verified accurate: `workspaceFromUrl` HTML 404 to API callers (`server.js:2469-2471`); `routes/test.js` mounted only under `NODE_ENV === 'test'` (`server.js:1101`).

**Author's handling.** Point (1) is resolved by this section. Points (2) and (3) are already in the report (M5 names exactly the three unlimited dispatch-token routes and states that production keying is unbounded; `dashboard.js` is under "Scope limits"). Point (4) agrees with the report's classification. Nothing in the answer changes a ranking or a follow-up.

Adversarial second-read verdict: AGREE
Differed from top finding: NO
Disposition: no change
