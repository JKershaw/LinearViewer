#!/usr/bin/env node
/**
 * scripts/lin3014/replay.mjs (LIN-3014)
 *
 * The local replay copy ruling `16c2be3e` authorized: copy a production
 * `dispatch-history` window (excluding `prompt`) into a throwaway local
 * `mongod`, so the equivalence sample can run `getLoopsForWorkspace`/
 * `getSessionsForWorkspace` against it without touching production for every
 * comparison. `--delete` runs the mandatory teardown and logs a structured
 * deletion record (path + command) meant to be posted verbatim on the
 * ticket — the copy must never be left behind.
 *
 * READ-ONLY against production (a `find`, never a write); the only write
 * this script makes is into the throwaway LOCAL mongod, which is not
 * production and is never the target the role guard restricts.
 *
 * Usage:
 *   LIN3014_MONGO_URI=mongodb://<read-user>@... node scripts/lin3014/replay.mjs copy \
 *     --url-key linearviewer --since-days 30 \
 *     --local-uri mongodb://127.0.0.1:27999/lv_replay --local-collection dispatch-history
 *   node scripts/lin3014/replay.mjs delete \
 *     --local-uri mongodb://127.0.0.1:27999/lv_replay --local-collection dispatch-history
 */
import { MongoClient } from 'mongodb';
import { assertSafeConnection, isLoopbackHost } from './lib/guard.mjs';
import { replayProjection, replayWindowQuery, buildDeletionRecord } from './lib/replay-core.mjs';

/**
 * Reads the replay window from a production collection. Pulled out of
 * `copy()` so it's testable against a stub collection: the MongoDB NODE
 * DRIVER's `find(filter, options)` takes the projection under
 * `options.projection`, NOT as the bare second positional argument — that
 * shape is mongosh's `find(query, projection)`, a different API. Passing
 * `replayProjection()` directly as the second arg (the original bug here)
 * silently becomes an ignored `options` object and every field, including
 * `prompt`, comes back — exactly what ruling `16c2be3e` forbids.
 *
 * @param {Object} prodCollection - a collection with a `.find(filter, options)` method
 * @param {Object} opts
 * @param {string} opts.urlKey
 * @param {number} opts.sinceMs
 */
export async function copyProductionWindow(prodCollection, { urlKey, sinceMs }) {
  const query = replayWindowQuery({ urlKey, sinceMs });
  return prodCollection.find(query, { projection: replayProjection() }).toArray();
}

function parseArgs(argv) {
  const args = { urlKey: 'linearviewer', sinceDays: 30, localCollection: 'dispatch-history' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url-key') args.urlKey = argv[++i];
    else if (argv[i] === '--since-days') args.sinceDays = Number(argv[++i]);
    else if (argv[i] === '--local-uri') args.localUri = argv[++i];
    else if (argv[i] === '--local-collection') args.localCollection = argv[++i];
  }
  return args;
}

async function copy(args) {
  const prodUri = process.env.LIN3014_MONGO_URI;
  if (!prodUri) throw new Error('set LIN3014_MONGO_URI (never printed)');
  if (!args.localUri) throw new Error('--local-uri is required');
  const localHost = new URL(args.localUri.replace('mongodb://', 'http://')).hostname;
  if (!isLoopbackHost(localHost)) {
    throw new Error(`refusing to copy INTO ${localHost}: the replay target must be a loopback mongod (guard.mjs)`);
  }

  const prodClient = new MongoClient(prodUri);
  const localClient = new MongoClient(args.localUri);
  await Promise.all([prodClient.connect(), localClient.connect()]);
  try {
    const prodDb = prodClient.db();
    const connectionStatus = await prodDb.command({ connectionStatus: 1 });
    assertSafeConnection(connectionStatus, { isLocalReplayTarget: false }); // the SOURCE must be the read-only user

    const sinceMs = Date.now() - args.sinceDays * 24 * 3600e3;
    const docs = await copyProductionWindow(prodDb.collection('dispatch-history'), { urlKey: args.urlKey, sinceMs });
    console.log(`replay copy: read ${docs.length} row(s) from production (urlKey=${args.urlKey}, prompt excluded)`);

    const localDb = localClient.db();
    const localColl = localDb.collection(args.localCollection);
    if (docs.length) await localColl.insertMany(docs);
    console.log(`replay copy: wrote ${docs.length} row(s) into ${args.localUri}/${args.localCollection}`);
    console.log('REMINDER: this copy must be deleted after use — run `node scripts/lin3014/replay.mjs delete ...` and record the output on LIN-3014.');
  } finally {
    await Promise.all([prodClient.close(), localClient.close()]);
  }
}

async function del(args) {
  if (!args.localUri) throw new Error('--local-uri is required');
  const localHost = new URL(args.localUri.replace('mongodb://', 'http://')).hostname;
  if (!isLoopbackHost(localHost)) {
    throw new Error(`refusing to touch ${localHost}: delete only ever targets the loopback replay mongod (guard.mjs)`);
  }

  const client = new MongoClient(args.localUri);
  await client.connect();
  try {
    const coll = client.db().collection(args.localCollection);
    const rowsDeleted = await coll.countDocuments({});
    const command = `db.getCollection(${JSON.stringify(args.localCollection)}).drop()`;
    await coll.drop().catch((err) => {
      if (!/ns not found/i.test(err.message)) throw err;
    });
    const record = buildDeletionRecord({
      dbPath: args.localUri,
      collectionName: args.localCollection,
      rowsDeleted,
      command
    });
    console.log(JSON.stringify(record));
    console.log('Post this line verbatim on LIN-3014 as the deletion record.');
  } finally {
    await client.close();
  }
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (sub === 'copy') return copy(args);
  if (sub === 'delete') return del(args);
  console.error('usage: node scripts/lin3014/replay.mjs <copy|delete> --local-uri mongodb://127.0.0.1:PORT/DB [...]');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
