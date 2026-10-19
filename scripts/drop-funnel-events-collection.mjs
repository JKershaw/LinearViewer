#!/usr/bin/env node
/**
 * One-off operator cleanup for LIN-3632: drop the retired `funnel-events`
 * collection.
 *
 * LIN-3500 deleted the funnel-events store; nothing reads or writes the
 * collection any more, and `ensureIndexes` is create-only, so the (expected
 * empty) collection and its { step, accountId, at } index linger in any database
 * that has them. This script drops it once, count first.
 *
 * Dry run by default: it reports one JSON object and changes nothing. `--drop`
 * is the only flag; it drops only when the collection exists and
 * `countDocuments({})` is exactly 0. A non-zero or unreadable count refuses
 * (exit 1); an absent collection is a no-op (exit 0); any other flag exits 2
 * before anything is opened. It never reads a document and prints only error
 * codes or names, never a message, document content or connection string.
 *
 * NOT a route and NOT imported by the app: the app must never run it, and no
 * lib/ module may name the collection (the class guard in
 * tests/unit/urlkey-holders.test.js scans lib/ for collection literals). The
 * operator runs it against production through the Railway route recorded in
 * docs/operator-execution.md (LIN-3204), from the checkout holding this file,
 * with the flag INSIDE the quoted sh -c string:
 *   railway run -p <project> -e production -s MongoDB-harbour -- \
 *     sh -c 'MONGODB_URI="$MONGO_PUBLIC_URL" node scripts/drop-funnel-events-collection.mjs [--drop]'
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js.
 */

import { pathToFileURL } from 'node:url'

const COLLECTION = 'funnel-events'
const DATABASE = 'linear-viewer'

export function parseArgs(argv) {
  if (argv.length === 0) return { drop: false }
  if (argv.length === 1 && argv[0] === '--drop') return { drop: true }
  const err = new Error('usage: drop-funnel-events-collection.mjs [--drop]')
  err.code = 'usage'
  throw err
}

export function exitCodeFor(report) {
  if (report.outcome === 'usage') return 2
  if (report.outcome === 'refused-not-empty' || report.outcome === 'refused-count-unreadable') return 1
  return 0
}

const codeOf = err => err?.code ?? err?.name ?? 'error'

export async function dropFunnelEventsCollection({ db, drop = false, logger = console }) {
  const collections = await db.listCollections().toArray()
  const existed = collections.some(c => c.name === COLLECTION)
  const collection = db.collection(COLLECTION)

  let count = null
  try {
    count = await collection.countDocuments({})
  } catch (err) {
    logger.error(`[drop-funnel-events] count failed: ${codeOf(err)}`)
  }

  // Real MongoDB throws code 26 from listIndexes() on an absent collection.
  let indexes = null
  if (existed) {
    try {
      indexes = (await collection.listIndexes().toArray()).map(({ name, key }) => ({ name, key }))
    } catch (err) {
      logger.error(`[drop-funnel-events] listIndexes failed: ${codeOf(err)}`)
    }
  }

  const report = {
    backend: process.env.MONGODB_URI ? 'mongodb' : 'local-mangodb',
    database: db.databaseName ?? db.name ?? DATABASE,
    collectionsInDatabase: collections.length,
    existed,
    count,
    indexes,
    mode: drop ? 'drop' : 'dry-run',
    outcome: 'dry-run'
  }

  if (!existed) {
    report.outcome = 'absent'
  } else if (drop) {
    if (count === null) report.outcome = 'refused-count-unreadable'
    else if (count !== 0) report.outcome = 'refused-not-empty'
    else {
      await collection.drop()
      report.outcome = 'dropped'
    }
  }
  logger.log(`[drop-funnel-events] ${report.outcome}`)
  return report
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    process.exitCode = exitCodeFor({ outcome: 'usage' })
    return
  }
  const { MongoClient } = await import('mongodb')
  const { MangoClient } = await import('@jkershaw/mangodb')
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await dropFunnelEventsCollection({ db: dbClient.db(DATABASE), drop: args.drop, logger: console })
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = exitCodeFor(report)
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(err => {
    // The error's code or name only: its message could carry connection details.
    console.error(`[drop-funnel-events] failed: ${codeOf(err)}`)
    process.exitCode = 1
  })
}
