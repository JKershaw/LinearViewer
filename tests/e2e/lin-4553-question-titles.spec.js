/**
 * LIN-4553 (LIN-4546 piece 5): the run page names a question's task by identifier and title even when the run itself does not
 * carry the title (a run dispatched with its identifier alone, as many stage runs are). The run page's own rows then have no title
 * to give, so the reader asks the workspace's provider for that one issue (lib/question-task-titles.js, bounded).
 *
 * Seeded through tests/fixtures/local-harness.js (the local provider answers the one-issue read from its own store); selectors
 * through SELECTORS. Unit witnesses for the feed, the reader, the lookup and the chat tool: tests/unit/lin-4553-question-titles.test.js.
 */
import { test, expect } from '../fixtures/test-base.js';
import { localSeedId } from '../fixtures/local-harness.js';
import { askingRun, seedQuestion } from '../fixtures/question-records.js';
import { SELECTORS } from '../helpers.js';

const Q = SELECTORS.questionCard;
const OLD = '2020-01-01T00:00:00Z';
const TITLE = 'Run page: the card names its task even when the run does not';

async function clear(page, urlKey) {
  await page.request.get('/test/clear-comment-dedupe');
  await page.goto('/test/clear-local-store');
  await page.request.get(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
  await page.request.get(`/test/clear-ticket-records?urlKey=${urlKey}`);
}

test('the run page titles the card from the tracker when the run carries only the identifier', async ({ page, seedLocal, localWorkerUrlKey: urlKey }) => {
  await clear(page, urlKey);
  const id = (raw) => localSeedId(urlKey, raw);
  await seedLocal({
    projects: [{ id: id('proj'), name: 'UI finish', content: 'Seeded for LIN-4553', sortOrder: 0 }],
    issues: [{ id: id('LOCAL-21'), identifier: 'LOCAL-21', title: TITLE, projectId: id('proj'), sortOrder: 0, createdAt: OLD, state: { name: 'Todo', type: 'unstarted' } }],
  }, { runnerKey: true });
  // The run carries the identifier as its title (askingRun's default), which the card reads as no title.
  const runId = await askingRun(page, urlKey, 'LOCAL-21');
  const qid = await seedQuestion(page, urlKey, { ticket: 'LOCAL-21', runId, asks: 'Which witness should the run page use?' });

  await page.goto(`/workspace/${urlKey}/observation/session/${runId}`);
  const section = page.locator('[data-testid="session-question-records"]');
  const card = section.locator(Q.byId(qid));
  await expect(card.locator(Q.taskId)).toHaveText('LOCAL-21');
  await expect(card.locator(Q.taskTitle)).toHaveText(TITLE);
  const text = await card.innerText();
  expect(text).not.toMatch(/\btask-[0-9a-f]{6,}\b/);
  expect(text).not.toMatch(/\bperson:/);
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});
