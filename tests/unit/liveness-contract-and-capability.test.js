/**
 * LIN-3258 — contract pins and the never-act capability boundary.
 *
 *  1. `WAITING_WAKE_MARKERS` must stay `['blocked']`: D2 consumes RAW feedback
 *     via `findWakeEvent` precisely so it never has to widen this shared set
 *     (widening it would flip every `[pending]` run to "waiting on user" in
 *     the UI). A later widening for D2's sake fails CI here (RC3).
 *  2. `lib/liveness-detectors.js` is pure (imports only dispatch-terminal).
 *     `lib/liveness-alarm-sweep.js` imports no dispatch-store, no provider,
 *     no write path.
 *  3. The sweep, run entirely through read-only allowlist Proxies over every
 *     injected store except its own alarm store, can abort, re-dispatch and
 *     message nothing — proven behaviourally and by static import.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WAITING_WAKE_MARKERS } from '../../lib/digest-feedback.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { LivenessAlarmStore } from '../../lib/liveness-alarm-store.js';
import { sweepOneWorkspace } from '../../lib/liveness-alarm-sweep.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const readSrc = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

function importSpecifiers(src) {
  return [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?['"](.+?)['"]\s*;?\s*$/gm)].map((m) => m[1]);
}

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

describe('LIN-3258 contract pin: WAITING_WAKE_MARKERS', () => {
  test('is exactly ["blocked"] — D2 must not widen it', () => {
    assert.deepEqual([...WAITING_WAKE_MARKERS], ['blocked']);
  });
});

describe('LIN-3258 static-import boundary', () => {
  test('lib/liveness-detectors.js is pure — imports only dispatch-terminal', () => {
    const specifiers = importSpecifiers(readSrc('lib/liveness-detectors.js')).sort();
    assert.deepEqual(specifiers, ['./dispatch-terminal.js']);
  });

  test('lib/liveness-alarm-sweep.js imports no dispatch-store / provider / write path', () => {
    const specifiers = importSpecifiers(readSrc('lib/liveness-alarm-sweep.js')).sort();
    assert.deepEqual(specifiers, [
      './consumer-poll-warning.js',
      './liveness-alarm-store.js',
      './liveness-detectors.js',
      './pipeline-loops.js',
      './read-horizon.js'
    ].sort());
  });
});

describe('LIN-3258 negative capability: the guarded sweep can act on nothing', () => {
  const harness = createMangoTmpdir('liveness-negative-');
  let db;

  before(() => harness.connect());
  after(() => harness.close());

  test('the allowlist fails loudly, naming the exact forbidden method', () => {
    const store = new DispatchQueueStore({ collection: { find: () => ({ toArray: async () => [] }) } });
    const guarded = forbiddenProxy(store, ['listItems'], 'dispatchStore');
    assert.throws(() => guarded.addItem('ws', { prompt: 'x' }), /forbidden intervention path: dispatchStore\.addItem/);
    assert.throws(() => guarded.takeItem('x'), /forbidden intervention path: dispatchStore\.takeItem/);
    assert.throws(() => guarded.abortItem('x'), /forbidden intervention path: dispatchStore\.abortItem/);
  });

  test('two sweep ticks through read-only-allowlisted stores write nothing but alarm rows', async () => {
    db = harness.freshDb();
    const urlKey = 'ws-negative-liveness';
    const realDispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 86400
    });
    const realAlarmStore = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });

    // Seed one taken row with a target-less parent-addressed wait, through the
    // REAL store (setup, not the sweep under test).
    const seeded = await realDispatchStore.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'close-out' });
    await realDispatchStore.takeItem(seeded._id, urlKey, 'consumer-1');
    await realDispatchStore.addFeedback(seeded._id, urlKey, {
      message: '[pending] I am waiting on the orchestrator to dispatch a beat',
      timestamp: new Date('2026-10-02T15:12:57.700Z')
    }, 'consumer-1');

    const queueColl = db.collection('dispatch-queue');
    const historyColl = db.collection('dispatch-history');
    const countsBefore = {
      queue: (await queueColl.find({ urlKey }).toArray()).length,
      history: (await historyColl.find({ urlKey }).toArray()).length
    };

    const dispatchStore = forbiddenProxy(realDispatchStore, ['listItems', 'listHistory', 'listObservedWorkspaceKeys'], 'dispatchStore');
    const alarmStore = forbiddenProxy(realAlarmStore, ['open', 'clear', 'markMiss', 'getById', 'list', 'listOpenWorkspaceKeys'], 'alarmStore');
    const agentStatusStore = forbiddenProxy({}, [], 'agentStatusStore');

    const now = Date.parse('2026-10-02T15:20:00.000Z');
    const deps = {
      dispatchStore,
      agentStatusStore,
      alarmStore,
      getLoops: async () => [{
        loopId: seeded._id,
        lineageId: seeded._id,
        sessionId: null,
        issueIdentifier: 'LIN-1',
        dispatchedAt: '2026-10-02T15:04:00.000Z',
        wakeMarker: 'pending',
        terminalStatus: null,
        historyStatus: 'taken',
        source: 'history',
        lineageLastActivityMs: now
      }],
      getLastSeen: async () => new Date(now - 60_000).toISOString()
    };

    await sweepOneWorkspace(urlKey, now, deps);
    await sweepOneWorkspace(urlKey, now, deps);

    const countsAfter = {
      queue: (await queueColl.find({ urlKey }).toArray()).length,
      history: (await historyColl.find({ urlKey }).toArray()).length
    };
    assert.deepStrictEqual(countsAfter, countsBefore, 'no dispatch write (add/take/abort/feedback) occurred');
    // The single target-less wait has no resolvable edge → covered, so no
    // alarm is written either; the invariant is that the sweep ran to
    // completion having touched nothing but its allowed read methods.
    assert.equal((await realAlarmStore.list(urlKey, { state: 'all' })).length, 0);
  });
});
