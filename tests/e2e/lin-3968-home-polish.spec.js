import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// LIN-3968: Home's opened task is styled, on the deployed page. Witnesses in a real browser, for a viewer with no
// runner (the copy-first view): every button in the opened task outside the run panel has a background or a border
// colour from the house tokens; no prose element in it computes to the monospace face; and the block is contained,
// with its own border and surface, so it reads apart from the rows around it. Both themes, at 1280px and 390px.

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Light is the default; dark is the opt-in `.theme-dark` hook on <html> (see CLAUDE.md, Design Principles). */
async function setTheme(page, theme) {
  await page.evaluate((dark) => document.documentElement.classList.toggle('theme-dark', dark), theme === 'dark');
}

async function gotoHome(page, urlKey) {
  await page.goto(`/workspace/${urlKey}/`);
  await page.waitForLoadState('networkidle');
}

/** Open Home's marked top task unless it is already open; return the contained opened-task block. */
async function openTopTask(page) {
  const block = page.locator('.opened-task').first();
  if (!(await block.isVisible())) await page.locator('[data-top-task="1"]').click();
  await expect(block).toBeVisible();
  return block;
}

/** Buttons in the opened task that are not in the run panel (LIN-3962 owns that panel) with no face of their own. */
async function facelessButtons(block) {
  return block.evaluate((root) => [...root.querySelectorAll('button')]
    .filter((b) => !b.closest('.opened-task-run'))
    .filter((b) => {
      const cs = getComputedStyle(b);
      const transparent = (c) => c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
      return transparent(cs.backgroundColor) && (cs.borderTopStyle === 'none' || transparent(cs.borderTopColor));
    })
    .map((b) => b.outerHTML.slice(0, 120)));
}

/** Prose in the opened task that computes to a monospace face (machine facts keep mono; prose does not). */
async function monospaceProse(block) {
  return block.evaluate((root) => [...root.querySelectorAll('p, .opened-task-step, .opened-task-paste, .opened-task-key-note, .opened-task-target, .opened-task-text, .opened-task-last')]
    .filter((el) => el.textContent.trim() && /mono|courier/i.test(getComputedStyle(el).fontFamily))
    .map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
}

for (const [label, viewport] of [['1280px', DESKTOP], ['390px', PHONE]]) {
  test.describe(`Home — the opened task is styled, copy-first, ${label} (LIN-3968)`, () => {
    test.use({ viewport, isMobile: viewport === PHONE, hasTouch: viewport === PHONE });

    for (const theme of ['light', 'dark']) {
      test(`${theme}: buttons have a house face, prose is sans, and the block is contained`, async ({ page, seedLocal, localWorkerUrlKey }) => {
        await seedLocal(workspaceApiLocalSeed);
        await gotoHome(page, localWorkerUrlKey);
        await setTheme(page, theme);
        const block = await openTopTask(page);

        expect(await facelessButtons(block), 'every button outside the run panel has a face').toEqual([]);
        expect(await monospaceProse(block), 'no prose computes to the monospace face').toEqual([]);

        const contained = await block.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { border: cs.borderTopStyle, surface: cs.backgroundColor };
        });
        expect(contained.border).toBe('solid');
        expect(contained.surface).not.toBe('rgba(0, 0, 0, 0)');
      });
    }
  });
}
