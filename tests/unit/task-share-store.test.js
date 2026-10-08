/**
 * LIN-3330 — lib/task-share-store.js.
 *
 * Hash-only storage, the token shown once, an idempotent scoped revoke, a list
 * that never returns a token/hash, and the collection-name pin (`task_share_links`,
 * never `shares` — the drop script stays on `shares`).
 *
 * Run with: node --test tests/unit/task-share-store.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { TaskShareStore, TASK_SHARE_COLLECTION, isWellFormedTaskShareToken } from '../../lib/task-share-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-08T12:00:00.000Z');

function makeStore(now = () => NOW) {
  const collection = createMockCollection();
  return { store: new TaskShareStore({ collection, now }), collection };
}

const CREATE = {
  urlKey: 'acme',
  workspaceId: 'ws-1',
  ownerAccountId: 'acct-1',
  issueIdentifier: 'LIN-50',
  issueId: '11111111-2222-3333-4444-555555555555',
  source: 'linear',
};

describe('TaskShareStore', () => {
  test('create stores only the token hash and returns the token once', async () => {
    const { store, collection } = makeStore();
    const { token, record } = await store.create(CREATE);
    assert.equal(isWellFormedTaskShareToken(token), true);
    assert.equal(token.length, 43);
    assert.equal(record.tokenHash.length, 64);
    assert.notEqual(record._id, record.tokenHash, 'the shareId is independent of the token hash');
    // The raw token is nowhere on the stored record.
    const stored = await collection.findOne({ _id: record._id });
    assert.ok(!JSON.stringify(stored).includes(token), 'the raw token is never persisted');
    assert.equal(stored.tokenHash, record.tokenHash);
    assert.equal(stored.urlKey, 'acme');
    assert.equal(stored.issueIdentifier, 'LIN-50');
    assert.equal(stored.revokedAt, null);
  });

  test('getByToken: malformed 404s with zero reads; unknown is null; known round-trips', async () => {
    const { store, collection } = makeStore();
    let reads = 0;
    const counting = {
      ...collection,
      findOne: async (q) => { reads++; return collection.findOne(q); },
    };
    const spy = new TaskShareStore({ collection: counting, now: () => NOW });
    assert.equal(await spy.getByToken('too short'), null);
    assert.equal(await spy.getByToken('!'.repeat(43)), null);
    assert.equal(reads, 0, 'a malformed token never touches the store');
    const { token } = await store.create(CREATE);
    assert.equal(await spy.getByToken(token).then(r => r.issueIdentifier), 'LIN-50');
    assert.equal(await spy.getByToken('A'.repeat(43)), null);
  });

  test('listForTask: newest-first, and never a token or hash', async () => {
    const times = [new Date('2026-10-01T00:00:00Z'), new Date('2026-10-03T00:00:00Z'), new Date('2026-10-02T00:00:00Z')];
    let i = 0;
    const { store } = makeStore(() => times[i++]);
    const a = (await store.create(CREATE)).record;
    const b = (await store.create(CREATE)).record;
    const c = (await store.create(CREATE)).record;
    await store.create({ ...CREATE, issueIdentifier: 'LIN-99' });
    const rows = await store.listForTask('acme', 'LIN-50');
    assert.deepEqual(rows.map(r => r.id), [b._id, c._id, a._id], 'newest createdAt first, _id tie-break');
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'id', 'revokedAt']);
      assert.ok(!JSON.stringify(row).includes('tokenHash'));
    }
  });

  test('revoke is idempotent and keeps the first revokedAt', async () => {
    let clock = new Date('2026-10-08T12:00:00.000Z');
    const { store } = makeStore(() => clock);
    const { record } = await store.create(CREATE);
    const first = await store.revoke(record._id, { urlKey: 'acme', issueIdentifier: 'LIN-50' });
    assert.equal(first.revokedAt.getTime(), clock.getTime());
    clock = new Date('2026-10-08T13:00:00.000Z');
    const second = await store.revoke(record._id, { urlKey: 'acme', issueIdentifier: 'LIN-50' });
    assert.equal(second.revokedAt.getTime(), first.revokedAt.getTime(), 'a second revoke does not move revokedAt');
  });

  test('revoke is scoped: wrong workspace or task revokes nothing', async () => {
    const { store } = makeStore();
    const { record } = await store.create(CREATE);
    assert.equal(await store.revoke(record._id, { urlKey: 'other', issueIdentifier: 'LIN-50' }), null);
    assert.equal(await store.revoke(record._id, { urlKey: 'acme', issueIdentifier: 'LIN-99' }), null);
    const still = await store.listForTask('acme', 'LIN-50');
    assert.equal(still[0].revokedAt, null, 'still live after a cross-scope revoke attempt');
    assert.equal(await store.revoke('nope', { urlKey: 'acme', issueIdentifier: 'LIN-50' }), null);
  });

  test('the collection is task_share_links, and the drop script still targets shares', () => {
    assert.equal(TASK_SHARE_COLLECTION, 'task_share_links');
    const script = readFileSync(join(__dirname, '../../scripts/drop-shares-collection.mjs'), 'utf8');
    assert.match(script, /shares/, 'the drop script still references the old collection');
    assert.doesNotMatch(script, /task_share_links/);
  });
});
