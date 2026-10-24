/**
 * LIN-3756: the pipeline-merge recorder fires beside seam 1
 * (PATCH /api/proxy/issues/:id) for a state write, once, after the response.
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const tick = () => new Promise(r => setImmediate(r));
const ISSUE_UUID = '33333333-3333-3333-3333-333333333333';
const STATES = [{ id: 'state-done', name: 'Done', type: 'completed' }];

const provider = {
  name: 'fake', supports: () => true,
  async issueWriteGuard() { return { id: 'iss-1', trashed: false, team: { id: '11111111-1111-1111-1111-111111111111' } }; },
  async states() { return STATES; },
  async updateIssue(_t, _id, input) {
    const state = STATES.find(s => s.id === input.stateId);
    return { success: true, issue: { id: 'iss-1', identifier: 'ACME-1', ...(state ? { state: { type: state.type } } : {}) } };
  },
  async fetchIssueContext() { return { issue: { id: 'iss-1', identifier: 'ACME-1', state: { type: 'completed' } } }; },
};

function app(recordPipelineMerge) {
  const a = express();
  a.use(express.json());
  a.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', workspaceId: 'ws-1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null, workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider, ...(recordPipelineMerge ? { recordPipelineMerge } : {}),
  }));
  return a;
}

async function patch(a, body) {
  const server = a.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/issues/${ISSUE_UUID}`, {
      method: 'PATCH', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('a Done PATCH calls the recorder once, with the written issue and the writer account', async () => {
  const calls = [];
  const r = await patch(app(async (a) => { calls.push(a); }), { stateId: 'state-done' });
  await tick();
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].urlKey, 'acme');
  assert.equal(calls[0].workspaceId, 'ws-1');
  assert.equal(calls[0].accountId, 'u1');
  assert.equal(calls[0].callScope, 'ws-token');
  assert.equal(calls[0].written.identifier, 'ACME-1');
});

test('a title-only PATCH does not call the recorder', async () => {
  const calls = [];
  await patch(app(async (a) => { calls.push(a); }), { title: 'new title' });
  await tick();
  assert.equal(calls.length, 0);
});

test('a throwing recorder leaves the response unchanged', async () => {
  const absent = await patch(app(), { stateId: 'state-done' });
  const throwing = await patch(app(async () => { throw new Error('boom'); }), { stateId: 'state-done' });
  await tick();
  assert.equal(throwing.status, 200);
  assert.equal(throwing.text, absent.text);
});
