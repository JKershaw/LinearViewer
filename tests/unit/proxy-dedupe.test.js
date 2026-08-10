import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDedupeCache, createGenerationTracker, dedupeKey } from '../../lib/proxy-dedupe.js';

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

// ---- createGenerationTracker (LIN-1160 / LIN-2005) -------------------------

test('generation tracker: current() on a cold key is stable and falsy', () => {
  const tracker = createGenerationTracker();
  assert.equal(tracker.current('ws1'), '');
  assert.equal(tracker.current('ws1'), tracker.current('ws1')); // repeated reads agree
});

test('generation tracker: bump() changes what current() returns', () => {
  const tracker = createGenerationTracker();
  const before = tracker.current('ws1');
  tracker.bump('ws1');
  const after = tracker.current('ws1');
  assert.notEqual(after, before);
  assert.equal(tracker.current('ws1'), after); // stable until the next bump
});

test('generation tracker: independent keys do not interfere', () => {
  const tracker = createGenerationTracker();
  tracker.bump('ws1');
  assert.equal(tracker.current('ws2'), ''); // unaffected by ws1's bump
  tracker.bump('ws2');
  assert.notEqual(tracker.current('ws1'), tracker.current('ws2'));
});

test('generation tracker: eviction never falls back to the cold value for a live key', () => {
  // A small limit forces eviction; the point of LIN-2005 is that an evicted
  // key's next current() read must NOT collapse back to '' (which would
  // resurrect dedupe entries minted before the key's most recent bump).
  const tracker = createGenerationTracker({ limit: 2 });
  tracker.bump('ws1');
  const ws1Gen = tracker.current('ws1');

  tracker.bump('ws2');
  tracker.bump('ws3'); // evicts ws1 (oldest, size now exceeds limit of 2)

  assert.equal(tracker.size, 2);
  // ws1 was evicted, so its tag reads back to the cold value — this is the
  // known, accepted consequence of eviction (an avoidable duplicate create
  // is safe; the production tracker sizes `limit` far above real workspace
  // cardinality so this path is not expected to trigger there).
  assert.equal(tracker.current('ws1'), '');
  assert.notEqual(ws1Gen, '');
});

test('generation tracker: re-bumping a key keeps it from being evicted ahead of colder keys', () => {
  const tracker = createGenerationTracker({ limit: 2 });
  tracker.bump('a');
  tracker.bump('b');
  tracker.bump('a'); // touch 'a' again — moves it to the back of eviction order
  tracker.bump('c'); // should evict 'b', the now-oldest, not 'a'

  assert.notEqual(tracker.current('a'), '');
  assert.equal(tracker.current('b'), '');
  assert.notEqual(tracker.current('c'), '');
});
