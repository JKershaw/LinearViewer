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
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import { PromptTraceStore, providerContextVerdict, EMPTY_PROVIDER_CONTEXT } from '../../lib/prompt-trace-store.js';
import { resolvePromptUi } from '../../lib/prompt-formatters.js';
import { createMangoTmpdir, recordingCollection } from '../fixtures/mango-tmpdir.js';

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

// LIN-3162 (LIN-3157 A2): listTraces became a database-side paged read. Its
// sort keeps the existing same-millisecond `_seq` tie-break and adds a trailing
// `_id` so paging is total-ordered; a legacy row with no `_seq` sorts last
// within the tie. The old inline double (toArray-only cursor, no countDocuments)
// cannot serve this, so these run on a real MangoDB tmpdir.
describe('PromptTraceStore.listTraces (real MangoDB tmpdir, LIN-3162 A2)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let harness;
  let raw;
  let collection;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-traces-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('prompt-traces');
    collection = recordingCollection(raw);
    store = new PromptTraceStore({ collection });
  });

  async function seed({ expiresAt, _seq, ...doc }) {
    const timestamp = doc.timestamp || new Date();
    const out = { urlKey: 'acme', feature: 'recommend', ...doc, timestamp };
    if (_seq !== undefined) out._seq = _seq;
    out.expiresAt = expiresAt !== undefined ? expiresAt : new Date(timestamp.getTime() + 30 * DAY_MS);
    await raw.insertOne(out);
  }

  test('is workspace-scoped and newest-first, and returns content', async () => {
    const now = Date.now();
    await seed({ _id: 'first', prompt: 'first', metaPrompt: 'p1', timestamp: new Date(now - 2000) });
    await seed({ _id: 'second', prompt: 'second', metaPrompt: 'p2', timestamp: new Date(now) });
    await seed({ _id: 'other', urlKey: 'other', prompt: 'elsewhere', timestamp: new Date(now) });

    const { items, total } = await store.listTraces('acme');
    assert.strictEqual(total, 2);
    assert.deepStrictEqual(items.map(i => i.prompt), ['second', 'first']);
    assert.strictEqual(items[0].metaPrompt, 'p2');
    assert.strictEqual(items[0].urlKey, 'acme');
    assert.ok(items.every(i => typeof i.timestamp === 'string' && i.id));
  });

  test('honours limit and offset', async () => {
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await seed({ _id: `p${i}`, prompt: `p${i}`, timestamp: new Date(base - i * 1000) });
    }
    const { items, total } = await store.listTraces('acme', { limit: 2, offset: 1 });
    assert.strictEqual(total, 5);
    assert.deepStrictEqual(items.map(i => i.prompt), ['p1', 'p2']);
  });

  test('returns empty for unknown workspace, missing urlKey, or no collection', async () => {
    await seed({ _id: 'x', prompt: 'x' });
    assert.deepStrictEqual(await store.listTraces('nope'), { items: [], total: 0 });
    assert.deepStrictEqual(await store.listTraces(), { items: [], total: 0 });
    assert.deepStrictEqual(await new PromptTraceStore({}).listTraces('acme'), { items: [], total: 0 });
  });

  test('hides rows older than the horizon even when their stamped expiry is still live (A2)', async () => {
    const now = Date.now();
    await seed({ _id: 'old-live', prompt: 'gone', timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });
    await seed({ _id: 'kept', prompt: 'kept', timestamp: new Date(now - 5 * DAY_MS) });

    const { items, total } = await store.listTraces('acme');
    assert.strictEqual(total, 1);
    assert.strictEqual(items[0].prompt, 'kept');
  });

  test('returns a row with no expiresAt field when it is inside the horizon (A2)', async () => {
    const now = Date.now();
    await seed({ _id: 'no-stamp', prompt: 'nostamp', timestamp: new Date(now - 5 * DAY_MS), expiresAt: undefined });

    const { items, total } = await store.listTraces('acme');
    assert.strictEqual(total, 1);
    assert.strictEqual(items[0].id, 'no-stamp');
  });

  test('pages in the database: sort().skip().limit() plus countDocuments, no full materialisation (A2)', async () => {
    const base = Date.now();
    for (let i = 0; i < 25; i++) {
      await seed({ _id: `p${i}`, prompt: `p${i}`, timestamp: new Date(base - i * 1000) });
    }
    const { items, total } = await store.listTraces('acme', { limit: 5, offset: 10 });
    const cursor = collection.__record.cursors.at(-1);
    assert.deepStrictEqual(cursor.sorts, [{ timestamp: -1, _seq: -1, _id: -1 }]);
    assert.deepStrictEqual(cursor.skips, [10]);
    assert.deepStrictEqual(cursor.limits, [5]);
    assert.strictEqual(cursor.materialized, 5, 'only the page may be materialised');
    assert.strictEqual(collection.__record.countDocuments.length, 1, 'total must come from countDocuments');
    assert.strictEqual(total, 25);
    assert.strictEqual(items.length, 5);
  });

  test('same-millisecond traces order by _seq desc, then _id, with a legacy no-_seq row last (A2)', async () => {
    const now = Date.now();
    const ts = new Date(now - 1000);
    await seed({ _id: 'x-legacy', timestamp: ts });
    await seed({ _id: 'x5', timestamp: ts, _seq: 5 });
    await seed({ _id: 'x9', timestamp: ts, _seq: 9 });

    const { items } = await store.listTraces('acme');
    assert.deepStrictEqual(items.map(i => i.id), ['x9', 'x5', 'x-legacy']);
  });

  test('same-millisecond ties page without duplicates or gaps (A2)', async () => {
    const now = Date.now();
    const ts = new Date(now - 1000);
    for (const id of ['c', 'a', 'b']) {
      await seed({ _id: id, timestamp: ts, expiresAt: new Date(now + DAY_MS) });
    }
    const p0 = await store.listTraces('acme', { limit: 1, offset: 0 });
    const p1 = await store.listTraces('acme', { limit: 1, offset: 1 });
    const p2 = await store.listTraces('acme', { limit: 1, offset: 2 });
    assert.deepStrictEqual([p0.items[0].id, p1.items[0].id, p2.items[0].id], ['c', 'b', 'a']);
    assert.strictEqual(new Set([p0.items[0].id, p1.items[0].id, p2.items[0].id]).size, 3);
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

describe('PromptTraceStore.clear (real MangoDB tmpdir, LIN-3162 A2)', () => {
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-trace-clear-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('prompt-traces');
    store = new PromptTraceStore({ collection: raw });
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

  test('a query failure resolves to EMPTY_PROVIDER_CONTEXT, never throws', async () => {
    const flaky = new PromptTraceStore({
      collection: { find() { return { async toArray() { throw new Error('mongo down'); } }; } }
    });
    const result = await flaky.summarizeProviderContext('acme', { expectedUi: GITHUB_UI });
    assert.deepStrictEqual(result, EMPTY_PROVIDER_CONTEXT);
  });
});

// ---------------------------------------------------------------------------
// C4 #7 (treatment H, permanent): summarizeProviderContext reads the reporting
// window keyed on `timestamp`, replacing the expiry-stamp predicate. Real
// engine — the witness is that an aged-out row with a live stamp is excluded
// while a no-expiresAt row inside the window is counted.
// ---------------------------------------------------------------------------

describe('PromptTraceStore.summarizeProviderContext keys on the read horizon (real MangoDB tmpdir, LIN-3162 A2)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-provider-context-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('prompt-traces');
    store = new PromptTraceStore({ collection: raw });
  });

  test('counts a no-expiresAt row inside the horizon and hides a >30d row with a live stamp (A2)', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'no-stamp', urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {}, timestamp: new Date(now - 5 * DAY_MS) });
    await raw.insertOne({ _id: 'old-live', urlKey: 'acme', feature: 'recommend', providerUi: null, featureFlags: {}, timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });

    const result = await store.summarizeProviderContext('acme', { expectedUi: GITHUB_UI });
    assert.strictEqual(result.traces, 1, 'only the in-horizon row is read');
    assert.strictEqual(result.untracedContext, 1);
    assert.strictEqual(result.divergent, 1);
  });
});
