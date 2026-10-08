/**
 * lib/lineage-closure.js
 *
 * Pure selector for the lineage closers (LIN-3365, slice B of LIN-3358). No I/O.
 *
 * `addFeedback` closes (stamps `bookkeeping` on) still-`taken` rows at two
 * events; this module is the SAME rule expressed over data, so the backfill and
 * the `false-live-rows` instrument measure and write exactly what the live
 * closers do. `tests/unit/lineage-closure.test.js` ties the two with a replay.
 *
 *   lineage-terminal  A lineage-closing terminal (`isLineageClosingTerminal`:
 *                     done|complete|failed|aborted, never skipped/blocked/pending)
 *                     at T closes every other row that, AT T, was a member of the
 *                     event's lineage, had no own terminal, was dispatched before
 *                     T and TAKEN before T.
 *   handed-on         The first tagged post of a row S at T_a closes earlier
 *                     `kind:'wake'` rows ONLY (never beats / human replies, which
 *                     may be long-polled, LIN-1470) of that lineage that were
 *                     dispatched before S and taken before T_a.
 *
 * Everything is evaluated AS OF the event time, because the live closer sees
 * state at the event and the selector sees final state: `status`, `kind`,
 * `dispatchedAt`, `resolvedAt` never change after the take and `feedback` is
 * append-only, but `rootItemId` (lineage membership), the own-terminal test and
 * `bookkeeping` do. See `storedRootAt` / `ownTerminalAt` and the closers-off
 * note on `selectLineageCloses`.
 *
 * Reason precedence: `lineage-terminal` beats `handed-on` (the terminal is the
 * stronger fact); `addFeedback` runs (b) before (a) and this selector assigns
 * in the same order.
 */

import { isLineageClosingTerminal, __internal as terminalInternal } from './dispatch-terminal.js';

const { TERMINAL_FEEDBACK_REGEX } = terminalInternal;

export const LINEAGE_CLOSE_REASONS = Object.freeze(['handed-on', 'lineage-terminal', 'ticket-closed']);

/**
 * How long a ticket must have been terminal before a row still reading
 * blocked/silent on it counts as a false-live row (`false-live-rows` clause 3),
 * and the settle window C's ticket-closed closer (LIN-3366) waits.
 *
 * PROVISIONAL (LIN-3365): 10 minutes so the instrument can run. The VALUE is
 * C's decision and it may retune it; the single DEFINITION is here, so C imports
 * this rather than redefining it.
 */
export const TICKET_CLOSED_GRACE_MS = 10 * 60 * 1000;

/** Named buckets for rows that looked like candidates but were (correctly) left open. */
export const SKIP_BUCKETS = Object.freeze([
  'taken-after-event',
  'terminal-after-event',
  'not-member-at-event',
  'membership-unresolved'
]);
// Precedence when a row misses several events: the most informative miss wins.
const BUCKET_PRECEDENCE = ['taken-after-event', 'terminal-after-event', 'membership-unresolved', 'not-member-at-event'];

const toMs = (v) => {
  if (v == null) return NaN;
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return ms;
};

const taggedEntries = (row) => (row.feedback || []).filter(f => f && f.rootItemId);

/**
 * Index rows by id and memoise nothing else: the inputs are small (one
 * workspace's lineages) and the functions are cheap.
 */
function buildModel(rows) {
  const byId = new Map();
  for (const r of rows) byId.set(r._id, r);

  /**
   * The row's seed `rootItemId` as it was written at mint (not recoverable from
   * a row that has since posted a tagged entry, so rebuilt per kind). `undefined`
   * = cannot be determined (an unreadable anchor).
   */
  function seedRoot(row, depth = 0) {
    const tagged = taggedEntries(row);
    if (tagged.length === 0) return row.rootItemId || undefined; // never reconciled: final === seed
    if (row.kind === 'wake' || !row.followUpTo) return row._id; // addItem, no inheritance
    const anchor = byId.get(row.followUpTo);
    if (!anchor) return undefined;
    if (depth > 50) return undefined; // malformed cycle: unresolved, never closed
    // The factory's `anchor.rootItemId || followUpTo`, against the anchor as it
    // stood when the follow-up was minted.
    return storedRootAt(anchor, toMs(row.dispatchedAt), depth + 1) || row.followUpTo;
  }

  /**
   * The selector's model of what the live filter `{rootItemId: R}` matched at
   * `tMs`: the root of the latest tagged entry strictly before `tMs`, else the
   * seed. `undefined` when it cannot be determined.
   */
  function storedRootAt(row, tMs, depth = 0) {
    let best = null;
    let bestMs = -Infinity;
    for (const f of taggedEntries(row)) {
      const ms = toMs(f.timestamp);
      if (ms < tMs && ms >= bestMs) { best = f; bestMs = ms; }
    }
    if (best) return best.rootItemId;
    return seedRoot(row, depth);
  }

  /**
   * Own terminal as of `tMs`: any entry matching TERMINAL_FEEDBACK_REGEX
   * (`[skipped]` included — the regex `noOwnTerminalMarkerFilter` uses) at or
   * before `tMs`. A same-millisecond tie reads as "has a terminal" (leaves the
   * row open): the conservative side, so pure never closes what live left open.
   */
  function ownTerminalAt(row, tMs) {
    return (row.feedback || []).some(f => TERMINAL_FEEDBACK_REGEX.test(f?.message || '') && toMs(f.timestamp) <= tMs);
  }

  return { byId, seedRoot, storedRootAt, ownTerminalAt };
}

/**
 * Collect the closing events of a set of rows.
 *   terminal events: every entry (scanned ALL, never just the last wake marker,
 *   so a later [blocked]/[pending] cannot hide a [done]) that closes a lineage,
 *   keyed by the event row's root AT the event: the entry's own tag if it
 *   carries one (what live reconciles from the post), else `storedRootAt`.
 *   handed-on events: each row's first tagged entry.
 */
function collectEvents(rows, model) {
  const terminals = [];
  const handoffs = [];
  for (const row of rows) {
    const feedback = row.feedback || [];
    let firstTagged = true;
    for (const f of feedback) {
      if (!f) continue;
      const tMs = toMs(f.timestamp);
      if (!Number.isFinite(tMs)) continue;
      if (isLineageClosingTerminal(f.message)) {
        const root = f.rootItemId || model.storedRootAt(row, tMs);
        if (root) terminals.push({ rowId: row._id, root, tMs });
      }
      if (f.rootItemId && firstTagged) {
        firstTagged = false;
        handoffs.push({ rowId: row._id, root: f.rootItemId, tMs, successorDispatchedMs: toMs(row.dispatchedAt) });
      }
    }
  }
  return { terminals, handoffs };
}

/**
 * Select the rows the lineage closers close (or would have closed).
 *
 * `rows` are one workspace's lean history rows (`_id, rootItemId, kind, status,
 * dispatchedAt, resolvedAt, followUpTo, bookkeeping, feedback[{message,
 * timestamp, rootItemId}]`) INCLUDING the anchor rows its non-wake members point
 * at. Run it over the CLOSERS-OFF final state: `bookkeeping` is a write the live
 * closers make, so stamped rows are excluded as candidates.
 *
 * @param {Array<Object>} rows
 * @returns {{closes: Array<{id: string, rootItemId: string, reason: string, ownTerminalNow: boolean, eventAtMs: number, beforeDispatchedMs: number}>,
 *            skipped: Object<string, number>, skippedIds: Object<string, string[]>}}
 */
export function selectLineageCloses(rows) {
  const model = buildModel(rows);
  const { terminals, handoffs } = collectEvents(rows, model);
  const termByRoot = new Map();
  for (const e of terminals) {
    if (!termByRoot.has(e.root)) termByRoot.set(e.root, []);
    termByRoot.get(e.root).push(e);
  }
  const handByRoot = new Map();
  for (const e of handoffs) {
    if (!handByRoot.has(e.root)) handByRoot.set(e.root, []);
    handByRoot.get(e.root).push(e);
  }

  const closes = [];
  const skippedIds = Object.fromEntries(SKIP_BUCKETS.map(b => [b, []]));

  for (const row of rows) {
    if (row.status !== 'taken' || row.bookkeeping) continue;
    const dispatchedMs = toMs(row.dispatchedAt);
    const resolvedMs = toMs(row.resolvedAt);
    if (!Number.isFinite(dispatchedMs)) continue;

    const tagged = taggedEntries(row);
    const firstTaggedMs = tagged.length ? Math.min(...tagged.map(f => toMs(f.timestamp))) : Infinity;
    const seed = model.seedRoot(row);
    // Every root this row can have been a member of: its seed and each tagged root.
    const roots = new Set(tagged.map(f => f.rootItemId));
    if (seed) roots.add(seed);
    if (roots.size === 0) continue; // pre-LIN-1468 row: no lineage

    let win = null; // best closing event: lineage-terminal beats handed-on
    const misses = new Set();

    const consider = (ev, reason, extra) => {
      if (ev.rowId === row._id) return;
      const t = ev.tMs;
      const bound = reason === 'lineage-terminal' ? t : extra.successorDispatchedMs;
      if (!(dispatchedMs < bound)) return; // dispatched after: legitimately open, not a miss
      // Membership at the event.
      const rootAt = model.storedRootAt(row, t);
      if (rootAt === undefined) {
        // Unresolvable only while the seed is (before the first tagged entry).
        misses.add('membership-unresolved');
        return;
      }
      if (rootAt !== ev.root) { misses.add('not-member-at-event'); return; }
      if (model.ownTerminalAt(row, t)) { misses.add('terminal-after-event'); return; }
      if (!(resolvedMs < t)) { misses.add('taken-after-event'); return; }
      const cand = { id: row._id, rootItemId: ev.root, reason, eventAtMs: t, beforeDispatchedMs: bound };
      if (!win || (reason === 'lineage-terminal' && win.reason !== 'lineage-terminal')) win = cand;
    };

    for (const root of roots) {
      for (const ev of termByRoot.get(root) || []) consider(ev, 'lineage-terminal', {});
      if (row.kind === 'wake') {
        for (const ev of handByRoot.get(root) || []) consider(ev, 'handed-on', { successorDispatchedMs: ev.successorDispatchedMs });
      }
    }
    // An unresolved seed means the event's root can be any lineage: also test
    // terminals that happened before the row's first tagged entry.
    if (seed === undefined) {
      for (const [, evs] of termByRoot) {
        for (const ev of evs) {
          if (ev.rowId !== row._id && ev.tMs <= firstTaggedMs && dispatchedMs < ev.tMs) misses.add('membership-unresolved');
        }
      }
    }

    if (win) {
      closes.push({
        ...win,
        ownTerminalNow: (row.feedback || []).some(f => TERMINAL_FEEDBACK_REGEX.test(f?.message || ''))
      });
    } else {
      const bucket = BUCKET_PRECEDENCE.find(b => misses.has(b));
      if (bucket) skippedIds[bucket].push(row._id);
    }
  }

  const skipped = Object.fromEntries(SKIP_BUCKETS.map(b => [b, skippedIds[b].length]));
  return { closes, skipped, skippedIds };
}
