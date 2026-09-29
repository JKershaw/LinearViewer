/**
 * LIN-3124 PR2 (S6) — T12 + legacy inertness: the connection lifecycle.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-connection-lifecycle.test.js
 *
 * Real MangoDB stores. Every call is a no-op for a legacy (connectionId-less)
 * workspace, so a legacy removal/merge is byte-identical; the inertness cases
 * assert exactly that, with store-call counters.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { releaseConnectionCredential, releaseOrphanOwnerRecord, onAccountMerged } from '../../lib/connection-lifecycle.js';
import { sanitizeSessionForPersist } from '../../lib/connection-credential.js';

describe('LIN-3124 PR2 T12 — connection lifecycle', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr2-cl-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function stores() {
    const db = client.db(`pr2cl_${counter++}`);
    return {
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
    };
  }

  async function seed(connectionStore, ownerCredentialStore, { accountId = randomUUID(), provider = 'linear', unitId = 'org-1', urlKey, scope = 'org-1' } = {}) {
    const referent = { urlKey, provider, scope };
    await connectionStore.link(accountId, provider, unitId, { token: 'tok', tokenExpiresAt: 1 }, referent);
    const connectionId = connectionStore._id(accountId, provider, unitId);
    await ownerCredentialStore.putByConnection(connectionId, { accountId, provider, refreshToken: 'R', token: 'tok', tokenExpiresAt: 1 });
    return { connectionId, referent };
  }

  test('revoke deletes the connection and its owner record, returning the referents', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const accountId = randomUUID();
    const a = await seed(connectionStore, ownerCredentialStore, { accountId, urlKey: 'ws-a' });
    await connectionStore.link(accountId, 'linear', 'org-1', { token: 'tok' }, { urlKey: 'ws-b', provider: 'linear', scope: 'org-1' });
    const workspace = { urlKey: 'ws-a', bindings: [{ provider: 'linear', scope: 'org-1', connectionId: a.connectionId }] };

    const result = await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace, provider: 'linear', mode: 'revoke' });

    assert.strictEqual(result.released, 1);
    assert.strictEqual(result.referents.length, 2, 'both referents are returned for cache eviction');
    assert.strictEqual(await connectionStore.readConnectionById(a.connectionId), null);
    assert.strictEqual(await ownerCredentialStore.getByConnection(a.connectionId), null);
  });

  test('unlink is last-referent only', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const accountId = randomUUID();
    const a = await seed(connectionStore, ownerCredentialStore, { accountId, urlKey: 'ws-a' });
    await connectionStore.link(accountId, 'linear', 'org-1', { token: 'tok' }, { urlKey: 'ws-b', provider: 'linear', scope: 'org-1' });
    const workspace = { urlKey: 'ws-a', bindings: [{ provider: 'linear', scope: 'org-1', connectionId: a.connectionId }] };

    // First referent: the connection survives.
    let result = await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace, provider: 'linear', scope: 'org-1', mode: 'unlink' });
    assert.strictEqual(result.released, 0);
    assert.ok(await connectionStore.readConnectionById(a.connectionId));

    // Second referent: the connection is deleted, owner record released.
    const workspaceB = { urlKey: 'ws-b', bindings: [{ provider: 'linear', scope: 'org-1', connectionId: a.connectionId }] };
    result = await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace: workspaceB, provider: 'linear', scope: 'org-1', mode: 'unlink' });
    assert.strictEqual(result.released, 1);
    assert.strictEqual(await connectionStore.readConnectionById(a.connectionId), null);
    assert.strictEqual(await ownerCredentialStore.getByConnection(a.connectionId), null);
  });

  test('whole-workspace removal releases every refresh-token binding, never a GitHub one', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const accountId = randomUUID();
    const lin = await seed(connectionStore, ownerCredentialStore, { accountId, urlKey: 'ws-a' });
    const jira = await seed(connectionStore, ownerCredentialStore, { accountId, provider: 'jira', unitId: 'https://acme.atlassian.net', urlKey: 'ws-a', scope: 'https://acme.atlassian.net' });
    const gh = await seed(connectionStore, ownerCredentialStore, { accountId, provider: 'github', unitId: 'install-1', urlKey: 'ws-a', scope: 'acme/repo' });

    const workspace = {
      urlKey: 'ws-a',
      bindings: [
        { provider: 'linear', scope: 'org-1', connectionId: lin.connectionId },
        { provider: 'jira', scope: 'https://acme.atlassian.net', connectionId: jira.connectionId },
        { provider: 'github', scope: 'acme/repo', connectionId: gh.connectionId },
      ],
    };

    await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace, mode: 'remove' });

    assert.strictEqual(await connectionStore.readConnectionById(lin.connectionId), null);
    assert.strictEqual(await connectionStore.readConnectionById(jira.connectionId), null);
    assert.ok(await connectionStore.readConnectionById(gh.connectionId), 'D13: GitHub-family connections are retained');
    assert.ok(await ownerCredentialStore.getByConnection(gh.connectionId), 'the GitHub owner record is left untouched');
  });

  test('legacy workspace: no connection-backed binding → zero store calls', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    let calls = 0;
    const countingCS = new Proxy(connectionStore, { get(t, p) { if (typeof t[p] === 'function') return (...args) => { calls++; return t[p](...args); }; return t[p]; } });
    const countingOCS = new Proxy(ownerCredentialStore, { get(t, p) { if (typeof t[p] === 'function') return (...args) => { calls++; return t[p](...args); }; return t[p]; } });
    const legacy = { urlKey: 'ws-legacy', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'x' } }] };

    const result = await releaseConnectionCredential({ connectionStore: countingCS, ownerCredentialStore: countingOCS, workspace: legacy, provider: 'linear', mode: 'revoke' });
    assert.deepStrictEqual(result, { released: 0, referents: [] });
    assert.strictEqual(calls, 0);

    // And the sanitizer leaves the legacy session byte-identical.
    const session = { accountId: 'a', workspaces: [JSON.parse(JSON.stringify(legacy))] };
    const snapshot = JSON.stringify(session);
    sanitizeSessionForPersist(session);
    assert.strictEqual(JSON.stringify(session), snapshot);
  });

  test('releaseOrphanOwnerRecord deletes a connection-keyed record best-effort', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const a = await seed(connectionStore, ownerCredentialStore, { urlKey: 'ws-a' });
    assert.strictEqual(await releaseOrphanOwnerRecord({ ownerCredentialStore, connectionId: a.connectionId }), true);
    assert.strictEqual(await ownerCredentialStore.getByConnection(a.connectionId), null);
    assert.strictEqual(await releaseOrphanOwnerRecord({ ownerCredentialStore: null, connectionId: a.connectionId }), false);
  });

  test('account merge deletes only origin:connection rows with no referents', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const mergedId = randomUUID();

    // origin + empty → deleted (+ its owner record).
    const orphan = connectionStore._id(mergedId, 'linear', 'org-empty');
    await connectionStore.link(mergedId, 'linear', 'org-empty', { token: 'x' }, { urlKey: 'ws-a', provider: 'linear', scope: 'org-empty' });
    await connectionStore.removeReferent(orphan, { urlKey: 'ws-a', provider: 'linear', scope: 'org-empty' });
    await ownerCredentialStore.putByConnection(orphan, { accountId: mergedId, provider: 'linear', refreshToken: 'R' });

    // origin + referenced → kept.
    const live = await seed(connectionStore, ownerCredentialStore, { accountId: mergedId, urlKey: 'ws-b' });
    // no origin (LIN-3127-born) + empty → kept.
    const legacyId = connectionStore._id(mergedId, 'github', 'install-9');
    await connectionStore.put(mergedId, 'github', 'install-9', { token: 'g' });
    await connectionStore.collection.updateOne({ _id: legacyId }, { $set: { referents: [] } });

    const deleted = await onAccountMerged({ connectionStore, ownerCredentialStore, mergedAccountId: mergedId });
    assert.strictEqual(deleted, 1);
    assert.strictEqual(await connectionStore.readConnectionById(orphan), null);
    assert.strictEqual(await ownerCredentialStore.getByConnection(orphan), null);
    assert.ok(await connectionStore.readConnectionById(live.connectionId));
    assert.ok(await connectionStore.readConnectionById(legacyId), 'a no-origin row is never deleted');

    // Merge of an account with no connection rows is a no-op.
    assert.strictEqual(await onAccountMerged({ connectionStore, ownerCredentialStore, mergedAccountId: randomUUID() }), 0);
  });
});
