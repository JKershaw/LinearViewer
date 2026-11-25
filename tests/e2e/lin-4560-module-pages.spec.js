import { test, expect } from '../fixtures/test-base.js';

/**
 * LIN-4560 beat 1: public/session.js (the run page) and public/dispatch.js (Dispatch) are native ES modules. A module runs
 * after every classic script, so on the run page session.js now runs after question-records.js (the other module, listed
 * before it), and on Dispatch dispatch.js runs after app.js; each one's DOMContentLoaded init registers after the other
 * module's. This loads each page in a real browser and witnesses, page by page:
 *  - the page script arrives as a module (a `type="module"` tag, no classic tag) and the page throws nothing (no page
 *    error, no console error: a MIME, CSP or module-resolution failure shows as one);
 *  - its DOMContentLoaded handler ran: the document holds a DOMContentLoaded listener whose script is that file, read from
 *    Chromium's own listener table (CDP DOMDebugger.getEventListeners), and what the handler draws is on the page (the
 *    run's transcript bubbles; Dispatch history's row with its feedback lines);
 *  - on the run page, the live wall clock ticks. LIN-4537 deleted session.js's `formatElapsed` while its callers stayed,
 *    so the first tick threw a ReferenceError and the clocks never moved; the module imports the shared `fmtDuration`.
 */

/** Collects the page's errors from the moment it is created. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  return errors;
}

/** Watches the page's scripts through CDP from before navigation; `documentListeners(path)` lists the event types the script at `path` bound on `document`. */
async function watchScripts(page) {
  const cdp = await page.context().newCDPSession(page);
  const urls = new Map();
  cdp.on('Debugger.scriptParsed', ({ scriptId, url }) => urls.set(scriptId, url));
  await cdp.send('Debugger.enable');
  return {
    async documentListeners(path) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      return new Set(listeners.filter((l) => new URL(urls.get(l.scriptId) || 'about:blank').pathname === path).map((l) => l.type));
    },
  };
}

async function expectModule(page, src) {
  await expect(page.locator(`script[type="module"][src="${src}"]`)).toHaveCount(1);
  await expect(page.locator(`script[src="${src}"]:not([type="module"])`)).toHaveCount(0);
}

async function clearRuns(page, urlKey) {
  for (const seam of ['clear-ticket-records', 'clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-observation-sessions', 'clear-sessions-feed-cache']) {
    await page.goto(`/test/${seam}?urlKey=${urlKey}`);
  }
}

/**
 * One autopilot session whose worker is taken and has posted a progress line and a [blocked] line, so the run is open
 * (the wall clock has no end) and its transcript has two bubbles. Returns the worker's id.
 */
async function seedOpenRun(page, urlKey) {
  const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-4560', issueTitle: 'Module page seed', target: 'cli' }
  });
  expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
  const anchorId = (await anchor.json()).item.id;
  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-4560', issueTitle: 'Module page worker', target: 'cli', sessionId: anchorId }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json();
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);
  for (const message of ['looked at the module pages', '[blocked] which branch should this land on?']) {
    const fb = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message }
    });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return workerId;
}

async function sessionIdOf(page, urlKey) {
  const resp = await page.request.get(`/workspace/${urlKey}/api/dashboard/sessions`);
  expect(resp.status(), `sessions feed failed: ${await resp.text()}`).toBe(200);
  const body = await resp.json();
  const seeded = [...(body.active || []), ...(body.recent || [])].find((s) => String(s.sessionId || '').length > 0);
  expect(seeded, `no reconstructed session in the feed: ${JSON.stringify(body.counts)}`).toBeTruthy();
  return seeded.sessionId;
}

test.describe('LIN-4560: the run page and Dispatch load their page scripts as modules', () => {
  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await clearRuns(page, workerUrlKey);
    await seedOpenRun(page, workerUrlKey);
  });

  test('run page: session.js is a module, its DOMContentLoaded handler draws the transcript, the wall clock ticks, and the page throws nothing', async ({ page, workerUrlKey }) => {
    const sessionId = await sessionIdOf(page, workerUrlKey);
    const errors = watchErrors(page);
    const scripts = await watchScripts(page);
    const res = await page.goto(`/workspace/${workerUrlKey}/observation/session/${encodeURIComponent(sessionId)}`);
    expect(res.status()).toBe(200);
    await expectModule(page, '/session.js');
    await expectModule(page, '/question-records.js');
    await page.waitForLoadState('networkidle');
    expect([...await scripts.documentListeners('/session.js')]).toEqual(expect.arrayContaining(['DOMContentLoaded']));
    await expect(page.locator('[data-testid="session-run-transcript"] [data-testid="transcript-entry"]')).toHaveCount(2);

    const wall = page.locator('[data-testid="session-elapsed"]');
    await expect(wall).toHaveAttribute('data-end', '');
    const first = await wall.textContent();
    await expect.poll(async () => wall.textContent(), { timeout: 5000, message: 'the open wall clock moves without a reload' }).not.toBe(first);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Dispatch: dispatch.js is a module, its DOMContentLoaded handler draws the history with its feedback lines, and the page throws nothing', async ({ page, workerUrlKey }) => {
    const errors = watchErrors(page);
    const scripts = await watchScripts(page);
    const history = page.waitForResponse((r) => r.url().includes(`/workspace/${workerUrlKey}/api/dispatch/history`));
    const res = await page.goto(`/workspace/${workerUrlKey}/dispatch`);
    expect(res.status()).toBe(200);
    await expectModule(page, '/dispatch.js');
    await expectModule(page, '/app.js');
    expect((await history).ok()).toBe(true);
    await page.waitForLoadState('networkidle');
    expect([...await scripts.documentListeners('/dispatch.js')]).toEqual(expect.arrayContaining(['DOMContentLoaded']));
    const row = page.locator('.history-item', { hasText: 'Module page worker' }).or(page.locator('.history-item', { hasText: 'implementation' })).first();
    await expect(row).toBeAttached();
    await expect(row.locator('[data-testid="history-transcript"] [data-testid="transcript-entry"]')).toHaveCount(2);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
