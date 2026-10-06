/**
 * LIN-3328 — the opt-in unbounded loop horizon on `getLoopsForIssue`.
 *
 * The default stays the 30-day read horizon (`READ_HORIZON_MS`): a history row
 * older than that is dropped, both by the store query (`_fetchWorkspaceData`'s
 * `since`, pipeline-loops.js:1463) and by the build's own cutoff
 * (`_buildLoops`'s `cutoff`, :416). `deps.horizon: 'all'` must bypass BOTH so a
 * task page can show a task's whole life.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getLoopsForIssue } from '../../lib/pipeline-loops.js';

const ISSUE = 'LIN-100';
const DAY_MS = 24 * 60 * 60 * 1000;

// A 45-day-old history row — comfortably outside the 30-day default horizon.
function oldHistoryItem(overrides = {}) {
  const dispatchedAt = new Date(Date.now() - 45 * DAY_MS);
  return {
    id: 'hist-old',
    promptName: 'implementation',
    prompt: 'implementation prompt text',
    issueId: 'uuid-100',
    issueIdentifier: ISSUE,
    issueTitle: 'Issue A',
    issueUrl: 'https://linear.app/x/issue/LIN-100',
    workspace: { urlKey: 'ws' },
    dispatchedAt: dispatchedAt.toISOString(),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: new Date(dispatchedAt.getTime() + 60 * 60 * 1000).toISOString(),
    takenByTokenLabel: 'consumer-1',
    feedback: [],
    ...overrides,
  };
}

/**
 * Mock issue-scoped stores. `honourSince` models the real store's query-level
 * window (`listHistory`/`listStatus` push `since` into the DB predicate); with
 * it OFF the row reaches `_buildLoops`, which is where its own JS cutoff lives.
 */
function makeStores({ history = [], agentStatus = [], capture = {}, honourSince = true } = {}) {
  return {
    dispatchStore: {
      async listItems(urlKey, options) {
        capture.listItemsOptions = options;
        return [];
      },
      async listHistory(urlKey, options) {
        capture.listHistoryOptions = options;
        const id = options?.issueIdentifier;
        let items = id ? history.filter(x => x.issueIdentifier === id) : history;
        if (honourSince && options?.since) {
          items = items.filter(x => new Date(x.dispatchedAt).getTime() >= options.since.getTime());
        }
        return { items, total: items.length };
      },
    },
    agentStatusStore: {
      async listStatus(urlKey, options) {
        capture.listStatusOptions = options;
        const id = options?.taskIdentifier;
        const items = id ? agentStatus.filter(x => x.taskIdentifier === id) : agentStatus;
        return { items, total: items.length };
      },
    },
  };
}

describe('getLoopsForIssue horizon (LIN-3328)', () => {
  test('default drops a row older than 30 days at the query; horizon:"all" returns it', async () => {
    const capture = {};
    const stores = makeStores({ history: [oldHistoryItem()], capture });

    const byDefault = await getLoopsForIssue('ws', ISSUE, stores);
    assert.deepEqual(byDefault, [], 'a 45-day-old row is outside the default horizon');
    assert.ok(capture.listHistoryOptions.since instanceof Date, 'default narrows the store read with a since window');

    const all = await getLoopsForIssue('ws', ISSUE, { ...stores, horizon: 'all' });
    assert.equal(all.length, 1, 'horizon:"all" returns the whole history');
    assert.equal(all[0].loopId, 'hist-old');
    assert.equal(all[0].issueIdentifier, ISSUE);
  });

  test('horizon:"all" drops the since window from BOTH archive reads', async () => {
    const capture = {};
    const stores = makeStores({ history: [oldHistoryItem()], capture });

    await getLoopsForIssue('ws', ISSUE, { ...stores, horizon: 'all' });
    assert.equal(capture.listHistoryOptions.since, undefined, 'history read is unwindowed');
    assert.equal(capture.listHistoryOptions.issueIdentifier, ISSUE, 'the issue scope is still pushed down');
    assert.equal(capture.listStatusOptions.since, undefined, 'agent-status read is unwindowed');
    assert.equal(capture.listStatusOptions.taskIdentifier, ISSUE);
  });

  test('the JS cutoff is bypassed too: horizon:"all" keeps a row that reaches _buildLoops', async () => {
    // `honourSince: false` returns the old row from the store regardless, so the
    // only thing that can drop it is the build's own cutoff — isolating
    // `_buildLoops`' horizon plumbing.
    const stores = makeStores({ history: [oldHistoryItem()], honourSince: false });

    assert.deepEqual(await getLoopsForIssue('ws', ISSUE, stores), [], '_buildLoops applies the 30-day cutoff');
    const all = await getLoopsForIssue('ws', ISSUE, { ...stores, horizon: 'all' });
    assert.equal(all.length, 1, '_buildLoops honours the unbounded horizon');
  });

  test('the default horizon is untouched for existing callers', async () => {
    const capture = {};
    const stores = makeStores({ history: [oldHistoryItem()], capture });
    // Explicitly passing nothing (the ordinary call) keeps a Date since window.
    await getLoopsForIssue('ws', ISSUE, { dispatchStore: stores.dispatchStore, agentStatusStore: stores.agentStatusStore });
    assert.ok(capture.listHistoryOptions.since instanceof Date);
    const ageMs = Date.now() - capture.listHistoryOptions.since.getTime();
    assert.ok(Math.abs(ageMs - 30 * DAY_MS) < 60 * 1000, 'since ≈ now − 30d');
  });
});
