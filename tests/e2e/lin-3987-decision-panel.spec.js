import { test, expect } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';
import { testMockData } from '../../lib/sample-data/mock-data.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { SELECTORS } from '../helpers.js';

// LIN-3987: the decision panel on the real pages, not a copy of its markup. Home's run control is seeded through the
// local harness with priced runs, the way the runner reports them (a take, a `[usage]` line, a `[done]`); /styleguide is
// read as it ships. Witnesses: Use for this run is on a 390×844 first screen with Claude Code in force and priced runs
// that report no model; the reasons are the content face and the prices the structural face, on Home and /styleguide;
// the fields stop at 32rem on a desktop; a harness picked on the draft changes what a blank model says, in words; a
// suggestion is chosen by keyboard; every Claude Code suggestion has a rate; each /styleguide sample sits in its frame.

const RC = SELECTORS.runControl;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
// The kinds a Home top task can offer as its next step, so whichever one is in force has priced runs behind it.
const KINDS = ['look-into', 'research', 'plan', 'implementation', 'review'];
const RUNS_PER_KIND = 2;
// Dispatch refuses a second run of one kind on one issue within minutes, so each seeded run takes an issue of its own.
const ISSUES = testMockData.issues.map((issue) => issue.identifier);

/** Home at the workspace's own URL, read to rest. */
async function gotoHome(page, urlKey) {
  await page.goto(`/workspace/${urlKey}/`);
  await page.waitForLoadState('networkidle');
}

/** Open Home's marked top task unless it is already open, and return its opened-task component. */
async function openTopTask(page) {
  const component = page.locator('.prompt-section').first();
  if (!(await component.isVisible())) await page.locator('[data-top-task="1"]').click();
  await expect(component).toBeVisible();
  return component;
}

/** Empty the workspace's dispatch queue, history and runner tokens, so the next spec on this worker starts clean. */
async function resetRuns(page, urlKey) {
  for (const reset of ['clear-dispatch-queue', 'clear-dispatch-history', 'clear-dispatch-tokens']) {
    await page.request.get(`/test/${reset}?urlKey=${urlKey}`);
  }
}

/**
 * Priced runs of each kind, reported the way the runner reports them (the effort read-out spec seeds the same way):
 * created, taken with a runner token, given a `[usage]` line with a cost and no model, then a terminal `[done]`.
 * No run reports a model, so each Claude Code alias reads the rate it maps to, not one its runs reported.
 */
async function seedPricedRuns(page, urlKey) {
  await seedWorkspaceOwnership(page, urlKey, 'owner');
  const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`)).json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let issue = 0;
  for (const kind of KINDS) {
    for (let i = 0; i < RUNS_PER_KIND; i += 1) {
      const create = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
        data: { prompt: 'run control fixture', promptName: kind, kind, issueIdentifier: ISSUES[issue++], issueTitle: 'Run control fixture', target: 'cli' },
      });
      expect(create.status(), await create.text()).toBe(201);
      const itemId = (await create.json()).item.id;
      const take = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: auth });
      expect(take.status()).toBe(200);
      const usage = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
        headers: auth, data: { kind: 'usage', message: `[usage] ${JSON.stringify({ costUsd: 0.63 })}` },
      });
      expect(usage.status()).toBe(200);
      const done = await page.request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message: '[done] complete' } });
      expect(done.status()).toBe(200);
    }
  }
}

/**
 * Home with a seeded workspace, its top task open, and the Change panel open once the panel's numbers have loaded.
 * LIN-4010: the decision panel sits behind "Choose for this run", so the helper opens that too.
 */
async function openChangePanel(page, seedLocal, urlKey) {
  await seedLocal(workspaceApiLocalSeed, { openRouterConnected: true, runnerKey: true });
  await resetRuns(page, urlKey);
  await seedPricedRuns(page, urlKey);
  await gotoHome(page, urlKey);
  const component = await openTopTask(page);
  await component.locator(RC.change).click();
  await expect(component.locator(RC.changePanel)).toBeVisible();
  await component.locator('[data-testid="run-choose"]').click();
  await expect(component.locator('[data-testid="run-choose-panel"]')).toBeVisible();
  await expect(component.locator(RC.numbers)).toBeVisible();
  return component;
}

test.describe('Home run control: the panel on a phone (LIN-3987)', () => {
  // Mobile emulation gives the page a phone's overlay scrollbar; a desktop-style classic scrollbar would take 15px.
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test.afterEach(async ({ page, localWorkerUrlKey }) => resetRuns(page, localWorkerUrlKey));

  test('with Claude Code in force and priced runs that report no model, Use for this run is inside the first screen', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    await expect(component.locator(RC.numbers)).toContainText('priced');
    const use = component.locator(RC.use);
    await expect.poll(() => use.boundingBox()).not.toBeNull();
    const box = await use.boundingBox();
    expect(box.y + box.height, 'the bottom of Use for this run').toBeLessThanOrEqual(PHONE.height);
    // The box is measured against the viewport, so a sheet scrolled to bring Use up would pass that alone: the sheet, and any
    // container inside the page that scrolls it, must sit at the top (the page's own scroll is the document's, not the sheet's).
    const scrolled = await component.locator(RC.changePanel).evaluate((panel) => {
      const tops = [];
      for (let el = panel; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        tops.push({ el: el.getAttribute('data-testid') || el.className || el.tagName, scrollTop: el.scrollTop });
      }
      return tops.filter((t) => t.scrollTop !== 0);
    });
    expect(scrolled, 'the sheet, and the containers around it, are not scrolled').toEqual([]);
  });
});

test.describe('Home run control: the panel on a desktop (LIN-3987)', () => {
  test.use({ viewport: DESKTOP });

  test.afterEach(async ({ page, localWorkerUrlKey }) => resetRuns(page, localWorkerUrlKey));

  test('the reasons are the content face and the prices the structural face, on Home', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    const reason = component.locator(RC.reason).first();
    const price = component.locator(RC.price).first();
    expect(await reason.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Inter/);
    expect(await price.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains Mono/);
  });

  test('the fields are 32rem wide at most on a desktop', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    const maxPx = 32 * 16 + 1;
    expect((await component.locator(RC.model).boundingBox()).width).toBeLessThanOrEqual(maxPx);
    expect((await component.locator(RC.harness).boundingBox()).width).toBeLessThanOrEqual(maxPx);
    expect((await component.locator(RC.panel).boundingBox()).width).toBeLessThanOrEqual(maxPx);
  });

  test('Use is the primary shared button, Reset is a quiet one alone, and a chosen Runs on target is marked, not underlined', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    const classesOf = (locator) => locator.evaluate((el) => [...el.classList]);
    expect(await classesOf(component.locator(RC.use))).toEqual(expect.arrayContaining(['btn', 'btn--primary']));
    expect(await classesOf(component.locator(RC.reset))).toEqual(expect.arrayContaining(['btn--quiet']));
    expect(await classesOf(component.locator(RC.reset))).not.toContain('btn');
    await component.locator(RC.target('web')).click();
    await expect(component.locator(RC.target('web'))).toHaveAttribute('aria-pressed', 'true');
    expect(await component.locator(RC.target('web')).evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
  });

  test('a harness picked on the draft changes what a blank model says, in words, and goes back when it is blank again', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    const willUse = component.locator(RC.willUse);
    await expect(willUse).toContainText("Claude Code's own model");

    await component.locator(RC.harness).selectOption('opencode');
    await expect(willUse).toContainText("opencode's default model");
    await expect(willUse).not.toContainText("Claude Code's own model");
    await expect(component.locator(RC.effortRow)).toBeHidden();
    await expect(component.locator('.decision-panel-note[data-decision-harness="opencode"]')).toHaveText('Effort does not apply: opencode through OpenRouter takes none.');

    await component.locator(RC.harness).selectOption('');
    await expect(willUse).toContainText("Claude Code's own model");
    await expect(willUse).not.toContainText("opencode's default model");
  });

  test('a suggestion is chosen by keyboard on Home, and the one chosen is marked', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    await component.locator(RC.suggestion('sonnet')).focus();
    await page.keyboard.press('Enter');
    await expect(component.locator(RC.suggestion('sonnet'))).toHaveAttribute('aria-pressed', 'true');
    await expect(component.locator(RC.model)).toHaveValue('sonnet');

    await component.locator(RC.suggestion('opus')).focus();
    await page.keyboard.press('Space');
    await expect(component.locator(RC.suggestion('opus'))).toHaveAttribute('aria-pressed', 'true');
    await expect(component.locator(RC.suggestion('sonnet'))).toHaveAttribute('aria-pressed', 'false');
    await expect(component.locator(RC.model)).toHaveValue('opus');
  });

  test('with priced runs, every Claude Code suggestion shows a rate and no row says price unknown', async ({ page, seedLocal, localWorkerUrlKey }) => {
    const component = await openChangePanel(page, seedLocal, localWorkerUrlKey);
    await expect(component.locator('li.decision-panel-suggestion:not([hidden]) .decision-panel-price')).toHaveCount(4);
    await expect(component.getByText('price unknown')).toHaveCount(0);
    await expect(component.locator('.decision-panel-note[data-decision-harness="claude-code"]')).toContainText('A Claude Code subscription may cover the cost.');
  });
});

test.describe('/styleguide: the decision samples (LIN-3987)', () => {
  for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    test.describe(`at ${name} width`, () => {
      test.use({ viewport });

      test('each sample sits in its own frame, and its panel is the content face', async ({ page }) => {
        await page.goto('/styleguide');
        for (const sample of ['models', 'home']) {
          const frame = page.locator(RC.sampleFrame).filter({ has: page.locator(RC.sample(sample)) });
          await expect(frame).toHaveCount(1);
          expect(await frame.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
          // The panel sets the content face on its own root, so its reasons (and labels) are sans on any page that hosts it.
          expect(await page.locator(RC.sample(sample)).evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Inter/);
        }
        // Only Models' sample carries suggestions, so only it has reasons to read.
        expect(await page.locator(RC.sample('models')).locator(RC.reason).first().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Inter/);
      });

      test('Home\'s sample keeps its harness and model hints inside its frame', async ({ page }) => {
        await page.goto('/styleguide');
        const frame = page.locator(RC.sampleFrame).filter({ has: page.locator(RC.sample('home')) });
        const frameBox = await frame.boundingBox();
        const hints = page.locator(RC.sample('home')).locator('.decision-panel-hint:visible');
        const count = await hints.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i += 1) {
          const box = await hints.nth(i).boundingBox();
          expect(box.x + box.width, `hint ${i} is inside its frame`).toBeLessThanOrEqual(frameBox.x + frameBox.width);
        }
      });
    });
  }
});
