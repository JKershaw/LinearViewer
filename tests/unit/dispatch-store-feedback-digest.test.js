/**
 * Unit tests for LIN-3010 (LIN-2996 Phase 2): `feedbackVersion`/`feedbackDigest`
 * passthrough in `_formatHistoryItem` and seeding in `_archiveItem`.
 *
 * Neither field is copied by `_formatHistoryItem` today, and `_archiveItem`
 * seeds neither on a newly inserted history row — this is the LIN-1698/1751/
 * 1932/1948 silent-drop class of formatter/archive pair (see
 * `dispatch-store-attribution.test.js`'s header for the LIN-1948 precedent
 * this file otherwise mirrors for the formatter half, and
 * `dispatch-store-periodical-id.test.js` for the archive half).
 *
 * N4 convention (this ticket): `_formatHistoryItem` is a SHALLOW PASSTHROUGH
 * for these two fields only — unlike the rest of this formatter's fields,
 * which normalize a missing source value to `null` (`doc.field || null`), a
 * legacy row that has neither field must format with neither key PRESENT at
 * all. Only `_archiveItem` invents a default (`feedbackVersion: 0,
 * feedbackDigest: null`), and only for newly inserted rows going forward.
 * Collapsing "absent" and "null" in the formatter would violate the ticket's
 * explicit "must not invent either" acceptance clause and the shared
 * `isFreshDigest` predicate's absent-vs-null distinction.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function storeUnderTest() {
  // The formatter is a pure projection over a doc — exercise it directly,
  // same seam as dispatch-store-attribution.test.js.
  return Object.create(DispatchQueueStore.prototype);
}

function docFixture(overrides = {}) {
  return {
    _id: 'disp-1',
    prompt: 'do the thing',
    promptName: 'Prompt',
    kind: 'custom',
    issueIdentifier: 'TEST-1',
    dispatchedAt: '2026-08-10T17:08:46.062Z',
    dispatchedBy: 'acct-1',
    target: 'cli',
    ...overrides,
  };
}

// A realistic persisted feedbackDigest shape (lib/digest-feedback.js):
// loop-facing fields are ISO strings, kpi* fields keep raw Date timestamps.
function digestFixture(overrides = {}) {
  return {
    version: 3,
    count: 2,
    terminal: { status: 'done', entry: { message: '[done]', timestamp: '2026-09-20T12:00:00.000Z' } },
    wake: null,
    decision: null,
    decisionEntryIndex: null,
    decisionCase: null,
    answeredDecisionId: null,
    parkedWait: null,
    telemetry: {
      model: 'claude', evidence: [], usage: null, resources: null,
      ticketMarkers: [], metrics: [], toolPeak: null, runtime: 120,
    },
    kpiTerminalEntry: { message: '[done]', timestamp: new Date('2026-09-20T12:00:00.000Z') },
    kpiUsageEntry: null,
    kpiEvidenceCount: 0,
    kpiTicketMarkerEntries: [],
    ...overrides,
  };
}

describe('LIN-3010 — _formatHistoryItem carries feedbackVersion/feedbackDigest', () => {
  test('present: formats deep-equal to the stored values, kpi* Date left untouched', () => {
    const store = storeUnderTest();
    const feedbackDigest = digestFixture();
    const out = store._formatHistoryItem(docFixture({ feedbackVersion: 3, feedbackDigest }));

    assert.equal(out.feedbackVersion, 3);
    assert.deepEqual(out.feedbackDigest, feedbackDigest);
    assert.ok(out.feedbackDigest.kpiTerminalEntry.timestamp instanceof Date, 'kpi* timestamp must stay a Date, not be reformatted to ISO');
    assert.equal(out.feedbackDigest.terminal.entry.timestamp, '2026-09-20T12:00:00.000Z', 'loop-facing timestamp stays the ISO string it already was');
  });

  test('seeded: feedbackVersion: 0, feedbackDigest: null formats as exactly that, both keys present', () => {
    const store = storeUnderTest();
    const out = store._formatHistoryItem(docFixture({ feedbackVersion: 0, feedbackDigest: null }));

    assert.ok(Object.hasOwn(out, 'feedbackVersion'), 'feedbackVersion key must be present');
    assert.strictEqual(out.feedbackVersion, 0);
    assert.ok(Object.hasOwn(out, 'feedbackDigest'), 'feedbackDigest key must be present');
    assert.strictEqual(out.feedbackDigest, null);
  });

  test('legacy: neither field present on the source doc stays absent on the formatted item, not invented', () => {
    const store = storeUnderTest();
    const out = store._formatHistoryItem(docFixture());

    assert.equal(Object.hasOwn(out, 'feedbackVersion'), false, 'feedbackVersion must not be invented for a legacy row');
    assert.equal(Object.hasOwn(out, 'feedbackDigest'), false, 'feedbackDigest must not be invented for a legacy row');
  });

  test('no other field changes: a base item formats identically on every other key whether or not digest fields are present', () => {
    const store = storeUnderTest();
    const outBase = store._formatHistoryItem(docFixture());
    const outWithDigest = store._formatHistoryItem(docFixture({ feedbackVersion: 2, feedbackDigest: digestFixture({ version: 2 }) }));

    const { feedbackVersion: _v1, feedbackDigest: _d1, ...restBase } = outBase;
    const { feedbackVersion: _v2, feedbackDigest: _d2, ...restWithDigest } = outWithDigest;
    assert.deepEqual(restWithDigest, restBase);
  });
});

describe('LIN-3010 — _archiveItem seeds feedbackVersion/feedbackDigest on every new history row', () => {
  function makeStore() {
    return new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection(),
    });
  }

  test('a row archived via takeItem carries feedbackVersion: 0, feedbackDigest: null in the STORED row', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'do the thing' });
    await store.takeItem(created._id, 'acme');

    const doc = store.historyCollection._docs.find(d => d._id === created._id);
    assert.ok(doc, 'the history row exists');
    assert.strictEqual(doc.feedbackVersion, 0);
    assert.strictEqual(doc.feedbackDigest, null);
  });

  test('a row archived via cancel (removeItem) also carries the seeded defaults', async () => {
    const store = makeStore();
    const created = await store.addItem('acme', { prompt: 'cancel me' });
    await store.removeItem('acme', created._id);

    const doc = store.historyCollection._docs.find(d => d._id === created._id);
    assert.ok(doc, 'the history row exists');
    assert.strictEqual(doc.feedbackVersion, 0);
    assert.strictEqual(doc.feedbackDigest, null);
  });
});
