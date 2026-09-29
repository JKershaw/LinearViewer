/**
 * LIN-3124 PR2 (S2) — T9/T10/T11/T13: the connection-credential seam.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-connection-credential.test.js
 *
 * Real MangoDB stores for the durable/connection layers; a fake exchange
 * (network IO must be injected) for the refresh. `refreshConnection` is never
 * called in production until PR3, so these are new-code tests.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import {
  createConnectionRefresher,
  hydrateSession,
  sanitizeSessionForPersist,
  authorizeConnection,
  collectSessionConnectionIds,
} from '../../lib/connection-credential.js';
import { readBindingCredential, readWorkspaceCredential } from '../../lib/connection-binding.js';
import { MongoSessionStore } from '../../lib/session-store.js';

const REFERENT_A = { urlKey: 'ws-a', provider: 'linear', scope: 'org-1' };
const REFERENT_B = { urlKey: 'ws-b', provider: 'linear', scope: 'org-1' };

describe('LIN-3124 PR2 T9/T10/T11/T13 — connection-credential seam', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr2-cc-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function stores() {
    const db = client.db(`pr2cc_${counter++}`);
    return {
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
    };
  }

  async function seedLinearConnection(connectionStore, ownerCredentialStore, { token = 'old-tok', refreshToken = 'R0', expiresAt = Date.now() + 3600_000 } = {}) {
    const accountId = randomUUID();
    await connectionStore.link(accountId, 'linear', 'org-1', { token, tokenExpiresAt: expiresAt }, REFERENT_A);
    const connectionId = connectionStore._id(accountId, 'linear', 'org-1');
    await connectionStore.link(accountId, 'linear', 'org-1', { token, tokenExpiresAt: expiresAt }, REFERENT_B);
    await ownerCredentialStore.putByConnection(connectionId, {
      accountId, provider: 'linear', scope: 'org-1', token, refreshToken, tokenExpiresAt: expiresAt
    });
    return { accountId, connectionId };
  }

  test('T9: two urlKeys on one connection, concurrent refresh → 1 exchange, 1 record', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const { accountId, connectionId } = await seedLinearConnection(connectionStore, ownerCredentialStore);

    let exchanges = 0;
    const exchange = async () => {
      exchanges++;
      await new Promise(r => setTimeout(r, 10));
      return { access_token: 'new-tok', refresh_token: 'R1', expires_in: 3600 };
    };
    const refresh = createConnectionRefresher({
      connectionStore, ownerCredentialStore, resolveExchange: () => exchange, refreshAccessToken: exchange
    });

    const [a, b] = await Promise.all([refresh(connectionId, accountId), refresh(connectionId, accountId)]);

    assert.strictEqual(exchanges, 1, 'both referents share one exchange');
    assert.strictEqual(a.token, 'new-tok');
    assert.strictEqual(b.token, 'new-tok');
    assert.strictEqual((await ownerCredentialStore.getByConnection(connectionId)).refreshToken, 'R1');
    assert.strictEqual((await connectionStore.readConnectionById(connectionId)).credentials.token, 'new-tok');
  });

  test('T10: exactly one inflight.set( site, and concurrent entrants settle', async () => {
    const src = readFileSync(new URL('../../lib/connection-credential.js', import.meta.url), 'utf8');
    assert.strictEqual((src.match(/inflight\.set\(/g) || []).length, 1, 'the only registration layer');

    const { connectionStore, ownerCredentialStore } = stores();
    const { accountId, connectionId } = await seedLinearConnection(connectionStore, ownerCredentialStore);
    let exchanges = 0;
    const refresh = createConnectionRefresher({
      connectionStore, ownerCredentialStore, resolveExchange: () => async () => { exchanges++; return { access_token: 'x', refresh_token: 'R1', expires_in: 3600 }; },
      refreshAccessToken: async () => { exchanges++; return { access_token: 'x', refresh_token: 'R1', expires_in: 3600 }; }
    });
    const results = await Promise.race([
      Promise.all([refresh(connectionId, accountId), refresh(connectionId, accountId), refresh(connectionId, accountId)]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock: entrants did not settle')), 2000)),
    ]);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(exchanges, 1);
  });

  test('T11: owner CAS first; a failed Connection mirror is repaired without re-spending', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const { accountId, connectionId } = await seedLinearConnection(connectionStore, ownerCredentialStore);

    const attempted = [];
    let exchangeCount = 0;
    const exchange = async (token) => {
      attempted.push(token);
      exchangeCount++;
      return { access_token: `tok-${exchangeCount}`, refresh_token: `R${exchangeCount}`, expires_in: 3600 };
    };

    let failNextMirror = true;
    const flakyConnectionStore = {
      readConnectionById: (id) => connectionStore.readConnectionById(id),
      deleteConnection: (id) => connectionStore.deleteConnection(id),
      updateCredentials: async (id, creds) => {
        if (failNextMirror) { failNextMirror = false; throw new Error('connection mirror write failed'); }
        return connectionStore.updateCredentials(id, creds);
      },
    };
    const refresh = createConnectionRefresher({
      connectionStore: flakyConnectionStore, ownerCredentialStore, resolveExchange: () => exchange, refreshAccessToken: exchange
    });

    await assert.rejects(() => refresh(connectionId, accountId), /mirror write failed/);
    // D9: the owner CAS is the authority and already rotated to R1.
    assert.strictEqual((await ownerCredentialStore.getByConnection(connectionId)).refreshToken, 'R1');
    // The Connection mirror lagged (still the pre-rotation token).
    assert.strictEqual((await connectionStore.readConnectionById(connectionId)).credentials.token, 'old-tok');

    // Next resolve re-reads the rotated record — no second spend of R0.
    await refresh(connectionId, accountId);
    assert.deepStrictEqual(attempted, ['R0', 'R1']);
    assert.strictEqual((await connectionStore.readConnectionById(connectionId)).credentials.token, 'tok-2');
  });

  test('T11b: a definitive revocation converges on a concurrent winner (no throw)', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const { accountId, connectionId } = await seedLinearConnection(connectionStore, ownerCredentialStore);

    const winner = async () => ({ access_token: 'winner-tok', refresh_token: 'R-winner', expires_in: 3600 });
    const refresh = createConnectionRefresher({
      connectionStore, ownerCredentialStore, resolveExchange: () => async () => {
        // A concurrent winner rotated the durable record to R-winner before we
        // returned: the stored record no longer holds the spent R0.
        await ownerCredentialStore.putByConnection(connectionId, { accountId, provider: 'linear', token: 'winner-tok', refreshToken: 'R-winner', tokenExpiresAt: Date.now() + 3600_000 });
        const { TokenRefreshError } = await import('../../lib/token-refresh.js');
        throw new TokenRefreshError('invalid_grant', 'EXPIRED');
      }
    });
    const result = await refresh(connectionId, accountId);
    assert.strictEqual(result.token, 'winner-tok');
  });

  test('T13: hydration fills the side-table, authorizes the owner, and fails closed', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const accountId = randomUUID();
    await connectionStore.put(accountId, 'linear', 'org-1', { token: 'real-tok', tokenExpiresAt: 1, refreshToken: undefined });
    const connectionId = connectionStore._id(accountId, 'linear', 'org-1');

    const binding = { provider: 'linear', scope: 'org-1', connectionId, activeBinding: undefined };
    const workspace = { urlKey: 'ws-a', provider: 'linear', connectionId: undefined, activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: [binding] };
    const session = { accountId, workspaces: [workspace] };

    const hydrated = await hydrateSession(session, { connectionStore });
    assert.strictEqual(hydrated, 1);
    assert.strictEqual(readBindingCredential(binding).token, 'real-tok');
    assert.strictEqual(readWorkspaceCredential(workspace).token, 'real-tok', 'active binding mirrors to the workspace');

    // Unauthorized owner: another account's connection is never served.
    const otherSession = { accountId: randomUUID(), workspaces: [{ urlKey: 'ws-a', activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: [{ provider: 'linear', scope: 'org-1', connectionId }] }] };
    const otherBinding = otherSession.workspaces[0].bindings[0];
    assert.strictEqual(await hydrateSession(otherSession, { connectionStore }), 0);
    assert.strictEqual(readBindingCredential(otherBinding), undefined, 'fail closed for another owner');

    // Missing connection: unhydrated.
    const missing = { accountId, workspaces: [{ bindings: [{ provider: 'linear', scope: 'org-1', connectionId: `${accountId}::linear::gone` }] }] };
    assert.strictEqual(await hydrateSession(missing, { connectionStore }), 0);
    assert.strictEqual(readBindingCredential(missing.workspaces[0].bindings[0]), undefined);

    assert.deepStrictEqual(collectSessionConnectionIds(session), [connectionId]);
    assert.strictEqual(await authorizeConnection({ accountId }, await Promise.resolve(accountId)), true);
    assert.strictEqual(await authorizeConnection({ accountId }, 'someone-else'), false);
  });

  test('T13: sanitizer strips a connection-backed credential in both session write paths', async () => {
    const decoy = {
      urlKey: 'ws-a',
      provider: 'linear',
      accessToken: 'DECOY-session-token',
      credentials: { token: 'DECOY-session-token' },
      tokenExpiresAt: 123,
      activeBinding: { provider: 'linear', scope: 'org-1' },
      bindings: [{ provider: 'linear', scope: 'org-1', connectionId: 'acct::linear::org-1', credentials: { token: 'DECOY-binding-token' } }],
    };
    const legacy = {
      urlKey: 'ws-b', provider: 'linear', accessToken: 'legacy-tok',
      credentials: { token: 'legacy-tok' }, tokenExpiresAt: 42,
      bindings: [{ provider: 'linear', scope: 'org-9', credentials: { token: 'legacy-tok' } }],
    };
    const session = { workspaces: [decoy, legacy] };

    sanitizeSessionForPersist(session);

    assert.strictEqual(decoy.accessToken, undefined);
    assert.strictEqual(decoy.credentials, undefined);
    assert.strictEqual(decoy.tokenExpiresAt, undefined);
    assert.strictEqual(decoy.bindings[0].credentials, undefined);
    assert.strictEqual(legacy.accessToken, 'legacy-tok', 'legacy shape is byte-identical');
    assert.strictEqual(legacy.credentials.token, 'legacy-tok');
    assert.strictEqual(legacy.bindings[0].credentials.token, 'legacy-tok');

    // Write path 1: MongoSessionStore.set sanitizes before persisting.
    const written = [];
    const store = new MongoSessionStore({ collection: { async updateOne(_f, update) { written.push(update.$set.session); } } });
    const live = { workspaces: [{ ...decoy, bindings: [{ ...decoy.bindings[0] }], activeBinding: { ...decoy.activeBinding } }] };
    await new Promise((resolve, reject) => store.set('sid-1', live, (err) => err ? reject(err) : resolve()));
    assert.strictEqual(written[0].workspaces[0].accessToken, undefined);
    assert.strictEqual(written[0].workspaces[0].credentials, undefined);
    assert.strictEqual(written[0].workspaces[0].bindings[0].credentials, undefined);

    // Write path 2: server.js's persistSessionRow calls the sanitizer (static pin).
    const serverSrc = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const start = serverSrc.indexOf('function persistSessionRow(sid, session) {');
    assert.ok(start > 0);
    const body = serverSrc.slice(start, start + 600);
    assert.match(body, /sanitizeSessionForPersist\(session\)/, 'persistSessionRow must sanitize');
    const sessionStoreSrc = readFileSync(new URL('../../lib/session-store.js', import.meta.url), 'utf8');
    assert.match(sessionStoreSrc, /sanitizeSessionForPersist\(session\)/);
  });

  // B4/R17 — spend-intent is marked BEFORE the exchange, and a past-grace
  // marker rejects with EXPIRED without spending the token.
  test('B4/R17: spend-intent precedes the exchange; past-grace marker rejects EXPIRED with no exchange', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const { accountId, connectionId } = await seedLinearConnection(connectionStore, ownerCredentialStore);

    const order = [];
    const exchange = async () => { order.push('exchange'); return { access_token: 't', refresh_token: 'R1', expires_in: 3600 }; };
    const spy = new Proxy(ownerCredentialStore, {
      get(target, prop) {
        if (prop === 'markSpendIntentByConnection') {
          return (...a) => { order.push('mark'); return target.markSpendIntentByConnection(...a); };
        }
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      }
    });
    const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore: spy, resolveExchange: () => exchange, refreshAccessToken: exchange });
    await refresh(connectionId, accountId);
    assert.deepStrictEqual(order.slice(0, 2), ['mark', 'exchange'], 'markSpendIntent must precede the exchange');

    // Past-grace marker: no exchange, EXPIRED.
    const { connectionStore: cs2, ownerCredentialStore: ocs2 } = stores();
    const seeded = await seedLinearConnection(cs2, ocs2, { refreshToken: 'R-old' });
    await ocs2.markSpendIntentByConnection(seeded.connectionId, 'R-old');
    await ocs2.collection.updateOne(
      { _id: seeded.connectionId },
      { $set: { 'pendingSpend.attemptedAt': new Date(Date.now() - 31 * 60 * 1000) } }
    );
    let exchanged = 0;
    const refresh2 = createConnectionRefresher({
      connectionStore: cs2, ownerCredentialStore: ocs2,
      resolveExchange: () => async () => { exchanged++; return {}; },
      refreshAccessToken: async () => { exchanged++; return {}; }
    });
    await assert.rejects(() => refresh2(seeded.connectionId, seeded.accountId), (err) => err.code === 'EXPIRED');
    assert.strictEqual(exchanged, 0, 'a past-grace spend-intent must not re-spend');
  });

  // B4/R15 — a CAS loser converges on the stored winner and never throws.
  test('B4/R15: a CAS loser converges on the winner', async () => {
    const { connectionStore, ownerCredentialStore } = stores();
    const { accountId, connectionId } = await seedLinearConnection(connectionStore, ownerCredentialStore);

    // The exchange lands a concurrent winner's record before we try to CAS on R0,
    // so `putIfRefreshTokenByConnection` misses.
    const exchange = async () => {
      await ownerCredentialStore.putByConnection(connectionId, {
        accountId, provider: 'linear', token: 'tokW', refreshToken: 'winner', tokenExpiresAt: Date.now() + 3600_000
      });
      return { access_token: 'tokL', refresh_token: 'loser', expires_in: 3600 };
    };
    const refresh = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveExchange: () => exchange, refreshAccessToken: exchange });

    const result = await refresh(connectionId, accountId);
    assert.strictEqual(result.token, 'tokW');
    assert.strictEqual(result.refreshToken, 'winner');
  });
});
