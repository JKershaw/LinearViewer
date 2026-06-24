/**
 * Shared E2E session + selector helpers (LIN-215, Track 1).
 *
 * This file is the SESSION + SELECTOR seam. It is deliberately SEPARATE from
 * `tests/fixtures/local-harness.js`, which is the provider SEEDING seam (it
 * builds LocalStore data and establishes a `provider: 'local'` session). Keep
 * the two apart: seed data with the harness, select/interact with these helpers.
 *
 * What lives here:
 *   - `TEST_WORKSPACE_URL_KEY` + `featuresParam()` — the boilerplate constants
 *     and query-string builder that were copy-pasted across specs.
 *   - `createSession(page, overrides)` — wraps `/test/set-session` (the Linear
 *     test-token path) and returns the active workspace urlKey.
 *   - `SELECTORS` — a factory of stable `data-testid` selectors. Prefer these
 *     over `:has-text()`, CSS classes, and exact `href` values (LIN-215). The
 *     matching attributes are emitted by the render files (footer, settings,
 *     render.js project/issue rows, swipe, swim).
 *   - Thin page objects (`footer`, `settings`, `dashboard`) — proof-of-pattern
 *     wrappers over the selectors for the highest-traffic interactions.
 *
 * Parallel-aware by design (the soft coupling to LIN-625): `createSession`
 * resolves the active urlKey and RETURNS it rather than asking callers to assume
 * a global constant, so when LIN-625 threads a per-worker urlKey through
 * `/test/set-session` server-side, the only change here is computing that key —
 * not rewriting every caller. Until then the default stays `TEST_WORKSPACE_URL_KEY`
 * for back-compat. The same rule callers should follow: drive navigation off the
 * urlKey a session helper hands back, never off a hard-coded literal.
 */

/**
 * Default workspace urlKey for the Linear test-token session path
 * (`/test/set-session`). The local-provider harness uses its own
 * `LOCAL_WORKSPACE_URL_KEY` — import that from `fixtures/local-harness.js`.
 */
export const TEST_WORKSPACE_URL_KEY = 'test-workspace'

/**
 * Build the `&features=<json>` query fragment for `/test/set-session`, matching
 * the per-spec `featuresParam` helpers this replaces. Returns '' for an empty
 * or absent map so it can be concatenated unconditionally.
 *
 * @param {Object} [features] - feature-flag overrides (whitelist-validated server-side)
 * @returns {string}
 */
export function featuresParam(features) {
  if (!features || Object.keys(features).length === 0) return ''
  return `&features=${encodeURIComponent(JSON.stringify(features))}`
}

/**
 * Establish a Linear test-token session via `/test/set-session` and return the
 * active workspace urlKey (parallel-aware: callers should navigate off the
 * returned key, not a literal).
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [overrides] - flags forwarded to /test/set-session. Booleans
 *   become presence flags (`?multiWorkspace=true`); a `features` object is
 *   JSON-encoded; everything else is stringified. A `urlKey` override seeds a
 *   per-worker workspace partition (LIN-625 S1, supplied by the `workerUrlKey`
 *   worker fixture once specs are swept); it is forwarded verbatim and echoed
 *   back so callers navigate off the returned key.
 * @returns {Promise<{ urlKey: string }>}
 */
export async function createSession(page, overrides = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'features' || value == null || value === false) continue
    params.set(key, value === true ? 'true' : String(value))
  }
  if (overrides.features) params.set('features', JSON.stringify(overrides.features))
  const qs = params.toString()
  await page.goto(`/test/set-session${qs ? `?${qs}` : ''}`)
  return { urlKey: overrides.urlKey || TEST_WORKSPACE_URL_KEY }
}

/**
 * Stable `data-testid` selector factory. Use over CSS-class / text / href
 * selectors for the migrated surfaces.
 */
export const SELECTORS = {
  footer: {
    /** Footer nav link by its visible text, e.g. 'swipe', 'settings'. */
    link: (name) => `[data-testid="footer-link-${name}"]`,
    aiStatus: '[data-testid="footer-ai-status"]',
  },
  settings: {
    /** Settings card by slug: ai | ai-usage | workflow | workspace-features | experimental | account. */
    section: (name) => `[data-testid="settings-section-${name}"]`,
    /** Feature-toggle line by feature key, e.g. 'dispatch', 'roadmap'. */
    toggle: (key) => `[data-testid="settings-toggle-${key}"]`,
    logout: '[data-testid="settings-logout"]',
  },
  /** A project card by name (replaces `.project:has-text(name)`). */
  project: (name) => `[data-testid="project"][data-project-name="${name}"]`,
  /** An issue row by id (pairs the testid with the existing data-id hook). */
  issue: (id) => `[data-testid="issue-line"][data-id="${id}"]`,
}

/**
 * Footer page object — thin wrapper over the footer selectors.
 * @param {import('@playwright/test').Page} page
 */
export function footer(page) {
  return {
    getLink: (name) => page.locator(SELECTORS.footer.link(name)),
    aiStatus: () => page.locator(SELECTORS.footer.aiStatus),
  }
}

/**
 * Settings page object — selectors plus the common toggle interaction.
 * @param {import('@playwright/test').Page} page
 */
export function settings(page) {
  return {
    section: (name) => page.locator(SELECTORS.settings.section(name)),
    toggle: (key) => page.locator(SELECTORS.settings.toggle(key)),
    logout: () => page.locator(SELECTORS.settings.logout),
    /** Submit a feature toggle's form (flips it on the server, page reloads). */
    toggleFeature: (key) =>
      page.locator(`${SELECTORS.settings.toggle(key)} button[type="submit"]`).click(),
  }
}

/**
 * Dashboard page object — project lookup without `:has-text()`.
 * @param {import('@playwright/test').Page} page
 */
export function dashboard(page) {
  return {
    getProject: (name) => page.locator(SELECTORS.project(name)),
    getIssue: (id) => page.locator(SELECTORS.issue(id)),
  }
}
