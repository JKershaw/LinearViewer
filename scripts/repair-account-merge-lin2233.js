#!/usr/bin/env node
/**
 * One-time operator repair (LIN-2233, L2.3 of the LIN-2231 design).
 *
 * NOT a route, NOT autopilot-reachable, NOT auto-executed on boot or anywhere
 * else — this file has no import site in the app. An operator runs it once,
 * by hand, against the specific field incident it names:
 *
 *   1. Merges the confirmed field-incident fork — the stale account
 *      (c7a8ac8f-ca03-4c06-b435-4af436c8f35f) — into the live canonical
 *      account (e7e948a4-2951-4af4-b60e-572a473a491e) via
 *      `AccountStore.mergeAccounts`. Alias-only: writes `mergedInto` on the
 *      stale account, re-binds its workspace edges onto the canonical
 *      account, never touches identities[]/owner-credentials/content stores.
 *   2. Deletes the orphaned `account-workspaces` row
 *      (e0c6d3cc-bf29-439f-a0d3-45fdb35ac9eb) — but ONLY after a read-only
 *      check confirms nothing else references its `workspaceId`. That
 *      `workspaceId` value is itself an ACCOUNT id (the canonical account's),
 *      not a real workspace id — a stale/out-of-band artifact per the LIN-2231
 *      design's own analysis (comment 8032c01c, open question 2). The check:
 *      if any OTHER account-workspaces row shares that same `workspaceId`,
 *      deletion is refused and reported rather than guessed at.
 *
 * Usage:
 *   node scripts/repair-account-merge-lin2233.js              # dry run — reports what it WOULD do, writes nothing
 *   node scripts/repair-account-merge-lin2233.js --execute    # performs the merge + orphan-row cleanup
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js. Do NOT run this against production without first running the
 * dry run and reviewing its report — and never with a MONGODB_URI/
 * HARBOUR_DATA_DIR pointed at production unless this specific repair is what
 * you intend to perform right now.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { AccountStore } from '../lib/account-store.js'
import { AccountWorkspaceStore } from '../lib/account-workspace-store.js'
import { AccountMergeLogStore } from '../lib/account-merge-log.js'

export const CANONICAL_ACCOUNT_ID = 'e7e948a4-2951-4af4-b60e-572a473a491e'
export const STALE_ACCOUNT_ID = 'c7a8ac8f-ca03-4c06-b435-4af436c8f35f'
export const ORPHAN_ROW_ID = 'e0c6d3cc-bf29-439f-a0d3-45fdb35ac9eb'

/**
 * Read-only check: is it safe to delete the orphan `account-workspaces` row?
 * Safe iff no OTHER row in the collection shares its `workspaceId` — i.e.
 * nothing else could be relying on that value resolving to a real workspace.
 *
 * @param {Object} accountWorkspacesCollection
 * @returns {Promise<{row: Object|null, safe: boolean, siblings: Object[]}>}
 */
export async function checkOrphanRowSafeToDelete(accountWorkspacesCollection) {
  const row = await accountWorkspacesCollection.findOne({ _id: ORPHAN_ROW_ID })
  if (!row) {
    return { row: null, safe: false, siblings: [] }
  }
  const siblings = await accountWorkspacesCollection.find({
    workspaceId: row.workspaceId,
    _id: { $ne: ORPHAN_ROW_ID }
  }).toArray()
  return { row, safe: siblings.length === 0, siblings }
}

/**
 * Runs the repair. Exported (rather than only invoked from `main`) so tests
 * can drive it directly against a real Mango instance without shelling out.
 *
 * @param {Object} params
 * @param {Object} params.db - a connected MongoDB/MangoDB database handle
 * @param {boolean} [params.execute=false] - when false (default), performs every
 *   read and check but writes nothing — a dry run.
 * @param {(msg: string) => void} [params.log=console.log]
 * @returns {Promise<{merge: Object, orphanRow: {row: Object|null, safe: boolean, siblings: Object[]}, deleted: boolean}>}
 */
export async function runRepair({ db, execute = false, log = console.log }) {
  const accountStore = new AccountStore({ collection: db.collection('accounts') })
  const accountWorkspaceStore = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') })
  const mergeLogStore = new AccountMergeLogStore({ collection: db.collection('account-merge-events') })
  const accountWorkspacesCollection = db.collection('account-workspaces')

  log(`[repair] ${execute ? 'EXECUTE' : 'DRY RUN'} — LIN-2233 one-time repair`)

  // --- Step 1: merge the stale account into the canonical account ---
  const canonical = await accountStore.getAccount(CANONICAL_ACCOUNT_ID)
  const stale = await accountStore.getAccount(STALE_ACCOUNT_ID)
  log(`[repair] canonical account ${CANONICAL_ACCOUNT_ID}: ${canonical ? 'found' : 'MISSING'}`)
  log(`[repair] stale account ${STALE_ACCOUNT_ID}: ${stale ? 'found' : 'MISSING'}${stale?.mergedInto ? ` (already mergedInto=${stale.mergedInto})` : ''}`)

  let merge
  if (!execute) {
    merge = canonical && stale
      ? { ok: true, dryRun: true, wouldMerge: !stale.mergedInto, alreadyMerged: stale.mergedInto === CANONICAL_ACCOUNT_ID }
      : { ok: false, reason: !canonical ? 'unknown-canonical' : 'unknown-merged', dryRun: true }
  } else {
    merge = await accountStore.mergeAccounts(CANONICAL_ACCOUNT_ID, STALE_ACCOUNT_ID, { accountWorkspaceStore, mergeLogStore })
    log(`[repair] mergeAccounts result: ${JSON.stringify(merge)}`)
  }

  // --- Step 2: read-only check, then (only on --execute) delete the orphan row ---
  const orphanCheck = await checkOrphanRowSafeToDelete(accountWorkspacesCollection)
  if (!orphanCheck.row) {
    log(`[repair] orphan row ${ORPHAN_ROW_ID}: not found (already absent — nothing to delete)`)
  } else if (!orphanCheck.safe) {
    log(`[repair] orphan row ${ORPHAN_ROW_ID}: NOT SAFE to delete — ${orphanCheck.siblings.length} other row(s) share its workspaceId (${orphanCheck.row.workspaceId}). Refusing to delete; review manually.`)
  } else {
    log(`[repair] orphan row ${ORPHAN_ROW_ID}: safe to delete — no other row references workspaceId ${orphanCheck.row.workspaceId}`)
  }

  let deleted = false
  if (execute && orphanCheck.row && orphanCheck.safe) {
    await accountWorkspacesCollection.deleteOne({ _id: ORPHAN_ROW_ID })
    deleted = true
    log(`[repair] orphan row ${ORPHAN_ROW_ID}: deleted`)
  } else if (!execute && orphanCheck.row && orphanCheck.safe) {
    log(`[repair] orphan row ${ORPHAN_ROW_ID}: would be deleted (dry run — no write performed)`)
  }

  return { merge, orphanRow: orphanCheck, deleted }
}

async function main() {
  const execute = process.argv.includes('--execute')

  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  const db = dbClient.db('linear-viewer')

  try {
    const result = await runRepair({ db, execute })
    if (!execute) {
      console.log('\n[repair] Dry run complete. Re-run with --execute to write these changes.')
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

// Only run when invoked directly (`node scripts/repair-account-merge-lin2233.js`),
// never on import — this is what keeps the script test-importable without side effects.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[repair] failed:', err)
    process.exitCode = 1
  })
}
