import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';

/**
 * LIN-4463 piece 5: public/app.js is a native ES module on all eleven pages that load it. A module runs after every
 * classic script, so on ten of them it now runs after the classic page script listed after it, and its DOMContentLoaded
 * init registers after that script's. This loads each page in a real browser and witnesses, page by page:
 *  - app.js arrives as a module (a `type="module"` tag, no classic tag) and the page throws nothing (no page error, no
 *    console error: a MIME, CSP or module-resolution failure shows as one);
 *  - app.js's DOMContentLoaded handler ran on that page: the document holds the click and keydown listeners that handler's
 *    inits bind, read from Chromium's own listener table (CDP DOMDebugger.getEventListeners, filtered to listeners whose
 *    script is /app.js), on every page including the signed-out landing page. Witnessed red: registering the handler
 *    only while `document.readyState === 'loading'` (false by the time a module runs) fails every page here;
 *  - on a signed-in page with the run controls on, its queue panel init reads the nav badge's count
 *    (GET …/api/dispatch/count, through common.js's updateQueueBadge, which moved there in this change).
 */

/** The signed-in pages that load app.js (the eleventh, landing, is signed out and has its own test below). */
const PAGES = [
  { name: 'Home', path: (k) => `/workspace/${k}/` },
  { name: 'Dispatch', path: (k) => `/workspace/${k}/dispatch` },
  { name: 'Settings', path: (k) => `/workspace/${k}/settings` },
  { name: 'Prompts', path: (k) => `/workspace/${k}/prompts` },
  { name: 'Custom prompts', path: (k) => `/workspace/${k}/prompts/custom` },
  { name: 'Proxy', path: (k) => `/workspace/${k}/proxy` },
  { name: 'Effort read-out', path: (k) => `/workspace/${k}/effort-readout` },
  { name: 'Escalation KPIs', path: (k) => `/workspace/${k}/escalation-kpis` },
  { name: 'Workspace KPIs', path: (k) => `/workspace/${k}/kpis` },
  { name: 'Audit', path: () => '/audit' },
];

/** Collects the page's errors from the moment it is created. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  return errors;
}

/**
 * Watches the page's scripts through CDP, from before navigation, so a listener's script id maps to its URL. `listeners()`
 * returns the event types the script at /app.js has bound on `document`, read from Chromium's own listener table.
 */
async function watchScripts(page) {
  const cdp = await page.context().newCDPSession(page);
  const urls = new Map();
  cdp.on('Debugger.scriptParsed', ({ scriptId, url }) => urls.set(scriptId, url));
  await cdp.send('Debugger.enable');
  return {
    async appDocumentListeners() {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      return new Set(listeners.filter((l) => new URL(urls.get(l.scriptId) || 'about:blank').pathname === '/app.js').map((l) => l.type));
    },
  };
}

async function expectAppIsAModule(page) {
  await expect(page.locator('script[type="module"][src="/app.js"]')).toHaveCount(1);
  await expect(page.locator('script[src="/app.js"]:not([type="module"])')).toHaveCount(0);
}

test.describe('app.js as a module, on every page that loads it', () => {
  test.beforeEach(async ({ page, localWorkerUrlKey }) => {
    await seedLocalWorkspace(page, null, { urlKey: localWorkerUrlKey, runnerKey: true });
  });

  for (const { name, path } of PAGES) {
    test(`${name}: loads app.js as a module, its DOMContentLoaded handler runs and reads the queue count, and the page throws nothing`, async ({ page, localWorkerUrlKey }) => {
      const errors = watchErrors(page);
      const scripts = await watchScripts(page);
      const countRead = page.waitForResponse((res) => res.url().includes(`/workspace/${localWorkerUrlKey}/api/dispatch/count`));
      const res = await page.goto(path(localWorkerUrlKey));
      expect(res.status()).toBe(200);
      await expectAppIsAModule(page);
      await expect(page.locator(`[data-queue-badge][data-url-key="${localWorkerUrlKey}"]`)).toHaveCount(1);
      expect((await countRead).ok()).toBe(true);
      await expect(page.locator('main').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect([...await scripts.appDocumentListeners()]).toEqual(expect.arrayContaining(['DOMContentLoaded', 'click', 'keydown']));
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test('Landing (signed out): app.js is a module, its DOMContentLoaded handler binds its listeners, and the page throws nothing', async ({ page }) => {
  await page.goto('/test/clear-session');
  const errors = watchErrors(page);
  const scripts = await watchScripts(page);
  await page.goto('/');
  await expectAppIsAModule(page);
  await page.waitForLoadState('networkidle');
  expect([...await scripts.appDocumentListeners()]).toEqual(expect.arrayContaining(['DOMContentLoaded', 'click', 'keydown']));
  expect(errors, errors.join('\n')).toEqual([]);
});
