Scope: the Dispatch API and the proxy consumer integration. Moved verbatim from CLAUDE.md (LIN-2896).

## Dispatch API

The Dispatch feature allows users to queue prompts for external consumers (AI agents, automation tools).

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/dispatch` - Queue a prompt
- `GET /workspace/:urlKey/api/dispatch` - List queued items
- `DELETE /workspace/:urlKey/api/dispatch/:itemId` - Remove item
- `PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim` - Graceful trim (LIN-2147): amend a live run's `maxTasks` bound downward. Body `{ maxTasks }` (positive integer, strictly less than the run's current bound — 409 otherwise). Invents no new termination path: the existing `maxTasks`/`countDistinctTasksForSession` guard (LIN-1751, `lib/dispatch-factory.js`) already refuses a genuinely NEW task past the bound while admitting a dispatch for a task already inside it (`alreadyCounted`) regardless of count — so lowering the bound here is sufficient on its own to make a run wind down (finish the current ticket, refuse the next new one) without interrupting any beat already in progress. Idempotent (an absolute set, not a relative decrement) and auditable (`by`/`at`/`maxTasks` appended to the run's own `trimHistory`, readable via `getItemStatus`). Distinct from abort (LIN-553/743): abort is a hard stop mid-work; trim is "finish what you're on, start nothing new."
- Token management at `/workspace/:urlKey/api/dispatch/tokens`
- `GET /workspace/:urlKey/api/dispatch/halt` - Read the workspace's halt request
- `POST /workspace/:urlKey/api/dispatch/halt` - Request a pause or stop (LIN-2994)
- `DELETE /workspace/:urlKey/api/dispatch/halt` - Clear the halt request

Stores a request only: the runner does not yet honor it (pending LIN-2995). This path is
best-effort under degradation; the degraded-mode path is the proxy verb (below).

**Consumer endpoints** (Bearer token auth):
- `GET /api/dispatch/poll` - Poll for available items (may carry an additive `halt` request
  key, omitted when unset; the runner does not yet honor it (pending LIN-2995))
- `POST /api/dispatch/take/:itemId` - Atomically claim an item
- `POST /api/dispatch/feedback/:itemId` - Post feedback on a taken item

Items expire after 24 hours. Tokens are workspace-scoped and never expire (but can be revoked).
Feedback is append-only, inherits 30-day history TTL, and requires strict token ownership.

A dispatch item may carry an optional `followUpTo` field (the `id` of an earlier dispatch) to resume that
session as a follow-up instead of starting fresh (cli/web only, same workspace; LIN-415). Harbour
stores and forwards the id blindly — the consumer owns session identity and liveness, and reports
`[failed] no live session to resume` when the target session is gone. See the Follow-ups section of the
integration guide; the autopilot's conservative "fresh by default, follow up only after a flawless,
self-suggesting session" disposition lives in `docs/autopilot-operating-manual.md`.

**See [docs/dispatch-integration.md](docs/dispatch-integration.md)** for the full consumer integration guide.

## Workspace API Proxy (provider-backed)

The proxy allows authenticated users to generate secure tokens for external AI agents and automation tools to interact with their workspace's issues and projects via a REST-like API. The wire contract is **source-neutral** (flat shapes, no provider-specific URLs) and the data path runs through the provider layer (LIN-306/308/309/310): reads source through `lib/providers/linear/index.js`, writes go through an injected `provider.*` that is capability-gated (`provider.supports()` → clean 422 `CAPABILITY_NOT_SUPPORTED` for unsupported ops). The route owns no inline Linear GraphQL — only its own registry-bound, source-text-pinned `graphqlErrorStatus()` remains on the error path in the route itself; `graphqlErrorDetail()` and the rest of the graphqlError* family now live in `lib/proxy-graphql-errors.js`, imported by the route (LIN-2548). Provider **selection** is now per-workspace (LIN-581): `resolveWorkspaceAccess` surfaces the workspace's own `provider` name and `resolveProviderAccess` resolves it via `getProviderForWorkspace` (registry; Linear is the legacy default for workspaces with no explicit provider, so the historical path is byte-identical), which makes the capability gate (`provider.supports()` → 422) a real runtime path rather than only a test-injected one. (Input `<source>:` namespace acceptance in `lib/proxy-ref-resolver.js` is still Linear-only — that relaxation is sequenced separately as LIN-544.)

**Key features:**
- Token-based authentication (Bearer tokens with SHA-256 hashing)
- Read/write scope separation (`read` for queries, `readWrite` for mutations)
- Single-use token support (consumed after first request)
- Single-use **bootstrap** tokens for handoffs (LIN-376): every token embedded in a dispatched prompt, page copy, +proxy block, or Collective message is a single-use, exchange-only bootstrap (`kind: 'bootstrap'` in `lib/proxy-tokens.js`). It authenticates ONLY `POST /api/proxy/token`, which atomically consumes it and returns a multi-use working token; `validateToken` rejects a bootstrap on every data endpoint. The durable prompt (queue/history/log/clipboard, readable via `GET /api/proxy/dispatch/:id/prompt`) therefore carries a credential that is inert the instant the agent exchanges it, and the dispatch endpoints no longer replay the caller's own standing token. The one seam is the exchange endpoint; every handoff generator (`buildProxyContextPreamble`, `buildLinearAccessBlock`, `buildAgentPrompt`, `buildBlock`, `/instructions`) leads with the exchange step. **Token lifetime varies by mint path (LIN-1938)** — every agent-facing mint is 48h (`WORKING_TOKEN_TTL_SECONDS`/`BOOTSTRAP_TOKEN_TTL_SECONDS`/`PROMPT_PROXY_TOKEN_TTL_SECONDS`), an operator standard mint under any other label is 90 days (the store default); see the per-path table in `GET /api/proxy/instructions` and `docs/proxy-integration.md`'s Token lifetimes section for the full breakdown, and LIN-2602/LIN-2603 for the tracked mint-duration-control and human-approved-extension work — there is no self-service refresh today.
- Event audit logging (30-day TTL)
- Rate limiting (60 requests/minute per IP)
- Workspace isolation (tokens are scoped to a single workspace)

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/proxy/tokens` - Create a proxy token
- `GET /workspace/:urlKey/api/proxy/tokens` - List tokens
- `DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId` - Revoke token
- `GET /workspace/:urlKey/api/proxy/events` - View audit log

Consumer endpoints are Bearer-token authenticated and fall into three groups: **read** (issues, teams, projects, cycles, labels, search, relations), **write** (`readWrite` scope — create/update issues, comments, relations, labels), and **task automation** (stack, prompt, recommend, recap, brief, status). The full endpoint catalog, request/response shapes, and scope rules are the consumer contract and live in the integration guide — that's the source of truth, not this file. (Issue IDs accept both UUIDs and identifiers like `LIN-123`.) `GET /api/proxy/issues` is cursor-paged (LIN-1511): it accepts an opaque `after` request cursor (alias `cursor`) passed verbatim through the existing `provider.issues({ first, after })` seam, and returns `pageInfo.{hasNextPage,endCursor}` — loop `endCursor` back as `after` until `hasNextPage` is false to enumerate a workspace past the 250-per-page cap. `/api/proxy/search` is deliberately **not** paged (relevance-capped; tracked separately). A cursor the provider rejects is a **400**, not a 500: Linear signals a caller error *inside an HTTP 200 GraphQL envelope* (`extensions.userError: true`, no `statusCode`), which the four status branches of `graphqlErrorStatus()` cannot see, so before LIN-1511's follow-up every one fell through to 500. The `userError → 400` branch is evaluated **last**, after those branches, so it can only refine a would-be 500 — it applies to every proxy route, not just `/issues` (a caller error is a caller error wherever it lands), and `graphqlErrorDetail()` prefers Linear's `extensions.userPresentableMessage` over the generic top-level `message` so the caller is told *which* input was wrong.

`GET/POST/DELETE /api/proxy/dispatch/halt` is the operator trio (LIN-2994 Decision 4) — the
degraded-mode path for a workspace halt. It stores a request the runner does not yet honor
(pending LIN-2995); the full contract lives in the [Operator Halt section of the integration
guide](../proxy-integration.md#operator-halt-lin-2994-decision-4), not here. For incident use,
see the [degraded-mode runbook](../runbooks/harbour-degraded.md).

**See [docs/proxy-integration.md](docs/proxy-integration.md)** for the full consumer integration guide.

