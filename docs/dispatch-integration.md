# Dispatch API Integration Guide

This guide explains how to build a consumer service that receives prompts from the Linear Viewer dispatch queue.

## Overview

The Dispatch API allows external consumers (AI agents, automation tools, custom services) to receive prompts queued from the Linear Viewer. Users dispatch prompts from the web interface, and consumers poll for and claim those prompts for processing.

**Key features:**
- Token-based authentication for consumers
- Atomic take/claim operations (prevents duplicate processing)
- 24-hour TTL with automatic cleanup
- Workspace isolation (tokens are scoped to a single workspace)

## Quick Start

```bash
# 1. Poll for available items
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/dispatch/poll

# 2. Take an item atomically
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/dispatch/take/ITEM_ID
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
      "promptName": "Blocker Analysis",
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
    "promptName": "Blocker Analysis",
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
}
```

**Error Response (404):**
```json
{
  "error": "Item not found or already taken"
}
```

## Queue Item Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique item ID (UUID) |
| `prompt` | string | The prompt text (up to 100KB) |
| `promptName` | string | Display name (e.g., "Blocker Analysis") |
| `issueId` | string | Linear issue UUID (nullable) |
| `issueIdentifier` | string | Human-readable issue ID, e.g., "LIN-42" (nullable) |
| `issueTitle` | string | Issue title (nullable) |
| `issueUrl` | string | Full URL to the Linear issue (nullable) |
| `workspace.urlKey` | string | Workspace identifier |
| `dispatchedAt` | string | ISO 8601 timestamp when item was queued |
| `dispatchedBy` | string | Linear user ID who dispatched (nullable) |
| `expiresAt` | string | ISO 8601 timestamp when item expires |

## Error Handling

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `Missing or invalid Authorization header` | No Bearer token provided |
| 401 | `Empty token` | Token value is empty |
| 401 | `Invalid or expired token` | Token doesn't exist or was revoked |
| 400 | `Invalid item ID format` | Item ID is not a valid UUID |
| 404 | `Item not found or already taken` | Item doesn't exist, expired, or was claimed |
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

      const { item: claimed } = await takeRes.json();

      // Process the claimed item
      await processPrompt(claimed);
    }
  } catch (err) {
    console.error('Consumer error:', err);
  }
}

async function processPrompt(item) {
  console.log(`Processing: ${item.promptName} (${item.issueIdentifier || 'no issue'})`);
  console.log(`Prompt: ${item.prompt}`);
  // Your processing logic here
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
