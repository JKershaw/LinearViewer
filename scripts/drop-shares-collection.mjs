#!/usr/bin/env node
/**
 * One-off operator cleanup for LIN-3325: drop the retired `shares` collection.
 *
 * Harbour's share-links feature was removed by LIN-3325; nothing reads or writes
 * `shares` any more. Its records hold snapshots of task titles/descriptions from
 * the links that were created, and its two indexes are inert. This script drops
 * the whole collection once, after the code has deployed.
 *
 * Read-only by default — it prints whether the collection exists and how many
 * records it holds, and drops nothing. Pass `--execute` to actually drop it.
 * Idempotent: a repeat run against an absent collection is a safe no-op.
 *
 * NOT a route and NOT imported by the app. An agent never runs it against
 * production; the operator does, after deploy:
 *   MONGODB_URI=<prod> node scripts/drop-shares-collection.mjs --execute
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { dropSharesCollection } from '../lib/drop-shares-collection.js'

async function main() {
  const dryRun = !process.argv.includes('--execute')
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await dropSharesCollection({ db: dbClient.db('linear-viewer'), dryRun, logger: console })
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`)
    if (report.skipped === 'unexpected-error') process.exitCode = 1
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    // The error's class only: its message could carry connection details.
    console.error(`[drop-shares] failed: ${err?.code ?? err?.name ?? 'error'}`)
    process.exitCode = 1
  })
}
