// LIN-4519 reading, read-only, run inside harbour-cat from /dev/shm and deleted after. Prints counts and record ids only.
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const { MongoClient } = require('mongodb');
const CUT = new Date('2026-11-22T04:20:39.504Z');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db('linear-viewer');
  const records = db.collection('records');
  const anchor = await records.findOne({ id: 'plan-35aa6b71' }, { projection: { urlKey: 1 } });
  if (!anchor) throw new Error('anchor record not found');
  const urlKey = anchor.urlKey;
  const runIds = await records.distinct('id', { urlKey, kind: 'run', by: 'blind-read' });
  const askers = new Set(runIds.map((id) => 'run:' + id));
  const all = await db.collection('records-query-log').find({ urlKey, at: { $gte: CUT } }, { projection: { _id: 0, at: 1, by: 1, cmd: 1, taskId: 1, recordId: 1 } }).toArray();
  const blind = all.filter((q) => askers.has(q.by));
  const named = new Map();
  for (const id of new Set(blind.map((q) => q.recordId).filter(Boolean))) {
    const r = await records.findOne({ urlKey, id }, { projection: { _id: 0, id: 1, kind: 1, by: 1, run: 1 } });
    if (r) named.set(id, r);
  }
  const rows = blind.map((q) => {
    const r = named.get(q.recordId);
    const runOf = String(q.by).slice(4);
    return {
      at: new Date(q.at).toISOString(), cmd: q.cmd ?? null, taskNamed: !!q.taskId, recordId: q.recordId ?? null,
      recordKind: r ? r.kind : null, recordBy: r ? (String(r.by).startsWith('person:') ? 'person' : r.by) : null,
      own: !!r && (r.run === runOf || q.recordId === runOf), otherBlindRead: !!r && r.by === 'blind-read',
    };
  });
  console.log(JSON.stringify({
    cutover: CUT.toISOString(), asOf: new Date().toISOString(), blindReadRuns: runIds.length,
    queryRowsSinceCutover: all.length, blindReadRowsSinceCutover: blind.length,
    blindReadRunsThatQueried: new Set(blind.map((q) => q.by)).size, rows,
  }, null, 1));
} finally {
  await client.close();
}
