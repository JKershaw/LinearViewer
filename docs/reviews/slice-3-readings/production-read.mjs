// LIN-4514 throwaway, read-only, run inside harbour-cat. Prints counts and record ids only; never the environment.
import { MongoClient } from 'mongodb';
import { readFromDb, recordsOfSnapshots, READER } from '/app/scripts/records-readings.mjs';
import { heldRunReading, median, round } from '/app/scripts/stability-measures-core.mjs';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '/app/lib/records-store.js';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db('linear-viewer');
  const records = db.collection(RECORDS_COLLECTION);
  // The workspace: the one holding LIN-4514's plan piece (its key is used here and never printed).
  const anchor = await records.findOne({ id: 'plan-35aa6b71' }, { projection: { urlKey: 1 } });
  if (!anchor) throw new Error('anchor record not found');
  const urlKey = anchor.urlKey;
  const asOf = new Date().toISOString();

  // 1. Slice 2's method: scripts/records-readings.mjs readFromDb (heldRunReading inside), read-only.
  const readings = await readFromDb(db, urlKey, { asOf });

  const store = new RecordsStore({ records, refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  const { records: current } = recordsOfSnapshots(await store.snapshots(urlKey), asOf);
  const qlog = (await db.collection(QUERY_LOG_COLLECTION).find({ urlKey }, { projection: { _id: 0, at: 1, by: 1, taskId: 1, recordId: 1 } }).toArray()).map((q) => ({ ...q, at: q.at instanceof Date ? q.at.toISOString() : q.at }));
  const DF = { _id: 1, kind: 1, status: 1, lineageStatus: 1, issueIdentifier: 1, heldWakeFor: 1, heldWakeClaimedAt: 1 };
  const rows = [...await db.collection('dispatch-queue').find({ urlKey }, { projection: DF }).toArray(), ...await db.collection('dispatch-history').find({ urlKey }, { projection: DF }).toArray()];
  const held = heldRunReading({ records: current, queryLog: qlog, dispatchRows: rows, asOf, measuringReader: READER });
  const tasks = new Map(current.filter((r) => r.kind === 'task').map((r) => [r.id, r.ref]));
  const groupOf = (to) => (tasks.has(to) ? `task of ${tasks.get(to) ?? 'no ticket'}` : to);
  const groups = {};
  for (const s of held.sample) (groups[groupOf(s.to)] ||= []).push(s);
  const split = Object.fromEntries(Object.entries(groups).map(([g, xs]) => {
    const read = xs.filter((x) => !x.censored);
    const m = median(read.map((x) => x.sitHours));
    return [g, { records: xs.length, read: read.length, censored: xs.length - read.length, medianSitHours: m == null ? null : round(m, 2), sits: xs.map((x) => (x.censored ? `${x.sitHours} (unread)` : x.sitHours)).sort() }];
  }));

  // 2. Blind-read queries in the query log, classified by what they named.
  const blindRuns = await records.distinct('id', { urlKey, kind: 'run', by: 'blind-read' });
  const askers = new Set(blindRuns.map((id) => `run:${id}`));
  const runOfAsker = (by) => String(by).slice(4);
  const log = (await db.collection(QUERY_LOG_COLLECTION).find({ urlKey }, { projection: { _id: 0, at: 1, by: 1, cmd: 1, taskId: 1, recordId: 1 } }).toArray()).filter((q) => askers.has(q.by));
  const allLog = await db.collection(QUERY_LOG_COLLECTION).aggregate([{ $match: { urlKey } }, { $group: { _id: '$by', n: { $sum: 1 }, first: { $min: '$at' }, last: { $max: '$at' } } }]).toArray();
  const ids = [...new Set(log.map((q) => q.recordId).filter(Boolean))];
  const named = new Map();
  for (const id of ids) {
    const first = await records.find({ urlKey, id }, { projection: { _id: 0, id: 1, kind: 1, by: 1, v: 1, run: 1 } }).sort({ v: 1 }).limit(1).toArray();
    if (first[0]) named.set(id, first[0]);
  }
  const classOf = (q) => {
    if (!q.recordId) return q.taskId ? 'task-wide (no record named)' : 'no task or record named';
    const r = named.get(q.recordId);
    if (!r) return 'a record not found';
    if (r.run === runOfAsker(q.by) || q.recordId === runOfAsker(q.by)) return 'its own records (written under its run, or its run)';
    if (r.by === 'blind-read') return 'another blind read\'s records';
    if (r.kind === 'change') return 'a change';
    return `another record (${r.kind}, by ${String(r.by).startsWith('person:') ? 'a person' : r.by})`;
  };
  const byClass = {};
  const byCmd = {};
  for (const q of log) { const k = classOf(q); byClass[k] = (byClass[k] || 0) + 1; byCmd[q.cmd ?? 'none'] = (byCmd[q.cmd ?? 'none'] || 0) + 1; }
  const blindRunRecords = blindRuns.length;
  const runsThatQueried = new Set(log.map((q) => q.by)).size;
  const changeRecords = await records.distinct('id', { urlKey, kind: 'change' });
  const verdictRecords = await records.distinct('id', { urlKey, kind: 'verdict' });

  const ats = log.map((q) => (q.at instanceof Date ? q.at.toISOString() : q.at)).sort();
  console.log(JSON.stringify({
    asOf,
    heldRuns: readings.rows.find((r) => r.key === 'records.heldRuns'),
    sitTime: readings.rows.find((r) => r.key === 'records.sitTime'),
    n: readings.n,
    staleOpenRuns: { count: readings.staleOpenRuns.count, of: readings.staleOpenRuns.of },
    blindReadQueries: { rows: log.length, first: ats[0] ?? null, last: ats.at(-1) ?? null, byClass, byCmd, blindReadRunRecords: blindRunRecords, runsThatQueried },
    heldRunSplit: { held: held.held, addressed: held.addressed, read: held.read, censored: held.censored, medianSitHours: held.medianSitHours, byAddressee: split },
    queryLogSpan: { rows: allLog.reduce((a, g) => a + g.n, 0), first: allLog.map((g) => new Date(g.first).toISOString()).sort()[0] ?? null, last: allLog.map((g) => new Date(g.last).toISOString()).sort().at(-1) ?? null },
    join: await (async () => {
      const runIds = new Set(await records.distinct('id', { urlKey, kind: 'run' }));
      const runAskers = allLog.filter((g) => String(g._id).startsWith('run:'));
      const matched = runAskers.filter((g) => runIds.has(String(g._id).slice(4)));
      const byOfMatched = {};
      for (const g of matched) {
        const r = await records.find({ urlKey, id: String(g._id).slice(4) }, { projection: { _id: 0, by: 1 } }).limit(1).toArray();
        const k = r[0]?.by ?? 'unknown'; byOfMatched[k] = (byOfMatched[k] || 0) + g.n;
      }
      return { runAskers: runAskers.length, matchedToRunRecords: matched.length, queryRowsByRunStage: byOfMatched };
    })(),
    store: { changeRecords: changeRecords.length, verdictRecords: verdictRecords.length },
  }, null, 2));
} finally {
  await client.close();
}
