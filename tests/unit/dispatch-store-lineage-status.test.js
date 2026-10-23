/**
 * LIN-3812 — write-time persistence of the lineage list fields
 * (`lineageStatus` / `lineageCompletedAt` / `lineageFeedbackCount`, lib/dispatch-lineage-status.js).
 *
 * Real MangoDB tmpdir, not the mock: the fan-out is `updateMany` with `$lte`/`$ne`/`null`
 * filters, the closers use `$nin`, and the races are about real compare-and-set semantics.
 *
 * The oracle is the derivation the list used to run on every read (`resolveListRows`,
 * routes/proxy-dispatch.js before LIN-3812), copied here verbatim and run over the WHOLE
 * workspace in one batch (no window, no cap). Every corpus case asserts the persisted
 * fields equal it.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { deriveCompletedAt, deriveWireStatus, feedbackWithHarvestedAbort, harvestAbortedTargets, mergeLineageFeedback } from '../../lib/dispatch-terminal.js';
import { isLineageFresh, recomputeLineageRows } from '../../lib/dispatch-lineage-status.js';

const URL_KEY = 'acme';
const TOKEN = 'consumer-1';
const tick = (ms = 4) => new Promise(resolve => setTimeout(resolve, ms));

// --- the oracle: the pre-LIN-3812 list derivation, verbatim -----------------------------
const anchorFor = item => item.rootItemId ?? item.feedback?.find(f => f.rootItemId)?.rootItemId ?? item.id;
function resolveListRows(merged, siblingsByAnchor) {
  const abortedTargets = harvestAbortedTargets(merged);
  return merged.map(i => {
    const joinsLineage = i.status === 'taken';
    const anchor = joinsLineage ? anchorFor(i) : null;
    const siblingRows = anchor ? (siblingsByAnchor.get(anchor) || []).filter(s => s.id !== i.id) : [];
    const lineageFeedback = joinsLineage ? mergeLineageFeedback(i.feedback, siblingRows, anchor, i.dispatchedAt) : (i.feedback || []);
    const terminalFeedback = feedbackWithHarvestedAbort(lineageFeedback, abortedTargets.get(i.id));
    return { ...i, _lineageFeedback: lineageFeedback, _terminalFeedback: terminalFeedback, status: deriveWireStatus({ feedback: terminalFeedback, bookkeeping: i.bookkeeping }) || i.status };
  });
}

describe('lineage list fields persisted at write time (real MangoDB tmpdir, LIN-3812)', () => {
  let dbDir, client, store, history, queue;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-lineage-status-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    const db = client.db(`lineage_${counter++}`);
    history = db.collection('dispatch-history');
    queue = db.collection('dispatch-queue');
    store = new DispatchQueueStore({ collection: queue, historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  /** Dispatch + take one row (a runner session). */
  async function run(extra = {}) {
    const doc = await store.addItem(URL_KEY, { prompt: 'p', issueIdentifier: 'LIN-1', ...extra });
    await store.takeItem(doc._id, URL_KEY, TOKEN);
    return doc._id;
  }
  const post = (id, message, rootItemId) => store.addFeedback(id, URL_KEY, { message, ...(rootItemId ? { rootItemId } : {}) }, TOKEN);

  /** The oracle over the whole workspace, as the old list read it (queued first, then history newest first). */
  async function oracle() {
    const queued = (await queue.find({ urlKey: URL_KEY }).toArray()).map(d => ({ ...store._formatItem(d), status: 'queued', feedback: [] }));
    const rows = (await history.find({ urlKey: URL_KEY }).sort({ resolvedAt: -1 }).toArray()).map(d => store._formatHistoryItem(d));
    const byAnchor = new Map();
    for (const r of rows) if (r.rootItemId) byAnchor.set(r.rootItemId, [...(byAnchor.get(r.rootItemId) || []), r]);
    return new Map(resolveListRows([...queued, ...rows], byAnchor).map(r => [r.id, r]));
  }
  const persisted = async (id) => history.findOne({ _id: id });

  /**
   * Every history row's PERSISTED fields (no read-time heal) equal the oracle, and are fresh.
   * `fresh: false` for a row that has received a sibling's fan-out or a closer: those bump
   * `lineageBasis` by design (so a racing recompute loses its CAS), leave the row's values
   * correct, and mark it for one cheap re-derive on its next read.
   */
  async function assertPersistedMatchesOracle(label = '', { except = [], fresh = true } = {}) {
    const expected = await oracle();
    for (const doc of await history.find({ urlKey: URL_KEY }).toArray()) {
      if (except.includes(doc._id)) continue;
      const want = expected.get(doc._id);
      const at = `${label} ${doc._id}`;
      assert.equal(doc.lineageStatus ?? null, deriveWireStatus({ feedback: want._terminalFeedback, bookkeeping: want.bookkeeping }) || null, `${at}: status`);
      assert.equal(doc.lineageStatus ?? doc.status, want.status, `${at}: reported status`);
      assert.equal(doc.lineageFeedbackCount, want._lineageFeedback.length, `${at}: feedbackCount`);
      assert.equal(doc.lineageCompletedAt?.toISOString?.() ?? doc.lineageCompletedAt ?? null, deriveCompletedAt(want._terminalFeedback), `${at}: completedAt`);
      if (fresh) assert.ok(isLineageFresh(doc), `${at}: fresh (basis ${doc.lineageBasis} vs status basis ${doc.lineageStatusBasis})`);
    }
  }

  describe('corpus: persisted fields equal the whole-workspace derivation', () => {
    test('headline repoint: the original reflects its follow-up\'s [done]; own untagged entries count once', async () => {
      const root = await run();
      await post(root, 'beat', root);
      await post(root, 'untagged heartbeat');
      await tick();
      const child = await run({ followUpTo: root, rootItemId: root });
      await tick();
      await post(child, '[done] finished', root);
      await assertPersistedMatchesOracle('headline');
      assert.equal((await persisted(root)).lineageStatus, 'done');
      assert.equal((await persisted(root)).lineageFeedbackCount, 3);
    });

    test('modern root (rootItemId === _id) + follow-up heartbeats: the root moves by exactly 1 per entry (R1)', async () => {
      const root = await run();
      assert.equal((await persisted(root)).rootItemId, root, 'precondition: a modern root carries its own id');
      await tick();
      const child = await run({ followUpTo: root, rootItemId: root });
      await tick();
      for (let i = 1; i <= 3; i++) {
        await post(child, `beat ${i}`, root);
        assert.equal((await persisted(root)).lineageFeedbackCount, i, `root count after ${i} follow-up entries`);
        assert.equal((await persisted(child)).lineageFeedbackCount, i, 'the follow-up counts its own entries once');
      }
      await post(root, 'root beat', root);
      assert.equal((await persisted(root)).lineageFeedbackCount, 4);
      await assertPersistedMatchesOracle('modern-root', { fresh: false });
      assert.ok(!isLineageFresh(await persisted(root)), 'the fan-out marked the root for a re-derive');
      await store.listHistoryLineageRows(URL_KEY, { limit: 10 });
      await assertPersistedMatchesOracle('modern-root-healed');
    });

    test('legacy root (no doc-level rootItemId, anchor = own id) is reached by the second fan-out statement', async () => {
      const t0 = new Date('2026-08-01T00:00:00.000Z');
      await history.insertOne({ _id: 'legacy-root', urlKey: URL_KEY, status: 'taken', issueIdentifier: 'LIN-1', dispatchedAt: t0, resolvedAt: t0, feedback: [], bookkeeping: null, takenByTokenLabel: TOKEN, takenByTokenId: null });
      await history.insertOne({ _id: 'kid', urlKey: URL_KEY, status: 'taken', issueIdentifier: 'LIN-1', rootItemId: 'legacy-root', dispatchedAt: new Date(t0.getTime() + 1000), resolvedAt: new Date(t0.getTime() + 1000), feedback: [], bookkeeping: null, takenByTokenLabel: TOKEN, takenByTokenId: null });
      await recomputeLineageRows(history, URL_KEY, ['legacy-root', 'kid']);
      await post('kid', '[done] kid finished', 'legacy-root');
      const root = await persisted('legacy-root');
      assert.equal(root.lineageStatus, 'done');
      assert.equal(root.lineageFeedbackCount, 1);
      await assertPersistedMatchesOracle('legacy-root');
    });

    test('forward-only: a follow-up dispatched AFTER its parent finished does not inherit the parent\'s terminal', async () => {
      const root = await run();
      await post(root, '[done] parent finished', root);
      await tick();
      const child = await run({ followUpTo: root, rootItemId: root });
      const row = await persisted(child);
      assert.equal(row.lineageStatus, null);
      assert.equal(row.lineageFeedbackCount, 0);
      assert.equal(row.lineageCompletedAt, null);
      await assertPersistedMatchesOracle('forward-only');
    });

    test('the fan-out is forward-only: a taken sibling dispatched AFTER the entry is not counted (dispatchedAt $lte entry)', async () => {
      const root = await run();
      const future = new Date(Date.now() + 3600 * 1000);
      await history.insertOne({ _id: 'late', urlKey: URL_KEY, status: 'taken', issueIdentifier: 'LIN-1', rootItemId: root, dispatchedAt: future, resolvedAt: future, feedback: [], bookkeeping: null, lineageStatus: null, lineageCompletedAt: null, lineageFeedbackCount: 0, lineageBasis: 0, lineageStatusBasis: 0 });
      await post(root, '[done] finished', root);
      const late = await persisted('late');
      assert.equal(late.lineageFeedbackCount, 0, 'not counted: the entry predates the row\'s dispatch');
      assert.equal(late.lineageStatus, null, 'and the recompute (forward-only) leaves it running');
      assert.equal(late.lineageBasis, 0, 'its basis was not bumped either');
      assert.equal((await persisted(root)).lineageStatus, 'done');
    });

    test('cancelled / expired follow-ups never inherit a sibling\'s terminal (LIN-1470 F1)', async () => {
      const root = await run();
      await tick();
      const queuedChild = await store.addItem(URL_KEY, { prompt: 'p', issueIdentifier: 'LIN-1', followUpTo: root, rootItemId: root });
      await store.removeItem(URL_KEY, queuedChild._id);
      await tick();
      await post(root, '[done] parent finished', root);
      const cancelled = await persisted(queuedChild._id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.lineageStatus, null);
      assert.equal(cancelled.lineageFeedbackCount, 0);
      await assertPersistedMatchesOracle('cancelled');
    });

    test('abort + later genuine terminal: the F1 guard keeps the terminal; a lone abort attributes to its target (LIN-1261)', async () => {
      const target = await run();
      await post(target, '[working] going', target);
      const abort = await store.addItem(URL_KEY, { abort: true, abortTo: target });
      await store.takeItem(abort._id, URL_KEY, TOKEN);
      await tick();
      await post(abort._id, '[aborted] cancelled');
      const t1 = await persisted(target);
      assert.equal(t1.lineageStatus, 'aborted', 'the abort attributes to its target at the abort row\'s write');
      assert.ok(t1.lineageCompletedAt instanceof Date);
      await assertPersistedMatchesOracle('abort');
      await tick();
      await post(target, '[done] finished after all', target);
      assert.equal((await persisted(target)).lineageStatus, 'done', 'a LATER genuine terminal beats the earlier abort');
      await assertPersistedMatchesOracle('abort-then-done');
    });

    test('closed precedence (LIN-3364): a stamp reads closed, a terminal still wins, terminal rows are not rewritten', async () => {
      const a = await run();
      await post(a, '[blocked] parked', a);
      assert.equal((await persisted(a)).lineageStatus, 'blocked');
      await store.stampBookkeeping(URL_KEY, a, { by: 'acct', reason: 'handed-on' });
      assert.equal((await persisted(a)).lineageStatus, 'closed', 'closed beats blocked');
      await post(a, '[done] later', a);
      assert.equal((await persisted(a)).lineageStatus, 'done', 'a later [done] on a stamped row reads done');
      const b = await run();
      await post(b, '[done] first', b);
      await store.stampBookkeeping(URL_KEY, b, { by: 'acct', reason: 'handed-on' });
      assert.equal((await persisted(b)).lineageStatus, 'done', 'the stamp does not override a terminal');
      await assertPersistedMatchesOracle('closed', { fresh: false });
      await store.listHistoryLineageRows(URL_KEY, { limit: 10 });
      await assertPersistedMatchesOracle('closed-healed');
    });

    test('closeLineageRows (the bulk closer) persists closed on non-terminal rows only, and the rows heal fresh', async () => {
      const root = await run();
      const wake = await run({ kind: 'wake', followUpTo: root, rootItemId: root });
      await tick();
      const sibling = await run({ followUpTo: root, rootItemId: root });
      await post(sibling, '[done] lineage finished', root);
      const rows = [await persisted(root), await persisted(wake)];
      assert.ok(rows.every(r => r.lineageStatus === 'done'), 'the lineage terminal reaches the earlier rows');
      await assertPersistedMatchesOracle('bulk-closer');
    });

    test('blocked → resumed → running, and [pending] (B2: RESUME_MARKER is status-bearing)', async () => {
      const a = await run();
      await post(a, '[blocked] needs a human', a);
      assert.equal((await persisted(a)).lineageStatus, 'blocked');
      await tick();
      await post(a, '[working] Session resumed. continuing', a);
      assert.equal((await persisted(a)).lineageStatus, null, 'the resume marker clears blocked');
      await post(a, '[pending] paused', a);
      await assertPersistedMatchesOracle('blocked-resumed');
    });

    test('a row whose only lineage tag is entry-level (pre-LIN-1468) is derived but never marked fresh (re-derived on read)', async () => {
      const t0 = new Date('2026-08-01T00:00:00.000Z');
      await history.insertOne({
        _id: 'tier2', urlKey: URL_KEY, status: 'taken', issueIdentifier: 'LIN-1', dispatchedAt: t0, resolvedAt: t0, bookkeeping: null,
        feedback: [{ message: 'beat', rootItemId: 'A', timestamp: new Date(t0.getTime() + 1000) }]
      });
      await history.insertOne({
        _id: 'sib', urlKey: URL_KEY, status: 'taken', issueIdentifier: 'LIN-1', rootItemId: 'A', dispatchedAt: t0, resolvedAt: t0, bookkeeping: null,
        feedback: [{ message: '[done] sib finished', rootItemId: 'A', timestamp: new Date(t0.getTime() + 2000) }]
      });
      await recomputeLineageRows(history, URL_KEY, ['tier2']);
      const row = await persisted('tier2');
      assert.equal(row.lineageStatus, 'done', 'the value is derived through its entry-level anchor');
      assert.equal(row.lineageStatusBasis, null, 'but never trusted as fresh: later sibling fan-out cannot reach it by query');
      const page = await store.listHistoryLineageRows(URL_KEY, { limit: 10 });
      assert.equal(page.items.find(i => i.id === 'tier2').lineage.status, 'done');
    });
  });

  describe('archive-time derivation for a taken row (R2)', () => {
    test('sibling entries stamped while the follow-up waited in the queue (incl. a terminal) count for it once it is taken', async () => {
      const root = await run();
      await tick();
      const followUp = await store.addItem(URL_KEY, { prompt: 'p', issueIdentifier: 'LIN-1', followUpTo: root, rootItemId: root });
      await tick();
      await post(root, 'beat while queued', root);
      await post(root, '[done] finished while the follow-up waited', root);
      await tick();
      await store.takeItem(followUp._id, URL_KEY, TOKEN);
      const row = await persisted(followUp._id);
      assert.equal(row.lineageStatus, 'done');
      assert.equal(row.lineageFeedbackCount, 2);
      assert.ok(isLineageFresh(row));
      await assertPersistedMatchesOracle('queued-window');
    });

    test('interleaving: a sibling write landing between the archive insert and its recompute ends consistent through the CAS', async () => {
      const root = await run();
      await tick();
      const followUp = await store.addItem(URL_KEY, { prompt: 'p', issueIdentifier: 'LIN-1', followUpTo: root, rootItemId: root });
      await tick();
      const realInsert = history.insertOne.bind(history);
      let fired = false;
      history.insertOne = async (doc) => {
        const res = await realInsert(doc);
        if (!fired && doc._id === followUp._id) {
          fired = true;
          await tick();
          await post(root, '[done] landed between the insert and the recompute', root);
        }
        return res;
      };
      await store.takeItem(followUp._id, URL_KEY, TOKEN);
      history.insertOne = realInsert;
      assert.ok(fired);
      const row = await persisted(followUp._id);
      assert.equal(row.lineageStatus, 'done');
      assert.equal(row.lineageFeedbackCount, 1);
      await assertPersistedMatchesOracle('archive-interleave');
    });

    test('a failed archive-time recompute leaves the null marker for the read-time self-heal and never faults the take', async () => {
      const root = await run();
      await post(root, '[done] x', root);
      await tick();
      const followUp = await store.addItem(URL_KEY, { prompt: 'p', issueIdentifier: 'LIN-1', followUpTo: root, rootItemId: root });
      const realFind = history.find.bind(history);
      history.find = () => { throw new Error('boom'); };
      const errors = [];
      const realError = console.error;
      console.error = (...a) => errors.push(a.join(' '));
      try {
        const taken = await store.takeItem(followUp._id, URL_KEY, TOKEN);
        assert.ok(taken, 'the take succeeded');
      } finally {
        history.find = realFind;
        console.error = realError;
      }
      assert.ok(errors.some(e => /deriving lineage fields at archive/.test(e)));
      assert.equal((await persisted(followUp._id)).lineageStatusBasis, null);
      const page = await store.listHistoryLineageRows(URL_KEY, { limit: 10 });
      assert.ok(isLineageFresh(await persisted(followUp._id)), 'the read healed and persisted it');
      assert.ok(page.items.find(i => i.id === followUp._id));
    });
  });

  describe('races and write amplification', () => {
    test('N11: a recompute landing between a sibling\'s push and its fan-out double-counts, is DETECTABLE (basis mismatch) and the self-heal corrects it', async () => {
      const root = await run();
      await tick();
      const child = await run({ followUpTo: root, rootItemId: root });
      await tick();
      const realUpdateMany = history.updateMany.bind(history);
      let raced = false;
      history.updateMany = async (q, u) => {
        if (!raced) {
          raced = true;
          // The child's entry has landed (the push precedes the fan-out); a recompute of the root runs now.
          await recomputeLineageRows(history, URL_KEY, [root]);
        }
        return realUpdateMany(q, u);
      };
      await post(child, 'heartbeat', root);
      history.updateMany = realUpdateMany;
      const row = await persisted(root);
      assert.equal(row.lineageFeedbackCount, 2, 'the entry was counted by the recompute AND by the fan-out');
      assert.ok(!isLineageFresh(row), 'detectable: the fan-out bumped lineageBasis after the recompute wrote its status basis');
      const page = await store.listHistoryLineageRows(URL_KEY, { limit: 10 });
      assert.equal(page.items.find(i => i.id === root).lineage.feedbackCount, 1, 'served healed');
      assert.equal((await persisted(root)).lineageFeedbackCount, 1, 'and written back');
      await assertPersistedMatchesOracle('n11');
    });

    test('N11 ordering: the own $push precedes the fan-out, so a recompute that reads the bumped basis also reads the entry', async () => {
      const root = await run();
      await tick();
      const child = await run({ followUpTo: root, rootItemId: root });
      await tick();
      const calls = [];
      const realFOAU = history.findOneAndUpdate.bind(history);
      const realUM = history.updateMany.bind(history);
      history.findOneAndUpdate = async (...a) => { calls.push('push'); return realFOAU(...a); };
      history.updateMany = async (...a) => { calls.push('fanout'); return realUM(...a); };
      await post(child, 'beat', root);
      history.findOneAndUpdate = realFOAU;
      history.updateMany = realUM;
      assert.deepEqual(calls.slice(0, 2), ['push', 'fanout']);
    });

    test('a CAS lost on every attempt logs once and leaves the row stale, never throws', async () => {
      const root = await run();
      const realUpdateOne = history.updateOne.bind(history);
      history.updateOne = async () => ({ matchedCount: 0 });
      const errors = [];
      const realError = console.error;
      console.error = (...a) => errors.push(a.join(' '));
      try {
        const out = await recomputeLineageRows(history, URL_KEY, [root]);
        assert.ok(out.has(root), 'the derived values are still returned for the read path');
      } finally {
        history.updateOne = realUpdateOne;
        console.error = realError;
      }
      assert.equal(errors.filter(e => /lost its compare-and-set 3x/.test(e)).length, 1);
    });

    test('write amplification: a heartbeat is the atomic push + the digest + two fan-out statements, and no lineage read', async () => {
      const root = await run();
      await tick();
      const child = await run({ followUpTo: root, rootItemId: root });
      await tick();
      // The FIRST tagged post also runs the existing handed-on closer (LIN-3365); measure a later one.
      await post(child, 'first tagged post', root);
      const counts = { find: 0, findOne: 0, updateMany: 0, updateOne: 0, findOneAndUpdate: 0 };
      const restore = [];
      for (const k of Object.keys(counts)) {
        const real = history[k].bind(history);
        history[k] = (...a) => { counts[k]++; return real(...a); };
        restore.push(() => { history[k] = real; });
      }
      await post(child, 'heartbeat', root);
      restore.forEach(fn => fn());
      assert.deepEqual(counts, { find: 0, findOne: 0, updateMany: 2, updateOne: 1, findOneAndUpdate: 1 });
    });

    test('an untagged non-status-bearing entry touches only its own row (no fan-out, no recompute)', async () => {
      const root = await run();
      let updateMany = 0;
      const real = history.updateMany.bind(history);
      history.updateMany = (...a) => { updateMany++; return real(...a); };
      await post(root, 'untagged heartbeat');
      history.updateMany = real;
      assert.equal(updateMany, 0);
      assert.equal((await persisted(root)).lineageFeedbackCount, 1);
    });

    test('decision markers count on their own row atomically with the push', async () => {
      const root = await run();
      await store.markDecisionAnswered(root, URL_KEY, 'dec-1', 'answered');
      assert.equal((await persisted(root)).lineageFeedbackCount, 1);
      await assertPersistedMatchesOracle('decision');
    });
  });

  describe('legacy rows: self-heal on read and the once-per-process backfill', () => {
    async function seedLegacy() {
      const t0 = new Date('2026-08-01T00:00:00.000Z');
      const base = { urlKey: URL_KEY, status: 'taken', issueIdentifier: 'LIN-1', bookkeeping: null, takenByTokenLabel: TOKEN, takenByTokenId: null };
      await history.insertOne({ ...base, _id: 'l-root', rootItemId: 'l-root', dispatchedAt: t0, resolvedAt: t0, feedback: [{ message: 'beat', rootItemId: 'l-root', timestamp: new Date(t0.getTime() + 1000) }] });
      await history.insertOne({ ...base, _id: 'l-kid', rootItemId: 'l-root', dispatchedAt: new Date(t0.getTime() + 500), resolvedAt: new Date(t0.getTime() + 500), feedback: [{ message: '[done] kid', rootItemId: 'l-root', timestamp: new Date(t0.getTime() + 2000) }] });
      await history.insertOne({ ...base, _id: 'l-run', dispatchedAt: t0, resolvedAt: t0, feedback: [] });
    }

    test('ensureLineageStatus derives every never-derived taken row, once per process per workspace', async () => {
      await seedLegacy();
      await store.ensureLineageStatus(URL_KEY);
      await assertPersistedMatchesOracle('backfill');
      assert.equal((await persisted('l-root')).lineageStatus, 'done');
      let reads = 0;
      const realFind = history.find.bind(history);
      history.find = (...a) => { reads++; return realFind(...a); };
      await store.ensureLineageStatus(URL_KEY);
      history.find = realFind;
      assert.equal(reads, 0, 'memoised: the second call reads nothing');
    });

    test('a backfill failure is not memoised: the next read retries', async () => {
      await seedLegacy();
      const realFind = history.find.bind(history);
      history.find = () => { throw new Error('boom'); };
      const realError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(store.ensureLineageStatus(URL_KEY), /ensureLineageStatus|boom/);
      } finally {
        history.find = realFind;
        console.error = realError;
      }
      await store.ensureLineageStatus(URL_KEY);
      assert.equal((await persisted('l-root')).lineageStatus, 'done');
    });

    test('the page read serves a stale row healed and writes the heal back', async () => {
      await seedLegacy();
      const page = await store.listHistoryLineageRows(URL_KEY, { limit: 10 });
      assert.equal(page.items.find(i => i.id === 'l-root').lineage.status, 'done');
      assert.ok(isLineageFresh(await persisted('l-root')));
    });

    test('the DB-side ?status= predicate: taken = running (lineageStatus null), done/closed = the persisted value, exact total', async () => {
      await seedLegacy();
      await store.ensureLineageStatus(URL_KEY);
      const done = await store.listHistoryLineageRows(URL_KEY, { status: 'done', limit: 10 });
      assert.deepEqual(done.items.map(i => i.id).sort(), ['l-kid', 'l-root']);
      assert.equal(done.total, 2);
      const taken = await store.listHistoryLineageRows(URL_KEY, { status: 'taken', limit: 10 });
      assert.deepEqual(taken.items.map(i => i.id), ['l-run']);
      assert.equal(taken.total, 1);
      assert.deepEqual(await store.listHistoryLineageRows(URL_KEY, { status: 'queued', limit: 10 }), { items: [], total: 0 });
    });
  });
});
