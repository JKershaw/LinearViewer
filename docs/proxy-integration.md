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
  https://your-instance.com/api/proxy/issues/LIN-42

# 4. Add a comment (requires readWrite token)
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body": "Analysis complete. See PR #42."}' \
  https://your-instance.com/api/proxy/issues/ISSUE_UUID/comments
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
GET /api/proxy/issues/{issueId}
```

`issueId` can be a UUID or identifier (e.g., `LIN-123`).

Response includes full context: description, comments, children, parent, relations, cycle, and labels.

```json
{
  "id": "uuid",
  "identifier": "ENG-42",
  "title": "Fix login bug",
  "description": "Markdown content...",
  "url": "https://linear.app/...",
  "state": { "name": "In Progress", "type": "started" },
  "assignee": { "name": "Alice" },
  "labels": { "nodes": [{ "id": "uuid", "name": "bug", "color": "#eb5757" }] },
  "priority": 1,
  "dueDate": "2024-03-01",
  "project": { "id": "uuid", "name": "Project Alpha" },
  "cycle": { "id": "uuid", "name": "Sprint 5", "number": 5 },
  "parent": { "id": "uuid", "identifier": "ENG-40", "title": "Auth overhaul" },
  "children": { "nodes": [{ "id": "uuid", "identifier": "ENG-43", "title": "Sub-task", "state": { "name": "Todo", "type": "unstarted" } }] },
  "comments": { "nodes": [{ "id": "uuid", "body": "Fixed in PR #12.", "createdAt": "2024-02-28T10:00:00.000Z", "user": { "name": "Bob" } }] }
}
```

`parent` is `null` when the issue has no parent. `children.nodes` is empty (`[]`) when there are no sub-issues. `labels`, `children`, and `comments` use Linear's `{ nodes: [...] }` wrapper.

#### Search Issues

```
GET /api/proxy/search?q={query}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search text (max 500 chars) |

Returns up to 50 matching issues. Response shape matches the list issues endpoint (including the `parent` field). Children are not included in search results — call `GET /api/proxy/issues/{id}` for the full sub-issue hierarchy.

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
  "relations": {
    "nodes": [
      { "id": "rel-uuid", "type": "blocks", "relatedIssue": { "id": "uuid", "identifier": "ENG-43", "title": "...", "state": { "name": "Todo", "type": "unstarted" } } }
    ]
  },
  "inverseRelations": {
    "nodes": [
      { "id": "rel-uuid", "type": "blocks", "issue": { "id": "uuid", "identifier": "ENG-41", "title": "...", "state": { "name": "Done", "type": "completed" } } }
    ]
  }
}
```

`relations` and `inverseRelations` use Linear's `{nodes: [...]}` wrapper, the same convention as `relations` on `/issue/{id}` and `labels`/`children`/`comments` across the read endpoints. `relatedIssue` is the target of an outgoing relation; `issue` is the source of an inverse one (e.g. the issue that blocks this one). Each node's `id` is the relation's own id — pass it to the delete-relation endpoint below.

#### Get Task Recap

```
GET  /api/proxy/recap/{identifier}
POST /api/proxy/recap/{identifier}
```

An AI-generated progress summary (`done` / `pending` / `deviations`). `GET` returns
the cached recap and auto-regenerates when it's missing or stale; pass `?noRefresh=1`
to read without regenerating. `POST` force-regenerates. Both accept a UUID or an
identifier (e.g. `ENG-42`). Read scope is sufficient.

Response:
```json
{
  "status": "fresh",
  "identifier": "ENG-42",
  "recap": { "done": [], "pending": [], "deviations": [] },
  "generatedAt": "2026-04-20T12:00:00Z",
  "model": "anthropic/claude-haiku-4.5"
}
```

With `?noRefresh=1` and no cache, `status` is `"missing"` (or `"stale"`) and the
`recap` field is omitted.

#### Get Task Brief

```
GET  /api/proxy/brief/{identifier}
POST /api/proxy/brief/{identifier}
```

A current-state **brief**: a distilled, present-tense version of the task —
`## Current`, `## Constraints`, `## Open questions`, `## Changelog` — intended as the
starting context for an agent picking up an aged task. As a description grows, drifts,
and pivots, the brief supersedes stale wording and folds in signal from comments and
subtask state; on conflict the most recent/specific signal wins. Read it before
trusting the raw description.

`GET` returns the cached brief and auto-regenerates when missing or stale; pass
`?noRefresh=1` to read without regenerating. `POST` force-regenerates. Both accept a
UUID or an identifier. Read scope is sufficient.

Unlike the other endpoints, `brief` is **fixed-section Markdown**, not structured
fields. The headings are stable, so a consumer can recover individual sections
deterministically while still handing the whole string to an LLM verbatim.

Response:
```json
{
  "status": "fresh",
  "identifier": "ENG-42",
  "brief": "## Current\n...\n## Constraints\n...\n## Open questions\n...\n## Changelog\n...",
  "generatedAt": "2026-04-20T12:00:00Z",
  "model": "anthropic/claude-haiku-4.5"
}
```

With `?noRefresh=1` and no cache, `status` is `"missing"` (or `"stale"`) and the
`brief` field is omitted.

> Both recap and brief share the in-app cache, so an artifact generated in the swipe
> UI is served straight from cache here (and vice versa). Regeneration calls OpenRouter
> and can exceed 25s; the server streams whitespace keepalive bytes inside a single
> `200` response, so don't set a client timeout below ~60s for these endpoints.

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
PATCH /api/proxy/issues/{issueId}
Content-Type: application/json

{
  "title": "Updated title",
  "stateId": "uuid",
  "cycleId": "uuid"
}
```

At least one field must be provided.

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Issue title (max 1000 chars) |
| `description` | string | Markdown description (max 100K chars) |
| `projectId` | UUID | Assign to project |
| `stateId` | UUID | Set workflow state |
| `assigneeId` | UUID | Assign to user |
| `parentId` | UUID \| `null` | Set parent issue (UUID), or `null` to remove the parent and promote the issue to top-level |
| `cycleId` | UUID | Assign to cycle |
| `priority` | int | Priority 0 (none) to 4 (urgent) |

#### Add Comment

```
POST /api/proxy/issues/{issueId}/comments
Content-Type: application/json

{ "body": "Investigation complete. Root cause identified." }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | string | Yes | Comment body in Markdown (max 50K chars) |

#### Create Relation

```
POST /api/proxy/issues/{issueId}/relations
Content-Type: application/json

{ "type": "blocks", "relatedIssueId": "uuid" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `blocks`, `blocked-by`, `duplicate`, or `related` |
| `relatedIssueId` | UUID/identifier | Yes | The related issue |

Note: `blocked-by` is a convenience type — internally it creates a `blocks` relation with swapped issue IDs.

#### Delete Relation

```
DELETE /api/proxy/issues/{issueId}/relations/{relationId}
```

Removes a relation. `relationId` is the relation's own `id` (the `id` field on each node returned by `GET /relations/{issueId}` or `GET /issue/{id}`), **not** an issue id.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issueId` | UUID/identifier | Yes | Issue the relation belongs to (URL consistency; not used to resolve the relation) |
| `relationId` | UUID | Yes | The relation's own id |

Response:
```json
{ "success": true }
```

#### Add Label

```
POST /api/proxy/issues/{issueId}/labels
Content-Type: application/json

{ "labelId": "uuid" }
```

Uses the label UUID (get from `GET /api/proxy/labels`). Idempotent — returns success if label is already present.

Note: Uses Read-Modify-Write internally. Concurrent label modifications may overwrite each other (Linear API limitation).

#### Remove Label

```
DELETE /api/proxy/issues/{issueId}/labels/{labelId}
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
const issueRes = await fetch(`${API_BASE}/api/proxy/issues/${task.identifier}`, { headers });
const issue = await issueRes.json();

// Get AI-generated prompt
const promptRes = await fetch(`${API_BASE}/api/proxy/recommend/${task.identifier}`, { headers });
const { prompt, reasoning } = await promptRes.json();

console.log(`AI reasoning: ${reasoning}`);
console.log(`Prompt: ${prompt}`);

// Do work, then post results as a comment
await fetch(`${API_BASE}/api/proxy/issues/${issue.id}/comments`, {
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
