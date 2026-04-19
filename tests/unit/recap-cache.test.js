/**
 * Unit tests for lib/recap-cache.js (hash stability/sensitivity + store behavior).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  hashContext,
  stableStringify,
  InMemoryRecapCacheStore
} from '../../lib/recap-cache.js';

function baseContext() {
  return {
    issue: {
      id: 'uuid-1',
      identifier: 'LIN-1',
      title: 'Sample',
      description: 'Do the thing.',
      state: { type: 'started' },
      labels: ['preparing']
    },
    comments: [
      { id: 'c1', body: 'Started.', createdAt: '2026-04-18T10:00:00Z' },
      { id: 'c2', body: 'Paused.', createdAt: '2026-04-18T12:00:00Z' }
    ],
    children: [
      { id: 'child-1', identifier: 'LIN-2', title: 'sub', state: { type: 'unstarted' }, labels: [] }
    ],
    parent: null,
    focusedChild: null
  };
}

describe('stableStringify', () => {
  test('sorts object keys deterministically', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    assert.strictEqual(a, b);
  });

  test('preserves array order (arrays are ordered data)', () => {
    const a = stableStringify([1, 2, 3]);
    const b = stableStringify([3, 2, 1]);
    assert.notStrictEqual(a, b);
  });

  test('handles nested objects', () => {
    const a = stableStringify({ outer: { b: 1, a: 2 } });
    const b = stableStringify({ outer: { a: 2, b: 1 } });
    assert.strictEqual(a, b);
  });
});

describe('hashContext', () => {
  test('is stable for equal inputs', () => {
    const h1 = hashContext(baseContext());
    const h2 = hashContext(baseContext());
    assert.strictEqual(h1, h2);
  });

  test('changes when description changes', () => {
    const a = baseContext();
    const b = baseContext();
    b.issue.description = 'Do something else.';
    assert.notStrictEqual(hashContext(a), hashContext(b));
  });

  test('changes when a comment body changes', () => {
    const a = baseContext();
    const b = baseContext();
    b.comments[0].body = 'Changed.';
    assert.notStrictEqual(hashContext(a), hashContext(b));
  });

  test('changes when a child state changes', () => {
    const a = baseContext();
    const b = baseContext();
    b.children[0].state = { type: 'completed' };
    assert.notStrictEqual(hashContext(a), hashContext(b));
  });

  test('ignores irrelevant metadata (e.g. unrelated top-level fields)', () => {
    const a = baseContext();
    const b = baseContext();
    b.extraField = 'should not affect hash';
    assert.strictEqual(hashContext(a), hashContext(b));
  });

  test('returns a 64-char hex string (sha256)', () => {
    const h = hashContext(baseContext());
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});

describe('InMemoryRecapCacheStore', () => {
  test('put then get round-trips', async () => {
    const store = new InMemoryRecapCacheStore();
    await store.put('ws-1', 'issue-1', {
      inputHash: 'abc',
      recap: { done: [{ item: 'x', evidence: '' }], pending: [], deviations: [] },
      model: 'anthropic/claude-haiku-4.5'
    });
    const got = await store.get('ws-1', 'issue-1');
    assert.strictEqual(got.inputHash, 'abc');
    assert.strictEqual(got.model, 'anthropic/claude-haiku-4.5');
    assert.strictEqual(got.recap.done.length, 1);
    assert.ok(got.generatedAt instanceof Date);
  });

  test('get returns null for missing entries', async () => {
    const store = new InMemoryRecapCacheStore();
    const got = await store.get('ws-1', 'nope');
    assert.strictEqual(got, null);
  });

  test('scopes by workspace', async () => {
    const store = new InMemoryRecapCacheStore();
    await store.put('ws-1', 'issue-1', { inputHash: 'a', recap: {}, model: 'm' });
    const cross = await store.get('ws-2', 'issue-1');
    assert.strictEqual(cross, null);
  });

  test('delete removes entry', async () => {
    const store = new InMemoryRecapCacheStore();
    await store.put('ws-1', 'issue-1', { inputHash: 'a', recap: {}, model: 'm' });
    await store.delete('ws-1', 'issue-1');
    assert.strictEqual(await store.get('ws-1', 'issue-1'), null);
  });
});
