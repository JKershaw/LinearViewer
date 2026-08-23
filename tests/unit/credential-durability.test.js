/**
 * LIN-2235 (Ticket C of the LIN-2231 design) — credential durability: L4.1's
 * spend-intent journal (rotation-safe refresh across a process death) and
 * L4.2's mirror-into-every-live-row (rotation retirement of stale mirrors).
 *
 * Block A drives `OwnerCredentialStore`'s spend-intent marker methods
 * (`markSpendIntent`/`clearSpendIntent`) and `putIfRefreshToken`'s implicit
 * clear, against a real Mango collection.
 * Block B drives `doOwnerRefresh`/`refreshOwnerCredential`
 * (lib/workspace-token-refresh.js) with fake IO — the fault-injection case
 * from the ticket's own acceptance criteria (a throw between the Linear
 * exchange and the CAS write), the within-grace replay, and the past-grace
 * "credential-dead" report.
 * Block C drives the pure selector `selectAllOwnerSessionRows`
 * (lib/workspace-token-resolver.js) directly.
 * Block D drives `refreshOwnerWorkspaceToken` (doRefresh) end-to-end,
 * proving a successful rotation mirrors into EVERY live session row, not
 * just the latest-expiring one — and that `selectOwnerWorkspaceToken`'s own
 * max-expiry algorithm (LIN-1982) is untouched.
 *
 * Run with: node --test tests/unit/credential-durability.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { selectAllOwnerSessionRows, selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerCredential, refreshOwnerWorkspaceToken, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000; // ~2.8h
const PAST_MS = -10_000;

// ---------------------------------------------------------------------------
// Block A — OwnerCredentialStore's spend-intent marker (real Mango store)
// ---------------------------------------------------------------------------

describe('OwnerCredentialStore spend-intent marker (LIN-2235, Block A — behavioural)', () => {
  let dbClient, dbDir, counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'credential-durability-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = dbClient.db(`journal_${counter++}`);
    return new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
  }

  test('markSpendIntent writes a pendingSpend marker onto the existing record', async () => {
    const store = freshStore();
    await store.put('acct-1', 'acme', { provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + FAR_FUTURE_MS });

    await store.markSpendIntent('acct-1', 'acme', 'linear', 'R0');

    const record = await store.get('acct-1', 'acme', 'linear');
    assert.equal(record.pendingSpend.refreshToken, 'R0');
    assert.ok(record.pendingSpend.attemptedAt instanceof Date);
    // The rest of the record is untouched — this is a targeted field write.
    assert.equal(record.token, 'T0');
    assert.equal(record.refreshToken, 'R0');
  });

  test('clearSpendIntent resolves the marker without touching sibling fields', async () => {
    const store = freshStore();
    await store.put('acct-1', 'acme', { provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + FAR_FUTURE_MS });
    await store.markSpendIntent('acct-1', 'acme', 'linear', 'R0');

    await store.clearSpendIntent('acct-1', 'acme', 'linear');

    const record = await store.get('acct-1', 'acme', 'linear');
    assert.equal(record.pendingSpend, null);
    assert.equal(record.refreshToken, 'R0');
  });

  test('a landed putIfRefreshToken write always clears pendingSpend as part of the same atomic write', async () => {
    const store = freshStore();
    await store.put('acct-1', 'acme', { provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + FAR_FUTURE_MS });
    await store.markSpendIntent('acct-1', 'acme', 'linear', 'R0');

    const won = await store.putIfRefreshToken('acct-1', 'acme', 'R0', {
      provider: 'linear', token: 'T1', refreshToken: 'R1', tokenExpiresAt: NOW + FAR_FUTURE_MS
    });
    assert.ok(won);

    const record = await store.get('acct-1', 'acme', 'linear');
    assert.equal(record.pendingSpend, null, 'a successful rotation resolves any marker the spent token carried');
    assert.equal(record.refreshToken, 'R1');
  });

  test('markSpendIntent/clearSpendIntent complete without throwing against a record that does not exist (a miss is harmless, mirroring the store\'s no-throw convention — see put/delete)', async () => {
    const store = freshStore();
    assert.equal(await store.markSpendIntent('nobody', 'acme', 'linear', 'R0'), true);
    assert.equal(await store.clearSpendIntent('nobody', 'acme', 'linear'), true);
    assert.equal(await store.get('nobody', 'acme', 'linear'), null, 'and, crucially, does NOT create a record — no upsert');
  });
});

// ---------------------------------------------------------------------------
// Block B — doOwnerRefresh's spend-intent detection (fault injection)
// ---------------------------------------------------------------------------

// A minimal stateful fake mirroring OwnerCredentialStore's relevant surface
// (get/putIfRefreshToken/markSpendIntent/clearSpendIntent), in the same style
// as tests/unit/workspace-token-refresh.test.js's own fakeStore — kept local
// rather than imported so this file stays self-contained (that file's fake
// is not exported).
function fakeJournalStore(seed) {
  let record = seed;
  const putCalls = [];
  return {
    async get() { return record; },
    async putIfRefreshToken(accountId, urlKey, expected, next) {
      if (!record || record.refreshToken !== expected) return false;
      putCalls.push(next);
      record = { ...next, pendingSpend: null };
      return true;
    },
    async markSpendIntent(accountId, urlKey, provider, spentRefreshToken) {
      if (!record) return false;
      record = { ...record, pendingSpend: { refreshToken: spentRefreshToken, attemptedAt: new Date() } };
      return true;
    },
    async clearSpendIntent() {
      if (!record) return false;
      record = { ...record, pendingSpend: null };
      return true;
    },
    _current: () => record,
  };
}

describe('doOwnerRefresh spend-intent detection (LIN-2235, Block B — fault injection)', () => {
  beforeEach(() => _resetInflightForTests());

  test('AC1: a process death between the exchange and the CAS write leaves an unresolved marker that the NEXT resolve detects and, within grace, safely replays', async () => {
    const store = fakeJournalStore({ provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });

    // First attempt: the Linear exchange succeeds, but the CAS write itself
    // "crashes" (an uncaught throw simulates the process dying before
    // putIfRefreshToken can run) — doOwnerRefresh's own code never wraps this
    // window in a try/catch, so nothing resolves the marker `markSpendIntent`
    // set moments earlier. We can't literally kill the process, so the crash
    // is simulated by making putIfRefreshToken itself throw, uncaught by any
    // of doOwnerRefresh's own try/catch blocks (there is none around that call).
    const okExchange = async (refreshToken) => {
      assert.equal(refreshToken, 'R0');
      return { access_token: 'T1', refresh_token: 'R1', expires_in: 3600 };
    };
    const crashingStore = {
      ...store,
      async putIfRefreshToken() { throw new Error('simulated process death mid-flight (CAS write never lands)'); },
    };

    await assert.rejects(
      () => refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', refreshAccessToken: okExchange, store: crashingStore }),
      /simulated process death/
    );
    // The marker is still set — nothing in that call resolved it.
    assert.equal(store._current().pendingSpend.refreshToken, 'R0');
    assert.equal(store._current().refreshToken, 'R0', 'the durable record itself was never rotated — the crash happened before the CAS write');

    _resetInflightForTests();

    // "The next resolve" — a fresh attempt against the SAME (still-unrotated)
    // record, well within Linear's 30-minute reuse grace. Detects the marker,
    // falls through, and replays `attempted` (R0) exactly like an ordinary
    // refresh — this time the CAS write lands normally.
    const result = await refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', refreshAccessToken: okExchange, store });
    assert.equal(result.token, 'T1');
    assert.equal(result.refreshToken, 'R1');
    assert.equal(store._current().pendingSpend, null, 'the successful replay resolves the marker');
  });

  test('AC1b: past Linear\'s 30-minute reuse grace, an unresolved marker is reported credential-dead (EXPIRED) and NEVER replayed', async () => {
    const staleMarkerRecord = {
      provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS,
      pendingSpend: { refreshToken: 'R0', attemptedAt: new Date(Date.now() - 31 * 60 * 1000) } // 31 minutes ago
    };
    const store = fakeJournalStore(staleMarkerRecord);
    let exchangeCalls = 0;
    const refreshAccessToken = async () => { exchangeCalls++; return { access_token: 'should-not-be-reached', refresh_token: 'nope', expires_in: 3600 }; };

    await assert.rejects(
      () => refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', refreshAccessToken, store }),
      (err) => {
        assert.ok(err instanceof TokenRefreshError);
        assert.equal(err.code, 'EXPIRED', 'reported the same way a genuine revocation is, so every existing caller (LIN-1545 delete guard; the headless 503 fall-through) handles it correctly with no new plumbing');
        return true;
      }
    );
    assert.equal(exchangeCalls, 0, 'never replayed the exchange — "retrying a dead token forever" is exactly what amendment A3 rules out past grace');
  });

  test('a marker within grace but for a DIFFERENT (already-rotated-away) refreshToken is ignored — only a marker matching the CURRENT record blocks/gates anything', async () => {
    const record = {
      provider: 'linear', token: 'T1', refreshToken: 'R1', tokenExpiresAt: NOW + PAST_MS,
      pendingSpend: { refreshToken: 'R0', attemptedAt: new Date() } // stale marker from a PRIOR, already-resolved rotation
    };
    const store = fakeJournalStore(record);
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'R1', 'the CURRENT refreshToken is what gets spent, not the stale marker\'s');
      return { access_token: 'T2', refresh_token: 'R2', expires_in: 3600 };
    };

    const result = await refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', refreshAccessToken, store });
    assert.equal(result.token, 'T2');
  });

  test('an ordinary (non-crashed) exchange failure clears its own marker in the same process — no false detection on the next attempt', async () => {
    const store = fakeJournalStore({ provider: 'linear', token: 'T0', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });
    const failingExchange = async () => { throw new TokenRefreshError('boom', 'NETWORK'); };

    await assert.rejects(() => refreshOwnerCredential({ ownerAccountId: 'acct-1', urlKey: 'acme', refreshAccessToken: failingExchange, store }));
    assert.equal(store._current().pendingSpend, null, 'a cleanly-observed failure resolves its own marker — it is not a crash');
  });
});

// ---------------------------------------------------------------------------
// Block C — selectAllOwnerSessionRows (pure selector)
// ---------------------------------------------------------------------------

function sessionRow(sid, accountId, urlKey, { accessToken, expiresAt, provider = 'linear' } = {}) {
  return { _id: sid, session: { accountId, workspaces: [{ urlKey, provider, accessToken, tokenExpiresAt: expiresAt }] } };
}

describe('selectAllOwnerSessionRows (LIN-2235, Block C — pure selector)', () => {
  test('returns EVERY row referencing the workspace for the owner, not just the max-expiry one', () => {
    const sessions = [
      sessionRow('sid-1', 'acct-1', 'acme', { accessToken: 'old', expiresAt: NOW + 1000 }),
      sessionRow('sid-2', 'acct-1', 'acme', { accessToken: 'newer', expiresAt: NOW + FAR_FUTURE_MS }),
      sessionRow('sid-3', 'acct-1', 'acme', { accessToken: 'expired', expiresAt: NOW + PAST_MS }),
    ];
    const rows = selectAllOwnerSessionRows(sessions, 'acme', 'acct-1');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.sid).sort(), ['sid-1', 'sid-2', 'sid-3']);
  });

  test('excludes a different owner\'s rows and rows for a different workspace', () => {
    const sessions = [
      sessionRow('sid-1', 'acct-1', 'acme', { accessToken: 'a', expiresAt: NOW + FAR_FUTURE_MS }),
      sessionRow('sid-2', 'acct-2', 'acme', { accessToken: 'b', expiresAt: NOW + FAR_FUTURE_MS }),
      sessionRow('sid-3', 'acct-1', 'other-workspace', { accessToken: 'c', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    const rows = selectAllOwnerSessionRows(sessions, 'acme', 'acct-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sid, 'sid-1');
  });

  test('empty/null ownerAccountId -> []', () => {
    assert.deepEqual(selectAllOwnerSessionRows([sessionRow('sid-1', 'acct-1', 'acme', { expiresAt: NOW })], 'acme', null), []);
    assert.deepEqual(selectAllOwnerSessionRows([], 'acme', 'acct-1'), []);
  });
});

// ---------------------------------------------------------------------------
// Block D — refreshOwnerWorkspaceToken mirrors into every live row
// ---------------------------------------------------------------------------

describe('refreshOwnerWorkspaceToken mirrors a rotation into every live session row (LIN-2235, Block D)', () => {
  beforeEach(() => _resetInflightForTests());

  test('AC2: after a successful rotation, EVERY session row for (owner, workspace) carries the fresh token — not just the previously-latest-expiring one', async () => {
    const sessions = [
      sessionRow('sid-old', 'acct-1', 'acme', { accessToken: 'stale-old', expiresAt: NOW + 1000 }),
      sessionRow('sid-latest', 'acct-1', 'acme', { accessToken: 'stale-latest', expiresAt: NOW + 2000 }),
      sessionRow('sid-other-workspace', 'acct-1', 'other-ws', { accessToken: 'untouched', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    const persisted = new Map();
    const persistSession = async (sid, session) => { persisted.set(sid, JSON.parse(JSON.stringify(session))); };
    const store = fakeJournalStore({ provider: 'linear', token: 'stale-durable', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS });
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'R0');
      return { access_token: 'fresh-mirrored-token', refresh_token: 'R1', expires_in: 3600 };
    };

    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'acct-1', refreshAccessToken, persistSession, store });
    assert.equal(result.token, 'fresh-mirrored-token');

    assert.equal(persisted.get('sid-old').workspaces[0].accessToken, 'fresh-mirrored-token');
    assert.equal(persisted.get('sid-latest').workspaces[0].accessToken, 'fresh-mirrored-token');
    assert.ok(!persisted.has('sid-other-workspace'), 'a row for a DIFFERENT workspace is never touched');
  });

  test('non-goal witness: selectOwnerWorkspaceToken\'s own max-expiry SELECTION algorithm (LIN-1982) is unchanged by this ticket', () => {
    const sessions = [
      sessionRow('sid-1', 'acct-1', 'acme', { accessToken: 'tokA', expiresAt: NOW + 1000 }),
      sessionRow('sid-2', 'acct-1', 'acme', { accessToken: 'tokB', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'acct-1');
    assert.equal(result.token, 'tokB', 'still picks the latest-expiring row for READ selection — mirroring on WRITE (Block D above) is additive, not a replacement for this');
  });
});
