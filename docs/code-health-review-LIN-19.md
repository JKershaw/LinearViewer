# Code Health Review - LIN-19

This document captures the findings from a comprehensive code health review of the LinearViewer codebase.

## Summary

| Category | Severity | Issues Found |
|----------|----------|--------------|
| Code Duplication | Medium | 3 patterns |
| Long Functions | Medium | 3 functions |
| Architecture Concerns | Medium | 2 areas |
| Testing Gaps | Medium | 3 modules |
| Inconsistencies | Low | 2 areas |
| Security | Low | 2 minor items |
| Performance | Low | 2 areas |

## Detailed Findings

### 1. Code Duplication

#### Token Update Logic (3 locations)
- `server.js:242-245` - ensureValidToken middleware
- `server.js:388-391` - main route error handling
- `routes/auth.js:128-131` - OAuth callback

**Pattern:**
```javascript
workspace.accessToken = tokenData.access_token;
workspace.refreshToken = tokenData.refresh_token;
workspace.tokenExpiresAt = calculateExpiresAt(tokenData.expires_in);
```

**Recommendation:** Create `updateWorkspaceTokens(workspace, tokenData)` in `lib/workspace.js`

#### 401 Error Handling (server.js:385-438)
Two nearly identical blocks handling unauthorized errors - one with refresh token, one without.

**Recommendation:** Extract to `handleUnauthorizedError(workspace, session, refreshToken)` helper

### 2. Long/Complex Functions

#### Main Route Handler (server.js:353-447)
- 94 lines
- 3 levels of nested error handling
- Handles: normal flow, 401 with refresh, 401 without refresh, generic errors

**Recommendation:** Extract `handleTokenRefreshAndRetry()` and `handleWorkspaceRemoval()` helpers

#### Client Click Handler (public/app.js:387-458)
- 71 lines with 7 different handlers
- Already uses event delegation (good pattern)

**Recommendation:** Extract individual handlers as named functions for clarity

#### Meta-Prompt Builder (lib/openrouter.js:160-274)
- 114-line function with inline template string
- Template is static - should be extracted

**Recommendation:** Move template to `lib/prompts/meta-prompt.txt` or constants file

### 3. Architecture Concerns

#### GraphQL Client Creation
`lib/linear.js` creates new client instances in each function:
- Line 210: `fetchTeams()`
- Line 229: `fetchOrganization()`
- Line 251: `fetchProjects()`
- Line 301: `fetchIssueContext()`

**Recommendation:** Create factory function or shared instance:
```javascript
function createClient(apiKey) {
  return new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: apiKey }
  });
}
```

#### Session State Access
Multiple files manipulate session directly instead of using workspace helpers:
- `server.js` modifies `req.session.workspaces` in some places
- Routes have mixed patterns

**Recommendation:** Route all session manipulation through `lib/workspace.js` helpers

### 4. Testing Gaps

#### Current Coverage
9 E2E test files with good user flow coverage:
- landing.spec.js
- dashboard.spec.js
- interactions.spec.js
- auth.spec.js
- workspace.spec.js
- prompts.spec.js
- audit.spec.js
- error-handling.spec.js
- openrouter-auth.spec.js

#### Missing Unit Tests
1. **lib/token-refresh.js** - Critical OAuth logic with retry, no unit tests
2. **lib/workspace.js** - Session management helpers, no unit tests
3. **public/app.js** - Client state functions (`loadState`, `saveState`, etc.)

**Recommendation:** Add unit tests for these modules using a test runner like Vitest

### 5. Inconsistencies

#### Error Response Formats
- `routes/auth.js` → HTML error pages
- `routes/workspace.js` → Plain text: `res.status(400).send('Invalid workspace ID')`
- API routes → JSON: `res.status(401).json({ error: '...' })`

**Recommendation:** Standardize:
- User-facing routes → HTML error pages
- API routes (`/api/*`) → JSON responses

#### Naming Conventions
- `getDefaultState()` vs `getTeamSelection()`
- `setTeamSelection()` vs `saveState()`

**Recommendation:** Document naming conventions in CLAUDE.md

### 6. Security (Low Risk)

#### Positive Findings
- CSRF protection with state parameter ✓
- Session regeneration after auth ✓
- Token refresh with retry/backoff ✓
- UUID validation on workspace IDs ✓
- HTTPS enforcement in production ✓

#### Minor Concerns
- `server.js:325` exposes OpenRouter error details to client
- No validation of SESSION_SECRET entropy/length

**Recommendation:**
- Sanitize external API errors before sending to clients
- Add SESSION_SECRET length validation (recommend 32+ characters)

### 7. Performance (Low Priority)

#### Client-Side DOM Queries
`public/app.js` requeues DOM elements in loops:
```javascript
document.querySelector(`.line[data-id="${id}"][data-section="${section}"]`)
```

**Recommendation:** Consider caching with WeakMap for frequently accessed elements

#### OpenRouter Prompt Size
Meta-prompt includes:
- Full issue description (500 chars)
- All comments (full text)
- Complete decision tree

**Recommendation:** Summarize comments instead of full inclusion

## Recommended Subtasks

1. [ ] **Extract token update helper** - `lib/workspace.js`
2. [ ] **Refactor main route error handling** - `server.js`
3. [ ] **Create GraphQL client factory** - `lib/linear.js`
4. [ ] **Add unit tests for token-refresh.js**
5. [ ] **Add unit tests for workspace.js**
6. [ ] **Standardize error responses** - Document pattern
7. [ ] **Extract OpenRouter prompt template**

## Files Reviewed

- `server.js` (810 lines)
- `lib/linear.js` (373 lines)
- `lib/openrouter.js` (368 lines)
- `lib/workspace.js` (108 lines)
- `lib/token-refresh.js` (147 lines)
- `public/app.js` (887 lines)
- `routes/auth.js` (191 lines)
- `routes/workspace.js`
- `routes/openrouter-auth.js`
- All E2E tests in `tests/e2e/`
