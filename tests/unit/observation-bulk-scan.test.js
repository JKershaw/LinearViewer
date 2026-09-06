/**
 * LIN-2700 (LIN-2651 Phase 2) — the client-side bulk-scan pool.
 * LIN-2701 §B.6 (Phase 3, beat 2) — the seven-way result classifier built on
 * top of that pool (classifyBulkScanResult), added below the Phase 2
 * witnesses in the same file: the classifier is exported from the SAME
 * vm-sandboxed module and needs the same harness, and its witnesses drive
 * real pool entries through it exactly the way §B.7's onResult wiring will.
 *
 * Three required witnesses, all net-new (zero prior coverage — no existing
 * test can be extended, per the ticket): the strict concurrency-peak bound,
 * no NEW issuance after a stop (explicitly covering the dequeue-but-not-yet-
 * issued window), and client-side abort-signal propagation. The third is
 * deliberately scoped: it proves the browser's AbortController fires and the
 * mocked postScan's `init` carries that exact signal — it does NOT and
 * cannot prove server-side cancellation. Per the accepted abort gap
 * (LIN-2700/LIN-2651): `generateScan` (lib/scan.js:191-200) forwards no
 * signal and the scan route wires no disconnect handler, so an already-
 * issued scan still completes server-side, bills in full, writes an
 * `llm-call-log` row, and can still raise a ruling. Asserting server-side
 * cancellation here would assert a falsehood.
 *
 * `public/observation.js` is a browser script with DOM/fetch dependencies at
 * call time but none at load time, so it is vm-sandboxed the same way
 * tests/unit/observation-basis-check.test.js already does — that file stays
 * untouched; this is a new, separate seam for the bulk-scan pool.
 *
 * Run with: node --test tests/unit/observation-bulk-scan.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

/**
 * `AbortController`/`DOMException` are NOT present in a bare vm context by
 * default (verified: `vm.createContext({})` then `typeof AbortController`
 * reads `'undefined'`) — public/observation.js's pool constructs a real
 * `new AbortController()`, so the sandbox must supply the host's own,
 * exactly like it already supplies `setTimeout`/`clearTimeout`.
 */
function makeSandbox(postScanImpl) {
  const sandbox = {
    module: { exports: {} },
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {} },
      ScanSection: { postScan: postScanImpl },
      // The pool must reach postScan via window.ScanSection, never window.api
      // directly (that would be re-deriving the scan endpoint itself — the
      // "no fourth scan-URL builder" non-goal beat 1 flagged) — fail loud if
      // it ever does.
      api: async () => { throw new Error('bulk-scan pool must call window.ScanSection.postScan, not window.api'); }
    },
    document: {
      createElement: () => ({ children: [], addEventListener() {}, querySelector() { return null; }, setAttribute() {} }),
      addEventListener() {},
      getElementById: () => null
    },
    escapeHtml: (s) => (s === undefined || s === null ? '' : String(s)),
    relativeTime: () => '',
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    setImmediate,
    AbortController
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'observation.js' });
  return sandbox;
}

/** A promise a test can resolve/reject on its own schedule. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
};

function items(n) {
  return Array.from({ length: n }, (_, i) => ({ urlKey: 'acme', identifier: `T-${i}`, source: 'local' }));
}

test.describe('startBulkScan / pumpBulkScans — concurrency bound (Witness 1)', () => {
  test('peak in-flight postScan calls equals BULK_SCAN_CONCURRENCY exactly, never merely <=', async () => {
    // Strict equality, per tests/unit/settle-with-concurrency.test.js's own
    // rationale (its "peak concurrent in-flight calls never exceeds the
    // given limit" test asserts `peak === LIMIT`): `<=` passes trivially on
    // a serial (effectively concurrency-1) implementation, so it would prove
    // nothing about the pool actually running BULK_SCAN_CONCURRENCY jobs in
    // parallel. Peak is tracked with manually-resolved (deferred) job
    // promises so it is deterministic, not a race against real timers.
    let inFlight = 0;
    let peak = 0;
    const gates = [];
    const postScan = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const d = deferred();
      gates.push(d);
      await d.promise;
      inFlight--;
      return { ok: true };
    };
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, BULK_SCAN_CONCURRENCY } = sandbox.module.exports;

    const N = BULK_SCAN_CONCURRENCY * 3;
    let teardownFired = false;
    let teardownResults = null;
    startBulkScan(items(N), { onTeardown: (results) => { teardownFired = true; teardownResults = results; } });
    await flush();

    assert.equal(peak, BULK_SCAN_CONCURRENCY, `expected peak in-flight to reach exactly ${BULK_SCAN_CONCURRENCY}, observed ${peak}`);

    // Release one gate at a time; peak must never exceed the bound as later
    // items dequeue to fill freed slots.
    for (let i = 0; i < N; i++) {
      gates[i].resolve();
      await flush(2);
      assert.ok(peak <= BULK_SCAN_CONCURRENCY, `peak exceeded the bound mid-run: ${peak}`);
    }

    assert.equal(peak, BULK_SCAN_CONCURRENCY, 'peak must never have exceeded the bound across the whole run');
    assert.equal(gates.length, N, 'every item must eventually have been issued');
    // Teardown (requirement 6) fires on full settlement, clearing the pool
    // for a next run — confirmed here rather than asserted separately, since
    // it is this test's natural end state.
    assert.equal(teardownFired, true, 'teardown must fire once every job has settled');
    assert.equal(teardownResults.length, N, 'teardown must be handed every settled result');
  });
});

test.describe('startBulkScan / stopBulkScan — no new issuance after abort (Witness 2)', () => {
  test('a job still sitting in the queue when stop fires is NEVER issued — only calls already in flight at stop time ever happen', async () => {
    // Counts REAL invocations of the mocked postScan — never bulkScansInFlight,
    // queue length, or any other pool-internal state, which could all agree
    // with each other while the underlying code is wrong.
    let calls = 0;
    const postScan = async (urlKey, id, source, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, stopBulkScan, BULK_SCAN_CONCURRENCY } = sandbox.module.exports;

    const N = 10;
    assert.ok(N > BULK_SCAN_CONCURRENCY, 'test needs a queue tail beyond the concurrency bound to be meaningful');
    let teardownFired = false;
    startBulkScan(items(N), { onTeardown: () => { teardownFired = true; } });
    await flush();

    assert.equal(calls, BULK_SCAN_CONCURRENCY, `expected exactly the concurrency-bound number of jobs issued before stop, got ${calls}`);
    assert.equal(teardownFired, false, 'must not have torn down yet — the run is still genuinely in flight');

    stopBulkScan();
    assert.equal(teardownFired, true, 'stop must tear down immediately (requirement 6), not wait for in-flight settlement');

    // Let the already-in-flight (now-aborted) calls actually settle, then
    // flush well past that. If the bug this witness exists to catch were
    // present, MORE calls would appear here as the remaining queued-but-
    // undequeued items got issued anyway.
    await flush(15);
    assert.equal(calls, BULK_SCAN_CONCURRENCY, `no NEW postScan call may happen after stop — expected calls to stay at ${BULK_SCAN_CONCURRENCY}, got ${calls}`);
  });

  test('the dequeue-but-not-yet-issued window: a stop triggered synchronously during the initial fan-out must still block the next slot in that SAME batch', async () => {
    // This is the exact structural window the placement of the stop check
    // exists to close, isolated from ordinary async timing: BULK_SCAN_CONCURRENCY
    // jobs are dequeued and issued in one synchronous walk of pumpBulkScans's
    // while loop (no `await` between them). Here the FIRST call to postScan
    // itself synchronously calls stopBulkScan() before returning — simulating
    // a stop that lands in the middle of that same synchronous fan-out. A
    // check placed INSIDE the loop, immediately before each dequeue, catches
    // this: the second slot is never shifted off the queue at all. A check
    // only at pump ENTRY would already have passed (stopped was false when
    // pumpBulkScans began) and would let the second slot issue anyway.
    let calls = 0;
    let stopBulkScanRef;
    const postScan = async () => {
      calls++;
      if (calls === 1) stopBulkScanRef();
      return new Promise(() => {}); // never resolves — only issuance count matters
    };
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, stopBulkScan, BULK_SCAN_CONCURRENCY } = sandbox.module.exports;
    stopBulkScanRef = stopBulkScan;
    assert.ok(BULK_SCAN_CONCURRENCY >= 2, 'this witness needs at least 2-wide concurrency to have a same-batch second slot to protect');

    startBulkScan(items(BULK_SCAN_CONCURRENCY * 2));
    await flush();

    assert.equal(calls, 1, `stop landing mid-fan-out must block every slot after the one already issuing — expected exactly 1 call, got ${calls}`);
  });

  test('an over-ceiling selection is refused before a single postScan call, never silently truncated', () => {
    let calls = 0;
    const sandbox = makeSandbox(async () => { calls++; return { ok: true }; });
    const { startBulkScan, BULK_SCAN_MAX_PER_RUN } = sandbox.module.exports;

    const res = startBulkScan(items(BULK_SCAN_MAX_PER_RUN + 1));

    assert.equal(res.refused, true);
    assert.equal(res.limit, BULK_SCAN_MAX_PER_RUN);
    assert.equal(res.requested, BULK_SCAN_MAX_PER_RUN + 1);
    assert.match(res.message, /run again for the rest/);
    assert.equal(calls, 0, 'a refused selection must enqueue and issue nothing at all');
  });
});

test.describe('startBulkScan — client-side abort-signal propagation (Witness 3)', () => {
  test('the shared AbortController fires and postScan receives that EXACT signal — proves client-side cancellation ONLY, not server-side', async () => {
    // Per the accepted abort gap: `generateScan` (lib/scan.js:191-200)
    // forwards no signal onward and the scan route wires no disconnect
    // handler, so an already-issued scan still completes server-side, bills
    // in full, writes an llm-call-log row, and can still raise a ruling.
    // This test proves ONLY that (a) the AbortController this pool owns
    // actually fires on stop, and (b) the exact same signal object is the
    // one threaded into postScan's `init` — never that the in-flight HTTP
    // call was cancelled on the server. It must not be read as such.
    let capturedSignal = null;
    const postScan = async (urlKey, id, source, { signal }) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves — only the signal identity/state matters
    };
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, stopBulkScan } = sandbox.module.exports;

    startBulkScan(items(1));
    await flush();

    assert.ok(capturedSignal, 'postScan must have been called with a signal in its init');
    assert.equal(capturedSignal.aborted, false, 'signal must not be aborted before stop is called');

    stopBulkScan();

    assert.equal(capturedSignal.aborted, true, 'the SAME signal object postScan received must flip to aborted');
  });
});

test.describe('startBulkScan — stop-then-restart isolation (beat 4 fix, cross-run corruption)', () => {
  test('a stopped run\'s stragglers settling AFTER a second run has started must not corrupt the second run\'s concurrency bound', async () => {
    // Found empirically in beat 4: run 1's queue/in-flight-counter/
    // AbortController used to be module-level (shared), so stopping run 1
    // and starting run 2 in the SAME synchronous turn (no await between them
    // — the realistic "click Stop, click Start again" shape) let run 1's
    // already-issued jobs' straggler settle-callbacks decrement run 2's
    // shared in-flight counter as microtasks, artificially freeing "slots"
    // run 2 never actually had and letting pumpBulkScans over-issue past
    // BULK_SCAN_CONCURRENCY. Reproduced directly against the pre-fix code:
    // run 2's observed peak in-flight was double the bound. Per-run closure
    // state (this beat's fix) makes that structurally impossible — a stale
    // run's own runOne()/pump() closures can only ever touch THEIR OWN
    // inFlight/queue, never a newer run's.
    let run1Calls = 0;
    const run1PostScan = async (urlKey, id, source, { signal }) => {
      run1Calls++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
    const sandbox = makeSandbox(run1PostScan);
    const { startBulkScan, stopBulkScan, BULK_SCAN_CONCURRENCY } = sandbox.module.exports;

    startBulkScan(items(3, 'run1-'));
    await flush();
    assert.equal(run1Calls, BULK_SCAN_CONCURRENCY, `run1 must have issued exactly ${BULK_SCAN_CONCURRENCY} calls before stop`);

    // Swap in run 2's mock, then stop run1 and start run2 BACK TO BACK,
    // synchronously — no await between them — so run1's abort-triggered
    // rejection microtasks are still pending when run2 begins pumping.
    let run2Calls = 0;
    let run2InFlight = 0;
    let run2Peak = 0;
    const run2PostScan = async () => {
      run2Calls++;
      run2InFlight++;
      run2Peak = Math.max(run2Peak, run2InFlight);
      return new Promise(() => {}); // never resolves — only peak/call count matter
    };
    sandbox.window.ScanSection.postScan = run2PostScan;

    stopBulkScan();
    startBulkScan(items(6, 'run2-'));

    await flush(15);

    // Strict equality, not `<=` — the same discipline Witness 1 states and
    // this witness originally failed to apply. A one-sided `<=` bound passes
    // vacuously at 0: a mutation making startBulkScan a no-op for every run
    // after the first (review mutation M7) issues nothing at all for run 2,
    // and `0 <= 2` held, so the whole suite stayed green while the witness
    // proved nothing about run 2. Equality is the honest assertion here and
    // is fully deterministic: run2PostScan returns a promise that never
    // settles, so run 2's in-flight count only ever climbs — it must reach
    // exactly the bound and stop there. This form kills BOTH the cross-run
    // corruption bug it was written for (peak 4 against the pre-beat-4 code)
    // and the no-op-run-2 mutation, while still failing on any overshoot.
    assert.equal(run2Peak, BULK_SCAN_CONCURRENCY, `run2's peak in-flight must reach exactly ${BULK_SCAN_CONCURRENCY} — never more (run1's stragglers must not free slots) and never less (run 2 must actually issue) — observed ${run2Peak}`);
    assert.equal(run2Calls, BULK_SCAN_CONCURRENCY, `run2 must have issued exactly ${BULK_SCAN_CONCURRENCY} calls: no settle ever frees a real slot here, so more means over-issuance and fewer means run 2 never ran, observed ${run2Calls}`);
  });
});

test.describe('startBulkScan — two live runs are unreachable (Witness 6, LIN-2700 hand-off)', () => {
  test('a second startBulkScan with no intervening stop is refused with reason: run-in-progress; global peak in-flight never exceeds BULK_SCAN_CONCURRENCY; stopBulkScan() still reaches the one live run', async () => {
    // The LIN-2700 hand-off reproduction: an unguarded startBulkScan lets a
    // second call overwrite the module-level bulkScanStop pointer, orphaning
    // run 1 (permanently unreachable from stopBulkScan()) while doubling
    // global in-flight past BULK_SCAN_CONCURRENCY (measured there as
    // `after run2: calls=4 peak=4`). The guard must be in startBulkScan
    // itself, not only a disabled button, so this calls it programmatically
    // exactly the way that reproduction did.
    let calls = 0;
    let inFlight = 0;
    let peak = 0;
    let capturedSignal = null;
    const postScan = async (urlKey, id, source, { signal }) => {
      calls++;
      inFlight++;
      peak = Math.max(peak, inFlight);
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          inFlight--;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    };
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, stopBulkScan, BULK_SCAN_CONCURRENCY } = sandbox.module.exports;

    const res1 = startBulkScan(items(6, 'run1-'));
    await flush();
    assert.equal(res1.refused, false, 'the first call must be admitted');
    assert.equal(calls, BULK_SCAN_CONCURRENCY, `run 1 must have issued exactly ${BULK_SCAN_CONCURRENCY} calls before a second start is attempted`);

    // No intervening stop — the exact "start, start again" shape the
    // hand-off found no guard for.
    const res2 = startBulkScan(items(6, 'run2-'));
    assert.equal(res2.refused, true, 'a second startBulkScan while a run is live must be refused');
    assert.equal(res2.reason, 'run-in-progress', 'the refusal must carry the distinct run-in-progress reason so the UI can branch on it');

    await flush(10);
    // Strict equality, not `<=` — tests/unit/settle-with-concurrency.test.js:80's
    // own stated rationale: `<=` passes trivially (even vacuously at 0), and
    // would not distinguish "the guard held" from "the pool stopped issuing
    // work altogether".
    assert.strictEqual(peak, BULK_SCAN_CONCURRENCY, `global peak in-flight must never exceed BULK_SCAN_CONCURRENCY (${BULK_SCAN_CONCURRENCY}) even though a second start was attempted — observed ${peak}`);
    assert.equal(calls, BULK_SCAN_CONCURRENCY, 'the refused second call must never issue a single postScan call of its own');

    // stopBulkScan() must still reach run 1 — the exact capability the
    // hand-off found broken ("run1 signal aborted = false" after a second,
    // unguarded start).
    assert.ok(capturedSignal, 'run 1 must have called postScan with a signal');
    assert.equal(capturedSignal.aborted, false, 'run 1\'s signal must not be aborted yet');
    stopBulkScan();
    assert.equal(capturedSignal.aborted, true, 'stopBulkScan() must still reach the one live run (run 1) and abort its signal');
    assert.equal(inFlight, 0, 'the abort must have settled every one of run 1\'s in-flight jobs');
  });
});

// ─── LIN-2701 §B.6 — classifyBulkScanResult (Session 2, beat 2) ────────────
//
// classifyBulkScanResult is presentation-only: it reads an already-settled
// pool entry ({item, outcome, value|error}) and never mutates the selection,
// re-enqueues, or feeds back into the pool. These witnesses drive real
// entries through the real pool (Witnesses 1/2) or the store's real
// recordScan (Witness 3), never a hand-built guess at either shape.

test.describe('classifyBulkScanResult — skipped quota, fast 429 + its global-hourly variant (Witness 1)', () => {
  test('a fast 429 throw classifies as skipped-quota; every row after the first also 429s and the batch still settles every remaining row rather than aborting', async () => {
    const N = 4; // > BULK_SCAN_CONCURRENCY, so this proves the pool keeps pumping past the first 429, not just tolerating one
    let calls = 0;
    const postScan = async () => {
      calls++;
      const err = new Error('Free tier daily limit reached');
      err.status = 429;
      err.body = { freeTier: { used: true, remaining: 0, limit: 20, resetsAt: '2026-09-07T00:00:00.000Z' } };
      throw err;
    };
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, classifyBulkScanResult, BULK_SCAN_CONCURRENCY } = sandbox.module.exports;
    assert.ok(N > BULK_SCAN_CONCURRENCY, 'test needs a queue tail beyond the concurrency bound to be meaningful');

    let teardownResults = null;
    const res = startBulkScan(items(N), { onTeardown: (results) => { teardownResults = results; } });
    assert.equal(res.refused, false);
    await flush(10);

    assert.ok(teardownResults, 'a 429 must never set the pool-wide stop flag — the batch must reach ordinary teardown, not abort early');
    assert.equal(teardownResults.length, N, `every row must settle — the global-hourly variant where every row after the first also 429s must still settle all ${N}, got ${teardownResults.length}`);
    assert.equal(calls, N, 'every row must actually have been attempted, not short-circuited after the first 429');
    for (const entry of teardownResults) {
      assert.equal(entry.outcome, 'rate-limited');
      assert.equal(classifyBulkScanResult(entry), 'skipped-quota');
    }
  });
});

test.describe('classifyBulkScanResult — flushed scan failure (Witness 2)', () => {
  test('a resolved 200 body carrying a statusCode field classifies as scan-failed, never zero-finding — the shape an "obvious" rejecting-stub test would miss entirely', async () => {
    // Representative of the reachable flushed statuses (404/422/500/502/503/401,
    // per routes/workspace-api.js) — armKeepalive grafts `statusCode` onto the
    // route's OWN successful-shaped body when the flush already committed 200.
    const flushedBody = {
      status: 'fresh',
      id: 'scan_11111111_aaaaaaaaaaaa',
      issueId: '11111111-2222-3333-4444-555555555555',
      decision: null,
      scannedAt: '2026-09-06T00:00:00.000Z',
      outcome: null,
      outcomeAt: null,
      model: 'openai/gpt-5.4-mini',
      statusCode: 503
    };
    const postScan = async () => flushedBody;
    const sandbox = makeSandbox(postScan);
    const { startBulkScan, classifyBulkScanResult } = sandbox.module.exports;

    let teardownResults = null;
    startBulkScan(items(1), { onTeardown: (results) => { teardownResults = results; } });
    await flush();

    assert.ok(teardownResults);
    assert.equal(teardownResults.length, 1);
    const entry = teardownResults[0];
    assert.equal(entry.outcome, 'fulfilled', 'a flushed body still resolves the fetch — window.api only throws on !response.ok');
    assert.equal(classifyBulkScanResult(entry), 'scan-failed', 'a flushed statusCode-bearing 200 body must classify as scan failed');
    assert.notEqual(classifyBulkScanResult(entry), 'zero-finding', 'it must never fall through to zero-finding');
  });
});

// Mirrors tests/unit/task-decisions-store.test.js's own mock collection and
// fixtures (createMockCollection/sampleDecision/ISSUE_ID/HASH_A there are
// file-local, not exported, so this reconstructs the SAME shape and values
// rather than inventing a divergent one) — driving classifyBulkScanResult
// against the store's REAL recordScan output, not a hand-rolled guess at it.
function createMockDecisionsCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        return { matchedCount: 1, modifiedCount: 1, upsertedId: null };
      }
      if (opts.upsert) {
        const doc = { ...(update.$set || {}) };
        docs.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedId: doc._id };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
    }
  };
}

const DECISIONS_URL_KEY = 'ws1';
const DECISIONS_ISSUE_ID = '11111111-2222-3333-4444-555555555555';
const DECISIONS_HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function sampleDecision(overrides = {}) {
  return {
    decision_id: 'scan_11111111_aaaaaaaaaaaa',
    question: 'Which auth strategy should this use?',
    options: [{ id: 'a', label: 'OAuth' }, { id: 'b', label: 'API key' }],
    free_text: false,
    ...overrides
  };
}

test.describe('classifyBulkScanResult — decision / zero-finding / terminal-row, driven through the store\'s real recordScan (Witness 3)', () => {
  test('a new decision classifies as new-decision', async () => {
    const collection = createMockDecisionsCollection();
    const store = new TaskDecisionsStore({ collection });
    const record = await store.recordScan({
      urlKey: DECISIONS_URL_KEY, issueId: DECISIONS_ISSUE_ID, inputHash: DECISIONS_HASH_A,
      decision: sampleDecision()
    });

    const sandbox = makeSandbox(async () => ({}));
    const { classifyBulkScanResult } = sandbox.module.exports;
    const entry = { item: { identifier: DECISIONS_ISSUE_ID }, outcome: 'fulfilled', value: record };
    assert.equal(classifyBulkScanResult(entry), 'new-decision');
  });

  test('a zero-finding scan (decision: null, no statusCode) classifies as zero-finding', async () => {
    const collection = createMockDecisionsCollection();
    const store = new TaskDecisionsStore({ collection });
    const record = await store.recordScan({
      urlKey: DECISIONS_URL_KEY, issueId: DECISIONS_ISSUE_ID, inputHash: DECISIONS_HASH_A,
      decision: null
    });
    assert.equal(record.decision, null);

    const sandbox = makeSandbox(async () => ({}));
    const { classifyBulkScanResult } = sandbox.module.exports;
    const entry = { item: { identifier: DECISIONS_ISSUE_ID }, outcome: 'fulfilled', value: record };
    assert.equal(classifyBulkScanResult(entry), 'zero-finding');
  });

  test('a statusCode-bearing body is never routed to zero-finding even when decision is absent', async () => {
    const collection = createMockDecisionsCollection();
    const store = new TaskDecisionsStore({ collection });
    const record = await store.recordScan({
      urlKey: DECISIONS_URL_KEY, issueId: DECISIONS_ISSUE_ID, inputHash: DECISIONS_HASH_A,
      decision: null
    });
    // Simulate armKeepalive's flushed-error graft (lib/http-keepalive.js:43)
    // landing on an otherwise zero-finding-shaped body — the exact case the
    // ticket calls out as the one an "obvious" classifier would miss.
    const flushedValue = { ...record, statusCode: 503 };

    const sandbox = makeSandbox(async () => ({}));
    const { classifyBulkScanResult } = sandbox.module.exports;
    const entry = { item: { identifier: DECISIONS_ISSUE_ID }, outcome: 'fulfilled', value: flushedValue };
    assert.equal(classifyBulkScanResult(entry), 'scan-failed');
    assert.notEqual(classifyBulkScanResult(entry), 'zero-finding');
  });

  test('recordScan at an existing outcome-stamped id (the terminal-row fixture, tests/unit/task-decisions-store.test.js:182) classifies as terminal-row-no-op', async () => {
    const collection = createMockDecisionsCollection();
    const store = new TaskDecisionsStore({ collection });
    await store.recordScan({
      urlKey: DECISIONS_URL_KEY, issueId: DECISIONS_ISSUE_ID, inputHash: DECISIONS_HASH_A,
      decision: sampleDecision({ question: 'original' })
    });
    // Seed a terminal outcome directly onto that row (mirrors the cited
    // fixture exactly — markOutcome itself is a later phase's job).
    const _id = TaskDecisionsStore.buildId(DECISIONS_ISSUE_ID, DECISIONS_HASH_A);
    const stamped = collection._docs.find(d => d._id === _id);
    stamped.outcome = 'dismissed';
    stamped.outcomeAt = new Date('2026-08-20T00:00:00.000Z');

    const record = await store.recordScan({
      urlKey: DECISIONS_URL_KEY, issueId: DECISIONS_ISSUE_ID, inputHash: DECISIONS_HASH_A,
      decision: sampleDecision({ question: 'a fresh LLM result for the SAME unchanged content' })
    });
    // Do NOT assert byte-identical rows — the terminal branch may patch
    // dueBasisHash/dueBasisVersion (lib/task-decisions-store.js:186-199);
    // `value.outcome != null` is the exact signal, not row equality.
    assert.equal(record.outcome, 'dismissed');
    assert.equal(record.decision.question, 'original'); // the new result was discarded

    const sandbox = makeSandbox(async () => ({}));
    const { classifyBulkScanResult } = sandbox.module.exports;
    const entry = { item: { identifier: DECISIONS_ISSUE_ID }, outcome: 'fulfilled', value: record };
    assert.equal(classifyBulkScanResult(entry), 'terminal-row-no-op');
  });
});
