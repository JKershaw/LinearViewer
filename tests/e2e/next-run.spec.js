import { test, expect } from '../fixtures/test-base.js';

// Experimental "suggest the next autopilot run" page (LIN-603). Seeds via
// /test/set-session (the test-token workspace), so the suggest endpoint serves
// deterministic, grounded mock options without an OpenRouter key. The page itself
// fetches no provider data; the suggest endpoint builds options from the data
// fixtures in test mode.

// Bound per-test from the per-worker key so session + nav + suggest API all
// address this worker's partition.
let URL_KEY;
let PAGE_URL;
let SETTINGS_URL;
let SUGGEST_API;

const featuresParam = (obj) => `features=${encodeURIComponent(JSON.stringify(obj))}`;

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
  PAGE_URL = `/workspace/${URL_KEY}/next-run`;
  SETTINGS_URL = `/workspace/${URL_KEY}/settings`;
  SUGGEST_API = `/workspace/${URL_KEY}/api/next-run/suggest`;
});

test.describe('Suggested Next Run Page (experimental)', () => {
  test.describe('Feature Flag Gating', () => {
    test('redirects to settings when the flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/settings');
    });

    test('loads when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.next-run-header h1')).toHaveText('Suggested Next Run');
    });

    test('toggle lives in the Experimental section and defaults off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.settings-header:has-text("Experimental")')).toBeVisible();
      const toggle = page.locator('[data-feature="nextRun"]');
      await expect(toggle).toBeVisible();
      await expect(toggle.locator('.toggle-state')).toContainText('off');
    });

    test('settings link to the page appears only when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the next-run suggester")')).toHaveCount(0);

      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(SETTINGS_URL);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.settings-action:has-text("open the next-run suggester")')).toBeVisible();
    });
  });

  test.describe('Page Structure', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('has a generate button and an empty options state', async ({ page }) => {
      await expect(page.locator('#next-run-generate')).toBeVisible();
      await expect(page.locator('#next-run-options')).toHaveCount(1);
      await expect(page.locator('#next-run-empty')).toBeVisible();
    });

    test('includes the next-run stylesheet and script', async ({ page }) => {
      await expect(page.locator('link[href="/next-run.css"]')).toHaveCount(1);
      await expect(page.locator('script[src="/next-run.js"]')).toHaveCount(1);
    });

    test('reuses the Observation stylesheet for visual parity (LIN-633)', async ({ page }) => {
      await expect(page.locator('link[href="/observation.css"]')).toHaveCount(1);
    });

    test('the grounding context panel is hidden until a generation returns', async ({ page }) => {
      await expect(page.locator('#next-run-context-section')).toBeHidden();
    });

    test('the summary intro is hidden until a generation returns (LIN-638)', async ({ page }) => {
      await expect(page.locator('#next-run-summary')).toBeHidden();
    });

    test('the analysis preamble is hidden until a generation returns (LIN-642)', async ({ page }) => {
      await expect(page.locator('#next-run-analysis')).toBeHidden();
    });
  });

  test.describe('Generation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('renders grounded option cards with a size and a continue-until-stopped option', async ({ page }) => {
      await page.locator('#next-run-generate').click();

      // Options appear; the empty state is gone.
      const options = page.locator('.next-run-option');
      await expect(options.first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#next-run-empty')).toBeHidden();

      // Every option carries a t-shirt size badge.
      await expect(page.locator('.next-run-size').first()).toBeVisible();

      // The always-present open-ended option is rendered and tagged.
      await expect(page.locator('.next-run-option-open')).toHaveCount(1);
      await expect(page.locator('.next-run-open-tag')).toContainText('continue until stopped');
    });

    test('expanding a card reveals its reasoning and a goal-prefilled dispatch link', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });

      // Body (reasoning + actions) is collapsed until the head is clicked.
      const reasoning = card.locator('.next-run-reasoning');
      const accept = card.locator('.next-run-accept');
      await expect(accept).toBeHidden();

      await card.locator('.next-run-option-head').click();
      await expect(card).toHaveClass(/is-open/);
      await expect(reasoning).toBeVisible();
      await expect(accept).toBeVisible();
      const href = await accept.getAttribute('href');
      expect(href).toContain('/dispatch?goal=');
    });

    test('the continue-until-stopped option links to dispatch with no goal', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const card = page.locator('.next-run-option-open');
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      const accept = card.locator('.next-run-accept');
      await expect(accept).toBeVisible();
      const href = await accept.getAttribute('href');
      expect(href).toContain('/dispatch');
      expect(href).not.toContain('goal=');
    });

    test('guarantees at least one option for each size S/M/L (LIN-642)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      await expect(page.locator('.next-run-option').first()).toBeVisible({ timeout: 5000 });

      // Every concrete size must be represented at least once (the open option is XL).
      for (const size of ['S', 'M', 'L']) {
        await expect(
          page.locator('.next-run-size', { hasText: new RegExp(`^${size}$`) })
        ).not.toHaveCount(0);
      }
    });

    test('cards show a standalone headline title, not the goal first line (LIN-642)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      // The mock titles are "Finish TEST-1: …" / "Start TEST-2: …" — a headline,
      // distinct from the goal prose ("Drive …" / "Start …: research …").
      const preview = card.locator('.next-run-goal-preview');
      await expect(preview).toBeVisible();
      await expect(preview).toContainText('TEST-');
    });

    test('expanding a card lists its referenced tasks at the end (LIN-642)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();

      const refs = card.locator('.next-run-refs');
      await expect(refs).toBeVisible();
      // Referenced ids render as machine-readable identifier tags.
      await expect(refs.locator('.next-run-ref').first()).toContainText('TEST-');
    });

    test('referenced tasks show their human-readable title, not just the id (LIN-923)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      // The first concrete mock option references TEST-1 ("Parent task in progress").
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();

      const refItem = card.locator('.next-run-ref-item').first();
      await expect(refItem).toBeVisible();
      // The identifier chip and the resolved title sit side by side.
      await expect(refItem.locator('.next-run-ref')).toContainText('TEST-');
      await expect(refItem.locator('.next-run-ref-title')).not.toBeEmpty();
      await expect(refItem.locator('.next-run-ref-title')).toContainText('Parent task in progress');
    });

    test('a visible global analysis section appears above the cards (LIN-642)', async ({ page }) => {
      await page.locator('#next-run-generate').click();

      const analysis = page.locator('#next-run-analysis');
      await expect(analysis).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#next-run-analysis-body')).not.toBeEmpty();

      // It renders above the options list in DOM order.
      await expect(page.locator('#next-run-analysis ~ #next-run-options')).toHaveCount(1);
    });

    test('a deterministic summary intro appears above the options (LIN-638)', async ({ page }) => {
      await page.locator('#next-run-generate').click();

      const summary = page.locator('#next-run-summary');
      await expect(summary).toBeVisible({ timeout: 5000 });
      // The summary is grounded — it states in-progress/queued counts.
      await expect(summary).toContainText('in progress');

      // It renders above the options list in DOM order.
      const summaryThenOptions = page.locator('#next-run-summary ~ #next-run-options');
      await expect(summaryThenOptions).toHaveCount(1);
    });

    test('the grounding context panel appears and expands after generation (LIN-633)', async ({ page }) => {
      await page.locator('#next-run-generate').click();

      const section = page.locator('#next-run-context-section');
      const toggle = page.locator('#next-run-context-toggle');
      const body = page.locator('#next-run-context-body');

      await expect(section).toBeVisible({ timeout: 5000 });
      await expect(body).toBeHidden();

      await toggle.click();
      await expect(body).toBeVisible();
      // The panel shows the deterministic grounding blob (velocity line is always present).
      await expect(body).toContainText('Velocity');
    });
  });

  // LIN-640: when the proxy feature is on, cards offer inline `Dispatch ▾` options
  // (parity with projects/swipe) that build the autopilot kickoff and dispatch in
  // place; when proxy is off, the navigate-to-/dispatch?goal= fallback is kept.
  test.describe('Inline dispatch options (proxy on)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true, proxy: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('#next-run-generate').click();
    });

    test('a card offers a Dispatch disclosure with per-target buttons instead of the navigate link', async ({ page }) => {
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();

      // The proxy-off navigate link is replaced by the inline disclosure.
      await expect(card.locator('.next-run-accept')).toHaveCount(0);
      const toggle = card.locator('.next-run-dispatch-toggle');
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveText(/Dispatch/);

      // Targets are hidden until the disclosure is opened, then revealed.
      const cli = card.locator('.next-run-dispatch[data-target="cli"]');
      await expect(cli).toBeHidden();
      await toggle.click();
      await expect(cli).toBeVisible();
      await expect(card.locator('.next-run-dispatch[data-target="web"]')).toBeVisible();
      await expect(card.locator('.next-run-dispatch[data-target="dash"]')).toBeVisible();
      // copy goal is preserved alongside the dispatch options.
      await expect(card.locator('.next-run-copy')).toBeVisible();
    });

    test('clicking a target dispatches the goal inline (issue-less, kind=autopilot)', async ({ page }) => {
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const dispatchReq = page.waitForRequest(req =>
        req.url().includes('/api/dispatch') && req.method() === 'POST');
      const cli = card.locator('.next-run-dispatch[data-target="cli"]');
      await cli.click();

      const req = await dispatchReq;
      const body = JSON.parse(req.postData() || '{}');
      expect(body.kind).toBe('autopilot');
      expect(body.target).toBe('cli');
      // Issue-less: no Linear issue is anchored on a goal dispatch.
      expect(body.issueId == null).toBe(true);
      // LIN-645: the autopilot kickoff promises a readWrite proxy token, so the
      // dispatched prompt MUST carry the +proxy block — even though this surface
      // exposes no +proxy toggle (the append is forced).
      expect(body.prompt).toContain('Workspace API access');
      expect(body.prompt).toContain('/api/proxy/instructions');

      await expect(cli).toHaveText('dispatched!', { timeout: 5000 });
    });

    test('a failed proxy-token mint surfaces as failure, not a bare dispatch (LIN-645)', async ({ page }) => {
      // Trip the token mint as a rate limiter would. The kickoff must NOT be
      // dispatched without its promised proxy block.
      await page.route('**/api/proxy/tokens', route => {
        if (route.request().method() === 'POST') {
          return route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' });
        }
        return route.continue();
      });

      let dispatched = false;
      page.on('request', req => {
        if (req.url().includes('/api/dispatch') && req.method() === 'POST') dispatched = true;
      });

      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const cli = card.locator('.next-run-dispatch[data-target="cli"]');
      await cli.click();

      await expect(cli).toHaveText('failed', { timeout: 5000 });
      expect(dispatched).toBe(false);
    });

    test('the continue-until-stopped option dispatches with no goal', async ({ page }) => {
      const card = page.locator('.next-run-option-open');
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const autopilotReq = page.waitForRequest(req =>
        req.url().includes('/api/autopilot-prompt') && req.method() === 'GET');
      await card.locator('.next-run-dispatch[data-target="cli"]').click();

      const req = await autopilotReq;
      // The open option omits ?goal= entirely (an open-ended stack walk).
      expect(req.url()).not.toContain('goal=');
    });
  });

  test.describe('Dispatch fallback (proxy off)', () => {
    test('keeps the navigate-to-dispatch link and renders no inline disclosure', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('#next-run-generate').click();

      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();

      await expect(card.locator('.next-run-dispatch-toggle')).toHaveCount(0);
      const accept = card.locator('.next-run-accept');
      await expect(accept).toBeVisible();
      expect(await accept.getAttribute('href')).toContain('/dispatch?goal=');
    });
  });

  test.describe('Suggest endpoint', () => {
    test('returns 403 when the feature flag is off', async ({ page }) => {
      await page.goto(`/test/set-session?urlKey=${URL_KEY}`);
      const res = await page.request.post(SUGGEST_API, { data: {} });
      expect(res.status()).toBe(403);
    });

    test('returns options including the open-ended one when the flag is on', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(SUGGEST_API, { data: {} });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.options)).toBe(true);
      expect(body.options.length).toBeGreaterThan(0);
      const open = body.options[body.options.length - 1];
      expect(open.continueUntilStopped).toBe(true);
      expect(open.goal).toBe('');
      expect(open.size).toBe('XL');
      // Parity with the live path: the grounding context is returned, not discarded.
      expect(typeof body.context).toBe('string');
      expect(body.context.length).toBeGreaterThan(0);

      // LIN-642 contract: a global analysis preamble, per-size S/M/L coverage, and
      // every concrete option carries a title + machine-readable referencedTaskIds.
      expect(typeof body.analysis).toBe('string');
      expect(body.analysis.length).toBeGreaterThan(0);
      const concrete = body.options.filter(o => !o.continueUntilStopped);
      for (const size of ['S', 'M', 'L']) {
        expect(concrete.some(o => o.size === size)).toBe(true);
      }
      for (const o of concrete) {
        expect(typeof o.title).toBe('string');
        expect(o.title.length).toBeGreaterThan(0);
        expect(Array.isArray(o.referencedTaskIds)).toBe(true);
      }
    });
  });
});
