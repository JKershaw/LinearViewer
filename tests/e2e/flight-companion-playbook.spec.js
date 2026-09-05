import { test, expect } from '../fixtures/test-base.js';

// LIN-2625: the empty state shows the playbook's open promises before you tap
// anything. Seeds the companion record's `notes` field via the test-only
// fixture route (routes/test.js's /test/set-flight-companion-playbook —
// writes ONLY that fixture path, never the real remember/turn-core write,
// which is covered by tests/unit/flight-companion-turn-core.test.js) and
// checks the page's own read-only endpoint (routes/flight-companion.js's
// GET .../api/flight-companion/playbook) renders it client-side
// (public/flight-companion.js) with no chat turn involved.

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

let URL_KEY;
let PAGE_URL;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/flight-companion`;
});

test.describe('Flight Companion playbook empty state (LIN-2625)', () => {
  test('renders a fixture playbook\'s open promises before any chat interaction', async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

    const seed = await page.request.post('/test/set-flight-companion-playbook', {
      data: { urlKey: URL_KEY, playbook: 'last time: confirm LIN-1988 at 08:00 · lane G on LIN-2551' },
    });
    expect(seed.ok()).toBeTruthy();

    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');

    const emptyState = page.locator('#flight-companion-chat-empty');
    await expect(emptyState).toContainText('confirm LIN-1988 at 08:00');
    await expect(emptyState).toContainText('lane G on LIN-2551');
  });

  test('no playbook seeded renders the ordinary generic empty state, unchanged', async ({ page }) => {
    await page.goto(`/test/set-session?${featuresParam({ flightCompanion: true })}&urlKey=${URL_KEY}`);

    // Explicit reset rather than relying on file/test execution order: the
    // companion record is real, durable store state shared by every test
    // against this worker's urlKey, so a prior test's seed must not leak in.
    const reset = await page.request.post('/test/set-flight-companion-playbook', {
      data: { urlKey: URL_KEY, playbook: '' },
    });
    expect(reset.ok()).toBeTruthy();

    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');

    const emptyState = page.locator('#flight-companion-chat-empty');
    await expect(emptyState).toContainText('the companion checks in periodically');
  });
});
