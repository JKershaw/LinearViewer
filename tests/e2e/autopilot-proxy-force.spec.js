import { test, expect } from '../fixtures/test-base.js';
import fs from 'node:fs/promises';

// LIN-3079: a task-level Autopilot prompt promises a `readWrite` proxy token in
// its body, so it MUST carry one on copy/download/dispatch regardless of the
// global `+proxy` toggle (localStorage `proxy-toggle-active`). This spec leaves
// the toggle OFF throughout and uses a REAL mint (never stubbed away) — the exact
// false-negative case the ticket exists to close.
//
// One case per surface x action (plan-review F5):
//   - home Autopilot     copy / download / dispatch
//   - Swipe Autopilot    copy / download / dispatch
//   - periodical Mint+Autopilot copy / download
//   - dispatch-page loaded-Autopilot dispatch
//
// Proof is never button text alone (F4): copy asserts the clipboard, download
// reads the saved .md bytes (F6), dispatch asserts the POST /api/dispatch body
// carries `attachProxy: true`.
//
// Uses the same /test/set-session seam as proxy-toggle-copy.spec.js (the real
// mint is proven there). The autopilot kickoff endpoint has a test-token mock
// branch (routes/workspace-api.js), so no AI call fires.

let URL_KEY;
const BLOCKED_ISSUE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const FEATS = encodeURIComponent(JSON.stringify({ proxy: true, dispatch: true }));
const PROXY_MARKER = '## Workspace API access';
const INSTRUCTIONS_MARKER = '/api/proxy/instructions';

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
});

/** Fresh session, toggle guaranteed OFF (a new context has no localStorage state). */
async function setSession(page) {
  await page.goto(`/test/set-session?features=${FEATS}&urlKey=${URL_KEY}`);
}

/** Open the home task's Autopilot container and wait for its kickoff to load. */
async function revealHomeAutopilot(page) {
  await page.goto(`/workspace/${URL_KEY}/`);
  await page.waitForLoadState('networkidle');

  const taskLine = page.locator('.in-progress-items .line:has-text("Blocked on external API")');
  await taskLine.click();
  const details = page.locator(`.in-progress-items .details[data-details-for="${BLOCKED_ISSUE_ID}"]`);
  await details.locator('.detail-toggle[data-toggle="prompts"]').click();

  await page.locator(`.in-progress-items .autopilot-btn[data-issue-id="${BLOCKED_ISSUE_ID}"]`).first().click();
  const container = page.locator(`.in-progress-items .autopilot-container[data-autopilot-for="${BLOCKED_ISSUE_ID}"]`);
  await expect(container.locator('.prompt-text')).not.toContainText('Loading', { timeout: 10000 });
  return container;
}

/** Open the Swipe Autopilot result and wait for it to render fresh. */
async function revealSwipeAutopilot(page) {
  await page.goto(`/workspace/${URL_KEY}/swipe`);
  await page.waitForLoadState('networkidle');

  await page.locator('.swipe-accordion-header[data-accordion="prompts"]').click();
  await page.locator('.swipe-prompt-buttons .swipe-prompt-btn.autopilot-btn[data-prompt="__autopilot__"]').first().click();
  const section = page.locator('.prompt-section');
  await expect(section).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
  return section;
}

/** Enable the workspace-scoped periodicals flag for THIS worker's partition. */
async function setPeriodicalsFlag(page, enabled) {
  const res = await page.goto(`/test/set-workspace-feature?key=periodicals&value=${enabled}&urlKey=${URL_KEY}`);
  expect(res.ok()).toBeTruthy();
}

/** Open the periodical row's proxy-forced "Mint + Autopilot" container. */
async function revealPeriodicalAutopilot(page) {
  await setSession(page);
  await setPeriodicalsFlag(page, true);
  await page.goto(`/workspace/${URL_KEY}/`);
  await page.waitForLoadState('networkidle');

  const group = page.locator('[data-project-type="periodicals"]');
  const docNode = group.locator('.node', { has: page.locator('.line:has-text("Documentation Review")') });
  await docNode.locator('.line:has-text("Documentation Review")').click();
  const variant = docNode.locator('[data-proxy-force="true"]');
  await expect(variant).toHaveCount(1);
  return variant;
}

async function assertClipboardHasProxyBlock(page) {
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(PROXY_MARKER);
  expect(clip).toContain(INSTRUCTIONS_MARKER);
}

async function assertDownloadedFileHasProxyBlock(download) {
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const bytes = await fs.readFile(filePath, 'utf8');
  expect(bytes).toContain(PROXY_MARKER);
  expect(bytes).toContain(INSTRUCTIONS_MARKER);
}

/** Capture the POST /api/dispatch body while letting the real request through. */
function captureDispatchBody(page) {
  const captured = { body: null, response: null };
  const isDispatchPost = (req) => req.method() === 'POST'
    && new URL(req.url()).pathname.endsWith('/api/dispatch');
  page.on('request', (req) => {
    if (isDispatchPost(req)) {
      try { captured.body = req.postDataJSON(); } catch { captured.body = null; }
    }
  });
  page.on('response', (res) => {
    if (isDispatchPost(res.request())) captured.response = res;
  });
  return captured;
}

/** Capture EVERY POST /api/dispatch body (in order) while letting each through. */
function captureDispatchBodies(page) {
  const bodies = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/api/dispatch')) {
      try { bodies.push(req.postDataJSON()); } catch { bodies.push(null); }
    }
  });
  return bodies;
}

test.describe('LIN-3079 home Autopilot — proxy forced with toggle OFF', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy includes the auto-appended proxy block', async ({ page }) => {
    await setSession(page);

    const container = await revealHomeAutopilot(page);
    await container.locator('.prompt-copy').click();
    await expect(container.locator('.prompt-copy')).toHaveText('copied!');

    await assertClipboardHasProxyBlock(page);
  });

  test('download writes the proxy block into the .md bytes', async ({ page }) => {
    await setSession(page);

    const container = await revealHomeAutopilot(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      container.locator('.prompt-download').click(),
    ]);
    await assertDownloadedFileHasProxyBlock(download);
  });

  test('dispatch sends attachProxy: true', async ({ page }) => {
    await setSession(page);
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);

    const container = await revealHomeAutopilot(page);
    const captured = captureDispatchBody(page);

    await container.locator('.dispatch-disclosure').click();
    const dispatchBtn = container.locator('.prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!', { timeout: 10000 });

    expect(captured.body).toBeTruthy();
    expect(captured.body.attachProxy).toBe(true);
    expect(captured.body.kind).toBe('autopilot');
  });
});

test.describe('LIN-3079 Swipe Autopilot — proxy forced with toggle OFF', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('copy includes the auto-appended proxy block', async ({ page }) => {
    await setSession(page);

    const section = await revealSwipeAutopilot(page);
    const copyBtn = section.locator('.swipe-prompt-copy');
    await copyBtn.click();
    await expect(copyBtn).toHaveText('copied!');

    await assertClipboardHasProxyBlock(page);
  });

  test('download writes the proxy block into the .md bytes', async ({ page }) => {
    await setSession(page);

    const section = await revealSwipeAutopilot(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      section.locator('.swipe-prompt-download').click(),
    ]);
    await assertDownloadedFileHasProxyBlock(download);
  });

  test('dispatch sends attachProxy: true', async ({ page }) => {
    await setSession(page);
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);

    const section = await revealSwipeAutopilot(page);
    const captured = captureDispatchBody(page);

    await section.locator('.swipe-prompt-dispatch-toggle').click();
    const dispatchBtn = section.locator('.swipe-prompt-dispatch[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('\u2713', { timeout: 10000 });

    expect(captured.body).toBeTruthy();
    expect(captured.body.attachProxy).toBe(true);
    expect(captured.body.kind).toBe('autopilot');
  });
});

test.describe('LIN-3079 periodical Mint + Autopilot — copy/download forced', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test.afterEach(async ({ page }) => {
    await setPeriodicalsFlag(page, false);
  });

  test('copy includes the auto-appended proxy block', async ({ page }) => {
    const variant = await revealPeriodicalAutopilot(page);
    await variant.locator('.prompt-copy').click();
    await expect(variant.locator('.prompt-copy')).toHaveText('copied!');

    await assertClipboardHasProxyBlock(page);
  });

  test('download writes the proxy block into the .md bytes', async ({ page }) => {
    const variant = await revealPeriodicalAutopilot(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      variant.locator('.prompt-download').click(),
    ]);
    await assertDownloadedFileHasProxyBlock(download);
  });
});

test.describe('LIN-3079 dispatch-page loaded Autopilot — forced dispatch', () => {
  test('dispatch sends attachProxy: true for a loaded kind=autopilot kickoff', async ({ page }) => {
    await setSession(page);
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');

    await page.locator('.dispatch-load-autopilot').first().click();
    await expect(page.locator('.dispatch-prompt-input')).not.toHaveValue('', { timeout: 10000 });

    const captured = captureDispatchBody(page);
    await page.locator('.dispatch-toggle').click();
    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!', { timeout: 10000 });

    expect(captured.body).toBeTruthy();
    expect(captured.body.kind).toBe('autopilot');
    expect(captured.body.attachProxy).toBe(true);
  });
});

// LIN-3079 review finding D1 / ledger L1. Loading (or dispatching) an Autopilot
// kickoff tags the dispatch textarea with `dataset.kind='autopilot'`. The
// dispatch page also sets the textarea from code in three places — the clear
// after a successful dispatch, a favourite refill and a recent refill — and a
// `.value =` assignment does NOT fire `input`, so the stale kind survived and
// forced a `readWrite` bootstrap onto an ORDINARY prompt with the +proxy toggle
// OFF. These are the two reviewed refill flows; both must send neither
// `attachProxy` nor an Autopilot `kind`.
test.describe('LIN-3079 dispatch-page refill — ordinary prompts stay toggle-driven (D1)', () => {
  const ORDINARY_PROMPT = 'ORDINARY review probe prompt - list open issues';

  /** Fresh session, queue + recents cleared, one ordinary recent seeded, on /dispatch. */
  async function setupDispatchPageWithOrdinaryRecent(page) {
    await setSession(page);
    await page.goto('/test/clear-recent-prompts');
    await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
    const seed = await page.request.post(`/workspace/${URL_KEY}/api/dispatch/recent-prompts`, {
      data: { prompt: ORDINARY_PROMPT },
    });
    expect(seed.ok()).toBeTruthy();

    await page.goto(`/workspace/${URL_KEY}/dispatch`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('.dispatch-recents-container .queue-recent-item').filter({ hasText: ORDINARY_PROMPT })
    ).toBeVisible({ timeout: 10000 });
  }

  /** Click the ORDINARY recent (never the just-dispatched Autopilot kickoff). */
  async function refillOrdinaryRecent(page) {
    await page.locator('.dispatch-recents-container .queue-recent-item')
      .filter({ hasText: ORDINARY_PROMPT }).first().click();
    await expect(page.locator('.dispatch-prompt-input')).toHaveValue(ORDINARY_PROMPT);
  }

  test('(a) load Autopilot then refill an ordinary recent — no attachProxy, no kind', async ({ page }) => {
    await setupDispatchPageWithOrdinaryRecent(page);

    await page.locator('.dispatch-load-autopilot').first().click();
    await expect(page.locator('.dispatch-prompt-input')).not.toHaveValue('', { timeout: 10000 });

    await refillOrdinaryRecent(page);

    const bodies = captureDispatchBodies(page);
    await page.locator('.dispatch-toggle').click();
    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!', { timeout: 10000 });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].prompt).toBe(ORDINARY_PROMPT);
    expect(bodies[0].kind).toBeUndefined();
    expect(bodies[0].attachProxy).toBeUndefined();
  });

  test('(b) dispatch Autopilot then refill an ordinary recent — no attachProxy, no kind', async ({ page }) => {
    await setupDispatchPageWithOrdinaryRecent(page);

    await page.locator('.dispatch-load-autopilot').first().click();
    await expect(page.locator('.dispatch-prompt-input')).not.toHaveValue('', { timeout: 10000 });

    const bodies = captureDispatchBodies(page);
    await page.locator('.dispatch-toggle').click();
    const dispatchBtn = page.locator('.dispatch-prompt-send[data-target="cli"]');

    // First send: the loaded Autopilot kickoff IS forced.
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!', { timeout: 10000 });
    await expect(page.locator('.dispatch-prompt-input')).toHaveValue('');
    // Let the button revert off "dispatched!" so the second click is a real send.
    await expect(dispatchBtn).toBeEnabled({ timeout: 10000 });

    // Refill the ordinary recent off the post-dispatch (cleared) textarea. The
    // recent item is outside the options panel, so that click closes the
    // dispatch disclosure — reopen it before the second send.
    await refillOrdinaryRecent(page);
    await page.locator('.dispatch-toggle').click();
    await expect(page.locator('#dispatch-options')).not.toHaveClass(/\bhidden\b/);
    await dispatchBtn.click();
    await expect(dispatchBtn).toHaveText('dispatched!', { timeout: 10000 });

    expect(bodies).toHaveLength(2);
    expect(bodies[0].kind).toBe('autopilot');
    expect(bodies[0].attachProxy).toBe(true);
    expect(bodies[1].prompt).toBe(ORDINARY_PROMPT);
    expect(bodies[1].kind).toBeUndefined();
    expect(bodies[1].attachProxy).toBeUndefined();
  });
});

// LIN-3079 review finding N2. Plan decision (i) removed the now-inert +proxy
// toggle from the forced home/Swipe Autopilot surfaces, but nothing asserted it
// — mutations M12 (Swipe suppression removed) and M13 (home toggle re-added)
// both survived. These count assertions kill them. The proxy feature is ON
// throughout, so an ordinary result must still carry the toggle.
test.describe('LIN-3079 Autopilot surfaces — the inert +proxy toggle stays removed (N2)', () => {
  test('home Autopilot container renders no .prompt-proxy-toggle', async ({ page }) => {
    await setSession(page);
    const container = await revealHomeAutopilot(page);
    await expect(container.locator('.prompt-proxy-toggle')).toHaveCount(0);
  });

  test('Swipe Autopilot result hides the toggle, and an ordinary result restores it', async ({ page }) => {
    await setSession(page);

    const section = await revealSwipeAutopilot(page);
    await expect(section.locator('.prompt-proxy-toggle')).toHaveCount(0);

    // Switch to an ordinary (non-Autopilot) prompt in the same card. The fresh
    // result replaces the picker, so return to idle via "change" first.
    await section.locator('.swipe-prompt-change').click();
    await expect(section.locator('.swipe-prompt-buttons')).toBeVisible();
    await section.locator('.swipe-prompt-buttons .swipe-prompt-btn:not(.ai-btn):not(.autopilot-btn):not(.swipe-prompt-btn-more)').first().click();
    await expect(section).toHaveAttribute('data-phase', 'fresh', { timeout: 10000 });
    await expect(section.locator('.prompt-proxy-toggle')).toHaveCount(1);
  });
});
