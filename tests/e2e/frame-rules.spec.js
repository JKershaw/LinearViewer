import { test, expect } from '../fixtures/test-base.js';
import { seedShapedWorkspace } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';
import { placeFor, litPlaceFor, railFor } from '../../lib/places.js';
import { FEATURE_DEFAULTS } from '../../lib/feature-defaults.js';

/**
 * LIN-4562 (LIN-4342 piece 1): the walk. The rules every page in the frame keeps (docs/reviews/navigation-2026-11-07/
 * README.md, "What every page should do"), checked in a browser on every page already on the frame, for the owner with
 * a runner and a new user without one, at 1280 and 390:
 *   one h1, and the tab title starts with it; the h1's left edge and size are the same on every page; exactly one rail
 *   item is marked, and it is the one lib/places.js says; the footer's text is identical everywhere; no sideways scroll
 *   at 390; the rail's items are what the registry admits for this person; the first Tab stop is the skip link and it
 *   lands in <main>; every rail item is reachable by keyboard with a visible outline; the drawer opens, Escape closes it
 *   and returns focus to ☰; nothing in the rail or band is smaller than on desktop.
 *
 * The page list is generated from the registry (lib/places.js) and limited to the pages already on the frame. Later
 * pieces only widen FRAMED (and add PUBLIC_PATHS, piece 6). The workspace is the shaped seed (tests/fixtures/
 * local-harness.js shapedLocalSeed) at 300 tasks: the walk checks the frame, which does not depend on the count, and a
 * 3,000-task render beside the timing-sensitive specs flakes them (tests/perf/lin-4024-home-shape.spec.js says why).
 * The 3,000-task search budget is tests/perf/lin-4562-search-shape.spec.js.
 */

/**
 * The pages on the frame, by place key. `path` replaces the registry path (a drilled-in page's route has a parameter);
 * `query` is appended; `name` is the page's name when it is not the registry label (a task page's name is its title).
 * LIN-4563 (piece 2) adds Home, Backlog and the task family: a task, its edit page, a new task, and a task not found.
 */
const FRAMED = [
  { key: 'connect' },
  { key: 'search', query: '?q=Finished+item+42' },
  { key: 'home' },
  { key: 'backlog' },
  { key: 'task', path: '/task/SHAPE-261', name: 'Open task 261' },
  { key: 'task-edit', path: '/task/SHAPE-261/edit', name: 'Edit SHAPE-261' },
  { key: 'task-new' },
  { key: 'task', path: '/task/NOPE-404', name: 'Task not found', notFound: true },
];

const VIEWERS = [
  // The seeded session account is the workspace owner; a runner key gives it run controls (lib/run-controls.js).
  { name: 'owner', runnerKey: true, flags: { ...FEATURE_DEFAULTS, runControls: true, liveConsole: true } },
  { name: 'new user', runnerKey: false, flags: { ...FEATURE_DEFAULTS, runControls: false, runSetup: true } },
];

const WIDTHS = [1280, 390];

const urlOf = (urlKey, { key, path, query = '' }) => `/workspace/${urlKey}${path || placeFor(key).path}${query}`;

/** Reads what the rules need off the page in one pass. */
async function readFrame(page) {
  return page.evaluate(() => {
    const h1s = [...document.querySelectorAll('h1')];
    const h1 = h1s[0];
    const rect = h1 ? h1.getBoundingClientRect() : null;
    const marked = [...document.querySelectorAll('[data-testid="frame-rail"] .frame-rail__item[aria-current]')];
    return {
      h1Count: h1s.length,
      h1Text: h1 ? h1.textContent.trim() : null,
      h1Left: rect ? Math.round(rect.left) : null,
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      title: document.title,
      marked: marked.map(el => el.dataset.place),
      items: [...document.querySelectorAll('[data-testid="frame-rail"] .frame-rail__item')].map(el => el.dataset.place),
      footer: document.querySelector('[data-testid="frame-footer"]')?.textContent.replace(/\s+/g, ' ').trim(),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

/** The data-place (or test id) of the focused element, and whether its outline shows. */
async function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const style = el ? getComputedStyle(el) : null;
    return {
      id: el?.id || null,
      testid: el?.getAttribute('data-testid') || null,
      place: el?.dataset?.place || null,
      outline: style ? style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 : false,
    };
  });
}

/** Tab until every rail item has been focused once (or give up), checking each shows a focus outline. */
async function tabThroughRail(page, expected) {
  const seen = new Map();
  for (let i = 0; i < 80 && seen.size < expected.length; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f.place && f.testid?.startsWith('rail-place-')) seen.set(f.place, f.outline);
  }
  return seen;
}

for (const viewer of VIEWERS) {
  test.describe(`the frame rules, ${viewer.name}`, () => {
    let urlKey;
    const expectedItems = railFor(viewer.flags).flatMap(g => g.places.map(p => p.key));

    test.beforeEach(async ({ page, localWorkerUrlKey }) => {
      ({ urlKey } = await seedShapedWorkspace(page, { urlKey: localWorkerUrlKey, tasks: 300, projects: 30, questions: 3, runnerKey: viewer.runnerKey }));
    });

    for (const width of WIDTHS) {
      test(`at ${width}px: every framed page keeps the rules`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const footers = new Set();
        const edges = new Set();
        const sizes = new Set();
        for (const entry of FRAMED) {
          const response = await page.goto(urlOf(urlKey, entry));
          expect(response.status(), `${entry.key}: the page renders`).toBe(entry.notFound ? 404 : 200);
          await page.waitForLoadState('networkidle');
          const f = await readFrame(page);
          const name = entry.name || placeFor(entry.key).label;

          expect(f.h1Count, `${entry.key}: one h1`).toBe(1);
          expect(f.h1Text).toBe(name);
          expect(f.title.startsWith(f.h1Text), `${entry.key}: the tab "${f.title}" starts with the h1`).toBe(true);
          expect(f.marked, `${entry.key}: one marked item`).toEqual([litPlaceFor(entry.key, { flags: viewer.flags }).key]);
          expect(f.items, `${entry.key}: the rail is what lib/places.js admits for ${viewer.name}`).toEqual(expectedItems);
          expect(f.scrollWidth, `${entry.key}: no sideways scroll`).toBeLessThanOrEqual(f.innerWidth);
          footers.add(f.footer);
          edges.add(f.h1Left);
          sizes.add(f.h1Size);

          // A page whose job is typing (task edit, new task: LIN-1565's autofocus) opens with the keyboard already in a
          // field in <main>, past the rail, which is what the skip link is for; the walk checks that instead.
          const autofocused = await page.evaluate(() => {
            const el = document.activeElement;
            return !!el && el.hasAttribute('autofocus') && el !== document.getElementById('main') && !!document.getElementById('main')?.contains(el);
          });
          if (autofocused) continue;
          // The first Tab stop is the skip link, and it lands in <main>.
          await page.keyboard.press('Tab');
          expect((await focused(page)).testid).toBe('frame-skip');
          await expect(page.locator(SELECTORS.nav.skip)).toBeVisible();
          await page.keyboard.press('Enter');
          await expect.poll(async () => (await focused(page)).id).toBe('main');
        }
        expect(footers.size, 'the footer is the same on every page').toBe(1);
        expect(edges.size, `one left edge: ${[...edges]}`).toBe(1);
        expect(sizes.size, `one heading size: ${[...sizes]}`).toBe(1);
      });
    }

    test('at 1280px: every rail item is reachable by keyboard with a visible outline, and the band is not drawn', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(urlOf(urlKey, FRAMED[0]));
      await page.waitForLoadState('networkidle');
      await expect(page.locator(SELECTORS.nav.band)).toBeHidden();
      await expect(page.locator(SELECTORS.nav.rail)).toBeVisible();
      const seen = await tabThroughRail(page, expectedItems);
      expect([...seen.keys()].sort()).toEqual([...expectedItems].sort());
      for (const [place, outline] of seen) expect(outline, `${place} shows its focus`).toBe(true);
    });

    test('at 390px: the rail is a drawer; it takes focus, Escape returns it to ☰; nothing is smaller than on desktop', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(urlOf(urlKey, FRAMED[0]));
      const desktopSize = await page.locator(SELECTORS.nav.railItems).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(urlOf(urlKey, FRAMED[0]));
      await page.waitForLoadState('networkidle');
      await expect(page.locator(SELECTORS.nav.band)).toBeVisible();
      await expect(page.locator(SELECTORS.nav.bandName)).toHaveText(placeFor(FRAMED[0].key).label);
      await expect(page.locator(SELECTORS.nav.rail)).toBeHidden();

      // Skip link, then ☰: open it from the keyboard.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect((await focused(page)).testid).toBe('frame-band-menu');
      await page.keyboard.press('Enter');
      await expect(page.locator(SELECTORS.nav.rail)).toBeVisible();
      await expect(page.locator(SELECTORS.nav.bandMenu)).toHaveAttribute('aria-expanded', 'true');
      expect(await page.evaluate(() => document.getElementById('frame-rail').contains(document.activeElement)), 'focus moved into the drawer').toBe(true);

      const phoneSizes = await page.locator(`${SELECTORS.nav.railItems}, ${SELECTORS.nav.bandName}`).evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
      for (const size of phoneSizes) expect(size, 'not smaller than on desktop').toBeGreaterThanOrEqual(desktopSize);

      const seen = await tabThroughRail(page, expectedItems);
      expect([...seen.keys()].sort()).toEqual([...expectedItems].sort());
      for (const [place, outline] of seen) expect(outline, `${place} shows its focus`).toBe(true);

      await page.keyboard.press('Escape');
      await expect(page.locator(SELECTORS.nav.rail)).toBeHidden();
      await expect(page.locator(SELECTORS.nav.bandMenu)).toHaveAttribute('aria-expanded', 'false');
      expect((await focused(page)).testid).toBe('frame-band-menu');

      // The scrim closes it too.
      await page.locator(SELECTORS.nav.bandMenu).click();
      await expect(page.locator(SELECTORS.nav.rail)).toBeVisible();
      await page.locator(SELECTORS.nav.scrim).click({ position: { x: 370, y: 400 } });
      await expect(page.locator(SELECTORS.nav.rail)).toBeHidden();
    });

    // LIN-4563: a task page lights the place the person came from, and its one way back goes there (default Home). From Backlog
    // the test follows a link Backlog itself renders (a project's "+ Add task"); a task link has no home on Home's rows until a row
    // opens, so Home's case follows the task page href.
    test('a page opened from Backlog lights Backlog and leads back there; opened from Home it lights Home', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      for (const from of ['backlog', 'home']) {
        await page.goto(urlOf(urlKey, { key: from }));
        let landed;
        if (from === 'backlog') {
          // A real link the Backlog page draws: the first project's Add task link, to the new-task page.
          await page.locator('a[href*="/task/new?projectId="]').first().click();
          landed = new RegExp(`/workspace/${urlKey}/task/new\\?projectId=`);
        } else {
          await page.evaluate((href) => {
            const a = document.createElement('a');
            a.href = href;
            a.dataset.testid = 'walk-task-link';
            document.querySelector('#main').append(a);
          }, `/workspace/${urlKey}/task/SHAPE-261`);
          await page.locator('[data-testid="walk-task-link"]').evaluate(a => a.click());
          landed = new RegExp(`/workspace/${urlKey}/task/SHAPE-261$`);
        }
        await expect(page).toHaveURL(landed);
        await expect(page.locator(SELECTORS.nav.railMarked)).toHaveAttribute('data-place', from);
        await expect(page.locator(SELECTORS.nav.back)).toHaveText(from === 'backlog' ? '\u2190 Backlog' : '\u2190 Home');
        await page.locator(SELECTORS.nav.back).click();
        await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}${placeFor(from).path}$`));
      }
    });

    test('search finds a done task and a task in another project, and each links to its task page', async ({ page }) => {
      await page.goto(`/workspace/${urlKey}/`);
      await page.setViewportSize({ width: 1280, height: 900 });
      // From any page: the rail's search field.
      await page.goto(urlOf(urlKey, FRAMED[0]));
      await page.locator(SELECTORS.nav.railSearch).fill('Finished item 42');
      await page.locator(SELECTORS.nav.railSearch).press('Enter');
      await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/search\\?q=Finished\\+item\\+42$`));
      const done = page.locator(SELECTORS.search.resultFor('SHAPE-42'));
      await expect(done).toHaveAttribute('data-done', 'true');
      // The task page link, with the row's provenance (lib/task-page-href.js) when it has one.
      await expect(done.locator('[data-testid="search-result-link"]')).toHaveAttribute('href', new RegExp(`^/workspace/${urlKey}/task/SHAPE-42(\\?source=local)?$`));

      await page.goto(`/workspace/${urlKey}/search?q=${encodeURIComponent('Open task 261')}`);
      await expect(page.locator(SELECTORS.search.result)).toHaveCount(1);
      await expect(page.locator(SELECTORS.search.resultFor('SHAPE-261'))).toContainText('Project 21');
    });

    test('what is waiting: shown to the owner on Home\'s item and in the band, leading to the questions on Home', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(urlOf(urlKey, FRAMED[0]));
      if (!viewer.flags.runControls) {
        await expect(page.locator(SELECTORS.nav.railQuestions)).toHaveCount(0);
        await expect(page.locator(SELECTORS.nav.bandQuestions)).toHaveCount(0);
        return;
      }
      const rail = page.locator(SELECTORS.nav.railQuestions);
      await expect(rail).toHaveText('3 questions');
      await expect(rail).toHaveAttribute('href', `/workspace/${urlKey}/#waiting-on-you`);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(SELECTORS.nav.bandQuestions)).toHaveText('3 questions');
      await page.locator(SELECTORS.nav.bandQuestions).click();
      await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/#waiting-on-you$`));
      await expect(page.locator('#waiting-on-you')).toBeVisible();
    });
  });
}
