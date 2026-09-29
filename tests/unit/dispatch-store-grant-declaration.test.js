/**
 * LIN-3138 S1 (LIN-3134 T2-i) — store: declared-record persistence, archive
 * allow-list, secrecy, and the three-state `getGrantDeclaration` lookup.
 *
 * Mirrors tests/unit/dispatch-store-bootstrap-token.test.js. Covers the store
 * half of the witnesses the ticket names:
 *   - F2 (7) store half: sparse persistence; the record is present on the
 *     persisted and archived documents and readable via `getGrantDeclaration`
 *     (history fallback), and ABSENT from `addItem`'s return and every
 *     projection (Decision 9 secrecy);
 *   - F2 (9) store precondition: the recorded `ownerAccountId` / `workspaceId`
 *     round-trip verbatim through persistence + archive (the helper mints from
 *     these; the token-level assertion is S3);
 *   - N3 store cells: record / none / row-missing, the miss log only for the
 *     last, and a thrown read (incl. a re-read) rethrown with
 *     `declarationLookupFailed = true`;
 *   - R1 take-hop: delete-then-insert fakes, bounded history-only re-reads
 *     driven by mock timers, exactly one active read, at most 3 re-reads;
 *   - declared round trip through take / cancel / expiry archive hops;
 *   - undeclared byte-identity (no key written).
 *
 * Inert: nothing in production calls `getGrantDeclaration` yet.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore, GRANT_LOOKUP_HISTORY_RETRIES, GRANT_LOOKUP_RETRY_MS } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const RECORD = {
  grants: ['dispatch'],
  ownerAccountId: 'owner-A',
  workspaceId: 'ws-A',
  profile: 'worker',
  site: 'proxy-kickoff',
  declaredAt: '2026-09-29T00:00:00.000Z'
};
const RECORD_MARKERS = ['owner-A', 'ws-A', 'proxy-kickoff', '2026-09-29T00:00:00.000Z'];

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

function declaredItem(overrides = {}) {
  return { prompt: 'run me', grantDeclaration: RECORD, ...overrides };
}

// ── constants ────────────────────────────────────────────────────────────────

describe('S1 — lookup tuning constants', () => {
  test('bounded history re-read: 3 retries at 50 ms', () => {
    assert.equal(GRANT_LOOKUP_HISTORY_RETRIES, 3);
    assert.equal(GRANT_LOOKUP_RETRY_MS, 50);
  });
});

// ── sparse persistence (Decision 8) ──────────────────────────────────────────

describe('S1 — sparse persistence on addItem / _archiveItem', () => {
  test('addItem persists grantDeclaration whole when present', async () => {
    const store = makeStore();
    await store.addItem('acme', declaredItem());
    assert.deepEqual(store.collection._docs[0].grantDeclaration, RECORD);
  });

  test('addItem persists grantRefusal when present', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'run me', grantDeclaration: RECORD, grantRefusal: 'INVALID_GRANTS' });
    assert.equal(store.collection._docs[0].grantRefusal, 'INVALID_GRANTS');
  });

  test('an undeclared item writes NEITHER key (byte-identity)', async () => {
    const store = makeStore();
    const doc = await store.addItem('acme', { prompt: 'run me' });
    assert.equal('grantDeclaration' in doc, false);
    assert.equal('grantRefusal' in doc, false);
    // The raw persisted queue document also keeps exactly its old key set.
    assert.equal('grantDeclaration' in store.collection._docs[0], false);
    assert.equal('grantRefusal' in store.collection._docs[0], false);

    await store.takeItem(doc._id, 'acme');
    const hist = store.historyCollection._docs[0];
    assert.equal('grantDeclaration' in hist, false);
    assert.equal('grantRefusal' in hist, false);
  });
});

// ── F2 (7) store half + Decision 9 secrecy ───────────────────────────────────

describe('S1 — F2(7) store half: secrecy at the addItem return', () => {
  test('addItem returns the doc without either field when it carries one', async () => {
    const store = makeStore();
    const returned = await store.addItem('acme', declaredItem({ grantRefusal: 'X' }));
    assert.equal('grantDeclaration' in returned, false, 'return strips the record');
    assert.equal('grantRefusal' in returned, false, 'return strips the refusal');
    // No marker value leaks through the outward object.
    const serialized = JSON.stringify(returned);
    for (const marker of RECORD_MARKERS) {
      assert.ok(!serialized.includes(marker), `return must not contain ${marker}`);
    }
  });

  test('the persisted document keeps the full record', async () => {
    const store = makeStore();
    await store.addItem('acme', declaredItem());
    assert.deepEqual(store.collection._docs[0].grantDeclaration, RECORD);
  });

  test('an undeclared item returns an object with neither key', async () => {
    const store = makeStore();
    const returned = await store.addItem('acme', { prompt: 'run me' });
    assert.equal('grantDeclaration' in returned, false);
    assert.equal('grantRefusal' in returned, false);
  });

  test('neither field appears on _formatItem / _formatHistoryItem', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    const formatted = store._formatItem(store.collection._docs[0]);
    assert.equal('grantDeclaration' in formatted, false);
    assert.equal('grantRefusal' in formatted, false);
    assert.ok(!JSON.stringify(formatted).includes('owner-A'));

    await store.takeItem(created._id, 'acme');
    const histFormatted = store._formatHistoryItem(store.historyCollection._docs[0]);
    assert.equal('grantDeclaration' in histFormatted, false);
    assert.equal('grantRefusal' in histFormatted, false);
    assert.ok(!JSON.stringify(histFormatted).includes('owner-A'));
  });

  test('getItemStatus (active and history) exposes no declared field', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    const queued = await store.getItemStatus('acme', created._id);
    assert.equal('grantDeclaration' in queued, false);
    await store.takeItem(created._id, 'acme');
    const taken = await store.getItemStatus('acme', created._id);
    assert.equal('grantDeclaration' in taken, false);
  });
});

// ── declared round trip through all three archive hops ───────────────────────

describe('S1 — declared record survives take / cancel / expiry archive', () => {
  test('take → archive: record on the history doc and readable from history', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    await store.takeItem(created._id, 'acme');

    const hist = store.historyCollection._docs[0];
    assert.deepEqual(hist.grantDeclaration, RECORD);
    // Active is empty; the lookup falls through to history.
    assert.equal(store.collection._docs.length, 0);
    const result = await store.getGrantDeclaration('acme', created._id);
    assert.deepEqual(result, { state: 'record', record: RECORD });
  });

  test('cancel → archive: record survives removeItem', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    await store.removeItem('acme', created._id);
    assert.deepEqual(store.historyCollection._docs[0].grantDeclaration, RECORD);
    const result = await store.getGrantDeclaration('acme', created._id);
    assert.deepEqual(result, { state: 'record', record: RECORD });
  });

  test('expiry → archive: record survives cleanup', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    store.collection._docs[0].expiresAt = new Date(0);
    await store.cleanup();
    assert.deepEqual(store.historyCollection._docs[0].grantDeclaration, RECORD);
    const result = await store.getGrantDeclaration('acme', created._id);
    assert.deepEqual(result, { state: 'record', record: RECORD });
  });

  test('grantRefusal also survives the take → archive hop', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'wake', grantDeclaration: RECORD, grantRefusal: 'GRANT_OWNERLESS' });
    await store.takeItem(created._id, 'acme');
    assert.equal(store.historyCollection._docs[0].grantRefusal, 'GRANT_OWNERLESS');
  });
});

// ── F2 (9) store precondition ────────────────────────────────────────────────

describe('S1 — F2(9) store precondition: recorded owner + workspace verbatim', () => {
  test('ownerAccountId / workspaceId round-trip through persistence and archive', async () => {
    const store = makeStore();
    const record = { grants: ['dispatch'], ownerAccountId: 'owner-REAL', workspaceId: 'ws-REAL', profile: 'worker', site: 's', declaredAt: 't' };
    const created = await store.addItem('acme', { prompt: 'run me', grantDeclaration: record });
    assert.equal(store.collection._docs[0].grantDeclaration.ownerAccountId, 'owner-REAL');
    assert.equal(store.collection._docs[0].grantDeclaration.workspaceId, 'ws-REAL');
    await store.takeItem(created._id, 'acme');
    const result = await store.getGrantDeclaration('acme', created._id);
    assert.equal(result.state, 'record');
    assert.equal(result.record.ownerAccountId, 'owner-REAL');
    assert.equal(result.record.workspaceId, 'ws-REAL');
  });
});

// ── N3 lookup states + read faults ───────────────────────────────────────────

describe('S1 — N3 getGrantDeclaration states', () => {
  test('record: active row carries a record', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    const result = await store.getGrantDeclaration('acme', created._id);
    assert.deepEqual(result, { state: 'record', record: RECORD });
  });

  test('none: active row exists with no record', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'run me' });
    const result = await store.getGrantDeclaration('acme', created._id);
    assert.deepEqual(result, { state: 'none' });
  });

  test('row-missing: unknown id, miss log asserted only here', async () => {
    const store = makeStore();
    const logs = [];
    const origWarn = console.warn;
    console.warn = (...args) => logs.push(args);
    let result;
    try {
      result = await store.getGrantDeclaration('acme', 'no-such-id');
    } finally {
      console.warn = origWarn;
    }
    assert.deepEqual(result, { state: 'row-missing' });
    assert.equal(logs.length, 1, 'exactly one miss log for the row-missing case');
    assert.equal(logs[0][0], '[dispatch] resume-declaration-lookup-miss');
  });

  test('row-missing: a wrong urlKey for a real id does not resolve', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', declaredItem());
    const result = await store.getGrantDeclaration('other-workspace', created._id);
    assert.deepEqual(result, { state: 'row-missing' });
  });

  test('no miss log for record or none', async () => {
    const store = makeStore();
    const logs = [];
    const origWarn = console.warn;
    console.warn = (...args) => logs.push(args);
    try {
      const createdDeclared = await store.addItem('acme', declaredItem());
      await store.getGrantDeclaration('acme', createdDeclared._id);
      const createdPlain = await store.addItem('acme', { prompt: 'run me' });
      await store.getGrantDeclaration('acme', createdPlain._id);
    } finally {
      console.warn = origWarn;
    }
    assert.equal(logs.length, 0);
  });

  test('a thrown active read is rethrown with declarationLookupFailed and logged', async () => {
    const collection = { findOne: async () => { throw new Error('active boom'); } };
    const store = new DispatchQueueStore({ collection, historyCollection: createMockCollection() });
    const logs = [];
    const origErr = console.error;
    console.error = (...args) => logs.push(args);
    await assert.rejects(
      () => store.getGrantDeclaration('acme', 'i1'),
      (err) => err.declarationLookupFailed === true && /active boom/.test(err.message)
    );
    console.error = origErr;
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[dispatch] resume-declaration-lookup-error');
  });

  test('a thrown history read is rethrown with declarationLookupFailed', async () => {
    const collection = { findOne: async () => null };
    const historyCollection = { findOne: async () => { throw new Error('history boom'); } };
    const store = new DispatchQueueStore({ collection, historyCollection });
    await assert.rejects(
      () => store.getGrantDeclaration('acme', 'i1'),
      (err) => err.declarationLookupFailed === true && /history boom/.test(err.message)
    );
  });

  test('a thrown re-read is rethrown with declarationLookupFailed', async () => {
    let historyReads = 0;
    const collection = { findOne: async () => null };
    const historyCollection = {
      findOne: async () => {
        historyReads += 1;
        if (historyReads >= 2) throw new Error('reread boom');
        return null;
      }
    };
    const store = new DispatchQueueStore({ collection, historyCollection });
    await assert.rejects(
      () => store.getGrantDeclaration('acme', 'i1'),
      (err) => err.declarationLookupFailed === true && /reread boom/.test(err.message)
    );
    assert.ok(historyReads >= 2, 'the re-read was actually attempted');
  });
});

// ── R1 take-hop witness (delete-then-insert, mock timers) ────────────────────

/**
 * Active and history fakes that model delete-then-insert faithfully: the row is
 * removed from the active queue first (active `findOne` never returns it) and
 * reaches history only once the test "releases" the insert. History `findOne`
 * calls are counted; read 1 is the initial history read, reads 2-4 are the
 * RE-READS (at most `GRANT_LOOKUP_HISTORY_RETRIES`). It never returns to active.
 */
function takeHopCollections({ releaseAtHistoryRead = null } = {}) {
  const row = { _id: 'hop-1', urlKey: 'acme', grantDeclaration: RECORD };
  let activeReads = 0;
  let historyReads = 0;
  let inserted = false;
  const collection = {
    async findOne() { activeReads += 1; return null; }
  };
  const historyCollection = {
    async findOne() {
      historyReads += 1;
      if (releaseAtHistoryRead !== null && historyReads >= releaseAtHistoryRead) inserted = true;
      return inserted ? row : null;
    }
  };
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, counts: () => ({ activeReads, historyReads }) };
}

async function settleWithMockTimers(promise) {
  let settled = false;
  let value;
  let failure;
  promise.then((v) => { value = v; settled = true; }, (e) => { failure = e; settled = true; });
  for (let i = 0; i < GRANT_LOOKUP_HISTORY_RETRIES + 1 && !settled; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(GRANT_LOOKUP_RETRY_MS);
  }
  await new Promise((resolve) => setImmediate(resolve));
  if (failure) throw failure;
  return value;
}

describe('S1 — R1 take-hop witness (delete-then-insert)', () => {
  // Release the insert at each permitted re-read: history reads 2, 3, 4.
  for (const releaseAtHistoryRead of [2, 3, 4]) {
    test(`insert lands at history read ${releaseAtHistoryRead} (inside the bound): record resolves`, async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const { store, counts } = takeHopCollections({ releaseAtHistoryRead });
        const result = await settleWithMockTimers(store.getGrantDeclaration('acme', 'hop-1'));
        assert.deepEqual(result, { state: 'record', record: RECORD });
        const { activeReads, historyReads } = counts();
        assert.equal(activeReads, 1, 'exactly one active read — no second active read');
        assert.equal(historyReads, releaseAtHistoryRead, 'stops at the first re-read that finds the row');
        assert.ok(historyReads <= 1 + GRANT_LOOKUP_HISTORY_RETRIES, 'at most 3 re-reads');
      } finally {
        mock.timers.reset();
      }
    });
  }

  test('insert after the bound: row-missing, miss log, plain resume (stated residual)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { store, counts } = takeHopCollections({ releaseAtHistoryRead: null });
      const logs = [];
      const origWarn = console.warn;
      console.warn = (...args) => logs.push(args);
      let result;
      try {
        result = await settleWithMockTimers(store.getGrantDeclaration('acme', 'hop-1'));
      } finally {
        console.warn = origWarn;
      }
      assert.deepEqual(result, { state: 'row-missing' });
      const { activeReads, historyReads } = counts();
      assert.equal(activeReads, 1, 'exactly one active read');
      assert.equal(historyReads, 1 + GRANT_LOOKUP_HISTORY_RETRIES, 'initial history read + all 3 re-reads');
      assert.equal(logs.length, 1);
      assert.equal(logs[0][0], '[dispatch] resume-declaration-lookup-miss');
    } finally {
      mock.timers.reset();
    }
  });

  test('a swallowed insert failure (history always misses) also gives row-missing + log', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      // Models _archiveItem's catch: the insert failed and was swallowed, so
      // the history fake never carries the row.
      const { store, counts } = takeHopCollections({ releaseAtHistoryRead: null });
      const logs = [];
      const origWarn = console.warn;
      console.warn = (...args) => logs.push(args);
      let result;
      try {
        result = await settleWithMockTimers(store.getGrantDeclaration('acme', 'hop-1'));
      } finally {
        console.warn = origWarn;
      }
      assert.deepEqual(result, { state: 'row-missing' });
      assert.equal(counts().activeReads, 1);
      assert.equal(logs.length, 1);
    } finally {
      mock.timers.reset();
    }
  });
});
