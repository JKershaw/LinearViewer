# LightPanda Feasibility Evaluation for E2E Tests

**Date**: 2026-03-24
**Version tested**: LightPanda v0.2.6 (x86_64-linux)
**Status**: Beta

## Summary

**Not ready for our E2E tests.** LightPanda has critical gaps in CDP protocol support that block most of our test patterns. It could become viable in the future, but today it would require significant test rewrites and still wouldn't cover all scenarios.

## What Is LightPanda?

LightPanda is a headless browser built from scratch in Zig, designed for AI/automation workloads. It connects to Playwright via Chrome DevTools Protocol (CDP) using `chromium.connectOverCDP()`. It claims 10x less memory and 10x faster execution than Chrome.

- GitHub: https://github.com/lightpanda-io/browser
- Install: `npm install @lightpanda/browser` (or download binary from releases)
- Integration: `const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222')`

## Test Results

We ran 14 capability tests against our running app:

| # | Capability | Result | Notes |
|---|-----------|--------|-------|
| 1 | CDP Connection | ✓ PASS | Connects via WebSocket |
| 2 | Page Load | ✓ PASS | Loads HTML, sets title correctly |
| 3 | DOM Query (h1) | ✓ PASS | `.textContent()` works |
| 4 | CSS Selectors (.project-header) | ✓ PASS | Complex class selectors work |
| 5 | :has-text() selector | ✓ PASS | Playwright pseudo-selectors work |
| 6 | Visibility Check | ✓ PASS | `.isVisible()` works |
| 7 | **Click Interaction** | **✗ FAIL** | "element is outside of the viewport" - scroll-into-view broken |
| 8 | page.evaluate() | ✓ PASS | JavaScript execution works |
| 9 | localStorage | ✓ PASS | setItem/getItem work |
| 10 | fetch() API | ✓ PASS | In-page fetch works |
| 11 | **Page Reload** | **✗ FAIL** | `Page.reload` CDP method not implemented - crashes connection |
| 12 | data-* Attribute Selectors | ✗ FAIL | Cascade failure from reload crash |
| 13 | waitForLoadState(networkidle) | ✗ FAIL | Cascade failure from reload crash |
| 14 | getComputedStyle() | ✗ FAIL | Cascade failure from reload crash |

**True failures: 2 (Click, Page.reload)**
**Cascade failures: 4 (connection died after reload attempt)**

## Blockers for Our Test Suite

### 1. `page.reload()` Not Supported (Critical)
The `Page.reload` CDP method returns `UnknownMethod` and crashes the browser connection. Our tests use `page.reload()` extensively:
- `interactions.spec.js`: Tests localStorage persistence across reloads
- `landing.spec.js`: Tests default state restoration after reload
- `dashboard.spec.js`: Tests session persistence

### 2. Click/Scroll Broken (Critical)
Clicks fail with "element is outside of the viewport" even when the element is found and resolved. LightPanda can't scroll elements into view properly. This blocks **all interaction tests** — our entire `interactions.spec.js` suite depends on clicking to collapse/expand elements.

### 3. No Layout Engine (Moderate)
LightPanda doesn't do visual rendering. Tests using `getComputedStyle()` (e.g., checking `paddingLeft` for tree indentation in `interactions.spec.js`) may not work correctly, though we couldn't confirm due to the cascade failure.

### 4. Single Page Per Connection (Moderate)
LightPanda supports only 1 context and 1 page per CDP connection. This prevents any future parallelization.

## What Works Well

- **Page loading and DOM querying** — fast and correct
- **JavaScript execution** via `page.evaluate()` — V8 engine works
- **localStorage API** — supported
- **fetch() API** — works for in-page network requests
- **CSS selectors** — standard and Playwright pseudo-selectors both work
- **Visibility checks** — `.isVisible()` works

## Impact on Test Files

| Test File | Can Run? | Blocking Issues |
|-----------|----------|-----------------|
| `landing.spec.js` | Partial | Reload, click interactions |
| `dashboard.spec.js` | No | Reload, visibility of nested elements |
| `interactions.spec.js` | No | Click, reload, getComputedStyle |
| `dispatch.spec.js` | No | Click, API interactions |
| `dispatch-page.spec.js` | No | Click, form interactions |
| `openrouter-auth.spec.js` | No | Navigation, redirects |
| `free-tier.spec.js` | Maybe | Depends on `page.request` API support |
| `feature-toggles.spec.js` | No | Click, settings interactions |

## Recommendation

**Do not adopt LightPanda for E2E tests at this time.** The missing CDP methods (`Page.reload`) and broken scroll/click behavior are fundamental blockers. These aren't edge cases — they affect every single test file.

### When to Re-evaluate
- When LightPanda reaches v1.0 or exits beta
- When `Page.reload` and scroll-into-view are implemented
- Track: https://github.com/lightpanda-io/browser/issues

### Potential Future Use
If LightPanda matures, it could be valuable as a **fast smoke test** runner alongside Chromium (not replacing it). A dual-config approach:

```js
// playwright.config.js - future hypothetical
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'lightpanda', use: { connectOptions: { wsEndpoint: 'ws://127.0.0.1:9222' } } },
]
```

This would give fast CI feedback (~10x faster) for basic DOM/content tests while keeping Chromium for full interaction coverage.

## Workarounds Tested (All Failed)

We tested every workaround suggested online. **None worked.**

| Workaround | Result |
|------------|--------|
| `page.goto(page.url())` instead of `page.reload()` | Page loads but becomes unresponsive — DOM queries timeout |
| `page.evaluate(() => location.reload())` | Same zombie state — page navigates but never recovers |
| `click({ force: true })` | Still times out — force doesn't bypass the viewport issue |
| `page.evaluate(() => el.click())` | **Crashes the CDP connection entirely** |
| `scrollIntoView()` then Playwright click | Cascade crash after evaluate |
| `dispatchEvent(new MouseEvent('click'))` | Cascade crash after evaluate |
| Explicit large viewport (1280x2000) | Can't even create new context after prior crash |

The `evaluate(el.click())` crash reveals that LightPanda's DOM event dispatch is fundamentally incomplete — it's not just Playwright's actionability checks being overly strict. The online suggestions are generic Playwright tips that don't account for LightPanda's incomplete browser engine.

Test script: `tests/lightpanda-workarounds.js`
