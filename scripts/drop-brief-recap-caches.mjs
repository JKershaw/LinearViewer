#!/usr/bin/env node
/**
 * One-off operator cleanup for LIN-4537: drop the retired `brief-cache` and `recap-cache` collections
 * (modelled on scripts/drop-task-snapshots-collection.mjs, LIN-4502).
 *
 * LIN-4537 retired the model-written brief and recap; nothing reads or writes either cache any more. Their records
 * hold a model's summaries of tickets, derived and re-derivable. This script drops both collections once, after the
 * code has deployed. Then account erasure's rows for them (lib/account-erasure.js), the urlkey census and the dry-run
 * duplicates script's entries can go, with lib/drop-brief-recap-caches.js.
 *
 * Read-only by default — it prints whether each collection exists and how many records it holds, and drops nothing.
 * Pass `--execute` to actually drop them. Idempotent: a repeat run against absent collections is a safe no-op.
 *
 * NOT a route and NOT imported by the app. An agent never runs it against production; the operator does, after deploy:
 *   MONGODB_URI=<prod> node scripts/drop-brief-recap-caches.mjs --execute
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as server.js.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { dropBriefRecapCaches } from '../lib/drop-brief-recap-caches.js'

async function main() {
  const dryRun = !process.argv.includes('--execute')
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await dropBriefRecapCaches({ db: dbClient.db('linear-viewer'), dryRun, logger: console })
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`)
    if (report.collections.some(c => c.skipped === 'unexpected-error')) process.exitCode = 1
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    // The error's class only: its message could carry connection details.
    console.error(`[drop-brief-recap-caches] failed: ${err?.code ?? err?.name ?? 'error'}`)
    process.exitCode = 1
  })
}
