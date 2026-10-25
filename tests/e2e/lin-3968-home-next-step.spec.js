import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { facelessButtons } from '../fixtures/house-face.js';

// LIN-3968: Home's opened task, with seeded sessions. Witnesses in a real browser, for an owner with a runner:
// a failed stage counts as needing you and is offered again (not the stage after it); a running stage offers no
// other step; the stage strip is one row and no chip is clipped on a phone; the stage piece is styled on Home; and
// the copy-first view names its step and says in plain words which task a written prompt is for.

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const TOP = 'LOCAL-H1';
let URL_KEY;

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-agent-status?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${URL_KEY}`);
});

/** One In Progress task with a project; the sessions are seeded through the consumer API. */
async function seedTask(page, { runnerKey = true, openRouterConnected = false } = {}) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      runnerKey,
      openRouterConnected,
      projects: [{ id: id('h-proj'), name: 'Home project', content: 'A project', sortOrder: 1 }],
      issues: [{
        id: id('h-top'), identifier: TOP, title: 'Home polish task', description: 'Seeded task', projectId: id('h-proj'),
        sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${URL_KEY}/issue/${id('h-top')}`,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function runnerToken(page) {
  const resp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`);
  return (await resp.json()).token;
}

/**
 * Enqueue a session on TOP; take it unless `take:false`; post its feedback (a `[done]` or `[failed]` line ends it).
 * `extra` adds dispatch fields (an abort names its target with `abort`/`abortTo`). Returns the row's id.
 */
async function seedSession(page, token, { kind, feedback = [], take = true, extra = {} }) {
  const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: TOP, issueTitle: 'Home polish task', target: 'cli', ...extra },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  if (!take) return itemId;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  for (const message of feedback) {
    const fb = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { message },
    });
    expect(fb.status(), `feedback failed: ${await fb.text()}`).toBe(200);
  }
  return itemId;
}

/** Plan and Build done, Review failed: the case the ticket names. */
async function seedFailedReview(page) {
  const token = await runnerToken(page);
  await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
  await seedSession(page, token, { kind: 'implementation', feedback: ['[done] built it'] });
  await seedSession(page, token, { kind: 'review', feedback: ['[failed] review could not finish'] });
}

async function gotoHome(page) {
  await page.goto(`/workspace/${URL_KEY}/`);
  await page.waitForLoadState('networkidle');
}

/** Open Home's marked top task unless it is already open; return the opened-task block. */
async function openTopTask(page) {
  const block = page.locator('.opened-task').first();
  if (!(await block.isVisible())) await page.locator('[data-top-task="1"]').click();
  await expect(block).toBeVisible();
  return block;
}

const chips = (block) => block.locator('[data-testid="task-page-strip-chip"]');
const chip = (block, kind) => block.locator(`[data-testid="task-page-strip-chip"][data-kind="${kind}"]`);

test.describe('Home: a failed stage is needs-you and offered again (LIN-3968)', () => {
  test.use({ viewport: DESKTOP });

  test('a failed Review is offered again, not Close-out, and the count line counts it', async ({ page }) => {
    await seedTask(page);
    await seedFailedReview(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    await expect(chip(block, 'review')).toHaveAttribute('data-state', 'failed');
    await expect(chip(block, 'review')).toHaveAttribute('data-offered', 'true');
    await expect(chip(block, 'close-out')).not.toHaveAttribute('data-offered', 'true');
    await expect(page.locator('[data-testid="in-progress-count"]')).toContainText('1 needs you');
    await expect(page.locator('[data-testid="issue-row-state"]').filter({ hasText: 'Review failed' }).first()).toBeVisible();
  });
});

test.describe('Home: a Review that failed as the only stage (LIN-3991)', () => {
  test.use({ viewport: DESKTOP });

  test('the strip starts at the failed stage: Review failed and Close-out, nothing before it', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'review', feedback: ['[failed] review could not finish'] });
    await gotoHome(page);
    const block = await openTopTask(page);

    await expect(chips(block)).toHaveCount(2);
    await expect(chip(block, 'review')).toHaveAttribute('data-state', 'failed');
    await expect(chip(block, 'close-out')).toHaveAttribute('data-state', 'ahead');
    await expect(chip(block, 'research')).toHaveCount(0);
    await expect(chip(block, 'plan')).toHaveCount(0);
  });
});

test.describe('Home: a running stage offers no other step (LIN-3968)', () => {
  test.use({ viewport: DESKTOP });

  test('while Build runs, no chip is offered and no Run button is offered', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedSession(page, token, { kind: 'implementation' });
    await gotoHome(page);
    const block = await openTopTask(page);

    await expect(chip(block, 'implementation')).toHaveAttribute('data-state', 'running');
    await expect(block.locator('[data-offered="true"]')).toHaveCount(0);
    await expect(block.getByRole('button', { name: /^Run / })).toHaveCount(0);
  });

  test('while Build runs and the run preview is still out, the run block offers no step either (not "Run to PR")', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedSession(page, token, { kind: 'implementation' });
    // Hold the run preview until the assertions have run: the state block already names the running stage.
    let releasePreview;
    const held = new Promise((resolve) => { releasePreview = resolve; });
    await page.route('**/api/dispatch/preview*', async (route) => { await held; await route.continue(); });
    try {
      await gotoHome(page);
      const block = await openTopTask(page);
      await expect(chip(block, 'implementation')).toHaveAttribute('data-state', 'running');

      const run = block.locator('[data-testid="opened-task-run"]');
      await expect(run.getByTestId('run-ask-harbour')).toHaveCount(0);
      await expect(run).not.toContainText('Run to PR');
      await expect(run).not.toContainText('write prompt');
    } finally {
      releasePreview();
    }
  });
});

test.describe('Home: a failed stage can be run again (LIN-3968 DECISION, option a)', () => {
  test.use({ viewport: DESKTOP });

  test('Run Review on a Review that failed moments ago is accepted and queued, not refused as a duplicate', async ({ page }) => {
    await seedTask(page);
    await seedFailedReview(page);
    await gotoHome(page);
    const block = await openTopTask(page);

    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/dispatch$/.test(new URL(r.url()).pathname));
    await block.getByTestId('opened-task-go').click();
    const resp = await posted;
    expect(resp.status(), 'a failed stage is not a duplicate of itself').toBe(201);
    // The run is queued (a refused dispatch is a 409, which fails above), so the run block names it as queued.
    await expect(block.locator('[data-testid="opened-task-run"]')).toContainText('Queued');
  });

  test('Run Review after Home\'s Stop on a Review that started moments ago is accepted, not refused as "Started."', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedSession(page, token, { kind: 'implementation', feedback: ['[done] built it'] });
    const review = await seedSession(page, token, { kind: 'review', feedback: ['[started] review running'] });
    // Home's Stop sends an abort row that names the Review. The runner posts [aborted] on that abort row, not on the Review.
    await seedSession(page, token, { kind: 'review', feedback: ['[aborted] Stopped by the person'], extra: { abort: true, abortTo: review } });
    await gotoHome(page);
    const block = await openTopTask(page);

    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/dispatch$/.test(new URL(r.url()).pathname));
    await block.getByTestId('opened-task-go').click();
    const resp = await posted;
    expect(resp.status(), 'a Review that Stop ended is not a duplicate of itself').toBe(201);
    await expect(block.locator('[data-testid="opened-task-run"]')).toContainText('Queued');
  });
});

test.describe('Home: the stage strip is one row and styled (LIN-3968)', () => {
  test.use({ viewport: DESKTOP });

  test('every chip sits on one row, and the strip is styled from the shared stage sheet', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedSession(page, token, { kind: 'implementation' });
    await gotoHome(page);
    const block = await openTopTask(page);

    const tops = await chips(block).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops.length, 'one chip per stage reached or still ahead').toBeGreaterThanOrEqual(3);
    expect(new Set(tops).size, 'all chips share one row').toBe(1);
    // Witness for the shared stylesheet: Home loads stage-track.css, so a chip has its own border (absent unstyled).
    // LIN-3991: the row wraps on a phone, so only the desktop row is pinned to one line here.
    await expect(block.locator('.task-strip')).toHaveCSS('flex-wrap', 'wrap');
    await expect(chip(block, 'plan')).toHaveCSS('border-top-style', 'solid');
  });
});

test.describe('Home: no stage name is clipped on a phone (LIN-3968)', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('each chip shows its whole name and state at 390px', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await seedSession(page, token, { kind: 'implementation' });
    await gotoHome(page);
    const block = await openTopTask(page);

    const clipped = await chips(block).evaluateAll((els) => els
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent.trim()));
    expect(clipped, 'no chip cuts its text').toEqual([]);
  });

  // LIN-3991: no stage name or state word breaks inside a word; a hyphen break ("Close-out") is fine.
  test('every chip name and state word sit on no more lines than they have words at 390px (LIN-3991)', async ({ page }) => {
    await seedTask(page);
    const token = await runnerToken(page);
    // Research and Plan done: the strip shows all five cells, with "Research" the longest label (the ticket's case).
    await seedSession(page, token, { kind: 'research', feedback: ['[done] researched it'] });
    await seedSession(page, token, { kind: 'plan', feedback: ['[done] planned it'] });
    await gotoHome(page);
    const block = await openTopTask(page);

    const broken = await chips(block).evaluateAll((els) => els.flatMap((el) => ['.task-strip-name', '.task-strip-state']
      .map((sel) => el.querySelector(sel))
      .filter(Boolean)
      .map((part) => {
        const words = part.textContent.trim().split(/[\s-]+/).filter(Boolean).length;
        const lines = part.getClientRects().length;
        return { text: part.textContent.trim(), words, lines };
      })
      .filter((part) => part.lines > part.words)));
    expect(broken, 'no chip word breaks mid-word').toEqual([]);
  });
});

test.describe('Home: the copy-first view names its step and the task a written prompt is for (LIN-3968)', () => {
  test.use({ viewport: DESKTOP });

  test('after writing, the header names the step and the target line says which task the prompt is for', async ({ page }) => {
    await seedTask(page, { runnerKey: false, openRouterConnected: true });
    // A recommendation whose prompt is for a subtask (the container routed to it). Only the stream is stubbed.
    const sse = (events) => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    await page.route('**/api/recommend/*/stream*', (route) => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        ['delta', { section: 'prompt', content: 'Write the test for the copy-first view.' }],
        ['done', { truncated: false, completionTokens: null, issueUrl: null, identifier: 'LOCAL-H2', title: 'Write the test', deferredVia: ['LOCAL-H1'] }],
      ]),
    }));
    await gotoHome(page);
    const block = await openTopTask(page);

    await block.locator('[data-testid="opened-task-write"]').click();
    await expect(block.locator('[data-testid="opened-task-target"]')).toContainText(
      'This prompt is for LOCAL-H2 Write the test, a subtask of LOCAL-H1.'
    );
    const header = block.locator('.opened-task-step-name');
    await expect(header).not.toHaveText('AI Recommendation');
    await expect(header).toHaveText('Next prompt');
    // Every button in the opened task now written has a house face, including Copy, Rewrite and Download.
    const faceless = await facelessButtons(block);
    expect(faceless, 'every button in the written copy-first view has a house colour for its face').toEqual([]);
    // Rewrite sits beside Download and matches it on Home (style.css, scoped to the opened task); Swipe keeps its own.
    const sized = (selector) => block.locator(selector).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { font: cs.fontSize, padding: cs.padding, background: cs.backgroundColor, color: cs.color };
    });
    expect(await sized('button.btn.opened-task-regenerate'), 'Rewrite matches Download on Home')
      .toEqual(await sized('button.opened-task-download'));
  });
});
