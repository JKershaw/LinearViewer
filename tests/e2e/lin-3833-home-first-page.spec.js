import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

// LIN-3833: Home's first page. The opened task leads with its state and has one run control; a viewer with no
// runner gets the copy-first view, and the first-visit card is dismissed for good. Three witnesses the review
// found missing: the card stays dismissed across a reload, the layout fits a phone (390px) without horizontal
// scrolling in both themes and both viewer modes, and the Change panel is a full-screen sheet on a phone.

const PHONE = { width: 390, height: 844 };

/** Light is the default; dark is the opt-in `.theme-dark` hook on <html> (see CLAUDE.md, Design Principles). */
async function setTheme(page, theme) {
  await page.evaluate((dark) => document.documentElement.classList.toggle('theme-dark', dark), theme === 'dark');
}

/** Horizontal overflow of the page in CSS pixels: 0 or less means the page fits the viewport. */
function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Open Home's marked top task (its row) unless it is already open, and return its opened-task component. */
async function openTopTask(page) {
  const component = page.locator('.prompt-section').first();
  if (!(await component.isVisible())) await page.locator('[data-top-task="1"]').click();
  await expect(component).toBeVisible();
  return component;
}

async function gotoHome(page, urlKey) {
  await page.goto(`/workspace/${urlKey}/`);
  await page.waitForLoadState('networkidle');
}

test.describe('Home first page — the copy-first card (LIN-3833)', () => {
  test('"Got it" is the shared Button piece, and the card stays dismissed after a reload', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed);
    await gotoHome(page, localWorkerUrlKey);

    const card = page.locator('[data-testid="home-copy-first-card"]');
    const dismiss = page.locator('[data-testid="home-copy-first-dismiss"]');
    await expect(card).toBeVisible();
    await expect(dismiss).toHaveClass(/\bbtn\b/);
    await expect(dismiss).toHaveText('Got it');

    await dismiss.click();
    await expect(card).toHaveCount(0);

    await gotoHome(page, localWorkerUrlKey);
    await expect(page.locator('[data-top-task="1"]')).toHaveCount(1);
    await expect(card).toHaveCount(0);
  });
});

test.describe('Home first page — the layout holds on a phone (LIN-3833)', () => {
  // Mobile emulation gives the page a phone's overlay scrollbar; a desktop-style classic scrollbar would take 15px.
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  for (const theme of ['light', 'dark']) {
    test(`copy-first view, ${theme}: no horizontal scrolling at 390px`, async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed);
      await gotoHome(page, localWorkerUrlKey);
      await setTheme(page, theme);
      await openTopTask(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`run control, ${theme}: no horizontal scrolling at 390px`, async ({ page, seedLocal, localWorkerUrlKey }) => {
      await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, runnerKey: true });
      await gotoHome(page, localWorkerUrlKey);
      await setTheme(page, theme);
      const component = await openTopTask(page);
      await expect(component.locator('[data-testid="opened-task-runs-on"]')).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('Home first page — the Change panel is a full-screen sheet on a phone (LIN-3833)', () => {
  // Mobile emulation gives the page a phone's overlay scrollbar; a desktop-style classic scrollbar would take 15px.
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('Change covers the phone screen and closes from its × control', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, runnerKey: true });
    await gotoHome(page, localWorkerUrlKey);

    const component = await openTopTask(page);
    await component.locator('[data-testid="run-change"]').click();
    const panel = component.locator('[data-testid="run-change-panel"]');
    await expect(panel).toBeVisible();

    // The sheet fills the page's client area. Headless Chromium draws a classic scrollbar, which a phone does not, so
    // the client area (not the window) is the screen the sheet must cover.
    // LIN-3969: the run block repaints when the presets read (and the preview) land, which replaces the panel's
    // node; a box read from the node being replaced is null. Poll until a read lands on the painted panel.
    const screen = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    await expect.poll(() => panel.boundingBox()).toEqual({ x: 0, y: 0, width: screen.width, height: screen.height });

    await component.locator('[data-testid="run-change-x"]').click();
    await expect(panel).toHaveCount(0);
  });
});

// LIN-3833 (witness: "dispatches once from each source … and shows that the stamped row matches what the control
// showed"). A run from the default, a preset, and a choice for this run: the control's "Runs on" model is the one
// the queued row carries, and the row is read back from the store (`/test/dispatch-item`, which returns `row`).
test.describe('Home first page — a run from each source stamps the row the control showed (LIN-3833)', () => {
  test('default, preset and chosen for this run', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, runnerKey: true });
    const key = localWorkerUrlKey;
    // LIN-3969: presets live in the shared store and outlast the attempt that made them, so a retry (or any
    // second run on this worker's urlKey) saw two, then three "Careful" buttons. Start with none.
    await page.request.get(`/test/clear-dispatch-presets?urlKey=${key}`);
    const preset = await page.request.post(`/workspace/${key}/api/dispatch/presets`, { data: { name: 'Careful', model: 'preset-model-careful' } });
    expect(preset.ok()).toBe(true);

    await gotoHome(page, key);
    let component = await openTopTask(page);

    // Presses one run from the control as it stands, reads the row back, then undoes it so the next source can run.
    const runFrom = async (source, shows) => {
      component = page.locator('.prompt-section').first();
      // The control shows what this source will run on once its choice has been read back.
      await expect(component.locator('[data-testid="run-on-what"]')).toHaveText(shows);
      const control = shows;
      const [created] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/workspace/${key}/api/dispatch`) && !r.url().includes('/presets')),
        component.locator('[data-testid="opened-task-go"]').first().click()
      ]);
      const { item } = await created.json();
      const stamped = await (await page.request.get(`/test/dispatch-item?urlKey=${key}&itemId=${encodeURIComponent(item._id || item.id)}`)).json();
      expect(stamped.row, `${source}: the queued row is stamped`).toBeTruthy();
      expect(control, `${source}: the control shows the model the row carries`).toBe(stamped.row.model || 'the default model');
      // Undo, then reload: the queued session stays in the page's state until the next poll, so the page is
      // re-read from the server before the next source sets its own choice and presses.
      await component.locator('[data-testid="run-undo"]').click();
      await gotoHome(page, key);
      await openTopTask(page);
      return stamped.row;
    };

    const defaultRow = await runFrom('default', 'the default model');
    expect(defaultRow.model).toBeNull();

    await component.locator('[data-testid="run-change"]').click();
    await component.locator('[data-testid="run-preset"]', { hasText: 'Careful' }).click();
    await component.locator('[data-testid="run-use"]').click();
    const presetRow = await runFrom('preset', 'preset-model-careful');
    expect(presetRow.model).toBe('preset-model-careful');

    await component.locator('[data-testid="run-change"]').click();
    await component.locator('[data-testid="run-reset"]').click();
    await component.locator('[data-testid="run-model"]').fill('chosen-model-x');
    await component.locator('[data-testid="run-use"]').click();
    const chosenRow = await runFrom('chosen', 'chosen-model-x');
    expect(chosenRow.model).toBe('chosen-model-x');
  });
});

// LIN-3969: a preview answer repaints the run block. One that landed while the model was being typed replaced the
// Model input, so the rest of the typing was lost and the run went out on a cut-off model ("chose"). The reset's
// preview is held until the typing is under way, so the repaint lands mid-word on every run.
test.describe('Home first page — the Change panel keeps what is typed across a repaint (LIN-3969)', () => {
  test('a preview landing mid-typing does not cut the chosen model short', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, runnerKey: true });
    await gotoHome(page, localWorkerUrlKey);
    const component = await openTopTask(page);
    await expect(component.locator('[data-testid="run-on-what"]')).toHaveText('the default model');
    await component.locator('[data-testid="run-change"]').click();
    await expect(component.locator('[data-testid="run-change-panel"]')).toBeVisible();
    await page.waitForLoadState('networkidle');

    let hold = true;
    await page.route('**/api/dispatch/preview**', async (route) => {
      if (hold) { hold = false; await new Promise((resolve) => setTimeout(resolve, 300)); }
      await route.continue();
    });
    await component.locator('[data-testid="run-reset"]').click();
    await component.locator('[data-testid="run-model"]').pressSequentially('chosen-model-x', { delay: 60 });
    await component.locator('[data-testid="run-use"]').click();
    await expect(component.locator('[data-testid="run-on-what"]')).toHaveText('chosen-model-x');
  });
});

// LIN-3833 (ruling f9fa6bd7, option c: leave out only finished tasks and retro). A fresh top task is not finished,
// so only the AI-excluded step (retro) does not fit: the list says one step is left out. The step line's ✦ button
// writes the prompt; it does not replace the why line.
test.describe('Home first page — "Another step" fits the task (LIN-3833)', () => {
  test('the four default steps are listed in order, the excluded step is left out and counted, and the button writes a prompt', async ({ page, seedLocal, localWorkerUrlKey }) => {
    await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, runnerKey: true });
    // Workers share one workspace, so earlier runs' sessions would move the task's next-stage rule. Start with none.
    for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-agent-status']) {
      await page.request.get(`/test/${reset}?urlKey=${localWorkerUrlKey}`);
    }
    await gotoHome(page, localWorkerUrlKey);

    const component = await openTopTask(page);
    await expect(component.locator('[data-testid="run-ask-harbour"]')).toHaveText('✦ write prompt');
    await component.locator('[data-testid="run-another"]').click();

    const items = component.locator('[data-testid="run-another-list"] [data-testid="run-another-item"]');
    await expect(items.nth(3)).toBeVisible();
    const labels = await items.allInnerTexts();
    expect(labels.slice(0, 4)).toEqual(['look into', 'research', 'plan', 'implement']);
    await expect(component.locator('[data-testid="run-another-left-out"]')).toHaveText("1 step left out: it does not fit this task's state.");
  });
});
