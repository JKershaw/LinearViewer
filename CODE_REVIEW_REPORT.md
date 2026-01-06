# Code Review Report: Linear Projects Viewer

**Date:** January 2026
**Reviewers:** Automated analysis with manual verification
**Scope:** Full codebase review covering test quality, code quality, and security

---

## Executive Summary

Linear Projects Viewer is a well-designed minimal web application with a clean CLI aesthetic. The codebase demonstrates good practices in many areas (HTML escaping, CSRF protection, clean CSS organization) but has notable gaps in test coverage, code duplication, and accessibility.

| Category | Rating | Summary |
|----------|--------|---------|
| Test Coverage | C | ~50% - Major gaps in auth and error testing |
| Backend Code | B- | Functional but needs refactoring |
| Frontend Code | C+ | Works well but critical a11y issues |
| Security | B | Good basics but missing validations |
| Accessibility | D | ARIA present but keyboard navigation broken |

---

## 1. Test Quality and Coverage

### 1.1 Current Test Suite

| File | Tests | Focus |
|------|-------|-------|
| `landing.spec.js` | 10 | Landing page rendering and interactions |
| `dashboard.spec.js` | 8 | Authenticated dashboard rendering |
| `interactions.spec.js` | 10 | Expand/collapse, state persistence |
| **Total** | **28** | |

### 1.2 Coverage Gaps

#### Critical Missing Test Categories

| Category | Coverage | Impact |
|----------|----------|--------|
| Authentication Flow | 0% | No tests for OAuth redirect, callback, or state validation |
| Error Handling | 0% | No tests for 401 responses, network failures, or session expiry |
| Workspace/Team Switching | 0% | Feature exists but completely untested |
| Accessibility | 0% | No keyboard navigation or screen reader tests |

#### Specific Issues

**`tests/e2e/interactions.spec.js:92, 178`** - Contains two `test.skip()` calls indicating incomplete features or flaky tests (completed toggle and landing page interactions).

**Hard-coded magic numbers** throughout tests without documentation:
- `landing.spec.js:29` - `toHaveCount(5)` with no explanation of why 5 projects
- `landing.spec.js:41-43` - State counts (4 done, 1 in-progress, 11 todo) undocumented
- `dashboard.spec.js:47-52` - Similar undocumented counts

**Regex assertions** where exact matches would be clearer:
- Multiple uses of `.toHaveClass(/hidden/)` instead of `.toHaveClass('hidden')`

### 1.3 Test Quality Issues

- No test utilities or helpers for common operations
- No Page Object Model - selectors duplicated across files
- Landing page tests mixed with authenticated tests in `interactions.spec.js`
- No `afterEach` cleanup hooks

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
| `style.css` | 23 | `--fg-dim: #666666` has borderline contrast ratio (~4.47:1) |

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

## 5. Accessibility Assessment

### 5.1 Current State

**Present:**
- ARIA attributes: `aria-expanded`, `aria-haspopup`, `aria-controls`, `aria-label`
- Role attributes: `role="listbox"`, `role="region"`, `role="option"`
- Status indicators have `aria-label`
- Keyboard support for navigation dropdowns

**Missing:**

| Issue | Location | Impact |
|-------|----------|--------|
| No keyboard support for expandable items | `app.js:290-296` | Users cannot expand/collapse issues with keyboard |
| No visible focus indicators | `style.css:333-341` | Users cannot see which element has focus |
| No focus management | `app.js:257-279` | Focus lost after expand/collapse actions |
| Touch feedback removed without keyboard alternative | `style.css:529-531` | Keyboard users get no visual feedback on touch devices |

### 5.2 WCAG 2.1 Compliance Estimate

| Level | Compliance | Notes |
|-------|------------|-------|
| Level A | ~40-50% | Keyboard navigation broken |
| Level AA | ~30-40% | Contrast issues, focus indicators missing |
| Level AAA | Not assessed | |

---

## 6. Recommendations

### Priority 1: Critical

1. **Add authentication flow tests** - Create `auth.spec.js` covering OAuth redirect, callback, state validation, and error scenarios

2. **Add keyboard support for expandable items** - Add `keydown` event handlers for Enter and Space keys on `.line.expandable` elements

3. **Add visible focus indicators** - Add CSS `:focus-visible` styles for `.toggle`, `.line.expandable`, and `.project-header`

4. **Validate environment variables at startup** - Check `SESSION_SECRET`, `LINEAR_CLIENT_ID`, and `LINEAR_CLIENT_SECRET` exist before starting server

5. **Add error handling to localStorage operations** - Wrap `JSON.parse()` and `localStorage.setItem()` in try-catch blocks

### Priority 2: High

6. **Extract duplicate functions from tree.js** - Move `assignDepth()` and `sortNodes()` to shared helpers

7. **Use event delegation** - Replace individual event listeners with delegated listeners on document or container

8. **Add error handling to parse-landing.js** - Wrap `readFileSync()` in try-catch

9. **Regenerate session on authentication** - Call `req.session.regenerate()` after successful OAuth

10. **Add error scenario tests** - Test 401 handling, network failures, malformed data

### Priority 3: Medium

11. **Split server.js** - Extract OAuth routes, workspace management, and data fetching into separate modules

12. **Document test magic numbers** - Add comments explaining expected counts in test assertions

13. **Remove test.skip() calls** - Either fix the two skipped tests (lines 92, 178) or remove the incomplete features

14. **Move test fixtures** - Extract `testMockData` and `testMockTeams` to `tests/fixtures/`

15. **Use CSS variables consistently** - Replace hard-coded colors with CSS custom properties

### Priority 4: Low

16. **Consider immutable state updates** - Replace `push()`/`splice()` with spread operator patterns

17. **Add Page Object Model** - Create reusable page objects for test selectors

18. **Remove inline event handlers** - Move `onsubmit` handler from HTML to JavaScript

19. **Improve color contrast** - Adjust `--fg-dim` color for better accessibility

20. **Add JSDoc types** - Document complex data structures like the forest Map

---

## Appendix: File-by-File Summary

| File | Lines | Issues Found | Severity |
|------|-------|--------------|----------|
| `server.js` | 632 | 6 | High |
| `lib/tree.js` | 287 | 3 | Medium |
| `lib/render.js` | 522 | 2 | Medium |
| `lib/parse-landing.js` | 199 | 1 | Medium |
| `public/app.js` | 549 | 5 | High |
| `public/style.css` | 628 | 4 | Medium |
| `tests/e2e/*.spec.js` | ~400 | 5 | Medium |

---

*Report generated from automated analysis with manual verification of all findings.*
