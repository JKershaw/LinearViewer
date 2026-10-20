#!/usr/bin/env node
/**
 * KPI daily rollup backfill (LIN-3724): writes `kpi-daily-rollup` rows for UTC
 * days that have already left the 30-day read horizon, so the daily job
 * (which only rewrites in-horizon days) never has to.
 *
 * DRY RUN BY DEFAULT: without `--write` nothing is written. The dry run reads
 * the audit window and prints the plan, each workspace's oldest day (skipped,
 * possibly partial) and the lower-bound figure of lineages the lookback loses.
 * NOT a route and NOT imported by the app; an agent never runs it against
 * production. The steps and the approval it needs are in
 * docs/runbooks/kpi-daily-rollup-backfill.md.
 *
 * Usage:
 *   MONGODB_URI=<set in your shell> node scripts/backfill-kpi-daily-rollup.mjs --plan-only
 *   MONGODB_URI=<set in your shell> node scripts/backfill-kpi-daily-rollup.mjs
 *   MONGODB_URI=<set in your shell> node scripts/backfill-kpi-daily-rollup.mjs --write --from YYYY-MM-DD --to YYYY-MM-DD
 *
 * Exit codes: 0 done, 1 failed, 2 neither MONGODB_URI nor HARBOUR_DATA_DIR is
 * set, 3 the `{ urlKey: 1, dispatchedAt: 1 }` index is missing, 4 a refused
 * --from/--to.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { runBackfill, EXIT_NO_DATABASE } from '../lib/kpi-daily-rollup.js'

export function parseArgs(argv) {
  const opts = { write: false, planOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') opts.write = true
    else if (arg === '--plan-only') opts.planOnly = true
    else if (arg === '--from') opts.from = argv[++i]
    else if (arg === '--to') opts.to = argv[++i]
    else throw Object.assign(new Error(`unknown argument ${arg}`), { code: 1 })
  }
  return opts
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (!env.MONGODB_URI && !env.HARBOUR_DATA_DIR) {
    console.error('[backfill] set MONGODB_URI or HARBOUR_DATA_DIR')
    return EXIT_NO_DATABASE
  }
  const opts = parseArgs(argv)
  const dbClient = env.MONGODB_URI ? new MongoClient(env.MONGODB_URI) : new MangoClient(env.HARBOUR_DATA_DIR)
  await dbClient.connect()
  try {
    const report = await runBackfill({ db: dbClient.db('linear-viewer'), ...opts, logger: console })
    process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`)
    return 0
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => { process.exitCode = code }).catch(err => {
    // The error's class/message only for our own refusals: a driver error's message could carry connection details.
    console.error(`[backfill] failed: ${err?.name === 'BackfillError' ? err.message : (err?.code ?? err?.name ?? 'error')}`)
    process.exitCode = Number.isInteger(err?.code) ? err.code : 1
  })
}
