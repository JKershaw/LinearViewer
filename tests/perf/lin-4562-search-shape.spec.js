import { test, expect } from '../fixtures/test-base.js';
import { seedShapedWorkspace } from '../fixtures/local-harness.js';
import { SELECTORS } from '../helpers.js';

// LIN-4562 (LIN-4342 piece 1), the search witness on a workspace of the real one's shape: 3,000 tasks over 30 projects,
// about 60% done, a few questions open (tests/fixtures/local-harness.js seedShapedWorkspace). From a page in the frame,
// search finds a done task and a task in another project, and the search page answers inside Home's own render budget:
// its median response is no slower than Home's on the same workspace (with a small allowance for timer noise).
//
// Run on its own, not in the E2E pool, for the reason tests/perf/lin-4024-home-shape.spec.js gives: a render over a few
// thousand tasks is synchronous work on the one server every spec shares. `npm run test:home-shape` runs this folder.

const TASKS = 3000;
const PROJECTS = 30;
const SAMPLES = 5;

test.setTimeout(180000);

/** Median wall time of `n` GETs of `path`, each expected 200. */
async function medianMs(page, path, n = SAMPLES) {
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    const start = Date.now();
    const res = await page.request.get(path);
    samples.push(Date.now() - start);
    expect(res.status(), path).toBe(200);
  }
  return samples.sort((a, b) => a - b)[Math.floor(n / 2)];
}

test('search on 3,000 tasks finds done work and other projects, inside Home\'s render budget', async ({ page, localWorkerUrlKey }) => {
  const { urlKey } = await seedShapedWorkspace(page, { urlKey: localWorkerUrlKey, tasks: TASKS, projects: PROJECTS, questions: 3, runnerKey: true });

  // From a page on the frame, through the rail's search field.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workspace/${urlKey}/proxy`);
  await page.locator(SELECTORS.nav.railSearch).fill('Finished item 42');
  await page.locator(SELECTORS.nav.railSearch).press('Enter');
  await expect(page.locator(SELECTORS.search.resultFor('SHAPE-42'))).toHaveAttribute('data-done', 'true');

  // A task in another project: 2961 is in Project 21 (2961 % 30), and open.
  await page.goto(`/workspace/${urlKey}/search?q=${encodeURIComponent('Open task 2961')}`);
  await expect(page.locator(SELECTORS.search.result)).toHaveCount(1);
  await expect(page.locator(SELECTORS.search.resultFor('SHAPE-2961'))).toContainText('Project 21');

  // Warm both paths once, then time them on the same server and the same workspace.
  await page.request.get(`/workspace/${urlKey}/`);
  await page.request.get(`/workspace/${urlKey}/search?q=task`);
  const home = await medianMs(page, `/workspace/${urlKey}/`);
  const search = await medianMs(page, `/workspace/${urlKey}/search?q=task`);
  console.log(`LIN-4562 measure: ${TASKS} tasks, median over ${SAMPLES}: home ${home} ms, search ("task", every open and done task matches) ${search} ms`);
  expect(search, `search ${search} ms against Home ${home} ms`).toBeLessThanOrEqual(Math.ceil(home * 1.2) + 25);
});
