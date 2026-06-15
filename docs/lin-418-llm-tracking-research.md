# LIN-418 — Track model & cost (research)

**Goal:** record metadata (model, provider, time, tokens, cost) for *every* LLM
call. "We don't need the tokens, just the metadata" — i.e. a durable per-call
log, not a token-accounting feature.

## 1. Where LLM calls happen today

Every LLM call funnels through **three functions in `lib/openrouter.js`**, all
POSTing to `https://openrouter.ai/api/v1/chat/completions`:

| Function | Mode | Reads from response today |
|---|---|---|
| `getRecommendation` (`lib/openrouter.js:1045`) | buffered | `usage.completion_tokens`, `finish_reason` |
| `getRecommendationStream` (`:583`) | SSE stream | `usage.completion_tokens` (per chunk), `finish_reason` |
| `streamChat` (`:780`) | SSE stream / buffered fallback | **nothing** — only `finish_reason` is surfaced |

Call sites (the consumers an implementation must attribute):

- `routes/workspace-api.js` — recommend (buffered `:926`), recommend descent
  per-hop (`:1270`), recommend leaf (`:1351`); roadmap narrative layer (`:2414`),
  orientation (`:2594`), custom (`:2895`)
- `lib/brief.js:111` (brief) and `lib/recap.js:119` (recap) — both via `streamChat`
- `routes/task-chat.js:255` (task chat) — via `streamChat`
- `routes/proxy.js:2758` (foreman recommend via proxy) — via `getRecommendation`

The only other OpenRouter HTTP call is `routes/openrouter-auth.js:115` — the
OAuth PKCE key exchange, **not** an LLM call (no metadata to record).

So **the three functions are a single, real seam**: instrument them and every
LLM call is covered.

## 2. What metadata is captured today

Almost none, and nowhere durable:

- `model` is *returned* by `generateRecap`/`generateBrief` and **persisted** in
  three caches — `recap-cache.js`, `brief-cache.js`, `report-history-store.js`
  (`model` field). These are result caches keyed by content hash, not a call log:
  they hold the *last* result per (workspace, issue), overwrite on regenerate,
  and have no token/cost/provider/duration/timestamp-per-call.
- `completion_tokens` is read in the two `getRecommendation*` paths and bubbled
  to the client in SSE `done` events, but never stored.
- **No** `prompt_tokens`, **no** `cost`, **no** `provider`, **no** per-call
  duration or timestamp is captured anywhere.
- `streamChat` (which backs brief, recap, roadmap, task-chat) requests no usage
  and surfaces none — those four features have **zero** token/cost visibility.

## 3. OpenRouter: getting cost without a price table

The ticket notes "Open router has a price API." There are two ways to get cost;
the first is strictly simpler and is the recommended one:

**(a) In-response usage accounting (recommended).** Add `usage: { include: true }`
to the request body. OpenRouter then returns, in the same response (final SSE
chunk for streams), `usage.cost` (USD), `usage.prompt_tokens`,
`usage.completion_tokens`, `usage.total_tokens`, and `usage.cost_details`. The
response also echoes `model` and carries the upstream `provider`. **OpenRouter
computes the cost** — no pricing table to maintain, no extra round-trip, works
for both buffered and streaming calls. This single flag yields model, provider,
tokens, and cost together.

**(b) The price/models API (`GET /api/v1/models`)** returns `pricing.prompt` /
`pricing.completion` per-token rates; you'd multiply by token counts yourself.
(`GET /api/v1/generation?id=<id>` returns `total_cost` + native token counts but
needs a second call.) Useful as a fallback if `usage.cost` is ever absent, but
not needed for the common path.

`time` is measured locally: `Date.now()` around the call → `durationMs`.

## 4. Recommended smallest validated approach

Additive instrumentation at the existing three-function seam plus one new
append-only store — no restructuring.

1. **New store `lib/llm-call-log.js`**, modelled byte-for-byte on
   `lib/proxy-events.js` / `lib/foreman-store.js`: `insertOne` with a UUID `_id`,
   `timestamp`, and `expiresAt` TTL (30 days), fire-and-forget. Wire it in
   `server.js` next to the others (`db.collection('llm-call-log')` →
   `new LlmCallLogStore({ collection })`) and inject into the route factories the
   same way `proxyEventStore`/`foremanStore` already are. Record shape:
   `{ _id, urlKey, feature, model, provider, promptTokens, completionTokens,
   totalTokens, cost, finishReason, durationMs, issueIdentifier, timestamp,
   expiresAt }`.
2. **Request usage on all three calls:** add `usage: { include: true }` to the
   request bodies in `getRecommendation`, `getRecommendationStream`, and
   `streamChat`. For `streamChat`, also read `usage` off the final chunk (today
   it's discarded) and surface `{ usage, finishReason }` in its `done` event.
3. **Attribution without coupling:** thread an optional `options.onUsage(meta)`
   callback (or `options.callMeta = { urlKey, feature, issueIdentifier }`) into
   the three functions. On settle they invoke it with the captured metadata; the
   route/lib caller's closure writes the row to the store. This keeps
   `lib/openrouter.js` free of any store dependency (testable, no new import) and
   mirrors how the codebase already passes context down.
4. `brief.js` / `recap.js` / `task-chat.js` / the roadmap helpers pass their
   `urlKey` + feature through `options`; all call sites already have `urlKey`
   in scope (workspace-prefixed routes, proxy token, task-chat route).

The model/provider/tokens/cost all arrive in one response (step 2); the store
follows an established pattern (step 1); attribution is a small additive
`options` extension (step 3). Nothing existing has to be reshaped.

## 5. Surface Assessment

**Lands cleanly.** The three `lib/openrouter.js` functions are an existing,
genuine choke point for all LLM traffic, and the persistence pattern
(append-only store with TTL, DI-wired in `server.js`) is already established by
`proxy-events.js`/`foreman-store.js`. The work is purely additive: one new
store, a `usage: { include: true }` flag on three request bodies, and an
optional attribution callback threaded through `options`. No prerequisite
refactor is required, so **no separate blocking subtask** — implementation lands
inline/scoped under LIN-418.

*Improvement noticed, not required:* the HTTP round-trip is duplicated across the
three functions (buffered vs. streaming vs. fallback), so each needs its own
usage-read. A shared `callOpenRouter()` primitive would de-duplicate that, but
it is **not** a prerequisite — instrument the three functions in place. If
extracted, do it inline, not as a blocking dependency.

## Staleness note

Files re-read at HEAD. Since the ticket's `createdAt` (2026-06-11) the relevant
files changed (`#471` Task Chat added a new `streamChat` site; `#437`/`#435`
grounding/fact refactors), but none invalidate the premise: all LLM calls still
funnel through the same three functions, and per-call cost/provider is still
unrecorded.
