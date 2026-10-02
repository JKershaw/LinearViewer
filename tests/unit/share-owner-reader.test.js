/**
 * Unit tests for lib/share-owner-reader.js (LIN-3243, Session A of LIN-3073).
 *
 * Run with: node --test tests/unit/share-owner-reader.test.js
 *
 * Pins the credential composition (testing strategy F2): the owner-scoped,
 * hardened `resolveWorkspaceAccess(urlKey, ownerAccountId)` — never UNSCOPED —
 * followed by the provider read with `scope ?? token`; the test-token
 * short-circuit; and the null-token failure shape.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReadOwnerIssues } from '../../lib/share-owner-reader.js';
import { UNSCOPED } from '../../lib/workspace-token-resolver.js';

function makeDeps({ access, issues = [] } = {}) {
  const calls = { access: [], fetchProjects: [] };
  const readOwnerIssues = createReadOwnerIssues({
    resolveWorkspaceAccess: async (urlKey, ownerAccountId) => {
      calls.access.push([urlKey, ownerAccountId]);
      return access;
    },
    getProviderForWorkspace: ({ provider }) => ({
      fetchProjects: async (arg) => {
        calls.fetchProjects.push({ provider, arg });
        return { issues };
      }
    }),
    getTestMockData: () => ({ issues: [{ identifier: 'MOCK-1' }] })
  });
  return { readOwnerIssues, calls };
}

describe('readOwnerIssues', () => {
  let savedEnv;
  beforeEach(() => { savedEnv = process.env.NODE_ENV; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
  });

  test('calls resolveWorkspaceAccess(urlKey, ownerAccountId) and fetchProjects(scope ?? token)', async () => {
    const { readOwnerIssues, calls } = makeDeps({
      access: { token: 'tok-1', scope: 'scoped-call', reason: 'ok', provider: 'jira' },
      issues: [{ identifier: 'LIN-1' }]
    });

    const result = await readOwnerIssues('ws-1', 'acct-1');

    assert.deepEqual(calls.access, [['ws-1', 'acct-1']]);
    assert.notEqual(calls.access[0][1], UNSCOPED, 'the share is always owner-scoped');
    assert.equal(calls.fetchProjects.length, 1);
    assert.equal(calls.fetchProjects[0].provider, 'jira');
    assert.equal(calls.fetchProjects[0].arg, 'scoped-call', 'scope wins when present');
    assert.deepEqual(result, { reason: 'ok', issues: [{ identifier: 'LIN-1' }] });
  });

  test('falls back to token when scope is absent', async () => {
    const { readOwnerIssues, calls } = makeDeps({
      access: { token: 'tok-2', reason: 'ok', provider: 'linear' }
    });
    await readOwnerIssues('ws-2', 'acct-2');
    assert.equal(calls.fetchProjects[0].arg, 'tok-2');
  });

  test('null token → { reason, issues: null } and no provider read', async () => {
    const { readOwnerIssues, calls } = makeDeps({ access: { token: null, reason: 'session_expired', provider: null } });
    const result = await readOwnerIssues('ws-3', 'acct-3');
    assert.deepEqual(result, { reason: 'session_expired', issues: null });
    assert.equal(calls.fetchProjects.length, 0);
  });

  test('the Linear test-token short-circuit returns the mock issues', async () => {
    process.env.NODE_ENV = 'test';
    const { readOwnerIssues, calls } = makeDeps({ access: { token: 'test-token', reason: 'ok', provider: 'linear' } });
    const result = await readOwnerIssues('test-workspace', 'acct');
    assert.deepEqual(result, { reason: 'ok', issues: [{ identifier: 'MOCK-1' }] });
    assert.equal(calls.fetchProjects.length, 0);
  });

  test('a provider read with no issues yields []', async () => {
    const { readOwnerIssues } = makeDeps({ access: { token: 'tok-4', reason: 'ok', provider: 'linear' }, issues: undefined });
    const result = await readOwnerIssues('ws-4', 'acct-4');
    assert.deepEqual(result, { reason: 'ok', issues: [] });
  });
});
