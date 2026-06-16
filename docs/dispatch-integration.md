# Dispatch API Integration Guide

This guide explains how to build a consumer service that receives prompts from the Linear Viewer dispatch queue.

## Overview

The Dispatch API allows external consumers (AI agents, automation tools, custom services) to receive prompts queued from the Linear Viewer. Users dispatch prompts from the web interface, and consumers poll for and claim those prompts for processing.

**Key features:**
- Token-based authentication for consumers
- Atomic take/claim operations (prevents duplicate processing)
- 24-hour TTL with automatic cleanup
- Workspace isolation (tokens are scoped to a single workspace)
- Target-based routing (`cli`, `web`, or `dash`) so consumers only process items meant for them

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
      "dispatchedBy": "linear-user-id",
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
    "dispatchedBy": "linear-user-id",
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
- Rate limited to ~100 requests per minute per token

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
| `target` | string | Dispatch target: `"cli"` (default), `"web"`, or `"dash"` |
| `followUpTo` | string | The `id` of an earlier dispatch whose session this item should resume, or `null`. See [Follow-ups](#follow-ups) (nullable) |
| `workspace.urlKey` | string | Workspace identifier |
| `dispatchedAt` | string | ISO 8601 timestamp when item was queued |
| `dispatchedBy` | string | Linear user ID who dispatched (nullable) |
| `expiresAt` | string | ISO 8601 timestamp when item expires |

## Follow-ups

A **follow-up** resumes an existing session instead of starting a fresh one. It is an
ordinary queue item that carries one extra field:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `followUpTo` | string (UUID) | No | The `id` of the original dispatch whose session should be resumed. |

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
```

## Target Routing

Each dispatch item has a `target` field indicating which type of consumer should process it:

| Target | Description |
|--------|-------------|
| `cli` | Default. Intended for CLI-based consumers (e.g., Claude Code) |
| `web` | Intended for web-based consumers (e.g., Claude on the Web) |
| `dash` | Intended for dashboard-based consumers (e.g., Dash agent) |

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

The vocabulary is the set of prompt-template keys the system already owns
(`lib/prompt-template-defs.js`) plus a neutral fallback:

```
blocked, bug, plan, code-review, look-into, triage, breakdown,
research, scoping, design, spike, context, implementation, review, custom
```

- **Optional on dispatch.** Callers may pass an explicit `kind`; it must be one of the
  values above or the request is rejected with `400`.
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
- Token validation uses timing-safe comparison

## Rate Limits

Currently no rate limits are enforced, but consumers should:
- Poll at reasonable intervals (5-30 seconds recommended)
- Avoid aggressive retry loops on errors
- Consider implementing circuit breakers for resilience
