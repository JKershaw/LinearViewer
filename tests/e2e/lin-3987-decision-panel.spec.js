import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decisionPanel, agentLists, suggestionsByHarness } from '../../lib/components/decision-panel.js';

// LIN-3987: the decision panel in a real browser, with the server's own markup, the shared style sheet and the client
// script (public/decision-panel.js). The page is set with the markup, so no seeded server is needed: the panel is the
// component's own output, as Home's sheet and Models both render it. Witnesses: a suggestion is chosen by keyboard and
// by typing, the effort line explains a harness that takes no effort, the panel's words are sans and its prices mono,
// and its fields stop at 32rem on a desktop.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STYLE = path.join(ROOT, 'public/style.css');
const CLIENT = path.join(ROOT, 'public/decision-panel.js');

/**
 * The Change sheet as Home's run block paints it (public/prompt-section.js renderChangePanel): the head, the server's
 * panel with the job's numbers, Runs on, the agent access line, the summary and the Use row. Claude Code in force, with
 * priced runs that report no model, so the numbers block is there.
 */
function sheet({ model = '' } = {}) {
  const numbers = { testid: 'run-numbers', shareTestid: 'run-share', heading: 'This step, last 30 days', runs: 279, priced: 268, unpriced: 5, noTelemetry: 6, spendUsd: 169.59, typicalUsd: 0.63, share: null };
  const panel = decisionPanel({
    testid: 'run-decision-panel',
    fieldAttrs: (field) => `data-testid="run-${field}"`,
    numbers,
    harness: { value: 'claude-code', inForce: 'claude-code', follow: 'From Models', hint: 'Right now: Claude Code' },
    model: { value: model, follow: 'From Models', hint: "Right now: Claude Code's own model", lists: agentLists([]), suggestions: suggestionsByHarness([]) },
    effort: { value: '', follow: 'From Models', hint: "Right now: Claude Code's own effort" }
  });
  return '<div class="opened-task-change-panel" data-testid="run-change-panel">'
    + '<div class="opened-task-change-head">This run only · default: Claude Code\'s own model<button class="btn--quiet opened-task-change-x" data-testid="run-change-x">×</button></div>'
    + panel
    + '<div class="opened-task-change-row"><span class="opened-task-change-label">Runs on</span>'
    + '<button class="btn opened-task-choice" data-testid="run-target-cli" aria-pressed="true">your runner</button>'
    + '<button class="btn opened-task-choice" data-testid="run-target-web" aria-pressed="false">Claude Code on the web</button></div>'
    + '<label class="opened-task-change-row"><input type="checkbox" checked> Your agent may read and update this task</label>'
    + '<p class="opened-task-change-summary" data-testid="run-will-use">This run will use Claude Code\'s own model · Claude Code · Claude Code\'s own effort · your runner.</p>'
    + '<div class="opened-task-change-row"><button class="btn btn--primary opened-task-use" data-testid="run-use">Use for this run</button>'
    + '<button class="btn btn--quiet" data-testid="run-reset">Reset</button><button class="btn btn--quiet">Close</button></div>'
    + '</div>';
}

async function open(page, { width = 1280, height = 900, model = '' } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${sheet({ model })}</body></html>`);
  await page.addStyleTag({ path: STYLE });
  await page.addScriptTag({ path: CLIENT });
}

const pick = (page, id) => page.locator(`[data-decision-pick="${id}"]`);

test.describe('the decision panel in a browser (LIN-3987)', () => {
  test('a suggestion is chosen by keyboard: Enter on the next one marks it and fills the model field', async ({ page }) => {
    await open(page);
    await pick(page, 'sonnet').focus();
    await page.keyboard.press('Enter');
    await expect(pick(page, 'sonnet')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="run-model"]')).toHaveValue('sonnet');

    await pick(page, 'opus').focus();
    await page.keyboard.press('Space');
    await expect(pick(page, 'opus')).toHaveAttribute('aria-pressed', 'true');
    await expect(pick(page, 'sonnet')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-testid="run-model"]')).toHaveValue('opus');
  });

  test('typing a listed model marks its suggestion as it is typed, and an unlisted one marks none', async ({ page }) => {
    await open(page);
    const model = page.locator('[data-testid="run-model"]');
    await model.fill('fable');
    await expect(pick(page, 'fable')).toHaveAttribute('aria-pressed', 'true');
    await model.fill('something-unlisted');
    await expect(page.locator('[data-decision-pick][aria-pressed="true"]')).toHaveCount(0);
  });

  test('with opencode in force the Effort row is hidden and one line says effort does not apply', async ({ page }) => {
    await open(page);
    const effortNote = page.locator('.decision-panel-note[data-decision-harness="opencode"]');
    await expect(effortNote).toBeHidden();
    await expect(page.locator('[data-decision-effort]')).toBeVisible();
    await page.locator('[data-testid="run-harness"]').selectOption('opencode');
    await expect(page.locator('[data-decision-effort]')).toBeHidden();
    await expect(effortNote).toBeVisible();
    await expect(effortNote).toHaveText('Effort does not apply: opencode through OpenRouter takes none.');
  });

  test('the reasons are the content face and the prices the structural face, on any page that hosts the panel', async ({ page }) => {
    await open(page);
    const reason = page.locator('.decision-panel-reason').first();
    const price = page.locator('.decision-panel-price').first();
    expect(await reason.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Inter/);
    expect(await price.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains Mono/);
  });

  test('on a desktop the panel is 32rem wide at most, and a phone gives it the whole sheet', async ({ page }) => {
    await open(page, { width: 1280, height: 900 });
    const panel = page.locator('[data-decision-panel]');
    const desktop = await panel.evaluate((el) => el.getBoundingClientRect().width);
    expect(desktop).toBeLessThanOrEqual(32 * 16 + 1);
    await open(page, { width: 390, height: 844 });
    const phone = await page.locator('[data-decision-panel]').evaluate((el) => el.getBoundingClientRect().width);
    expect(phone).toBeGreaterThan(300);
  });

  test('at 390×844 with Claude Code in force, Use for this run is inside the sheet\'s first screen', async ({ page }) => {
    await open(page, { width: 390, height: 844 });
    const use = await page.locator('[data-testid="run-use"]').boundingBox();
    expect(use.y + use.height).toBeLessThanOrEqual(844);
  });

  test('a Claude Code rate is named once as comparison, and a subscription note is written with it', async ({ page }) => {
    await open(page);
    await expect(page.locator('.decision-panel-note[data-decision-harness="claude-code"]')).toHaveText(
      'Per 1M tokens, for comparison. Each alias uses the model its runs reported, else the newest it names. A subscription may cover the cost.'
    );
    // Both harnesses' rows are in the markup; the four Claude Code rows are the ones shown.
    await expect(page.locator('li.decision-panel-suggestion:not([hidden]) .decision-panel-price')).toHaveCount(4);
    await expect(page.getByText('price unknown')).toHaveCount(0);
  });
});
