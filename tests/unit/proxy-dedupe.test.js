import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDedupeCache, dedupeKey } from '../../lib/proxy-dedupe.js';

test('dedupeKey is stable for identical parts and differs otherwise', () => {
  assert.equal(dedupeKey('ws', 'LIN-1', 'hello'), dedupeKey('ws', 'LIN-1', 'hello'));
  assert.notEqual(dedupeKey('ws', 'LIN-1', 'hello'), dedupeKey('ws', 'LIN-1', 'world'));
  assert.notEqual(dedupeKey('ws', 'LIN-1', 'hello'), dedupeKey('ws', 'LIN-2', 'hello'));
});

test('dedupeKey is not fooled by part-boundary ambiguity', () => {
  // ["ab","c"] must not collide with ["a","bc"].
  assert.notEqual(dedupeKey('ab', 'c'), dedupeKey('a', 'bc'));
});

test('cache returns a remembered value within the window', () => {
  const cache = createDedupeCache({ ttlMs: 1000, now: () => 0 });
  const key = dedupeKey('ws', 'LIN-1', 'body');
  assert.equal(cache.get(key), undefined);
  cache.set(key, { comment: { id: 'c1' } });
  assert.deepEqual(cache.get(key), { comment: { id: 'c1' } });
});

test('cache expires entries after the TTL', () => {
  let clock = 0;
  const cache = createDedupeCache({ ttlMs: 1000, now: () => clock });
  const key = dedupeKey('ws', 'LIN-1', 'body');
  cache.set(key, { comment: { id: 'c1' } });

  clock = 999;
  assert.deepEqual(cache.get(key), { comment: { id: 'c1' } });

  clock = 1000; // expiresAt is inclusive — at the boundary the entry is gone
  assert.equal(cache.get(key), undefined);
});

test('setting a new entry prunes expired ones', () => {
  let clock = 0;
  const cache = createDedupeCache({ ttlMs: 100, now: () => clock });
  cache.set(dedupeKey('a'), 1);
  cache.set(dedupeKey('b'), 2);
  assert.equal(cache.size, 2);

  clock = 200; // both expired
  cache.set(dedupeKey('c'), 3);
  assert.equal(cache.size, 1);
});
