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
 * set, 3 the `{ urlKey: 1, dispatchedAt: 1 }` index is not confirmed built:
 * missing, `dispatch-history` absent, or the index state unreadable (LIN-3811),
 * 4 a refused --from/--to.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { runBackfill, BackfillError, EXIT_NO_DATABASE, EXIT_BAD_RANGE } from '../lib/kpi-daily-rollup.js'

export function parseArgs(argv) {
  const opts = { write: false, planOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') opts.write = true
    else if (arg === '--plan-only') opts.planOnly = true
    else if (arg === '--from' || arg === '--to') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new BackfillError(`${arg} needs a YYYY-MM-DD value`, EXIT_BAD_RANGE)
      opts[arg.slice(2)] = value
    } else throw new BackfillError(`unknown argument ${arg}`, 1)
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

/** Only our own refusals carry a meaningful code: a driver error's integer `code` (2 BadValue, 13 Unauthorized, ...) must not read as this script's 2 or 4. */
export const exitCodeOf = (err) => (err?.name === 'BackfillError' ? err.code : 1)

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => { process.exitCode = code }).catch(err => {
    // The error's class/message only for our own refusals: a driver error's message could carry connection details.
    console.error(`[backfill] failed: ${err?.name === 'BackfillError' ? err.message : (err?.code ?? err?.name ?? 'error')}`)
    process.exitCode = exitCodeOf(err)
  })
}
