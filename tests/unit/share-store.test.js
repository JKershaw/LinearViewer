/**
 * Unit tests for lib/share-store.js (LIN-3243, Session A of LIN-3073).
 *
 * Run with: node --test tests/unit/share-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent:
 * tests/unit/db-indexes.test.js): the store's claims are hashed persistence,
 * an `_id` point read and the unique tokenHash constraint, so a mock would
 * encode the assumptions instead of testing them.
 *
 * Covers: token format + sha256-only persistence, unique tokenHash, the
 * getByToken point read, listByUrlKey ordering, revoke semantics, and
 * saveSnapshot (success and failure stamps).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { ShareStore, SUBJECT_KINDS, validSubject, subjectTypeForKind } from '../../lib/share-store.js';
import { readFileSync } from 'node:fs';
import { ensureIndexes } from '../../lib/db-indexes.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const SUBJECT = { type: 'collection', kind: 'parent', id: 'parent-uuid-1' };

describe('share-store', () => {
  const harness = createMangoTmpdir('share-store-');
  let db;

  before(async () => {
    await harness.connect();
    db = harness.freshDb();
    await ensureIndexes(db);
  });

  after(() => harness.close());

  function freshStore() {
    return new ShareStore({ collection: harness.freshDb().collection('shares') });
  }

  test('mints a 43-char base64url token and stores only its sha256', async () => {
    const store = freshStore();
    const { token, record } = await store.create({
      urlKey: 'ws-1',
      workspaceId: 'uuid-ws-1',
      ownerAccountId: 'acct-1',
      subject: SUBJECT
    });

    assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'token is 32 bytes base64url (43 chars, no padding)');
    assert.strictEqual(record.tokenHash, sha256(token), 'tokenHash is sha256(token)');
    assert.strictEqual(record._id, record.tokenHash, '_id IS the token hash (point read)');

    // The raw token must not appear anywhere in the stored document.
    const stored = await store.getByToken(token);
    assert.strictEqual(stored.token, undefined, 'the raw token is never persisted');
    assert.ok(!JSON.stringify(stored).includes(token), 'the raw token is absent from the whole record');
  });

  test('persists the full record shape with defaults', async () => {
    const store = freshStore();
    const { token, record } = await store.create({
      urlKey: 'ws-2',
      workspaceId: 'uuid-ws-2',
      ownerAccountId: 'acct-2',
      subject: { type: 'collection', kind: 'label', id: 'bug' }
    });

    assert.strictEqual(record.urlKey, 'ws-2');
    assert.strictEqual(record.workspaceId, 'uuid-ws-2');
    assert.strictEqual(record.ownerAccountId, 'acct-2');
    assert.deepStrictEqual(record.subject, { type: 'collection', kind: 'label', id: 'bug' });
    assert.strictEqual(record.includeDescriptions, false, 'descriptions are opt-in');
    assert.ok(record.createdAt instanceof Date);
    assert.strictEqual(record.revokedAt, null);
    assert.strictEqual(record.snapshot, null);
    assert.strictEqual(record.snapshotAt, null);
    assert.strictEqual(record.lastRefreshAttemptAt, null);

    const fetched = await store.getByToken(token);
    assert.strictEqual(fetched.includeDescriptions, false);
  });

  test('rejects an invalid subject', async () => {
    const store = freshStore();
    await assert.rejects(
      () => store.create({ urlKey: 'ws', ownerAccountId: 'a', subject: { type: 'collection', kind: 'nope', id: 'x' } }),
      /subject must be/
    );
  });

  test('tokenHash is unique in the store', async () => {
    // This store is over the `before`-indexed db, so the unique spec is live.
    const store = new ShareStore({ collection: db.collection('shares') });
    const { record } = await store.create({ urlKey: 'ws-3', ownerAccountId: 'acct-3', subject: SUBJECT });
    await assert.rejects(
      () => store.collection.insertOne({ ...record, _id: `${record.tokenHash}-copy` }),
      /duplicate key|E11000/i,
      'a second record with the same tokenHash is refused by the unique index'
    );
  });

  test('getByToken is null for malformed or unknown tokens, and returns revoked rows', async () => {
    const store = freshStore();
    assert.strictEqual(await store.getByToken('short'), null);
    assert.strictEqual(await store.getByToken(null), null);
    assert.strictEqual(await store.getByToken('A'.repeat(43)), null, 'unknown well-formed token → null');

    const { token } = await store.create({ urlKey: 'ws-4', ownerAccountId: 'acct-4', subject: SUBJECT });
    await store.revoke(token);
    const revoked = await store.getByToken(token);
    assert.ok(revoked.revokedAt instanceof Date, 'getByToken still returns a revoked row (caller decides 410)');
  });

  test('listByUrlKey returns newest-first, _id-descending, scoped to the workspace', async () => {
    const store = freshStore();
    const now = () => new Date('2026-10-02T00:00:00.000Z');
    const fixed = new ShareStore({ collection: store.collection, now });

    const a = await fixed.create({ urlKey: 'ws-5', ownerAccountId: 'acct', subject: SUBJECT });
    const b = await fixed.create({ urlKey: 'ws-5', ownerAccountId: 'acct', subject: SUBJECT });
    const other = await fixed.create({ urlKey: 'ws-other', ownerAccountId: 'acct', subject: SUBJECT });

    const rows = await store.listByUrlKey('ws-5');
    assert.deepStrictEqual(rows.map(r => r._id), [a.record._id, b.record._id].sort().reverse());
    assert.ok(rows.every(r => r.urlKey === 'ws-5'));
    assert.ok(!rows.some(r => r._id === other.record._id), 'other workspaces are excluded');
  });

  test('revoke stamps revokedAt once and is idempotent; unknown token → null', async () => {
    const store = freshStore();
    const { token } = await store.create({ urlKey: 'ws-6', ownerAccountId: 'acct', subject: SUBJECT });

    const first = await store.revoke(token);
    assert.ok(first.revokedAt instanceof Date);
    const stamp = first.revokedAt.getTime();

    const second = await store.revoke(token);
    assert.strictEqual(second.revokedAt.getTime(), stamp, 'a second revoke preserves the original timestamp');
    assert.strictEqual(await store.revoke('B'.repeat(43)), null, 'unknown token → null');
  });

  test('saveSnapshot stores content and stamps the attempt; a null snapshot only stamps', async () => {
    const store = freshStore();
    const { token, record } = await store.create({ urlKey: 'ws-7', ownerAccountId: 'acct', subject: SUBJECT });
    const snapshot = { title: 'Parent', items: [{ identifier: 'LIN-1', title: 'Child' }] };

    await store.saveSnapshot(record.tokenHash, snapshot);
    let fetched = await store.getByToken(token);
    assert.deepStrictEqual(fetched.snapshot, snapshot);
    assert.ok(fetched.snapshotAt instanceof Date);
    assert.ok(fetched.lastRefreshAttemptAt instanceof Date);

    const firstSnapshotAt = fetched.snapshotAt.getTime();

    // A failed refresh passes null: the last good snapshot must survive, only
    // the attempt stamp moves.
    await store.saveSnapshot(record.tokenHash, null, { at: new Date('2030-01-01T00:00:00.000Z') });
    fetched = await store.getByToken(token);
    assert.deepStrictEqual(fetched.snapshot, snapshot, 'last-good snapshot is preserved on failure');
    assert.strictEqual(fetched.snapshotAt.getTime(), firstSnapshotAt);
    assert.strictEqual(fetched.lastRefreshAttemptAt.toISOString(), '2030-01-01T00:00:00.000Z');
  });

  // --- Session B (LIN-3244): owner revoke by record id ---

  test('revokeById scopes to the workspace and is idempotent', async () => {
    const store = freshStore();
    const { record } = await store.create({ urlKey: 'ws-9', ownerAccountId: 'acct', subject: SUBJECT });

    // A mismatched workspace refuses and leaves the row untouched.
    assert.strictEqual(await store.revokeById(record._id, 'ws-other'), null);
    const untouched = await store.collection.findOne({ _id: record._id });
    assert.strictEqual(untouched.revokedAt, null);

    const first = await store.revokeById(record._id, 'ws-9');
    assert.ok(first.revokedAt instanceof Date);
    const stamp = first.revokedAt.getTime();

    const second = await store.revokeById(record._id, 'ws-9');
    assert.strictEqual(second.revokedAt.getTime(), stamp, 'a second revoke preserves the timestamp');
    assert.strictEqual(await store.revokeById('missing-id', 'ws-9'), null);
  });

  // --- LIN-3313 (Phase 3 of LIN-2950): the run subject ---

  test('validSubject accepts the run shape beside the collection shape', () => {
    assert.strictEqual(validSubject({ type: 'run', kind: 'run', id: 'sess-1' }), true);
    assert.strictEqual(validSubject({ type: 'collection', kind: 'parent', id: 'p' }), true);
    assert.strictEqual(validSubject({ type: 'collection', kind: 'label', id: 'bug' }), true);
  });

  test('validSubject rejects an unknown kind, a missing/empty id and a type that disagrees with the kind', () => {
    const bad = [
      null,
      'run',
      { type: 'run', kind: 'nope', id: 'x' },
      { type: 'run', kind: 'run' },
      { type: 'run', kind: 'run', id: '' },
      { type: 'run', kind: 'run', id: 42 },
      { type: 'collection', kind: 'run', id: 'sess-1' },
      { type: 'run', kind: 'label', id: 'bug' },
      { type: 'run', kind: 'parent', id: 'p' },
      { kind: 'run', id: 'sess-1' }
    ];
    for (const subject of bad) assert.strictEqual(validSubject(subject), false, JSON.stringify(subject));
  });

  test('SUBJECT_KINDS is the one copy: parent, label, run; routes/share.js imports it and keeps none of its own', () => {
    assert.deepStrictEqual([...SUBJECT_KINDS], ['parent', 'label', 'run']);
    assert.ok(Object.isFrozen(SUBJECT_KINDS));
    assert.strictEqual(subjectTypeForKind('run'), 'run');
    assert.strictEqual(subjectTypeForKind('parent'), 'collection');
    assert.strictEqual(subjectTypeForKind('label'), 'collection');
    const routeSrc = readFileSync(new URL('../../routes/share.js', import.meta.url), 'utf8');
    assert.ok(!/const\s+SUBJECT_KINDS\b/.test(routeSrc), 'no duplicate SUBJECT_KINDS in routes/share.js');
    assert.match(routeSrc, /import\s*\{[^}]*\bSUBJECT_KINDS\b[^}]*\}\s*from\s*'\.\.\/lib\/share-store\.js'/);
  });

  test('create persists a run subject verbatim as { type: "run", kind: "run", id }', async () => {
    const store = freshStore();
    const { token, record } = await store.create({ urlKey: 'ws-r', ownerAccountId: 'acct', subject: { type: 'run', kind: 'run', id: 'sess-1', extra: 'dropped' } });
    assert.deepStrictEqual(record.subject, { type: 'run', kind: 'run', id: 'sess-1' });
    const fetched = await store.getByToken(token);
    assert.deepStrictEqual(fetched.subject, { type: 'run', kind: 'run', id: 'sess-1' });
    assert.strictEqual(fetched.includeDescriptions, false);
    await assert.rejects(
      () => store.create({ urlKey: 'ws-r', ownerAccountId: 'acct', subject: { type: 'collection', kind: 'run', id: 'sess-1' } }),
      /subject must be/
    );
  });

  test('list, revoke and saveSnapshot work for run rows like any other', async () => {
    const store = freshStore();
    const run = await store.create({ urlKey: 'ws-rl', ownerAccountId: 'acct', subject: { type: 'run', kind: 'run', id: 'sess-1' } });
    await store.create({ urlKey: 'ws-rl', ownerAccountId: 'acct', subject: SUBJECT });
    const rows = await store.listByUrlKey('ws-rl');
    assert.deepStrictEqual(rows.map(r => r.subject.kind).sort(), ['parent', 'run']);

    const projection = { session: { sessionId: 'sess-1', loops: [] }, settled: true, settledKey: 'k', capturedAt: '2026-07-04T11:00:00.000Z' };
    const at = new Date('2026-07-04T11:00:00.000Z');
    assert.strictEqual(await store.saveSnapshot(run.record.tokenHash, projection, { at }), true);
    const saved = await store.getByToken(run.token);
    assert.deepStrictEqual(saved.snapshot, projection);
    assert.strictEqual(saved.snapshotAt.getTime(), at.getTime());

    const revoked = await store.revokeById(run.record._id, 'ws-rl');
    assert.ok(revoked.revokedAt instanceof Date);
    assert.deepStrictEqual(revoked.snapshot, projection, 'revoke keeps the frozen snapshot; the route answers 410');
  });
});
