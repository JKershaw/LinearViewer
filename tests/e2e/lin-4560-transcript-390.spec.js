import { test, expect } from '../fixtures/test-base.js';

/**
 * LIN-4560 beat 3: one transcript look, readable on a phone. The run page and Dispatch history draw a run's transcript
 * through the one look (lib/transcript.js, styled in public/chat.css). At a 390px viewport, in light and in dark, with a
 * long unbroken token and a code block in a message, a waiting line and an opened child-agent thread, nothing widens the
 * page: the document does not scroll sideways, and every bubble, note and thread ends inside the viewport. A code block
 * may scroll inside its own box (`.chat-md pre`), never the page.
 *
 * A screenshot of each page's transcript in each theme is written under test-results/ for a person to look at.
 */

const PHONE = { width: 390, height: 844 };
const LONG_TOKEN = `sha:${'q7Lm2Xv9'.repeat(40)}`;
const CODE_BLOCK = `Ran it:\n\n\`\`\`\nconst result = ['${'w'.repeat(220)}'];\n\`\`\`\n`;

async function clearRuns(page, urlKey) {
  for (const seam of ['clear-ticket-records', 'clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status', 'clear-observation-sessions', 'clear-sessions-feed-cache']) {
    await page.goto(`/test/${seam}?urlKey=${urlKey}`);
  }
}

/** One session whose worker posted a long token, a code block, a child agent's words and a waiting line. */
async function seedWideRun(page, urlKey) {
  const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LIN-4560', issueTitle: 'Phone seed', target: 'cli' }
  });
  expect(anchor.status(), await anchor.text()).toBe(201);
  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: 'LIN-4560', issueTitle: 'Phone worker', target: 'cli', sessionId: (await anchor.json()).item.id }
  });
  expect(worker.status(), await worker.text()).toBe(201);
  const workerId = (await worker.json()).item.id;
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json();
  expect((await page.request.post(`/api/dispatch/take/${workerId}`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
  const posts = [
    { message: `The digest is ${LONG_TOKEN} and nothing else.`, kind: 'assistant-text' },
    { message: CODE_BLOCK, kind: 'assistant-text' },
    { message: `Child found ${LONG_TOKEN}`, kind: 'agent-text', agent: `agent-${'k'.repeat(60)}` },
    { message: '[waiting] waiting on the review agent · 4m · next heartbeat in ≤5m', kind: 'heartbeat' },
    { message: 'opened the PR', url: `https://example.com/${LONG_TOKEN}`, urlLabel: LONG_TOKEN, kind: 'evidence' },
  ];
  for (const data of posts) {
    const res = await page.request.post(`/api/dispatch/feedback/${workerId}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data });
    expect(res.status(), await res.text()).toBe(200);
  }
}

async function sessionIdOf(page, urlKey) {
  const body = await (await page.request.get(`/workspace/${urlKey}/api/dashboard/sessions`)).json();
  const seeded = [...(body.active || []), ...(body.recent || [])].find((s) => String(s.sessionId || '').length > 0);
  expect(seeded, JSON.stringify(body.counts)).toBeTruthy();
  return seeded.sessionId;
}

/** What sticks out of a 390px viewport: the document's sideways scroll, and every transcript box past the right edge. */
async function overflowOf(page, scope) {
  return page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    if (document.documentElement.scrollWidth > vw) out.push(`document scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll(`${sel} .chat-msg, ${sel} .chat-note, ${sel} .sess-agent-thread, ${sel} .sess-agent-thread__summary`)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 0.5) out.push(`${el.getAttribute('data-testid') || el.className} ends at ${Math.round(r.right)} > ${vw}`);
    }
    // Content wider than its own box is overflow too, even where an ancestor clips it (the thread's overflow-x: hidden)
    // and no box moves: the transcript itself and everything in it, except a code block, which scrolls inside its own
    // box by design (`.chat-md pre`), and what is inside one.
    for (const el of document.querySelectorAll(`${sel}, ${sel} *`)) {
      if (el.closest('pre') || !el.clientWidth) continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.getAttribute('data-testid') || el.tagName.toLowerCase() + '.' + el.className} content ${el.scrollWidth} > box ${el.clientWidth}`);
    }
    return out;
  }, scope);
}

async function setTheme(page, theme) {
  await page.evaluate((dark) => document.documentElement.classList.toggle('theme-dark', dark), theme === 'dark');
}

test.describe('LIN-4560: the transcript at 390px, light and dark', () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page, workerUrlKey }) => {
    await page.goto(`/test/set-session?urlKey=${workerUrlKey}`);
    await clearRuns(page, workerUrlKey);
    await seedWideRun(page, workerUrlKey);
  });

  for (const theme of ['light', 'dark']) {
    test(`run page (${theme}): no sideways overflow with a long token, a code block and an opened child thread`, async ({ page, workerUrlKey }, testInfo) => {
      const sessionId = await sessionIdOf(page, workerUrlKey);
      await page.goto(`/workspace/${workerUrlKey}/observation/session/${encodeURIComponent(sessionId)}`);
      await page.waitForLoadState('networkidle');
      await setTheme(page, theme);
      // The worker's row holds the transcript (the anchor's has none); open it.
      const run = page.locator('[data-testid="session-run"]').filter({ has: page.locator('[data-testid="session-run-transcript"]') }).first();
      await run.locator('[data-testid="session-run-toggle"]').click();
      const tx = run.locator('[data-testid="session-run-transcript"]');
      await expect(tx.locator('[data-testid="transcript-entry"]')).toHaveCount(3);
      await expect(tx.locator('[data-testid="transcript-waiting"]')).toHaveCount(1);
      await tx.locator('[data-testid="transcript-agent-summary"]').click();
      await expect(tx.locator('[data-testid="transcript-agent-entry"]')).toBeVisible();
      await tx.scrollIntoViewIfNeeded();
      await run.screenshot({ path: testInfo.outputPath(`run-page-390-${theme}.png`) });
      await tx.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await run.screenshot({ path: testInfo.outputPath(`run-page-390-${theme}-end.png`) });
      await tx.locator('[data-testid="transcript-waiting"]').scrollIntoViewIfNeeded();
      await tx.locator('[data-testid="transcript-agent-thread"]').screenshot({ path: testInfo.outputPath(`run-page-390-${theme}-thread.png`) });
      await tx.locator('[data-testid="transcript-waiting"]').screenshot({ path: testInfo.outputPath(`run-page-390-${theme}-waiting.png`) });
      expect(await overflowOf(page, '[data-testid="session-run-transcript"]')).toEqual([]);
    });

    test(`Dispatch history (${theme}): no sideways overflow with a long token, a code block and an opened child thread`, async ({ page, workerUrlKey }, testInfo) => {
      await page.goto(`/workspace/${workerUrlKey}/dispatch`);
      await page.waitForLoadState('networkidle');
      await setTheme(page, theme);
      const tx = page.locator('[data-testid="history-transcript"]').first();
      await expect(tx.locator('[data-testid="transcript-entry"]')).toHaveCount(3);
      await expect(tx.locator('[data-testid="transcript-waiting"]')).toHaveCount(1);
      await tx.locator('[data-testid="transcript-agent-summary"]').click();
      await expect(tx.locator('[data-testid="transcript-agent-entry"]')).toBeVisible();
      await tx.scrollIntoViewIfNeeded();
      const row = page.locator('.history-item').filter({ has: tx }).first();
      await row.screenshot({ path: testInfo.outputPath(`dispatch-390-${theme}.png`) });
      await tx.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await row.screenshot({ path: testInfo.outputPath(`dispatch-390-${theme}-end.png`) });
      expect(await overflowOf(page, '[data-testid="history-transcript"]')).toEqual([]);
    });
  }
});
