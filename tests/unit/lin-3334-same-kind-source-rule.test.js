/**
 * LIN-3334 — one ticket source per kind.
 *
 * Pins the pure predicate, the `linkProvider` backstop (credentials mode), the
 * `persistBinding` returned refusal (held mode, before any write), the refusal
 * copy, and the idempotence edge cases the plan calls out (token refresh, a
 * workspace that already holds two same-kind sources).
 *
 * Run with: node --test tests/unit/lin-3334-same-kind-source-rule.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkProvider,
  sameKindSourceBound,
  oneSourcePerKindMessage,
  remintActiveCredential,
} from '../../lib/workspace.js';
import { persistBinding } from '../../lib/persist-binding.js';

describe('LIN-3334 — sameKindSourceBound predicate', () => {
  test('no binding of the provider → null (a fresh container is never refused)', () => {
    assert.equal(sameKindSourceBound({ id: 'ws', bindings: [] }, 'github', 'octo/a'), null);
    assert.equal(sameKindSourceBound({ id: 'ws' }, 'github', 'octo/a'), null);
    assert.equal(sameKindSourceBound(null, 'github'), null);
  });

  test('same provider + different scope → the existing binding', () => {
    const ws = { id: 'ws', bindings: [{ provider: 'github', scope: 'octo/a' }] };
    assert.deepEqual(sameKindSourceBound(ws, 'github', 'octo/b'), { provider: 'github', scope: 'octo/a' });
  });

  test('same provider + SAME scope → null (a re-link is idempotent)', () => {
    const ws = { id: 'ws', bindings: [{ provider: 'github', scope: 'octo/a' }] };
    assert.equal(sameKindSourceBound(ws, 'github', 'octo/a'), null);
  });

  test('no scope (the early checks) → any binding of the provider refuses', () => {
    const ws = { id: 'ws', bindings: [{ provider: 'github', scope: 'octo/a' }] };
    assert.deepEqual(sameKindSourceBound(ws, 'github'), { provider: 'github', scope: 'octo/a' });
  });

  test('a different provider is not this kind (github vs github-projects vs jira vs linear)', () => {
    const ws = { id: 'ws', bindings: [{ provider: 'github', scope: 'octo/a' }] };
    assert.equal(sameKindSourceBound(ws, 'github-projects', 'octo/5'), null);
    assert.equal(sameKindSourceBound(ws, 'jira', 'https://a'), null);
    assert.equal(sameKindSourceBound(ws, 'linear', 'org-1'), null);
  });

  test('a workspace that already holds TWO same-kind sources: re-linking either scope stays idempotent', () => {
    const ws = { id: 'ws', bindings: [
      { provider: 'github', scope: 'octo/a' },
      { provider: 'github', scope: 'octo/b' },
    ] };
    assert.equal(sameKindSourceBound(ws, 'github', 'octo/a'), null, 're-link a is idempotent');
    assert.equal(sameKindSourceBound(ws, 'github', 'octo/b'), null, 're-link b is idempotent');
    assert.deepEqual(sameKindSourceBound(ws, 'github', 'octo/c'), { provider: 'github', scope: 'octo/a' }, 'a third scope is refused');
  });

  test('a legacy un-migrated workspace (scalar mirror only) counts as its one source', () => {
    const legacy = { id: 'org-1', provider: 'linear', accessToken: 'legacy-token' };
    assert.equal(sameKindSourceBound(legacy, 'linear', 'org-1'), null, 're-link the same (workspace-id) scope is idempotent');
    assert.equal(sameKindSourceBound(legacy, 'linear', 'org-2')?.scope, 'org-1');
    assert.equal(sameKindSourceBound(legacy, 'github', 'octo/a'), null, 'a different kind is not blocked');
  });

  test('the refusal copy names the provider and the existing scope', () => {
    assert.equal(
      oneSourcePerKindMessage('GitHub Issues', 'octo/a'),
      'This workspace already has a GitHub Issues source (octo/a). A workspace has one ticket source of each kind. Remove it in Settings to use a different one, or add the repo as a new workspace.'
    );
  });
});

describe('LIN-3334 — linkProvider backstop', () => {
  test('throws on a same-kind/different-scope link', () => {
    const ws = linkProvider({ id: 'ws' }, 'github', 'octo/a', { token: 't' });
    assert.throws(
      () => linkProvider(ws, 'github', 'octo/b', { token: 't' }),
      /one ticket source of each kind/
    );
    assert.equal(ws.bindings.length, 1, 'no second binding written');
  });

  test('idempotent for the SAME scope (token refresh upsert is not refused)', () => {
    const ws = linkProvider({ id: 'ws' }, 'github', 'octo/a', { token: 't1' });
    assert.doesNotThrow(() => linkProvider(ws, 'github', 'octo/a', { token: 't2' }));
    assert.equal(ws.bindings.length, 1);
    assert.equal(ws.bindings[0].credentials.token, 't2');
  });

  test('a fresh container links its first source fine', () => {
    const ws = linkProvider({ id: 'ws' }, 'jira', 'https://a', { token: 't' });
    assert.equal(ws.bindings.length, 1);
    assert.equal(ws.provider, 'jira');
  });

  test('a different kind is allowed onto a workspace that already has one', () => {
    const ws = linkProvider({ id: 'ws' }, 'linear', 'org-1', { token: 'l' });
    assert.doesNotThrow(() => linkProvider(ws, 'github', 'octo/a', { token: 'g' }));
    assert.equal(ws.bindings.length, 2);
  });

  test('the Linear/local writers (fresh containers) never reach the refusal', () => {
    // Linear OAuth/PAT and local create build a fresh container before linking.
    assert.doesNotThrow(() => linkProvider({ id: 'org-1', urlKey: 'org-1' }, 'linear', 'org-1', { token: 'lin' }));
    assert.doesNotThrow(() => linkProvider({ id: 'uuid', urlKey: 'notes' }, 'local', 'notes', { token: 'notes' }));
    // Re-auth of an existing legacy workspace uses the SAME org scope (idempotent).
    const legacy = { id: 'org-1', provider: 'linear', accessToken: 'old' };
    assert.doesNotThrow(() => linkProvider(legacy, 'linear', 'org-1', { token: 'new' }));
  });

  test('remintActiveCredential re-links the active scope and is not refused', async () => {
    const ws = linkProvider({ id: 'gh-1' }, 'github', 'octo/a', { installationId: '1', token: 'old', tokenExpiresAt: 1 });
    const provider = { async refreshCredential() { return { installationId: '1', token: 'new', tokenExpiresAt: 9 }; } };
    await remintActiveCredential(ws, provider);
    assert.equal(ws.bindings.length, 1);
    assert.equal(ws.bindings[0].credentials.token, 'new');
  });
});

describe('LIN-3334 — persistBinding held refusal', () => {
  // The policy injected by `bindAddSource` (routes/held-connection.js).
  const sameKindRefusal = (workspace, provider, scope) => {
    const conflict = sameKindSourceBound(workspace, provider, scope);
    return conflict ? oneSourcePerKindMessage('GitHub Issues', conflict.scope) : null;
  };

  test('returns {error: refused, message} and NEVER reaches the converter (so no addReferent / store write)', async () => {
    let converterCalls = 0;
    const out = await persistBinding({
      session: {},
      accountId: 'acct-1',
      workspace: { id: 'ws-1', bindings: [{ provider: 'github', scope: 'octo/a' }] },
      provider: 'github',
      scope: 'octo/b',
      heldConnectionId: 'acct-1::github::99',
      workspacesSnapshot: [],
      sameKindRefusal,
      convertToConnectionBacked: async () => { converterCalls += 1; return { connectionBacked: true, connectionId: 'x', error: null }; },
    });

    assert.equal(out.error, 'refused');
    assert.equal(out.connectionBacked, false);
    assert.match(out.message, /already has a GitHub Issues source \(octo\/a\)/);
    assert.equal(converterCalls, 0, 'the held converter — and therefore addReferent — is never called');
  });

  test('a same-scope link is NOT refused (idempotent)', async () => {
    let converterCalls = 0;
    const out = await persistBinding({
      session: {},
      accountId: 'acct-1',
      workspace: { id: 'ws-1', bindings: [{ provider: 'github', scope: 'octo/a' }] },
      provider: 'github',
      scope: 'octo/a',
      heldConnectionId: 'acct-1::github::99',
      workspacesSnapshot: [],
      sameKindRefusal,
      convertToConnectionBacked: async () => { converterCalls += 1; return { connectionBacked: true, connectionId: 'x', error: null }; },
    });
    assert.equal(out.error, null);
    assert.equal(converterCalls, 1, 'the same-scope re-link proceeds to the converter');
  });

  test('unarmed callers are unaffected (no sameKindRefusal → no refusal)', async () => {
    const out = await persistBinding({
      session: {}, accountId: 'acct-1',
      workspace: { id: 'ws-1', bindings: [{ provider: 'github', scope: 'octo/a' }] },
      provider: 'github', scope: 'octo/b', heldConnectionId: 'acct-1::github::99',
      convertToConnectionBacked: async () => ({ connectionBacked: true, connectionId: 'x', error: null }),
    });
    assert.equal(out.connectionBacked, true);
    assert.equal(out.error, null);
  });
});
