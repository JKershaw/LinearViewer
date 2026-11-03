/**
 * LIN-4107 check (beat 3): the non-Home pages the body and h1 phone shrinks were removed for, at 390px and 1280px.
 * Captures the Plain legal page (/privacy) and Settings › Models, and records the body font-size at each width.
 *   npx playwright test --config=playwright.visual.config.js tests/visual/lin-4107-nonhome-screenshots.spec.js
 * Output: docs/reviews/_evidence-2026-11-03-lin4107/nonhome-{privacy|settings-models}-{1280|390}.png
 *         docs/reviews/_evidence-2026-11-03-lin4107/nonhome-metrics.json
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const DIR = 'docs/reviews/_evidence-2026-11-03-lin4107';
const WIDTHS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };
const metrics = {};

test.describe.configure({ mode: 'serial' });

test('non-Home pages at 1280 and 390 (light)', async ({ page, localWorkerUrlKey }) => {
  mkdirSync(DIR, { recursive: true });
  const urlKey = localWorkerUrlKey;
  await page.goto('/test/clear-local-store');
  const id = (raw) => localSeedId(urlKey, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey, runnerKey: true,
      issues: [{ id: id('a'), identifier: 'LOCAL-1', title: 'A task', createdAt: '2020-01-01T00:00:00Z', url: 'https://example.com/a', description: 'x', state: { name: 'Todo', type: 'unstarted' }, projectId: id('p') }],
      projects: [{ id: id('p'), name: 'Docs', content: 'x', sortOrder: 0 }],
    },
  });
  expect(resp.ok()).toBeTruthy();
  for (const [label, viewport] of Object.entries(WIDTHS)) {
    await page.setViewportSize(viewport);
    for (const [name, path] of [['privacy', '/privacy'], ['settings-models', `/workspace/${urlKey}/settings/models`]]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const body = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        const h1 = document.querySelector('h1');
        return { bodyFontSize: cs.fontSize, bodyFontFamily: cs.fontFamily.split(',')[0], h1FontSize: h1 ? getComputedStyle(h1).fontSize : 'no h1', h1Text: h1 ? h1.textContent.trim().slice(0, 40) : '' };
      });
      metrics[`${name}-${label}`] = body;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${DIR}/nonhome-${name}-${label}.png`, fullPage: true });
    }
  }
  writeFileSync(`${DIR}/nonhome-metrics.json`, JSON.stringify(metrics, null, 2));
});
