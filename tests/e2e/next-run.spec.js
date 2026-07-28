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
      // Title routes through the shared renderPageHeader primitive (LIN-975).
      await expect(page.locator('.page-header h1')).toHaveText('Suggested Next Run');
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

    // LIN-1566: goals are now grouped under directions and only the selected
    // direction's cards are on screen, so the S/M/L guarantee is asserted by
    // walking every direction and accumulating what is offered. That is also the
    // UI-level proof of D3 — coverage is global across the generation, NOT per
    // direction (no single direction is required to hold all three).
    test('guarantees at least one option for each size S/M/L (LIN-642)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      await expect(page.locator('.next-run-option').first()).toBeVisible({ timeout: 5000 });

      const chips = page.locator('.next-run-direction');
      const chipCount = await chips.count();
      const seen = new Set();

      for (let i = 0; i < Math.max(chipCount, 1); i++) {
        if (chipCount) await chips.nth(i).click();
        await expect(page.locator('.next-run-option').first()).toBeVisible();
        for (const size of await page.locator('.next-run-size').allTextContents()) {
          seen.add(size.trim());
        }
      }

      // Every concrete size represented at least once across the generation
      // (the always-offered open option is the XL).
      for (const size of ['S', 'M', 'L']) {
        expect(seen.has(size), `size ${size} was not offered under any direction`).toBe(true);
      }
      expect(seen.has('XL')).toBe(true);
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

    // LIN-1665: a generation whose reply could not be parsed still returns cards —
    // deterministic S/M/L fills plus continue-until-stopped, and no chooser, because
    // fills carry no direction tag. That is pixel-identical to a healthy ungrouped
    // generation, so the page has to say which one it is looking at.
    test('a degraded generation is called out above the fallback cards (LIN-1665)', async ({ page }) => {
      // Serve the real mock's shape with the wire flag the collapsed live path sets.
      await page.route('**/api/next-run/suggest', async route => {
        const res = await route.fetch();
        const body = await res.json();
        body.degraded = { reason: 'truncated', truncated: true, finishReason: 'length' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });

      await page.locator('#next-run-generate').click();
      const notice = page.locator('#next-run-degraded');
      await expect(notice).toBeVisible({ timeout: 5000 });
      await expect(notice).toContainText('cut off');
      await expect(notice).toContainText('deterministic fallbacks');

      // The notice REPLACES nothing: the options are still offered, so a degraded
      // generation is still a usable page rather than a dead end.
      await expect(page.locator('.next-run-option').first()).toBeVisible();
    });

    test('an unparseable degradation reads differently from a truncated one (LIN-1665)', async ({ page }) => {
      await page.route('**/api/next-run/suggest', async route => {
        const res = await route.fetch();
        const body = await res.json();
        body.degraded = { reason: 'unparseable', truncated: false, finishReason: 'stop' };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });

      await page.locator('#next-run-generate').click();
      const notice = page.locator('#next-run-degraded');
      await expect(notice).toBeVisible({ timeout: 5000 });
      await expect(notice).toContainText('could not be read');
      await expect(notice).not.toContainText('cut off');
    });

    test('the notice does not outlive the run that produced it (LIN-1665)', async ({ page }) => {
      // Degrade once, then let the next generation fail outright. The warning
      // describes cards that are no longer on screen, so it must be gone — a stale
      // amber notice sitting above a fresh error is its own misreport.
      let calls = 0;
      await page.route('**/api/next-run/suggest', async route => {
        calls += 1;
        if (calls === 1) {
          const res = await route.fetch();
          const body = await res.json();
          body.degraded = { reason: 'truncated', truncated: true, finishReason: 'length' };
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        }
        return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Failed to generate suggestions' }) });
      });

      await page.locator('#next-run-generate').click();
      await expect(page.locator('#next-run-degraded')).toBeVisible({ timeout: 5000 });

      await page.locator('#next-run-generate').click();
      await expect(page.locator('#next-run-feedback')).toHaveClass(/error/, { timeout: 5000 });
      await expect(page.locator('#next-run-degraded')).toBeHidden();
    });

    test('a healthy generation shows no degradation notice (LIN-1665)', async ({ page }) => {
      // The false-positive guard: the mock is a healthy generation and carries
      // degraded: null, so the notice must stay hidden through a normal run.
      await expect(page.locator('#next-run-degraded')).toBeHidden();
      await page.locator('#next-run-generate').click();
      await expect(page.locator('.next-run-option').first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#next-run-degraded')).toBeHidden();
    });
  });

  // LIN-1566: goal options are grouped under a small set of named directions —
  // choose a direction first, a concrete goal second. The mock declares two
  // directions and deliberately leaves the deterministic L fill untagged, so the
  // resolver's trailing catch-all is exercised for real.
  test.describe('Direction chooser', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
    });

    test('the chooser is hidden until a generation returns', async ({ page }) => {
      await expect(page.locator('#next-run-directions')).toBeHidden();
    });

    test('renders a chip per direction, above the cards, with the first selected', async ({ page }) => {
      await page.locator('#next-run-generate').click();

      const chooser = page.locator('#next-run-directions');
      await expect(chooser).toBeVisible({ timeout: 5000 });

      // The mock's two declared directions, plus the catch-all holding the
      // untagged deterministic size fill.
      const chips = page.locator('.next-run-direction');
      await expect(chips).toHaveCount(3);
      await expect(chips.nth(0)).toContainText('finish started work');
      await expect(chips.nth(1)).toContainText('start the next queued item');
      await expect(chips.nth(2)).toContainText('other');

      // Single-select: exactly one chip is pressed, and it is the first (so the
      // page never lands on "generated, but nothing visible").
      await expect(page.locator('.next-run-direction[aria-pressed="true"]')).toHaveCount(1);
      await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');

      // The chooser sits above the option list in DOM order — on a narrow
      // viewport the directions are what you meet first, not the goals.
      await expect(page.locator('#next-run-directions ~ #next-run-options')).toHaveCount(1);

      // The selected direction's summary is shown without needing a hover.
      await expect(page.locator('.next-run-direction-summary')).toContainText('already in flight');
    });

    test('clicking a direction swaps the visible goals', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const chips = page.locator('.next-run-direction');
      await expect(chips.first()).toBeVisible({ timeout: 5000 });

      // Direction 1 shows the in-progress goal (TEST-1) and not the queued one.
      const previews = page.locator('.next-run-goal-preview');
      await expect(previews.first()).toContainText('Finish TEST-1');
      await expect(page.locator('.next-run-option')).toHaveCount(2); // 1 goal + open

      await chips.nth(1).click();

      // Selection moved, and the visible goal moved with it.
      await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.next-run-direction[aria-pressed="true"]')).toHaveCount(1);
      await expect(previews.first()).toContainText('Start TEST-2');
      await expect(page.locator('.next-run-goal-preview', { hasText: 'Finish TEST-1' })).toHaveCount(0);
      await expect(page.locator('.next-run-direction-summary')).toContainText('next ranked item');
    });

    // LIN-1566 review F1. The chooser is driven by mouse everywhere else in this
    // file, and that modality gap is exactly what shipped a focus bug: activating a
    // chip used to repaint the row via innerHTML, destroying the focused element and
    // dropping focus to <body> — so a keyboard user was thrown back to chip 0 on
    // every switch, with nothing for an AT to announce the swap against. These two
    // tests pin the behaviour (focus survives activation), not the implementation.
    test('keyboard activation switches direction AND keeps focus on the chip (F1)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const chips = page.locator('.next-run-direction');
      await expect(chips.first()).toBeVisible({ timeout: 5000 });

      await chips.nth(1).focus();
      await expect(chips.nth(1)).toBeFocused();

      await page.keyboard.press('Enter');

      // The activation worked...
      await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.next-run-goal-preview').first()).toContainText('Start TEST-2');
      // ...and the user is still on the control they just used, not on <body>.
      await expect(chips.nth(1)).toBeFocused();
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
    });

    test('Space activation also preserves focus, and the summary is a live region', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const chips = page.locator('.next-run-direction');
      await expect(chips.first()).toBeVisible({ timeout: 5000 });

      await chips.nth(2).focus();
      await page.keyboard.press('Space');

      await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(chips.nth(2)).toBeFocused();

      // Focus does not move to the new goals, so the summary is what announces the
      // switch. It only announces because the node persists across selections — an
      // innerHTML-replaced live region is a new node and is not reliably read out.
      await expect(page.locator('.next-run-direction-summary')).toHaveAttribute('aria-live', 'polite');
    });

    test('continue-until-stopped is offered under every direction and inside none', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      const chips = page.locator('.next-run-direction');
      await expect(chips.first()).toBeVisible({ timeout: 5000 });

      const count = await chips.count();
      for (let i = 0; i < count; i++) {
        await chips.nth(i).click();
        // Always exactly one, always last — it belongs to no direction.
        await expect(page.locator('.next-run-option-open')).toHaveCount(1);
        await expect(page.locator('.next-run-option').last()).toHaveClass(/next-run-option-open/);
      }

      // The chip counts cover only the concrete goals, never the open option.
      const counts = await page.locator('.next-run-direction-count').allTextContents();
      const total = counts.reduce((n, t) => n + Number(t.trim()), 0);
      const concrete = await page.locator('.next-run-option:not(.next-run-option-open)').count();
      expect(total).toBe(3); // the mock's two tagged goals + the catch-all fill
      expect(concrete).toBeGreaterThan(0);
    });

    test('a response with no grouping renders the flat list, chooser hidden (A5)', async ({ page }) => {
      // Serve the real mock minus its `directions` key — exactly what an older or
      // degraded generation returns. The page must fall back to today's behaviour.
      await page.route('**/api/next-run/suggest', async route => {
        const res = await route.fetch();
        const body = await res.json();
        delete body.directions;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });

      await page.locator('#next-run-generate').click();
      await expect(page.locator('.next-run-option').first()).toBeVisible({ timeout: 5000 });

      await expect(page.locator('#next-run-directions')).toBeHidden();
      await expect(page.locator('.next-run-direction')).toHaveCount(0);

      // Every option is on screen at once, as it was before grouping existed.
      await expect(page.locator('.next-run-option')).toHaveCount(4);
      await expect(page.locator('.next-run-option-open')).toHaveCount(1);
      for (const size of ['S', 'M', 'L']) {
        await expect(page.locator('.next-run-size', { hasText: new RegExp(`^${size}$`) })).not.toHaveCount(0);
      }
    });

    test('no copy on the page calls a direction a "theme" (D4)', async ({ page }) => {
      await page.locator('#next-run-generate').click();
      await expect(page.locator('.next-run-direction').first()).toBeVisible({ timeout: 5000 });

      // Scoped to this page's own content — the shared footer's `theme: light`
      // control is deliberately out of scope (it is the site-wide theme toggle).
      const copy = await page.locator('main.next-run-page').innerText();
      expect(copy.toLowerCase()).not.toContain('theme');
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
      // LIN-1162: the +proxy block is attached SERVER-SIDE now. The kickoff requires
      // the proxy (this surface exposes no +proxy toggle → proxyForce), so the client
      // sends attachProxy:true and the RAW prompt — the block is NOT in the request
      // body any more...
      expect(body.attachProxy).toBe(true);
      expect(body.prompt).not.toContain('Workspace API access');

      await expect(cli).toHaveText('dispatched!', { timeout: 5000 });

      // ...and the SERVER attaches it (LIN-645's promise is preserved): the stored
      // dispatch item's prompt carries the access block + catalog link. The client's
      // no-toggle surface still guarantees the token via attachProxy.
      const list = await page.request.get(`/workspace/${URL_KEY}/api/dispatch`);
      const { items } = await list.json();
      const item = items.find(i => i.kind === 'autopilot');
      expect(item).toBeDefined();
      expect(item.prompt).toContain('Workspace API access');
      expect(item.prompt).toContain('/api/proxy/instructions');
    });

    // LIN-1096: the shared model/harness exec controls live inside the same
    // dispatch options panel as the per-target buttons.
    test('exec controls appear in the dispatch panel and flow through to the dispatched item', async ({ page }) => {
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const controls = card.locator('.dispatch-exec-controls');
      await expect(controls).toBeVisible();
      await controls.locator('.dispatch-exec-harness-select').selectOption('claude-code');
      await controls.locator('.dispatch-exec-model').fill('anthropic/claude-opus-4.8');

      const dispatchReq = page.waitForRequest(req =>
        req.url().includes('/api/dispatch') && req.method() === 'POST');
      await card.locator('.next-run-dispatch[data-target="cli"]').click();

      const req = await dispatchReq;
      const body = JSON.parse(req.postData() || '{}');
      expect(body.harness).toBe('claude-code');
      expect(body.model).toBe('anthropic/claude-opus-4.8');
    });

    test('a failed proxy-token mint surfaces as failure, not a bare dispatch (LIN-645/LIN-1162)', async ({ page }) => {
      // LIN-1162: the +proxy block is now attached SERVER-SIDE, so the client no
      // longer mints /api/proxy/tokens on dispatch — the dispatch route mints and,
      // when it CANNOT attach the promised proxy context, returns 503 and enqueues
      // NOTHING ("surface, don't silently drop"; the no-enqueue guarantee is pinned
      // by dispatch-route-proxy-context.test.js). The client must show that failure
      // rather than swallowing it into a silent bare dispatch. Simulate the server's
      // 503 on the dispatch POST and assert the button surfaces it.
      await page.route('**/api/dispatch', route => {
        if (route.request().method() === 'POST') {
          return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"a proxy token could not be created"}' });
        }
        return route.continue();
      });

      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const cli = card.locator('.next-run-dispatch[data-target="cli"]');
      await cli.click();

      await expect(cli).toHaveText('failed', { timeout: 5000 });
    });

    // LIN-1002: the goal sent to the autopilot-kickoff endpoint carries the
    // referenced task id + title, not the prose alone.
    test('a concrete card dispatches a goal that embeds the referenced task id and title', async ({ page }) => {
      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const autopilotReq = page.waitForRequest(req =>
        req.url().includes('/api/autopilot-prompt') && req.method() === 'GET');
      await card.locator('.next-run-dispatch[data-target="cli"]').click();

      const req = await autopilotReq;
      const goalParam = new URL(req.url()).searchParams.get('goal') || '';
      expect(goalParam).toContain('Referenced tasks:');
      expect(goalParam).toContain('TEST-1');
      expect(goalParam).toContain('Parent task in progress');
    });

    // LIN-1566: grouping is a display filter only. A card reached by switching
    // direction must dispatch exactly what the flat page dispatched — same single
    // goal string, same referenced-task block, same issue-less autopilot item.
    test('a card reached via a second direction dispatches an unchanged payload', async ({ page }) => {
      const chips = page.locator('.next-run-direction');
      await expect(chips.first()).toBeVisible({ timeout: 5000 });
      await chips.nth(1).click();

      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card.locator('.next-run-goal-preview')).toContainText('Start TEST-2');
      await card.locator('.next-run-option-head').click();
      await card.locator('.next-run-dispatch-toggle').click();

      const autopilotReq = page.waitForRequest(req =>
        req.url().includes('/api/autopilot-prompt') && req.method() === 'GET');
      const dispatchReq = page.waitForRequest(req =>
        req.url().includes('/api/dispatch') && req.method() === 'POST');
      await card.locator('.next-run-dispatch[data-target="cli"]').click();

      // The goal handed to the kickoff still carries the referenced task id+title.
      const goalParam = new URL((await autopilotReq).url()).searchParams.get('goal') || '';
      expect(goalParam).toContain('Referenced tasks:');
      expect(goalParam).toContain('TEST-2');

      // And the dispatch itself is the same shape: one issue-less autopilot item.
      const body = JSON.parse((await dispatchReq).postData() || '{}');
      expect(body.kind).toBe('autopilot');
      expect(body.target).toBe('cli');
      expect(body.issueId == null).toBe(true);
      expect(body.attachProxy).toBe(true);
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

    // LIN-1002: the dispatched goal must carry the referenced task id + title,
    // not the prose paragraph alone, so the autopilot gets an unambiguous task
    // reference. The first concrete mock option references TEST-1 ("Parent task
    // in progress").
    test('the dispatched goal embeds the referenced task id and title', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      await page.goto(PAGE_URL);
      await page.waitForLoadState('networkidle');
      await page.locator('#next-run-generate').click();

      const card = page.locator('.next-run-option:not(.next-run-option-open)').first();
      await expect(card).toBeVisible({ timeout: 5000 });
      await card.locator('.next-run-option-head').click();

      const href = await card.locator('.next-run-accept').getAttribute('href');
      const goal = decodeURIComponent(href.split('goal=')[1] || '');
      // The prose is preserved AND the referenced task is folded in (id + title).
      expect(goal).toContain('Referenced tasks:');
      expect(goal).toContain('TEST-1');
      expect(goal).toContain('Parent task in progress');
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

    // LIN-1566: the mock must be in shape-parity with the live generator — it is
    // the only response the e2e suite ever sees, so a mock missing `directions`
    // would let every grouped test pass against the flat fallback.
    test('returns a resolved directions grouping in parity with the live generator', async ({ page }) => {
      await page.goto(`/test/set-session?${featuresParam({ nextRun: true })}&urlKey=${URL_KEY}`);
      const res = await page.request.post(SUGGEST_API, { data: {} });
      const body = await res.json();

      expect(Array.isArray(body.directions)).toBe(true);
      expect(body.directions.length).toBeGreaterThan(0);
      for (const d of body.directions) {
        expect(typeof d.name).toBe('string');
        expect(d.name.length).toBeGreaterThan(0);
        expect(Array.isArray(d.optionIndexes)).toBe(true);
        expect(d.optionIndexes.length).toBeGreaterThan(0);
      }

      // Invariant 2: optionIndexes partition every concrete option exactly once.
      const flat = body.directions.flatMap(d => d.optionIndexes);
      expect(new Set(flat).size).toBe(flat.length);
      const concreteIndexes = body.options
        .map((o, i) => (o.continueUntilStopped ? null : i))
        .filter(i => i !== null);
      expect([...flat].sort((a, b) => a - b)).toEqual(concreteIndexes);

      // Invariant 3: the open-ended option is in no direction.
      const openIndex = body.options.findIndex(o => o.continueUntilStopped);
      expect(flat).not.toContain(openIndex);

      // LIN-1665: same parity reason — the healthy mock carries the healthy VALUE of
      // the degradation flag rather than omitting the key, so a client that reads it
      // is exercised against the shape the live generator actually returns.
      expect(body.degraded).toBeNull();
    });
  });
});
