/**
 * LIN-3124 PR3 — checkpoint A darkness / byte-identity (D1, D15, F4).
 *
 * Proves the accessor side-table hook-up is DARK: for every legacy shape the
 * accessors evaluate the verbatim legacy expression, and the raw E2 accessors
 * (getWorkspaceMirrorToken / getWorkspaceTokenExpiry) are unchanged. For a
 * connection-backed binding with no hydrated entry, the binding accessor fails
 * closed (undefined) rather than serving a session copy. The side-table is only
 * served when a credential was explicitly hydrated by the seam.
 *
 * Run: node --test tests/unit/lin-3124-pr3-darkness.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../lib/providers/index.js'; // register the provider barrel (linear/github/jira)
import {
  getWorkspaceToken,
  getWorkspaceMirrorToken,
  getWorkspaceTokenExpiry,
  getWorkspaceCallScope,
  getBindingCallScope,
  getBindingCredentials,
  getBindingsForWorkspace,
  resolveIssueBinding,
} from '../../lib/workspace.js';
import {
  setBindingCredential,
  setWorkspaceCredential,
  clearWorkspaceCredential,
} from '../../lib/connection-binding.js';

const CONN_ID = 'acct1::linear::org-1';

function legacyWorkspace(overrides = {}) {
  return {
    id: 'org-1',
    urlKey: 'acme',
    provider: 'linear',
    credentials: { token: 'NEW-credential' },
    accessToken: 'OLD-mirror',
    tokenExpiresAt: 1000,
    ...overrides,
  };
}

function legacyBinding(overrides = {}) {
  return { provider: 'linear', scope: 'org-1', credentials: { token: 'b-token' }, ...overrides };
}

function connectionBackedBinding(overrides = {}) {
  return { provider: 'linear', scope: 'org-1', connectionId: CONN_ID, ...overrides };
}

describe('LIN-3124 PR3 checkpoint A — legacy byte-identity', () => {
  test('getWorkspaceToken(ws) equals the verbatim legacy E1 expression', () => {
    const cases = [
      legacyWorkspace(),
      legacyWorkspace({ credentials: undefined }),
      legacyWorkspace({ credentials: undefined, accessToken: undefined }),
      { id: 'x', urlKey: 'y' },
      null,
      undefined,
    ];
    for (const ws of cases) {
      const expected = ws?.credentials?.token ?? ws?.accessToken;
      assert.strictEqual(getWorkspaceToken(ws), expected);
    }
  });

  test('the raw E2 mirror/expiry accessors are unchanged (F4)', () => {
    const ws = legacyWorkspace();
    assert.strictEqual(getWorkspaceMirrorToken(ws), ws.accessToken);
    assert.strictEqual(getWorkspaceTokenExpiry(ws), ws.tokenExpiresAt);
    // E2 must NOT prefer the richer credential the way E1 does.
    assert.notStrictEqual(getWorkspaceMirrorToken(ws), ws.credentials.token);
  });

  test('getBindingCredentials returns the SAME legacy credentials object', () => {
    const b = legacyBinding();
    assert.strictEqual(getBindingCredentials(b), b.credentials);
    assert.strictEqual(getBindingCredentials(undefined), undefined);
  });

  test('3-arg getWorkspaceToken reads the matching legacy binding', () => {
    const ws = { ...legacyWorkspace(), bindings: [legacyBinding(), legacyBinding({ scope: 'org-2', credentials: { token: 'other' } })] };
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org-1'), 'b-token');
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org-2'), 'other');
    assert.strictEqual(getWorkspaceToken(ws, 'github'), undefined);
  });

  test('getBindingCallScope legacy projections are byte-identical', () => {
    assert.strictEqual(getBindingCallScope(legacyBinding()), 'b-token');
    assert.deepEqual(
      getBindingCallScope({ provider: 'github', scope: 'o/r', credentials: { token: 'gh' } }),
      { token: 'gh', repo: 'o/r' }
    );
    assert.deepEqual(
      getBindingCallScope({ provider: 'github-projects', scope: 'board', credentials: { token: 'gp' } }),
      { token: 'gp', scope: 'board' }
    );
    assert.deepEqual(
      getBindingCallScope({ provider: 'jira', scope: 'https://s', credentials: { token: 'jt', authType: 'oauth', cloudId: 'c1' } }),
      { authType: 'oauth', accessToken: 'jt', cloudId: 'c1', site: 'https://s' }
    );
    assert.deepEqual(
      getBindingCallScope({ provider: 'jira', scope: 'https://s', credentials: { token: 'jt', email: 'e@x' } }),
      { email: 'e@x', apiToken: 'jt', site: 'https://s' }
    );
  });

  test('getWorkspaceCallScope legacy projections are byte-identical', () => {
    assert.strictEqual(getWorkspaceCallScope(legacyWorkspace()), 'NEW-credential');
    const gh = { ...legacyWorkspace(), provider: 'github', credentials: { token: 'gh' }, bindings: [{ provider: 'github', scope: 'o/r', credentials: { token: 'gh' } }] };
    assert.deepEqual(getWorkspaceCallScope(gh), { token: 'gh', repo: 'o/r' });
  });

  test('resolveIssueBinding legacy fallback is unchanged', () => {
    const ws = legacyWorkspace();
    const resolved = resolveIssueBinding(ws, null);
    assert.strictEqual(resolved.callScope, getWorkspaceCallScope(ws));
  });

  test('legacy binds synthesize one binding and never consult a side-table', () => {
    const ws = legacyWorkspace({ bindings: undefined });
    const synthesized = getBindingsForWorkspace(ws);
    assert.strictEqual(synthesized.length, 1);
    assert.strictEqual(synthesized[0].connectionId, undefined);
  });
});

describe('LIN-3124 PR3 checkpoint A — connection-backed fail-closed + hydrated', () => {
  test('an unhydrated connection-backed binding fails closed (D15)', () => {
    const b = connectionBackedBinding();
    assert.strictEqual(getBindingCredentials(b), undefined);
    assert.strictEqual(getBindingCallScope(b), undefined);
    const ws = { ...legacyWorkspace({ credentials: undefined, accessToken: undefined }), bindings: [b], activeBinding: { provider: 'linear', scope: 'org-1' } };
    assert.strictEqual(getWorkspaceToken(ws), undefined);
    assert.strictEqual(getWorkspaceCallScope(ws), undefined);
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org-1'), undefined);
  });

  test('a hydrated connection-backed binding/workspace serves the side-table', () => {
    const b = connectionBackedBinding();
    const ws = { ...legacyWorkspace({ credentials: undefined, accessToken: undefined, tokenExpiresAt: undefined }), bindings: [b], activeBinding: { provider: 'linear', scope: 'org-1' } };
    setBindingCredential(b, { token: 'conn-tok' });
    setWorkspaceCredential(ws, { token: 'conn-tok' });
    try {
      assert.deepEqual(getBindingCredentials(b), { token: 'conn-tok' });
      assert.strictEqual(getBindingCallScope(b), 'conn-tok');
      assert.strictEqual(getWorkspaceToken(ws), 'conn-tok');
      assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org-1'), 'conn-tok');
      assert.strictEqual(getWorkspaceCallScope(ws), 'conn-tok');
      // The raw mirror is still E2 and connection-backed workspaces carry none.
      assert.strictEqual(getWorkspaceMirrorToken(ws), undefined);
      assert.strictEqual(getWorkspaceTokenExpiry(ws), undefined);
      // The bind itself still carries no credentials (nothing to persist).
      assert.strictEqual(b.credentials, undefined);
    } finally {
      clearWorkspaceCredential(ws);
    }
  });

  test('a hydrated Jira OAuth connection-backed binding projects from the side-table', () => {
    const b = { provider: 'jira', scope: 'https://site', connectionId: 'acct1::jira::https://site' };
    setBindingCredential(b, { token: 'jt', authType: 'oauth', cloudId: 'cloud-1' });
    assert.deepEqual(
      getBindingCallScope(b),
      { authType: 'oauth', accessToken: 'jt', cloudId: 'cloud-1', site: 'https://site' }
    );
  });
});