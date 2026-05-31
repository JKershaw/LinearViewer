/**
 * Unit tests for lib/brief-cache.js (store behavior + shared context hash).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  hashContext,
  InMemoryBriefCacheStore
} from '../../lib/brief-cache.js';

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
      { id: 'c1', body: 'Started.', createdAt: '2026-04-18T10:00:00Z' }
    ],
    children: [],
    parent: null,
    focusedChild: null
  };
}

describe('hashContext (re-exported from recap-cache)', () => {
  test('is stable for equal inputs and changes with the description', () => {
    const a = baseContext();
    const b = baseContext();
    assert.strictEqual(hashContext(a), hashContext(b));
    b.issue.description = 'Do something else.';
    assert.notStrictEqual(hashContext(a), hashContext(b));
  });

  test('returns a 64-char hex string (sha256)', () => {
    assert.match(hashContext(baseContext()), /^[0-9a-f]{64}$/);
  });
});

describe('InMemoryBriefCacheStore', () => {
  test('put then get round-trips the Markdown brief', async () => {
    const store = new InMemoryBriefCacheStore();
    await store.put('ws-1', 'issue-1', {
      inputHash: 'abc',
      brief: '## Current\nSpec.',
      model: 'anthropic/claude-haiku-4.5'
    });
    const got = await store.get('ws-1', 'issue-1');
    assert.strictEqual(got.inputHash, 'abc');
    assert.strictEqual(got.model, 'anthropic/claude-haiku-4.5');
    assert.match(got.brief, /## Current/);
    assert.ok(got.generatedAt instanceof Date);
  });

  test('get returns null for missing entries', async () => {
    const store = new InMemoryBriefCacheStore();
    assert.strictEqual(await store.get('ws-1', 'nope'), null);
  });

  test('scopes by workspace', async () => {
    const store = new InMemoryBriefCacheStore();
    await store.put('ws-1', 'issue-1', { inputHash: 'a', brief: 'x', model: 'm' });
    assert.strictEqual(await store.get('ws-2', 'issue-1'), null);
  });

  test('delete removes entry', async () => {
    const store = new InMemoryBriefCacheStore();
    await store.put('ws-1', 'issue-1', { inputHash: 'a', brief: 'x', model: 'm' });
    await store.delete('ws-1', 'issue-1');
    assert.strictEqual(await store.get('ws-1', 'issue-1'), null);
  });
});
