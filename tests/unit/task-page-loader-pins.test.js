/**
 * LIN-3590 — pins for the one behaviour the task page loader rebuild fixed
 * (everything else is held to today's behaviour by the rebuild's replay).
 *
 * `readMergedBy` is documented "Never throws" (LIN-3248 F4), yet a `null` entry
 * in the stored close-out events made its PR filter read `null.prUrl`, so the
 * whole page load rejected. A null entry is skipped like any other event that
 * is not about this PR.
 *
 * Run with: node --test tests/unit/task-page-loader-pins.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const PR_URL = 'https://github.com/acme/app/pull/41';

function loaderWith(events, closeOutPr) {
  return createTaskPageLoader({
    dispatchStore: {},
    agentStatusStore: {},
    getLoopsForIssue: async () => [],
    readTaskRunFacts: async () => ({ stopAt: null, variant: 'unknown' }),
    readRunEvidence: async () => ({ closeOut: { status: 'merged', pr: closeOutPr } }),
    closeOutEventsStore: { listForIssue: async () => events },
    enrichLoop,
    deriveSessionWaiting,
    now: () => new Date('2026-10-06T15:00:00.000Z'),
  });
}

const access = {
  callScope: 'scope',
  provider: {
    fetchRecommendationContext: async () => ({
      issue: { id: 'u1', identifier: 'LIN-50', title: 'T', state: { name: 'Done', type: 'completed' } },
      comments: [],
      children: [],
    }),
  },
};

describe('readMergedBy tolerates a null close-out event (LIN-3590)', () => {
  test('a null entry beside a press for this PR: the page loads and names close-out', async () => {
    const loader = loaderWith([null, { prUrl: PR_URL, by: 'press' }], { number: 41, url: PR_URL });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access });
    assert.equal(model.evidence.closeOut.mergedBy, 'close-out');
    assert.equal(model.evidence.closeOut.message, 'the pull request was merged by close-out');
  });

  test('a null entry on the by-number path (no PR url): a person-noticed merge is still found', async () => {
    const loader = loaderWith([null, { prUrl: PR_URL, by: 'person', merged: true }], { number: 41 });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access });
    assert.equal(model.evidence.closeOut.mergedBy, 'person');
  });

  test('only null entries: unknown merger, not a rejection', async () => {
    const loader = loaderWith([null, undefined], { number: 41, url: PR_URL });
    const { model } = await loader.loadTaskPage({ urlKey: 'ws', identifier: 'LIN-50', access });
    assert.equal(model.evidence.closeOut.mergedBy, null);
  });
});
