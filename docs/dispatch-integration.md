# Dispatch API Integration Guide

This guide explains how to build a consumer service that receives prompts from the Linear Viewer dispatch queue.

## Overview

The Dispatch API allows external consumers (AI agents, automation tools, custom services) to receive prompts queued from the Linear Viewer. Users dispatch prompts from the web interface, and consumers poll for and claim those prompts for processing.

**Key features:**
- Token-based authentication for consumers
- Atomic take/claim operations (prevents duplicate processing)
- 24-hour TTL with automatic cleanup
- Workspace isolation (tokens are scoped to a single workspace)
- Target-based routing (`cli`, `web`, `dash`, or `local`) so consumers only process items meant for them

## Quick Start

```bash
# 1. Poll for available items
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/dispatch/poll

# 2. Take an item atomically
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/dispatch/take/ITEM_ID

# 3. Post feedback after processing
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Done!", "url": "https://github.com/repo/pull/1"}' \
  https://your-instance.com/api/dispatch/feedback/ITEM_ID
```

## Authentication

### Getting a Token

Tokens are created by authenticated users in the Linear Viewer settings page:

1. Log into Linear Viewer
2. Navigate to Settings
3. In the "Dispatch Tokens" section, create a new token with a descriptive label
4. **Save the token immediately** - it's only shown once

Alternatively, tokens can be created via API (requires session authentication):

```bash
POST /workspace/:urlKey/api/dispatch/tokens
Content-Type: application/json

{ "label": "My Consumer" }
```

Response:
```json
{
  "tokenId": "uuid",
  "token": "base64url-encoded-token",
  "label": "My Consumer",
  "message": "Token created. Save this token now - it cannot be retrieved later."
}
```

### Using the Token

Include the token in the `Authorization` header:

```
Authorization: Bearer YOUR_TOKEN
```

## Consumer API Endpoints

### Poll for Items

Retrieves all available items in the queue without removing them.

```
GET /api/dispatch/poll
Authorization: Bearer <token>
```

**Response:**
```json
{
  "items": [
    {
      "id": "uuid",
      "prompt": "The prompt text...",
      "promptName": "blocked",
      "kind": "blocked",
      "issueId": "linear-issue-uuid",
      "issueIdentifier": "LIN-42",
      "issueTitle": "Fix authentication bug",
      "issueUrl": "https://linear.app/workspace/issue/LIN-42",
      "workspace": {
        "urlKey": "workspace-key"
      },
      "dispatchedAt": "2024-01-15T10:30:00.000Z",
      "dispatchedBy": "account-id",
      "expiresAt": "2024-01-16T10:30:00.000Z"
    }
  ]
}
```

### Take an Item

Atomically claims and removes an item from the queue. If the item has already been taken by another consumer or has expired, returns 404.

```
POST /api/dispatch/take/:itemId
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "item": {
    "id": "uuid",
    "prompt": "The prompt text...",
    "promptName": "blocked",
    "kind": "blocked",
    "issueId": "linear-issue-uuid",
    "issueIdentifier": "LIN-42",
    "issueTitle": "Fix authentication bug",
    "issueUrl": "https://linear.app/workspace/issue/LIN-42",
    "workspace": {
      "urlKey": "workspace-key"
    },
    "dispatchedAt": "2024-01-15T10:30:00.000Z",
    "dispatchedBy": "account-id",
    "expiresAt": "2024-01-16T10:30:00.000Z"
  },
  "dispatchId": "uuid"
}
```

The top-level `dispatchId` field is identical to `item.id` and is exposed as a
convenience for consumers that want to forward it to
`POST /api/proxy/foreman/status` as the `dispatchId` body field. See
[Forwarding `dispatchId` to foreman status](#forwarding-dispatchid-to-foreman-status)
below.

**Error Response (404):**
```json
{
  "error": "Item not found or already taken"
}
```

### Post Feedback

After taking an item, consumers can post feedback to report progress, results, or links back to the user.

```
POST /api/dispatch/feedback/:itemId
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Analyzing issue LIN-42...",
  "url": "https://github.com/repo/pull/42",
  "urlLabel": "Pull Request #42"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | Feedback message (max 2000 chars) |
| `url` | string | No | Link URL (e.g., PR, deployment) |
| `urlLabel` | string | No | Display text for the link |

**Constraints:**
- Only the token that took the item can post feedback (strict ownership)
- Only items with `status: 'taken'` accept feedback
- Rate limited to 100 requests per minute per IP

**Success Response (200):**
```json
{
  "success": true,
  "feedbackCount": 1
}
```

**Error Response (404):**
```json
{
  "error": "Item not found or feedback not allowed"
}
```

Feedback entries are displayed in the dispatch history UI and inherit the 30-day history TTL.

### Minting a Broker Bootstrap Token

```
POST /api/dispatch/broker-token
Authorization: Bearer <token>
```

Mints a fresh, single-use `kind:'bootstrap'`/`scope:'readWrite'` proxy token scoped to the
calling dispatch token's own workspace. This is a narrow, internal-use endpoint — it exists so
a consumer that already holds a live dispatch token but has lost its working proxy credential
(for example, Simple Dispatcher's stall-failsafe reaper re-arming a broker-armed session at
refire time, which has no fresh `item.bootstrapToken` to reuse) can obtain a new one without a
human re-dispatching. Exchange the minted token via `POST /api/proxy/token` exactly like any
other bootstrap (see the Workspace API Proxy integration guide).

**Success Response (201):**
```json
{
  "token": "base64url-encoded-bootstrap-token",
  "expiresAt": "2024-01-17T10:30:00.000Z"
}
```

#### Token ownership, and what an ownerless dispatch token does here

Every dispatch token carries a `createdBy` (the account that created it), stamped at creation.
A token created before that field existed has `createdBy: null` — an **ownerless** token — and
this endpoint stamps whatever it finds onto the bootstrap it mints, never fabricating an owner.

That matters because an ownerless bootstrap is **dead on arrival**: it exchanges fine, then
fails `503 TOKEN_HAS_NO_OWNER` on every workspace-scoped verb (while still returning `200` on
`/instructions` and `/agent/status`), and anything the resulting session mints inherits the
same defect. Ownerless tokens minted here were the confirmed cause of a multi-hour halt of
four autopilot trees on 2026-07-25.

Behaviour is therefore switchable, server-side, via `DISPATCH_OWNERLESS_BROKER_COMPAT`:

| Server setting | Ownerless caller | Owner-stamped caller |
| --- | --- | --- |
| default (compat on) | `201`, mints an ownerless bootstrap, logs the hit | `201`, unaffected |
| `off` | `503` before minting, naming ownership as the cause | `201`, unaffected |

**Error Response (503) — ownerless caller, with the compat lane switched off:**
```json
{
  "error": "Dispatch token has no owner (LIN-1448)",
  "message": "A bootstrap minted for an ownerless dispatch token cannot resolve a workspace credential, so it is refused rather than handed over dead. The workspace itself is unaffected — re-issue this dispatch token from an account that has the workspace connected, then point the runner at the new token."
}
```

The fix on the consumer side is the same either way: **re-create the dispatch token** while
signed in (which stamps an owner) and point the consumer at the new value. `GET
/workspace/:urlKey/api/dispatch/tokens` reports `hasOwner` per token so you can tell which of
your tokens still need re-issuing — an ownerless one is also flagged on the Dispatch page.

Callers should treat any non-2xx response from this endpoint as "mint failed" and fall back to
their own degraded-but-safe behavior.

### Signaling Completion (terminal markers)

A taken item's lifecycle `status` stays `'taken'` while the consumer runs — there is no
separate "complete" call. Instead, **signal completion by prefixing a feedback message
with a terminal marker**. The server derives a terminal status from the last feedback
entry whose `message` begins with one of these markers (case-insensitive):

| Marker | Derived status | Meaning |
|--------|----------------|---------|
| `[done]` | `done` | Work finished |
| `[complete]` | `done` | Alias for `[done]` |
| `[failed]` | `failed` | Work could not be completed |
| `[aborted]` | `aborted` | Run was abandoned (e.g. no live session to resume) |
| `[skipped]` | `skipped` | A cascade abort was **refused** because a human is still in the session — terminal-**benign** (the session is still live), NOT a close. See [Cascade close](#cascade-close-closing-a-session-subtree) |

`[skipped]` is terminal but **benign and distinct from `[aborted]`**: it means nothing ended, so a watcher must **not** treat it as a failure, must **not** retry it, and it does **not** wake an up-chain parent. For example, a final feedback `message` of `"[done] Landed the fix in PR #42"` marks the
item `done`. Until such a marker is posted the item reads as `taken`. Watchers (the proxy
watch/list endpoints and the dashboard Loop feed) read this derived status so they can poll
a field instead of parsing prose — so always end a run with exactly one terminal marker.

### Forwarding `dispatchId` to foreman status

If your consumer also writes foreman status entries via
`POST /api/proxy/foreman/status` (the proxy API used by autonomous agents),
you should forward the dispatched item's ID as the `dispatchId` body field.
This lets the server's loop reconstruction (`lib/pipeline-loops.js`, see LIN-245)
join your status entry to the **exact** dispatch attempt it belongs to instead
of guessing by timestamp window.

The field is optional and fully back-compatible — omit it if you're not using
the foreman status API. When present it must be the same string returned in
either `dispatchId` or `item.id` from the take response.

```javascript
// 1. Take a dispatched item
const takeRes = await fetch(`${API_BASE}/api/dispatch/take/${itemId}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${DISPATCH_TOKEN}` }
});
const { item, dispatchId } = await takeRes.json();

// 2. Do the work...
const result = await processPrompt(item);

// 3. When recording a foreman status entry for this work, pass dispatchId
//    so the Pipeline view can join it to the exact loop:
await fetch(`${API_BASE}/api/proxy/foreman/status`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PROXY_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    taskIdentifier: item.issueIdentifier,
    action: 'implementation',
    status: result.ok ? 'completed' : 'failed',
    summary: result.summary,
    dispatchId           // ← forward the dispatch identity
  })
});
```

**Why it matters.** Without `dispatchId`, the loop reconstruction library has
to guess which dispatch attempt a foreman entry decorates by checking whether
its timestamp falls inside the dispatch window. That guess is correct in the
common case but ambiguous when the same issue is dispatched multiple times in
overlapping windows. Forwarding `dispatchId` removes the ambiguity entirely
and is the recommended pattern for any consumer that posts foreman status.

## Queue Item Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique item ID (UUID) |
| `prompt` | string | The prompt text (up to 100KB) |
| `promptName` | string | Display name (e.g., "blocked") |
| `kind` | string | Stable task classification — a prompt-template key (`research`, `plan`, `implementation`, `review`, …) or `"custom"` for freeform prompts. Read this instead of inferring the task type from `promptName`. See [Task Kind](#task-kind). |
| `issueId` | string | Linear issue UUID (nullable) |
| `issueIdentifier` | string | Human-readable issue ID, e.g., "LIN-42" (nullable) |
| `issueTitle` | string | Issue title (nullable) |
| `issueUrl` | string | Full URL to the Linear issue (nullable) |
| `target` | string | Dispatch target: `"cli"` (default), `"web"`, `"dash"`, or `"local"`. See [Target Routing](#target-routing) |
| `repo` | string | Repository hint (e.g. `"owner/name"`) for the consumer to operate in, or `null` (nullable) |
| `model` | string | **Execution** model the consumer should use to *run* this prompt (the value it passes to its own CLI, e.g. `claude --model`), or `null`. OpenRouter `provider/model` naming convention (e.g. `"anthropic/claude-opus-4.8"`). Opaque and forwarded blindly; `null` keeps the consumer's current default. See [Execution model](#execution-model-model) (nullable) |
| `harness` | string | **Execution** harness the consumer should use to *run* this prompt (e.g. `"claude-code"`, `"opencode"`), or `null`. Opaque and forwarded blindly; `null` keeps the consumer's own default. See [Harness](#harness-harness) (nullable) |
| `followUpTo` | string | The `id` of an earlier dispatch whose session this item should resume, or `null`. See [Follow-ups](#follow-ups) (nullable) |
| `force` | boolean | When `true`, the consumer should **override a runner-side guard**: on a follow-up it resumes even a wedged/sleeping session; on a single abort it force-closes even a human-continued session. Defaults to `false`; meaningful only alongside `followUpTo` **or** a single `abort`, and never with `cascade`. See [Follow-ups](#follow-ups) / [Cascade close](#cascade-close-closing-a-session-subtree) |
| `abort` | boolean | When `true`, this item asks the consumer to cancel/close an existing session (named by `abortTo`) instead of running a prompt. Defaults to `false`. See [Aborting a session](#aborting-a-session) |
| `abortTo` | string | The `id` of the dispatch whose session should be aborted, or `null`. Required when `abort` is `true`. See [Aborting a session](#aborting-a-session) (nullable) |
| `cascade` | boolean | When `true` on an abort, `abortTo` names a subtree **root** and Harbour expands the call into one abort per descendant session. Defaults to `false`; requires `abort`, mutually exclusive with `force`. See [Cascade close](#cascade-close-closing-a-session-subtree) |
| `sessionId` | string | The `id` of the autopilot dispatch that spawned this worker, or `null`. Groups worker dispatches into one autopilot session (any target). See [Autopilot sessions](#autopilot-sessions) (nullable) |
| `waitForFollowUps` | boolean | Opt-in completion hold (default `false`). When `true`, the consumer should hold the session open at completion to receive in-session follow-ups instead of finalizing. See [Completion hold](#completion-hold-waitforfollowups). |
| `workspace.urlKey` | string | Workspace identifier |
| `dispatchedAt` | string | ISO 8601 timestamp when item was queued |
| `dispatchedBy` | string | Account ID of who dispatched (nullable) |
| `expiresAt` | string | ISO 8601 timestamp when item expires |

## Follow-ups

A **follow-up** resumes an existing session instead of starting a fresh one. It is an
ordinary queue item that carries one extra field:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `followUpTo` | string (UUID) | No | The `id` of the original dispatch whose session should be resumed. |
| `force` | boolean | No (default `false`) | Override the consumer's active-session guard so a wedged/sleeping session is resumed instead of being rejected by the busy-session check. Only meaningful with `followUpTo`. |

When set, `prompt` is delivered as a follow-up instruction to the session that handled
the original dispatch. The dispatch store records and forwards `followUpTo` verbatim —
it owns no session identity or liveness; the **consumer** maps `followUpTo` back to its
live session (the dispatch runner keys this off the `id` it received from
`POST /take/:itemId`).

**Rules and constraints:**

- **cli/web only.** Follow-ups are rejected (`400`) for `dash`/`local` targets — only
  CLI and web consumers run resumable sessions. Omit `target` (defaults to `cli`) or set
  it to `web`.
- **Same workspace.** A follow-up must be dispatched to the same workspace as the
  original; cross-workspace resume is undefined.
- **Optional and validated.** `followUpTo` must be a well-formed UUID when present; it is
  otherwise omitted. The store does **not** verify the referenced item still exists.
- **The session can be gone.** Consumers reap terminal sessions, so the target may no
  longer be live. When it cannot resume, the consumer posts terminal
  `[failed] no live session to resume` feedback and the item leaves the queue — surface
  this like any other failed dispatch rather than assuming success.
- **`force` overrides the active-session guard.** A normal follow-up is refused when the
  target session is still busy in an active phase (the consumer's liveness gate guards
  against colliding with a running process). Set `force: true` to bypass that guard and
  resume anyway — it asserts the prior process is effectively dead (wedged on Claude infra
  wobble, or parked in a long `sleep`). It is **only** meaningful alongside `followUpTo`:
  `force: true` without a `followUpTo` is rejected (`400`). The consumer reads it as
  `item.force` off the polled/claimed item. (Liveness contract: LIN-546; API plumbing: LIN-559.)

**Sending a follow-up** (dispatch a custom item, then a second referencing its `id`):

```bash
# 1. Dispatch the original
ORIG=$(curl -s -X POST "$BASE/api/proxy/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt": "Implement the thing", "target": "cli"}' | jq -r .id)

# 2. Dispatch a follow-up to that session
curl -s -X POST "$BASE/api/proxy/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"prompt\": \"Now confirm CI is green and report the run URL\", \"followUpTo\": \"$ORIG\"}"

# 2b. Or force-resume a session that is wedged/sleeping (bypasses the busy-session guard)
curl -s -X POST "$BASE/api/proxy/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"prompt\": \"Pick this back up\", \"followUpTo\": \"$ORIG\", \"force\": true}"
```

## Aborting a session

An **abort** asks the consumer to cancel/close an existing session instead of running a
prompt. It is an ordinary queue item that carries two extra fields and **no** `prompt`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `abort` | boolean | No (default `false`) | When `true`, this item is an abort request, not a prompt. |
| `abortTo` | string (UUID) | Yes, when `abort` is `true` | The `id` of the dispatch whose session should be cancelled. |

When set, the consumer maps `abortTo` back to its live session and flips it to a terminal
cancelled state (closing the host window where applicable). The dispatch store records
and forwards `abort`/`abortTo` verbatim — it owns no session identity or liveness; the
**consumer** resolves the target.

**Rules and constraints (note the contrast with `followUpTo`):**

- **No prompt required.** An abort carries no prompt; `prompt` is optional and ignored.
  `abortTo` is required and must be a well-formed UUID.
- **The abort item's OWN target governs eligibility.** The abort item is itself polled
  like any other dispatch, so its **own** `target` must be poll-eligible (`cli`, `web`,
  or `dash`; defaults to `cli`). This is **independent of the substrate of the session
  being aborted** — you can abort a `dash` session with a `cli` abort item. Unlike
  `followUpTo`, there is **no** `cli`/`web`-only restriction; `local` is rejected because
  Harbour OS spawns server-side and is never polled.
- **Mutually exclusive with `followUpTo`.** An item carrying both `abort` and `followUpTo`
  is rejected (`400`) — resume and cancel are opposite verbs.
- **The session can be gone.** As with follow-ups, the target may no longer be live; the
  store does **not** verify the referenced dispatch exists. The consumer owns liveness.

**Sending an abort** (dispatch a task, then abort its session by `id`):

```bash
# 1. Dispatch the original
ORIG=$(curl -s -X POST "$BASE/api/proxy/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt": "Implement the thing", "target": "cli"}' | jq -r .id)

# 2. Abort that session (no prompt needed)
curl -s -X POST "$BASE/api/proxy/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"abort\": true, \"abortTo\": \"$ORIG\"}"
```

### Cascade close (closing a session subtree)

A plain abort closes exactly one session. A **cascade** closes a whole session subtree in
one call — the root session **plus** every worker and child-autopilot descended from it.
It is a boolean modifier on an abort:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cascade` | boolean | No (default `false`) | When `true`, `abortTo` names the **root** session of a subtree. Harbour deterministically walks the descendant `sessionId`-tree and emits one ordinary abort per discovered session. Requires `abort: true`; mutually exclusive with `force`. |

Harbour owns the walk (the lineage lives only in its store); the **consumer** still executes
each cancel exactly as for a plain single abort. A cascade request returns the expanded set
rather than a single queued item:

```json
{ "success": true, "cascade": true,
  "closed": [ { "id": "<abort-item-id>", "abortTo": "<session-id>", "target": "cli" }, ... ],
  "count": 3 }
```

**Rules and constraints:**

- **`abort` is required.** `cascade: true` without `abort: true` is rejected (`400`). The
  root's own `abortTo` must be a well-formed UUID like any abort.
- **The emitted aborts are ordinary and plain.** Each carries `abort`/`abortTo` and the
  inherited `target`, but **no** `prompt`, **no** `sessionId`, and **no** `force` — so a
  consumer that only understands single aborts handles them unchanged.
- **Human-continued sessions are skipped, not closed.** When a plain cascade abort targets a
  session a human has continued, the consumer must **refuse** the cancel and post a distinct
  terminal-benign marker `[skipped] human-continued session <id> (<phase>).` instead of
  `[aborted]`. A `[skipped]` is terminal but benign: the session is still live — do **not**
  retry it, do **not** treat it as `[aborted]`, and do **not** wake an up-chain parent.
- **`force` is the deliberate override, and only on a single abort.** To close a
  human-continued session on purpose, send a **single** targeted abort with `force: true`
  (not a cascade). `force` + `cascade` together is rejected (`400`) — a cascade always emits
  plain, unforced aborts.
- **Idempotent.** Aborting an already-terminal/reaped session is a safe no-op; re-issuing a
  cascade re-emits harmless aborts.

```bash
# Close a whole autopilot session subtree by its ROOT session id.
curl -s -X POST "$BASE/api/proxy/dispatch" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"abort\": true, \"abortTo\": \"$ROOT_SESSION_ID\", \"cascade\": true}"
```

> **Mechanism only (not yet auto-triggered).** This capability ships available but INERT:
> no autopilot disposition issues a cascade at end-of-run yet — that end-of-run trigger is a
> separate, human-gated step. A consumer/operator can call it explicitly today.

## Autopilot sessions

An autopilot run is a single orchestrator dispatch that fans out many **worker**
dispatches (one per task it works). Because a run that descends into an epic or spawns
new issues via `breakdown` spreads its workers across many `issueIdentifier`s, the
workers cannot be regrouped into one run by issue alone. `sessionId` carries that link:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string (opaque) | No | The `id` of the autopilot dispatch that spawned this worker, or any opaque grouping key. |

The autopilot stamps its own dispatch id as `sessionId` on every worker it dispatches;
the dashboard then reconstructs the run as one **session** (the autopilot dispatch plus
all dispatches sharing its `sessionId`). The store records and forwards `sessionId`
verbatim — it owns no grouping logic.

**Rules and constraints (note the contrast with `followUpTo`):**

- **Any target.** Unlike `followUpTo`, `sessionId` has **no** `cli`/`web` restriction —
  a session groups workers regardless of target.
- **Optional, and an opaque string — not a UUID** (LIN-1118). Any non-empty string of up
  to **128 characters** with no control characters is accepted, so a deterministic,
  readable id like `LIN-1117-autopilot-standalone-2026-07-07` is as valid as a UUID and
  far easier to trace through logs. `__meta__` is **reserved** (it collides with the
  observation store's backfill marker). Existing UUID values remain valid — this is a
  relaxation, not a migration. The store does **not** verify the referenced autopilot
  dispatch exists.
- **Independent of `followUpTo`.** The two are orthogonal: a worker may both resume a
  session (`followUpTo`) and belong to an autopilot run (`sessionId`).
- **A `sessionId` that is not a real dispatch id cannot receive an up-chain wake.** The
  `subscription` edge below wakes a parent by re-dispatching to the parent's `sessionId`
  as a follow-up target, which only resolves when that value *is* a live dispatch id. A
  synthetic or composite `sessionId` still groups perfectly, but an `everything`
  subscription pointed at one dead-ends at the runner (`[failed] no live session to
  resume`). Use a real dispatch id when you want the wake; use whatever you like when you
  only want the grouping.

## Completion hold (`waitForFollowUps`)

`waitForFollowUps` is an **opt-in completion hold**, distinct from `followUpTo`: it is set
on the *original* dispatch (not a later one) to tell the consumer how that session should
behave when its work completes.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `waitForFollowUps` | boolean | No | When `true`, hold the session open at completion to receive in-session follow-ups (beats) instead of finalizing. Default `false`. |

The dispatch store records and forwards `waitForFollowUps` verbatim — it owns no behaviour;
the **consumer/runner** owns the hold. The flag exists so the *launcher*, which knows the
session's role, can choose at dispatch time:

- **Set `true` for a worker** you intend to keep feeding follow-ups in-session — it holds at
  completion and takes the next beat without a cold restart, keeping its context.
- **Leave it `false` (omit) for an orchestrator / sub-orchestrator** — a producer that runs
  its own loop must finalize normally and stay free to watch. Holding a producer open leaves
  it non-terminal and can deadlock (a producer waiting on a follow-up to itself while its
  worker waits to be fed, neither terminal so no watch fires). Unflagged, a stalled producer
  goes terminal and its driver can resume it.

**Rules and constraints:**

- **cli/web only.** Resumable in-session holds apply to CLI and web consumers; `dash`/`local`
  consumers ignore the flag.
- **Boolean and validated.** `waitForFollowUps` must be a boolean when present (`400`
  otherwise); any non-`true` value stores as the default `false`.
- **Pairs with the watch.** A held worker stays healthy only if its next beat arrives inside
  its hold budget — keep the long-poll on the dispatch watch live so beats are delivered
  promptly; an unflagged producer instead relies on the ordinary async-wait/watch path.

## Execution model (`model`)

`model` lets a dispatch specify **which model the consumer/runner should use to *run* the
prompt** — the value it passes to its own agent CLI (e.g. `claude --model`). It is optional
and nullable; omit it (or send `null`) to keep the consumer's current default (e.g. Opus).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | No | Execution model, OpenRouter `provider/model` convention (e.g. `"anthropic/claude-opus-4.8"`). `null`/omitted ⇒ consumer default. |

**Execution model ≠ generation model.** This is the model that *runs* the dispatched work,
**not** the server-side model that *writes* prompts (recommendation / recap / brief). They
live in different namespaces — do not confuse the dispatch `model` with the recommendation
engine's model list.

- **Wire convention: OpenRouter IDs.** Use `provider/model` identifiers like
  `anthropic/claude-opus-4.8` or `openai/gpt-5.4-mini` — the same convention the
  recommendation engine uses internally. This gives the field a documented, consistent shape.
- **Opaque at the server boundary.** The dispatch store records and forwards `model`
  verbatim. Validation is deliberately **loose** — a string within the length limit and free
  of dangerous control characters. The server does **not** enforce a model registry, because
  consumers may support models the server never enumerates.
- **Translation lives in the consumer.** OpenRouter-native runners accept these IDs directly
  (pass-through). Claude Code is the outlier and maps e.g. `anthropic/claude-opus-4.8` →
  `--model opus` itself. Keep agent-specific translation in the runner so the wire format
  stays agent-agnostic.
- **Inert until the runner reads it.** A server-side `model` is a no-op until the (external)
  consumer reads `item.model` and passes it to its CLI; a `null` value preserves today's
  default behaviour, so existing runners are unaffected. Context-window variants
  (e.g. Opus vs Opus 1m) are a consumer-vocabulary concern expressible as distinct IDs — no
  schema change.

Both dispatch write verbs accept `model`: `POST /api/dispatch` (user/UI) and, on the proxy,
`POST /api/proxy/dispatch` and `POST /api/proxy/recommend-and-dispatch`. Setting it per task
is how an orchestrator routes cheaper models where they suffice (e.g. Sonnet for
implementation, Opus for review).

## Harness (`harness`)

`harness` lets a dispatch specify **which harness the consumer/runner should use to *run* the
prompt** — e.g. `"claude-code"` (the default in Simple Dispatcher today) or `"opencode"`
(which can run any OpenRouter-backed model). It is optional and nullable; omit it (or send
`null`) to keep the consumer's own default.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `harness` | string | No | Execution harness, e.g. `"claude-code"`, `"opencode"`. `null`/omitted ⇒ consumer default. |

- **Opaque at the server boundary, same rigor as `model`.** The dispatch store records and
  forwards `harness` verbatim. Validation is the same loose opaque-string check used for
  `model` — a string within the length limit and free of dangerous control characters — via
  the shared `validateOpaqueDispatchField` helper both fields route through. The server does
  **not** enforce a harness registry; the consumer owns which harnesses it actually supports.
- **Pairs with `model`.** A harness typically determines which models are even reachable —
  e.g. `harness: "opencode"` combined with `model: "openrouter/<provider-model>"` runs a
  specific OpenRouter-backed model through the OpenCode harness instead of the default
  Claude Code harness:
  ```json
  {
    "prompt": "...",
    "harness": "opencode",
    "model": "openrouter/anthropic/claude-opus-4.8"
  }
  ```
- **Harbour-side default tier (LIN-1094).** Harbour resolves a blank incoming `model`/
  `harness` against workspace-configured dispatch defaults (Settings → Dispatch defaults)
  before the item ever reaches the queue: a per-prompt-`kind` override wins, then the
  workspace-wide default, then `null` — each field resolved independently. With no defaults
  configured this is byte-identical to the prior pass-through behaviour. The consumer's own
  payload → per-workspace-default → global-default precedence chain still applies on top of
  whatever value Harbour hands it (including `null`) — the two tiers compose rather than
  conflict.
- **Inert until the runner reads it.** A server-side `harness` is a no-op until the (external)
  consumer reads `item.harness` and routes the prompt accordingly; a `null` value preserves
  today's default behaviour, so existing runners are unaffected.

Both dispatch write verbs accept `harness`, mirroring `model`: `POST /api/dispatch` (user/UI)
and, on the proxy, `POST /api/proxy/dispatch` and `POST /api/proxy/recommend-and-dispatch`.

## Dispatch-time UI (model/harness)

Every user-facing surface that can dispatch a prompt exposes the same `model`/`harness`
controls (LIN-1096) — a harness select-or-custom pair plus a free-text model input — so a
one-off override doesn't require a trip through Settings first: the Dispatch page, the
dashboard tree's per-task Dispatch disclosure, the shared prompt-compose section (Swipe),
and the Suggested-next-run accept flow. Leaving both fields blank omits them from the
payload entirely, so the Harbour-side default tier above (and then the consumer's own
defaulting) applies exactly as if the fields were never shown. Where a workspace-wide
default is already resolved server-side (currently: the Dispatch page), the controls'
placeholder text names it, so blank visibly means "inherit" rather than "no opinion". The
session follow-up reply box and Collective's fan-out carry no dedicated control — they
inherit the same server-side default resolution automatically.

## Target Routing

Each dispatch item has a `target` field indicating which type of consumer should process it:

| Target | Description |
|--------|-------------|
| `cli` | Default. Intended for CLI-based consumers (e.g., Claude Code) |
| `web` | Intended for web-based consumers (e.g., Claude on the Web) |
| `dash` | Intended for dashboard-based consumers (e.g., Dash agent) |
| `local` | Spawns a local Harbour OS Claude session on the server host. Localhost-only: a `local` dispatch from a non-localhost request is rejected with `400` |

> **Proxy consumers cannot use `local`.** The four targets above are the dispatch consumer API's full set, but the [Workspace API Proxy](proxy-integration.md) twin (`POST /api/proxy/dispatch`) explicitly bars `local` — proxy-issued dispatches may only target `cli`/`web`/`dash`. Keep this asymmetry in mind when porting a flow between the two surfaces.

The UI provides a grouped button bar: **Dispatch: [cli] [web] [dash] [copy]**
- **"cli"** — sends with `target: "cli"`
- **"web"** — sends with `target: "web"`
- **"dash"** — sends with `target: "dash"`
- **"copy"** — copies prompt to clipboard (no dispatch)

Consumers should filter poll results by target to only process items intended for them:

```javascript
const { items } = await pollRes.json();
const myItems = items.filter(item => item.target === 'cli'); // or 'web', 'dash'
```

Items without a `target` field default to `"cli"` for backward compatibility.

## Task Kind

Each dispatch item carries a `kind` — a stable, machine-readable classification of
*what sort of task* it is. Watchers (e.g. an orchestrator following a task across
dispatches) read `kind` directly instead of inferring the task type from `promptName`
(a free-form display name) or the prompt body.

The vocabulary is **not** a fixed literal list — it is `DISPATCH_KINDS`, derived in
`lib/prompt-templates.js` from the prompt-template keys the system already owns plus a
neutral `custom` fallback (and a few meta-kinds). Treat `lib/prompt-templates.js` as the
source of truth rather than hard-coding the set; the server validates against
`DISPATCH_KINDS` and a rejected value reports the current list in its `400` message.

- **Optional on dispatch.** Callers may pass an explicit `kind`; it must be one of
  `DISPATCH_KINDS` or the request is rejected with `400` (the error message lists the
  accepted values).
- **Derived when omitted.** If `kind` is not supplied it is derived from `promptName`
  (matching the template key or its display name, case-insensitive) — e.g. `promptName`
  `"implement"` → `kind` `"implementation"`, `"code review"` → `"code-review"`.
- **Falls back to `"custom"`** for freeform prompts that don't map to a template.

This is the same vocabulary the Pipeline view uses for a Loop's `stage`.

## Error Handling

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Missing or invalid Authorization header` | No Bearer token provided |
| 401 | `Empty token` | Token value is empty |
| 401 | `Invalid or expired token` | Token doesn't exist or was revoked |
| 400 | `Invalid item ID format` | Item ID is not a valid UUID |
| 404 | `Item not found or already taken` | Item doesn't exist, expired, or was claimed |
| 404 | `Item not found or feedback not allowed` | Item doesn't exist, not taken, or wrong token |
| 429 | `Too many feedback requests` | Rate limit exceeded (~100/min) |
| 500 | `Failed to poll dispatch queue` | Server error |

## Building a Consumer

### Basic Polling Loop (Node.js)

```javascript
const POLL_INTERVAL = 5000; // 5 seconds
const API_BASE = 'https://your-instance.com';
const TOKEN = process.env.DISPATCH_TOKEN;

async function pollAndProcess() {
  try {
    // Poll for available items
    const pollRes = await fetch(`${API_BASE}/api/dispatch/poll`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });

    if (!pollRes.ok) {
      console.error('Poll failed:', pollRes.status);
      return;
    }

    const { items } = await pollRes.json();

    for (const item of items) {
      // Attempt to take the item atomically
      const takeRes = await fetch(`${API_BASE}/api/dispatch/take/${item.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });

      if (takeRes.status === 404) {
        // Already taken by another consumer
        continue;
      }

      if (!takeRes.ok) {
        console.error('Take failed:', takeRes.status);
        continue;
      }

      const { item: claimed, dispatchId } = await takeRes.json();

      // Process the claimed item. Pass dispatchId through to processPrompt
      // if you also write foreman status entries — see "Forwarding dispatchId
      // to foreman status" above.
      await processPrompt(claimed, dispatchId);
    }
  } catch (err) {
    console.error('Consumer error:', err);
  }
}

async function processPrompt(item) {
  console.log(`Processing: ${item.promptName} (${item.issueIdentifier || 'no issue'})`);
  console.log(`Prompt: ${item.prompt}`);

  // Post feedback to report progress
  await fetch(`${API_BASE}/api/dispatch/feedback/${item.id}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: 'Working on it...' })
  });

  // Your processing logic here
  const result = await doWork(item);

  // Post completion feedback with a link
  await fetch(`${API_BASE}/api/dispatch/feedback/${item.id}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Created pull request',
      url: result.prUrl,
      urlLabel: `PR #${result.prNumber}`
    })
  });
}

// Start polling loop
setInterval(pollAndProcess, POLL_INTERVAL);
pollAndProcess(); // Initial poll
```

### Bash/curl Consumer

```bash
#!/bin/bash
TOKEN="your-token-here"
API_BASE="https://your-instance.com"

while true; do
  # Poll for items
  ITEMS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API_BASE/api/dispatch/poll")

  # Extract item IDs (requires jq)
  for ID in $(echo "$ITEMS" | jq -r '.items[].id'); do
    # Attempt to take
    RESULT=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
      "$API_BASE/api/dispatch/take/$ID")

    if echo "$RESULT" | jq -e '.item' > /dev/null 2>&1; then
      PROMPT=$(echo "$RESULT" | jq -r '.item.prompt')
      ISSUE=$(echo "$RESULT" | jq -r '.item.issueIdentifier // "no-issue"')
      echo "Processing $ISSUE: $PROMPT"
      # Your processing here
    fi
  done

  sleep 5
done
```

## Best Practices

1. **Always use `take` for processing** - Don't process items based on `poll` results alone; another consumer may claim them first.

2. **Handle 404 gracefully** - A 404 on `take` means the item was already claimed. This is expected in multi-consumer setups.

3. **Implement exponential backoff** - If you receive repeated errors, back off to avoid overwhelming the server.

4. **Log the item ID** - Always log the item ID when processing for debugging and auditing.

5. **Respect TTL** - Items expire after 24 hours. Don't cache poll results for extended periods.

6. **Secure your token** - Store tokens in environment variables or secret management systems, never in code.

## Token Security

- Tokens have 256 bits of entropy (cryptographically secure)
- Only the SHA-256 hash is stored server-side
- Tokens never expire but can be revoked
- Each token is scoped to a single workspace
- Validation hashes the presented token and looks the hash up in the database (an exact-match query). There is no constant-time string compare — timing is a non-concern because the lookup keys off the hash, not a byte-by-byte comparison of the raw token

## Rate Limits

Some endpoints are rate-limited per IP: feedback (`POST /api/dispatch/feedback/:itemId`) is
capped at 100 requests/minute, and the user-facing queue and token-creation endpoints have
their own limits. The consumer poll/take endpoints are not currently rate-limited, but
consumers should still:
- Poll at reasonable intervals (5-30 seconds recommended)
- Avoid aggressive retry loops on errors
- Consider implementing circuit breakers for resilience
