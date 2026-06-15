/**
 * Ship Page Screenshot Maker
 *
 * Captures screenshots of the Ship view for visual review.
 * Run manually: npx playwright test --config=playwright.visual.config.js tests/visual/ship-screenshots.spec.js
 * Not part of `npm test` — these write artifacts, they do not assert.
 *
 * Output: tests/screenshots/ship/
 */
import { test, expect } from '../fixtures/test-base.js';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const SHIP_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/ship`;
const SCREENSHOT_DIR = 'tests/screenshots/ship';

test.describe.configure({ mode: 'serial' });

test.describe('Ship Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // ship is gated behind its experimental flag (LIN-496) — seed it on.
    await page.goto(`/test/set-session?swimSample=true&features=${encodeURIComponent('{"ship":true}')}`);
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
  });

  test('01 - default view (desktop, ship centred)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/01-default.png`
    });
  });

  test('02 - full canvas (entire orbit visible)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-full-canvas.png`,
      fullPage: true
    });
  });

  test('03 - popover open', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('#ship-orbit .swim-box').first().click();
    await expect(page.locator('#ship-popover')).not.toHaveClass(/hidden/);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-popover.png`
    });
  });

  test('04 - ship centred zoom (close-up on the ship rect)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    const ship = page.locator('#ship-rect');
    await ship.scrollIntoViewIfNeeded();
    const box = await ship.boundingBox();
    if (box) {
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/04-ship-closeup.png`,
        clip: {
          x: Math.max(0, box.x - 200),
          y: Math.max(0, box.y - 200),
          width: box.width + 400,
          height: box.height + 400
        }
      });
    }
  });

  test('05 - mobile viewport (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/05-mobile.png`
    });
  });

  test('06 - heading set (project as forward)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-project').selectOption('Authentication Overhaul');
    await page.waitForTimeout(150); // settle re-render
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/06-heading-set.png`
    });
  });

  test.describe('Dense fixture (8 projects, 6 WIP, ~36 cards)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/test/set-session?shipSample=true');
      await page.goto(SHIP_URL);
      await page.waitForLoadState('networkidle');
    });

    test('08 - dense: default (no heading)', async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1100 });
      await page.goto(SHIP_URL);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/08-dense-default.png` });
    });

    test('10 - dense: full canvas', async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1100 });
      await page.goto(SHIP_URL);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/10-dense-full.png`, fullPage: true });
    });

    test('11 - dense: assert no card-card overlap', async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1100 });
      await page.goto(SHIP_URL);
      await page.waitForLoadState('networkidle');
      const overlaps = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#ship-orbit .swim-box')];
        const boxes = cards.map(c => {
          const b = c.getBoundingClientRect();
          return { id: c.getAttribute('data-issue-id'), x: b.x, y: b.y, w: b.width, h: b.height };
        });
        const PAD = 0; // pure visual overlap, no padding
        const found = [];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const dx = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2));
            const dy = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
            if (dx < (a.w + b.w) / 2 - PAD && dy < (a.h + b.h) / 2 - PAD) {
              found.push({ a: a.id, b: b.id, dx: Math.round(dx), dy: Math.round(dy) });
            }
          }
        }
        return { cardCount: boxes.length, overlaps: found };
      });
      console.log('OVERLAP_CHECK:', JSON.stringify(overlaps, null, 2));
      expect(overlaps.overlaps.length).toBe(0);
    });

    test('09 - dense: ship close-up', async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1100 });
      await page.goto(SHIP_URL);
      await page.waitForLoadState('networkidle');
      const ship = page.locator('#ship-rect');
      const box = await ship.boundingBox();
      if (box) {
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/09-dense-ship-closeup.png`,
          clip: {
            x: Math.max(0, box.x - 280),
            y: Math.max(0, box.y - 280),
            width: box.width + 560,
            height: box.height + 560
          }
        });
      }
    });
  });

  test('07 - picker open', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('#ship-heading-chip').click();
    await page.waitForTimeout(100);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/07-picker-open.png`
    });
  });
});
