#!/usr/bin/env node
/**
 * Lineage-close backfill (LIN-3365, slice B of LIN-3358).
 *
 * Stamps (`bookkeeping: {at, by, reason}`) the `taken` rows the live
 * `addFeedback` closers would have closed had they existed: rows whose lineage
 * has since ended (`lineage-terminal`) or whose wake was handed on to a newer
 * wake (`handed-on`). `status` is never touched and no feedback entry is
 * appended. The rule is `selectLineageCloses` (lib/lineage-closure.js), the same
 * rule the live closers are parity-tested against; the write goes through
 * `closeLineageRows` (LIN-3364) with the same time bounds the live closers use.
 *
 * NEW script, deliberately NOT an extension of scripts/fossil-pass-lin2633.js
 * (different selection criteria; mixing them would blur two reviewable passes).
 * NOT a route, NOT autopilot-reachable, no import site in the app. An operator
 * runs it by hand.
 *
 * Usage:
 *   node scripts/lineage-close-backfill-lin3365.js              # DRY RUN — writes nothing
 *   node scripts/lineage-close-backfill-lin3365.js --execute     # writes the stamps
 *   node scripts/lineage-close-backfill-lin3365.js --by <label>  # actor recorded on each stamp
 *
 * Same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js. Dry run FIRST;
 * `--execute` against production only on John's recorded yes (the LIN-2633 /
 * LIN-2655 gate); a later approval is not retroactive authorization.
 *
 * HORIZON: only rows with `dispatchedAt >= now - READ_HORIZON_MS` (30 days,
 * lib/read-horizon.js, imported, no flag to widen it) are stamped. The full
 * lineage of each touched root is READ (a terminal or successor outside the band
 * must still be seen), but older rows are counted, not stamped, and the count is
 * labelled "older rows in touched lineages" because only lineages sharing a row
 * with the band are read: it is NOT every older eligible row. A lifetime
 * backfill would be a deliberate follow-up ruling.
 */

import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { execFileSync } from 'node:child_process';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { READ_HORIZON_MS } from '../lib/read-horizon.js';
import { selectLineageCloses, SKIP_BUCKETS } from '../lib/lineage-closure.js';

export const STAMP_BY_DEFAULT = 'lineage-close-backfill-lin3365';

// Columns the selector reads (plus `kind`/`status` for filtering and the report).
const PROJECTION = {
  _id: 1, urlKey: 1, issueIdentifier: 1, rootItemId: 1, kind: 1, status: 1, dispatchedAt: 1, resolvedAt: 1,
  followUpTo: 1, bookkeeping: 1, feedback: 1
};

/**
 * Read one workspace and select. Pure of writes. Throws on a read failure so the
 * caller stamps nothing for the workspace (fossil-pass posture).
 */
export async function selectForWorkspace({ dispatchStore, urlKey, now }) {
  const history = dispatchStore.historyCollection;
  const horizon = new Date(now - READ_HORIZON_MS);

  const band = await history.find({ urlKey, status: 'taken', bookkeeping: null, dispatchedAt: { $gte: horizon } }, { projection: PROJECTION }).toArray();
  const noRoot = band.filter(r => !r.rootItemId).length;
  const roots = [...new Set(band.map(r => r.rootItemId).filter(Boolean))];
  // Full lineage of every touched root (any status, any age): terminals and successors outside the band count.
  const lineage = roots.length
    ? await history.find({ urlKey, rootItemId: { $in: roots } }, { projection: PROJECTION }).toArray()
    : [];
  const byId = new Map(lineage.map(r => [r._id, r]));
  for (const r of band) if (!byId.has(r._id)) byId.set(r._id, r);

  // Non-wake rows with no tagged entry need no anchor; those with one need their
  // followUpTo anchor (storedRootAt reads it). Fetch what the lineage read lacks.
  const missing = [...new Set([...byId.values()]
    .filter(r => r.kind !== 'wake' && r.followUpTo && !byId.has(r.followUpTo))
    .map(r => r.followUpTo))];
  if (missing.length) {
    const anchors = await history.find({ urlKey, _id: { $in: missing } }, { projection: PROJECTION }).toArray();
    for (const a of anchors) byId.set(a._id, a);
  }

  const rows = [...byId.values()];
  const sel = selectLineageCloses(rows);
  const bandIds = new Set(band.map(r => r._id));

  const writable = [];
  let ownTerminalNow = 0;
  let outsideHorizon = 0;
  for (const c of sel.closes) {
    if (c.ownTerminalNow) { ownTerminalNow += 1; continue; } // closeLineageRows would not write it either
    if (!bandIds.has(c.id)) { outsideHorizon += 1; continue; }
    writable.push(c);
  }
  const heldOpen = {};
  for (const b of SKIP_BUCKETS) heldOpen[b] = sel.skippedIds[b].filter(id => bandIds.has(id)).length;
  return { writable, heldOpen, outsideHorizon, ownTerminalNow, noRoot, bandCount: band.length, sel, rows };
}

/** Group the writable set so each `closeLineageRows` call carries one bound-set. */
function groupWrites(writable) {
  const groups = new Map();
  for (const c of writable) {
    const key = [c.rootItemId, c.reason, c.eventAtMs, c.beforeDispatchedMs].join('|');
    if (!groups.has(key)) groups.set(key, { ...c, ids: [] });
    groups.get(key).ids.push(c.id);
  }
  return [...groups.values()];
}

/**
 * Runs the backfill. Exported so tests drive it against a tmpdir store.
 *
 * @returns {Promise<{report: string, perWorkspace: Array<Object>, stamped: Array<Object>, execute: boolean, remaining: number|null}>}
 */
export async function runLineageBackfill({
  dispatchStore,
  urlKeys = null,
  now = Date.now(),
  execute = false,
  by = null,
  headSha = null,
  log = () => {}
}) {
  const keys = urlKeys || await dispatchStore.listObservedWorkspaceKeys();
  log(`[lineage-backfill] ${execute ? 'EXECUTE' : 'DRY RUN'} over ${keys.length} workspace(s)`);
  const actor = by || STAMP_BY_DEFAULT;

  const perWorkspace = [];
  const stamped = [];
  let remaining = execute ? 0 : null;

  for (const urlKey of keys) {
    let result;
    try {
      result = await selectForWorkspace({ dispatchStore, urlKey, now });
    } catch (err) {
      log(`[lineage-backfill] ${urlKey}: READ FAILED (${err?.message || err}) — stamping nothing for this workspace`);
      perWorkspace.push({ urlKey, readFailed: true, error: err?.message || String(err) });
      continue;
    }
    perWorkspace.push({ urlKey, readFailed: false, ...result, sel: undefined, rows: undefined });
    log(`[lineage-backfill] ${urlKey}: ${result.writable.length} to stamp of ${result.bandCount} taken unstamped row(s) in the band`);
    if (!execute) continue;

    for (const g of groupWrites(result.writable)) {
      const r = await dispatchStore.closeLineageRows(urlKey, g.rootItemId, {
        beforeDispatchedAt: new Date(g.beforeDispatchedMs),
        takenBefore: new Date(g.eventAtMs),
        kinds: g.reason === 'handed-on' ? ['wake'] : undefined,
        ids: g.ids,
        reason: g.reason,
        by: actor
      });
      for (const id of g.ids) {
        stamped.push({ urlKey, id, reason: g.reason, ok: r.ok && r.closedIds.includes(id) });
      }
    }
    // Idempotence check: re-run the selector; nothing should remain.
    const after = await selectForWorkspace({ dispatchStore, urlKey, now });
    remaining += after.writable.length;
    perWorkspace[perWorkspace.length - 1].remainingAfter = after.writable.length;
  }

  const report = buildReport({ perWorkspace, now, headSha, execute, stamped, remaining });
  return { report, perWorkspace, stamped, execute, remaining };
}

export function buildReport({ perWorkspace, now, headSha, execute, stamped, remaining }) {
  const ok = perWorkspace.filter(w => !w.readFailed);
  const failed = perWorkspace.filter(w => w.readFailed);
  const sum = (f) => ok.reduce((n, w) => n + f(w), 0);
  const byReason = {};
  for (const w of ok) for (const c of w.writable) byReason[c.reason] = (byReason[c.reason] || 0) + 1;

  const L = [];
  L.push(`# Lineage-close backfill — ${execute ? 'EXECUTE' : 'DRY RUN'} (LIN-3365)`);
  L.push('');
  L.push(`Run at: ${new Date(now).toISOString()}`);
  L.push(`HEAD: ${headSha || '(unknown — not a git checkout)'}`);
  L.push(`Horizon cutoff: dispatchedAt >= ${new Date(now - READ_HORIZON_MS).toISOString()} (READ_HORIZON_MS, 30d)`);
  L.push(`Workspaces read: ${ok.length}${failed.length ? ` (${failed.length} FAILED: ${failed.map(w => w.urlKey).join(', ')} — stamped nothing)` : ''}`);
  L.push(`Taken, unstamped rows in the band: ${sum(w => w.bandCount)}`);
  L.push('');
  L.push(`## Would stamp: ${sum(w => w.writable.length)}`);
  L.push('');
  L.push('By reason:');
  for (const reason of ['lineage-terminal', 'handed-on']) L.push(`  ${reason.padEnd(18)} ${String(byReason[reason] || 0).padStart(5)}`);
  L.push('');
  L.push('By workspace:');
  for (const w of ok) {
    L.push(`  ${w.urlKey.padEnd(28)} ${String(w.writable.length).padStart(5)}`);
  }
  L.push('');
  L.push('## Would NOT stamp');
  L.push('');
  L.push(`  taken-after-event           ${String(sum(w => w.heldOpen['taken-after-event'])).padStart(5)}   dispatched before the event but taken after it: the resumed session, held open`);
  L.push(`  terminal-after-event        ${String(sum(w => w.heldOpen['terminal-after-event'])).padStart(5)}   the row's own terminal predates the event`);
  L.push(`  not-member-at-event         ${String(sum(w => w.heldOpen['not-member-at-event'])).padStart(5)}   not yet in the lineage when the event happened`);
  L.push(`  membership-unresolved       ${String(sum(w => w.heldOpen['membership-unresolved'])).padStart(5)}   anchor unreadable: left open, never closed`);
  L.push(`  own-terminal-now            ${String(sum(w => w.ownTerminalNow)).padStart(5)}   closed live, then posted its own terminal: reads terminal already`);
  L.push(`  no-rootItemId               ${String(sum(w => w.noRoot)).padStart(5)}   pre-LIN-1468 rows: no lineage to close in`);
  L.push(`  older rows in touched lineages ${String(sum(w => w.outsideHorizon)).padStart(2)}   outside the 30d horizon: counted, NOT stamped (only lineages that share a row with the band are read, so this is not every older eligible row)`);

  if (execute) {
    const okCount = stamped.filter(s => s.ok).length;
    L.push('');
    L.push(`## Stamped: ${okCount} of ${stamped.length} attempted`);
    const refused = stamped.filter(s => !s.ok);
    if (refused.length) {
      L.push(`Refused by the store's write filter (changed since select, or no longer taken/unstamped): ${refused.length}`);
      for (const r of refused.slice(0, 20)) L.push(`  ${r.urlKey} ${r.id} (${r.reason})`);
    }
    L.push('');
    L.push(`## Idempotence check: ${remaining} remaining after the run${remaining === 0 ? ' (ok)' : ' — NOT 0, investigate before relying on this'}`);
  } else {
    L.push('');
    L.push('Dry run — nothing was written. Re-run with --execute (only on John\'s recorded yes) to write these stamps.');
  }
  return L.join('\n');
}

export function readHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const execute = process.argv.includes('--execute');
  const byIndex = process.argv.indexOf('--by');
  const by = byIndex !== -1 ? (process.argv[byIndex + 1] || null) : null;

  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  const db = dbClient.db('linear-viewer');
  try {
    const dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
    const { report } = await runLineageBackfill({
      dispatchStore, execute, by, headSha: readHeadSha(), log: (m) => console.error(m)
    });
    console.log(report);
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

// Only run when invoked directly, never on import (test-importable, no side effect).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[lineage-backfill] failed:', err);
    process.exitCode = 1;
  });
}
