# Foreman Mode — Implementation Plan

## Summary

Add foreman endpoints to the proxy API so a standalone Claude session can autonomously work through the prioritised task stack using curl.

## New Files

### `lib/foreman-store.js`
Append-only status log following the `ProxyEventStore` pattern.
- `recordStatus({ urlKey, taskIdentifier, action, status, summary })` → append entry
- `listStatus(urlKey, { limit, offset })` → list recent entries (newest first)
- `clear(urlKey)` → for tests
- Schema: `{ _id, urlKey, taskIdentifier, action, status, summary, timestamp, expiresAt }`
- TTL: 24 hours

## Changes to Existing Files

### `routes/proxy.js`
Add 5 new consumer endpoints inside `createProxyRoutes()`:

1. **`GET /api/proxy/stack?limit=5`** (read scope)
   - Import `fetchProjects` from `lib/linear.js`, tree functions from `lib/tree.js`, sort functions from `lib/render-swipe.js`
   - Get workspace access token via `getWorkspaceAccessToken(urlKey)`
   - Call `fetchProjects(token)` → `buildForest` → `flattenTrees` → `sortIssuesForSwipe` → `applyBlockingOrder` → `clusterByParent`
   - Enrich each issue with `availablePrompts` from `getAvailablePrompts()`
   - Return top N tasks as JSON
   - Note: `flattenTrees` is not exported from render-swipe.js — will inline a simplified version or export it

2. **`GET /api/proxy/prompt/:identifier/:templateKey`** (read scope)
   - Import `fetchIssueContext` from `lib/linear.js`, `generatePrompt` from `lib/prompt-templates.js`
   - Validate identifier format (UUID or LIN-123 pattern)
   - Validate templateKey via `hasPrompt()`
   - Call `fetchIssueContext(token, identifier)` then `generatePrompt(key, issue, context, {})`
   - Return `{ identifier, templateKey, promptName, prompt, repo }`

3. **`POST /api/proxy/foreman/status`** (readWrite scope)
   - Validate body: `{ taskIdentifier, action, status, summary }` — all strings, all required
   - Call `foremanStore.recordStatus()`
   - Return `{ success: true }`

4. **`GET /api/proxy/foreman/status`** (read scope)
   - Query params: `?limit=20&offset=0`
   - Call `foremanStore.listStatus()`
   - Return `{ items: [...], total: N }`

5. **`GET /api/proxy/foreman/playbook`** (read scope)
   - Return the foreman prompt as plain text with `{{baseUrl}}` replaced by actual base URL
   - Token placeholder left as `YOUR_TOKEN` (user fills in)

### `routes/proxy.js` — `createProxyRoutes()` signature
Add `foremanStore` to the injected dependencies.

### `routes/proxy.js` — instructions endpoint
Add new foreman endpoints to the instructions text.

### `lib/render-swipe.js`
Export `flattenTrees` function (currently not exported).

### `server.js`
- Create `foremanStatusCollection` and `ForemanStore` instance
- Pass `foremanStore` to `createProxyRoutes()`
- Pass `foremanStore` to `createTestRoutes()`
- Add foreman cleanup to the periodic cleanup interval

### `routes/test.js`
- Add `foremanStore` to dependencies
- Add `/test/clear-foreman-status` endpoint

### `lib/feature-defaults.js`
Add `FOREMAN: 'foreman'` feature flag (default: false).
Note: Foreman endpoints are behind the existing `proxy` feature flag since they're proxy consumer endpoints. No separate flag needed — the proxy token auth already gates access.

Actually, skip the feature flag — the proxy feature flag already gates token creation. If you have a valid proxy token, you can use foreman endpoints.

## Test File

### `tests/e2e/foreman.spec.js`
Follow patterns from `proxy.spec.js`:

**Setup:**
- `beforeEach`: clear proxy tokens, clear foreman status, create read + readWrite tokens

**Tests:**
1. `GET /api/proxy/stack` returns sorted tasks with expected fields
2. `GET /api/proxy/stack?limit=2` respects limit parameter
3. Stack tasks include `availablePrompts` array
4. Stack tasks include subtask info when parent has children
5. `GET /api/proxy/stack` with invalid token gets 401
6. `GET /api/proxy/prompt/:identifier/:key` returns generated prompt
7. `GET /api/proxy/prompt/:identifier/invalid-key` gets 404
8. `GET /api/proxy/prompt/INVALID!!!/plan` gets 400
9. `POST /api/proxy/foreman/status` records and retrieves status
10. `POST /api/proxy/foreman/status` validates required fields
11. `POST /api/proxy/foreman/status` requires readWrite scope
12. `GET /api/proxy/foreman/status` returns entries newest-first
13. `GET /api/proxy/foreman/playbook` returns playbook text with base URL
14. Instructions endpoint includes foreman endpoints

## Implementation Order

1. Export `flattenTrees` from `lib/render-swipe.js`
2. Create `lib/foreman-store.js`
3. Wire up store in `server.js` (collection, cleanup, pass to routes)
4. Add test helper endpoint in `routes/test.js`
5. Add all 5 endpoints to `routes/proxy.js`
6. Update instructions endpoint text
7. Write `tests/e2e/foreman.spec.js`
8. Run tests, fix issues
