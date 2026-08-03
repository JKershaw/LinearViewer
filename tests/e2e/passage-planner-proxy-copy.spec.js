import { test, expect } from '../fixtures/test-base.js';

// LIN-1849: Passage Planner's one-click kickoff copy, Flight Companion parity
// (LIN-922 + LIN-1764). Mirrors tests/e2e/flight-companion-proxy-copy.spec.js's
// idiom, adapted for the forced-not-toggled append: there is no user-facing
// +proxy toggle here — the copy path always attempts a FORCED mint when the
// `proxy` feature flag is on, and degrades to a bare copy (no mint attempted)
// when it is off.
//
// The route redirects to /settings unless the `passagePlanner` feature flag is
// on, independent of `proxy` — a spec that only sets `proxy` would have every
// case redirect and pass vacuously.

let URL_KEY;
const PROXY_MARKER = 'Workspace API access';
const PREAMBLE_MARKER = 'Graduation-lift tracking';
const BODY_MARKER = 'live passage-planning session';

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

/** Count POSTs to the token-mint endpoint, to prove a skipped mint is never attempted. */
function countTokenMintRequests(page) {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/proxy/tokens')) count++;
  });
  return () => count;
}

test.describe('Passage Planner proxy copy', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy force-appends the proxy block and excludes the preamble when proxy is enabled', async ({ page }) => {
    const feats = encodeURIComponent(JSON.stringify({ passagePlanner: true, proxy: true }));
    await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/passage-planner`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toHaveAttribute('data-proxy-available', 'true');

    await page.locator('#passage-planner-copy').click();
    await expect(page.locator('#passage-planner-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(BODY_MARKER);
    expect(clip).toContain('### Leg:');
    expect(clip).not.toContain(PREAMBLE_MARKER);
    expect(clip).toContain(PROXY_MARKER);
    expect(clip).toContain('/api/proxy/instructions');
  });

  test('copy skips the mint entirely and copies the bare prompt when proxy is disabled', async ({ page }) => {
    const feats = encodeURIComponent(JSON.stringify({ passagePlanner: true, proxy: false }));
    await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
    const getMintCount = countTokenMintRequests(page);
    await page.goto(`/workspace/${URL_KEY}/passage-planner`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toHaveAttribute('data-proxy-available', 'false');
    await expect(page.locator('.passage-planner-degraded')).toBeVisible();
    await expect(page.locator('.passage-planner-degraded a')).toHaveAttribute('href', `/workspace/${URL_KEY}/settings`);

    await page.locator('#passage-planner-copy').click();
    await expect(page.locator('#passage-planner-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length).toBeGreaterThan(0);
    expect(clip).not.toContain(PROXY_MARKER);
    // The degrade path must never attempt a mint it knows would 403.
    expect(getMintCount()).toBe(0);
  });

  test('copy surfaces failure (does not silently drop) when the forced mint fails', async ({ page }) => {
    const feats = encodeURIComponent(JSON.stringify({ passagePlanner: true, proxy: true }));
    await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/passage-planner`);
    await page.waitForLoadState('networkidle');
    await failTokenMint(page);

    // Seed the clipboard so we can prove nothing was written on failure.
    await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));

    await page.locator('#passage-planner-copy').click();

    await expect(page.locator('#passage-planner-copy-feedback')).not.toHaveText('');
    await expect(page.locator('#passage-planner-copy')).not.toHaveText('copied ✓');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('__SENTINEL__');
  });
});

test.describe('Passage Planner route gate — flag off', () => {
  test('redirects to Settings when passagePlanner is off, regardless of proxy', async ({ page }) => {
    const feats = encodeURIComponent(JSON.stringify({ proxy: true }));
    await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/passage-planner`);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(new RegExp(`/workspace/${URL_KEY}/settings$`));
  });
});
