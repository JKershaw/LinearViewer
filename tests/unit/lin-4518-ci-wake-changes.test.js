/**
 * LIN-4518 (beat 2): the ci-wake sweep resolves a bare PR number against the ticket's own change records first (the PRs
 * its implementation wrote), and only then against the comments. Witnesses: the change path names the PR; no task, no
 * change, or an unreadable store name no PR, so the comment fallback runs as before.
 */
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { changePrsOf, prRefsFromPark } from '../../lib/ci-wake-sweep.js';

const change = (ref) => ({ id: `change-${ref.split('/').pop()}`, kind: 'change', fields: { ref } });
const store = (taskId, changes) => ({
  async taskForTicket(urlKey, ticket) { return urlKey === 'acme' && ticket === 'LIN-1' ? taskId : null; },
  async find(_urlKey, query) { return query.inRef === taskId ? changes : []; },
});

describe('the ci-wake sweep names a bare PR number from the change records (LIN-4518)', () => {
  test('a ticket whose implementation wrote a change: the bare number resolves to that PR, with no comment read', async () => {
    const records = store('task-1', [change('https://github.com/acme/widget/pull/1945')]);
    const known = await changePrsOf(records, 'acme', 'LIN-1');
    assert.deepEqual(prRefsFromPark('PR #1945 checks went red', known).prs.map((p) => p.url), ['https://github.com/acme/widget/pull/1945']);
  });

  test('no task, or no change on the task: nothing from the records (the comment fallback runs)', async () => {
    assert.deepEqual(await changePrsOf(store(null, []), 'acme', 'LIN-1'), []);
    assert.deepEqual(await changePrsOf(store('task-1', []), 'acme', 'LIN-1'), []);
    assert.deepEqual(await changePrsOf(null, 'acme', 'LIN-1'), []);
  });

  test('an unreadable store names no PR, and the sweep does not fail', async () => {
    const broken = { async taskForTicket() { throw new Error('boom'); } };
    assert.deepEqual(await changePrsOf(broken, 'acme', 'LIN-1'), []);
  });
});

// LIN-4518 (beat 2): the run page's PR is the change its run filed, not a PR any comment cites.
import { changePrsOfRun } from '../../lib/task-standing.js';

describe('the run page names the PR its run filed (LIN-4518)', () => {
  const filed = (ref, run) => ({ id: `change-${ref.split('/').pop()}`, kind: 'change', run, fields: { ref } });
  const runStore = (taskId, changes) => ({
    async taskForTicket(urlKey, ticket) { return urlKey === 'acme' && ticket === 'LIN-1' ? taskId : null; },
    async find(_urlKey, query) { return query.inRef === taskId ? changes : []; },
  });

  test('the run that filed a change gets that PR; another run\'s change is not its PR', async () => {
    const store = runStore('task-1', [filed('https://github.com/acme/widget/pull/10', 'run-A'), filed('https://github.com/acme/widget/pull/11', 'run-B')]);
    const prs = await changePrsOfRun({ recordsStore: store, urlKey: 'acme', ticket: 'LIN-1', runId: 'run-A' });
    assert.deepEqual(prs.map((p) => p.number), [10]);
    assert.equal(prs[0].corroborated, false);
  });

  test('a run that filed no change names no PR from the records (the comment fallback runs)', async () => {
    const store = runStore('task-1', [filed('https://github.com/acme/widget/pull/10', 'run-A')]);
    assert.deepEqual(await changePrsOfRun({ recordsStore: store, urlKey: 'acme', ticket: 'LIN-1', runId: 'run-Z' }), []);
  });
});
