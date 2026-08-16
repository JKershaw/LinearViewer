/**
 * Cross-process race worker for LIN-2128's scheduler CAS test (b). A separate
 * OS process, not a same-process concurrency probe — the whole point of the
 * test this feeds is that a same-process probe (like (a)) can pass on
 * MangoDB for the wrong reason (its in-process `Mutex`) and would pass on
 * real MongoDB too without ever exercising cross-process atomicity.
 *
 * Connects to real MongoDB itself (does not go through server.js or any
 * shared client), sleeps until the parent-supplied `raceAtMs` epoch instant
 * so multiple worker processes attempt their CAS acquire within a few ms of
 * each other rather than in whatever order the OS happened to schedule their
 * startup, then makes exactly one `Scheduler._tick` attempt against the
 * shared lock document and records its own outcome.
 *
 * Args: <mongoUri> <dbName> <lockCollectionName> <winnersCollectionName> <workerId> <raceAtMs>
 */
import { MongoClient } from 'mongodb';
import { Scheduler } from '../../lib/scheduler.js';

const [, , mongoUri, dbName, lockCollectionName, winnersCollectionName, workerId, raceAtMsStr] =
  process.argv;
const raceAtMs = Number(raceAtMsStr);

const client = new MongoClient(mongoUri);
await client.connect();
const db = client.db(dbName);

const scheduler = new Scheduler({
  collection: db.collection(lockCollectionName),
  // Silence — a losing worker's log noise would otherwise interleave with
  // the parent test runner's own output.
  logger: { warn: () => {} }
});

const job = {
  name: 'race',
  lockId: 'tick:race',
  intervalMs: 60_000,
  leaseMs: 30_000,
  run: async () => {
    await db.collection(winnersCollectionName).insertOne({ _id: workerId, at: Date.now() });
  }
};

const waitMs = raceAtMs - Date.now();
if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

await scheduler._tick(job);
await client.close();
