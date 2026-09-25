/**
 * LIN-2994 Surface 4 / LIN-3026 — the Dispatch-page Workspace Halt section.
 *
 * Modelled on tests/e2e/dispatch-page.spec.js / dispatch.spec.js:
 * `seedLocalWorkspace` (LIN-215 provider-seeding seam), navigation driven off
 * the `urlKey` a session helper returns, and `SELECTORS`/page-object
 * `data-testid` selection (tests/helpers.js) rather than `:has-text()` or
 * CSS classes.
 *
 * This is a REQUEST-only surface (Decision 4, best-effort): the runner does
 * not yet honor a dashboard halt (pending LIN-2995). These specs only pin
 * the user-visible control flow, the requested-not-effective copy, the
 * poll-delivery contract, and the section's own periodic refresh/failure
 * behavior — never that anything is actually paused/stopped.
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { dispatchHalt } from '../helpers.js';

let WS, DISPATCH_URL, API_PREFIX;

test.describe('Workspace Halt (LIN-2994 Surface 4 / LIN-3026)', () => {
  // Clears the halt on this worker's urlKey and PROVES it (close-out L2):
  // a 200 from the clear endpoint alone can't detect a clear that silently
  // does nothing, so read the halt back through the dashboard GET and
  // require `{ halt: null }`.
  async function clearHaltAndProve(page) {
    const clearRes = await page.request.get(`/test/clear-workspace-halt?urlKey=${WS}`);
    expect(clearRes.status()).toBe(200);
    const readBack = await page.request.get(`${API_PREFIX}/api/dispatch/halt`);
    expect(readBack.status()).toBe(200);
    expect(await readBack.json()).toEqual({ halt: null });
  }

  test.beforeEach(async ({ page, localWorkerUrlKey }) => {
    WS = localWorkerUrlKey;
    DISPATCH_URL = `/workspace/${WS}/dispatch`;
    API_PREFIX = `/workspace/${WS}`;

    await seedLocalWorkspace(page, null, { features: { dispatch: true }, urlKey: WS });

    // Isolation, asserted rather than assumed (plan-review d745e3ec carry-
    // forward #2, close-out L2). Deliberately dirty the worker's halt FIRST,
    // then clear and read back: the clear is exercised against a set halt on
    // every test, so a no-op clear fails every spec on its own — even one run
    // alone with `-g` — instead of only when an earlier spec happened to
    // leave a halt behind.
    const dirty = await page.request.post(`${API_PREFIX}/api/dispatch/halt`, { data: { mode: 'stop' } });
    expect(dirty.status()).toBe(200);
    await clearHaltAndProve(page);
  });

  // Several specs leave a halt set; never leak it to other specs sharing this
  // worker's urlKey (e.g. settings.spec.js polls it without clearing).
  test.afterEach(async ({ page }) => {
    await clearHaltAndProve(page);
  });

  test('sets a halt from the dashboard UI, delivers it on poll before Resume, and poll reverts to exactly {items} after Resume', async ({ page }) => {
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');

    const halt = dispatchHalt(page);
    await expect(halt.status()).toHaveText('No halt requested.');

    // Mint a real dispatch token through the dashboard route (session-authed
    // — the same route tests/e2e/dispatch.spec.js:1212 exercises), used
    // below to poll exactly as a runner/consumer would.
    const tokenRes = await page.request.post(`${API_PREFIX}/api/dispatch/tokens`, {
      data: { label: 'halt-e2e' },
    });
    expect(tokenRes.status()).toBe(201);
    const { token } = await tokenRes.json();

    // Set a halt via the dashboard UI control.
    await halt.pause().click();
    await expect(halt.status()).toContainText('Pause requested', { timeout: 5000 });

    // POSITIVE assertion first (plan §6/f, verdict d745e3ec's "positive
    // before exact" ordering): confirm the halt is actually delivered on
    // poll BEFORE Resume. Asserting only the post-Resume `{items}` shape
    // would pass vacuously if the halt was never delivered at all.
    const pollBefore = await page.request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pollBefore.status()).toBe(200);
    const bodyBefore = await pollBefore.json();
    expect(Object.keys(bodyBefore).sort()).toEqual(['halt', 'items']);
    expect(bodyBefore.halt.mode).toBe('pause');
    expect(typeof bodyBefore.halt.setAt).toBe('string');
    expect(bodyBefore.halt.setBy).toBeTruthy();
    expect(Object.keys(bodyBefore.halt).sort()).toEqual(['mode', 'setAt', 'setBy']);

    // Resume via the dashboard UI control.
    await halt.resume().click();
    await expect(halt.status()).toHaveText('No halt requested.', { timeout: 5000 });

    // Exactly `{ items }` afterward — the `halt` key must be OMITTED
    // entirely (not `halt: null`), matching routes/dispatch.js's poll
    // contract once the store's last-known cache is cleared.
    const pollAfter = await page.request.get('/api/dispatch/poll', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bodyAfter = await pollAfter.json();
    expect(Object.keys(bodyAfter)).toEqual(['items']);
  });

  test('honesty copy: requested-not-effective wording, scoped to the halt section, never says paused/stopped', async ({ page }) => {
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');

    const halt = dispatchHalt(page);

    // Disclosure is visible statically, before any control is used.
    await expect(halt.disclaimer()).toContainText('POST /api/proxy/dispatch/halt');
    // Close-out L7: the escape hatch needs a read-write proxy token, minted
    // from a flag-gated page — the copy must say so rather than promise a
    // path the operator may not have ready.
    await expect(halt.disclaimer()).toContainText('needs a read-write proxy token');
    await expect(halt.disclaimer()).toContainText('before an incident');

    await halt.stop().click();
    await expect(halt.status()).toContainText('Stop requested', { timeout: 5000 });
    await expect(halt.status()).toContainText('LIN-2995');

    // Scoped to the halt section's own status/disclaimer nodes ONLY (plan-
    // review CF3): a page-wide `/\b(paused|stopped)\b/i` would also match
    // this page's own "continue until stopped" Autopilot copy elsewhere,
    // so the negative check must not run page-wide.
    const statusText = await halt.status().textContent();
    const disclaimerText = await halt.disclaimer().textContent();
    expect(statusText).not.toMatch(/\b(paused|stopped)\b/i);
    expect(disclaimerText).not.toMatch(/\b(paused|stopped)\b/i);
  });

  test('periodic refresh: an out-of-band write updates the section without a reload', async ({ page }) => {
    // page.clock must be installed BEFORE the flag-on navigation —
    // public/dispatch.js schedules its first halt-refresh timer on
    // DOMContentLoaded (precedent: tests/e2e/flight-companion.spec.js's
    // "Silent auto-wake tick (page.clock)" block).
    await page.clock.install();
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');

    const halt = dispatchHalt(page);
    await expect(halt.status()).toHaveText('No halt requested.');

    // Set the halt OUT OF BAND — a direct API write, not through this
    // page's own Pause button — so this witness proves the section's
    // independent periodic poll, not its response-driven write-render path
    // (which beat 2's own manual verification already exercised).
    const res = await page.request.post(`${API_PREFIX}/api/dispatch/halt`, {
      data: { mode: 'stop' },
    });
    expect(res.status()).toBe(200);

    // HALT_POLL_MS (public/dispatch.js) is 30s. The intercepted-count fixture
    // route is still a real round trip through Playwright's router; only
    // Date/setTimeout inside the page are virtualized here, so this does not
    // race the real store write above.
    await page.clock.fastForward(30000);

    await expect(halt.status()).toContainText('Stop requested', { timeout: 5000 });
  });

  test('read failure: the section shows the disclosure and never says paused/stopped', async ({ page }) => {
    // Fail only the GET (the section's own small read) — POST/DELETE must
    // still pass through untouched, so this isolates the read-failure path.
    await page.route(`**/workspace/${WS}/api/dispatch/halt`, (route) => {
      if (route.request().method() === 'GET') return route.abort();
      return route.continue();
    });

    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');

    const halt = dispatchHalt(page);
    await expect(halt.status()).toContainText('Failed to load halt status', { timeout: 5000 });
    // The read-failure state reuses the degraded-mode disclosure verbatim.
    await expect(halt.status()).toContainText('POST /api/proxy/dispatch/halt');

    // Close-out L1: the client failure copy can't drift from the rendered
    // disclosure — exact markup equality, not a substring, so a one-word
    // change on either side goes red.
    const disclaimerHtml = await halt.disclaimer().innerHTML();
    expect(disclaimerHtml).toContain('POST /api/proxy/dispatch/halt');
    expect(await halt.status().innerHTML()).toBe(`Failed to load halt status. ${disclaimerHtml}`);

    const statusText = await halt.status().textContent();
    expect(statusText).not.toMatch(/\b(paused|stopped)\b/i);
  });
  test('write failure keeps the last known halt visible, and the error toast carries the disclosure', async ({ page }) => {
    await page.goto(DISPATCH_URL);
    await page.waitForLoadState('networkidle');

    const halt = dispatchHalt(page);
    await halt.pause().click();
    await expect(halt.status()).toContainText('Pause requested', { timeout: 5000 });

    // Fail only the write; the server still holds the pause.
    await page.route(`**/workspace/${WS}/api/dispatch/halt`, (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Failed to set halt' }) });
      }
      return route.continue();
    });
    await halt.stop().click();

    // Close-out L3: the failure notice is ADDED to the known state, never
    // replaces it — the operator must still see that a pause is requested.
    await expect(halt.status()).toContainText('Failed to request stop', { timeout: 5000 });
    await expect(halt.status()).toContainText('Pause requested');
    await expect(halt.status()).not.toContainText('Stop requested');
    await expect(halt.status()).toContainText('POST /api/proxy/dispatch/halt');
    expect(await halt.status().textContent()).not.toMatch(/\b(paused|stopped)\b/i);

    // Close-out L4: the transient error toast carries the same disclosure
    // (plain text of the one rendered source), not just the raw error.
    const disclaimerText = (await halt.disclaimer().textContent()).trim();
    const toastEl = page.getByRole('alert').filter({ hasText: 'Failed to request stop' });
    await expect(toastEl).toBeVisible({ timeout: 5000 });
    await expect(toastEl).toContainText(disclaimerText);
  });

  test('periodic refresh is skipped while the tab is hidden and stops after beforeunload', async ({ page }) => {
    await page.clock.install();

    const haltPath = `/workspace/${WS}/api/dispatch/halt`;
    let pollGets = 0;
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (req.method() === 'GET' && url.pathname === haltPath && !url.searchParams.has('settle')) pollGets++;
    });
    // A marker request issued AFTER the ticks under test: once its fetch
    // resolves, every GET a tick issued earlier has already been counted, so
    // a zero count is settled rather than merely early.
    let settleN = 0;
    const settle = () => page.evaluate((u) => fetch(u).then(r => r.status), `${haltPath}?settle=${++settleN}`);

    await page.goto(DISPATCH_URL);
    const halt = dispatchHalt(page);
    await expect(halt.status()).toHaveText('No halt requested.');
    await settle();

    // Control: a visible tab refreshes once per HALT_POLL_MS (30s).
    pollGets = 0;
    await page.clock.fastForward(30000);
    await settle();
    expect(pollGets).toBe(1);

    // Close-out L5 (a): hidden -> 90s elapse (fastForward fires a due timer at
    // most once, so a broken skip shows as 1 GET, not 3), zero GETs.
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    pollGets = 0;
    await page.clock.fastForward(90000);
    await settle();
    expect(pollGets).toBe(0);

    // Visible again -> polling resumes.
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
    pollGets = 0;
    await page.clock.fastForward(30000);
    await settle();
    expect(pollGets).toBe(1);

    // Close-out L5 (b): beforeunload clears the timer -> zero GETs after.
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    pollGets = 0;
    await page.clock.fastForward(120000);
    await settle();
    expect(pollGets).toBe(0);
  });

  test('hung read: times out into the failure state with the disclosure instead of loading forever', async ({ page }) => {
    await page.clock.install();
    // The section's GET never answers; writes pass through.
    await page.route(`**/workspace/${WS}/api/dispatch/halt`, (route) => {
      if (route.request().method() === 'GET') return; // never fulfilled
      return route.continue();
    });

    await page.goto(DISPATCH_URL);
    const halt = dispatchHalt(page);
    await expect(halt.status()).toHaveText('Loading…');

    // Close-out L9: HALT_READ_TIMEOUT_MS (public/dispatch.js) is 10s.
    await page.clock.fastForward(10000);
    await expect(halt.status()).toContainText('Failed to load halt status', { timeout: 5000 });
    const disclaimerHtml = await halt.disclaimer().innerHTML();
    expect(await halt.status().innerHTML()).toBe(`Failed to load halt status. ${disclaimerHtml}`);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
