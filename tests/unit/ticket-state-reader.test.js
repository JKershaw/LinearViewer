/**
 * LIN-3366: the sweep's owner-blind ticket read. The provider must receive the
 * structured scope (`access.scope ?? access.token`): GitHub / Jira providers
 * throw on a bare token, and a throw reads as null (closes nothing, silently).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createReadTicketState } from '../../lib/ticket-state-reader.js';

const UNSCOPED = Symbol('unscoped');
function make({ access, issue = { id: 'iid', state: { type: 'completed' } }, supports = true, throws = false } = {}) {
  const seen = { fetch: [], resolve: [], logs: [] };
  const provider = {
    supports: (n) => supports && n === 'fetchIssueContext',
    fetchIssueContext: async (scope, identifier) => { seen.fetch.push({ scope, identifier }); if (throws) throw new Error('client not configured'); return { issue }; }
  };
  const read = createReadTicketState({
    resolveWorkspaceAccess: async (...a) => { seen.resolve.push(a); return access; },
    getProviderForWorkspace: () => provider,
    unscoped: UNSCOPED,
    log: (m) => seen.logs.push(m)
  });
  return { read, seen };
}

describe('ticket-state-reader (LIN-3366)', () => {
  test('passes the structured scope to the provider when the resolver returns one', async () => {
    const scope = { repo: 'o/r', token: 't' };
    const { read, seen } = make({ access: { token: 't', scope, provider: 'github', reason: 'ok' } });
    assert.deepEqual(await read('acme', 'o/r#1', { source: 'github' }), { issueId: 'iid', stateType: 'completed' });
    assert.equal(seen.fetch[0].scope, scope);
    assert.deepEqual(seen.resolve[0], ['acme', UNSCOPED, { source: 'github' }]);
  });
  test('falls back to the bare token when there is no scope (Linear)', async () => {
    const { read, seen } = make({ access: { token: 'tok', provider: 'linear', reason: 'ok' } });
    await read('acme', 'LIN-1');
    assert.equal(seen.fetch[0].scope, 'tok');
  });
  test('null for a non-ok resolution, no token, an unsupported provider, a missing state type, or a throw', async () => {
    assert.equal(await make({ access: { token: 't', reason: 'no-binding' } }).read('a', 'X'), null);
    assert.equal(await make({ access: { reason: 'ok' } }).read('a', 'X'), null);
    assert.equal(await make({ access: { token: 't', reason: 'ok' }, supports: false }).read('a', 'X'), null);
    assert.equal(await make({ access: { token: 't', reason: 'ok' }, issue: { id: 'i' } }).read('a', 'X'), null);
    const t = make({ access: { token: 't', reason: 'ok' }, throws: true });
    assert.equal(await t.read('acme', 'X'), null);
    assert.match(t.seen.logs[0], /\[ticket-closer\] ticket read failed for acme\/X/);
  });
});
