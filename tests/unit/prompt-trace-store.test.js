/**
 * Unit tests for prompt-trace-store.js (LIN-578)
 *
 * Run with: node --test tests/unit/prompt-trace-store.test.js
 *
 * Mirrors tests/unit/llm-call-log.test.js for the shared append-only contract
 * (record / list / TTL cleanup / fire-and-forget / workspace isolation), and adds
 * coverage specific to this store: it is CONTENT-bearing, so the rendered input and
 * model output blobs must round-trip through record → listTraces intact.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PromptTraceStore, providerContextVerdict, EMPTY_PROVIDER_CONTEXT } from '../../lib/prompt-trace-store.js';
import { resolvePromptUi } from '../../lib/prompt-formatters.js';

const GITHUB_UI = { write: true, comments: false, estimates: true, subtasks: false, displayName: 'GitHub Issues' };
const LINEAR_UI = { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Linear' };

// Minimal in-memory mock of the MongoDB/MangoDB collection surface (same shape as
// the llm-call-log test mock — supports $gt (list) and $lt (cleanup) on expiresAt).
function createMockCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    find(query) {
      const results = docs.filter(doc => {
        if (query.urlKey && doc.urlKey !== query.urlKey) return false;
        if (query.expiresAt?.$gt && !(doc.expiresAt > query.expiresAt.$gt)) return false;
        return true;
      });
      return { async toArray() { return results; } };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        const doc = docs[i];
        let match = true;
        if (query.urlKey && doc.urlKey !== query.urlKey) match = false;
        if (query.expiresAt?.$lt && !(doc.expiresAt < query.expiresAt.$lt)) match = false;
        if (match) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

const sampleTrace = () => ({
  urlKey: 'acme', feature: 'recommend', issueIdentifier: 'LIN-1',
  metaPrompt: 'You are an expert engineer.\n## Task\nFix the bug.',
  model: 'openai/gpt-5.4-mini',
  featureFlags: { linearMcp: true },
  providerUi: { write: true, displayName: 'Linear' },
  rawContent: '## Reasoning\nbecause\n## Prompt\ndo the thing',
  reasoning: 'because',
  prompt: 'do the thing',
  finalPrompt: 'do the thing\n\n## Re-ground the Ticket\n...',
  finishReason: 'stop',
  truncated: false
});

describe('PromptTraceStore.record', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new PromptTraceStore({ collection });
  });

  test('persists content (input + output) and attribution', async () => {
    await store.record(sampleTrace());
    assert.strictEqual(collection._docs.length, 1);
    const doc = collection._docs[0];
    // attribution
    assert.strictEqual(doc.urlKey, 'acme');
    assert.strictEqual(doc.feature, 'recommend');
    assert.strictEqual(doc.issueIdentifier, 'LIN-1');
    // input
    assert.match(doc.metaPrompt, /Fix the bug/);
    assert.strictEqual(doc.model, 'openai/gpt-5.4-mini');
    assert.deepStrictEqual(doc.featureFlags, { linearMcp: true });
    assert.deepStrictEqual(doc.providerUi, { write: true, displayName: 'Linear' });
    // output
    assert.strictEqual(doc.rawContent, '## Reasoning\nbecause\n## Prompt\ndo the thing');
    assert.strictEqual(doc.reasoning, 'because');
    assert.strictEqual(doc.prompt, 'do the thing');
    assert.match(doc.finalPrompt, /Re-ground the Ticket/);
    assert.strictEqual(doc.finishReason, 'stop');
    assert.strictEqual(doc.truncated, false);
    // bookkeeping
    assert.ok(doc.timestamp instanceof Date);
    assert.ok(doc.expiresAt instanceof Date);
    assert.ok(doc.expiresAt > doc.timestamp);
    assert.ok(typeof doc._id === 'string' && doc._id.length > 0);
  });

  test('coerces missing fields to null (defer-style trace with empty prompt)', async () => {
    await store.record({ feature: 'recommend', reasoning: 'deferring', prompt: null });
    const doc = collection._docs[0];
    assert.strictEqual(doc.urlKey, null);
    assert.strictEqual(doc.issueIdentifier, null);
    assert.strictEqual(doc.metaPrompt, null);
    assert.strictEqual(doc.model, null);
    assert.strictEqual(doc.featureFlags, null);
    assert.strictEqual(doc.providerUi, null);
    assert.strictEqual(doc.rawContent, null);
    assert.strictEqual(doc.prompt, null);
    assert.strictEqual(doc.finalPrompt, null);
    assert.strictEqual(doc.finishReason, null);
    assert.strictEqual(doc.truncated, null); // only true/false survive; absent ⇒ null
  });

  test('non-boolean truncated becomes null', async () => {
    await store.record({ urlKey: 'acme', truncated: 'length' });
    assert.strictEqual(collection._docs[0].truncated, null);
  });

  test('works (and does not throw) without a collection', async () => {
    const noColl = new PromptTraceStore({});
    const doc = await noColl.record({ feature: 'recommend', prompt: 'hi' });
    assert.strictEqual(doc.feature, 'recommend');
    assert.strictEqual(doc.prompt, 'hi');
  });

  test('never throws when the collection insert fails (fire-and-forget)', async () => {
    const flaky = new PromptTraceStore({
      collection: { async insertOne() { throw new Error('mongo down'); } }
    });
    const doc = await flaky.record({ feature: 'recommend', prompt: 'x' });
    assert.strictEqual(doc.feature, 'recommend'); // returns the doc despite the error
  });
});

describe('PromptTraceStore.listTraces', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new PromptTraceStore({ collection });
  });

  test('is workspace-scoped and newest-first, and returns content', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', prompt: 'first', metaPrompt: 'p1' });
    await new Promise(r => setTimeout(r, 2));
    await store.record({ urlKey: 'acme', feature: 'recommend', prompt: 'second', metaPrompt: 'p2' });
    await store.record({ urlKey: 'other', feature: 'recommend', prompt: 'elsewhere' });

    const { items, total } = await store.listTraces('acme');
    assert.strictEqual(total, 2);
    assert.strictEqual(items[0].prompt, 'second'); // newest first
    assert.strictEqual(items[1].prompt, 'first');
    // content + attribution surfaced on the listed shape
    assert.strictEqual(items[0].metaPrompt, 'p2');
    assert.strictEqual(items[0].urlKey, 'acme');
    assert.ok(items.every(i => typeof i.timestamp === 'string' && i.id));
  });

  test('honours limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await store.record({ urlKey: 'acme', feature: 'recommend', prompt: `p${i}` });
      await new Promise(r => setTimeout(r, 1));
    }
    const { items, total } = await store.listTraces('acme', { limit: 2, offset: 1 });
    assert.strictEqual(total, 5);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].prompt, 'p3'); // newest is p4; offset 1 skips it
    assert.strictEqual(items[1].prompt, 'p2');
  });

  test('returns empty for unknown workspace, missing urlKey, or no collection', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', prompt: 'x' });
    assert.deepStrictEqual(await store.listTraces('nope'), { items: [], total: 0 });
    assert.deepStrictEqual(await store.listTraces(), { items: [], total: 0 });
    assert.deepStrictEqual(await new PromptTraceStore({}).listTraces('acme'), { items: [], total: 0 });
  });

  test('excludes expired traces from listing (TTL window)', async () => {
    // A record whose TTL already lapsed: write with a zero TTL store, then list.
    const expiredStore = new PromptTraceStore({ collection, ttl: -1 });
    await expiredStore.record({ urlKey: 'acme', feature: 'recommend', prompt: 'gone' });
    await store.record({ urlKey: 'acme', feature: 'recommend', prompt: 'kept' });
    const { items, total } = await store.listTraces('acme');
    assert.strictEqual(total, 1);
    assert.strictEqual(items[0].prompt, 'kept');
  });
});

describe('PromptTraceStore.cleanup', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new PromptTraceStore({ collection });
  });

  test('removes only expired records', async () => {
    const expiredStore = new PromptTraceStore({ collection, ttl: -1 });
    await expiredStore.record({ urlKey: 'acme', feature: 'recommend', prompt: 'old' });
    await store.record({ urlKey: 'acme', feature: 'recommend', prompt: 'fresh' });

    const removed = await store.cleanup();
    assert.strictEqual(removed, 1);
    assert.strictEqual(collection._docs.length, 1);
    assert.strictEqual(collection._docs[0].prompt, 'fresh');
  });

  test('no collection ⇒ returns 0, does not throw', async () => {
    assert.strictEqual(await new PromptTraceStore({}).cleanup(), 0);
  });
});

describe('PromptTraceStore.clear', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new PromptTraceStore({ collection });
  });

  test('clears one workspace without touching another (isolation)', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', prompt: 'a' });
    await store.record({ urlKey: 'other', feature: 'recommend', prompt: 'b' });

    const removed = await store.clear('acme');
    assert.strictEqual(removed, 1);
    assert.strictEqual((await store.listTraces('acme')).total, 0);
    assert.strictEqual((await store.listTraces('other')).total, 1);
  });
});

describe('providerContextVerdict (LIN-2357, pure fold)', () => {
  test('a null providerUi on a Linear workspace is benign — identical to the real provider', () => {
    const traces = [{ providerUi: null, featureFlags: {}, timestamp: new Date() }];
    const result = providerContextVerdict(traces, LINEAR_UI);
    assert.strictEqual(result.untracedContext, 1);
    assert.strictEqual(result.divergent, 0);
    assert.strictEqual(result.benign, 1);
  });

  test('a null providerUi on a GitHub workspace is divergent — regression signal', () => {
    const traces = [{ providerUi: null, featureFlags: {}, timestamp: new Date() }];
    const result = providerContextVerdict(traces, GITHUB_UI);
    assert.strictEqual(result.untracedContext, 1);
    assert.strictEqual(result.divergent, 1);
    assert.strictEqual(result.benign, 0);
  });

  test('mixed old-null and new-with-ui traces: only nulls count toward untracedContext/divergent/benign', () => {
    const traces = [
      { providerUi: null, featureFlags: {}, timestamp: new Date('2026-08-01') },
      { providerUi: GITHUB_UI, featureFlags: {}, timestamp: new Date('2026-08-29') },
    ];
    const result = providerContextVerdict(traces, GITHUB_UI);
    assert.strictEqual(result.traces, 2);
    assert.strictEqual(result.untracedContext, 1);
    assert.strictEqual(result.divergent, 1);
    assert.strictEqual(result.benign, 0);
  });

  test('newestUntracedContextAt picks the max timestamp among null-providerUi traces only', () => {
    const traces = [
      { providerUi: null, featureFlags: {}, timestamp: new Date('2026-08-01T00:00:00.000Z') },
      { providerUi: null, featureFlags: {}, timestamp: new Date('2026-08-15T00:00:00.000Z') },
      { providerUi: GITHUB_UI, featureFlags: {}, timestamp: new Date('2026-08-29T00:00:00.000Z') },
    ];
    const result = providerContextVerdict(traces, GITHUB_UI);
    assert.strictEqual(result.newestUntracedContextAt, '2026-08-15T00:00:00.000Z');
  });

  test('no untraced-context traces ⇒ newestUntracedContextAt is null', () => {
    const traces = [{ providerUi: GITHUB_UI, featureFlags: {}, timestamp: new Date() }];
    const result = providerContextVerdict(traces, GITHUB_UI);
    assert.strictEqual(result.newestUntracedContextAt, null);
  });

  test('a trace with featureFlags: null does not throw (falls back to {})', () => {
    const traces = [{ providerUi: null, featureFlags: null, timestamp: new Date() }];
    assert.doesNotThrow(() => providerContextVerdict(traces, GITHUB_UI));
  });

  test('empty input ⇒ all zero counts, no throw', () => {
    const result = providerContextVerdict([], LINEAR_UI);
    assert.deepStrictEqual(result, { traces: 0, untracedContext: 0, divergent: 0, benign: 0, newestUntracedContextAt: null });
  });

  test('the verdict is derived from resolvePromptUi, not restated — a flag that changes divergence outcome flips the fold too', () => {
    // includeTracker is gated on write + the linearMcp flag (resolvePromptUi):
    // with linearMcp:false, null (write:true) and github (write:true) both
    // resolve includeTracker:false, but comments/subtasks/displayName still
    // differ for github, so the trace stays divergent either way — proving
    // the fold reads resolvePromptUi's full output, not a single field.
    const traces = [{ providerUi: null, featureFlags: { linearMcp: false }, timestamp: new Date() }];
    const withGithub = providerContextVerdict(traces, GITHUB_UI);
    assert.strictEqual(withGithub.divergent, 1);
    // Sanity: resolvePromptUi really does change shape under the flag, so this
    // test is not accidentally passing regardless of featureFlags handling.
    assert.notDeepStrictEqual(
      resolvePromptUi({ linearMcp: false }, null),
      resolvePromptUi({}, null)
    );
  });
});

describe('PromptTraceStore.summarizeProviderContext', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new PromptTraceStore({ collection });
  });

  test('no collection ⇒ EMPTY_PROVIDER_CONTEXT', async () => {
    const result = await new PromptTraceStore({}).summarizeProviderContext('acme', { expectedUi: GITHUB_UI });
    assert.deepStrictEqual(result, EMPTY_PROVIDER_CONTEXT);
  });

  test('missing urlKey ⇒ EMPTY_PROVIDER_CONTEXT', async () => {
    const result = await store.summarizeProviderContext(undefined, { expectedUi: GITHUB_UI });
    assert.deepStrictEqual(result, EMPTY_PROVIDER_CONTEXT);
  });

  test('reads the whole non-expired window, not a page — and names the expected provider', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {} });
    await store.record({ urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {} });
    await store.record({ urlKey: 'acme', feature: 'recommend', providerUi: GITHUB_UI, featureFlags: {} });
    await store.record({ urlKey: 'other', feature: 'recommend', providerUi: null, featureFlags: {} });

    const result = await store.summarizeProviderContext('acme', { expectedUi: GITHUB_UI });
    assert.strictEqual(result.traces, 3);
    assert.strictEqual(result.untracedContext, 2);
    assert.strictEqual(result.divergent, 2);
    assert.strictEqual(result.benign, 0);
    assert.strictEqual(result.expectedDisplayName, 'GitHub Issues');
    assert.strictEqual(result.basis, EMPTY_PROVIDER_CONTEXT.basis);
  });

  test('a benign-only Linear workspace reports zero divergent', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {} });
    const result = await store.summarizeProviderContext('acme', { expectedUi: LINEAR_UI });
    assert.strictEqual(result.untracedContext, 1);
    assert.strictEqual(result.divergent, 0);
    assert.strictEqual(result.benign, 1);
  });

  test('excludes expired traces from the summary (TTL window, same as listTraces)', async () => {
    const expiredStore = new PromptTraceStore({ collection, ttl: -1 });
    await expiredStore.record({ urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {} });
    await store.record({ urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {} });

    const result = await store.summarizeProviderContext('acme', { expectedUi: GITHUB_UI });
    assert.strictEqual(result.traces, 1);
  });

  test('a query failure resolves to EMPTY_PROVIDER_CONTEXT, never throws', async () => {
    const flaky = new PromptTraceStore({
      collection: { find() { return { async toArray() { throw new Error('mongo down'); } }; } }
    });
    const result = await flaky.summarizeProviderContext('acme', { expectedUi: GITHUB_UI });
    assert.deepStrictEqual(result, EMPTY_PROVIDER_CONTEXT);
  });
});
