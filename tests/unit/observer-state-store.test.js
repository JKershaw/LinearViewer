/**
 * Unit tests for lib/observer-state-store.js (LIN-2129, P1-2).
 *
 * Run with: node --test tests/unit/observer-state-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent: tests/unit/owner-credential-store.test.js)
 * — this store's entire claim is CAS correctness under concurrency, so a mock
 * collection (atomic by construction, see tests/fixtures/mock-collection.js's
 * own header) would just encode the assumption instead of testing it. It also
 * doesn't support `$setOnInsert` on upsert, which `ensureSeeded` depends on.
 *
 * Every concurrency assertion below reads the STORED DOCUMENT back, never a
 * writer's own return value or a bare count — a return-value-only check is
 * exactly what MangoDB's per-collection mutex makes trivially green regardless
 * of whether the CAS filter is correct (LIN-1343's own lesson).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { ObserverStateStore, LEDGER_CAP, RETENTION_IDLE_MS } from '../../lib/observer-state-store.js';

describe('observer-state-store', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'observer-state-store-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`oss_${counter++}`);
    return new ObserverStateStore({ collection: db.collection('observer-state') });
  }

  // ---------------------------------------------------------------------
  // Foundations: seeding and reads
  // ---------------------------------------------------------------------

  // OS1
  test('ensureSeeded creates rev 1 and is idempotent — a second call never touches an existing document', async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;

    const first = await store.ensureSeeded(key, { phase: 'idle' });
    assert.strictEqual(first.rev, 1);
    assert.deepStrictEqual(first.state, { phase: 'idle' });
    assert.deepStrictEqual(first.ledger, []);
    assert.ok(first.createdAt instanceof Date);
    assert.ok(first.updatedAt instanceof Date);

    const second = await store.ensureSeeded(key, { phase: 'SHOULD NOT APPLY' });
    assert.strictEqual(second.rev, 1, '$setOnInsert must not touch an existing document');
    assert.deepStrictEqual(second.state, { phase: 'idle' }, 'the original seed must survive a repeat ensureSeeded call');

    const all = await store.collection.find({ _id: key }).toArray();
    assert.strictEqual(all.length, 1, 'exactly one document must exist for this instance');
  });

  // OS2
  test('readCurrent returns null for a missing instance; bad-argument guards on advance/ensureSeeded fail safe with no write', async () => {
    const store = freshStore();
    assert.strictEqual(await store.readCurrent('does-not-exist'), null);
    assert.strictEqual(await store.readCurrent(null), null);

    assert.strictEqual(await store.ensureSeeded(null, { x: 1 }), null);
    assert.strictEqual(await store.ensureSeeded('k', undefined), null);

    assert.strictEqual(await store.advance(null, 1, {}), false);
    assert.strictEqual(await store.advance('k', 1.5, {}), false, 'a non-integer rev is a bad argument');
    assert.strictEqual(await store.advance('k', undefined, {}), false);
    assert.strictEqual(await store.advance('k', 1, undefined), false);
  });

  // OS3
  test('advance on a never-seeded instance returns false and creates nothing (no upsert on the CAS path)', async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;

    const result = await store.advance(key, 1, { phase: 'working' });
    assert.strictEqual(result, false);
    assert.strictEqual(await store.readCurrent(key), null, 'advance() must never resurrect/create a record');
  });

  // ---------------------------------------------------------------------
  // 1. Stale-witness rejection with persisted-winner verification
  // ---------------------------------------------------------------------

  // OS4
  test('a stale writer is rejected AND the winner\'s stored document is intact afterwards', async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;
    await store.ensureSeeded(key, { phase: 'idle' });

    const won = await store.advance(key, 1, { phase: 'winner' }, { source: 'writer-A' });
    assert.strictEqual(won, true);

    // The loser still holds the ORIGINAL witness (rev 1) and a distinct payload.
    const lost = await store.advance(key, 1, { phase: 'loser' }, { source: 'writer-B' });
    assert.strictEqual(lost, false, 'the loser must not win the CAS');

    // Assert the STORED document, never the writer's own return value —
    // rejecting the loser but corrupting the winner would still pass a
    // return-value-only test.
    const current = await store.readCurrent(key);
    assert.strictEqual(current.rev, 2, 'only the winner\'s advance is reflected in rev');
    assert.deepStrictEqual(current.state, { phase: 'winner' }, 'the winner\'s payload must be intact');
    assert.strictEqual(current.ledger.length, 1, 'the loser must not have appended a ledger entry');
    assert.strictEqual(current.ledger[0].source, 'writer-A');
  });

  // ---------------------------------------------------------------------
  // 2. Legitimate later advancement (the LIN-1357 false-green guard: a
  //    single contested write would pass even for a witness that burns
  //    permanently — this proves a FRESH witness still wins its own election)
  // ---------------------------------------------------------------------

  // OS5
  test('a legitimate later writer holding the fresh rev still wins its own election', async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;
    await store.ensureSeeded(key, { phase: 'idle' });

    const first = await store.advance(key, 1, { phase: 'a' });
    assert.strictEqual(first, true);
    const afterFirst = await store.readCurrent(key);
    assert.strictEqual(afterFirst.rev, 2);

    // An INDEPENDENT second call holding the fresh rev, not a repeat of the
    // same stale rev — the witness must not be a burn-once flag.
    const second = await store.advance(key, 2, { phase: 'b' });
    assert.strictEqual(second, true);

    const current = await store.readCurrent(key);
    assert.strictEqual(current.rev, 3);
    assert.deepStrictEqual(current.state, { phase: 'b' });
    assert.strictEqual(current.ledger.length, 2);
  });

  // ---------------------------------------------------------------------
  // 3. N-way contention: exactly one winner, rev advances by 1 not N
  // ---------------------------------------------------------------------

  // OS6
  test('N concurrent writers on one witness: exactly one wins, and rev advances by exactly 1, not N', async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;
    await store.ensureSeeded(key, { phase: 'idle' });

    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => store.advance(key, 1, { phase: `racer-${i}` }, { racer: i }))
    );

    const winners = results.filter((r) => r === true);
    const losers = results.filter((r) => r === false);
    assert.strictEqual(winners.length, 1, 'exactly one concurrent advance() call should win');
    assert.strictEqual(losers.length, N - 1, 'every other call must get a distinguishable false, never a throw');

    const current = await store.readCurrent(key);
    assert.strictEqual(current.rev, 2, 'rev must land at expectedRev + 1, never expectedRev + N');
    assert.strictEqual(current.ledger.length, 1, 'only the single winning transition is recorded');
    assert.match(current.state.phase, /^racer-\d+$/, 'the stored state belongs to whichever racer actually won');
  });

  // ---------------------------------------------------------------------
  // 4. The three-way matchedCount === 0 disambiguation
  // ---------------------------------------------------------------------

  describe('the three-way matchedCount === 0 disambiguation (stale rev / identical state / never seeded)', () => {
    // OS7a
    test('never seeded -> false, and no document is created', async () => {
      const store = freshStore();
      const key = `inst-${randomUUID()}`;
      assert.strictEqual(await store.advance(key, 1, { x: 1 }), false);
      assert.strictEqual(await store.readCurrent(key), null);
    });

    // OS7b
    test('stale rev with a DIFFERENT next state -> false, winner\'s document untouched', async () => {
      const store = freshStore();
      const key = `inst-${randomUUID()}`;
      await store.ensureSeeded(key, { x: 0 });
      await store.advance(key, 1, { x: 1 }); // winner advances to rev 2

      const stale = await store.advance(key, 1, { x: 'stale-different' });
      assert.strictEqual(stale, false);

      const current = await store.readCurrent(key);
      assert.strictEqual(current.rev, 2);
      assert.deepStrictEqual(current.state, { x: 1 });
    });

    // OS7c — the awkward case the hold specifically named
    test('a stale writer submitting a state IDENTICAL to what is currently stored still gets false, never mistaken for a win', async () => {
      const store = freshStore();
      const key = `inst-${randomUUID()}`;
      await store.ensureSeeded(key, { x: 0 });
      await store.advance(key, 1, { x: 1 }); // winner advances to rev 2, state now {x:1}

      // A stale writer, still holding rev 1, happens to submit {x:1} — byte-
      // identical to what is NOW stored, but it never observed that write.
      // The classification must key off rev, not merely hash equality:
      // current.rev (2) !== expectedRev (1) must win the branch regardless
      // of what the stale caller's payload hashes to.
      const stale = await store.advance(key, 1, { x: 1 });
      assert.strictEqual(stale, false, 'a stale rev must never be reclassified as a duplicate no-op just because the payload happens to match');

      const current = await store.readCurrent(key);
      assert.strictEqual(current.rev, 2, 'no phantom advance occurred');
      assert.strictEqual(current.ledger.length, 1, 'the stale call must not have appended a second ledger entry');
    });

    // OS7d
    test('correct rev + identical state -> true, a genuine no-op (no rev bump, no ledger growth)', async () => {
      const store = freshStore();
      const key = `inst-${randomUUID()}`;
      await store.ensureSeeded(key, { x: 0 });
      await store.advance(key, 1, { x: 1 }, { tag: 'first' }); // rev now 2

      const dup = await store.advance(key, 2, { x: 1 }, { tag: 'resubmit' });
      assert.strictEqual(dup, true, 'an identical-state write at the CURRENT rev must be a successful no-op');

      const current = await store.readCurrent(key);
      assert.strictEqual(current.rev, 2, 'a duplicate no-op must not consume a rev');
      assert.strictEqual(current.ledger.length, 1, 'a duplicate no-op must not append a ledger entry');
      assert.strictEqual(current.ledger[0].tag, 'first', 'the ORIGINAL transition meta survives; the resubmission never landed');
    });

    // OS7e — the TOCTOU window named in the hold, made concrete rather than
    // asserted away. advance()'s disambiguation read happens strictly AFTER
    // the CAS write has already failed to match (matchedCount 0) — it makes
    // no further write itself. This deterministically reproduces "another
    // writer genuinely advances the instance in the gap between the failed
    // CAS and the disambiguation read" and proves the answer stays
    // defensible: the window can only ever narrow a false into a true (if
    // NOTHING has changed by the time the read runs) or leave it false (if
    // something has) — never flip a genuine loss into a false "you won".
    test('TOCTOU: a real write landing between the failed CAS and the disambiguation read never gets mistaken for this caller\'s own success', async () => {
      const store = freshStore();
      const key = `inst-${randomUUID()}`;
      await store.ensureSeeded(key, { phase: 'idle' });

      const rawCollection = store.collection;
      let interceptOnce = true;
      const racyCollection = {
        updateOne: (...args) => rawCollection.updateOne(...args),
        findOne: async (...args) => {
          if (interceptOnce) {
            interceptOnce = false;
            // A genuinely separate, later writer advances the SAME instance
            // for real, landing in the exact window between this call's
            // failed CAS and its disambiguation read.
            const raced = await store.advance(key, 1, { phase: 'raced-in' });
            assert.strictEqual(raced, true, 'the interceptor\'s own advance must genuinely land for this to be a real race, not a no-op');
          }
          return rawCollection.findOne(...args);
        },
        deleteMany: (...args) => rawCollection.deleteMany(...args)
      };
      const racedStore = new ObserverStateStore({ collection: racyCollection });

      // Resubmits the ORIGINAL seeded state at the ORIGINAL rev — at the
      // instant its own CAS runs, this would be a legitimate duplicate-state
      // no-op (nothing has changed yet). The interceptor then lets a real
      // writer land before the disambiguation read executes.
      const result = await racedStore.advance(key, 1, { phase: 'idle' });

      const current = await store.readCurrent(key);
      assert.strictEqual(current.state.phase, 'raced-in', 'the real racer\'s write is the one that must be stored');
      assert.strictEqual(current.rev, 2, 'exactly one real advance happened');

      // The load-bearing assertion: this caller must NEVER be told it won a
      // race that actually belongs to the other writer.
      assert.strictEqual(
        result,
        false,
        'once a real write has landed ahead of the disambiguation read, this call must report false (re-read and converge), never a phantom true'
      );
    });
  });

  // ---------------------------------------------------------------------
  // 5. Duplicate/idempotent writes do not consume capacity
  // ---------------------------------------------------------------------

  // OS8
  test('repeated identical-state advances never grow the ledger or bump rev', async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;
    await store.ensureSeeded(key, { phase: 'steady' });
    await store.advance(key, 1, { phase: 'working' }); // rev 2, ledger length 1

    for (let i = 0; i < 10; i++) {
      const dup = await store.advance(key, 2, { phase: 'working' });
      assert.strictEqual(dup, true, `duplicate resubmission ${i} must be a no-op success`);
    }

    const current = await store.readCurrent(key);
    assert.strictEqual(current.rev, 2, '10 duplicate resubmissions must not consume 10 rev slots');
    assert.strictEqual(current.ledger.length, 1, '10 duplicate resubmissions must not grow the ledger at all');
  });

  // ---------------------------------------------------------------------
  // 6. Bounded-ledger survivor identity
  // ---------------------------------------------------------------------

  // OS9
  test(`after LEDGER_CAP (${LEDGER_CAP}) + 5 real transitions, the ledger holds exactly the newest ${LEDGER_CAP} entries by rev`, async () => {
    const store = freshStore();
    const key = `inst-${randomUUID()}`;
    await store.ensureSeeded(key, { tick: 0 });

    const total = LEDGER_CAP + 5;
    for (let i = 1; i <= total; i++) {
      const ok = await store.advance(key, i, { tick: i });
      assert.strictEqual(ok, true, `transition ${i} must win — each call holds the immediately-preceding rev`);
    }

    const current = await store.readCurrent(key);
    assert.strictEqual(current.rev, total + 1);
    assert.strictEqual(current.ledger.length, LEDGER_CAP, 'ledger must be capped at LEDGER_CAP, not merely bounded loosely');

    // The surviving entries must be the newest LEDGER_CAP by rev — oldest
    // evicted first — never merely "the count is capped".
    const survivorRevs = current.ledger.map((e) => e.rev);
    const expectedRevs = Array.from({ length: LEDGER_CAP }, (_, i) => total + 2 - LEDGER_CAP + i);
    assert.deepStrictEqual(survivorRevs, expectedRevs, 'the surviving ledger entries must be exactly the newest LEDGER_CAP transitions, in order');
  });

  // ---------------------------------------------------------------------
  // 7. cleanup() eviction
  // ---------------------------------------------------------------------

  // OS10
  test('cleanup() evicts only instances idle past RETENTION_IDLE_MS, preserving active ones', async () => {
    const store = freshStore();
    const staleKey = `inst-stale-${randomUUID()}`;
    const freshKey = `inst-fresh-${randomUUID()}`;
    await store.ensureSeeded(staleKey, { phase: 'decommissioned' });
    await store.ensureSeeded(freshKey, { phase: 'active' });

    // Nothing is stale yet.
    assert.strictEqual(await store.cleanup(), 0);
    assert.ok(await store.readCurrent(staleKey));
    assert.ok(await store.readCurrent(freshKey));

    // Force the stale instance's updatedAt to just past the retention
    // window; the fresh one stays untouched.
    const pastCutoff = new Date(Date.now() - RETENTION_IDLE_MS - 1000);
    await store.collection.updateOne({ _id: staleKey }, { $set: { updatedAt: pastCutoff } });

    const removed = await store.cleanup();
    assert.strictEqual(removed, 1, 'exactly the one stale instance must be removed');
    assert.strictEqual(await store.readCurrent(staleKey), null, 'the stale instance must be gone');
    assert.ok(await store.readCurrent(freshKey), 'the active instance must survive cleanup untouched');
  });

  // ---------------------------------------------------------------------
  // 8. The MangoDB negative control (misleading-proxy guard)
  // ---------------------------------------------------------------------

  describe('MangoDB negative control — the misleading-proxy guard the whole plan hinges on', () => {
    // OS11
    test(
      'a naive read-modify-write (no CAS filter) LOSES concurrent writes on this SAME real MangoDB tmpdir — unlike advance(), which does not',
      async () => {
        // This is deliberately NOT ObserverStateStore.advance() — it is the
        // REJECTED alternative (LIN-1343's addFeedback shape): read the
        // current rev in JS, then write unconditionally with rev+1 and no
        // filter on rev at all.
        //
        // Why this test exists: MangoDB's per-collection mutex serializes
        // exactly ONE ENGINE OPERATION (one findOne, one updateOne) at a
        // time. It does NOT serialize a caller's separate read-then-write
        // sequence — two concurrent callers can each complete their OWN
        // findOne before either one's updateOne runs, both compute the SAME
        // "next rev", and the second writer's unconditional updateOne
        // silently clobbers the first's payload. If this test were absent, a
        // reader could look at OS6 (N-way, all green, no throws) and
        // mistake "the write path completed without error under
        // concurrency" for proof of CAS correctness — exactly the trap the
        // plan's research names: MangoDB's mutex makes races that are live
        // in production MongoDB pass trivially there. This test proves the
        // trap is real on this exact engine, so OS6's green result means
        // something.
        const store = freshStore();
        const key = `inst-${randomUUID()}`;
        await store.collection.insertOne({ _id: key, rev: 1, state: { tick: 0 }, ledger: [], updatedAt: new Date() });

        async function naiveAdvance(nextTick) {
          const before = await store.collection.findOne({ _id: key });
          // A little real JS-side work between read and write, matching how
          // an actual caller would compute its next payload — this is what
          // widens the window a single-op CAS closes.
          await new Promise((resolve) => setTimeout(resolve, 0));
          await store.collection.updateOne(
            { _id: key },
            { $set: { state: { tick: nextTick }, rev: before.rev + 1, updatedAt: new Date() } }
          );
        }

        const N = 20;
        await Promise.all(Array.from({ length: N }, (_, i) => naiveAdvance(i + 1)));

        const final = await store.collection.findOne({ _id: key });
        assert.ok(
          final.rev < 1 + N,
          `naive read-modify-write must lose at least one of ${N} concurrent writes on real MangoDB (final rev ${final.rev}, lossless would be ${1 + N}) — ` +
            'if this ever reads 1+N, MangoDB\'s concurrency model changed and this negative control needs re-examination, not deletion'
        );
      }
    );
  });
});
