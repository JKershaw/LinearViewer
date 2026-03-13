# Foreman Mode — Implementation Plan

## Overview

Add three proxy-authed consumer endpoints and a foreman prompt template that together enable a Claude session to autonomously work through the prioritised task stack.

The foreman is a Claude session (user's subscription, no API costs). It uses `curl` against the proxy to read the stack, fetch prompts, update Linear, and report status. Sub-work happens via the Agent tool within the same session.

---

## New Endpoints

### 1. `GET /api/proxy/stack?limit=5`

Returns the top N issues from the sorted task stack (same pipeline as swipe view).

**Implementation:**
- Add to `routes/proxy.js`, using `proxyLimiter + authenticateProxyToken`
- Reuse the existing sort pipeline: `sortIssuesForSwipe` → `applyBlockingOrder` → `clusterByParent`
- Need access to `fetchProjects`, `buildForest`, `buildInProgressForest`, `flattenTrees` — extract the data-fetching + sorting logic into a shared helper (or import from render-swipe.js + server.js)
- The proxy already has `getClient` / `getWorkspaceAccessToken` for the Linear API token

**Response shape:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "identifier": "LIN-42",
      "title": "Fix auth bug",
      "description": "...",
      "priority": 1,
      "url": "https://linear.app/...",
      "stateType": "started",
      "stateName": "In Progress",
      "labels": ["bug"],
      "projectName": "Auth System",
      "parentId": "uuid-or-null",
      "parentIdentifier": "LIN-40",
      "parentTitle": "Auth overhaul",
      "subtasks": [
        { "id": "...", "identifier": "LIN-43", "title": "...", "stateType": "unstarted" }
      ],
      "blocksIds": ["uuid"],
      "availablePrompts": ["bug", "look-into", "implementation", "review"]
    }
  ],
  "total": 47
}
```

**Key detail:** Each task includes `availablePrompts` (from `getAvailablePrompts(issue)`) so the foreman knows which prompt templates are valid for it.

### 2. `GET /api/proxy/prompt/:identifier/:templateKey`

Returns the generated prompt for a specific issue + template.

**Implementation:**
- Add to `routes/proxy.js`, using `proxyLimiter + authenticateProxyToken`
- Resolve identifier (e.g. "LIN-42") to UUID using existing `resolveIssueId` helper
- Call `fetchIssueContext(accessToken, issueId)` to get full context
- Call `generatePrompt(templateKey, issue, context, {})` — use default feature flags (no session)
- Return `{ identifier, templateKey, promptName, prompt, repo }`

**This is the same logic as `workspace-api.js:96`** but with proxy token auth instead of session auth.

### 3. `POST /api/proxy/foreman/status`

Simple status reporting endpoint. The foreman posts updates as it works.

**Implementation:**
- Add to `routes/proxy.js`, requires `readWrite` scope
- Append-only log (same pattern as `proxy-events.js`)
- Body: `{ "taskIdentifier": "LIN-42", "action": "research", "status": "completed", "summary": "..." }`
- Stored per-workspace, 24h TTL
- `GET /api/proxy/foreman/status` returns recent entries

### 4. Foreman Prompt Template

A text template served at `GET /api/proxy/foreman/playbook` (proxy-authed) or renderable in the UI.

**Content — the playbook:**

```
You are a foreman managing a Linear task stack. You work through tasks iteratively using curl to interact with the Linear proxy API.

## Setup
- Base URL: {{baseUrl}}
- Auth: Authorization: Bearer {{token}}

## Loop

1. **Fetch the stack**
   curl -s -H "Authorization: Bearer {{token}}" {{baseUrl}}/api/proxy/stack?limit=5

2. **Pick the next task**
   - If the top task has incomplete subtasks, work on the first incomplete subtask instead
   - Skip completed/canceled tasks
   - The stack is pre-sorted by priority, blocking dependencies, and parent-child clustering

3. **Get the prompt**
   Choose the appropriate template based on task state:
   - New/unstarted task → "research" or "plan"
   - Task with a plan → "implementation"
   - Task with implementation → "review" (includes test coverage check)
   - Bug-labeled → "bug"

   curl -s -H "Authorization: Bearer {{token}}" {{baseUrl}}/api/proxy/prompt/{identifier}/{templateKey}

4. **Execute the prompt**
   Use the Agent tool to spawn a sub-agent with the prompt content.
   The sub-agent does the actual work (research, coding, review).

5. **Update Linear**
   Based on the result:
   - Research/Plan: create subtasks if warranted, add findings as comment
     curl -X POST -H "Authorization: Bearer {{token}}" -H "Content-Type: application/json" \
       -d '{"body":"..."}' {{baseUrl}}/api/proxy/issue/{issueId}/comments
   - Implementation: add comment with summary, update state if done
   - Review: add review findings as comment, flag issues

6. **Report status**
   curl -X POST -H "Authorization: Bearer {{token}}" -H "Content-Type: application/json" \
     -d '{"taskIdentifier":"LIN-42","action":"research","status":"completed","summary":"..."}' \
     {{baseUrl}}/api/proxy/foreman/status

7. **Decide next action**
   - Same task needs follow-up? (research → plan → implement → review) → go to step 3
   - Task complete? → go to step 1 for next task
   - Hit a blocker? → comment on issue, report status, STOP and notify user

## Stop conditions
- External dependency (waiting on another person/team)
- Ambiguous requirements that need human judgment
- 3+ consecutive failures on the same task
- Destructive action needed (deleting data, force-pushing)
- No more tasks in the stack

When you stop, post a final status update explaining why.
```

---

## File Changes

| File | Change |
|------|--------|
| `routes/proxy.js` | Add 3 consumer endpoints: `/api/proxy/stack`, `/api/proxy/prompt/:identifier/:key`, `/api/proxy/foreman/status` (GET + POST) |
| `routes/proxy.js` | Add `GET /api/proxy/foreman/playbook` — returns the foreman prompt with base URL filled in |
| `lib/render-swipe.js` | Export `flattenTrees` (already exported: `sortIssuesForSwipe`, `applyBlockingOrder`, `clusterByParent`) |
| `server.js` | Extract `fetchAndPrepareProjects` data pipeline into importable helper, OR pass it to `createProxyRoutes` |
| `routes/proxy.js` instructions endpoint | Update to document new endpoints |

## What stays the same

- No new auth system — reuses proxy tokens
- No new storage — foreman status uses same event log pattern
- No new client-side code needed for Phase 1 (the foreman is a Claude session, not a UI feature)
- Sort pipeline unchanged
- Prompt generation unchanged

## Approach for data access

The proxy routes need access to `fetchProjects` + the tree/sort pipeline. Two options:

**Option A (simpler):** Import `fetchProjects` from `lib/linear.js` and the sort functions from `lib/render-swipe.js` directly into `routes/proxy.js`. The proxy already has `getWorkspaceAccessToken` to get the Linear token.

**Option B:** Extract a `getTaskStack(accessToken, limit)` function into a new `lib/task-stack.js` used by both the swipe route and the proxy.

→ Going with **Option A** for now since it avoids creating new files and the sort functions are already exported.

## Not included (future phases)

- UI "Run" tab to trigger/monitor the foreman (Phase 2)
- Prompt chaining intelligence (auto-selecting research → plan → implement → review progression)
- Run history / replay
- Guardrails (max tasks per run, time budget)
