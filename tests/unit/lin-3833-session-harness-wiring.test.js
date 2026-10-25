/**
 * LIN-3833 step 1 (Q1), production wiring: the session lane settles the harness for a request that
 * names its opened-task `surface`, and for no other request.
 *
 * `lin-3833-run-sources.test.js` drives the resolver and `createDispatchItem` with the settle flags
 * passed by hand. This drives `enterSessionDispatch` itself, so the flags that `enqueueRow`'s
 * SESSION_STAGES spec sets (lib/dispatch-entrance.js, `applyDefaultHarness: surfaceRun`,
 * `settleHarness: surfaceRun`) are what is under test. Remove either line and (a) goes red.
 *
 *  (a) a session dispatch with `surface: 'home'` and no harness stamps the table's harness when the
 *      job or group has one, else `claude-code`, and carries the structured bootstrap token when the
 *      resolved harness is `claude-code` (an opencode harness carries its token in prose, LIN-1155).
 *  (b) the close-out shape (`entryRung: 'run-step'`, no `surface`) still stamps `null` when the table
 *      has no harness.
 *  (c) a request with neither field (the dispatch page) still stamps `null`.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { enterSessionDispatch } from '../../lib/dispatch-entrance.js';
import { emptyTable } from '../../lib/model-routing.js';

const BOOTSTRAP = 'bootstrap-token-1';

// Runs the session lane once and returns the row it handed to `addItem`, or the answer it gave.
async function enqueue(body, table) {
  let row = null;
  const responses = [];
  const res = {
    status(code) { responses.push({ status: code }); return this; },
    json(payload) { responses.at(-1).body = payload; return this; },
    set() { return this; }
  };
  await enterSessionDispatch({
    req: {
      body: { prompt: 'p', target: 'cli', issueIdentifier: 'LIN-1', issueId: 'issue-1', ...body },
      session: { accountId: 'acct-owner' },
      protocol: 'http',
      get: () => 'localhost:3000'
    },
    res,
    workspace: { urlKey: 'alpha', id: 'ws-alpha' },
    ownerGate: async () => false,
    dispatchQueueStore: {
      addItem: async (_urlKey, fields) => { row = fields; return { _id: 'item-1', ...fields }; },
      expandCascadeAborts: async () => ({}),
      getItemStatus: async () => null
    },
    dispatchTokenStore: { listTokens: async () => [] },
    proxyTokenStore: { createToken: async () => ({ token: BOOTSTRAP }) },
    dispatchPresetsStore: { get: async () => null },
    workspacePreferencesStore: { getRoutingTable: async () => table },
    afterEnqueue: async () => undefined
  });
  assert.equal(responses[0]?.status, 201, `the lane answered ${responses[0]?.status}: ${JSON.stringify(responses[0]?.body)}`);
  return row;
}

describe('LIN-3833 (Q1) session lane — a request that names its opened-task surface settles the harness', () => {
  test('(a) surface home, empty table: stamps claude-code and the structured bootstrap token', async () => {
    const row = await enqueue({ surface: 'home', entryRung: 'run-task', attachProxy: true }, emptyTable());
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
    assert.equal(row.bootstrapToken, BOOTSTRAP, 'a claude-code run carries the structured token (LIN-3211)');
  });

  test('(a) surface home, a job row names a harness: stamps that harness and its model, no structured token', async () => {
    const table = emptyTable();
    table.jobs.implementation = { harness: 'opencode', model: 'job-model' };
    const row = await enqueue({ surface: 'home', entryRung: 'run-step', kind: 'implementation', attachProxy: true }, table);
    assert.equal(row.harness, 'opencode');
    assert.equal(row.model, 'job-model');
    assert.ok(!row.bootstrapToken, 'an opencode run carries its token in prose, not in the structured field');
  });

  test('(a) surface home, the LIN-1694 crossed pair: the steer row does not donate its model across claude-code', async () => {
    const table = emptyTable();
    table.jobs.autopilot = { harness: 'claude-code' };
    table.groups['agent-session'].steer = { harness: 'opencode', model: 'deepseek-v4-pro' };
    const row = await enqueue({ surface: 'home', entryRung: 'run-task', kind: 'autopilot' }, table);
    assert.equal(row.harness, 'claude-code');
    assert.equal(row.model, null);
  });

  test('(b) the close-out shape (run-step, no surface) keeps the null passthrough when the table has no harness', async () => {
    const row = await enqueue({ entryRung: 'run-step' }, emptyTable());
    assert.equal(row.harness, null);
    assert.ok(!row.bootstrapToken);
  });

  test('(c) a request with neither field (the dispatch page) keeps the null passthrough', async () => {
    const row = await enqueue({}, emptyTable());
    assert.equal(row.harness, null);
    assert.ok(!row.bootstrapToken);
  });
});
