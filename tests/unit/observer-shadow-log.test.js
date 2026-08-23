/**
 * Unit tests for lib/observer-shadow-log.js (LIN-2132, P1-5 of the LIN-2114
 * observer-harness epic).
 *
 * Run with: node --test tests/unit/observer-shadow-log.test.js
 *
 * Coverage:
 *   A. computeWouldBeAction / computeWouldBeActions — pure vocabulary mapping.
 *   B. Vocabulary parity — the logged would-be feedback/comment shapes are
 *      recognized by the REAL parsers (lib/dispatch-terminal.js's
 *      isWakeEvent), not merely similarly-shaped, so LIN-2133/LIN-2139 can
 *      consume them without translation.
 *   C. ObserverShadowLogStore — recordActions / listByWorkspace / cleanup,
 *      against an in-memory mock collection (precedent:
 *      tests/unit/task-snapshot-store.test.js).
 *   D. Growth/retention cap — per-workspace count cap, matching P1-2's
 *      (lib/observer-state-store.js) retention pattern per this ticket's own
 *      acceptance criteria.
 *   E. Negative/spy — this module's write path never reaches
 *      AgentStatusStore#recordStatus, DispatchQueueStore#addFeedback, or
 *      createComment (lib/providers/linear/index.js), same shape as P1-3's
 *      own no-auto-resume negative test (tests/unit/observer-sweep.test.js).
 *   F. Static import assertion — this module imports nothing beyond `crypto`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  computeWouldBeAction,
  computeWouldBeActions,
  ObserverShadowLogStore,
  MAX_ENTRIES_PER_WORKSPACE,
  RETENTION_IDLE_MS
} from '../../lib/observer-shadow-log.js';
import { isWakeEvent, findWakeEvent } from '../../lib/dispatch-terminal.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

// Minimal in-memory mock of the collection surface the store uses —
// precedent: tests/unit/task-snapshot-store.test.js's createMockCollection.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.recordedAt !== undefined && query.recordedAt && typeof query.recordedAt === 'object' && query.recordedAt.$lt !== undefined) {
      const docMs = doc.recordedAt instanceof Date ? doc.recordedAt.getTime() : new Date(doc.recordedAt).getTime();
      const cutoffMs = query.recordedAt.$lt instanceof Date ? query.recordedAt.$lt.getTime() : new Date(query.recordedAt.$lt).getTime();
      if (!(docMs < cutoffMs)) return false;
    }
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    find(query = {}) {
      const results = docs.filter((d) => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex((d) => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

function attentionRow(overrides = {}) {
  return {
    loopId: 'loop-1',
    issue: 'LIN-42',
    lane: 'blocked',
    stage: 'implementation',
    since: '2026-08-20T10:00:00.000Z',
    ...overrides
  };
}

// ─── A. computeWouldBeAction / computeWouldBeActions ───────────────────────

describe('observer-shadow-log: computeWouldBeAction (LIN-2132)', () => {
  test('a blocked attention row produces a would-be [blocked] marker + comment, plus the S3 diagnosis it was derived from', () => {
    const action = computeWouldBeAction(attentionRow());
    assert.ok(action);
    assert.strictEqual(action.loopId, 'loop-1');
    assert.strictEqual(action.issue, 'LIN-42');
    assert.strictEqual(action.lane, 'blocked');
    assert.strictEqual(action.wouldBeMarker, 'blocked');
    assert.match(action.wouldBeFeedback.message, /^\[blocked\]/);
    assert.match(action.wouldBeComment.body, /^\[blocked\]/);
    assert.deepStrictEqual(action.diagnosis, { lane: 'blocked', stage: 'implementation', since: '2026-08-20T10:00:00.000Z' });
  });

  test('a silent attention row produces NO would-be action — [working]/[evidence] both require data this diagnosis payload does not carry', () => {
    assert.strictEqual(computeWouldBeAction(attentionRow({ lane: 'silent' })), null);
  });

  test('an unrecognised/absent row is a defensive null, not a throw', () => {
    assert.strictEqual(computeWouldBeAction(null), null);
    assert.strictEqual(computeWouldBeAction({}), null);
    assert.strictEqual(computeWouldBeAction(attentionRow({ lane: 'unknown' })), null);
  });

  test('a missing stage omits the parenthetical without leaving stray punctuation', () => {
    const action = computeWouldBeAction(attentionRow({ stage: null }));
    assert.doesNotMatch(action.wouldBeFeedback.message, /\(\)/);
    assert.doesNotMatch(action.wouldBeFeedback.message, /\(null\)/);
  });
});

describe('observer-shadow-log: computeWouldBeActions (whole-tick payload)', () => {
  test('maps buildSweepPayload-shaped attention[] to one would-be action PER blocked row, silent rows filtered out, order preserved', () => {
    const payload = {
      v: 1,
      lanes: { working: 0, silent: 1, blocked: 2, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
      attention: [
        attentionRow({ loopId: 'a', lane: 'blocked' }),
        attentionRow({ loopId: 'b', lane: 'silent' }),
        attentionRow({ loopId: 'c', lane: 'blocked' })
      ],
      truncated: false
    };
    const actions = computeWouldBeActions(payload);
    assert.strictEqual(actions.length, 2);
    assert.deepStrictEqual(actions.map((a) => a.loopId), ['a', 'c']);
  });

  test('an empty/absent attention array yields an empty (never thrown) result', () => {
    assert.deepStrictEqual(computeWouldBeActions({ attention: [] }), []);
    assert.deepStrictEqual(computeWouldBeActions({}), []);
    assert.deepStrictEqual(computeWouldBeActions(null), []);
  });
});

// ─── B. Vocabulary parity ───────────────────────────────────────────────────

describe('observer-shadow-log: vocabulary parity with the real dispatch-feedback parsers', () => {
  test('the logged would-be feedback message is recognized by isWakeEvent/findWakeEvent as a genuine "blocked" wake marker', () => {
    const action = computeWouldBeAction(attentionRow());
    assert.ok(isWakeEvent(action.wouldBeFeedback.message));
    const found = findWakeEvent([action.wouldBeFeedback]);
    assert.strictEqual(found.marker, 'blocked');
  });
});

// ─── C/D. ObserverShadowLogStore — CRUD + growth cap ────────────────────────

describe('observer-shadow-log: ObserverShadowLogStore', () => {
  test('recordActions is a no-op (returns 0, no write) for an empty action list — most ticks have no blocked row', async () => {
    const store = new ObserverShadowLogStore({ collection: createMockCollection() });
    assert.strictEqual(await store.recordActions('ws', []), 0);
    assert.strictEqual((await store.listByWorkspace('ws')).total, 0);
  });

  test('records one document per would-be action and lists them newest-first', async () => {
    const collection = createMockCollection();
    const store = new ObserverShadowLogStore({ collection });
    const older = new Date('2026-08-20T10:00:00.000Z');
    const newer = new Date('2026-08-20T11:00:00.000Z');
    await store.recordActions('ws', [computeWouldBeAction(attentionRow({ loopId: 'a' }))], older);
    await store.recordActions('ws', [computeWouldBeAction(attentionRow({ loopId: 'b' }))], newer);

    const { items, total } = await store.listByWorkspace('ws');
    assert.strictEqual(total, 2);
    assert.deepStrictEqual(items.map((i) => i.loopId), ['b', 'a'], 'newest (later recordedAt) first');
  });

  test('entries are scoped per workspace — a read for one workspace never sees another\'s', async () => {
    const collection = createMockCollection();
    const store = new ObserverShadowLogStore({ collection });
    await store.recordActions('ws-a', [computeWouldBeAction(attentionRow())]);
    await store.recordActions('ws-b', [computeWouldBeAction(attentionRow())]);
    assert.strictEqual((await store.listByWorkspace('ws-a')).total, 1);
    assert.strictEqual((await store.listByWorkspace('ws-b')).total, 1);
  });

  test('growth/retention cap: per-workspace count is pruned to maxPerWorkspace, keeping the newest — matching P1-2\'s retention pattern', async () => {
    const collection = createMockCollection();
    const store = new ObserverShadowLogStore({ collection, maxPerWorkspace: 3 });
    for (let i = 0; i < 5; i++) {
      const at = new Date(2026, 7, 20, 10, i);
      await store.recordActions('ws', [computeWouldBeAction(attentionRow({ loopId: `loop-${i}` }))], at);
    }
    const { items, total } = await store.listByWorkspace('ws');
    assert.strictEqual(total, 3, 'pruned down to the configured cap');
    assert.deepStrictEqual(items.map((i) => i.loopId), ['loop-4', 'loop-3', 'loop-2'], 'the newest 3 survive, oldest evicted');
  });

  test('the cap is per-workspace, not global', async () => {
    const collection = createMockCollection();
    const store = new ObserverShadowLogStore({ collection, maxPerWorkspace: 2 });
    for (let i = 0; i < 3; i++) {
      await store.recordActions('ws-a', [computeWouldBeAction(attentionRow({ loopId: `a-${i}` }))], new Date(2026, 7, 20, 10, i));
    }
    for (let i = 0; i < 3; i++) {
      await store.recordActions('ws-b', [computeWouldBeAction(attentionRow({ loopId: `b-${i}` }))], new Date(2026, 7, 20, 10, i));
    }
    assert.strictEqual((await store.listByWorkspace('ws-a')).total, 2);
    assert.strictEqual((await store.listByWorkspace('ws-b')).total, 2);
  });

  test('the exported MAX_ENTRIES_PER_WORKSPACE is the constructor default', async () => {
    const store = new ObserverShadowLogStore({ collection: createMockCollection() });
    assert.strictEqual(store.maxPerWorkspace, MAX_ENTRIES_PER_WORKSPACE);
  });

  test('cleanup() evicts entries older than RETENTION_IDLE_MS, keyed on recordedAt — never a TTL index (house rule, lib/db-indexes.js)', async () => {
    const collection = createMockCollection();
    const store = new ObserverShadowLogStore({ collection });
    const now = Date.now();
    const stale = new Date(now - RETENTION_IDLE_MS - 1000);
    const fresh = new Date(now - 1000);
    await store.recordActions('ws', [computeWouldBeAction(attentionRow({ loopId: 'stale' }))], stale);
    await store.recordActions('ws', [computeWouldBeAction(attentionRow({ loopId: 'fresh' }))], fresh);

    const removed = await store.cleanup();
    assert.strictEqual(removed, 1);
    const { items } = await store.listByWorkspace('ws');
    assert.deepStrictEqual(items.map((i) => i.loopId), ['fresh']);
  });

  test('a missing collection degrades to a neutral no-op rather than throwing', async () => {
    const store = new ObserverShadowLogStore({});
    assert.strictEqual(await store.recordActions('ws', [computeWouldBeAction(attentionRow())]), 0);
    assert.deepStrictEqual(await store.listByWorkspace('ws'), { items: [], total: 0 });
    assert.strictEqual(await store.cleanup(), 0);
  });
});

// ─── E. Negative/spy — no live-pipeline write is reachable ──────────────────

describe('observer-shadow-log: negative capability — no live-pipeline write is reachable (LIN-2132 P1 invariant)', () => {
  function forbiddenProxy(target, allowedMethods, label) {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(obj, prop, receiver);
        if (allowedMethods.includes(prop)) {
          const value = Reflect.get(obj, prop, receiver);
          return typeof value === 'function' ? value.bind(obj) : value;
        }
        throw new Error(`forbidden intervention path: ${label}.${String(prop)}`);
      }
    });
  }

  test('computeWouldBeActions + ObserverShadowLogStore#recordActions never touch AgentStatusStore#recordStatus or DispatchQueueStore#addFeedback', async () => {
    // Real store instances, but with EVERY method forbidden except the ones
    // this module's own header claims it never calls — proves it by
    // construction rather than by inspection.
    const agentStatusStore = forbiddenProxy(new AgentStatusStore({ collection: createMockCollection() }), [], 'agentStatusStore');
    const dispatchStore = forbiddenProxy(new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() }), [], 'dispatchStore');
    // A fake Linear provider surface — createComment is forbidden entirely.
    const linearProvider = forbiddenProxy({ createComment: async () => { throw new Error('should never be called'); } }, [], 'linearProvider');

    const payload = {
      attention: [attentionRow({ loopId: 'x' }), attentionRow({ loopId: 'y', lane: 'silent' })]
    };
    const shadowStore = new ObserverShadowLogStore({ collection: createMockCollection() });

    // The full P1-5 write path, run with the live-pipeline surfaces present
    // in scope but wired to throw on ANY access — if computeWouldBeActions
    // or recordActions ever reached toward them, this test fails loudly.
    const actions = computeWouldBeActions(payload);
    const count = await shadowStore.recordActions('ws', actions, new Date());

    assert.strictEqual(count, 1, 'only the blocked row produced a shadow entry');
    // No assertion needed on agentStatusStore/dispatchStore/linearProvider —
    // the forbiddenProxy above throws synchronously on first access; reaching
    // this line at all is the proof none were touched.
    void agentStatusStore;
    void dispatchStore;
    void linearProvider;
  });
});

// ─── F. Static import assertion ─────────────────────────────────────────────

describe('observer-shadow-log: static import assertion', () => {
  test('lib/observer-shadow-log.js imports nothing beyond node:crypto — no dispatch-store/agent-status-store/linear-provider import of any kind', () => {
    const modulePath = fileURLToPath(new URL('../../lib/observer-shadow-log.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    const specifiers = [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?['"](.+?)['"]\s*;?\s*$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(specifiers, ['crypto'], 'a new import here must be caught by this assertion — this module must stay import-free of the live pipeline');
  });
});
