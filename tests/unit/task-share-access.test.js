/**
 * LIN-3330 — lib/task-share-access.js.
 *
 * The owner-away credential resolver the guest route uses: it names the owner
 * (never UNSCOPED), forwards `source`, and returns null when there is no token.
 *
 * Run with: node --test tests/unit/task-share-access.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGuestTaskAccess } from '../../lib/task-share-access.js';

const RECORD = {
  urlKey: 'acme',
  ownerAccountId: 'acct-1',
  source: 'jira',
};

function make({ access, provider = { name: 'fake' } } = {}) {
  const calls = [];
  const resolveWorkspaceAccess = async (urlKey, ownerAccountId, opts) => {
    calls.push({ urlKey, ownerAccountId, opts });
    return access;
  };
  const getProviderForWorkspace = (ws) => { calls.push({ getProvider: ws }); return provider; };
  return { guestAccess: createGuestTaskAccess({ resolveWorkspaceAccess, getProviderForWorkspace }), calls, provider };
}

describe('createGuestTaskAccess', () => {
  test('names the owner and forwards the task source (never UNSCOPED)', async () => {
    const { guestAccess, calls } = make({ access: { token: 'tok', provider: 'jira', scope: { site: 'x' } } });
    const out = await guestAccess(RECORD);
    assert.deepEqual(calls[0], { urlKey: 'acme', ownerAccountId: 'acct-1', opts: { source: 'jira' } });
    assert.equal(calls[0].ownerAccountId !== 'UNSCOPED', true);
    assert.equal(out.callScope.site, 'x', 'prefers scope over token');
  });

  test('falls back to the token when there is no scope', async () => {
    const { guestAccess } = make({ access: { token: 'tok', provider: 'linear' } });
    const out = await guestAccess(RECORD);
    assert.equal(out.callScope, 'tok');
  });

  test('a null token returns null (no stored-only fallback)', async () => {
    const { guestAccess } = make({ access: { token: null, reason: 'session_expired' } });
    assert.equal(await guestAccess(RECORD), null);
  });

  test('a null record returns null without resolving', async () => {
    const { guestAccess, calls } = make({ access: { token: 'tok' } });
    assert.equal(await guestAccess(null), null);
    assert.deepEqual(calls, []);
  });
});
