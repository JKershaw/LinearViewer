/**
 * LIN-3863: a person's Done from the task-edit page (seam 2,
 * PATCH /workspace/:urlKey/api/issues/:issueId) hands the merge recorder to the
 * write, once, with `writer: 'person'`, after the response. The route stays
 * unchanged for every other write, and a recorder that fails never changes the answer.
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'person-done-merge-fake';
const ISSUE_ID = 'LIN-901';
const STATE_UUID = '44444444-4444-4444-4444-444444444444';
const tick = () => new Promise(r => setImmediate(r));

// A fake provider whose Done write answers with a completed ticket, so the
// recorder's input is the real shape seam 2 would hand it.
function makeProvider() {
  return {
    name: PROVIDER_NAME,
    supports: (cap) => cap === 'updateIssue',
    async issueWriteGuard() { return { id: 'iss-1', trashed: false, team: { id: 'team-x' } }; },
    async states() { return [{ id: STATE_UUID, name: 'Done', type: 'completed' }]; },
    async updateIssue(_token, _issueId, input) {
      return { success: true, issue: { id: 'iss-1', identifier: ISSUE_ID, ...(input.stateId ? { state: { type: 'completed' } } : {}), title: input.title ?? 'Old title' } };
    },
    async fetchIssueContext() { return { issue: { id: 'iss-1', identifier: ISSUE_ID, state: { type: 'completed' } } }; },
  };
}

function buildApp(recordPipelineMerge) {
  registerProvider(makeProvider());
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { id: 'ws-1', urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      req.session = { accountId: 'acct-1', linearUserId: 'user-1' };
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
    ...(recordPipelineMerge ? { recordPipelineMerge } : {}),
  }));
  return app;
}

async function patch(app, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/acme/api/issues/${ISSUE_ID}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('a person Done PATCH hands the recorder once, with writer person and the written issue', async () => {
  const calls = [];
  const r = await patch(buildApp(async (a) => { calls.push(a); }), { stateId: 'Done' });
  await tick();
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].writer, 'person');
  assert.equal(calls[0].urlKey, 'acme');
  assert.equal(calls[0].workspaceId, 'ws-1');
  assert.equal(calls[0].accountId, 'acct-1');
  assert.equal(calls[0].callScope, 'ws-token');
  assert.equal(calls[0].written.identifier, ISSUE_ID);
  assert.equal(typeof calls[0].readBack, 'function');
});

test('a title-only PATCH is not a Done write and does not call the recorder', async () => {
  const calls = [];
  const r = await patch(buildApp(async (a) => { calls.push(a); }), { title: 'Renamed' });
  await tick();
  assert.equal(r.status, 200);
  assert.equal(calls.length, 0);
});

test('a throwing recorder leaves the Done response unchanged', async () => {
  const absent = await patch(buildApp(), { stateId: 'Done' });
  const throwing = await patch(buildApp(async () => { throw new Error('boom'); }), { stateId: 'Done' });
  await tick();
  assert.equal(throwing.status, 200);
  assert.deepEqual(throwing.body, absent.body);
});

test('a rejecting recorder is caught and the response is unchanged', async () => {
  const absent = await patch(buildApp(), { stateId: 'Done' });
  const rejecting = await patch(buildApp(() => Promise.reject(new Error('down'))), { stateId: 'Done' });
  await tick();
  assert.equal(rejecting.status, 200);
  assert.deepEqual(rejecting.body, absent.body);
});
