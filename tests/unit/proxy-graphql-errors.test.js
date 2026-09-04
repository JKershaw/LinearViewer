/**
 * LIN-2561 — `normalizeWritePayload` (lib/proxy-graphql-errors.js:149-152) had
 * no effective test coverage on either arm: the whole 9366-test unit suite
 * stayed green under both M4a (delete the pass-through arm) and M4b (force
 * the rejection arm to always report success). M4c (a control mutation that
 * always reports failure) IS already caught elsewhere
 * (tests/unit/proxy-local-target.test.js:138), which proves the suite can see
 * this helper at all — the M4a/M4b survivals are a real gap, not a harness
 * artefact.
 *
 * Lane decision (recorded per LIN-2548 review ledger item 2): UNIT, not E2E.
 * E2E already witnesses the rejection arm (tests/e2e/proxy-local.spec.js:509
 * fails under M4b today) and cannot be extended to witness the pass-through
 * arm without a new production test seam — the only two providers reachable
 * from the E2E proxy lane (LocalProvider, and the fake-token Linear path in
 * tests/e2e/proxy.spec.js) never hand back an already-enveloped write. A unit
 * test reaches the pass-through arm directly instead. See LIN-2561 for the
 * full lane-decision writeup.
 *
 * Block A exercises the helper directly. Block B exercises it at the actual
 * HTTP boundary via POST /api/proxy/issues with a directly-injected fake
 * provider (harness pattern from tests/unit/proxy-create-write-contract.js) —
 * one route-level pair is sufficient; this is NOT replicated across the
 * helper's other 6 call sites in routes/proxy.js.
 *
 * Mutation matrix (mutate on disk -> run this file -> observe -> revert ->
 * confirm `git status` is clean), run from the repo root:
 *
 *   M4a (delete the pass-through arm — expect Block A tests 1-2 and Block B
 *   tests 1-2 to fail, everything else green):
 *     perl -0pi -e "s/  if \(result && typeof result === 'object' && 'success' in result\) return result;\n//" lib/proxy-graphql-errors.js
 *     node --test tests/unit/proxy-graphql-errors.test.js
 *     git checkout -- lib/proxy-graphql-errors.js
 *
 *   M4b (rejection arm always succeeds — expect Block A tests 3-4 and Block B
 *   test 3 to fail, everything else green):
 *     perl -pi -e "s/success: !!result/success: true/" lib/proxy-graphql-errors.js
 *     node --test tests/unit/proxy-graphql-errors.test.js
 *     git checkout -- lib/proxy-graphql-errors.js
 *
 *   M4c (control — wrap arm always fails; already caught by
 *   proxy-local-target.test.js, not by this file):
 *     perl -pi -e "s/success: !!result/success: false/" lib/proxy-graphql-errors.js
 *     node --test tests/unit/*.test.js
 *     git checkout -- lib/proxy-graphql-errors.js
 *
 * Run with: node --test tests/unit/proxy-graphql-errors.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { normalizeWritePayload } from '../../lib/proxy-graphql-errors.js';
import { createProxyRoutes } from '../../routes/proxy.js';

describe('normalizeWritePayload — direct helper (Block A)', () => {
  test('an already-enveloped result passes through by identity (kills M4a)', () => {
    const enveloped = { success: false, issue: { id: 'x' } };
    assert.equal(normalizeWritePayload(enveloped, 'issue'), enveloped);
  });

  test('a falsey envelope is not re-wrapped truthy (kills M4a)', () => {
    const rejected = { success: false, issue: null };
    const result = normalizeWritePayload(rejected, 'issue');
    assert.equal(result.success, false);
  });

  test('null normalizes to a rejected envelope (kills M4b)', () => {
    assert.deepEqual(normalizeWritePayload(null, 'issue'), { success: false, issue: null });
  });

  test('undefined normalizes to a rejected envelope (kills M4b)', () => {
    assert.deepEqual(normalizeWritePayload(undefined, 'comment'), { success: false, comment: null });
  });

  test('a bare truthy entity normalizes to a landed envelope (pins the M4c control)', () => {
    const entity = { id: 'c1' };
    assert.deepEqual(normalizeWritePayload(entity, 'comment'), { success: true, comment: entity });
  });
});

describe('POST /api/proxy/issues — route-level witness (Block B)', () => {
  const TEAM_UUID = '11111111-1111-1111-1111-111111111111';

  function makeProvider(createIssueResult) {
    const provider = {
      name: 'fake',
      supports: () => true,
      apiWriteFields: () => [],
      createFields: () => [],
      fetchTeams: async () => [{ id: TEAM_UUID, name: 'Team' }],
      async createIssue() {
        return createIssueResult;
      },
    };
    return provider;
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
    const server = app.listen(0, '127.0.0.1');
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

  test('provider returns a rejected envelope -> 502 "not created" (kills M4a)', async () => {
    const { status, body } = await post(buildApp(makeProvider({ success: false })), { title: 'x' });
    assert.equal(status, 502);
    assert.match(body.error, /not created/);
  });

  test('provider returns an already-enveloped landed write -> passes through un-nested (kills M4a)', async () => {
    const { status, body } = await post(
      buildApp(makeProvider({ success: true, issue: { identifier: 'ACME-1' } })),
      { title: 'x' }
    );
    assert.equal(status, 201);
    assert.equal(body.issue.identifier, 'ACME-1');
    assert.equal(body.issue.issue, undefined);
  });

  test('provider returns null (no landed write) -> 502 "not created" (kills M4b)', async () => {
    const { status, body } = await post(buildApp(makeProvider(null)), { title: 'x' });
    assert.equal(status, 502);
    assert.match(body.error, /not created/);
  });
});
