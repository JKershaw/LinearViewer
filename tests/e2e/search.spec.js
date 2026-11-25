import { test, expect } from '../fixtures/test-base.js';
import { searchLocalSeed } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';

// LIN-4563 (LIN-4342 piece 2): the search, rewritten for the rail. Home's and Backlog's in-page search panel (the
// `search` toggle, `#search-input`, the "/" shortcut, the client-side row filter) is retired; the rail's search field,
// on every page in the frame, goes to the server-rendered search page `/workspace/:urlKey/search?q=` (LIN-4562), which
// lists matching tasks across the workspace, open first and then done. The old spec's intents are kept, each against
// that page: matching by title, case, assignee and label; a folded child task is found; nothing found says so; and the
// search is reached from Home and from Backlog.
//
// The seed is the bespoke `searchLocalSeed` (tests/fixtures/local-harness.js): proj-alpha holds TEST-1 "Parent task in
// progress" (Alice, feature) with its child TEST-2 "Child task todo" and the done TEST-3 "Completed task" (Bob, bug);
// proj-beta holds TEST-4 "Beta task in progress" (Charlie, urgent) and TEST-5 "Beta todo task".

const ids = async (page) => page.locator(SELECTORS.search.result).evaluateAll(rows => rows.map(r => r.dataset.identifier));

/** Search from the rail's field on the page in front of the reader, and land on the search page. */
async function railSearch(page, urlKey, q) {
  await page.locator(SELECTORS.nav.railSearch).fill(q);
  await page.locator(SELECTORS.nav.railSearch).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/search\\?q=`));
}

test.describe('Search (the rail\'s search page)', () => {
  let urlKey;

  test.beforeEach(async ({ page, seedLocal }) => {
    ({ urlKey } = await seedLocal(searchLocalSeed));
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('Home and Backlog carry the rail\'s search field and no in-page search panel', async ({ page }) => {
    for (const path of ['/', '/backlog']) {
      await page.goto(`/workspace/${urlKey}${path}`);
      await expect(page.locator(SELECTORS.nav.railSearch)).toBeVisible();
      await expect(page.locator('.search-toggle')).toHaveCount(0);
      await expect(page.locator('#search-panel')).toHaveCount(0);
      await expect(page.locator('[data-lazy-results]')).toHaveCount(0);
      // The retired "/" shortcut opens nothing: the page does not move.
      await page.keyboard.press('/');
      await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}${path === '/' ? '/$' : '/backlog$'}`));
    }
  });

  test('from Home: a title keyword finds its tasks across projects, and each links to its task page', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/`);
    await railSearch(page, urlKey, 'Beta');
    expect(await ids(page)).toEqual(['TEST-4', 'TEST-5']);
    await expect(page.locator('h1')).toHaveText('Search');
    // The field keeps what was searched.
    await expect(page.locator(SELECTORS.search.input)).toHaveValue('Beta');
    await expect(page.locator(SELECTORS.nav.railSearch)).toHaveValue('Beta');
    await page.locator(SELECTORS.search.resultFor('TEST-4')).locator('[data-testid="search-result-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/task/TEST-4`));
    await expect(page.locator('h1')).toHaveText('Beta task in progress');
  });

  test('from Backlog: the search is the same page', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/backlog`);
    await railSearch(page, urlKey, 'Beta');
    expect(await ids(page)).toEqual(['TEST-4', 'TEST-5']);
  });

  test('search is case-insensitive', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/search?q=beta+TASK+IN`);
    expect(await ids(page)).toEqual(['TEST-4']);
  });

  test('search matches the assignee\'s name', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/search?q=charlie`);
    expect(await ids(page)).toEqual(['TEST-4']);
  });

  test('search matches a label\'s name', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/search?q=urgent`);
    expect(await ids(page)).toEqual(['TEST-4']);
  });

  test('a child task folded under its parent on Home is found, as a row of its own', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/search?q=${encodeURIComponent('Child task')}`);
    expect(await ids(page)).toEqual(['TEST-2']);
    await expect(page.locator(SELECTORS.search.resultFor('TEST-2'))).toContainText('Alpha');
  });

  test('done work is found too, after the open matches', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/search?q=task`);
    const found = await ids(page);
    expect(found[found.length - 1]).toBe('TEST-3');
    await expect(page.locator(SELECTORS.search.resultFor('TEST-3'))).toHaveAttribute('data-done', 'true');
  });

  test('a search that matches nothing says so, and lists nothing', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/`);
    await railSearch(page, urlKey, 'xyznonexistent123');
    await expect(page.locator(SELECTORS.search.result)).toHaveCount(0);
    await expect(page.locator('.page-header__subtitle')).toHaveText('Nothing matches “xyznonexistent123”.');
  });
});
