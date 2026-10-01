#!/usr/bin/env node
/**
 * Read-only operator dry run of the LIN-3142 owner backfill: which ownerless
 * workspaces the boot step would give John's account as owner.
 *
 * It calls the very same `runOwnerBackfill({ db, write: false })` that boot
 * runs in write mode (lib/owner-backfill.js), so the dry run equals the boot
 * plan: one code path, no copy. It prints the per-target lines
 * (`[owner-backfill] target workspace=… kind=… edges=… johnAlreadyMember=…
 * outcome=would-assign`), the one summary line with `mode=dry-run`, and then
 * a JSON report `{ gates, targets, undatable, summary }`.
 *
 * Gate results are reported but do not stop planning here: with the owner
 * index missing the summary still lists targets and says
 * `skipped=owner-index-missing`; with John's identity unresolved,
 * `johnAlreadyMember` prints `unknown`. Nothing is ever written.
 *
 * Read-only, no flags (the ruling allows none). NOT a route and NOT imported
 * by the app. Secret-safe for the same reasons as the boot step: workspace
 * ids, kinds, edge counts, the pinned account id and the cutoff are printed;
 * credentials, tokens, emails, session data, `identities[]` contents and error
 * message text never are.
 *
 * The boot log is the plan of record. If John wants a dry run against
 * production, the exact command is (an agent never runs it):
 *   MONGODB_URI=<prod> node scripts/dry-run-owner-backfill.mjs
 *
 * Usage:
 *   node scripts/dry-run-owner-backfill.mjs
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js and scripts/dry-run-workspace-ownership.mjs.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { runOwnerBackfill } from '../lib/owner-backfill.js'

async function main() {
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await runOwnerBackfill({ db: dbClient.db('linear-viewer'), write: false, logger: console })
    const { gates, targets, undatable, summary } = report
    process.stdout.write(`\n${JSON.stringify({ gates, targets, undatable, summary }, null, 2)}\n`)
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    // The error's class only: its message could carry connection details.
    console.error(`[dry-run] failed: ${err?.code ?? err?.name ?? 'error'}`)
    process.exitCode = 1
  })
}
