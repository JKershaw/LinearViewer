/**
 * LIN-1557 — POST /api/proxy/issues' optional-field write contract.
 *
 * Before this ticket, an optional create field the active provider's
 * `createIssue` didn't honour (e.g. `stateId`/`priority` for GitHub,
 * `assigneeId`/`cycleId` for Local) was silently forwarded and discarded: the
 * caller got a 201 that quietly dropped part of what they asked for. This
 * gates every optional field against `provider.apiWriteFields()` — the
 * headless-door accept-list (deliberately separate from `createFields()`, the
 * UI-form descriptor) — and refuses an unsupported one with `400` instead.
 *
 * `teamId`/`title` are unaffected (still unconditionally required — LIN-1976
 * owns teamless-create parity separately) and are exercised elsewhere
 * (tests/unit/proxy-ref-resolution-routes.test.js, tests/e2e/proxy*.spec.js).
 *
 * Uses a directly-injected fake provider (mirrors
 * tests/unit/proxy-ref-resolution-routes.test.js's pattern) so the write
 * contract can be tuned per test without a real network/DI seam.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const TEAM_UUID = '11111111-1111-1111-1111-111111111111';
const OTHER_UUID = '22222222-2222-2222-2222-222222222222';

function makeProvider({ apiWriteFields }) {
  const calls = { createIssue: [] };
  const provider = {
    name: 'fake',
    supports: () => true,
    apiWriteFields: () => apiWriteFields,
    fetchTeams: async () => [{ id: TEAM_UUID, name: 'Team' }],
    async createIssue(_token, input) {
      calls.createIssue.push(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'ACME-1', ...input } };
    },
  };
  return { provider, calls };
}

function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function post(app, body) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues`, {
      method: 'POST',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// GitHub's real apiWriteFields() shape: no stateId/assigneeId/priority/parentId/cycleId.
const GITHUB_SHAPED = ['title', 'description', 'projectId'];
// Local's real apiWriteFields() shape: no assigneeId/cycleId.
const LOCAL_SHAPED = ['title', 'description', 'projectId', 'stateId', 'priority', 'parentId'];
const FULL = ['title', 'description', 'teamId', 'projectId', 'stateId', 'assigneeId', 'priority', 'parentId', 'cycleId'];

describe('POST /api/proxy/issues — optional-field write contract (LIN-1557)', () => {
  test('refuses stateId (400) for a provider whose apiWriteFields() excludes it', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status, body } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', stateId: 'done',
    });
    assert.equal(status, 400);
    assert.match(body.error, /stateId is not supported/);
    assert.equal(calls.createIssue.length, 0);
  });

  test('refuses assigneeId (400) for a provider whose apiWriteFields() excludes it', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status, body } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', assigneeId: OTHER_UUID,
    });
    assert.equal(status, 400);
    assert.match(body.error, /assigneeId is not supported/);
    assert.equal(calls.createIssue.length, 0);
  });

  test('refuses priority (400) for a provider whose apiWriteFields() excludes it', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status, body } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', priority: 2,
    });
    assert.equal(status, 400);
    assert.match(body.error, /priority is not supported/);
    assert.equal(calls.createIssue.length, 0);
  });

  test('refuses parentId (400) for a provider whose apiWriteFields() excludes it', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status, body } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', parentId: OTHER_UUID,
    });
    assert.equal(status, 400);
    assert.match(body.error, /parentId is not supported/);
    assert.equal(calls.createIssue.length, 0);
  });

  test('refuses cycleId (400) for a provider whose apiWriteFields() excludes it', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status, body } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', cycleId: OTHER_UUID,
    });
    assert.equal(status, 400);
    assert.match(body.error, /cycleId is not supported/);
    assert.equal(calls.createIssue.length, 0);
  });

  test('refuses assigneeId/cycleId (400) for a Local-shaped provider, but stateId/priority/parentId still work', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: LOCAL_SHAPED });
    const assignee = await post(buildApp(provider), { teamId: TEAM_UUID, title: 'x', assigneeId: OTHER_UUID });
    assert.equal(assignee.status, 400);
    const cycle = await post(buildApp(provider), { teamId: TEAM_UUID, title: 'x', cycleId: OTHER_UUID });
    assert.equal(cycle.status, 400);
    assert.equal(calls.createIssue.length, 0);

    const ok = await post(buildApp(provider), { teamId: TEAM_UUID, title: 'x', priority: 1, parentId: OTHER_UUID });
    assert.equal(ok.status, 201);
  });

  test('a fully-permissive provider (Linear-shaped) accepts every optional field', async () => {
    const { provider, calls } = makeProvider({ apiWriteFields: FULL });
    const { status, body } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', assigneeId: OTHER_UUID, priority: 2,
      parentId: OTHER_UUID, cycleId: OTHER_UUID,
    });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    const input = calls.createIssue[0];
    assert.equal(input.assigneeId, OTHER_UUID);
    assert.equal(input.priority, 2);
    assert.equal(input.parentId, OTHER_UUID);
    assert.equal(input.cycleId, OTHER_UUID);
  });

  test('a structurally-invalid value (non-UUID assigneeId) is silently dropped, unrelated to the write-contract gate', async () => {
    // Pre-existing behaviour, unchanged by this ticket: format validation runs
    // BEFORE the write-contract check, so a malformed value never reaches the
    // gate at all — even for a provider that supports the field.
    const { provider, calls } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status } = await post(buildApp(provider), {
      teamId: TEAM_UUID, title: 'x', assigneeId: 'not-a-uuid',
    });
    assert.equal(status, 201);
    assert.equal(calls.createIssue[0].assigneeId, undefined);
  });

  test('teamId stays required and ungated regardless of the write contract', async () => {
    const { provider } = makeProvider({ apiWriteFields: GITHUB_SHAPED });
    const { status, body } = await post(buildApp(provider), { title: 'x' });
    assert.equal(status, 400);
    assert.match(body.error, /teamId/);
  });
});
