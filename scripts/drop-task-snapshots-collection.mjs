#!/usr/bin/env node
/**
 * One-off operator cleanup for LIN-4502: drop the retired `task-snapshots` collection
 * (modelled on scripts/drop-shares-collection.mjs, LIN-3325).
 *
 * LIN-4502 retired task snapshots; nothing reads or writes `task-snapshots` any more.
 * Its records hold per-task history slices (titles, descriptions, comments) captured
 * at the old recap/brief read seams, and its two indexes are inert. This script drops
 * the whole collection once, after the code has deployed. Then account erasure's row
 * for it (lib/account-erasure.js) can go, with lib/drop-task-snapshots-collection.js.
 *
 * Read-only by default — it prints whether the collection exists and how many
 * records it holds, and drops nothing. Pass `--execute` to actually drop it.
 * Idempotent: a repeat run against an absent collection is a safe no-op.
 *
 * NOT a route and NOT imported by the app. An agent never runs it against
 * production; the operator does, after deploy:
 *   MONGODB_URI=<prod> node scripts/drop-task-snapshots-collection.mjs --execute
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { dropTaskSnapshotsCollection } from '../lib/drop-task-snapshots-collection.js'

async function main() {
  const dryRun = !process.argv.includes('--execute')
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await dropTaskSnapshotsCollection({ db: dbClient.db('linear-viewer'), dryRun, logger: console })
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`)
    if (report.skipped === 'unexpected-error') process.exitCode = 1
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    // The error's class only: its message could carry connection details.
    console.error(`[drop-task-snapshots] failed: ${err?.code ?? err?.name ?? 'error'}`)
    process.exitCode = 1
  })
}
