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

import { expect } from '@playwright/test'

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
    // LIN-3849: `runnerKey` is tri-state (omitted leaves the stores alone, true mints
    // a live runner key for the owner, false clears every key), so false is sent.
    if (key === 'runnerKey') { if (value != null) params.set('runnerKey', value ? '1' : '0'); continue }
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
  nav: {
    /**
     * Header view-switcher link by its visible text, e.g. 'swipe', 'settings'
     * (LIN-978). The cross-view links moved here from the footer.
     */
    view: (name) => `.nav-views [data-testid="nav-view-${name}"]`,
  },
  settings: {
    /** Settings group by slug (LIN-3846 kept the survivors): account | providers | ai-model | dispatch-defaults | dispatch-presets | ai-usage | workspace-features | experimental | workflow. */
    section: (name) => `[data-testid="settings-section-${name}"]`,
    /** An area's page frame (LIN-3846): sources | models | running | agent-access | health | change-log | features | account. */
    area: (id) => `[data-testid="settings-area-${id}"]`,
    /** A sidebar row, and its state word. */
    navRow: (id) => `[data-testid="settings-nav-${id}"]`,
    navState: (id) => `[data-testid="settings-state-${id}"]`,
    /** Feature-toggle line by feature key, e.g. 'dispatch', 'roadmap'. */
    toggle: (key) => `[data-testid="settings-toggle-${key}"]`,
    logout: '[data-testid="settings-logout"]',
    /** Every switch row (LIN-3888); filter by `hasText` for one by its label. */
    switchRows: '[data-testid^="settings-toggle-"]',
    /** A feature switch's button: the row's form submit (LIN-3888, the `toggleFeature` precedent). Its text is `● on` / `○ off`, its state `aria-checked`. */
    switch: (key) => `[data-testid="settings-toggle-${key}"] button[type="submit"]`,
    /** Every group heading that carries a title test id; filter by `hasText` for one by its words. */
    groupTitles: '[data-testid^="settings-section-"][data-testid$="-title"]',
    /** One group's heading, by its section slug (LIN-3888). */
    groupTitle: (name) => `[data-testid="settings-section-${name}-title"]`,
    /** Every group's frame (LIN-3888): the section slug prefix. */
    sections: '[data-testid^="settings-section-"]',
    /** The page frame beside the list, on a phone and on desktop (LIN-3888). */
    pane: '[data-testid="settings-pane"]',
    /** A sidebar state's dot, by area (LIN-3888). */
    dot: (area) => `[data-testid="settings-dot-${area}"]`,
    /** Account's OpenRouter row: the status word, and its connect and disconnect controls (LIN-3888). */
    openRouterStatus: '[data-testid="settings-openrouter-status"]',
    openRouterConnect: '[data-testid="settings-openrouter-connect"]',
    openRouterDisconnect: '[data-testid="settings-openrouter-disconnect"]',
    /** An experimental view's link on Settings › Features, by flag key (LIN-3888): `settings-open-{key}`. */
    openLink: (key) => `[data-testid="settings-open-${key}"]`,
    /** The active source's marker on a binding row (LIN-3888). */
    providerActive: '[data-testid="settings-provider-active"]',
    /** A key row in Settings › Agent access (LIN-3888): its test id is `settings-key-{source}`. Absent from the Proxy and Dispatch pages. */
    keyRows: '[data-testid^="settings-key-"]',
    /** The new Proxy key's name input (LIN-3888). */
    newKeyLabel: '[data-testid="settings-newkey-label"]',
  },
  /** A Dispatch page section by its name: send-prompt | halt | queue | tokens | guide | history (LIN-3888). */
  dispatchSection: (name) => `[data-testid="dispatch-section-${name}"]`,
  /** A project card by name (replaces `.project:has-text(name)`). */
  project: (name) => `[data-testid="project"][data-project-name="${name}"]`,
  /** An issue row by id (pairs the testid with the existing data-id hook). */
  issue: (id) => `[data-testid="issue-line"][data-id="${id}"]`,
  /** Workspace KPIs page (LIN-3689): section, card and empty-state test ids. */
  workspaceKpis: {
    section: (name) => `[data-testid="workspace-kpis-section-${name}"]`,
    card: (name) => `[data-testid="workspace-kpis-card-${name}"]`,
    empty: '[data-testid="workspace-kpis-empty"]',
    /** Trend charts (LIN-3711): name is done-per-day | runs-by-kind | cost. */
    chart: (name) => `[data-testid="workspace-kpis-chart-${name}"]`,
    numbers: (name) => `[data-testid="workspace-kpis-numbers-${name}"]`,
    table: (name) => `[data-testid="workspace-kpis-table-${name}"]`,
    /** Card sparkline: dispatches | autopilot-runs | agent-actions. */
    spark: (card) => `[data-testid="workspace-kpis-spark-${card}"]`,
    noscript: '[data-testid="workspace-kpis-noscript"]',
  },
  /** Public /kpis page (LIN-3703): section, card, chart and hidden-row test ids. */
  publicKpis: {
    headline: '[data-testid="kpis-headline"]',
    section: (name) => `[data-testid="kpis-section-${name}"]`,
    card: (name) => `[data-testid="kpis-card-${name}"]`,
    chart: (name) => `[data-testid="kpis-chart-${name}"]`,
    spark: (name) => `[data-testid="kpis-spark-${name}"]`,
    numbers: (name) => `[data-testid="kpis-numbers-${name}"]`,
    /** LIN-3714: the cost-per-finished-task figure, its value and its fold. */
    cost: '[data-testid="kpis-cost"]',
    costValue: '[data-testid="kpis-cost-value"]',
    costNumbers: '[data-testid="kpis-cost-numbers"]',
    hidden: '[data-testid="kpis-hidden"]',
    privacy: '[data-testid="kpis-privacy"]',
  },
  dispatchHalt: {
    status: '[data-testid="dispatch-halt-status"]',
    disclaimer: '[data-testid="dispatch-halt-disclaimer"]',
    pause: '[data-testid="dispatch-halt-pause"]',
    stop: '[data-testid="dispatch-halt-stop"]',
    resume: '[data-testid="dispatch-halt-resume"]',
  },
}

/**
 * LIN-3715: assert a page has no horizontal overflow that `overflow-x: clip`
 * would hide. html and body are `overflow-x: clip` site-wide (public/style.css,
 * LIN-1068), so `document.documentElement.scrollWidth - clientWidth` reads 0
 * whatever the page does (same trap as LIN-2830, LIN-3710) — never use it as a
 * witness. This measures rendered geometry instead:
 *   - `body.scrollWidth <= body.clientWidth` (body still reports its content width);
 *   - no element sits past the viewport's right edge unless an ancestor below
 *     body scrolls or clips it (a contained box is allowed to be wide inside);
 *   - `boxes`: each matching element has `scrollWidth <= clientWidth`;
 *   - `wrapSel` + `wraps`: each matching wrapper exists and scrolls
 *     (`overflow-x: auto`), which is what keeps a wide table inside its box.
 */
export async function expectNoClippedOverflow(page, { boxes = '', wrapSel = '', wraps = false } = {}) {
  const m = await page.evaluate(({ boxes, wrapSel }) => {
    const vw = document.documentElement.clientWidth;
    const contains = el => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    return {
      body: document.body.scrollWidth - document.body.clientWidth,
      spill: [...document.body.querySelectorAll('*')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !contains(el); })
        .map(el => `${el.dataset.testid || el.id || el.tagName.toLowerCase() + '.' + el.className}@${Math.round(el.getBoundingClientRect().right)}>${vw}`),
      boxes: boxes ? [...document.querySelectorAll(boxes)]
        .map(el => ({ id: el.dataset.testid, over: el.scrollWidth - el.clientWidth }))
        .filter(b => b.over > 0) : [],
      wraps: wrapSel ? [...document.querySelectorAll(wrapSel)].map(el => getComputedStyle(el).overflowX) : [],
    };
  }, { boxes, wrapSel });
  expect(m.body, 'body is wider than its box').toBeLessThanOrEqual(0);
  expect(m.spill, 'elements spill past the viewport').toEqual([]);
  expect(m.boxes).toEqual([]);
  if (wraps) {
    expect(m.wraps.length).toBeGreaterThan(0);
    for (const overflowX of m.wraps) expect(overflowX).toBe('auto');
  }
}

/**
 * Workspace Halt (LIN-2994 Surface 4 / LIN-3026) page object.
 * @param {import('@playwright/test').Page} page
 */
export function dispatchHalt(page) {
  return {
    status: () => page.locator(SELECTORS.dispatchHalt.status),
    disclaimer: () => page.locator(SELECTORS.dispatchHalt.disclaimer),
    pause: () => page.locator(SELECTORS.dispatchHalt.pause),
    stop: () => page.locator(SELECTORS.dispatchHalt.stop),
    resume: () => page.locator(SELECTORS.dispatchHalt.resume),
  }
}

/**
 * Workspace KPIs page object (LIN-3689).
 * @param {import('@playwright/test').Page} page
 */
export function workspaceKpis(page) {
  return {
    section: (name) => page.locator(SELECTORS.workspaceKpis.section(name)),
    card: (name) => page.locator(SELECTORS.workspaceKpis.card(name)),
    empty: () => page.locator(SELECTORS.workspaceKpis.empty),
    /** Text of a card's windowed value, e.g. value('dispatches', '30d'). */
    value: (card, window) => page.locator(`[data-testid="workspace-kpis-value-${card}-${window}"]`),
    kindRows: () => page.locator('[data-testid="workspace-kpis-kind-row"]'),
    chart: (name) => page.locator(SELECTORS.workspaceKpis.chart(name)),
    numbers: (name) => page.locator(SELECTORS.workspaceKpis.numbers(name)),
    table: (name) => page.locator(SELECTORS.workspaceKpis.table(name)),
    spark: (card) => page.locator(SELECTORS.workspaceKpis.spark(card)),
  }
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
 * Header nav page object — the shared view switcher (LIN-978).
 * @param {import('@playwright/test').Page} page
 */
export function nav(page) {
  return {
    /** Header view-switcher link by visible text, e.g. 'swim', 'settings'. */
    getView: (name) => page.locator(SELECTORS.nav.view(name)),
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
    area: (id) => page.locator(SELECTORS.settings.area(id)),
    navRow: (id) => page.locator(SELECTORS.settings.navRow(id)),
    navState: (id) => page.locator(SELECTORS.settings.navState(id)),
    /** Open one area's page (LIN-3846): Settings is a page per area. */
    gotoArea: (urlKey, id) => page.goto(`/workspace/${urlKey}/settings/${id}`),
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
