/**
 * LIN-3124 PR2 review B1 — the unlink census site must release against the
 * PRE-unlink bindings.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-provider-removal-order.test.js
 *
 * `POST /workspace/:urlKey/settings/providers/remove` calls `unlinkProvider`
 * first, which reassigns `workspace.bindings` without the removed binding. The
 * release must therefore be given `bindingsBefore`, or it filters to nothing and
 * never fires. This slices the real handler (precedent: the lin-1503/1885/1887/
 * 2110 VM harnesses) and drives the real route order: RED before the fix (zero
 * calls), green after (`removeReferent` + `deleteIfUnreferenced` called).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { unlinkProvider } from '../../lib/workspace.js';
import { releaseConnectionCredential } from '../../lib/connection-lifecycle.js';

const SERVER_SRC = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

function sliceProviderRemoveHandler() {
  const marker = "app.post('/workspace/:urlKey/settings/providers/remove'";
  const start = SERVER_SRC.indexOf(marker);
  assert.ok(start >= 0, 'provider-removal route not found in server.js');
  const end = SERVER_SRC.indexOf('\n});', start);
  assert.ok(end > start, 'provider-removal route end not found');
  return SERVER_SRC.slice(start, end + 4);
}

// LIN-3619: drives the real route with a recording revoker over a given workspace.
async function runUnlink(workspace, body) {
  const revokes = [];
  let handler;
  const sandbox = {
    app: { post: (_path, _mw, h) => { handler = h; } },
    workspaceFromUrl: (_req, _res, next) => next?.(),
    encodeURIComponent,
    unlinkProvider,
    releaseConnectionCredential: async () => ({}),
    workspaceRemovalRevoker: { revoke: async (a) => { revokes.push(a); return {}; } },
    evictReferentFor: () => () => {},
    connectionStore: {},
    ownerCredentialStore: { async delete() { return true; } },
    saveSession: async () => {},
    renderErrorPage: () => '<error/>',
    console: { error() {}, log() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(sliceProviderRemoveHandler(), sandbox);
  const res = { redirect: () => res, status: () => res, send: () => res };
  await handler({ workspace, body, session: { accountId: 'acc' } }, res);
  return revokes;
}

describe('LIN-3619 — unlink revokes artifacts only when the last binding goes', () => {
  const linear = { provider: 'linear', scope: 'org-1' };
  const jira = { provider: 'jira', scope: 'https://acme.atlassian.net' };

  test('unlinking the only binding revokes tokens and /t/ links', async () => {
    const revokes = await runUnlink({ id: 'w-1', urlKey: 'acme', provider: 'linear', bindings: [{ ...linear }] }, linear);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(revokes)), [{ urlKey: 'acme', workspaceId: 'w-1', accountId: 'acc' }]);
  });

  test('a partial unlink (another binding remains) revokes nothing', async () => {
    const revokes = await runUnlink({ id: 'w-1', urlKey: 'acme', provider: 'linear', bindings: [{ ...linear }, { ...jira }] }, linear);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(revokes)), []);
  });

  test('a no-op unlink (no matching binding) revokes nothing', async () => {
    const revokes = await runUnlink({ id: 'w-1', urlKey: 'acme', provider: 'linear', bindings: [{ ...linear }] }, { provider: 'linear', scope: 'other' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(revokes)), []);
  });
});

describe('LIN-3124 PR2 B1 — provider removal releases the pre-unlink binding', () => {
  test('the real route order calls removeReferent + deleteIfUnreferenced', async () => {
    const calls = { removeReferent: [], deleteIfUnreferenced: [], durableDeletes: [] };
    const connectionStore = {
      async removeReferent(...a) { calls.removeReferent.push(a); return true; },
      async deleteIfUnreferenced(...a) { calls.deleteIfUnreferenced.push(a); return true; },
      async deleteConnection() { return []; },
    };
    const ownerCredentialStore = {
      async delete(...a) { calls.durableDeletes.push(a); return true; },
      async deleteByConnection() { return true; },
    };

    let handler;
    const sandbox = {
      app: { post: (_path, _mw, h) => { handler = h; } },
      workspaceFromUrl: (_req, _res, next) => next?.(),
      encodeURIComponent,
      unlinkProvider,
      releaseConnectionCredential,
      workspaceRemovalRevoker: { revoke: async () => ({}) }, // LIN-3619
      evictReferentFor: () => () => {},
      connectionStore,
      ownerCredentialStore,
      saveSession: async () => {},
      renderErrorPage: () => '<error/>',
      console: { error() {}, log() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(sliceProviderRemoveHandler(), sandbox);
    assert.strictEqual(typeof handler, 'function', 'the handler was sliced');

    const workspace = {
      urlKey: 'acme',
      provider: 'linear',
      bindings: [{ provider: 'linear', scope: 'org-1', connectionId: 'acc::linear::org-1' }],
    };
    const req = { workspace, body: { provider: 'linear', scope: 'org-1' }, session: { accountId: 'acc' } };
    let redirectTo;
    const res = { redirect: (u) => { redirectTo = u; return res; }, status: () => res, send: () => res };

    await handler(req, res);

    assert.strictEqual(calls.removeReferent.length, 1, 'the connection-backed binding must be released');
    assert.deepStrictEqual(calls.removeReferent[0], [
      'acc::linear::org-1',
      { urlKey: 'acme', provider: 'linear', scope: 'org-1' },
    ]);
    assert.strictEqual(calls.deleteIfUnreferenced.length, 1);
    assert.deepStrictEqual(calls.durableDeletes[0], ['acc', 'acme', 'linear'], 'the legacy per-partition delete still runs');
    assert.strictEqual(redirectTo, '/workspace/acme/settings?provider_removed=linear');
  });
});
