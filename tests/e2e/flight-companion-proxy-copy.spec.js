import { test, expect } from '../fixtures/test-base.js';

// LIN-1764 introduced Flight Companion's one-click +proxy append as a
// USER-TOGGLED feature. LIN-3079 reclassifies it: the kickoff copy path states a
// bootstrap token is "supplied alongside this prompt (the +proxy block)", so with
// the `proxy` feature flag ON the copy MUST force-append (feature-gated, no user
// toggle), mirroring Passage Planner. With the flag OFF the copy is bare and no
// mint is ever attempted (a mint would 403), and the page now surfaces a
// degradation notice so the token-promising kickoff is never presented as
// complete.
//
// The route gates on `flightCompanion` ALONE (routes/flight-companion.js:487) —
// it does NOT require `proxy`. The proxy-off cases below genuinely render the
// page; correcting an earlier header that wrongly claimed both flags were
// required (review finding C2).

let URL_KEY;
const FEATS_ON = encodeURIComponent(JSON.stringify({ flightCompanion: true, proxy: true }));
const FEATS_OFF = encodeURIComponent(JSON.stringify({ flightCompanion: true, proxy: false }));
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

/** Count POSTs to the token-mint endpoint, to prove a skipped mint is never attempted. */
function countTokenMintRequests(page) {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/proxy/tokens')) count++;
  });
  return () => count;
}

async function openCompanion(page, feats) {
  await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
  await page.goto(`/workspace/${URL_KEY}/flight-companion`);
  await page.waitForLoadState('networkidle');
}

test.describe('Flight Companion copy — feature-gated forced append', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy force-appends the proxy block when the feature is on (no toggle click)', async ({ page }) => {
    await openCompanion(page, FEATS_ON);

    // The now-inert user toggle is gone; the feature gate alone drives the append.
    await expect(page.locator('.prompt-proxy-toggle')).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute('data-proxy-feature', 'true');

    await page.locator('#flight-companion-copy').click();
    await expect(page.locator('#flight-companion-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(PROXY_MARKER);
    expect(clip).toContain('/api/proxy/instructions');
  });

  test('the +proxy toggle is absent with the feature on, yet copy still force-appends', async ({ page }) => {
    await openCompanion(page, FEATS_ON);

    await expect(page.locator('.prompt-proxy-toggle')).toHaveCount(0);

    await page.locator('#flight-companion-copy').click();
    await expect(page.locator('#flight-companion-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(PROXY_MARKER);
  });

  test('copy surfaces failure (does not silently drop) when the forced mint fails', async ({ page }) => {
    await openCompanion(page, FEATS_ON);
    await failTokenMint(page);

    // Seed the clipboard so we can prove nothing was written on failure.
    await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));

    await page.locator('#flight-companion-copy').click();

    // The copy must visibly report failure...
    await expect(page.locator('#flight-companion-copy-feedback')).not.toHaveText('');
    await expect(page.locator('#flight-companion-copy')).not.toHaveText('copied ✓');
    // ...and must NOT have silently copied a bare (proxy-less) prompt.
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('__SENTINEL__');
  });

  test('no proxy-off degradation notice renders when the feature is on', async ({ page }) => {
    await openCompanion(page, FEATS_ON);
    await expect(page.locator('#flight-companion-proxy-degraded')).toHaveCount(0);
  });
});

test.describe('Flight Companion proxy gate — feature off', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('no +proxy toggle and no data-proxy-feature attribute renders when the proxy feature flag is off', async ({ page }) => {
    await openCompanion(page, FEATS_OFF);

    await expect(page.locator('.prompt-proxy-toggle')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-proxy-feature', 'true');
  });

  test('renders the proxy-off degradation notice — the token-promising kickoff is not presented as complete (F1)', async ({ page }) => {
    await openCompanion(page, FEATS_OFF);

    const notice = page.locator('#flight-companion-proxy-degraded');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('workspace API access');
  });

  test('copy skips the mint entirely and copies the bare prompt when the proxy feature is off', async ({ page }) => {
    await page.goto(`/test/set-session?features=${FEATS_OFF}&urlKey=${URL_KEY}`);
    const getMintCount = countTokenMintRequests(page);
    await page.goto(`/workspace/${URL_KEY}/flight-companion`);
    await page.waitForLoadState('networkidle');

    await page.locator('#flight-companion-copy').click();
    await expect(page.locator('#flight-companion-copy')).toHaveText('copied ✓');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length).toBeGreaterThan(0);
    expect(clip).not.toContain(PROXY_MARKER);
    // The bare-copy path must never attempt a mint it knows would 403.
    expect(getMintCount()).toBe(0);
  });
});
