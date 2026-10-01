#!/usr/bin/env node
/**
 * scripts/file-pointer-read.mjs — LIN-3200 P7, the read-side arm/recompute
 * report. Thin, read-only: it loads eligible rows through the store (never the
 * lean proxy list, whose allow-list omits `followUpTo`/`abort`), hands them to
 * the ONE shared `classifyPilotRows`, and prints per-arm tallies.
 *
 * Usage:
 *   node scripts/file-pointer-read.mjs [--url-key <key>] [--json]
 *
 * Env: MONGODB_URI (else HARBOUR_DATA_DIR / ./data), LIN3200_URL_KEY.
 *
 * Output per arm: assigned, delivered (start marker present), assigned-empty,
 * and excluded counts by reason, plus totals and any stated concerns (over 10%
 * excluded, or exclusions lopsided between arms).
 *
 * HISTORY READ (the P7 fix). History is read with an EXCLUSION projection
 * (`{ feedback: 0 }`), never an inclusion like `{ prompt: 1 }`: Mongo's
 * inclusion form returns only `_id` + the included keys, so `_formatHistoryItem`
 * then invents `kind: 'custom'` and drops `issueIdentifier`/`dispatchedAt`, and
 * every archived row fails `isPilotEligible` — the read would see only the live
 * queue. Queue and history are then de-duped by `_id` exactly as P4's
 * `countPilotEligible` does, so a row visible in both during the take/cancel hop
 * is counted once and does not flag itself race-suspect.
 *
 * OPERATOR STEP before trusting a run: search the deploy logs for BOTH
 * `Error archiving dispatch item:` and `Error archiving expired items:` over
 * the window; any hit restarts the comparison window after it (R3). Rows after
 * a retention change or a flag toggle invalidate the recompute — see LIN-3200.
 */
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { FILE_POINTER_MARKER, RACE_SUSPECT_WINDOW_MS, classifyPilotRows } from '../lib/file-pointer.js';

export function parseArgs(argv) {
  const out = { urlKey: process.env.LIN3200_URL_KEY || null, json: false, windowMs: RACE_SUSPECT_WINDOW_MS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url-key') out.urlKey = argv[++i];
    else if (argv[i] === '--window-ms') out.windowMs = Number(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

export function toRow(item) {
  const prompt = typeof item?.prompt === 'string' ? item.prompt : '';
  return {
    id: item?.id ?? item?._id,
    kind: item?.kind,
    followUpTo: item?.followUpTo ?? null,
    abort: item?.abort === true,
    issueIdentifier: item?.issueIdentifier ?? null,
    dispatchedAt: item?.dispatchedAt ?? null,
    resolvedAt: item?.resolvedAt ?? null,
    delivered: prompt.includes(FILE_POINTER_MARKER)
  };
}

/**
 * Merge the live queue and the history list into one row array, de-duped by
 * `_id` (as P4's `countPilotEligible` does). A row may be in one collection, the
 * other, or — for one awaited round trip during a take/cancel hop — both; the
 * de-dupe keeps the recomputed ordinal aligned with the factory's count. Rows
 * without an id are kept (never collapsed) since they cannot be the same row.
 *
 * @param {{liveItems?: Array, historyItems?: Array}} params
 * @returns {Array<Object>} rows, queue first then history
 */
export function mergePilotRows({ liveItems = [], historyItems = [] } = {}) {
  const byId = new Map();
  const noId = [];
  let anonymous = 0;
  for (const item of [...liveItems, ...historyItems]) {
    const row = toRow(item);
    if (row.id == null) {
      row.id = `__noid__${anonymous++}`;
      noId.push(row);
      continue;
    }
    const key = String(row.id);
    if (byId.has(key)) continue;
    byId.set(key, row);
  }
  return [...byId.values(), ...noId];
}

/**
 * Load the eligible-row candidates through the store (queue ∪ history). The
 * history projection is the EXCLUSION `{ feedback: 0 }` — see the file header
 * for why an inclusion projection silently hides every archived row. Fails open
 * to whatever the store could return.
 *
 * @param {DispatchQueueStore} store
 * @param {string} urlKey
 * @returns {Promise<Array<Object>>}
 */
export async function loadPilotRows(store, urlKey) {
  const [history, live] = await Promise.all([
    store.listHistory(urlKey, { projection: { feedback: 0 } }),
    store.listItems(urlKey)
  ]);
  const liveItems = Array.isArray(live) ? live : [];
  const historyItems = Array.isArray(history?.items)
    ? history.items
    : (Array.isArray(history) ? history : []);
  return mergePilotRows({ liveItems, historyItems });
}

function printHuman(urlKey, result) {
  const { totals, concerns } = result;
  const arm = (label, a) => `${label}: assigned ${a.assigned}, delivered ${a.delivered}, assigned-empty ${a.assignedEmpty}, excluded ${a.excluded}`;
  console.log(`file-pointer arm read — urlKey=${urlKey} window=${result.windowMs}ms`);
  console.log(`eligible ${totals.eligible} (positioned ${totals.positioned}, undated ${totals.undated})`);
  console.log(arm('pointer', totals.pointer));
  console.log(arm('control', totals.control));
  console.log(`race-suspect ${totals.raceSuspect}; excluded ${totals.excluded} (${(totals.excludedPct * 100).toFixed(1)}%)`);
  if (concerns.length) {
    console.log('CONCERNS:');
    for (const c of concerns) console.log(`  - ${c}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.urlKey) {
    console.error('Missing --url-key (or LIN3200_URL_KEY).');
    process.exit(2);
  }

  const client = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await client.connect();
  const db = client.db('linear-viewer');

  try {
    const store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });

    const rows = await loadPilotRows(store, args.urlKey);
    const result = classifyPilotRows(rows, { windowMs: args.windowMs });

    if (args.json) {
      console.log(JSON.stringify({ urlKey: args.urlKey, ...result }, null, 2));
    } else {
      printHuman(args.urlKey, result);
    }
  } finally {
    await client.close();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
