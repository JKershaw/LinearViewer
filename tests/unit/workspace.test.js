/**
 * Unit tests for lib/workspace.js
 *
 * Run with: node --test tests/unit/workspace.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getActiveWorkspace,
  upsertWorkspace,
  removeWorkspace,
  updateWorkspaceTokens,
  persistOwnerCredential,
  getWorkspaceToken,
  linkProvider,
  unlinkProvider,
  setActiveProvider,
  getBindingsForWorkspace,
  getBindingCallScope,
  getWorkspaceCallScope,
  resolveIssueBinding,
  remintActiveCredential,
  saveSession,
  MAX_WORKSPACES
} from '../../lib/workspace.js';
import { registerProvider } from '../../lib/providers/registry.js';

// LIN-1523: fake durable owner-credential store — records every `put` call so
// tests can assert on write count/args without a real backing collection.
function fakeCredentialStore() {
  const calls = [];
  const records = new Map();
  const key = (accountId, urlKey) => `${accountId}::${urlKey}`;
  return {
    calls,
    async put(accountId, urlKey, credential) {
      calls.push({ op: 'put', accountId, urlKey, credential });
      records.set(key(accountId, urlKey), credential);
    },
    async get(accountId, urlKey) {
      return records.get(key(accountId, urlKey)) ?? null;
    },
    async delete(accountId, urlKey) {
      calls.push({ op: 'delete', accountId, urlKey });
      records.delete(key(accountId, urlKey));
    },
  };
}

// =============================================================================
// updateWorkspaceTokens Tests
// =============================================================================

describe('updateWorkspaceTokens', () => {
  test('updates workspace with token data', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Test Workspace'
    };
    const tokenData = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600
    };

    updateWorkspaceTokens(workspace, tokenData);

    assert.strictEqual(workspace.accessToken, 'new-access-token');
    // LIN-1524: refreshToken is never written to the workspace (durable-store-only).
    assert.strictEqual(workspace.refreshToken, undefined);
    assert.ok(workspace.tokenExpiresAt > Date.now());
    assert.ok(workspace.tokenExpiresAt <= Date.now() + 3600 * 1000);
  });

  test('overwrites existing token data, and never touches a stale legacy refreshToken', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Test Workspace',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      tokenExpiresAt: Date.now() - 1000
    };
    const tokenData = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 7200
    };

    updateWorkspaceTokens(workspace, tokenData);

    assert.strictEqual(workspace.accessToken, 'new-access-token');
    // LIN-1524: a stale legacy refreshToken is left exactly as it was — never
    // overwritten with the new one, never cleared. updateWorkspaceTokens
    // simply never touches this field at all now.
    assert.strictEqual(workspace.refreshToken, 'old-refresh-token');
    assert.ok(workspace.tokenExpiresAt > Date.now());
  });

  test('preserves non-token workspace properties', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Test Workspace',
      urlKey: 'test-workspace',
      addedAt: 12345,
      customField: 'should-remain'
    };
    const tokenData = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600
    };

    updateWorkspaceTokens(workspace, tokenData);

    assert.strictEqual(workspace.id, 'ws-1');
    assert.strictEqual(workspace.name, 'Test Workspace');
    assert.strictEqual(workspace.urlKey, 'test-workspace');
    assert.strictEqual(workspace.addedAt, 12345);
    assert.strictEqual(workspace.customField, 'should-remain');
  });

  test('handles zero expires_in', () => {
    const workspace = {};
    const tokenData = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 0
    };

    updateWorkspaceTokens(workspace, tokenData);

    // Should set tokenExpiresAt close to current time
    assert.ok(Math.abs(workspace.tokenExpiresAt - Date.now()) < 1000);
  });

  test('handles large expires_in value', () => {
    const workspace = {};
    const tokenData = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 86400 * 30 // 30 days
    };

    updateWorkspaceTokens(workspace, tokenData);

    const expectedExpiry = Date.now() + 86400 * 30 * 1000;
    assert.ok(Math.abs(workspace.tokenExpiresAt - expectedExpiry) < 1000);
  });

  // Provider-aware write shape (LIN-334 / S2)
  test('writes generalized {provider, credentials} shape', () => {
    const workspace = { id: 'ws-1', name: 'Test Workspace' };
    updateWorkspaceTokens(workspace, {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600
    });

    assert.strictEqual(workspace.provider, 'linear');
    assert.deepStrictEqual(workspace.credentials, { token: 'new-access-token' });
  });

  test('written shape reads back through getWorkspaceToken (dual-read round-trip)', () => {
    const workspace = { id: 'ws-1' };
    updateWorkspaceTokens(workspace, {
      access_token: 'round-trip-token',
      refresh_token: 'r',
      expires_in: 3600
    });

    // New canonical seam resolves to credentials.token.
    assert.strictEqual(getWorkspaceToken(workspace), 'round-trip-token');
    // Legacy field is still populated for un-migrated read sites (S3+).
    assert.strictEqual(workspace.accessToken, 'round-trip-token');
  });

  test('refresh rotates credentials.token and preserves other credential fields', () => {
    const workspace = {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'old-token', scope: 'read,write' }
    };
    updateWorkspaceTokens(workspace, {
      access_token: 'rotated-token',
      refresh_token: 'r2',
      expires_in: 3600
    });

    assert.strictEqual(workspace.credentials.token, 'rotated-token');
    assert.strictEqual(workspace.credentials.scope, 'read,write');
    assert.strictEqual(getWorkspaceToken(workspace), 'rotated-token');
  });

  // LIN-562: the refresh middleware shares this writer, so a refreshed token must
  // land inside the active binding too — otherwise bindings[] goes stale.
  test('rotates the active binding in lockstep with the scalar mirror (LIN-562)', () => {
    const workspace = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', {
      token: 'old-token', tokenExpiresAt: 1
    });

    updateWorkspaceTokens(workspace, {
      access_token: 'fresh-token', refresh_token: 'fresh-ref', expires_in: 3600
    });

    const binding = workspace.bindings.find(b => b.provider === 'linear');
    assert.strictEqual(binding.credentials.token, 'fresh-token');
    assert.strictEqual(binding.credentials.tokenExpiresAt, workspace.tokenExpiresAt);
    // LIN-1524: refreshToken is never rotated into the binding either — durable-store-only.
    assert.strictEqual(binding.credentials.refreshToken, undefined);
    // Scalar mirror + per-binding token agree (no drift).
    assert.strictEqual(getWorkspaceToken(workspace), 'fresh-token');
    assert.strictEqual(getWorkspaceToken(workspace, 'linear', 'org-1'), 'fresh-token');
  });

  test('does not synthesize a binding for legacy workspaces on refresh (byte-identical)', () => {
    const workspace = { id: 'ws-1', accessToken: 'old' };
    updateWorkspaceTokens(workspace, { access_token: 'new', refresh_token: 'r', expires_in: 3600 });
    // No bindings[] grown — legacy workspaces stay scalar-only and rely on
    // getBindingsForWorkspace synthesizing on read.
    assert.strictEqual(workspace.bindings, undefined);
  });
});

// =============================================================================
// persistOwnerCredential Tests (LIN-1523, Session 1)
// =============================================================================

describe('persistOwnerCredential', () => {
  test('writes the credential already sitting on an already-mutated workspace, using the explicitly-passed refreshToken (LIN-1524: never read off workspace)', async () => {
    const workspace = {
      id: 'ws-1',
      urlKey: 'acme',
      provider: 'linear',
      accessToken: 'access-1',
      tokenExpiresAt: 12345,
      bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'access-1' } }],
    };
    const store = fakeCredentialStore();

    await persistOwnerCredential('account-A', workspace, store, 'refresh-1');

    assert.strictEqual(store.calls.length, 1);
    assert.strictEqual(store.calls[0].accountId, 'account-A');
    assert.strictEqual(store.calls[0].urlKey, 'acme');
    assert.strictEqual(store.calls[0].credential.token, 'access-1');
    assert.strictEqual(store.calls[0].credential.refreshToken, 'refresh-1');
    assert.strictEqual(store.calls[0].credential.tokenExpiresAt, 12345);
    assert.strictEqual(store.calls[0].credential.scope, 'org-1');
  });

  test('a stray workspace.refreshToken (e.g. a legacy leftover) is IGNORED — only the explicit parameter is ever persisted', async () => {
    const workspace = {
      id: 'ws-1',
      urlKey: 'acme',
      provider: 'linear',
      accessToken: 'access-1',
      refreshToken: 'stale-legacy-value',
      tokenExpiresAt: 12345,
      bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'access-1' } }],
    };
    const store = fakeCredentialStore();

    await persistOwnerCredential('account-A', workspace, store, 'the-real-one');

    assert.strictEqual(store.calls[0].credential.refreshToken, 'the-real-one');
  });
});

// =============================================================================
// linkProvider Tests (LIN-562)
// =============================================================================

describe('linkProvider', () => {
  test('attaches a (provider, scope) binding with nested credentials', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', {
      token: 'tok', refreshToken: 'ref', tokenExpiresAt: 999
    });
    assert.deepStrictEqual(ws.bindings, [
      { provider: 'linear', scope: 'org-1', credentials: { token: 'tok', refreshToken: 'ref', tokenExpiresAt: 999 } }
    ]);
  });

  test('writes the legacy scalar mirror for the active binding (readers stay green)', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', {
      token: 'tok', refreshToken: 'ref', tokenExpiresAt: 999
    });
    assert.strictEqual(ws.provider, 'linear');
    assert.deepStrictEqual(ws.credentials, { token: 'tok' });
    assert.strictEqual(ws.accessToken, 'tok');
    assert.strictEqual(ws.tokenExpiresAt, 999);
    // LIN-1524: refreshToken is deliberately NEVER mirrored onto the scalar
    // workspace object, even when the caller passed one in credentials — it
    // stays inside binding.credentials only (a real Linear call site no
    // longer passes one at all; this proves linkProvider itself withholds it
    // from the scalar mirror regardless).
    assert.strictEqual(ws.refreshToken, undefined);
    // No-arg getWorkspaceToken stays byte-identical (reads the scalar mirror).
    assert.strictEqual(getWorkspaceToken(ws), 'tok');
  });

  test('defaults active provider when unset; never clobbers an existing one', () => {
    const ws = linkProvider({ id: 'ws-1', provider: 'linear' }, 'local', 'scratch', { token: 'scratch' });
    // provider already set → preserved; local is a second, non-active binding.
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.bindings[0].provider, 'local');
  });

  test('a non-active second binding does not clobber the primary scalar mirror', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'linear-tok', refreshToken: 'lr' });
    linkProvider(ws, 'local', 'scratch', { token: 'local-tok' });
    // Scalar mirror still reflects the active (linear) binding.
    assert.strictEqual(getWorkspaceToken(ws), 'linear-tok');
    assert.strictEqual(ws.accessToken, 'linear-tok');
    // LIN-1524: never mirrored onto the scalar object regardless of active/non-active.
    assert.strictEqual(ws.refreshToken, undefined);
    // But the local token is reachable by (provider, scope).
    assert.strictEqual(getWorkspaceToken(ws, 'local', 'scratch'), 'local-tok');
    assert.strictEqual(ws.bindings.length, 2);
  });

  test('re-linking the same (provider, scope) upserts (merges) credentials, not duplicates', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 't1', scope: 'read,write' });
    linkProvider(ws, 'linear', 'org-1', { token: 't2' });
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.bindings[0].credentials.token, 't2');
    // Pre-existing non-token credential fields survive the merge.
    assert.strictEqual(ws.bindings[0].credentials.scope, 'read,write');
  });

  test('same provider, different scope yields two distinct bindings', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'github', 'owner/repo', { token: 'gh' });
    linkProvider(ws, 'github', 'org/5', { token: 'gh' });
    assert.strictEqual(ws.bindings.length, 2);
    assert.deepStrictEqual(ws.bindings.map(b => b.scope), ['owner/repo', 'org/5']);
  });
});

// =============================================================================
// unlinkProvider Tests (LIN-634)
// =============================================================================

describe('unlinkProvider', () => {
  test('removes the matching (provider, scope) binding', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin' });
    linkProvider(ws, 'github', 'owner/repo', { token: 'gh' });
    unlinkProvider(ws, 'github', 'owner/repo');
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.bindings[0].provider, 'linear');
  });

  test('removes only the matching scope when a provider has two bindings', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'github', 'owner/repo', { token: 'a' });
    linkProvider(ws, 'github', 'org/5', { token: 'b' });
    unlinkProvider(ws, 'github', 'owner/repo');
    assert.deepStrictEqual(ws.bindings.map(b => b.scope), ['org/5']);
  });

  test('is a no-op for an unknown (provider, scope)', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin' });
    unlinkProvider(ws, 'github', 'nope');
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.accessToken, 'lin');
  });

  test('repoints active provider + scalar mirror when the active binding is removed', () => {
    // linear is the active binding (first link wins); add a second provider.
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });
    linkProvider(ws, 'local', 'scratch', { token: 'loc', tokenExpiresAt: 999 });
    assert.strictEqual(ws.provider, 'linear');

    unlinkProvider(ws, 'linear', 'org-1');

    // Active pointer + scalar mirror now reflect the remaining (local) binding.
    assert.strictEqual(ws.provider, 'local');
    assert.strictEqual(ws.accessToken, 'loc');
    assert.strictEqual(ws.credentials.token, 'loc');
    assert.strictEqual(ws.tokenExpiresAt, 999);
    assert.strictEqual(getBindingsForWorkspace(ws).length, 1);
  });

  test('leaves the active scalar mirror untouched when a non-active binding is removed', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin' });
    linkProvider(ws, 'local', 'scratch', { token: 'loc' });
    unlinkProvider(ws, 'local', 'scratch');
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.accessToken, 'lin');
  });

  test('clears the active pointer and scalar mirror when the last binding is removed', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr' });
    unlinkProvider(ws, 'linear', 'org-1');
    assert.strictEqual(ws.bindings.length, 0);
    assert.strictEqual(ws.provider, undefined);
    assert.strictEqual(ws.accessToken, undefined);
    assert.strictEqual(ws.credentials, undefined);
    assert.strictEqual(ws.refreshToken, undefined);
  });

  test('never deletes the workspace object itself', () => {
    const ws = linkProvider({ id: 'ws-1', name: 'Keep me' }, 'linear', 'org-1', { token: 'lin' });
    unlinkProvider(ws, 'linear', 'org-1');
    assert.strictEqual(ws.id, 'ws-1');
    assert.strictEqual(ws.name, 'Keep me');
  });

  test('is a no-op on a workspace with no bindings', () => {
    const ws = { id: 'ws-1' };
    assert.doesNotThrow(() => unlinkProvider(ws, 'linear', 'org-1'));
    assert.strictEqual(ws.id, 'ws-1');
  });
});

// LIN-1523 (beat 4) + LIN-1524 close-out Finding #2 (fixed here): the
// provider-removal route (server.js) captures a reference to the RAW
// `workspace.bindings` array before the call, then calls
// unlinkProvider(workspace, provider, scope), then, only when
// `provider === 'linear' && workspace.bindings !== bindingsBefore` (reference
// identity — unlinkProvider only ever reassigns `bindings` on an actual
// removal), ownerCredentialStore.delete(accountId, workspace.urlKey) —
// exactly this sequence, composed here since server.js itself isn't
// import-safe in a unit test (see
// tests/unit/provider-remove-durable-delete.test.js's source-text guard for
// proof the route actually wires it this way). This proves the EFFECT of
// that composition on real store contents, not just that a call happened.
//
// NOTE: getBindingsForWorkspace(workspace).length is NOT a safe before/after
// signal here — it SYNTHESIZES a phantom binding whenever workspace.bindings
// is empty/absent, so a real removal that empties bindings to [] would read
// back as an unchanged count. Reference identity on the raw array sidesteps
// that trap entirely.
describe('unlinkProvider + durable delete, composed as the provider-removal route calls them', () => {
  // Mirrors the route's own before/after signal exactly (server.js's fix for
  // Finding #2) rather than re-deriving a different one here.
  function bindingRemoved(workspace, bindingsBefore) {
    return workspace.bindings !== bindingsBefore;
  }

  test('unlinking the active Linear binding: the session-side delete happens (unchanged unlinkProvider behaviour) AND the durable record is gone', async () => {
    const store = fakeCredentialStore();
    await store.put('account-A', 'acme', { provider: 'linear', scope: 'org-1', token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });

    const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });
    const unlinkTarget = 'linear'; // the request's `provider` — matches the route's own variable
    const bindingsBefore = ws.bindings;
    unlinkProvider(ws, unlinkTarget, 'org-1');
    const removed = bindingRemoved(ws, bindingsBefore);
    if (unlinkTarget === 'linear' && removed) {
      await store.delete('account-A', ws.urlKey);
    }

    // The session-side delete already happened inside unlinkProvider (existing,
    // untouched behaviour) — the last binding was removed, so the scalar
    // mirror is cleared.
    assert.strictEqual(ws.bindings.length, 0);
    assert.strictEqual(ws.refreshToken, undefined);

    // And the durable record is gone too — asserted on the store's actual
    // contents (a point read), not on whether delete() was called.
    assert.strictEqual(await store.get('account-A', 'acme'), null);
  });

  test('unlinking a non-Linear binding leaves the Linear durable record untouched — the route\'s guard is provider-scoped', async () => {
    const store = fakeCredentialStore();
    await store.put('account-A', 'acme', { provider: 'linear', scope: 'org-1', token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });

    const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });
    linkProvider(ws, 'github', 'owner/repo', { token: 'gh' });
    const unlinkTarget = 'github';
    const bindingsBefore = ws.bindings;
    unlinkProvider(ws, unlinkTarget, 'owner/repo');
    const removed = bindingRemoved(ws, bindingsBefore);
    if (unlinkTarget === 'linear' && removed) {
      await store.delete('account-A', ws.urlKey); // never reached — the guard is false
    }

    // Linear's own binding survives, and so must its durable record.
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.bindings[0].provider, 'linear');
    const survived = await store.get('account-A', 'acme');
    assert.ok(survived, 'the Linear durable record must survive an unrelated (github) unlink');
    assert.strictEqual(survived.refreshToken, 'lr');
  });

  test('LIN-1524 close-out Finding #2 (the actual bug): unlinking Linear with a non-matching scope is a no-op — the durable record must SURVIVE, not be deleted', async () => {
    const store = fakeCredentialStore();
    await store.put('account-A', 'acme', { provider: 'linear', scope: 'org-1', token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });

    const ws = linkProvider({ id: 'ws-1', urlKey: 'acme' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });
    const unlinkTarget = 'linear';
    const bogusScope = 'org-does-not-match';
    const bindingsBefore = ws.bindings;
    unlinkProvider(ws, unlinkTarget, bogusScope); // no-op: (provider, scope) doesn't match any binding
    const removed = bindingRemoved(ws, bindingsBefore);

    // The pre-fix bug: gating only on `provider === 'linear'` (ignoring
    // `removed`) would delete the durable record here even though the
    // session binding is untouched. The fix requires BOTH.
    assert.strictEqual(removed, false, 'a non-matching scope must not be observed as a removal');
    if (unlinkTarget === 'linear' && removed) {
      await store.delete('account-A', ws.urlKey); // must NOT be reached
    }

    // Session binding survives untouched (unlinkProvider's own no-op).
    // LIN-1524: no ws.refreshToken assertion here — linkProvider no longer
    // mirrors one onto the workspace at all (durable-store-only now).
    assert.strictEqual(ws.bindings.length, 1);

    // And critically, so must the durable record — this is the bug this
    // test pins: a POST with provider=linear and a bogus scope must not
    // brick a workspace whose session credential still works.
    const survived = await store.get('account-A', 'acme');
    assert.ok(survived, 'the durable record must survive a no-op unlink (non-matching scope)');
    assert.strictEqual(survived.refreshToken, 'lr');
  });
});

// =============================================================================
// setActiveProvider Tests (LIN-717)
// =============================================================================

describe('setActiveProvider', () => {
  test('re-points the active pointer + scalar mirror to the chosen binding', () => {
    // linear is active (first link wins); GitHub is appended (coexists).
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr', tokenExpiresAt: 100 });
    linkProvider(ws, 'github', 'owner/repo', { token: 'gh', tokenExpiresAt: 999 });
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.accessToken, 'lin');

    setActiveProvider(ws, 'github', 'owner/repo');

    assert.strictEqual(ws.provider, 'github');
    assert.strictEqual(ws.accessToken, 'gh');
    assert.strictEqual(ws.credentials.token, 'gh');
    assert.strictEqual(ws.tokenExpiresAt, 999);
    // Both bindings still present — a pointer move, not a removal.
    assert.strictEqual(getBindingsForWorkspace(ws).length, 2);
  });

  test('clears refreshToken in the mirror when the target binding has none', () => {
    // Linear carries a refreshToken; GitHub App tokens do not. Switching must not
    // leave the stale Linear refreshToken in the scalar mirror.
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin', refreshToken: 'lr' });
    linkProvider(ws, 'github', 'owner/repo', { token: 'gh' });
    setActiveProvider(ws, 'github', 'owner/repo');
    assert.strictEqual(ws.refreshToken, undefined);
  });

  test('is a no-op for an unknown (provider, scope)', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin' });
    setActiveProvider(ws, 'github', 'nope');
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.accessToken, 'lin');
  });

  test('is idempotent when the binding is already active', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin', tokenExpiresAt: 100 });
    linkProvider(ws, 'github', 'owner/repo', { token: 'gh' });
    setActiveProvider(ws, 'linear', 'org-1');
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.accessToken, 'lin');
    assert.strictEqual(ws.tokenExpiresAt, 100);
  });

  test('distinguishes two same-provider bindings by scope', () => {
    // Two GitHub repos; linkProvider mirrors the last same-provider link, so repo-b
    // is active. Switching back to repo-a must re-point the mirror to repo-a's token.
    const ws = linkProvider({ id: 'ws-1' }, 'github', 'owner/a', { token: 'tok-a' });
    linkProvider(ws, 'github', 'owner/b', { token: 'tok-b' });
    assert.strictEqual(ws.accessToken, 'tok-b');

    setActiveProvider(ws, 'github', 'owner/a');

    assert.strictEqual(ws.provider, 'github');
    assert.strictEqual(ws.accessToken, 'tok-a');
  });

  test('is a no-op on a null workspace', () => {
    assert.doesNotThrow(() => setActiveProvider(null, 'linear', 'org-1'));
  });
});

// =============================================================================
// remintActiveCredential Tests (LIN-712)
// =============================================================================
// The provider-aware re-mint glue the refresh middleware routes GitHub through.
// Provider is INJECTED (a fake) so this is pure of the registry and the network.

describe('remintActiveCredential', () => {
  // A fake "minting" provider — returns a credentials patch the way the GitHub
  // provider's refreshCredential does: rotated token + real ms expiry + the
  // installationId re-mint key, and NO refreshToken.
  function fakeMintProvider(patch, seen) {
    return {
      async refreshCredential(binding) {
        seen.push(binding);
        return patch;
      },
    };
  }

  test('re-mints the active binding and rotates token + expiry through the scalar mirror', async () => {
    const ws = linkProvider({ id: 'gh-1' }, 'github', 'octocat/hello-world', {
      installationId: '987', token: 'ghs_old', tokenExpiresAt: 1000,
    });
    const seen = [];
    const provider = fakeMintProvider({ token: 'ghs_new', tokenExpiresAt: 5000, installationId: '987' }, seen);

    await remintActiveCredential(ws, provider);

    // The provider was handed the active GitHub binding (with its installationId).
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].credentials.installationId, '987');

    // Binding credentials rotated; installationId preserved via linkProvider merge.
    const binding = ws.bindings.find(b => b.provider === 'github');
    assert.strictEqual(binding.credentials.token, 'ghs_new');
    assert.strictEqual(binding.credentials.tokenExpiresAt, 5000);
    assert.strictEqual(binding.credentials.installationId, '987');

    // Scalar mirror (what ensureValidToken's expiry check reads) rotated in lockstep.
    assert.strictEqual(ws.accessToken, 'ghs_new');
    assert.strictEqual(ws.tokenExpiresAt, 5000);
    // GitHub bindings never gain a refreshToken — that would route them back to Linear.
    assert.strictEqual(ws.refreshToken, undefined);
  });

  test('selects the binding mirrored into the scalar fields when several share the provider', async () => {
    // Two GitHub repos. linkProvider mirrors the LAST same-provider link into the
    // scalar fields, so the active binding (the one the middleware's expiry check
    // reads via workspace.tokenExpiresAt) is octocat/b — the helper must refresh
    // exactly that one, leaving the other binding untouched.
    const ws = linkProvider({ id: 'gh-1' }, 'github', 'octocat/a', { installationId: '111', token: 'tok-a', tokenExpiresAt: 1 });
    linkProvider(ws, 'github', 'octocat/b', { installationId: '222', token: 'tok-b', tokenExpiresAt: 1 });
    assert.strictEqual(ws.accessToken, 'tok-b', 'precondition: scalar mirror points at the last-linked binding');
    const seen = [];
    const provider = fakeMintProvider({ token: 'tok-b2', tokenExpiresAt: 9, installationId: '222' }, seen);

    await remintActiveCredential(ws, provider);

    // It refreshed the active (tok-b / installation 222) binding, not the other.
    assert.strictEqual(seen[0].credentials.installationId, '222');
    assert.strictEqual(ws.bindings.find(b => b.scope === 'octocat/b').credentials.token, 'tok-b2');
    assert.strictEqual(ws.bindings.find(b => b.scope === 'octocat/a').credentials.token, 'tok-a');
  });

  test('throws (defensive guard) when there is no binding to refresh at all', async () => {
    // getBindingsForWorkspace synthesizes a binding for any real workspace, so the
    // only input that reaches the guard is a null workspace — the middleware never
    // passes one, but the guard fails loudly rather than minting against nothing.
    await assert.rejects(
      () => remintActiveCredential(null, fakeMintProvider({}, [])),
      /no provider binding/
    );
  });

  // LIN-1499 Phase 1 D2: ensureValidToken (server.js) now routes github-projects
  // through this same seam instead of Linear's refreshAccessToken. This proves the
  // seam itself behaves identically for github-projects as it already does for
  // github — the primitive server.js's widened branch now depends on.
  test('LIN-1499: re-mints a github-projects binding the same way as github (D2 fix)', async () => {
    const ws = linkProvider({ id: 'ghp-1' }, 'github-projects', 'octocat/board', {
      installationId: '555', token: 'ghp_old', tokenExpiresAt: 1000,
    });
    const seen = [];
    const provider = fakeMintProvider({ token: 'ghp_new', tokenExpiresAt: 6000, installationId: '555' }, seen);

    await remintActiveCredential(ws, provider);

    assert.strictEqual(seen[0].credentials.installationId, '555');
    assert.strictEqual(ws.accessToken, 'ghp_new');
    assert.strictEqual(ws.tokenExpiresAt, 6000);
    // No Linear contamination — a github-projects binding never gains a refreshToken.
    assert.strictEqual(ws.refreshToken, undefined);
  });

  test('LIN-1499: opts ({fetchImpl, now}) are forwarded to provider.refreshCredential, not dropped, and now arrives as a number', async () => {
    // Pins the beat-1 passthrough as load-bearing: a fake provider that asserts on
    // its SECOND argument fails if remintActiveCredential stops forwarding opts.
    //
    // `now` is also actually CONSUMED here (mirroring mintAppJwt's real
    // `Math.floor(now / 1000)` contract, lib/providers/github/app-auth.js:122-125)
    // rather than merely recorded: the fake provider derives tokenExpiresAt from
    // `opts.now + 1000`. If `now` regressed to a function seam, `fn + 1000`
    // coerces to a concatenated string, not the expected numeric sum, and the
    // assertion below fails instead of passing silently.
    const ws = linkProvider({ id: 'gh-2' }, 'github', 'octocat/seam', {
      installationId: '1', token: 'old', tokenExpiresAt: 1,
    });
    const fetchImpl = async () => { throw new Error('should not be called — this test only checks wiring'); };
    const now = 1_700_000_000_000;
    let receivedOpts;
    const provider = {
      async refreshCredential(binding, opts) {
        receivedOpts = opts;
        return { token: 'new', tokenExpiresAt: opts.now + 1000, installationId: '1' };
      },
    };

    await remintActiveCredential(ws, provider, { fetchImpl, now });

    assert.strictEqual(receivedOpts.fetchImpl, fetchImpl);
    assert.strictEqual(receivedOpts.now, now);
    assert.strictEqual(ws.tokenExpiresAt, now + 1000, 'now must arrive as a number, not a function, for the provider to do arithmetic on');
  });

  test('LIN-1499: opts default to {} when the caller passes none (existing server.js:611 call site stays byte-identical)', async () => {
    const ws = linkProvider({ id: 'gh-3' }, 'github', 'octocat/default', {
      installationId: '1', token: 'old', tokenExpiresAt: 1,
    });
    let receivedOpts;
    const provider = {
      async refreshCredential(binding, opts) {
        receivedOpts = opts;
        return { token: 'new', tokenExpiresAt: 2, installationId: '1' };
      },
    };

    await remintActiveCredential(ws, provider);

    assert.deepStrictEqual(receivedOpts, {});
  });
});

// =============================================================================
// getBindingsForWorkspace Tests (LIN-562)
// =============================================================================

describe('getBindingsForWorkspace', () => {
  test('returns explicit bindings when present', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'tok' });
    assert.strictEqual(getBindingsForWorkspace(ws), ws.bindings);
  });

  test('synthesizes one legacy linear binding for an un-migrated workspace (no migration)', () => {
    const ws = { id: 'org-9', provider: 'linear', accessToken: 'legacy', tokenExpiresAt: 42 };
    assert.deepStrictEqual(getBindingsForWorkspace(ws), [
      { provider: 'linear', scope: 'org-9', credentials: { token: 'legacy', tokenExpiresAt: 42 } }
    ]);
  });

  test('LIN-1524: never synthesizes a refreshToken, even from a stale legacy workspace.refreshToken field', () => {
    // A genuinely legacy (pre-cutover) session row could still carry a stale
    // workspace.refreshToken until it expires — synthesizing it into the read
    // binding would resurrect a phantom Linear refreshToken exactly where the
    // cutover means to eliminate it.
    const ws = { id: 'org-9', provider: 'linear', accessToken: 'legacy', refreshToken: 'stale-legacy-value', tokenExpiresAt: 42 };
    assert.deepStrictEqual(getBindingsForWorkspace(ws), [
      { provider: 'linear', scope: 'org-9', credentials: { token: 'legacy', tokenExpiresAt: 42 } }
    ]);
  });

  test('synthesized binding defaults provider to linear when absent', () => {
    const ws = { id: 'org-9', accessToken: 'legacy' };
    assert.strictEqual(getBindingsForWorkspace(ws)[0].provider, 'linear');
  });

  test('synthesizes a local binding scoped to urlKey (the store partition)', () => {
    const ws = { id: 'uuid-1', provider: 'local', urlKey: 'notes-abcd', accessToken: 'notes-abcd', tokenExpiresAt: Number.MAX_SAFE_INTEGER };
    assert.deepStrictEqual(getBindingsForWorkspace(ws), [
      { provider: 'local', scope: 'notes-abcd', credentials: { token: 'notes-abcd', tokenExpiresAt: Number.MAX_SAFE_INTEGER } }
    ]);
  });

  test('returns [] for null/undefined workspace', () => {
    assert.deepStrictEqual(getBindingsForWorkspace(null), []);
    assert.deepStrictEqual(getBindingsForWorkspace(undefined), []);
  });
});

// =============================================================================
// Provider call-scope helpers (LIN-713) — the read/write seam argument that lets
// a GitHub App binding authenticate per-request while staying byte-identical for
// every other provider.
// =============================================================================

describe('getBindingCallScope', () => {
  test('returns the bare token for a Linear binding (byte-identical seam)', () => {
    const binding = { provider: 'linear', scope: 'org-1', credentials: { token: 'lin-tok' } };
    assert.strictEqual(getBindingCallScope(binding), 'lin-tok');
  });

  test('returns the bare token for a local binding', () => {
    const binding = { provider: 'local', scope: 'notes-abcd', credentials: { token: 'notes-abcd' } };
    assert.strictEqual(getBindingCallScope(binding), 'notes-abcd');
  });

  test('pairs the installation token with the repo scope for a GitHub binding', () => {
    const binding = { provider: 'github', scope: 'octocat/hello', credentials: { token: 'ghs_install', installationId: '42' } };
    assert.deepStrictEqual(getBindingCallScope(binding), { token: 'ghs_install', repo: 'octocat/hello' });
  });

  // LIN-1885: Basic auth needs {email, apiToken, site} — a bare token cannot
  // carry it, so this is a third instance of the structured-credential
  // category, not a bare-token seam.
  test('returns {email, apiToken, site} for a Jira binding (Basic auth needs all three)', () => {
    const binding = { provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: 'tok-123', email: 'ada@acme.com' } };
    assert.deepStrictEqual(getBindingCallScope(binding), { email: 'ada@acme.com', apiToken: 'tok-123', site: 'https://acme.atlassian.net' });
  });

  test('the github/github-projects branches are unchanged by the Jira branch (LIN-1885 research finding 2: no widened slice)', () => {
    const gh = { provider: 'github', scope: 'octocat/hello', credentials: { token: 'ghs_install', installationId: '42' } };
    assert.deepStrictEqual(getBindingCallScope(gh), { token: 'ghs_install', repo: 'octocat/hello' });
    const proj = { provider: 'github-projects', scope: 'octocat/5', credentials: { token: 'ghs_install' } };
    assert.deepStrictEqual(getBindingCallScope(proj), { token: 'ghs_install', scope: 'octocat/5' });
    const lin = { provider: 'linear', scope: 'org-1', credentials: { token: 'lin-tok' } };
    assert.strictEqual(getBindingCallScope(lin), 'lin-tok');
  });

  test('tolerates a missing credential bag (undefined token)', () => {
    assert.strictEqual(getBindingCallScope({ provider: 'linear', scope: 'org' }), undefined);
    assert.deepStrictEqual(getBindingCallScope({ provider: 'github', scope: 'o/r' }), { token: undefined, repo: 'o/r' });
    assert.deepStrictEqual(getBindingCallScope({ provider: 'jira', scope: 'https://acme.atlassian.net' }), { email: undefined, apiToken: undefined, site: 'https://acme.atlassian.net' });
  });

  test('returns undefined for a null/undefined binding', () => {
    assert.strictEqual(getBindingCallScope(null), undefined);
    assert.strictEqual(getBindingCallScope(undefined), undefined);
  });
});

describe('getWorkspaceCallScope', () => {
  test('returns the active token for a Linear workspace (byte-identical to getWorkspaceToken)', () => {
    const ws = { id: 'org-1', provider: 'linear', accessToken: 'lin-tok' };
    assert.strictEqual(getWorkspaceCallScope(ws), 'lin-tok');
  });

  test('returns the active token for a local workspace', () => {
    const ws = { id: 'uuid', provider: 'local', urlKey: 'notes-abcd', accessToken: 'notes-abcd' };
    assert.strictEqual(getWorkspaceCallScope(ws), 'notes-abcd');
  });

  test('returns { token, repo } for a GitHub workspace, pairing the active token with its binding repo', () => {
    // Two GitHub repo bindings on one account; the active one is the scalar mirror.
    let ws = linkProvider({ id: 'github:7' }, 'github', 'octocat/one', { token: 'tok-one', installationId: '1' });
    ws = linkProvider(ws, 'github', 'octocat/two', { token: 'tok-two', installationId: '2' });
    // The scalar mirror tracks the most-recently-linked binding (the active one).
    assert.strictEqual(getWorkspaceToken(ws), 'tok-two');
    assert.deepStrictEqual(getWorkspaceCallScope(ws), { token: 'tok-two', repo: 'octocat/two' });
  });

  test('GitHub repo resolves from the binding whose token matches the active scalar mirror', () => {
    const ws = {
      id: 'github:7', provider: 'github', accessToken: 'tok-one',
      bindings: [
        { provider: 'github', scope: 'octocat/one', credentials: { token: 'tok-one' } },
        { provider: 'github', scope: 'octocat/two', credentials: { token: 'tok-two' } },
      ],
    };
    assert.deepStrictEqual(getWorkspaceCallScope(ws), { token: 'tok-one', repo: 'octocat/one' });
  });

  // LIN-1885: the active-binding form of the same third structured-credential
  // category (see getBindingCallScope above).
  test('returns {email, apiToken, site} for a Jira workspace, resolved from the active binding', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'jira', 'https://acme.atlassian.net', { token: 'tok-123', email: 'ada@acme.com' });
    assert.deepStrictEqual(getWorkspaceCallScope(ws), { email: 'ada@acme.com', apiToken: 'tok-123', site: 'https://acme.atlassian.net' });
  });

  test('Jira site resolves from the binding whose token matches the active scalar mirror (two Jira sites on one account)', () => {
    const ws = {
      id: 'jira:1', provider: 'jira', accessToken: 'tok-one',
      bindings: [
        { provider: 'jira', scope: 'https://one.atlassian.net', credentials: { token: 'tok-one', email: 'a@one.com' } },
        { provider: 'jira', scope: 'https://two.atlassian.net', credentials: { token: 'tok-two', email: 'a@two.com' } },
      ],
    };
    assert.deepStrictEqual(getWorkspaceCallScope(ws), { email: 'a@one.com', apiToken: 'tok-one', site: 'https://one.atlassian.net' });
  });

  test('the github/github-projects/linear/local branches are unchanged by the Jira branch (LIN-1885 research finding 2: no widened slice)', () => {
    let gh = linkProvider({ id: 'gh:1' }, 'github', 'octocat/one', { token: 'tok-one', installationId: '1' });
    gh = linkProvider(gh, 'github', 'octocat/two', { token: 'tok-two', installationId: '2' });
    assert.deepStrictEqual(getWorkspaceCallScope(gh), { token: 'tok-two', repo: 'octocat/two' });

    const proj = linkProvider({ id: 'proj:1' }, 'github-projects', 'octocat/5', { token: 'tok-proj' });
    assert.deepStrictEqual(getWorkspaceCallScope(proj), { token: 'tok-proj', scope: 'octocat/5' });

    const lin = { id: 'org-1', provider: 'linear', accessToken: 'lin-tok' };
    assert.strictEqual(getWorkspaceCallScope(lin), 'lin-tok');

    const local = { id: 'uuid', provider: 'local', urlKey: 'notes-abcd', accessToken: 'notes-abcd' };
    assert.strictEqual(getWorkspaceCallScope(local), 'notes-abcd');
  });

  test('undefined for a null workspace', () => {
    assert.strictEqual(getWorkspaceCallScope(null), undefined);
  });
});

// =============================================================================
// resolveIssueBinding (LIN-1904) — the per-ISSUE sibling of getWorkspaceCallScope.
// Returns { provider, callScope } as one pair, resolved from the `source`
// provenance stamp (LIN-561) rather than always the workspace's active binding.
// =============================================================================

describe('resolveIssueBinding', () => {
  let seq = 0;
  /** Register a fake provider under a unique name so tests never contend over one registry slot. */
  function fakeProvider() {
    const name = `fake-resolve-${++seq}`;
    return registerProvider({ name, ui: {}, supports: () => true });
  }

  test('no `source` → workspace-level resolution (active provider, active call scope)', () => {
    const active = fakeProvider();
    const secondary = fakeProvider();
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [
        { provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondary.name, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const { provider, callScope } = resolveIssueBinding(ws, undefined);
    assert.strictEqual(provider, active);
    assert.strictEqual(callScope, 'active-token');
    // Byte-identical to the pre-existing workspace-level pair.
    assert.strictEqual(callScope, getWorkspaceCallScope(ws));
  });

  test('an unmatched `source` falls back to workspace-level resolution unchanged', () => {
    const active = fakeProvider();
    fakeProvider(); // registered, but never bound to this workspace
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [{ provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } }],
    };
    const { provider, callScope } = resolveIssueBinding(ws, 'some-unrelated-provider-name');
    assert.strictEqual(provider, active);
    assert.strictEqual(callScope, 'active-token');
  });

  test('`source` naming the sole binding for a provider resolves that binding, even when it is not the active one', () => {
    const active = fakeProvider();
    const secondary = fakeProvider();
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [
        { provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondary.name, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const { provider, callScope } = resolveIssueBinding(ws, secondary.name);
    assert.strictEqual(provider, secondary);
    // The security-critical assertion: the secondary binding's OWN scope, never
    // the active binding's getWorkspaceCallScope credential.
    assert.strictEqual(callScope, 'secondary-token');
  });

  test('`source` is bounded to this workspace\'s own bindings — a registered-but-unbound provider name never resolves', () => {
    const active = fakeProvider();
    const unbound = fakeProvider(); // registered globally, but not in this workspace's bindings
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [{ provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } }],
    };
    const { provider, callScope } = resolveIssueBinding(ws, unbound.name);
    // Falls back to the active binding, never resolves the unbound provider.
    assert.strictEqual(provider, active);
    assert.strictEqual(callScope, 'active-token');
  });

  // F1 (plan-review 91a7c209): same-provider multi-binding must prefer the
  // ACTIVE binding (credentials.token matching the scalar mirror) over a bare
  // first-match — mirroring getWorkspaceCallScope's own GitHub/Jira idiom.
  // First-match-only would let a write route (PATCH /api/issues) silently
  // target the wrong repo/site.
  test('`source` naming a provider with TWO bindings prefers the ACTIVE one (matches the scalar-mirrored token)', () => {
    // getBindingCallScope/getWorkspaceCallScope switch on the LITERAL provider
    // string 'github' for the {token, repo} shape, so the registered name must
    // match it (not an arbitrary fake name) to exercise that branch honestly.
    const gh = registerProvider({ name: 'github', ui: {}, supports: () => true });
    const ws = linkProvider({ id: 'ws-1' }, gh.name, 'octocat/one', { token: 'tok-one' });
    linkProvider(ws, gh.name, 'octocat/two', { token: 'tok-two' });
    // linkProvider mirrors the LAST same-provider link into the scalar fields.
    assert.strictEqual(getWorkspaceToken(ws), 'tok-two');

    const { provider, callScope } = resolveIssueBinding(ws, gh.name);
    assert.strictEqual(provider, gh);
    assert.deepStrictEqual(callScope, { token: 'tok-two', repo: 'octocat/two' });
  });

  test('`source` naming a provider with TWO bindings falls back to the first match when neither is the active mirror', () => {
    // Constructed directly (not via linkProvider) so NEITHER binding's token
    // matches the scalar mirror — the genuinely unresolvable residual the
    // approved plan records (Scope exclusion 4): a foreign row from the
    // non-active binding of a same-provider pair cannot be disambiguated by a
    // provider-name `source` alone.
    const gh = registerProvider({ name: 'github', ui: {}, supports: () => true });
    const ws = {
      id: 'ws-1', provider: gh.name, accessToken: 'active-elsewhere-token',
      bindings: [
        { provider: gh.name, scope: 'octocat/a', credentials: { token: 'tok-a' } },
        { provider: gh.name, scope: 'octocat/b', credentials: { token: 'tok-b' } },
      ],
    };
    const { provider, callScope } = resolveIssueBinding(ws, gh.name);
    assert.strictEqual(provider, gh);
    assert.deepStrictEqual(callScope, { token: 'tok-a', repo: 'octocat/a' });
  });

  test('a single-binding workspace resolves byte-identically whether or not `source` is sent', () => {
    const sole = fakeProvider();
    const ws = linkProvider({ id: 'ws-1' }, sole.name, 'sole-scope', { token: 'sole-token' });

    const withoutSource = resolveIssueBinding(ws, undefined);
    const withSource = resolveIssueBinding(ws, sole.name);
    assert.strictEqual(withoutSource.provider, withSource.provider);
    assert.strictEqual(withoutSource.callScope, withSource.callScope);
    assert.strictEqual(withSource.callScope, 'sole-token');
  });

  test('resolves Jira\'s structured {email, apiToken, site} call scope from a matched binding, not the active mirror', () => {
    // Same reason as the github test above: the {email, apiToken, site} shape
    // is keyed on the literal provider string 'jira'.
    const active = fakeProvider();
    const jira = registerProvider({ name: 'jira', ui: {}, supports: () => true });
    const ws = {
      id: 'ws-1', provider: active.name, accessToken: 'active-token',
      bindings: [
        { provider: active.name, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: jira.name, scope: 'https://acme.atlassian.net', credentials: { token: 'jira-api-token', email: 'ada@acme.com' } },
      ],
    };
    const { provider, callScope } = resolveIssueBinding(ws, jira.name);
    assert.strictEqual(provider, jira);
    assert.deepStrictEqual(callScope, { email: 'ada@acme.com', apiToken: 'jira-api-token', site: 'https://acme.atlassian.net' });
  });
});

// =============================================================================
// Jira credential persistence (LIN-1885, beat 2) — the MAX_SAFE_INTEGER stamp
// =============================================================================
//
// Research established this stamp has a THIRD, previously-unwritten job beyond
// "never expires": it keeps a Jira workspace out of BOTH the destructive-401
// class's proactive entry point (server.js `ensureValidToken`'s inline
// `needsTokenRefresh` check) and the headless refresh-on-resolve candidate set
// (`selectExpiredOwnerRow`), because a Jira credential has no refresh
// mechanism at all — the only recovery from a dead token is a human re-link.
// It must be written into `binding.credentials`, not only the scalar mirror,
// so a later `setActiveProvider` switch (mirrorActiveBinding) carries it
// forward rather than reading `undefined` off the freshly-active binding.
import { selectOwnerWorkspaceToken, selectExpiredOwnerRow } from '../../lib/workspace-token-resolver.js';

// Mirrors server.js:174/628 exactly (TOKEN_REFRESH_BUFFER_MS, the inline
// `needsTokenRefresh` expression in `ensureValidToken`) — not exported, so
// re-derived here as a pinned characterization rather than imported.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
function needsTokenRefresh(tokenExpiresAt) {
  return tokenExpiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS;
}

describe('Jira MAX_SAFE_INTEGER stamp (LIN-1885)', () => {
  test('linkProvider writes the stamp into BOTH the binding credentials and the scalar mirror', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'jira', 'https://acme.atlassian.net', {
      token: 'tok-123', email: 'ada@acme.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER, 'scalar mirror');
    assert.equal(ws.bindings[0].credentials.tokenExpiresAt, Number.MAX_SAFE_INTEGER, 'binding credentials');
  });

  test('the stamp survives switching the active provider away and back (mirrorActiveBinding reads binding.credentials)', () => {
    // linkProvider's "active" semantics are first-link-wins across DIFFERENT
    // providers (never auto-overwritten) — so Jira, linked first, stays active
    // even after `local` is appended. Switching away needs an explicit
    // setActiveProvider, exactly like a real Settings provider-switch would.
    let ws = linkProvider({ id: 'ws-1' }, 'jira', 'https://acme.atlassian.net', {
      token: 'tok-123', email: 'ada@acme.com', tokenExpiresAt: Number.MAX_SAFE_INTEGER,
    });
    ws = linkProvider(ws, 'local', 'notes-abcd', { token: 'notes-abcd', tokenExpiresAt: Number.MAX_SAFE_INTEGER });
    assert.equal(ws.provider, 'jira', 'first link wins — appending local does not steal active status');

    setActiveProvider(ws, 'local', 'notes-abcd');
    assert.equal(ws.provider, 'local', 'now switched away from Jira');

    setActiveProvider(ws, 'jira', 'https://acme.atlassian.net');

    assert.equal(ws.provider, 'jira');
    // This is the assertion that fails without the credentials copy: were the
    // stamp written ONLY to the scalar mirror at link time, mirrorActiveBinding
    // would read `binding.credentials?.tokenExpiresAt` -> undefined here.
    assert.equal(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER);
  });

  test('headless token selection (selectOwnerWorkspaceToken) resolves "ok" for a Jira row, never session_expired', () => {
    const sessions = [
      { session: { accountId: 'account-A', workspaces: [
        { urlKey: 'acme', provider: 'jira', accessToken: 'tok-123', tokenExpiresAt: Number.MAX_SAFE_INTEGER },
      ] } },
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.reason, 'ok');
    assert.equal(result.token, 'tok-123');
    assert.equal(result.provider, 'jira');
  });

  test('a Jira row is NEVER selected as an expired/refreshable candidate (selectExpiredOwnerRow), matching "no recovery but a human re-link"', () => {
    const sessions = [
      { session: { accountId: 'account-A', workspaces: [
        { urlKey: 'acme', provider: 'jira', accessToken: 'tok-123', tokenExpiresAt: Number.MAX_SAFE_INTEGER },
      ] } },
    ];
    // isLive stays true forever (MAX_SAFE_INTEGER), so the row never even reaches
    // the refreshability check — unlike Linear/GitHub-family, which have one.
    assert.strictEqual(selectExpiredOwnerRow(sessions, 'acme', 'account-A'), null);
  });

  test('needsTokenRefresh (server.js ensureValidToken\'s proactive guard) stays false for a Jira workspace', () => {
    assert.equal(needsTokenRefresh(Number.MAX_SAFE_INTEGER), false);
    // Contrast: a normal (non-Jira) finite expiry inside the buffer DOES need refresh —
    // proves the characterization function itself is meaningful, not vacuously false.
    assert.equal(needsTokenRefresh(Date.now() + 60_000), true);
  });
});

// =============================================================================
// getWorkspaceToken — widened (provider, scope) form (LIN-562)
// =============================================================================

describe('getWorkspaceToken (provider/scope selection)', () => {
  test('selects a binding token by provider', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin-tok' });
    assert.strictEqual(getWorkspaceToken(ws, 'linear'), 'lin-tok');
  });

  test('selects a binding token by (provider, scope)', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'github', 'owner/repo', { token: 'a' });
    linkProvider(ws, 'github', 'org/5', { token: 'b' });
    assert.strictEqual(getWorkspaceToken(ws, 'github', 'owner/repo'), 'a');
    assert.strictEqual(getWorkspaceToken(ws, 'github', 'org/5'), 'b');
  });

  test('reads through the synthesized legacy binding for un-migrated workspaces', () => {
    const ws = { id: 'org-9', provider: 'linear', accessToken: 'legacy' };
    assert.strictEqual(getWorkspaceToken(ws, 'linear'), 'legacy');
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org-9'), 'legacy');
  });

  test('returns undefined when no binding matches', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin-tok' });
    assert.strictEqual(getWorkspaceToken(ws, 'github'), undefined);
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'wrong-scope'), undefined);
  });
});

// =============================================================================
// getWorkspaceToken Tests (dual-read accessor — LIN-333)
// =============================================================================

describe('getWorkspaceToken', () => {
  test('returns credentials.token for new-shape workspace', () => {
    const workspace = {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'new-token' }
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'new-token');
  });

  test('falls back to legacy accessToken when no credentials', () => {
    const workspace = {
      id: 'ws-1',
      accessToken: 'legacy-token'
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'legacy-token');
  });

  test('prefers credentials.token over legacy accessToken when both present', () => {
    const workspace = {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'new-token' },
      accessToken: 'legacy-token'
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'new-token');
  });

  test('returns undefined when neither credentials nor accessToken present', () => {
    assert.strictEqual(getWorkspaceToken({ id: 'ws-1' }), undefined);
  });

  test('handles null/undefined workspace without throwing', () => {
    assert.strictEqual(getWorkspaceToken(null), undefined);
    assert.strictEqual(getWorkspaceToken(undefined), undefined);
  });

  test('falls back to accessToken when credentials present but token missing', () => {
    const workspace = {
      id: 'ws-1',
      credentials: {},
      accessToken: 'legacy-token'
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'legacy-token');
  });

  test('round-trips new {provider, credentials} shape through upsert + read', () => {
    const session = {};
    upsertWorkspace(session, {
      id: 'ws-1',
      name: 'New Shape',
      urlKey: 'new-shape',
      provider: 'linear',
      credentials: { token: 'round-trip-token' }
    });

    const stored = getActiveWorkspace({ ...session, activeWorkspaceId: 'ws-1' });
    assert.strictEqual(stored.provider, 'linear');
    assert.deepStrictEqual(stored.credentials, { token: 'round-trip-token' });
    assert.strictEqual(getWorkspaceToken(stored), 'round-trip-token');
  });

  test('round-trips legacy accessToken-shaped workspace through upsert + read', () => {
    const session = {};
    upsertWorkspace(session, {
      id: 'ws-legacy',
      name: 'Legacy',
      urlKey: 'legacy',
      accessToken: 'legacy-round-trip'
    });

    const stored = getActiveWorkspace({ ...session, activeWorkspaceId: 'ws-legacy' });
    assert.strictEqual(stored.provider, undefined);
    assert.strictEqual(stored.credentials, undefined);
    assert.strictEqual(getWorkspaceToken(stored), 'legacy-round-trip');
  });

  test('upsert merge does not drop new credential fields or inject defaults', () => {
    // Legacy workspace already in session; re-auth upserts the new shape on top.
    const session = {
      workspaces: [{ id: 'ws-1', name: 'Test', accessToken: 'legacy-token' }]
    };
    upsertWorkspace(session, {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'upgraded-token' }
    });

    const stored = session.workspaces[0];
    // Spread merge keeps untouched legacy fields and adds the new ones.
    assert.strictEqual(stored.name, 'Test');
    assert.strictEqual(stored.accessToken, 'legacy-token');
    assert.strictEqual(stored.provider, 'linear');
    assert.deepStrictEqual(stored.credentials, { token: 'upgraded-token' });
    // New credentials.token wins over the retained legacy accessToken.
    assert.strictEqual(getWorkspaceToken(stored), 'upgraded-token');
  });
});

// =============================================================================
// getActiveWorkspace Tests
// =============================================================================

describe('getActiveWorkspace', () => {
  test('returns null for empty workspaces', () => {
    const session = { workspaces: [] };
    assert.strictEqual(getActiveWorkspace(session), null);
  });

  test('returns null for undefined workspaces', () => {
    const session = {};
    assert.strictEqual(getActiveWorkspace(session), null);
  });

  test('returns active workspace when ID matches', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-2'
    };
    const result = getActiveWorkspace(session);
    assert.strictEqual(result.id, 'ws-2');
    assert.strictEqual(result.name, 'Second');
  });

  test('syncs to first workspace if activeWorkspaceId is invalid', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-nonexistent'
    };
    const result = getActiveWorkspace(session);
    assert.strictEqual(result.id, 'ws-1');
    assert.strictEqual(session.activeWorkspaceId, 'ws-1');
  });
});

// =============================================================================
// upsertWorkspace Tests
// =============================================================================

describe('upsertWorkspace', () => {
  test('adds new workspace to empty session', () => {
    const session = {};
    const workspace = { id: 'ws-1', name: 'Test' };

    upsertWorkspace(session, workspace);

    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].id, 'ws-1');
  });

  test('updates existing workspace with same ID', () => {
    const session = {
      workspaces: [{ id: 'ws-1', name: 'Old Name', accessToken: 'old-token' }]
    };
    const workspace = { id: 'ws-1', name: 'New Name', accessToken: 'new-token' };

    upsertWorkspace(session, workspace);

    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].name, 'New Name');
    assert.strictEqual(session.workspaces[0].accessToken, 'new-token');
  });

  test('throws error when at MAX_WORKSPACES limit', () => {
    const session = {
      workspaces: Array.from({ length: MAX_WORKSPACES }, (_, i) => ({ id: `ws-${i}` }))
    };
    const newWorkspace = { id: 'ws-new' };

    assert.throws(() => upsertWorkspace(session, newWorkspace), /Maximum/);
  });
});

// =============================================================================
// removeWorkspace Tests
// =============================================================================

describe('removeWorkspace', () => {
  test('removes workspace by ID', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-1'
    };

    const remaining = removeWorkspace(session, 'ws-2');

    assert.strictEqual(remaining, 1);
    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].id, 'ws-1');
  });

  test('updates activeWorkspaceId when removing active workspace', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-1'
    };

    const remaining = removeWorkspace(session, 'ws-1');

    assert.strictEqual(remaining, 1);
    assert.strictEqual(session.activeWorkspaceId, 'ws-2');
  });

  test('sets activeWorkspaceId to null when removing last workspace', () => {
    const session = {
      workspaces: [{ id: 'ws-1', name: 'Only' }],
      activeWorkspaceId: 'ws-1'
    };

    const remaining = removeWorkspace(session, 'ws-1');

    assert.strictEqual(remaining, 0);
    assert.strictEqual(session.activeWorkspaceId, null);
  });

  test('returns 0 for undefined workspaces', () => {
    const session = { activeWorkspaceId: 'ws-1' };

    const remaining = removeWorkspace(session, 'ws-1');

    assert.strictEqual(remaining, 0);
  });
});

// =============================================================================
// saveSession Tests
// =============================================================================

describe('saveSession', () => {
  test('resolves when session.save succeeds', async () => {
    const session = {
      save: (callback) => callback()
    };

    await assert.doesNotReject(() => saveSession(session));
  });

  test('rejects when session.save fails', async () => {
    const expectedError = new Error('Save failed');
    const session = {
      save: (callback) => callback(expectedError)
    };

    await assert.rejects(
      () => saveSession(session),
      expectedError
    );
  });

  test('handles async callback timing', async () => {
    let callbackCalled = false;
    const session = {
      save: (callback) => {
        setTimeout(() => {
          callbackCalled = true;
          callback();
        }, 10);
      }
    };

    await saveSession(session);
    assert.strictEqual(callbackCalled, true);
  });
});
