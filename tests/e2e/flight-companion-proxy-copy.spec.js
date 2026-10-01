import { test, expect } from '../fixtures/test-base.js';
// fixture:LIN-3136
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
// /fixture:LIN-3136

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
    // LIN-3136: the 429 reads as the driver copy's RATE_LIMITED wording.
    await expect(page.locator('#flight-companion-copy-feedback')).toHaveText('Too many prompt copies in a short time. Wait a minute and try again.');
  });

  test('no proxy-off degradation notice renders when the feature is on', async ({ page }) => {
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
