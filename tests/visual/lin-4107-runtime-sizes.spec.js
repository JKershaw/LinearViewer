/**
 * LIN-4107 check (beat 3): every distinct computed font-size and font-family on Home and the task page at runtime, at
 * 1280px and 390px, owner persona, light. Counts the elements that carry their own text, not the stylesheet values.
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4107-runtime-sizes.spec.js
 * Output: docs/reviews/_evidence-2026-11-03-lin4107/runtime-sizes.json
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const DIR = 'docs/reviews/_evidence-2026-11-03-lin4107';
const OLD = '2020-01-01T00:00:00Z';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const out = {};

test.describe.configure({ mode: 'serial' });

test('runtime distinct computed sizes on Home and the task page', async ({ page, localWorkerUrlKey }) => {
  mkdirSync(DIR, { recursive: true });
  const urlKey = localWorkerUrlKey;
  await page.goto('/test/clear-local-store');
  for (const route of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-sessions-feed-cache']) {
    await page.request.get(`/test/${route}?urlKey=${urlKey}`);
  }
  const id = (raw) => localSeedId(urlKey, raw);
  const task = (raw, identifier, title, type, more = {}) => ({
    id: id(raw), identifier, title, createdAt: OLD, url: `https://example.com/${raw}`,
    description: `## Why\n\n${title}.`,
    state: { name: { started: 'In Progress', unstarted: 'Todo' }[type], type },
    ...more,
  });
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey, runnerKey: true,
      issues: [
        task('charter', 'LOCAL-1', 'Charter: Home and the task page read in plain words', 'started', { projectId: id('p-ui'), sortOrder: 0 }),
        task('child', 'LOCAL-2', 'Write the next step for the type change', 'unstarted', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 1 }),
        task('leaf', 'LOCAL-3', 'Settle the type sizes on Home and the task page', 'started', { projectId: id('p-ui'), parentId: id('charter'), sortOrder: 2 }),
      ],
      projects: [{ id: id('p-ui'), name: 'UI finish', content: 'x', sortOrder: 0 }],
    },
  });
  expect(resp.ok()).toBeTruthy();
  const collect = () => page.evaluate(() => {
    const sizes = new Map();
    const fams = new Map();
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      sizes.set(cs.fontSize, (sizes.get(cs.fontSize) || 0) + 1);
      const fam = cs.fontFamily.split(',')[0].trim();
      fams.set(fam, (fams.get(fam) || 0) + 1);
    }
    return { sizes: Object.fromEntries([...sizes].sort((a, b) => b[1] - a[1])), families: Object.fromEntries([...fams].sort((a, b) => b[1] - a[1])) };
  });
  for (const [label, viewport] of Object.entries(WIDTHS)) {
    await page.setViewportSize(viewport);
    await page.goto(`/workspace/${urlKey}/`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    out[`home-${label}`] = await collect();
    await page.goto(`/workspace/${urlKey}/task/LOCAL-3`);
    await page.waitForLoadState('networkidle');
    out[`task-${label}`] = await collect();
  }
  writeFileSync(`${DIR}/runtime-sizes.json`, JSON.stringify(out, null, 2));
});
