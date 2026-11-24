import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { seedOwnerFindings } from '../fixtures/question-records.js';
import { SELECTORS, expectNoClippedOverflow } from '../helpers.js';

// LIN-4554 (LIN-4546 piece 6/7): the task page's record-writing tools sit in closed folds. The owner opens a record's fold, ends it
// with an end the page offers and sees the line say so in plain words; a member who can act finds the same folds; a signed-out
// reader of a share link gets no Records section, no fold and no form. At a phone's width nothing scrolls sideways.

const PHONE = { width: 390, height: 844 };
const TICKET = 'LOCAL-REC1';
const R = SELECTORS.taskRecords;
let URL_KEY;

test.use({ viewport: PHONE });

test.beforeEach(async ({ page, localWorkerUrlKey }) => {
  URL_KEY = localWorkerUrlKey;
  await page.goto('/test/clear-local-store');
  await page.goto(`/test/clear-task-shares?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-queue?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${URL_KEY}`);
  await page.goto(`/test/clear-ticket-records?urlKey=${URL_KEY}`);
});

/** A local workspace this session owns (append: a fresh workspace id, so its first edge is the owner's), with one task. */
async function seedTask(page) {
  const id = (raw) => localSeedId(URL_KEY, raw);
  const resp = await page.request.post('/test/set-local-session', {
    data: {
      urlKey: URL_KEY,
      append: true,
      projects: [{ id: id('rec-proj'), name: 'Records project', content: 'A project', sortOrder: 1 }],
      issues: [{
        id: id('rec-task'), identifier: TICKET, title: 'A task with records', description: 'Seeded for records',
        projectId: id('rec-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
        url: `/workspace/${URL_KEY}/issue/${id('rec-task')}`,
      }],
    },
  });
  expect(resp.ok(), `local seed failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

test.describe('LIN-4554: the task page\'s record tools, folded', () => {
  test('the owner opens a record\'s fold, ends it as done, and the line says so in plain words', async ({ page }) => {
    await seedTask(page);
    const [finding] = await seedOwnerFindings(page, URL_KEY, { tasks: [{ ticket: TICKET, title: 'A task with records' }], findings: 2 });
    await page.goto(`/workspace/${URL_KEY}/task/${TICKET}`);

    const line = page.locator(R.byId(finding));
    await expect(line).toBeVisible();
    await expect(line.locator(R.state)).toHaveText('open');
    await expect(line.locator(R.time)).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);
    // The tools are folded away: the add fold and the record's fold are closed, their forms not shown.
    const addTools = page.locator(R.addTools);
    await expect(addTools).toHaveCount(1);
    await expect(addTools).not.toHaveAttribute('open', '');
    const tools = line.locator(R.recordTools);
    await expect(tools).not.toHaveAttribute('open', '');
    await expect(line.locator(R.endReason)).toBeHidden();
    // Ends offered are the finding's own, in plain words, and what takes over is picked by its words, never typed as an id.
    await tools.locator('summary').click();
    await expect(line.locator(R.endReason)).toBeVisible();
    const offered = await line.locator(`${R.endState} option`).evaluateAll((os) => os.map((o) => o.value));
    expect(offered).toEqual(['done', 'declined', 'handed-on']);
    const takeLabels = await line.locator(`${R.endInto} option`).evaluateAll((os) => os.map((o) => o.textContent));
    // Each choice is "nothing" or the record's kind and its own words (which may quote anything its writer wrote), never a bare id.
    for (const label of takeLabels) {
      expect(label).toMatch(/^(nothing|[a-z ]+: .+)$/);
      expect(label).not.toMatch(/^[a-z]+-[0-9a-f]{8}$/);
    }
    const takeValues = await line.locator(`${R.endInto} option`).evaluateAll((os) => os.map((o) => o.value));
    expect(takeValues.slice(1).every((v) => /^finding-[0-9a-f]{8}$/.test(v)), 'the id the pipeline needs rides in the value').toBe(true);
    await expectNoClippedOverflow(page);

    await line.locator(R.endState).selectOption('done');
    await line.locator(R.endReason).fill('fixed on the page');
    await line.locator(R.endSubmit).click();

    await expect(page).toHaveURL(new RegExp(`/task/${TICKET}#task-records$`));
    const ended = page.locator(R.byId(finding));
    await expect(ended.locator(R.state)).toHaveText('done — fixed on the page');
    await expect(ended.locator(R.recordTools)).toHaveCount(0);
    await expect(page.locator(R.refused)).toHaveCount(0);
  });

  test('a member who can act finds the same closed folds', async ({ page }) => {
    await seedTask(page);
    await seedOwnerFindings(page, URL_KEY, { tasks: [{ ticket: TICKET, title: 'A task with records' }], findings: 1 });
    // Another account owns the workspace now: this session reads it as a member, who can still write records.
    const own = await page.request.get(`/test/set-workspace-ownership?urlKey=${URL_KEY}&state=foreign`);
    expect(own.ok(), `ownership seam failed: ${await own.text()}`).toBeTruthy();
    await page.goto(`/workspace/${URL_KEY}/task/${TICKET}`);
    await expect(page.locator(SELECTORS.taskPage.question)).toHaveCount(0);
    await expect(page.locator(R.addTools)).toHaveCount(1);
    await expect(page.locator(R.addTools)).not.toHaveAttribute('open', '');
    await expect(page.locator(`${R.line} ${R.recordTools}`)).toHaveCount(1);
    await expectNoClippedOverflow(page);
  });

  test('a signed-out reader of a share link gets no records, no fold and no form', async ({ page, browser, baseURL }) => {
    await seedTask(page);
    await seedOwnerFindings(page, URL_KEY, { tasks: [{ ticket: TICKET, title: 'A task with records' }], findings: 1 });
    await page.goto(`/workspace/${URL_KEY}/task/${TICKET}`);
    await expect(page.locator(R.section)).toHaveCount(1);
    const minted = await page.request.post(`/workspace/${URL_KEY}/api/task/${TICKET}/share`, { data: { source: 'local' } });
    expect(minted.status(), `mint failed: ${await minted.text()}`).toBe(201);
    const { path } = await minted.json();

    const guestCtx = await browser.newContext({ viewport: PHONE });
    const guest = await guestCtx.newPage();
    expect((await guest.goto(`${baseURL}${path}`)).status()).toBe(200);
    await expect(guest.locator('[data-testid="task-page-title"]')).toHaveText('A task with records');
    await expect(guest.locator(R.section)).toHaveCount(0);
    await expect(guest.locator(R.addTools)).toHaveCount(0);
    await expect(guest.locator(R.recordTools)).toHaveCount(0);
    await expect(guest.locator('form[data-testid^="task-record"]')).toHaveCount(0);
    await guestCtx.close();
  });
});
