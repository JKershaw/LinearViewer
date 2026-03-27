# Proxy API Integration Guide

This guide explains how to build a consumer that interacts with a Linear workspace through the Linear Viewer proxy API.

## Overview

The Proxy API allows external consumers (AI agents, automation tools, custom services) to read and write Linear data on behalf of a workspace. Users create proxy tokens from the web interface, and consumers use those tokens to query issues, create tasks, manage labels, view cycles, and more.

**Key features:**
- Token-based authentication (Bearer tokens)
- Read/write scope separation (`read` for queries, `readWrite` for mutations)
- Single-use token support (consumed after first request)
- Full Linear CRUD: issues, comments, relations, labels, cycles
- Event audit logging (all API calls tracked with 30-day retention)
- Rate limiting (60 requests/minute per IP)
- Workspace isolation (tokens are scoped to a single workspace)

## Quick Start

```bash
# 1. Get agent-readable API documentation
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/proxy/instructions

# 2. List issues
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/proxy/issues?limit=10

# 3. Get full issue detail
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-instance.com/api/proxy/issue/LIN-42

# 4. Add a comment (requires readWrite token)
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Analysis complete. See PR #42."}' \
  https://your-instance.com/api/proxy/issue/ISSUE_UUID/comments
```

## Authentication

### Getting a Token

Tokens are created by authenticated users in the Linear Viewer proxy page:

1. Log into Linear Viewer
2. Navigate to the Proxy page (`/workspace/:urlKey/proxy`)
3. Choose a scope (`read` or `readWrite`) and create a token
4. **Save the token immediately** — it's only shown once

Alternatively, tokens can be created via API (requires session authentication):

```
POST /workspace/:urlKey/api/proxy/tokens
Content-Type: application/json

{ "label": "My Agent", "scope": "readWrite" }
```

Response:
```json
{
  "tokenId": "uuid",
  "token": "base64url-encoded-token",
  "label": "My Agent",
  "scope": "readWrite",
  "singleUse": false,
  "message": "Token created. Save this token now - it cannot be retrieved later."
}
```

### Token Scopes

| Scope | Access |
|-------|--------|
| `read` | Query all read endpoints (issues, teams, projects, cycles, labels, etc.) |
| `readWrite` | All read access plus create/update issues, comments, relations, labels |

### Single-Use Tokens

Pass `"singleUse": true` when creating a token. The token is consumed after its first successful request and cannot be used again.

### Using the Token

Include the token in the `Authorization` header:

```
Authorization: Bearer YOUR_TOKEN
```

## Consumer API Endpoints

### Read Endpoints

#### Get Instructions

Returns agent-readable API documentation with the full endpoint list and examples, customized for your token scope.

```
GET /api/proxy/instructions
```

#### Get Current User

```
GET /api/proxy/me
```

Response:
```json
{
  "id": "uuid",
  "name": "Alice",
  "email": "alice@example.com"
}
```

#### List Teams

```
GET /api/proxy/teams
```

Response:
```json
{
  "teams": [
    { "id": "uuid", "name": "Engineering", "key": "ENG" }
  ]
}
```

#### List Projects

Returns active projects (state = "started").

```
GET /api/proxy/projects
```

Response:
```json
{
  "projects": [
    { "id": "uuid", "name": "Project Alpha", "content": "Description...", "url": "https://linear.app/..." }
  ]
}
```

#### List Issues

```
GET /api/proxy/issues?teamId={uuid}&limit={n}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `teamId` | UUID | No | Filter by team |
| `limit` | int | No | Max results (1-250, default 50) |

Response includes pagination:
```json
{
  "issues": [
    {
      "id": "uuid",
      "identifier": "ENG-42",
      "title": "Fix login bug",
      "description": "...",
      "url": "https://linear.app/...",
      "state": { "name": "In Progress", "type": "started" },
      "assignee": { "name": "Alice" },
      "labels": { "nodes": [{ "id": "uuid", "name": "bug", "color": "#eb5757" }] },
      "priority": 1,
      "dueDate": "2024-03-01",
      "parent": { "id": "uuid", "identifier": "ENG-40" },
      "project": { "id": "uuid", "name": "Project Alpha" },
      "cycle": { "id": "uuid", "name": "Sprint 5", "number": 5 }
    }
  ],
  "pageInfo": {
    "hasNextPage": true,
    "endCursor": "cursor-string"
  }
}
```

#### Get Issue Detail

```
GET /api/proxy/issue/{issueId}
```

`issueId` can be a UUID or identifier (e.g., `LIN-123`).

Response includes full context: description, comments, children, relations, cycle, and labels with id/name/color.

#### Search Issues

```
GET /api/proxy/search?q={query}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search text (max 500 chars) |

Returns up to 50 matching issues.

#### List Workflow States

```
GET /api/proxy/states/{teamId}
```

Response:
```json
{
  "states": [
    { "id": "uuid", "name": "Backlog", "type": "backlog", "position": 0 },
    { "id": "uuid", "name": "Todo", "type": "unstarted", "position": 1 },
    { "id": "uuid", "name": "In Progress", "type": "started", "position": 2 },
    { "id": "uuid", "name": "Done", "type": "completed", "position": 3 }
  ]
}
```

#### List Labels

```
GET /api/proxy/labels?teamId={uuid}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `teamId` | UUID | No | Filter by team |

Response:
```json
{
  "labels": [
    { "id": "uuid", "name": "bug", "color": "#eb5757", "team": { "id": "uuid", "name": "Engineering" } }
  ]
}
```

#### List Cycles

```
GET /api/proxy/cycles?teamId={uuid}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `teamId` | UUID | No | Filter by team |

Response:
```json
{
  "cycles": [
    {
      "id": "uuid",
      "name": "Sprint 5",
      "number": 5,
      "startsAt": "2024-03-01T00:00:00.000Z",
      "endsAt": "2024-03-15T00:00:00.000Z",
      "team": { "id": "uuid", "name": "Engineering" }
    }
  ]
}
```

#### Get Cycle Detail

```
GET /api/proxy/cycle/{cycleId}
```

Response includes issues, progress, and scope history:
```json
{
  "id": "uuid",
  "name": "Sprint 5",
  "number": 5,
  "description": "Focus on auth improvements",
  "startsAt": "2024-03-01T00:00:00.000Z",
  "endsAt": "2024-03-15T00:00:00.000Z",
  "completedAt": null,
  "progress": 0.6,
  "team": { "id": "uuid", "name": "Engineering" },
  "issues": {
    "nodes": [
      { "id": "uuid", "identifier": "ENG-42", "title": "Fix login", "state": { "name": "Done", "type": "completed" }, "assignee": { "name": "Alice" }, "priority": 1 }
    ]
  }
}
```

#### Get Issue Relations

```
GET /api/proxy/relations/{issueId}
```

Response:
```json
{
  "relations": [
    { "type": "blocks", "relatedIssue": { "id": "uuid", "identifier": "ENG-43", "title": "...", "state": { "name": "Todo", "type": "unstarted" } } }
  ],
  "inverseRelations": [
    { "type": "blocks", "issue": { "id": "uuid", "identifier": "ENG-41", "title": "...", "state": { "name": "Done", "type": "completed" } } }
  ]
}
```

### Write Endpoints

All write endpoints require a `readWrite` scoped token. Read-only tokens receive `403`.

#### Create Issue

```
POST /api/proxy/issues
Content-Type: application/json

{
  "teamId": "uuid",
  "title": "Fix authentication bug",
  "description": "Details...",
  "projectId": "uuid",
  "stateId": "uuid",
  "assigneeId": "uuid",
  "parentId": "uuid",
  "cycleId": "uuid",
  "priority": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `teamId` | UUID | Yes | Team to create issue in |
| `title` | string | Yes | Issue title (max 1000 chars) |
| `description` | string | No | Markdown description (max 100K chars) |
| `projectId` | UUID | No | Assign to project |
| `stateId` | UUID | No | Set workflow state |
| `assigneeId` | UUID | No | Assign to user |
| `parentId` | UUID | No | Set parent issue |
| `cycleId` | UUID | No | Assign to cycle |
| `priority` | int | No | Priority 0 (none) to 4 (urgent) |

#### Update Issue

```
PATCH /api/proxy/issue/{issueId}
Content-Type: application/json

{
  "title": "Updated title",
  "stateId": "uuid",
  "cycleId": "uuid"
}
```

Accepts the same fields as create (except `teamId`). At least one field must be provided.

#### Add Comment

```
POST /api/proxy/issue/{issueId}/comments
Content-Type: application/json

{ "body": "Investigation complete. Root cause identified." }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | string | Yes | Comment body in Markdown (max 50K chars) |

#### Create Relation

```
POST /api/proxy/issue/{issueId}/relations
Content-Type: application/json

{ "type": "blocks", "relatedIssueId": "uuid" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `blocks`, `blocked-by`, `duplicate`, or `related` |
| `relatedIssueId` | UUID/identifier | Yes | The related issue |

Note: `blocked-by` is a convenience type — internally it creates a `blocks` relation with swapped issue IDs.

#### Add Label

```
POST /api/proxy/issue/{issueId}/labels
Content-Type: application/json

{ "labelId": "uuid" }
```

Uses the label UUID (get from `GET /api/proxy/labels`). Idempotent — returns success if label is already present.

Note: Uses Read-Modify-Write internally. Concurrent label modifications may overwrite each other (Linear API limitation).

#### Remove Label

```
DELETE /api/proxy/issue/{issueId}/labels/{labelId}
```

Idempotent — returns success if label was not present.

## Error Handling

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Various | Invalid input (bad UUID, missing required field, etc.) |
| 401 | `Missing or invalid Authorization header` | No Bearer token provided |
| 401 | `Invalid, expired, or consumed token` | Token doesn't exist, expired, or was single-use and already used |
| 403 | `This endpoint requires a read-write token` | Write endpoint called with read-only token |
| 404 | `Issue not found` / `Cycle not found` | Resource doesn't exist |
| 429 | `Too many proxy requests` | Rate limit exceeded (60/minute) |
| 503 | `Workspace not available` | Workspace access token expired or unavailable |
| 500 | `Failed to ...` | Server error |

## Building a Consumer

### Basic Agent (Node.js)

```javascript
const API_BASE = 'https://your-instance.com';
const TOKEN = process.env.PROXY_TOKEN;

const headers = { 'Authorization': `Bearer ${TOKEN}` };

// Fetch the task stack
const stackRes = await fetch(`${API_BASE}/api/proxy/stack?limit=5`, { headers });
const { tasks } = await stackRes.json();

if (tasks.length === 0) {
  console.log('No tasks available');
  process.exit(0);
}

const task = tasks[0];
console.log(`Working on: ${task.identifier} - ${task.title}`);

// Get issue detail
const issueRes = await fetch(`${API_BASE}/api/proxy/issue/${task.identifier}`, { headers });
const issue = await issueRes.json();

// Get AI-generated prompt
const promptRes = await fetch(`${API_BASE}/api/proxy/recommend/${task.identifier}`, { headers });
const { prompt, reasoning } = await promptRes.json();

console.log(`AI reasoning: ${reasoning}`);
console.log(`Prompt: ${prompt}`);

// Do work, then post results as a comment
await fetch(`${API_BASE}/api/proxy/issue/${issue.id}/comments`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: '## Results\n\nAnalysis complete.' })
});
```

### Bash/curl Consumer

```bash
#!/bin/bash
TOKEN="your-token-here"
API_BASE="https://your-instance.com"
AUTH="Authorization: Bearer $TOKEN"

# List all cycles for a team
CYCLES=$(curl -s -H "$AUTH" "$API_BASE/api/proxy/cycles?teamId=TEAM_UUID")
echo "Active cycles:" && echo "$CYCLES" | jq '.cycles[] | .name'

# Get issues in the current sprint
CYCLE_ID=$(echo "$CYCLES" | jq -r '.cycles[0].id')
CYCLE=$(curl -s -H "$AUTH" "$API_BASE/api/proxy/cycle/$CYCLE_ID")
echo "Issues in cycle:" && echo "$CYCLE" | jq '.issues.nodes[] | "\(.identifier): \(.title)"'

# Create an issue and assign to a cycle
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"teamId\":\"TEAM_UUID\",\"title\":\"New task\",\"cycleId\":\"$CYCLE_ID\"}" \
  "$API_BASE/api/proxy/issues"
```

## Best Practices

1. **Start with `/api/proxy/instructions`** — it returns a complete, up-to-date API reference customized for your token scope.

2. **Use identifiers where supported** — endpoints that accept issue IDs also accept identifiers like `LIN-123`, which are easier to work with.

3. **Check label IDs before adding** — use `GET /api/proxy/labels` to find the UUID, then pass it to the add-label endpoint.

4. **Handle 503 gracefully** — a 503 means the workspace OAuth token has expired. The user needs to re-authenticate in Linear Viewer.

5. **Respect rate limits** — 60 requests/minute per IP. Add backoff on 429 responses.

6. **Use readWrite tokens sparingly** — prefer read-only tokens for monitoring and reporting. Only use readWrite when your agent needs to create or modify data.

## Token Security

- Tokens have 256 bits of entropy (cryptographically secure)
- Only the SHA-256 hash is stored server-side
- Tokens can be revoked at any time from the proxy page
- Each token is scoped to a single workspace
- Single-use tokens are consumed after first successful request
- All API calls are logged in the event audit trail (30-day retention)

## Rate Limits

- **Consumer endpoints:** 60 requests per minute per IP address
- **Token creation:** 10 tokens per 15 minutes per IP address
- Rate limits are enforced before authentication (prevents DoS via auth failures)
- Returns `429` with `Retry-After` header when exceeded
