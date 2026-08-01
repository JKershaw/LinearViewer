import { test, expect } from '../fixtures/test-base.js';

// LIN-1764: Flight Companion's one-click +proxy append. Mirrors the
// tests/e2e/proxy-toggle-copy.spec.js idiom (same "+proxy silent-drop" guard),
// applied to the Flight Companion copy button instead of the dashboard/swipe
// prompt-copy buttons.
//
// The route redirects to /settings unless BOTH `flightCompanion` and `proxy`
// feature flags are on (plan-review finding F3) — a spec that sets only one
// would have every case redirect and pass vacuously.

let URL_KEY;
const FEATS = encodeURIComponent(JSON.stringify({ flightCompanion: true, proxy: true }));
const PROXY_MARKER = 'Workspace API access';

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
});

/** Force every proxy-token mint to fail, as a tripped rate limiter would. */
async function failTokenMint(page) {
  await page.route('**/api/proxy/tokens', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' });
    }
    return route.continue();
  });
}

test.describe('Flight Companion +proxy copy', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy appends the proxy block when +proxy is enabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATS}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/flight-companion`);
    await page.waitForLoadState('networkidle');

    await page.locator('.prompt-proxy-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-proxy-active', 'true');

    await page.locator('#flight-companion-copy').click();
    await expect(page.locator('#flight-companion-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(PROXY_MARKER);
    expect(clip).toContain('/api/proxy/instructions');
  });

  test('copy does NOT append when +proxy is disabled', async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATS}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/flight-companion`);
    await page.waitForLoadState('networkidle');

    // Leave +proxy off (default).
    await page.locator('#flight-companion-copy').click();
    await expect(page.locator('#flight-companion-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length).toBeGreaterThan(0);
    expect(clip).not.toContain(PROXY_MARKER);
  });

  test('copy surfaces failure (does not silently drop) when token mint fails', async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATS}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/flight-companion`);
    await page.waitForLoadState('networkidle');
    await failTokenMint(page);

    await page.locator('.prompt-proxy-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-proxy-active', 'true');

    // Seed the clipboard so we can prove nothing was written on failure.
    await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));

    await page.locator('#flight-companion-copy').click();

    // The toggle still shows active, but the copy must visibly report failure...
    await expect(page.locator('#flight-companion-copy-feedback')).not.toHaveText('');
    await expect(page.locator('#flight-companion-copy')).not.toHaveText('copied ✓');
    // ...and must NOT have silently copied a bare (proxy-less) prompt.
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('__SENTINEL__');
  });
});

test.describe('Flight Companion +proxy gate — flag off', () => {
  test('no +proxy toggle renders when the proxy feature flag is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${encodeURIComponent(JSON.stringify({ flightCompanion: true }))}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/flight-companion`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.prompt-proxy-toggle')).toHaveCount(0);
  });
});
