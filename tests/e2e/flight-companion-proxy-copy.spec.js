import { test, expect } from '../fixtures/test-base.js';
// fixture:LIN-3136
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
// /fixture:LIN-3136

// LIN-1764 introduced Flight Companion's one-click +proxy append as a
// USER-TOGGLED feature. LIN-3079 reclassified it: the kickoff copy path states a
// bootstrap token is "supplied alongside this prompt (the +proxy block)", so the
// copy MUST force-append (no user toggle), mirroring Passage Planner. LIN-3849
// removed the per-user `proxy` switch, so there is no bare-copy degradation and
// no degradation notice any more.
//
// The route gates on `flightCompanion` ALONE (routes/flight-companion.js).

let URL_KEY;
const FEATS_ON = encodeURIComponent(JSON.stringify({ flightCompanion: true }));
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

async function openCompanion(page, feats) {
  await page.goto(`/test/set-session?features=${feats}&urlKey=${URL_KEY}`);
  // fixture:LIN-3136: the forced copy mints the owner-only driver copy (M5)
  await seedWorkspaceOwnership(page, URL_KEY);
  // /fixture:LIN-3136
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
    await expect(page.locator('body')).not.toHaveAttribute('data-proxy-feature', /.*/); // LIN-3849: attribute gone

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
    // LIN-3136: the 429 reads as the driver copy's RATE_LIMITED wording.
    await expect(page.locator('#flight-companion-copy-feedback')).toHaveText('Too many prompt copies in a short time. Wait a minute and try again.');
  });

  test('no proxy-off degradation notice renders (LIN-3849: the proxy switch is gone)', async ({ page }) => {
    await openCompanion(page, FEATS_ON);
    await expect(page.locator('#flight-companion-proxy-degraded')).toHaveCount(0);
  });
});

// LIN-3136 (M5): the forced copy is the owner's driver copy. End to end: the
// pasted bootstrap exchanges to a readWrite + ['dispatch'] working token that
// can enqueue; a non-owner's copy is refused with the reason and copies nothing.
test.describe('LIN-3136 Flight Companion copy — the owner-only driver copy', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('owner copy → exchange → POST /api/proxy/dispatch 201', async ({ page }) => {
    const bodies = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/api/proxy/tokens')) bodies.push(req.postDataJSON());
    });
    await openCompanion(page, FEATS_ON);

    await page.locator('#flight-companion-copy').click();
    await expect(page.locator('#flight-companion-copy')).toHaveText('copied ✓');
    expect(bodies).toEqual([{ purpose: 'driver' }]);

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('It also holds the dispatch grant');
    const bootstrap = clip.match(/Authorization: Bearer (\S+)" \S+\/api\/proxy\/token/)[1];

    const exchanged = await page.request.post('/api/proxy/token', { headers: { Authorization: `Bearer ${bootstrap}` } });
    expect(exchanged.status()).toBe(200);
    const working = await exchanged.json();
    expect(working.scope).toBe('readWrite');
    expect(working.grants).toEqual(['dispatch']);

    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    const dispatched = await page.request.post('/api/proxy/dispatch', {
      headers: { Authorization: `Bearer ${working.token}` },
      data: { prompt: 'LIN-3136 driver copy end to end', target: 'cli', kind: 'implementation' }
    });
    expect(dispatched.status(), await dispatched.text()).toBe(201);
  });

  test('a non-owner copy is refused with the reason shown, and nothing is copied', async ({ page }) => {
    await openCompanion(page, FEATS_ON);
    await seedWorkspaceOwnership(page, URL_KEY, 'foreign');
    try {
      await page.evaluate(() => navigator.clipboard.writeText('__SENTINEL__'));
      await page.locator('#flight-companion-copy').click();

      await expect(page.locator('#flight-companion-copy-feedback')).toHaveText(
        "Only this workspace's owner can copy a prompt that can queue work on their machine. Ask the owner, or sign in as the owner."
      );
      await expect(page.locator('#flight-companion-copy')).not.toHaveText('copied ✓');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('__SENTINEL__');
    } finally {
      await seedWorkspaceOwnership(page, URL_KEY, 'owner');
    }
  });
});
