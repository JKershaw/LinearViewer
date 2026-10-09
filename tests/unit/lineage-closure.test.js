/**
 * LIN-3365: `selectLineageCloses` (the pure rule) and its PARITY with the live
 * closers in `addFeedback`.
 *
 * The parity test is a REPLAY, not a final-state snapshot: it applies timed
 * events (mint, take, tagged post, terminal) in order against a real MangoDB
 * store with `Date` mocked, runs the live closers at each post, and compares the
 * closed set with `selectLineageCloses` over the CLOSERS-OFF final state of the
 * same script (stamped rows would otherwise be excluded as candidates). Asserts
 * `pure ⊆ live` and `live − pure ⊆ membership-unresolved` (equality on every
 * fixture whose anchors are readable, which is all of them).
 */
import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { selectLineageCloses, TICKET_CLOSED_GRACE_MS, LINEAGE_CLOSE_REASONS } from '../../lib/lineage-closure.js';

const URL_KEY = 'acme';
const TOKEN = 'tok';
const at = (m) => new Date(Date.UTC(2026, 7, 1, 0, m, 0, 0));

const row = (id, o = {}) => ({
  _id: id, rootItemId: id, kind: 'wake', status: 'taken', dispatchedAt: at(1), resolvedAt: at(2),
  followUpTo: null, bookkeeping: null, feedback: [], ...o
});
const fb = (m, message, rootItemId) => ({ message, timestamp: at(m), ...(rootItemId ? { rootItemId } : {}) });
const ids = (sel) => sel.closes.map(c => c.id).sort();

describe('selectLineageCloses (pure)', () => {
  test('exports the shared constants', () => {
    assert.equal(typeof TICKET_CLOSED_GRACE_MS, 'number');
    assert.deepEqual([...LINEAGE_CLOSE_REASONS], ['handed-on', 'lineage-terminal', 'ticket-closed']);
  });

  test('lineage-terminal: closes earlier taken members, not later-dispatched / later-taken / stamped / non-member / no-root rows', () => {
    const rows = [
      row('P', { kind: 'implementation', dispatchedAt: at(0), resolvedAt: at(0), feedback: [fb(3, 'hb', 'P'), fb(9, '[done] ok', 'P')] }),
      row('beat', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(2), resolvedAt: at(3) }),
      row('after-dispatch', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(12), resolvedAt: at(13) }),
      row('taken-after', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(2), resolvedAt: at(11) }),
      row('stamped', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', bookkeeping: { at: at(5) } }),
      row('other', { kind: 'implementation', rootItemId: 'Q' }),
      row('noroot', { kind: 'implementation', rootItemId: undefined })
    ];
    const sel = selectLineageCloses(rows);
    assert.deepEqual(ids(sel), ['beat']);
    assert.equal(sel.closes[0].reason, 'lineage-terminal');
    assert.deepEqual(sel.skippedIds['taken-after-event'], ['taken-after']);
  });

  test('a later [blocked] on the terminal row cannot hide its [done] (all entries scanned)', () => {
    const rows = [
      row('P', { kind: 'implementation', dispatchedAt: at(0), resolvedAt: at(0), feedback: [fb(3, '[done] ok', 'P'), fb(4, '[blocked] again', 'P')] }),
      row('beat', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(1), resolvedAt: at(2) })
    ];
    assert.deepEqual(ids(selectLineageCloses(rows)), ['beat']);
  });

  test('[skipped] is not a lineage-closing terminal', () => {
    const rows = [
      row('P', { kind: 'implementation', dispatchedAt: at(0), resolvedAt: at(0), feedback: [fb(3, '[skipped] human-continued session s (x)', 'P')] }),
      row('beat', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(1), resolvedAt: at(2) })
    ];
    assert.deepEqual(ids(selectLineageCloses(rows)), []);
  });

  test('handed-on: closes earlier kind:wake rows only, never a non-wake follow-up', () => {
    const rows = [
      row('old-wake', { dispatchedAt: at(1), resolvedAt: at(2), feedback: [fb(3, 'hb', 'R')] }),
      row('old-beat', { kind: 'implementation', followUpTo: 'old-wake', rootItemId: 'R', dispatchedAt: at(1), resolvedAt: at(2) }),
      row('new-wake', { dispatchedAt: at(5), resolvedAt: at(6), feedback: [fb(7, 'first tagged', 'R')] })
    ];
    const sel = selectLineageCloses(rows);
    assert.deepEqual(ids(sel), ['old-wake']);
    assert.equal(sel.closes[0].reason, 'handed-on');
  });

  test('lineage-terminal beats handed-on when both apply', () => {
    const rows = [
      row('old-wake', { dispatchedAt: at(1), resolvedAt: at(2), feedback: [fb(3, 'hb', 'R')] }),
      row('new-wake', { dispatchedAt: at(5), resolvedAt: at(6), feedback: [fb(7, 'first tagged', 'R'), fb(8, '[done] x', 'R')] })
    ];
    assert.equal(selectLineageCloses(rows).closes[0].reason, 'lineage-terminal');
  });

  test('own terminal as of T: a row that ended before the event is not closed; one that ends after is, flagged ownTerminalNow', () => {
    const rows = [
      row('P', { kind: 'implementation', dispatchedAt: at(0), resolvedAt: at(0), feedback: [fb(9, '[done] ok', 'P')] }),
      row('ended-before', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(1), resolvedAt: at(2), feedback: [fb(5, '[failed] x', 'P')] }),
      row('ends-after', { kind: 'implementation', followUpTo: 'P', rootItemId: 'P', dispatchedAt: at(1), resolvedAt: at(2), feedback: [fb(10, '[done] late', 'P')] })
    ];
    const sel = selectLineageCloses(rows);
    // (P itself is legitimately closed by ended-before's [failed] at 5: it had no terminal yet.)
    assert.deepEqual(ids(sel), ['P', 'ends-after']);
    assert.equal(sel.closes.find(c => c.id === 'ends-after').ownTerminalNow, true);
    assert.ok(sel.skippedIds['terminal-after-event'].includes('ended-before'));
  });

  test('an unreadable anchor leaves the row open and counted (membership-unresolved)', () => {
    const rows = [
      row('P', { kind: 'implementation', dispatchedAt: at(0), resolvedAt: at(0), feedback: [fb(9, '[done] ok', 'P')] }),
      row('orphan', { kind: 'implementation', followUpTo: 'missing-anchor', rootItemId: 'P', dispatchedAt: at(1), resolvedAt: at(2), feedback: [fb(12, 'hb', 'P')] })
    ];
    const sel = selectLineageCloses(rows);
    assert.deepEqual(ids(sel), []);
    assert.deepEqual(sel.skippedIds['membership-unresolved'], ['orphan']);
  });

  test('an event keyed by the event row root AT the event, not its later final root (N1)', () => {
    // X posts [done] untagged-at-first under root A, later re-roots to B. The
    // [done] at 5 belongs to A: it closes A's members, not B's.
    const rows = [
      row('X', { kind: 'implementation', rootItemId: 'B', dispatchedAt: at(0), resolvedAt: at(0), feedback: [fb(1, 'hb', 'A'), fb(5, '[done] x'), fb(8, 'hb', 'B')] }),
      row('a-member', { kind: 'implementation', followUpTo: 'X', rootItemId: 'A', dispatchedAt: at(2), resolvedAt: at(3), feedback: [fb(3, 'hb', 'A')] }),
      row('b-member', { kind: 'implementation', followUpTo: 'X', rootItemId: 'B', dispatchedAt: at(2), resolvedAt: at(3), feedback: [fb(3, 'hb', 'B')] })
    ];
    assert.deepEqual(ids(selectLineageCloses(rows)), ['a-member']);
  });
});

describe('parity: live closers vs selectLineageCloses on replayed events (real MangoDB, mocked Date)', () => {
  let dbDir, client, counter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lineage-closure-parity-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  /** Apply a script of timed events; returns the history rows at the end. */
  async function run(script, closersOn) {
    const db = client.db(`parity_${counter++}`);
    const history = db.collection('dispatch-history');
    const store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
    if (!closersOn) store.closeLineageRows = async () => ({ ok: true, closedIds: [] });
    const minted = new Map();
    const log = console.log; const err = console.error; console.log = () => {}; console.error = () => {};
    mock.timers.enable({ apis: ['Date'], now: at(0) });
    try {
      for (const ev of script) {
        mock.timers.setTime(at(ev.t).getTime());
        if (ev.op === 'mint') {
          // seed as the store/factory write it: wake / no followUpTo -> own id; else anchor's root || followUpTo
          let seed = ev.id;
          if (ev.kind !== 'wake' && ev.followUpTo) {
            const anchor = await history.findOne({ _id: ev.followUpTo }) || minted.get(ev.followUpTo);
            seed = anchor?.rootItemId || ev.followUpTo;
          }
          minted.set(ev.id, { _id: ev.id, rootItemId: seed, kind: ev.kind, followUpTo: ev.followUpTo || null, dispatchedAt: at(ev.t) });
        } else if (ev.op === 'take') {
          const m = minted.get(ev.id);
          await history.insertOne({
            ...m, urlKey: URL_KEY, issueIdentifier: 'LIN-1', status: 'taken', resolvedAt: at(ev.t), feedback: [],
            bookkeeping: null, takenByTokenLabel: TOKEN, takenByTokenId: null
          });
        } else if (ev.op === 'post') {
          const r = await store.addFeedback(ev.id, URL_KEY, { message: ev.message, rootItemId: ev.root }, TOKEN);
          assert.ok(r?.success, `post ${ev.id}@${ev.t}`);
        }
      }
    } finally {
      mock.timers.reset();
      console.log = log; console.error = err;
    }
    return history.find({}).toArray();
  }

  async function parity(script) {
    const on = await run(script, true);
    const off = await run(script, false);
    const live = on.filter(r => r.bookkeeping).map(r => r._id).sort();
    const sel = selectLineageCloses(off);
    const pure = sel.closes.map(c => c.id).sort();
    const unresolved = new Set(sel.skippedIds['membership-unresolved']);
    for (const id of pure) assert.ok(live.includes(id), `pure ⊆ live: ${id} (live=${live}, pure=${pure})`);
    for (const id of live) assert.ok(pure.includes(id) || unresolved.has(id), `live − pure ⊆ unresolved: ${id}`);
    return { live, pure, sel, on };
  }

  const P = (extra = []) => [
    { op: 'mint', t: 0, id: 'P', kind: 'implementation' },
    { op: 'take', t: 0, id: 'P' },
    ...extra
  ];

  test('(i) queued-busy wake minted before the terminal, taken after, ends [blocked]: open under both', async () => {
    const { live } = await parity(P([
      { op: 'mint', t: 2, id: 'W', kind: 'wake', followUpTo: 'P' },
      { op: 'post', t: 3, id: 'P', message: '[done] shipped', root: 'P' },
      { op: 'take', t: 4, id: 'W' },
      { op: 'post', t: 5, id: 'W', message: '[blocked] need a human', root: 'P' }
    ]));
    assert.deepEqual(live, []);
  });

  test('(ii) wake dispatched before a successor but taken after its first post: open under both', async () => {
    const { live } = await parity(P([
      { op: 'mint', t: 2, id: 'W', kind: 'wake', followUpTo: 'P' },
      { op: 'mint', t: 3, id: 'S', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 4, id: 'S' },
      { op: 'post', t: 5, id: 'S', message: 'first tagged', root: 'P' },
      { op: 'take', t: 6, id: 'W' }
    ]));
    assert.deepEqual(live, []);
  });

  test('(iii) wake taken before the successor whose first tagged post comes after it: open under both', async () => {
    const { live } = await parity(P([
      { op: 'mint', t: 1, id: 'W', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 2, id: 'W' },
      { op: 'mint', t: 3, id: 'S', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 4, id: 'S' },
      { op: 'post', t: 5, id: 'S', message: 'first tagged', root: 'P' },
      { op: 'post', t: 7, id: 'W', message: 'late first tagged', root: 'P' }
    ]));
    assert.deepEqual(live, []);
  });

  test('(iv) the same wake tagged before the successor posts: closed under both (handed-on)', async () => {
    const { live, on } = await parity(P([
      { op: 'mint', t: 1, id: 'W', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 2, id: 'W' },
      { op: 'post', t: 3, id: 'W', message: 'first tagged', root: 'P' },
      { op: 'mint', t: 4, id: 'S', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 5, id: 'S' },
      { op: 'post', t: 6, id: 'S', message: 'first tagged', root: 'P' }
    ]));
    assert.deepEqual(live, ['W']);
    assert.equal(on.find(r => r._id === 'W').bookkeeping.reason, 'handed-on');
  });

  test('terminal closes an in-flight beat, and a wake chain collapses', async () => {
    const { live, sel } = await parity(P([
      { op: 'mint', t: 1, id: 'B', kind: 'implementation', followUpTo: 'P' },
      { op: 'take', t: 2, id: 'B' },
      { op: 'mint', t: 3, id: 'W', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 4, id: 'W' },
      { op: 'post', t: 5, id: 'W', message: 'tagged', root: 'P' },
      { op: 'post', t: 8, id: 'P', message: '[done] shipped', root: 'P' }
    ]));
    assert.deepEqual(live, ['B', 'W']);
    assert.equal(sel.closes.find(c => c.id === 'W').reason, 'lineage-terminal');
  });

  test('(m1) follow-up anchored on an unposted wake (seed = wake id): open when its first tagged post is after the terminal; closed when before', async () => {
    const base = [
      { op: 'mint', t: 1, id: 'W2', kind: 'wake', followUpTo: 'P' },
      { op: 'take', t: 2, id: 'W2' },
      { op: 'mint', t: 3, id: 'F', kind: 'implementation', followUpTo: 'W2' },
      { op: 'take', t: 4, id: 'F' }
    ];
    const open = await parity(P([...base,
      { op: 'post', t: 6, id: 'P', message: '[done] x', root: 'P' },
      { op: 'post', t: 8, id: 'F', message: 'first tagged after', root: 'P' }]));
    assert.ok(!open.live.includes('F'));
    const closed = await parity(P([...base,
      { op: 'post', t: 5, id: 'F', message: 'first tagged before', root: 'P' },
      { op: 'post', t: 6, id: 'P', message: '[done] x', root: 'P' }]));
    assert.ok(closed.live.includes('F'));
  });

  test('(m2) a row closed at T that later posts its own [done]: live closed it; pure lists it ownTerminalNow', async () => {
    const { live, sel } = await parity(P([
      { op: 'mint', t: 1, id: 'X', kind: 'implementation', followUpTo: 'P' },
      { op: 'take', t: 2, id: 'X' },
      { op: 'post', t: 3, id: 'X', message: 'tagged', root: 'P' },
      { op: 'post', t: 6, id: 'P', message: '[done] x', root: 'P' },
      { op: 'post', t: 7, id: 'X', message: '[done] mine', root: 'P' }
    ]));
    assert.deepEqual(live, ['X']);
    assert.equal(sel.closes.find(c => c.id === 'X').ownTerminalNow, true);
  });

  test('(m3/tie) a row taken in the same millisecond as the terminal stays open under both', async () => {
    const { live } = await parity(P([
      { op: 'mint', t: 1, id: 'Y', kind: 'implementation', followUpTo: 'P' },
      { op: 'take', t: 6, id: 'Y' },
      { op: 'post', t: 6, id: 'P', message: '[done] x', root: 'P' }
    ]));
    assert.deepEqual(live, []);
  });
});
