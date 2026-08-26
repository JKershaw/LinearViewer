/**
 * LIN-694 — the periodical report-persistence gate wired into
 * PATCH /api/proxy/issues/:issueId.
 *
 * A periodical Stage-2 review task's minted description carries the
 * `harbour-periodical-gate` marker (lib/periodical-report-gate.js,
 * lib/periodicals.js's buildPeriodicalScaffold). This proves the wiring
 * end-to-end through the route: a marked issue moving to a completed-type
 * state is refused without a real evidence comment, an ordinary issue is
 * completely unaffected, and a marked issue moving to a non-completed state
 * is unaffected too. Uses the same directly-injected fake-provider pattern as
 * tests/unit/proxy-create-write-contract.test.js.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { buildPeriodicalGateMarker } from '../../lib/periodical-report-gate.js';

const TEAM_UUID = '11111111-1111-1111-1111-111111111111';
const STATES = [
  { id: 'state-done', name: 'Done', type: 'completed' },
  { id: 'state-in-progress', name: 'In Progress', type: 'started' },
];

function makeProvider({ description, comments = [] }) {
  const calls = { updateIssue: [] };
  const provider = {
    name: 'fake',
    supports: () => true,
    async issueWriteGuard() {
      return { id: 'iss-1', trashed: false, team: { id: TEAM_UUID }, description, comments: { nodes: comments } };
    },
    async states() {
      return STATES;
    },
    async updateIssue(_token, issueId, input) {
      calls.updateIssue.push(input);
      return { success: true, issue: { id: issueId, identifier: 'ACME-1', ...input } };
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

async function patch(app, issueId, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues/${issueId}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ISSUE_UUID = '33333333-3333-3333-3333-333333333333';
const gatedDescription = `${buildPeriodicalGateMarker('Documentation Review')}\n\nRun the review.`;
const REPORT_EVIDENCE_COMMENT = { body: 'Landed: https://github.com/JKershaw/LinearViewer/pull/1223' };
const ADVERSARIAL_COMPLETE_COMMENT = {
  body: 'Adversarial second-read verdict: AGREE. Differed from top finding: NO. Disposition: no change.',
};

describe('PATCH /api/proxy/issues/:issueId — periodical report-persistence gate (LIN-694)', () => {
  test('refuses a marked issue moving to a completed state with no evidence comment', async () => {
    const { provider, calls } = makeProvider({
      description: gatedDescription,
      comments: [{ body: 'Report: docs/reviews/documentation-review-2026-08-23.md' }],
    });
    const { status, body } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-done' });
    assert.equal(status, 409);
    assert.equal(body.code, 'PERIODICAL_REPORT_NOT_PERSISTED');
    assert.match(body.error, /cannot be marked done/i);
    assert.equal(calls.updateIssue.length, 0, 'the write must never reach the provider');
  });

  test('allows the same transition once a real evidence comment AND a complete adversarial-read record exist', async () => {
    const { provider, calls } = makeProvider({
      description: gatedDescription,
      comments: [REPORT_EVIDENCE_COMMENT, ADVERSARIAL_COMPLETE_COMMENT],
    });
    const { status } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-done' });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue.length, 1);
    assert.equal(calls.updateIssue[0].stateId, 'state-done');
  });

  // LIN-2323 — the new adversarial-read evidence predicate, end-to-end through
  // the route. Report-persistence evidence alone is no longer sufficient.
  test('refuses a marked issue moving to completed when the adversarial-read comment is absent entirely', async () => {
    const { provider, calls } = makeProvider({
      description: gatedDescription,
      comments: [REPORT_EVIDENCE_COMMENT],
    });
    const { status, body } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-done' });
    assert.equal(status, 409);
    assert.equal(body.code, 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED');
    assert.match(body.error, /adversarial second-read/i);
    assert.equal(calls.updateIssue.length, 0, 'the write must never reach the provider');
  });

  test('refuses a marked issue moving to completed when the adversarial-read comment carries only the verdict token', async () => {
    const { provider, calls } = makeProvider({
      description: gatedDescription,
      comments: [REPORT_EVIDENCE_COMMENT, { body: 'Adversarial second-read verdict: AGREE' }],
    });
    const { status, body } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-done' });
    assert.equal(status, 409);
    assert.equal(body.code, 'PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED');
    assert.equal(calls.updateIssue.length, 0, 'a bare-AGREE record must not satisfy the widened predicate');
  });

  test('allows a complete DISAGREE record too — escalation does not block concluding', async () => {
    const { provider, calls } = makeProvider({
      description: gatedDescription,
      comments: [
        REPORT_EVIDENCE_COMMENT,
        { body: 'Adversarial second-read verdict: DISAGREE. Differed from top finding: YES. Disposition: escalated.' },
      ],
    });
    const { status } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-done' });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue.length, 1);
  });

  test('does not gate a marked issue moving to a non-completed state', async () => {
    const { provider, calls } = makeProvider({ description: gatedDescription, comments: [] });
    const { status } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-in-progress' });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue.length, 1);
  });

  test('does not gate an ordinary (unmarked) issue moving to a completed state', async () => {
    const { provider, calls } = makeProvider({ description: 'An ordinary task.', comments: [] });
    const { status } = await patch(buildApp(provider), ISSUE_UUID, { stateId: 'state-done' });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue.length, 1);
  });

  test('is unaffected by a title-only update on a marked issue (no stateId in the body)', async () => {
    const { provider, calls } = makeProvider({ description: gatedDescription, comments: [] });
    const { status } = await patch(buildApp(provider), ISSUE_UUID, { title: 'New title' });
    assert.equal(status, 200);
    assert.equal(calls.updateIssue.length, 1);
  });
});
