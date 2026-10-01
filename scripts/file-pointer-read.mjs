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
 * OPERATOR STEP before trusting a run: search the deploy logs for BOTH
 * `Error archiving dispatch item:` and `Error archiving expired items:` over
 * the window; any hit restarts the comparison window after it (R3). Rows after
 * a retention change or a flag toggle invalidate the recompute — see LIN-3200.
 */
import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { FILE_POINTER_MARKER, RACE_SUSPECT_WINDOW_MS, classifyPilotRows } from '../lib/file-pointer.js';

function parseArgs(argv) {
  const out = { urlKey: process.env.LIN3200_URL_KEY || null, json: false, windowMs: RACE_SUSPECT_WINDOW_MS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url-key') out.urlKey = argv[++i];
    else if (argv[i] === '--window-ms') out.windowMs = Number(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function toRow(item) {
  const prompt = typeof item?.prompt === 'string' ? item.prompt : '';
  return {
    id: item?.id,
    kind: item?.kind,
    followUpTo: item?.followUpTo ?? null,
    abort: item?.abort === true,
    issueIdentifier: item?.issueIdentifier ?? null,
    dispatchedAt: item?.dispatchedAt ?? null,
    resolvedAt: item?.resolvedAt ?? null,
    delivered: prompt.includes(FILE_POINTER_MARKER)
  };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

    const [history, live] = await Promise.all([
      store.listHistory(args.urlKey, { projection: { prompt: 1 } }),
      store.listItems(args.urlKey)
    ]);

    const rows = [
      ...(Array.isArray(live) ? live : []).map(toRow),
      ...((history?.items || []).map(toRow))
    ];
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
