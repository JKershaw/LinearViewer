/**
 * LIN-3242 (LIN-3126 slice 3) — dispatch-store S0 pin + sparse persistence of the
 * dispatch binding selector pair (`issueSource` / `issueBindingScope`).
 *
 * The pair is written with the SAME sparse conditional-spread idiom as
 * `grantDeclaration` (LIN-3138 Decision 8), so:
 *   - a row with NO selector keeps a byte-identical key set, on the queue doc
 *     and across the queue→history archive hop (S0); and
 *   - a row WITH the pair persists it whole and survives `_archiveItem`.
 *
 * The goldens below are the EXACT sorted key sets captured at the pre-change
 * HEAD (before the pair existed). They must be updated DELIBERATELY — a new
 * field that lands `|| null` (the `producingItemId` convention rather than the
 * sparse one) turns the byte-identity assertions red.
 *
 * Fails before (recorded 2026-10-02, store stashed to the unfixed HEAD): the
 * four "persists/survives when present" assertions fail because the unfixed
 * store writes neither key; the three byte-identity assertions pass both before
 * and after. Observed:
 *   ✖ addItem persists the pair whole when present
 *   ✖ the pair survives the take → archive hop
 *   ✖ the pair survives the cancel → archive hop (removeItem)
 *   ✖ the pair survives the expiry → archive hop (cleanup)
 *   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
 *     + actual - expected
 *     + undefined
 *     - 'github'
 *
 * Run with: node --test tests/unit/dispatch-store-issue-binding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// Captured at the pre-change HEAD. Sorted, full key sets. `variant` was added
// deliberately on merging main: LIN-3248 N2 writes it unconditionally
// (`?? null`) on every queue row and across the archive hop — main's own key,
// not this slice's, so the S0 property (the pair adds no key when absent) holds.
const QUEUE_KEYS_GOLDEN = [
  '_id', 'abort', 'abortTo', 'bootstrapToken', 'cascade', 'consumerLastSeenAt',
  'dispatchedAt', 'dispatchedBy', 'effort', 'expiresAt', 'followUpTo', 'force',
  'harness', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl', 'kind',
  'maxSessionsPerTask', 'maxTasks', 'model', 'periodicalId', 'presetConfig',
  'presetName', 'producingItemAttempt', 'producingItemId', 'prompt', 'promptName',
  'queueIfBusy', 'repo', 'rootItemId', 'sessionGroupId', 'sessionId', 'stopAt',
  'subscription', 'target', 'terminal', 'urlKey', 'variant', 'waitForFollowUps',
];

const HISTORY_KEYS_GOLDEN = [
  '_id', 'abort', 'abortTo', 'cascade', 'consumerLastSeenAt', 'dispatchedAt',
  'dispatchedBy', 'effort', 'feedbackDigest', 'feedbackVersion', 'followUpTo',
  'force', 'harness', 'issueId', 'issueIdentifier', 'issueTitle', 'issueUrl',
  'kind', 'maxSessionsPerTask', 'maxTasks', 'model', 'periodicalId',
  'presetConfig', 'presetName', 'producingItemAttempt', 'producingItemId',
  'prompt', 'promptName', 'queueIfBusy', 'repo', 'resolvedAt', 'rootItemId',
  'sessionGroupId', 'sessionId', 'status', 'stopAt', 'subscription',
  'takenByTokenId', 'takenByTokenLabel', 'target', 'terminal', 'trimHistory',
  'urlKey', 'variant', 'waitForFollowUps',
];

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection(),
  });
}

const SELECTOR = { issueSource: 'github', issueBindingScope: 'octo/repoB' };

describe('LIN-3242 — dispatch-store S0: an unstamped row keeps a byte-identical key set', () => {
  test('the queue doc for a selector-less dispatch has exactly the pre-change key set', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });
    const doc = store.collection._docs[0];
    assert.deepEqual(Object.keys(doc).sort(), QUEUE_KEYS_GOLDEN);
    assert.equal('issueSource' in doc, false, 'no issueSource key when unstamped');
    assert.equal('issueBindingScope' in doc, false, 'no issueBindingScope key when unstamped');
  });

  test('the archived history doc for a selector-less dispatch has exactly the pre-change key set', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });
    await store.takeItem(created._id, 'acme');
    const hist = store.historyCollection._docs[0];
    assert.deepEqual(Object.keys(hist).sort(), HISTORY_KEYS_GOLDEN);
    assert.equal('issueSource' in hist, false);
    assert.equal('issueBindingScope' in hist, false);
  });

  test('explicit null fields are not written (sparse: never a null key)', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'p', issueSource: null, issueBindingScope: null });
    const doc = store.collection._docs[0];
    assert.equal('issueSource' in doc, false);
    assert.equal('issueBindingScope' in doc, false);
    assert.deepEqual(Object.keys(doc).sort(), QUEUE_KEYS_GOLDEN);
  });
});

describe('LIN-3242 — dispatch-store: the selector pair persists and survives _archiveItem', () => {
  test('addItem persists the pair whole when present', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', ...SELECTOR });
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'github', 'a stamped row must persist issueSource');
    assert.equal(doc.issueBindingScope, 'octo/repoB', 'a stamped row must persist issueBindingScope');
  });

  test('the pair survives the take → archive hop', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', ...SELECTOR });
    await store.takeItem(created._id, 'acme');
    const hist = store.historyCollection._docs[0];
    assert.equal(hist.issueSource, 'github');
    assert.equal(hist.issueBindingScope, 'octo/repoB');
    // The only delta from the golden is the two intended keys.
    assert.deepEqual(
      Object.keys(hist).sort().filter(k => !QUEUE_KEYS_GOLDEN.includes(k)).filter(k => !HISTORY_KEYS_GOLDEN.includes(k)),
      ['issueBindingScope', 'issueSource'],
    );
  });

  test('the pair survives the cancel → archive hop (removeItem)', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', ...SELECTOR });
    await store.removeItem('acme', created._id);
    assert.equal(store.historyCollection._docs[0].issueSource, 'github');
    assert.equal(store.historyCollection._docs[0].issueBindingScope, 'octo/repoB');
  });

  test('the pair survives the expiry → archive hop (cleanup)', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', ...SELECTOR });
    store.collection._docs[0].expiresAt = new Date(0);
    await store.cleanup();
    assert.equal(store.historyCollection._docs[0].issueSource, 'github');
    assert.equal(store.historyCollection._docs[0].issueBindingScope, 'octo/repoB');
  });
});

// F3 (review): the LIVE-queue projection (`_formatItem`) is what the effort
// read-out reads; only the history projection was pinned (M11), so removing the
// `_formatItem` projection survived. These kill M10.
describe('LIN-3242 review F3 — _formatItem projects the pair sparsely', () => {
  test('a stamped live row projects both fields', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1', ...SELECTOR });
    const projected = store._formatItem(store.collection._docs[0]);
    assert.equal(projected.issueSource, 'github');
    assert.equal(projected.issueBindingScope, 'octo/repoB');
  });

  test('an unstamped live row adds no key', async () => {
    const store = makeStore();
    await store.addItem('acme', { prompt: 'p', issueIdentifier: 'LIN-1' });
    const projected = store._formatItem(store.collection._docs[0]);
    assert.equal('issueSource' in projected, false);
    assert.equal('issueBindingScope' in projected, false);
  });
});
