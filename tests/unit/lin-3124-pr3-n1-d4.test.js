/**
 * LIN-3124 PR3 — N1 (the re-keyed refresh core records the four LIN-2236
 * credential-lifecycle events `doOwnerRefresh` records, attributed to the
 * Connection by `detail.connectionId`) and D4/S7 (a Connection release evicts
 * the cached token of EVERY removed referent, not just the site's workspace).
 *
 * Run with: node --test tests/unit/lin-3124-pr3-n1-d4.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { createConnectionRefresher } from '../../lib/connection-credential.js';
import { releaseConnectionCredential } from '../../lib/connection-lifecycle.js';
import { TokenRefreshError, LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS } from '../../lib/token-refresh.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS as K } from '../../lib/credential-lifecycle-events.js';

const REFERENT_A = { urlKey: 'ws-a', provider: 'linear', scope: 'org-1' };
const REFERENT_B = { urlKey: 'ws-b', provider: 'linear', scope: 'org-1' };

function eventRecorder() {
  const events = [];
  return { events, store: { async recordEvent(e) { events.push(e); return e; } } };
}

describe('LIN-3124 PR3 N1 + D4', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr3-n1-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function stores() {
    const db = client.db(`pr3n1_${counter++}`);
    return {
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
    };
  }

  async function seed(connectionStore, ownerCredentialStore, { withRecord = true, token = 'old-tok', refreshToken = 'R0' } = {}) {
    const accountId = randomUUID();
    const expiresAt = Date.now() + 3600_000;
    await connectionStore.link(accountId, 'linear', 'org-1', { token, tokenExpiresAt: expiresAt }, REFERENT_A);
    await connectionStore.link(accountId, 'linear', 'org-1', { token, tokenExpiresAt: expiresAt }, REFERENT_B);
    const connectionId = connectionStore._id(accountId, 'linear', 'org-1');
    if (withRecord) {
      await ownerCredentialStore.putByConnection(connectionId, { accountId, provider: 'linear', scope: 'org-1', token, refreshToken, tokenExpiresAt: expiresAt });
    }
    return { accountId, connectionId };
  }

  function assertAttributed(events, { accountId, connectionId }) {
    for (const e of events) {
      assert.equal(e.accountId, accountId);
      assert.equal(e.urlKey, null, 'a Connection spans referents; urlKey is not attributed');
      assert.equal(e.provider, 'linear');
      assert.equal(e.detail.connectionId, connectionId, 'every event names its Connection');
      assert.ok(!JSON.stringify(e).includes('R0') && !JSON.stringify(e).includes('old-tok'), 'secret-safe: no token bytes');
    }
  }

  describe('N1 — lifecycle events from runConnectionRefresh', () => {
    test('success (rotated): SPEND_INTENT then REFRESH_SUCCESS via rotated', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const { events, store } = eventRecorder();
      const exchange = async () => ({ access_token: 'new-tok', refresh_token: 'R1', expires_in: 3600 });
      const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => exchange, lifecycleEventStore: store });
      const out = await refresh(ids.connectionId, ids.accountId);
      assert.equal(out.token, 'new-tok');
      assert.deepEqual(events.map(e => [e.kind, e.detail.via ?? e.detail.attempted]), [[K.SPEND_INTENT, true], [K.REFRESH_SUCCESS, 'rotated']]);
      assertAttributed(events, ids);
    });

    test('success (same bytes, frozen expiry): REFRESH_SUCCESS via byte-identical', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const { events, store } = eventRecorder();
      const exchange = async () => ({ access_token: 'old-tok', refresh_token: 'R1', expires_in: 3600 });
      const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => exchange, lifecycleEventStore: store });
      await refresh(ids.connectionId, ids.accountId);
      assert.equal(events.at(-1).kind, K.REFRESH_SUCCESS);
      assert.equal(events.at(-1).detail.via, 'byte-identical');
    });

    test('no connection-keyed record: REFRESH_SKIP no-durable-record, no exchange', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore, { withRecord: false });
      const { events, store } = eventRecorder();
      let exchanged = 0;
      const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => async () => { exchanged++; }, lifecycleEventStore: store });
      assert.equal(await refresh(ids.connectionId, ids.accountId), null);
      assert.equal(exchanged, 0);
      assert.deepEqual(events.map(e => [e.kind, e.detail.branch]), [[K.REFRESH_SKIP, 'no-durable-record']]);
      assertAttributed(events, ids);
    });

    test('exchange fails (transient): SPEND_INTENT then REFRESH_FAIL with the error code, rethrown', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const { events, store } = eventRecorder();
      const exchange = async () => { throw new TokenRefreshError('blip', 'NETWORK'); };
      const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => exchange, lifecycleEventStore: store });
      await assert.rejects(refresh(ids.connectionId, ids.accountId), /blip/);
      assert.deepEqual(events.map(e => [e.kind, e.detail.reason ?? e.detail.attempted]), [[K.SPEND_INTENT, true], [K.REFRESH_FAIL, 'NETWORK']]);
      assertAttributed(events, ids);
    });

    test('invalid_grant after a concurrent rotation: REFRESH_SUCCESS via converged-race-loser', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const { events, store } = eventRecorder();
      const exchange = async () => {
        // A concurrent winner rotated the record before our exchange failed.
        await ownerCredentialStore.putByConnection(ids.connectionId, { refreshToken: 'R-winner', token: 'winner-tok' });
        throw new TokenRefreshError('invalid_grant', 'EXPIRED');
      };
      const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => exchange, lifecycleEventStore: store });
      const out = await refresh(ids.connectionId, ids.accountId);
      assert.equal(out.token, 'winner-tok');
      assert.equal(events.at(-1).kind, K.REFRESH_SUCCESS);
      assert.equal(events.at(-1).detail.via, 'converged-race-loser');
    });

    test('CAS lost: converged-cas-loser when a record remains, cas-lost-no-record when it does not', async () => {
      for (const [remaining, expected] of [[true, [K.REFRESH_SUCCESS, 'converged-cas-loser']], [false, [K.REFRESH_FAIL, 'cas-lost-no-record']]]) {
        const { connectionStore, ownerCredentialStore } = stores();
        const ids = await seed(connectionStore, ownerCredentialStore);
        const { events, store } = eventRecorder();
        const exchange = async () => {
          if (remaining) await ownerCredentialStore.putByConnection(ids.connectionId, { refreshToken: 'R-other', token: 'other-tok' });
          else await ownerCredentialStore.collection.deleteOne({ _id: ids.connectionId });
          return { access_token: 'new-tok', refresh_token: 'R1', expires_in: 3600 };
        };
        const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => exchange, lifecycleEventStore: store });
        if (remaining) await refresh(ids.connectionId, ids.accountId);
        else await assert.rejects(refresh(ids.connectionId, ids.accountId));
        const last = events.at(-1);
        assert.deepEqual([last.kind, last.detail.via ?? last.detail.reason], expected);
      }
    });

    test('spend-intent past the reuse grace: REFRESH_FAIL spend-intent-past-grace, no exchange', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      await ownerCredentialStore.collection.updateOne({ _id: ids.connectionId }, {
        $set: { pendingSpend: { refreshToken: 'R0', attemptedAt: new Date(Date.now() - LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS - 1000) } }
      });
      const { events, store } = eventRecorder();
      let exchanged = 0;
      const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => async () => { exchanged++; }, lifecycleEventStore: store });
      await assert.rejects(refresh(ids.connectionId, ids.accountId), (err) => err.code === 'EXPIRED');
      assert.equal(exchanged, 0);
      assert.deepEqual(events.map(e => [e.kind, e.detail.reason]), [[K.REFRESH_FAIL, 'spend-intent-past-grace']]);
    });

    test('a throwing event store never breaks the refresh', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const exchange = async () => ({ access_token: 'new-tok', refresh_token: 'R1', expires_in: 3600 });
      const refresh = createConnectionRefresher({
        connectionStore, ownerCredentialStore, resolveExchange: () => exchange,
        lifecycleEventStore: { async recordEvent() { throw new Error('log store down'); } },
      });
      assert.equal((await refresh(ids.connectionId, ids.accountId)).token, 'new-tok');
    });

    test('server.js wires the lifecycle store into the one refresher instance', () => {
      const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
      const start = src.indexOf('= createConnectionRefresher({');
      const block = src.slice(start, src.indexOf('});', start));
      assert.match(block, /lifecycleEventStore: credentialLifecycleEventStore/);
    });
  });

  describe('D4/S7 — per-referent cache eviction on a Connection release', () => {
    test('definitive revocation (deleteConnection) evicts EVERY referent of the deleted Connection', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const workspace = { urlKey: 'ws-a', bindings: [{ provider: 'linear', scope: 'org-1', connectionId: ids.connectionId }] };
      const evicted = [];
      const out = await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace, provider: 'linear', scope: 'org-1', mode: 'revoke', evict: (u) => evicted.push(u) });
      assert.equal(out.released, 1);
      assert.deepEqual(evicted.sort(), ['ws-a', 'ws-b'], 'the sibling referent ws-b is evicted too');
      assert.equal(await connectionStore.readConnectionById(ids.connectionId), null);
      assert.equal(await ownerCredentialStore.getByConnection(ids.connectionId), null);
    });

    test('last-referent unlink evicts the released referent; a non-last unlink evicts nothing', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const ids = await seed(connectionStore, ownerCredentialStore);
      const evicted = [];
      const evict = (u) => evicted.push(u);
      const binding = { provider: 'linear', scope: 'org-1', connectionId: ids.connectionId };
      await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace: { urlKey: 'ws-a', bindings: [binding] }, mode: 'unlink', evict });
      assert.deepEqual(evicted, [], 'ws-b still references the Connection: nothing released, nothing evicted');
      assert.ok(await connectionStore.readConnectionById(ids.connectionId));
      await releaseConnectionCredential({ connectionStore, ownerCredentialStore, workspace: { urlKey: 'ws-b', bindings: [binding] }, mode: 'unlink', evict });
      assert.deepEqual(evicted, ['ws-b']);
      assert.equal(await connectionStore.readConnectionById(ids.connectionId), null);
    });

    test('a legacy workspace releases nothing and evicts nothing', async () => {
      const { connectionStore, ownerCredentialStore } = stores();
      const evicted = [];
      const out = await releaseConnectionCredential({
        connectionStore, ownerCredentialStore, mode: 'revoke', provider: 'linear', scope: 'org-1',
        workspace: { urlKey: 'ws-l', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 't' } }] },
        evict: (u) => evicted.push(u),
      });
      assert.deepEqual(out, { released: 0, referents: [] });
      assert.deepEqual(evicted, []);
    });

    test('every releaseConnectionCredential call site passes the per-referent evict (LIN-3219 A3: boundary, no census)', () => {
      // The per-file census total ("7 after review blocker 3") is gone: the
      // boundary rule IS the assertion — every `releaseConnectionCredential({…})`
      // call in the two files passes an `evict:` hook. A new call that omits it
      // fails; a new call that passes it needs no count bump.
      const re = /releaseConnectionCredential\(\{[^\n]*\}\)/g;
      const sites = [];
      for (const rel of ['server.js', 'routes/workspace.js']) {
        const src = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
        for (const m of src.match(re) || []) sites.push([rel, m]);
      }
      assert.ok(sites.length > 0, 'a zero-finding scan would be vacuous');
      for (const [rel, call] of sites) assert.match(call, /evict: /, `${rel}: ${call}`);
    });
  });
});
