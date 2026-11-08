Scope: the Dispatch API and the proxy consumer integration. Moved verbatim from CLAUDE.md (LIN-2896).

## Dispatch API

The Dispatch feature allows users to queue prompts for external consumers (AI agents, automation tools).

The five enqueue handlers (`POST /workspace/:urlKey/api/dispatch`, `POST /api/proxy/dispatch`, `POST /api/proxy/recommend-and-dispatch`, `POST /api/proxy/autopilot/kickoff`, and `POST /api/proxy/periodicals/:id/mint` (LIN-4313)) are thin forwarders: the decisions they share (body checks and their order, the issue credential, the proxy-context policy, the free-tier run gate, the one `createDispatchItem` call, the 201, the failure mapping) are made once in `lib/dispatch-entrance.js` (LIN-3604). The route files keep the registrations and middleware chains, including `requireGrant('dispatch')`, and the session route passes its owner gate in.

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/dispatch` - Queue a prompt
- `GET /workspace/:urlKey/api/dispatch` - List queued items
- `GET /workspace/:urlKey/api/dispatch/preview?promptName=&kind=&presetId=&model=&harness=&effort=&surface=` - LIN-3833: the setting a run would stamp, read-only and owner-only (`PREVIEW_OWNER_ONLY`). It runs the same resolution `createDispatchItem` uses (`resolveRoutingWithSources`, lib/dispatch-factory.js) and answers the values plus, per field, the source: `explicit`, `preset`, `anchor`, `job`, `group`, `default`, `fallback` or `none`. `surface` (`home`/`swipe`) takes the opened-task default: a blank harness settles to the table's harness, else `claude-code`, and model and effort are read against it. Without `surface` (the proxy lanes, the close-out presses, the dispatch page) the table still never reads a model across the harness its own rows state (LIN-3966).
- `DELETE /workspace/:urlKey/api/dispatch/:itemId` - Remove item. **Owner-only** for a runner row (LIN-3398): the row is read first for its `target`; `dash`/`local` rows stay member-reachable
- `PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim` - Graceful trim (LIN-2147; **owner-only** for a runner row, LIN-3398, with the same row-first `target` rule as delete): amend a live run's `maxTasks` bound downward. Body `{ maxTasks }` (positive integer, strictly less than the run's current bound — 409 otherwise). Invents no new termination path: the existing `maxTasks`/`countDistinctTasksForSession` guard (LIN-1751, `lib/dispatch-factory.js`) already refuses a genuinely NEW task past the bound while admitting a dispatch for a task already inside it (`alreadyCounted`) regardless of count — so lowering the bound here is sufficient on its own to make a run wind down (finish the current ticket, refuse the next new one) without interrupting any beat already in progress. Idempotent (an absolute set, not a relative decrement) and auditable (`by`/`at`/`maxTasks` appended to the run's own `trimHistory`, readable via `getItemStatus`). Distinct from abort (LIN-553/743): abort is a hard stop mid-work; trim is "finish what you're on, start nothing new."
- Token management at `/workspace/:urlKey/api/dispatch/tokens` — minting is **owner-only**
  (LIN-3137): a non-owner gets `403 GRANT_OWNER_ONLY`, an ownerless workspace
  `409 WORKSPACE_OWNER_UNSET`; listing is unchanged. Revoking
  (`DELETE …/dispatch/tokens/:tokenId`) is owner-only too since LIN-3398 (`403 RUNNER_OWNER_ONLY`):
  a dispatch token is a take path, so disconnecting it is a runner action
- **Acting on a runner is owner-only** (LIN-3383 enqueue; widened by LIN-3398, `lib/runner-owner-gate.js`):
  for a runner-consumed target (`cli`, `web`; an absent target is `cli`) only the workspace's owner can
  enqueue, halt/resume, delete a queued item, trim a run or revoke a dispatch token from a session. A non-owner gets `403 RUNNER_OWNER_ONLY` ("Only this workspace's
  owner can act on its runner."); an ownerless workspace `409 WORKSPACE_OWNER_UNSET`; a
  session with no account `503 GRANT_OWNERLESS`; an absent/failing owner seam `503
  OWNER_CHECK_UNAVAILABLE` (fail closed). `dash`/`local` are unchanged. The one hoisted
  `workspaceOwnerCheck` is the only owner source (`role:'owner'` edge); the gate is a call at each
  session-side entry, not inside `createDispatchItem` (which also serves token-scoped proxy and
  orchestrator callers). Every refusal is answered by `sendRunnerRefusal` where the route has a plain JSON error shape. Session mutations gated by LIN-3398 (all before any store write): `POST`/`DELETE …/dispatch/halt`, `DELETE …/dispatch/:itemId`, `PATCH …/dispatch/:sessionId/trim` (delete and trim read the row first for its `target`; the 403 never echoes it) and `DELETE …/dispatch/tokens/:tokenId`. Gated enqueue entries: `POST /api/dispatch` (fresh, follow-up, abort and cascade
  abort), both feedback lanes (the issue still files; the lane returns `launched:false` + code),
  run-proposal Apply (checked before the CAS claim), Flight Companion approve (a not-owner is `422`,
  because the client reads a `403` there as flag-off) and reply, Task Chat's execute-mode
  `send_follow_up`, and Collective (per participant workspace: an unowned seat is `ok:false`). The
  proxy routes stay `requireGrant('dispatch')`-scoped. `tests/unit/lin-3383-runner-enqueue-census.test.js`
  re-scans `routes/`, `lib/` and `server.js` and fails on any unlisted sink kind, and `tests/unit/dispatch-entrance-session-owner-sweep.test.js` calls every session route as a non-owner and fails on an unlisted route. Residual: an invitee
  who owns a workspace with their own runner can still start a no-`stopAt` run that merges without
  the press (stated in the close-out box line and `docs/v1.md` step 7). The proxy-side halt and runner-credential
  revoke are not yet covered (LIN-3409).
- `POST /workspace/:urlKey/api/dispatch` close-out readiness (LIN-3634, LIN-3418 step 2): a `close-out` (effective kind, fresh or follow-up) on a stop-at-PR task whose sole open PR is `head-moved` answers `409 CLOSE_OUT_NOT_READY` (`reason:'head-moved'`, `state`) before any mint or row; every other state and every unreadable read is admitted. `stopAt` is read first from the store, so an ordinary close-out makes no provider or GitHub read. Session lane only: the proxy, recommend and kickoff lanes are not guarded (token enforcement is LIN-3417). `lib/close-out-readiness.js` holds the read chain shared with the check route.
- `GET /workspace/:urlKey/api/dispatch/halt` - Read the workspace's halt request
- `POST /workspace/:urlKey/api/dispatch/halt` - Request a pause or stop (LIN-2994)
- `DELETE /workspace/:urlKey/api/dispatch/halt` - Clear the halt request
- Home (`GET /workspace/:urlKey/`, and its post-refresh re-render) reads the halt through `readHaltForPoll` for its banner (LIN-4115); a bounded, read-only read that never gates the run buttons.

The runner honours a stored halt (`lib/runner-kit/runner.mjs` `haltAction`: pause leaves fresh
items, stop sweeps). Set and clear are owner-only (LIN-3398); reading is member-reachable. This
path is best-effort under degradation; the degraded-mode path is the proxy verb (below).

**Consumer endpoints** (Bearer token auth):
- `GET /api/dispatch/poll` - Poll for available items (may carry an additive `halt` request
  key, omitted when unset; the runner honours it)
- `POST /api/dispatch/take/:itemId` - Atomically claim an item
- `POST /api/dispatch/feedback/:itemId` - Post feedback on a taken item
- `POST /api/dispatch/usage/:itemId` - Post per-request usage records for a taken item (LIN-4198;
  body `{records: [...]}`, at most 100 per call; the runner-token twin is `POST /api/proxy/runner/usage/:id`).
  **Auth deviation from feedback, on purpose:** this route accepts the consumer dispatch token only and
  refuses the single-use Harbour OS feedback token (401, and the refusal does not spend the token). Feedback
  accepts that token first; the token is spent by its first successful call, and a runner posts usage in
  batches against one item, so the second batch would be refused. Pinned by
  `tests/unit/lin-4198-usage-routes.test.js` and recorded beside the route in `routes/dispatch.js`.
- `POST /api/dispatch/heartbeat` - Consumer heartbeat (LIN-1952): host load and session counts, 204 or 400.
  The same handler answers `POST /api/proxy/runner/heartbeat` (runner `take` gate). Stored in
  `consumer-heartbeats` (one replaced doc per workspace + instance, 15 min expiry, 20 per workspace),
  read at `GET /api/proxy/heartbeats`. Field set and parser: `lib/consumer-heartbeat.js`.

Items expire after 24 hours. Tokens are workspace-scoped. New dispatch tokens expire after 90 days (`expiresAt`); older rows keep working until expired; they can be revoked, and are revoked with the workspace by the account that made them.
Feedback is append-only, **retained for the life of the project**, and requires strict token ownership.

**Per-request usage (LIN-4198, piece 1 of LIN-4195).** A model request is one record in the
`request-usage` collection (`lib/request-usage-store.js`), upserted on `{urlKey, rootItemId, requestId}`
(unique; the stamp is part of the upsert key, so a request posted under two anchors is two documents until the
read folds them). Intake is
`lib/request-usage-intake.js`, shared by `POST /api/dispatch/usage/:itemId` and `POST /api/proxy/runner/usage/:id`.
- **Identity and metadata**: `rootItemId` is the posting row's anchor at post time (through `anchorOf`), stored as
  an **informational stamp**: nothing reads by it (LIN-4212). It is never read from the body. `itemId` and
  `issueIdentifier` are stored from that row. Metadata (`harness`, `model`, `effort`, `lane`, `agent`, `at`) is set
  once, on insert.
- **Counts grow only**: the five token counters and an optional native `costUsd` are merged with `$max`, so a
  repost of a streamed message grows the record and a smaller repost never shrinks it. Reposting the same request
  under the same stamp leaves one document; the read folds documents split across stamps (LIN-4212).
- **Limits**: at most 100 records per call (a larger call is refused whole, 400). A record is judged on its own:
  a missing `requestId`, an over-long id, a non-finite or negative number, or a prompt size over 2,000,000 tokens
  (input + cache-read + cache-write) is rejected with a reason, and the rest of the call still applies. A record
  whose five token counts are all zero is accepted and reported as applied, but not stored.
- **No stored price.** Pricing happens at read, per record: `priceRequest` in `lib/model-pricing.js` takes the
  record's own prompt size through the tier rates, whatever `harness` says (a cumulative-total guard does not apply
  to a single request). A finite native `costUsd` on the record wins over the read-time price (the same precedence
  as `lib/session-telemetry.js`).
- **Lineage read (LIN-4212).** A record belongs to the lineage its posting row **currently** belongs to. A wake row
  is minted with its own id as anchor and re-pointed to its lineage root at its first tagged feedback, so a stamp
  taken before that latch names an anchor no row carries any more. `listForAnchors(urlKey, anchors)` therefore
  resolves the member rows itself, from `dispatch-history` (`rootItemId` in `anchors`, no status or `isMember`
  filter, so a posting row always counts); reads the records by `{urlKey, itemId}` (index in `lib/db-indexes.js`);
  relabels each record to its row's current anchor; drops a record whose `itemId` has no member row (no fallback
  to the stamp: that could double count a re-pointed row); and folds to one record per `requestId` (earliest
  document's metadata, `$max` on the counts, latest `updatedAt`). No migration: the stored stamps are never rewritten.
- **History dependency.** The read is only as complete as `dispatch-history`: `dispatch-history` is not pruned on
  its own (the expiry delete was removed, `lib/dispatch-store.js:1591-1595`, LIN-3163). A row deleted by account
  erasure or the test-only `clearHistory` takes its records out of every read.
- **Readers**: the intake route, and `listForAnchors` (a minimal projection). The LIN-4200 measurement scripts
  (`scripts/lin-4200-measure-records-vs-snapshots.mjs`, `scripts/lin-4200-d13-volume-timing.mjs`) call it, read-only.
  The cost read (LIN-4201) is the next caller.

A dispatch item may carry an optional `followUpTo` field (the `id` of an earlier dispatch) to resume that
session as a follow-up instead of starting fresh (cli/web only, same workspace; LIN-415). Harbour
stores and forwards the id blindly — the consumer owns session identity and liveness, and reports
`[failed] no live session to resume` when the target session is gone. See the Follow-ups section of the
integration guide; the autopilot's conservative "fresh by default, follow up only after a flawless,
self-suggesting session" disposition lives in `docs/autopilot-operating-manual.md`.

**See [docs/dispatch-integration.md](../dispatch-integration.md)** for the full consumer integration guide.

## The leftover step and the held wake (LIN-4373)

When an eligible build posts its terminal `[done]`, Harbour resumes the build's own session with one question, "what did your change leave behind at its edges?", and holds the build's parent wake until that step ends. An autopilot therefore cannot route `review` before the builder has answered and tidied, and the step's cost is its own `dispatches[]` entry on `GET /api/proxy/issues/{id}/cost`.

- **Who is asked** (`decideLeftover`, `lib/dispatch-leftover.js`, pure). Eligibility is read from the lineage root, never the producing row's kind, so a `[done]` that lands on a ci-wake `custom` follow-up still counts. Eligible: the root is a stage-template `implementation` row (not a worker lane, not a periodical row, not a hand-written `implementation`-kind prompt); the producing row's new entry is `[done]`; a PR URL is in the lineage's feedback; the target is `cli` or `web`; the workspace is not halted (`pause` or `stop`) and the run the build reports to is not stopped; the producing row is not itself a `leftover` row or a `subscription:'none'` follow-up. A ticket is asked once: any `leftover` row of the ticket, queued or archived, makes a later build not eligible. A `leftover` row already held for this producing row answers **hold** (a re-reported `[done]`).
- **The enqueue** (`lib/dispatch-leftover-hook.js`). One step is built in server.js and handed to both feedback entrances, `POST /api/proxy/runner/feedback/:id` and `POST /api/dispatch/feedback/:itemId`; each binds its own request origin (`publicOrigin(req)`). It enqueues through `enqueueFollowUp` (owner gate, resume credential, `RUN_STOPPED` refusal) with `kind: 'leftover'`, `followUpTo` the producing row, `force: true`, the root's `dispatchedBy` as owner and `heldWakeFor` the producing row. The wake is withheld only after the enqueue returned 200, or when a concurrent `[done]` on the same row holds the claim (see "One claim per row" below). Every other path, including a thrown hook, wakes the parent exactly as before and logs `[leftover] skipped reason=<why> item=<id>`.
- **The row-only kind.** `leftover` is not in `DISPATCH_KINDS`, like `wake`, so no `/dispatch` caller can create one. `heldWakeFor` is sparse (`heldWakeForOf`, `lib/dispatch-fields.js`): it is written only from `createDispatchItem`'s server-side parameter (a body copy is stripped) and survives the take, cancel and expiry archive hops. The task page shows the step as its own stage, "Leftovers".
- **The held wake is released by whichever comes first**, at most once:
  - the leftover step's own terminal, on the `leftover` row or, when the step parked `[pending]` on CI, on the ci-wake `custom` row that continues it (`_heldLeftoverOf` walks up through `custom` rows to the held `leftover` row, stopping at the build). `[done]` wakes the parent as itself (a distinct producing row on the same edge, LIN-1357), so the prompt asks the builder to restate the PR URL and head SHA in its terminal message. `[failed]`, `[aborted]` and `[blocked]` wake it with the **build's** `[done]` outcome and PR URL, and one line first naming what happened to the step, so the parent never reads "implementation failed" for a build that finished with a PR;
  - the row leaving the queue without running: cancelled (`removeItem`: a person, Undo, the stopped-run cleanup) or expired (`cleanup()`). Both archive through `_archiveItem`, which calls `releaseHeldWake` after a successful insert. The release builds the build's wake through the same `_planWake` / `_deliverWake` pair `addFeedback` uses, under the build's own guard key, so `_mintWake`'s CAS makes it exactly once across both paths and any re-report, and the stopped-parent gate applies. Its prompt opens with "The leftover step did not run (its row was cancelled|expired)". A release error never fails the archive.
- **Not the only wake while the step runs.** What is held is the build's terminal wake. A `[pending]` park in the step's lineage (a tidy pushed, waiting on CI) wakes the parent at once, as any parked child does. That wake opens with "The leftover step is paused [pending]", the build's `[done]` message and its PR, and says the build's wake is still held, so it is not read as "implementation paused". A parent that routes on it sees a finished build whose step is still running; it should wait for the step's terminal or the release.
- **Credentials at release.** The release has no request, so the store mints through a late-bound factory (`setWakeCredentialProvisionerFactory`, wired in server.js like `setHaltReader`): `buildWakeCredentialProvisioner` with the canonical link origin and the root's `dispatchedBy`. One policy differs from the request path: a transient declaration read or provisioning failure, or no factory at all, enqueues the wake without a credential instead of withdrawing it (a release has no re-report to retry), and logs `[leftover] release-degraded`. An enqueue fault during the release leaves `wakeWitnessMeta` as the recovery evidence, as for any `_mintWake` fault.
- **A stopped run.** `_cancelQueuedWakesForStoppedRuns` also cancels the queued `leftover` rows whose root reports to the stopped run, so a stop never resumes a builder for its leftover step; the cancel releases the held wake, and the stopped-parent gate mints nothing.
- **What reads the answer** (LIN-4374). Review checks the `### Leftovers` comment against the diff and routes each edge left untouched: a fix or a note entry for close-out to make on the PR branch before the merge, or an outside follow-up for close-out to file (`docs/architecture/prompt-system.md`).
- **Which PR** (LIN-4375). The prompt and the held wake name the lineage's PR through `prUrlOfFeedback` (`lib/dispatch-wake.js`): a PR on the session's own `DONE:` or `[done]` line wins over the `[done]` entry's `url`, which older runners filled with the PR mentioned most often. simple-dispatcher's hook now puts the session's own PR in that `url` too.
- **One claim per row** (LIN-4375). Before it enqueues, the hook claims the producing row with a compare-and-set (`claimLeftoverFor`, `lib/dispatch-store.js`). Two `[done]` posts on the same row in the same moment both decide "queue"; the one that loses the claim answers **hold** (`[leftover] hold item=<id> claim-lost`), so one `leftover` row is queued. A winner that then skips (`no-base-url`, `no-workspace`, `enqueue-<status>`) first gives the claim back (`releaseLeftoverClaim`, best-effort and logged) and then wakes the parent itself, which is the one wake owed. The release is needed because that wake is not always minted: `_deliverWake` withdraws it on a transient fault (a declaration read, the parent's status, a `grant-mint-transient` provisioner answer) for the runner's re-report to retry, and an owner-check outage refuses the enqueue and the mint together. With the claim given back, the re-report decides afresh and queues the step or wakes the parent; `_mintWake`'s CAS keeps it to one wake. Residuals: a server that dies between the claim and the enqueue, or a release write that fails (`[leftover] claim-release-failed`), leaves that build's wake held with no row to release it; and a second `[done]` in the moment between a skipping winner's release and its wake can queue a leftover row beside that wake.

## Workspace API Proxy (provider-backed)

The proxy allows authenticated users to generate secure tokens for external AI agents and automation tools to interact with their workspace's issues and projects via a REST-like API. The wire contract is **source-neutral** (flat shapes, no provider-specific URLs) and the data path runs through the provider layer (LIN-306/308/309/310): reads source through `lib/providers/linear/index.js`, writes go through an injected `provider.*` that is capability-gated (`provider.supports()` → clean 422 `CAPABILITY_NOT_SUPPORTED` for unsupported ops). The route owns no inline Linear GraphQL — only its own registry-bound, source-text-pinned `graphqlErrorStatus()` remains on the error path in the route itself; `graphqlErrorDetail()` and the rest of the graphqlError* family now live in `lib/proxy-graphql-errors.js`, imported by the route (LIN-2548). Provider **selection** is now per-workspace (LIN-581): `resolveWorkspaceAccess` surfaces the workspace's own `provider` name and `resolveProviderAccess` resolves it via `getProviderForWorkspace` (registry; Linear is the legacy default for workspaces with no explicit provider, so the historical path is byte-identical), which makes the capability gate (`provider.supports()` → 422) a real runtime path rather than only a test-injected one. (Input `<source>:` namespace acceptance in `lib/proxy-ref-resolver.js` is still Linear-only — that relaxation is sequenced separately as LIN-544.)

**Key features:**
- Token-based authentication (Bearer tokens with SHA-256 hashing)
- Read/write scope separation (`read` for queries, `readWrite` for mutations)
- Single-use token support (consumed after first request)
- Single-use **bootstrap** tokens for handoffs (LIN-376): every token embedded in a dispatched prompt, page copy, +proxy block, or Collective message is a single-use, exchange-only bootstrap (`kind: 'bootstrap'` in `lib/proxy-tokens.js`). It authenticates ONLY `POST /api/proxy/token`, which atomically consumes it and returns a multi-use working token; `validateToken` rejects a bootstrap on every data endpoint. The durable prompt (queue/history/log/clipboard, readable via `GET /api/proxy/dispatch/:id/prompt`) therefore carries a credential that is inert the instant the agent exchanges it, and the dispatch endpoints no longer replay the caller's own standing token. The one seam is the exchange endpoint; every handoff generator (`buildProxyContextPreamble`, `buildLinearAccessBlock`, `buildAgentPrompt`, `buildBlock`, `/instructions`) leads with the exchange step. **Token lifetime varies by mint path (LIN-1938)** — every agent-facing mint is 48h (`WORKING_TOKEN_TTL_SECONDS`/`BOOTSTRAP_TOKEN_TTL_SECONDS`/`PROMPT_PROXY_TOKEN_TTL_SECONDS`), an operator standard mint under any other label is 90 days (the store default); see the per-path table in `GET /api/proxy/instructions` and `docs/proxy-integration.md`'s Token lifetimes section for the full breakdown, and LIN-2602/LIN-2603 for the tracked mint-duration-control and human-approved-extension work — there is no self-service refresh today.
- Event audit logging (audit events are **retained for the life of the project**)
- Rate limiting (60 requests/minute per IP)
- Workspace isolation (tokens are scoped to a single workspace)

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/proxy/tokens` - Create a proxy token
- `GET /workspace/:urlKey/api/proxy/tokens` - List tokens
- `DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId` - Revoke token (a grant-bearing runner credential lineage is owner-only: `ProxyTokenStore.revokeToken` owner-checks it, LIN-3409)
- `GET /workspace/:urlKey/api/proxy/events` - View audit log

Consumer endpoints are Bearer-token authenticated and fall into three groups: **read** (issues, teams, projects, cycles, labels, search, relations), **write** (`readWrite` scope — create/update issues, comments, relations, labels), and **task automation** (stack, prompt, recommend, recap, brief, status). The full endpoint catalog, request/response shapes, and scope rules are the consumer contract and live in the integration guide — that's the source of truth, not this file. (Issue IDs accept both UUIDs and identifiers like `LIN-123`.) `GET /api/proxy/issues` is cursor-paged (LIN-1511): it accepts an opaque `after` request cursor (alias `cursor`) passed verbatim through the existing `provider.issues({ first, after })` seam, and returns `pageInfo.{hasNextPage,endCursor}` — loop `endCursor` back as `after` until `hasNextPage` is false to enumerate a workspace past the 250-per-page cap. `/api/proxy/search` is deliberately **not** paged (relevance-capped; tracked separately). A cursor the provider rejects is a **400**, not a 500: Linear signals a caller error *inside an HTTP 200 GraphQL envelope* (`extensions.userError: true`, no `statusCode`), which the status branches of `graphqlErrorStatus()` cannot see, so before LIN-1511's follow-up every one fell through to 500. The `userError → 400` branch is evaluated **last**, after those branches, so it can only refine a would-be 500 — it applies to every proxy route, not just `/issues` (a caller error is a caller error wherever it lands), and `graphqlErrorDetail()` prefers Linear's `extensions.userPresentableMessage` over the generic top-level `message` so the caller is told *which* input was wrong. LIN-2040 widened what the mapper reads. `upstreamErrorStatus()` (`lib/proxy-graphql-errors.js`) takes the status from one of two shapes: Linear's `err.response` (its HTTP status, and `extensions.statusCode` only for 404 and 429 inside a 200 envelope), or the numeric `err.status` the Jira, GitHub and GitHub Projects clients throw, passed through only for 401, 403, 404 and 429. A 403 whose message says "rate limit" (GitHub's secondary limit) is 429; any other 403 is 403 and never marks the credential suspect, because suspect-marking fires only on 401 and 503. A Linear "Entity not found" in a 200 envelope is 404, checked before the `userError` branch. Every other upstream status, including a provider 5xx, stays 500, so a provider failure is never relayed as a 503 that tells the agent to re-authenticate. `/autopilot/kickoff`'s fallback relays the same statuses (its 401/503 attribution is unchanged).

`GET/POST/DELETE /api/proxy/dispatch/halt` is the operator trio (LIN-2994 Decision 4) — the
degraded-mode path for a workspace halt. The runner honors a set halt on its next poll. POST and DELETE are
owner-only (LIN-3409): they need a token the owner minted on the Proxy page after LIN-3409 (other
grant-less tokens get `409 PROXY_TOKEN_UNBOUND`); the Dispatch page is the other route. The full contract lives in the [Operator Halt section of the integration
guide](../proxy-integration.md#operator-halt-lin-2994-decision-4), not here. For incident use,
see the [degraded-mode runbook](../runbooks/harbour-degraded.md).

`/api/proxy/model-routing/*` (LIN-3854, `routes/proxy-model-routing.js`) reads the model-routing table for any token and writes it (job, group, preset apply, undo) only for a `readWrite` token while the workspace feature `modelRoutingProxyWrites` is on (off by default; changed only by the session-authed `POST /settings/workspace-features`, never over the proxy). Off is `403 MODEL_ROUTING_WRITES_DISABLED`. Every write needs a reason and is logged with `via: 'proxy'`, the token creator and the token id.

**See [docs/proxy-integration.md](../proxy-integration.md)** for the full consumer integration guide.

## Wake shadow (LIN-3257, M1 shadow)

Harbour classifies every wake it mints at the `addFeedback` seam (`classifyWake`, `lib/dispatch-wake.js`) and records the verdict plus a per-day tally in the additive, optional `wake_shadow` collection (`lib/wake-shadow.js`, `wakeShadowCollection`). This is a **measurement only**: nothing is suppressed, delivery is byte-identical, and no code path reads the result to hold a wake back. The two read-only surfaces are the `wakeShadow` field on `GET /api/proxy/dispatch/{id}` and `GET /api/proxy/wake-shadow`; the full contract lives in the [Wake-Shadow Tally section of the integration guide](../proxy-integration.md#read-the-wake-shadow-tally), not here.

