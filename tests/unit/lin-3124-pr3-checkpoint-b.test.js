/**
 * LIN-3124 PR3 — checkpoint B: D2 marker identity + keystone guards (T22, T23-partial).
 *
 * Dark: no connection-backed binding exists until the write flip, so every
 * legacy path asserted here is byte-identical to pre-change behaviour, and every
 * new guard is an identity/refusal on legacy-only data.
 *
 * Run: node --test tests/unit/lin-3124-pr3-checkpoint-b.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../lib/providers/index.js';
import {
  linkProvider,
  upsertWorkspace,
  remintActiveCredential,
  applyAccessTokenToWorkspace,
  isActiveBinding,
  getWorkspaceCallScope,
  getWorkspaceToken,
  getBindingsForWorkspace,
  AMBIGUOUS_CALL_SCOPE,
  setActiveProvider,
  unlinkProvider,
} from '../../lib/workspace.js';
import {
  setBindingCredential,
  setWorkspaceCredential,
  clearWorkspaceCredential,
} from '../../lib/connection-binding.js';
import { mirrorRefreshedCredentialIntoOwnerRows } from '../../lib/workspace-token-refresh.js';

const cbBinding = (provider, scope, connectionId) => ({ provider, scope, connectionId });

describe('LIN-3124 PR3 checkpoint B — isActiveBinding (D2)', () => {
  test('legacy: provider + token-equality against the scalar mirror', () => {
    const ws = { id: 'w', provider: 'linear', accessToken: 'M', credentials: { token: 'M' } };
    assert.strictEqual(isActiveBinding(ws, { provider: 'linear', scope: 's', credentials: { token: 'M' } }), true);
    assert.strictEqual(isActiveBinding(ws, { provider: 'linear', scope: 's', credentials: { token: 'OTHER' } }), false);
    assert.strictEqual(isActiveBinding(ws, { provider: 'github', scope: 's', credentials: { token: 'M' } }), false);
  });

  test('connection-backed: the marker is authoritative', () => {
    const ws = { id: 'w', provider: 'github', activeBinding: { provider: 'github', scope: 'o/r2' }, bindings: [cbBinding('github', 'o/r1', 'c1'), cbBinding('github', 'o/r2', 'c2')] };
    assert.strictEqual(isActiveBinding(ws, cbBinding('github', 'o/r2', 'c2')), true);
    assert.strictEqual(isActiveBinding(ws, cbBinding('github', 'o/r1', 'c1')), false);
    assert.strictEqual(isActiveBinding({ ...ws, activeBinding: undefined }, cbBinding('github', 'o/r2', 'c2')), false);
  });

  test('two same-provider connection-backed bindings: marker selects, no marker is AMBIGUOUS', () => {
    const kb = { id: 'w', urlKey: 'u', provider: 'github', bindings: [cbBinding('github', 'o/r1', 'c1'), cbBinding('github', 'o/r2', 'c2')] };
    try {
      setWorkspaceCredential(kb, { token: 'active-tok' });
      assert.deepStrictEqual(getWorkspaceCallScope(kb), AMBIGUOUS_CALL_SCOPE, 'no marker + two bindings refuses');

      setBindingCredential(kb.bindings[1], { token: 'active-tok' });
      kb.activeBinding = { provider: 'github', scope: 'o/r2' };
      assert.deepStrictEqual(getWorkspaceCallScope(kb), { token: 'active-tok', repo: 'o/r2' }, 'marker selects r2');
    } finally {
      clearWorkspaceCredential(kb);
    }
  });
});

describe('LIN-3124 PR3 checkpoint B — keystone shape preservation (T22)', () => {
  test('linkProvider over an existing connection-backed binding is a no-op', () => {
    const cb = cbBinding('github', 'o/r', 'acct::github::4242');
    const ws = { id: 'w', provider: 'linear', accessToken: 'lin', credentials: { token: 'lin' }, bindings: [cb] };
    const before = JSON.stringify(ws);
    linkProvider(ws, 'github', 'o/r', { token: 'NEW' });
    assert.strictEqual(JSON.stringify(ws), before, 'unchanged: no credentials, no mirror, no marker rewrite');
    assert.strictEqual(ws.bindings[0].credentials, undefined);
    assert.strictEqual(ws.bindings[0].connectionId, 'acct::github::4242');
  });

  test('linkProvider over a legacy binding still merges (byte-identical)', () => {
    const ws = { id: 'w', urlKey: 'u', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'old', keep: 1 } }] };
    linkProvider(ws, 'linear', 'org', { token: 'new' });
    assert.deepStrictEqual(ws.bindings[0].credentials, { token: 'new', keep: 1 });
    assert.strictEqual(ws.accessToken, 'new');
  });

  test('upsertWorkspace preserves an existing connection-backed binding absent from the incoming set', () => {
    const cb = cbBinding('github', 'o/r', 'c1');
    const existing = { id: 'w', urlKey: 'u', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'lin' } }, cb] };
    const session = { workspaces: [existing] };
    const incoming = { id: 'w', urlKey: 'u', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'lin2' } }] };
    upsertWorkspace(session, incoming);
    const keys = session.workspaces[0].bindings.map(b => `${b.provider}:${b.scope}`);
    assert.ok(keys.includes('github:o/r'), 'connection-backed binding survives the re-auth');
    assert.ok(keys.includes('linear:org'));
  });

  test('upsertWorkspace lets a connection-backed binding win over an incoming legacy one at the same key', () => {
    const cb = cbBinding('github', 'o/r', 'c1');
    const session = { workspaces: [{ id: 'w', urlKey: 'u', provider: 'github', bindings: [cb] }] };
    const incoming = { id: 'w', urlKey: 'u', provider: 'github', bindings: [{ provider: 'github', scope: 'o/r', credentials: { token: 'legacy' } }] };
    upsertWorkspace(session, incoming);
    assert.strictEqual(session.workspaces[0].bindings[0].connectionId, 'c1');
    assert.strictEqual(session.workspaces[0].bindings[0].credentials, undefined);
  });

  test('upsertWorkspace is the identity on a legacy-only container', () => {
    const session = { workspaces: [{ id: 'w', urlKey: 'u', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'old' } }] }] };
    const incoming = { id: 'w', urlKey: 'u', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'new' } }] };
    upsertWorkspace(session, incoming);
    assert.deepStrictEqual(session.workspaces[0].bindings, incoming.bindings, 'same array reference — byte-identical');
  });

  test('remintActiveCredential refuses a connection-backed active binding', async () => {
    const ws = { id: 'w', provider: 'github', activeBinding: { provider: 'github', scope: 'o/r' }, bindings: [cbBinding('github', 'o/r', 'c1')] };
    await assert.rejects(
      () => remintActiveCredential(ws, { refreshCredential: async () => ({ token: 'x' }) }),
      /refusing to re-mint a connection-backed binding/
    );
  });

  test('remintActiveCredential still re-mints a legacy binding', async () => {
    const ws = { id: 'w', urlKey: 'u', provider: 'github', accessToken: 'old', bindings: [{ provider: 'github', scope: 'o/r', credentials: { token: 'old', installationId: '1' } }] };
    await remintActiveCredential(ws, { refreshCredential: async () => ({ token: 'new' }) });
    assert.strictEqual(ws.accessToken, 'new');
  });

  test('applyAccessTokenToWorkspace is a no-op on a connection-backed active binding', () => {
    const ws = { id: 'w', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org' }, bindings: [cbBinding('linear', 'org', 'c1')] };
    const before = JSON.stringify(ws);
    applyAccessTokenToWorkspace(ws, 'LEAK', 123);
    assert.strictEqual(JSON.stringify(ws), before, 'no scalar mirror, no credentials written');
  });

  test('applyAccessTokenToWorkspace still mirrors a legacy workspace (byte-identical)', () => {
    const ws = { id: 'w', provider: 'linear', credentials: { token: 'old' }, bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'old' } }] };
    applyAccessTokenToWorkspace(ws, 'new', 999);
    assert.strictEqual(ws.accessToken, 'new');
    assert.strictEqual(ws.tokenExpiresAt, 999);
    assert.strictEqual(ws.credentials.token, 'new');
    assert.strictEqual(ws.bindings[0].credentials.token, 'new');
  });

  test('setActiveProvider marks a connection-backed binding and strips the scalar mirror (D2)', () => {
    const ws = {
      id: 'w', urlKey: 'u', provider: 'linear', accessToken: 'lin', credentials: { token: 'lin' },
      bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'lin' } }, cbBinding('jira', 'https://s', 'cj')],
    };
    setActiveProvider(ws, 'jira', 'https://s');
    assert.deepStrictEqual(ws.activeBinding, { provider: 'jira', scope: 'https://s' });
    assert.strictEqual(ws.provider, 'jira');
    assert.strictEqual(ws.accessToken, undefined);
    assert.strictEqual(ws.credentials, undefined);
  });

  test('setActiveProvider on a legacy binding keeps the scalar mirror (byte-identical)', () => {
    const ws = { id: 'w', provider: 'linear', credentials: { token: 'lin' }, accessToken: 'lin', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'lin' } }, { provider: 'jira', scope: 'https://s', credentials: { token: 'jt', email: 'e' } }] };
    setActiveProvider(ws, 'jira', 'https://s');
    assert.strictEqual(ws.provider, 'jira');
    assert.strictEqual(ws.accessToken, 'jt');
    assert.strictEqual(ws.activeBinding, undefined);
  });

  test('unlinkProvider clears the marker when the last binding is removed', () => {
    const ws = { id: 'w', urlKey: 'u', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org' }, bindings: [cbBinding('linear', 'org', 'c1')] };
    unlinkProvider(ws, 'linear', 'org');
    assert.strictEqual(ws.activeBinding, undefined);
    assert.strictEqual(ws.provider, undefined);
    assert.strictEqual(ws.bindings.length, 0);
  });
});

describe('LIN-3124 PR3 checkpoint B — headless mirror loop skips connection-backed rows', () => {
  test('a connection-backed active row is not mirrored; a legacy row is', async () => {
    const legacyWs = { id: 'l', urlKey: 'u', provider: 'linear', accessToken: 'old', credentials: { token: 'old' } };
    const cbWs = { id: 'c', urlKey: 'u', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org' }, bindings: [cbBinding('linear', 'org', 'c1')] };
    const sessions = [
      { _id: 's-legacy', session: { accountId: 'acct', workspaces: [legacyWs] } },
      { _id: 's-cb', session: { accountId: 'acct', workspaces: [cbWs] } },
    ];
    const persisted = [];
    await mirrorRefreshedCredentialIntoOwnerRows({
      sessions, urlKey: 'u', ownerAccountId: 'acct', token: 'NEW', expiresAt: 123,
      persistSession: async (sid) => { persisted.push(sid); },
    });
    assert.strictEqual(legacyWs.accessToken, 'NEW');
    assert.strictEqual(legacyWs.tokenExpiresAt, 123);
    assert.strictEqual(cbWs.accessToken, undefined, 'connection-backed row skipped');
    assert.deepStrictEqual(persisted, ['s-legacy'], 'only the legacy row is persisted');
  });
});

describe('LIN-3124 PR3 checkpoint B — selectActiveBinding via getWorkspaceCallScope (getBindingsForWorkspace untouched)', () => {
  test('single connection-backed binding with marker resolves its scope', () => {
    const ws = { id: 'w', provider: 'jira', activeBinding: { provider: 'jira', scope: 'https://s' }, bindings: [cbBinding('jira', 'https://s', 'cj')] };
    try {
      setWorkspaceCredential(ws, { token: 'jt', authType: 'oauth', cloudId: 'cloud-1' });
      setBindingCredential(ws.bindings[0], { token: 'jt', authType: 'oauth', cloudId: 'cloud-1' });
      assert.deepStrictEqual(getWorkspaceCallScope(ws), { authType: 'oauth', accessToken: 'jt', cloudId: 'cloud-1', site: 'https://s' });
    } finally {
      clearWorkspaceCredential(ws);
    }
  });

  test('getWorkspaceToken reads the active connection-backed token from the side-table', () => {
    const b = cbBinding('linear', 'org', 'c1');
    const ws = { id: 'w', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org' }, bindings: [b] };
    assert.strictEqual(getWorkspaceToken(ws), undefined, 'fail closed before hydration');
    try {
      setBindingCredential(b, { token: 'conn' });
      setWorkspaceCredential(ws, { token: 'conn' });
      assert.strictEqual(getWorkspaceToken(ws), 'conn');
      assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org'), 'conn');
      assert.strictEqual(getBindingsForWorkspace(ws)[0].credentials, undefined);
    } finally {
      clearWorkspaceCredential(ws);
    }
  });
});