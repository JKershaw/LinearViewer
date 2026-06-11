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

`relations` and `inverseRelations` use Linear's `{nodes: [...]}` wrapper, the same convention as `relations` on `/issues/{id}` and `labels`/`children`/`comments` across the read endpoints. `relatedIssue` is the target of an outgoing relation; `issue` is the source of an inverse one (e.g. the issue that blocks this one). Each node's `id` is the relation's own id — pass it to the delete-relation endpoint below.

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

### Foreman / Task Automation Endpoints

These endpoints back the "foreman" workflow: pick the next task, generate a prompt for it, and record agent progress. The **recap** and **brief** endpoints above are part of this group too. All are read-scope except `POST /api/proxy/foreman/status`, which requires `readWrite`.

#### Get Task Stack

```
GET /api/proxy/stack?limit={n}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | int | No | Max tasks (1-50, default 5) |

Returns a prioritized, deduplicated task list using the same ordering as the in-app swipe view (in-progress first, then project order, clustered by parent and blocking order).

```json
{
  "tasks": [
    {
      "id": "uuid",
      "identifier": "ENG-42",
      "title": "Fix login bug",
      "description": "...",
      "priority": 1,
      "url": "https://linear.app/...",
      "state": { "name": "In Progress", "type": "started" },
      "labels": [],
      "project": { "name": "Project Alpha" },
      "parent": { "id": "uuid", "identifier": "ENG-40", "title": "Auth overhaul" },
      "children": [{ "id": "uuid", "identifier": "ENG-43", "title": "Sub-task", "state": { "type": "unstarted" } }],
      "blocksIds": []
    }
  ],
  "total": 12
}
```

`total` is the full count before `limit` is applied. `parent` is `null` for top-level issues; `children` is `[]` when there are none.

#### Generate Prompt (deterministic)

```
GET /api/proxy/prompt/{identifier}/{templateKey}
```

Generates a deterministic, template-based prompt for an issue. `templateKey` must be a known template (e.g. `work-issue`, `plan`, `code-review`, `triage`, `breakdown`) — an unknown key returns `404`.

```json
{
  "identifier": "ENG-42",
  "templateKey": "plan",
  "promptName": "Plan",
  "prompt": "...",
  "repo": "owner/repo"
}
```

`repo` is parsed from the project description when present, otherwise `null`.

#### Recommend Prompt (AI)

```
GET /api/proxy/recommend/{identifier}
```

Returns an AI-generated prompt recommendation. Requires an OpenRouter key (the token creator's OAuth connection, or the server's `OPENROUTER_API_KEY`); returns `503` when neither is configured. Like recap/brief, this calls an LLM and can exceed 25s — the server streams keepalive whitespace inside a single `200`, so don't set a client timeout below ~60s.

```json
{
  "identifier": "ENG-42",
  "reasoning": "Why this approach was chosen...",
  "prompt": "...",
  "truncated": false,
  "repo": "owner/repo"
}
```

**Download as markdown** — add `?format=md` to get the bare prompt as a
downloadable markdown file instead of JSON (`Content-Type: text/markdown`,
`Content-Disposition: attachment; filename="<identifier>-recommend.md"`). This is
the escape hatch for prompts too large to paste — save straight to a `.md` file:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-host/api/proxy/recommend/ENG-42?format=md" -o ENG-42-recommend.md
```

The markdown body is just the `prompt` string (no `reasoning`/`repo` envelope). On
the rare run that exceeds ~25s, keepalive whitespace may already have committed the
response as `application/json`; the body is still the prompt bytes, so a redirect to
a file (`-o`) saves correctly regardless.

**Recommend the parent's own work (`?noDescend=1`)** — by default, when the named
issue is a container (has an open child), the engine descends and recommends the
child's work. Add `?noDescend=1` (or `?noDescend=true`) to recommend the **named
issue's own next step instead**, without ever following into a child:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-host/api/proxy/recommend/ENG-42?noDescend=1"
```

Use this when a parent's actual deliverables live in its own description/checklist
while a sub-issue is out of scope or separately tracked — otherwise the recommend
engine routes into that child and the parent's work is unreachable through the verb.
The non-descent is deterministic (the child is never fetched), so `identifier`
returns the node you named and `deferredVia` is just `["ENG-42"]`.

#### Record Foreman Status

```
POST /api/proxy/foreman/status
Content-Type: application/json

{ "taskIdentifier": "ENG-42", "action": "implement", "status": "done", "summary": "Landed the fix in PR #42", "dispatchId": "optional-correlation-id" }
```

**Requires `readWrite`.** Append-only progress log (30-day TTL). Each entry is attributed to the posting token so the UI can group entries into sessions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskIdentifier` | string | Yes | Linear identifier (max 200 chars) |
| `action` | string | Yes | What the agent did (max 200 chars) |
| `status` | string | Yes | Outcome, e.g. `done` / `blocked` (max 200 chars) |
| `summary` | string | Yes | Human-readable detail (max 10000 chars) |
| `dispatchId` | string | No | Correlation id for exact loop-join (max 200 chars) |

Returns `201 { "success": true }`.

#### List Foreman Status

```
GET /api/proxy/foreman/status?limit={n}&offset={n}&tokenId={id}&taskIdentifier={id}
```

Lists recent status entries, newest first. `limit` is 1-100 (default 20). Optional `tokenId` (filter to one session; use `__unattributed__` for entries with no token) and `taskIdentifier` (filter to one task thread).

```json
{
  "items": [
    {
      "id": "...",
      "taskIdentifier": "ENG-42",
      "action": "implement",
      "status": "done",
      "summary": "...",
      "timestamp": "2026-04-20T12:00:00.000Z",
      "tokenId": "...",
      "tokenLabel": "My Agent",
      "dispatchId": "..."
    }
  ],
  "total": 7
}
```

`tokenId`, `tokenLabel`, and `dispatchId` appear only when they were recorded on the entry.

#### List Foreman Sessions

```
GET /api/proxy/foreman/sessions
```

Groups status entries into sessions by posting token, so an observer can pick which agent to watch. Legacy entries without a token roll up into a synthetic `unattributed` session (`id` / `tokenId` of `__unattributed__` / `null`).

```json
{
  "sessions": [
    {
      "id": "tokenId-or-__unattributed__",
      "tokenId": "...",
      "label": "My Agent",
      "firstSeen": "2026-04-20T11:00:00.000Z",
      "lastSeen": "2026-04-20T12:00:00.000Z",
      "itemCount": 5,
      "lastTaskIdentifier": "ENG-42",
      "lastAction": "implement",
      "lastStatus": "done"
    }
  ]
}
```

#### List Foreman Task Threads

```
GET /api/proxy/foreman/tasks?tokenId={id}
```

Groups status entries by Linear task identifier ("what tasks have been touched?"). Optional `tokenId` narrows to a single session.

```json
{
  "tasks": [
    {
      "taskIdentifier": "ENG-42",
      "firstSeen": "2026-04-20T11:00:00.000Z",
      "lastSeen": "2026-04-20T12:00:00.000Z",
      "itemCount": 3,
      "lastAction": "implement",
      "lastStatus": "done"
    }
  ]
}
```

#### Get Foreman Playbook

```
GET /api/proxy/foreman/playbook
```

Returns the foreman automation playbook as **plain text** (`text/plain`) — operating instructions for an agent orchestrating the stack → recommend → status loop.

#### Get Autopilot Kickoff

```
GET /api/proxy/autopilot/kickoff
GET /api/proxy/autopilot/kickoff?mode=readonly&goal=<text>
```

Returns the **Autopilot kickoff** as **plain text** (`text/plain`) — the briefing that turns the receiving session into the *Autopilot orchestrator*. Unlike the foreman playbook (which works the stack in-session), Autopilot is a light orchestrator: it picks the next task, **dispatches the work to a separate worker** via `POST /api/proxy/dispatch`, watches the feedback, judges completion from external evidence, and decides continue / complete / pause-for-human.

| Query param | Default | Description |
|-------------|---------|-------------|
| `mode` | `write` | `write` allows implementation/review kinds and an evidence-gated merge; `readonly` restricts dispatched work to investigation/research/planning/retro (no code, PRs, or Linear writes). |
| `goal` | _(none)_ | Optional free-text focus for the run. Omitted ⇒ walk the stack under the precedence policy. |

The body embeds `YOUR_TOKEN` as a placeholder; substitute the consumer's `readWrite` token (Autopilot reuses it for the prompts it dispatches). A read-scope token can fetch the kickoff, but running it needs `readWrite` (Autopilot dispatches). The general (stack-walk) kickoff is what this endpoint serves; the in-app per-task variant ("run on autopilot until this task is done") is generated at `/workspace/:urlKey/api/autopilot-prompt/:issueId`.

### Write Endpoints

All write endpoints require a `readWrite` scoped token. Read-only tokens receive `403`.

Success responses wrap the affected entity (e.g. `{ "success": true, "issue": {...} }`) — read the documented shape rather than assuming the entity comes back top-level. Creates (issues, comments, relations) are **not idempotent** and there is no idempotency key: a `2xx` with `"success": true` means the write landed even if your client-side parse came up empty, so inspect the raw response (or search) before retrying — a blind retry mints a duplicate.

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

Returns `201`:
```json
{
  "success": true,
  "issue": {
    "id": "uuid",
    "identifier": "LIN-123",
    "title": "Fix authentication bug",
    "url": "https://linear.app/...",
    "state": { "name": "Backlog", "type": "backlog" }
  }
}
```

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

Response:
```json
{
  "success": true,
  "issue": {
    "id": "uuid",
    "identifier": "LIN-123",
    "title": "Updated title",
    "url": "https://linear.app/...",
    "state": { "name": "In Progress", "type": "started" }
  }
}
```

#### Add Comment

```
POST /api/proxy/issues/{issueId}/comments
Content-Type: application/json

{ "body": "Investigation complete. Root cause identified." }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | string | Yes | Comment body in Markdown (max 50K chars) |

Returns `201`:
```json
{
  "success": true,
  "comment": {
    "id": "uuid",
    "body": "Investigation complete. Root cause identified.",
    "createdAt": "2026-06-10T12:00:00.000Z",
    "user": { "name": "Jane Doe" }
  }
}
```

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

Returns `201`:
```json
{
  "success": true,
  "issueRelation": {
    "type": "blocks",
    "issue": { "id": "uuid", "identifier": "LIN-7" },
    "relatedIssue": { "id": "uuid", "identifier": "LIN-9" }
  }
}
```

#### Delete Relation

```
DELETE /api/proxy/issues/{issueId}/relations/{relationId}
```

Removes a relation. `relationId` is the relation's own `id` (the `id` field on each node returned by `GET /relations/{issueId}` or `GET /issues/{id}`), **not** an issue id.

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

Response:
```json
{
  "success": true,
  "issue": {
    "id": "uuid",
    "identifier": "LIN-123",
    "labels": { "nodes": [{ "id": "uuid", "name": "bug" }] }
  }
}
```

When the label is already present: `{ "success": true, "message": "Label already present" }`.

#### Remove Label

```
DELETE /api/proxy/issues/{issueId}/labels/{labelId}
```

Idempotent — returns success if label was not present.

Response: same shape as Add Label (the issue with its remaining `labels.nodes`). When the label was not present: `{ "success": true, "message": "Label not present" }`.

### Dispatch Endpoints

These endpoints let a consumer (e.g. an autopilot orchestrator) hand a prompt to the workspace's **dispatch runner** — a separate system that polls the queue and runs the prompt as a Claude Code session (locally as `cli`, or via web remote-control) — and then watch it run to completion. Enqueue requires `readWrite`; the watch and list reads are `read`-scope.

The runner reports progress back as **free-form feedback entries** (it owns the return leg via its own lifecycle; you do not poll it to run). Across a normal run the feedback stream carries, in order: phase tags (`[started]`/`[working]`), periodic **heartbeats** with activity telemetry, the session's final **recap** (`(recap 1/2)` …), structured **`[evidence]`** entries (each with a populated `url`), and a terminal **`[done]`** / **`[failed]`** / **`[aborted]`** marker. The watch/list endpoints derive a terminal `status` from that marker, so you can poll a field instead of parsing prose.

> **Judge from evidence, not self-report.** The recap is the runner's own narration of what it did. Treat it as descriptive detail; confirm completion against the `[evidence]` URLs (PR/CI/commit/Linear) and Linear/git state. A `done` status with no corroborating artifact is "claimed, unverified."

#### Enqueue a Dispatch

```
POST /api/proxy/dispatch
Content-Type: application/json

{ "prompt": "...", "promptName": "...", "issueId": "...", "issueIdentifier": "LIN-42", "issueTitle": "...", "issueUrl": "...", "target": "cli", "repo": "...", "appendProxyContext": true }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The prompt to run (max ~10MB) |
| `promptName` | string | No | Short label for the dispatch (max 100 chars) |
| `issueId` / `issueIdentifier` / `issueTitle` / `issueUrl` | string | No | Optional linkage to a Linear issue |
| `target` | string | No | `cli` \| `web` \| `dash` (default `cli`). `local`/Harbour is **not** available to proxy consumers |
| `repo` | string | No | Optional repository hint |
| `appendProxyContext` | bool | No | Default `true`: append a proxy-context block to the prompt so the worker inherits Linear access for this workspace (the MCP replacement). Set `false` to send the prompt verbatim |

Returns `201`:
```json
{ "id": "uuid", "status": "queued", "promptName": "...", "issueIdentifier": "LIN-42", "target": "cli", "dispatchedAt": "2026-06-06T11:32:25.111Z" }
```

#### Recommend and Dispatch (fused)

```
POST /api/proxy/recommend-and-dispatch
Content-Type: application/json

{ "issueIdentifier": "LIN-42", "target": "cli", "repo": "...", "appendProxyContext": true }
```

Runs `/recommend` and forwards the recommended prompt straight into a dispatch — **server-side, in one call**. The prompt body never returns to you: you receive only the task header. This keeps the recommended prompt out of the orchestrator's context (autopilot invariant 4 — see `docs/autopilot.md` §8) and lets you read the task's `kind` without ever reading the prompt to classify it. Requires `readWrite`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issueIdentifier` | string | Yes | The issue to recommend a next step for (UUID or `LIN-123`) |
| `target` | string | No | `cli` \| `web` \| `dash` (default `cli`). `local`/Harbour is **not** available to proxy consumers |
| `repo` | string | No | Optional repository hint |
| `appendProxyContext` | bool | No | Default `true`: append a proxy-context block so the worker inherits Linear access for this workspace |
| `noDescend` | bool | No | Default `false`. When `true`, recommend and dispatch the **named issue's own** next step and never descend into an open child (see below) |

`kind` is derived server-side from the recommendation's own action signal, falling back to `custom` when the action can't be parsed. There is no `prompt` field to send (it is generated) and none in the response (it is withheld by design).

**`noDescend` — dispatch the parent's own work.** By default this verb descends a
container to its actionable child and dispatches *that* child (so the returned
`issueIdentifier` and `deferredVia` reflect the descent). Set `noDescend: true` to
suppress the descent: the engine frames the named issue as a leaf, recommends its
**own** next step, and dispatches against the issue you named. The dispatched item's
`issueIdentifier` is then the parent and `deferredVia` is `[parent]`. Use it to drive
a parent whose deliverables live in its own description while a sub-issue is out of
scope or separately tracked — the lever is deterministic (the child is never fetched
or dispatched), so it is the reliable way to make a parent's own work reachable
through the verb.

Returns `201`:
```json
{ "id": "uuid", "status": "queued", "kind": "plan", "promptName": "plan", "issueIdentifier": "LIN-42", "target": "cli", "dispatchedAt": "2026-06-06T11:32:25.111Z" }
```

`/recommend` can be slow (Linear + OpenRouter); the same whitespace-keepalive behaviour as `GET /recommend` applies, so don't set a client timeout below ~60s. Watch the returned `id` with `GET /api/proxy/dispatch/{id}` exactly as for a plain dispatch.

#### Watch a Dispatch

```
GET /api/proxy/dispatch/{id}
GET /api/proxy/dispatch/{id}?wait=50
```

Poll this after enqueuing. `status` is terminal (`done`/`failed`/`aborted`) once the runner posts the matching feedback marker; until then it is `queued` or `taken`.

**Long-poll with `?wait=Ns` (recommended for waiting).** Without `?wait`, the endpoint returns the current state immediately — a plain short-poll, so you own the waiting (and tend to oversleep). With `?wait=N` (capped at 50s) the server holds the request open and **returns the instant `status` transitions or new feedback arrives**, else returns the current snapshot at the cap so you simply call again. Your watch loop collapses to a no-sleep, no-backoff:

```bash
# bash — don't name the var `status` in zsh (it's a read-only alias for $?)
while :; do
  body=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$BASE/api/proxy/dispatch/$ID?wait=50")
  dispatch_status=$(jq -r .status <<<"$body")
  case "$dispatch_status" in done|failed|aborted) break ;; esac
done
```

Notes:
- Detection latency is ~1–2s (the server's internal re-check interval), not "up to one sleep interval." One held request replaces many short polls — friendly to the 60/min rate limit.
- A long hold may stream interior whitespace heartbeats inside the single `200` (same keepalive mechanism as `GET /recommend`); `JSON.parse` ignores them. Don't set a client timeout below ~60s when using `?wait`.
- Re-polling an already-terminal item with `?wait` returns immediately (no hold) — re-verifying a finished item is free.
- `?wait=0` / absent / invalid values are the plain immediate short-poll (fully backwards-compatible).
- `status` is **reported, not adjudicated**: a `done` means the runner's session ended, not that the work is correct (a worker can background a long command, exit, and post `done` early). Treat `done` as "go look" — cross-check the `[evidence]` URLs, and if unsatisfied, dispatch fresh work. The long-poll never locks anything in.

```json
{
  "id": "uuid",
  "status": "queued|taken|done|failed|aborted",
  "promptName": "...",
  "issueIdentifier": "LIN-42",
  "issueUrl": "...",
  "target": "cli",
  "dispatchedAt": "...",
  "resolvedAt": "...",
  "completedAt": "...",
  "feedback": [
    { "message": "[working] 6 tools in 32s: Bash×6 · next heartbeat in ≤1m", "url": null, "urlLabel": null, "timestamp": "..." },
    { "message": "[evidence] Pull request · 3 mentions", "url": "https://github.com/org/repo/pull/286", "urlLabel": null, "timestamp": "..." },
    { "message": "[done] Task completed in 55s", "url": "https://github.com/org/repo/pull/286", "urlLabel": null, "timestamp": "..." }
  ]
}
```

Feedback is free-form text — read it (the recap, heartbeats) for detail; `status` gives the terminal signal and `[evidence]` entries give the artifact URLs to verify against. Poll until `status` is terminal. (If you poll in a shell loop, don't name the variable `status`: zsh reserves it as a read-only alias for `$?` and the assignment aborts. Use `dispatch_status`, or run the loop under `bash`.)

**Timestamps — don't mistake `resolvedAt` for completion.** `resolvedAt` is stamped when the runner *claims* the item (take/archive time); it lands seconds after `dispatchedAt` no matter how long the task runs, so it is **not** a completion signal. The truthful completion time is **`completedAt`** — the timestamp of the terminal `[done]`/`[failed]`/`[aborted]` feedback marker, `null` until that marker exists. `status` remains the authoritative completion *signal*; `completedAt` is the completion *time*.

#### List Dispatches

```
GET /api/proxy/dispatch?issueIdentifier={LIN-42}&status={queued|taken|done|failed|aborted}&limit={n}
```

All query params optional. Merges the live queue and recent history, newest first — use it to resolve an item's `id` when you only know the issue. `status` is the same derived terminal status as the watch endpoint, so it is a valid filter value.

```json
{ "items": [ { "id": "uuid", "status": "done", "promptName": "...", "issueIdentifier": "LIN-42", "issueUrl": "...", "target": "cli", "dispatchedAt": "...", "resolvedAt": "...", "completedAt": "...", "feedbackCount": 10 } ], "total": 1 }
```

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
