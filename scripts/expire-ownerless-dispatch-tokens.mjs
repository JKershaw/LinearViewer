#!/usr/bin/env node
/**
 * One-off operator step for LIN-3618: list the dispatch-token rows and, with
 * `--execute`, expire the ownerless ones (set `expiresAt` to now; no row is
 * deleted and no owned row is touched). See lib/expire-ownerless-dispatch-tokens.js.
 *
 * Read-only by default. Exit code 2 = refused, nothing written (an ownerless
 * token was used in the last 30 days, or the local backend was picked without an
 * explicit HARBOUR_DATA_DIR). NOT a route and NOT imported by the app; the
 * operator runs it through the Railway route in docs/operator-execution.md:
 *   MONGODB_URI=<prod> node scripts/expire-ownerless-dispatch-tokens.mjs [--execute]
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * scripts/drop-shares-collection.mjs.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { expireOwnerlessDispatchTokens, DB_NAME, COLLECTION_NAME } from '../lib/expire-ownerless-dispatch-tokens.js'

async function main() {
  const dryRun = !process.argv.includes('--execute')
  const backend = process.env.MONGODB_URI ? 'mongodb' : 'mangodb'
  const dbClient = backend === 'mongodb'
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await expireOwnerlessDispatchTokens({
      collection: dbClient.db(DB_NAME).collection(COLLECTION_NAME),
      backend,
      dataDirExplicit: Boolean(process.env.HARBOUR_DATA_DIR),
      dryRun,
      logger: console
    })
    if (report.refused) process.exitCode = 2
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    // The error's class only: its message could carry connection details.
    console.error(`[expire-ownerless-dispatch-tokens] failed: ${err?.code ?? err?.name ?? 'error'}`)
    process.exitCode = 1
  })
}
