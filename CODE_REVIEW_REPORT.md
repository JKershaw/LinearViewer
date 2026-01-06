# Code Review Report: Linear Projects Viewer

**Date:** January 2026
**Last Updated:** January 2026 (post-test improvements)
**Reviewers:** Automated analysis with manual verification
**Scope:** Full codebase review covering test quality, code quality, and security

---

## Executive Summary

Linear Projects Viewer is a well-designed minimal web application with a clean CLI aesthetic. The codebase demonstrates good practices in many areas (HTML escaping, CSRF protection, clean CSS organization) but has gaps in error handling and code duplication.

| Category | Rating | Summary |
|----------|--------|---------|
| Test Coverage | B+ | 51 tests covering auth, workspaces, errors |
| Backend Code | B | Functional, error handling improved |
| Frontend Code | B | Works well, localStorage errors handled |
| Security | B+ | Session fixation fixed, env vars validated |

---

## 1. Test Quality and Coverage

### 1.1 Current Test Suite

| File | Tests | Focus |
|------|-------|-------|
| `landing.spec.js` | 10 | Landing page rendering and interactions |
| `dashboard.spec.js` | 8 | Authenticated dashboard rendering |
| `interactions.spec.js` | 10 | Expand/collapse, state persistence |
| `auth.spec.js` | 7 | ✅ Authentication flow and logout |
| `workspace.spec.js` | 8 | ✅ Workspace selector, switching, removal |
| `error-handling.spec.js` | 10 | ✅ Input validation, session state, OAuth errors |
| **Total** | **51** | |

### 1.2 Coverage Status

| Category | Coverage | Notes |
|----------|----------|-------|
| Authentication Flow | ✅ Good | OAuth redirect, logout, state validation tested |
| Error Handling | ✅ Good | 401 responses, session expiry, validation errors tested |
| Workspace/Team Switching | ✅ Good | Selector, switching, removal, limits tested |

### 1.3 Remaining Test Quality Issues

**`tests/e2e/interactions.spec.js:92, 178`** - Contains two `test.skip()` calls indicating incomplete features or flaky tests (completed toggle and landing page interactions).

**Regex assertions** where exact matches would be clearer:
- Multiple uses of `.toHaveClass(/hidden/)` instead of `.toHaveClass('hidden')`

### 1.4 Test Infrastructure Improvements Made

- Extended `/test/set-session` with query params for error scenarios
- Added `/test/clear-session` endpoint for session destruction
- Used Playwright request API for reliable form submission tests
- Documented magic numbers with comments explaining expected counts

---

## 2. Backend Code Quality

### 2.1 File Length and Complexity

| File | Lines | Assessment |
|------|-------|------------|
| `server.js` | 632 | Too long - exceeds recommended 300-400 lines |
| `render.js` | 522 | Borderline - could benefit from splitting |
| `tree.js` | 287 | Acceptable but has complex functions |
| `parse-landing.js` | 199 | Good length |
| `session-store.js` | ~150 | Good length |

**`server.js`** mixes too many responsibilities:
- OAuth flow (routes, token exchange)
- Session management
- Token refresh middleware
- Data fetching and preparation
- Multi-workspace management
- Error handling

### 2.2 Code Duplication (DRY Violations)

#### Duplicate Function: `assignDepth()`

Identical implementations exist in two locations:

| Location | Lines |
|----------|-------|
| `lib/tree.js` | 49-54 |
| `lib/tree.js` | 243-248 |

Both functions assign depth values recursively to tree nodes.

#### Duplicate Function: `sortNodes()`

Similar implementations with different sorting criteria:

| Location | Lines | Criteria |
|----------|-------|----------|
| `lib/tree.js` | 60-88 | In-progress first, completion status, priority, createdAt |
| `lib/tree.js` | 254-265 | Priority, createdAt only |

The inconsistency in sorting criteria between the two functions may cause confusion.

#### Duplicate Error Handling Pattern

The 401 error handling in `server.js` is repeated:

| Location | Lines | Context |
|----------|-------|---------|
| First block | 561-598 | With token refresh attempt |
| Second block | 601-614 | Without token refresh |

Both blocks contain similar logic for removing workspaces and destroying sessions.

### 2.3 Error Handling Issues

**`lib/parse-landing.js:9`** - `readFileSync()` called without try-catch. If the file doesn't exist, the server crashes on startup.

**`server.js:156`** - `SESSION_SECRET` environment variable used without validation. If undefined, sessions will be insecure.

**`server.js:296-297`** - `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` used in OAuth flow without null checks.

### 2.4 Test Data in Production Code

**`server.js:198-217`** - Mock test data (`testMockTeams`, `testMockData`) is defined in the main server file rather than in a separate test fixtures file.

---

## 3. Frontend Code Quality

### 3.1 Event Handling

**Individual Event Listeners vs Event Delegation**

The current implementation adds individual event listeners to every interactive element:

| Location | Lines | Elements Affected |
|----------|-------|-------------------|
| Toggle clicks | 282-287 | Every `.toggle` element |
| Line clicks | 290-296 | Every `.line.expandable` |
| Description clicks | 241-254 | Every `.project-description` |
| Header clicks | 328-381 | Every `.project-header` |

For a page with 100+ issues, this creates 400+ event listeners. Event delegation would create 4 listeners total.

### 3.2 Error Handling

**`public/app.js:40`** - `JSON.parse()` on localStorage data without try-catch. Corrupted data causes crash.

**`public/app.js:44`** - `localStorage.setItem()` without try-catch. Can throw in private browsing mode or when storage is full.

### 3.3 State Management

State is mutated in place using `push()` and `splice()`:

| Location | Lines | Operation |
|----------|-------|-----------|
| `toggleExpanded()` | 31-35 | `arr.push()`, `arr.splice()` |
| `toggleInArray()` | 89-93 | `arr.push()`, `arr.splice()` |

While functional, immutable updates would be safer and easier to debug.

### 3.4 CSS Quality

**Strengths:**
- Good use of CSS custom properties for theming
- Well-organized with clear section comments
- Mobile-responsive with appropriate breakpoints

**Issues:**

| Location | Lines | Issue |
|----------|-------|-------|
| `style.css` | 159, 206-211 | Hard-coded colors not using CSS variables |
| `style.css` | 375 | Uses `!important` which can cause specificity issues |

---

## 4. Security Assessment

### 4.1 Good Practices

| Practice | Location | Notes |
|----------|----------|-------|
| CSRF Protection | `server.js:340` | State parameter validated in OAuth flow |
| HTML Escaping | `render.js:450-458` | Consistent `escapeHtml()` usage |
| HTTPS Enforcement | `server.js:141-146` | Redirects HTTP to HTTPS in production |
| Secure Cookies | `server.js:161` | Secure flag set in production |
| Input Validation | `server.js:27, 444, 462` | UUID regex validation for workspace IDs |

### 4.2 Security Gaps

**Missing Environment Variable Validation**

Environment variables are used without checking they exist:
- `SESSION_SECRET` - If undefined, sessions are insecure
- `LINEAR_CLIENT_ID` - OAuth will fail cryptically
- `LINEAR_CLIENT_SECRET` - OAuth will fail cryptically

**Session Fixation**

**`server.js:317-421`** - The OAuth callback does not regenerate the session ID after successful authentication. An attacker who knows a victim's session ID before login could hijack the session after login.

**Inline Event Handler**

**`render.js:126`** - Uses inline `onsubmit` handler for form confirmation. This mixes JavaScript with HTML and can complicate Content Security Policy implementation.

---

## 5. Recommendations

### Completed ✅

**Test Coverage:**
- ~~Add authentication flow tests~~ - Created `auth.spec.js` with 7 tests
- ~~Add error scenario tests~~ - Created `error-handling.spec.js` with 10 tests
- ~~Add workspace/team switching tests~~ - Created `workspace.spec.js` with 8 tests
- ~~Document test magic numbers~~ - Added comments explaining expected counts

**Error Handling:**
- ~~Validate environment variables at startup~~ - Fail fast with clear messages
- ~~Add error handling to localStorage operations~~ - Safe helpers with try-catch
- ~~Add error handling to parse-landing.js~~ - Fallback content on file errors
- ~~Regenerate session on authentication~~ - Prevents session fixation attacks

**Code Quality:**
- ~~Extract duplicate functions from tree.js~~ - `assignDepth()`, `sortNodesWithStatus()`, `sortNodesByPriority()`
- ~~Split server.js~~ - Extracted to `lib/workspace.js`, `routes/auth.js`, `routes/workspace.js` (721 → 444 lines)

### Priority 1: Code Quality

1. **Use event delegation** - Replace individual event listeners with delegated listeners on document or container

2. **Use CSS variables consistently** - Replace hard-coded colors with CSS custom properties

### Priority 2: Cleanup

3. **Remove test.skip() calls** - Either fix the two skipped tests (lines 92, 178) or remove the incomplete features

4. **Move test fixtures** - Extract `testMockData` and `testMockTeams` to `tests/fixtures/`

5. **Remove inline event handlers** - Move `onsubmit` handler from HTML to JavaScript

6. **Consider immutable state updates** - Replace `push()`/`splice()` with spread operator patterns

7. **Add JSDoc types** - Document complex data structures like the forest Map

---

## Appendix: File-by-File Summary

| File | Lines | Issues Found | Severity |
|------|-------|--------------|----------|
| `server.js` | 444 | 1 | Low |
| `lib/workspace.js` | 83 | 0 | ✅ New |
| `routes/auth.js` | 190 | 0 | ✅ New |
| `routes/workspace.js` | 54 | 0 | ✅ New |
| `lib/tree.js` | ~305 | 0 | ✅ Fixed |
| `lib/render.js` | 522 | 2 | Medium |
| `lib/parse-landing.js` | ~210 | 0 | ✅ Fixed |
| `public/app.js` | ~590 | 2 | Low |
| `public/style.css` | 628 | 2 | Low |
| `tests/e2e/*.spec.js` | ~750 | 2 | Low |

---

*Report generated from automated analysis with manual verification of all findings.*
*Updated January 2026 after test coverage improvements (28 → 51 tests).*
