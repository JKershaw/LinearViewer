#!/usr/bin/env node
/**
 * LIN-4496 (piece 5 of LIN-4491): the records readings, read-only. Reads the records store, the records query log and the
 * dispatch queue and history of one workspace, and prints the records rows (open to project, open to stage, sit time),
 * the held-run row (with its window and n), and the stale-open-runs count. Nothing here writes, and nothing gates.
 *
 *   node scripts/records-readings.mjs --urlkey <workspace urlKey> [--as-of <iso>] [--json]
 *
 * The database is the server's, chosen as the importer chooses it: MONGODB_URI when set, else the MangoDB data
 * directory (HARBOUR_DATA_DIR or ./data). Each reading prints its own window and n. The stale-open-runs count is only
 * meaningful from the evening of 21 Nov 2026 (48 hours after the records deploy), and a run is stale when its current
 * version is `open` and that version is more than 24 hours old at the reading time. A reader's own reads never enter
 * the query log (this reads the collections directly), and the held-run reading also leaves out READER's `by`.
 */
import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../lib/records-store.js';
import { STAGE_KINDS } from '../lib/prompts/stage-kinds.js';
import { recordsRows, heldRunReading, heldRunRow, STATUS } from './stability-measures-core.mjs';

export const READER = 'records-readings';
export const STALE_RUN_HOURS = 24;
const DB_NAME = 'linear-viewer';
const DISPATCH_QUEUE = 'dispatch-queue';
const DISPATCH_HISTORY = 'dispatch-history';
const DISPATCH_FIELDS = { _id: 1, kind: 1, status: 1, issueIdentifier: 1, heldWakeFor: 1, heldWakeClaimedAt: 1 };

/**
 * The current version of each record (its `in`, `to`, `state`, and a task's `ref`), its opening time (the first
 * version's `at`), and the open runs whose current version is more than STALE_RUN_HOURS old at `asOf`.
 * @param {object[]} snaps - every version of every record in one workspace (RecordsStore.snapshots)
 */
export function recordsOfSnapshots(snaps, asOf) {
  const first = new Map();
  const current = new Map();
  for (const s of snaps) {
    if (!first.has(s.id) || s.v < first.get(s.id).v) first.set(s.id, s);
    if (!current.has(s.id) || s.v > current.get(s.id).v) current.set(s.id, s);
  }
  const records = [];
  const openRuns = [];
  for (const [id, cur] of current) {
    records.push({ id, kind: cur.kind, state: cur.state, to: cur.to, in: cur.in, ref: cur.kind === 'task' ? cur.fields?.ref : undefined, openedAt: first.get(id).at });
    if (cur.kind === 'run' && cur.state === 'open') openRuns.push({ id, at: cur.at });
  }
  const cutoff = Date.parse(asOf) - STALE_RUN_HOURS * 3600000;
  const stale = openRuns.filter((r) => Date.parse(r.at) < cutoff).map((r) => r.id).sort();
  return { records, staleOpenRuns: { count: stale.length, of: openRuns.length, runs: stale, asOf, olderThanHours: STALE_RUN_HOURS } };
}

/**
 * Every reading from its inputs, pure. Each input is data: `snapshots` (RecordsStore.snapshots), `queryLog` (rows as
 * { at: iso, by, taskId, recordId }), `dispatchRows` (queue and history rows as DISPATCH_FIELDS). Returns the rows in
 * the shared row shape, with the window and n each one was read over.
 */
export function readingsOf({ snapshots, queryLog, dispatchRows, asOf, stageKinds = Object.keys(STAGE_KINDS), measuringReader = READER }) {
  const { records, staleOpenRuns } = recordsOfSnapshots(snapshots, asOf);
  const rows = [
    ...recordsRows({ records, asOf, stageKinds }),
    heldRunRow(heldRunReading({ records, queryLog, dispatchRows, asOf, measuringReader }))
  ];
  return {
    window: { asOf },
    // A source that was not read is null, never zero (the held-run row says so too).
    n: { records: records.length, queryLog: queryLog?.length ?? null, dispatchRows: dispatchRows?.length ?? null },
    rows,
    staleOpenRuns
  };
}

/** The same readings, from a database: the collections read once each, the query log's dates as ISO text. */
export async function readFromDb(db, urlKey, { asOf, stageKinds, measuringReader } = {}) {
  const store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  const snapshots = await store.snapshots(urlKey);
  const logDocs = await db.collection(QUERY_LOG_COLLECTION).find({ urlKey }, { projection: { _id: 0, at: 1, by: 1, taskId: 1, recordId: 1 } }).toArray();
  const queryLog = logDocs.map((q) => ({ ...q, at: q.at instanceof Date ? q.at.toISOString() : q.at }));
  const dispatchRows = [
    ...(await db.collection(DISPATCH_QUEUE).find({ urlKey }, { projection: DISPATCH_FIELDS }).toArray()),
    ...(await db.collection(DISPATCH_HISTORY).find({ urlKey }, { projection: DISPATCH_FIELDS }).toArray())
  ];
  return readingsOf({ snapshots, queryLog, dispatchRows, asOf, stageKinds, measuringReader: measuringReader ?? READER });
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function printReadings(out) {
  console.log(`window: as of ${out.window.asOf}; records ${out.n.records}, query-log rows ${out.n.queryLog}, dispatch rows ${out.n.dispatchRows}`);
  for (const r of out.rows) {
    const body = r.status === STATUS.MEASURED ? JSON.stringify(r.value) : `not measured (${r.reason})`;
    console.log(`${r.key}: ${body}`);
  }
  const s = out.staleOpenRuns;
  console.log(`records.staleOpenRuns: ${s.count} of ${s.of} open runs are older than ${s.olderThanHours} h at ${s.asOf}${s.runs.length ? ` (${s.runs.join(', ')})` : ''}`);
}

async function main() {
  const urlKey = argValue('--urlkey');
  if (!urlKey) {
    console.error('usage: records-readings.mjs --urlkey <urlKey> [--as-of <iso>] [--json]');
    process.exitCode = 2;
    return;
  }
  const asOf = argValue('--as-of') || new Date().toISOString();
  const backend = process.env.MONGODB_URI ? 'mongodb' : 'mangodb';
  const dbClient = backend === 'mongodb' ? new MongoClient(process.env.MONGODB_URI) : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  try {
    const out = await readFromDb(dbClient.db(DB_NAME), urlKey, { asOf });
    if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
    else printReadings(out);
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // The error's class and message only: a connection string is never printed.
    console.error(`records-readings failed: ${err?.name || 'Error'}: ${err?.message || err}`);
    process.exitCode = 1;
  });
}
