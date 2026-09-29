#!/usr/bin/env node
/**
 * Operator rollback for the LIN-3124 connection-backed cutover (plan D11).
 *
 * Pre-cutover code cannot read a connection-backed binding
 * (`{provider, scope, connectionId}`, credential on the Connection). The named
 * rollback is therefore, in order:
 *
 *   1. set `CONNECTION_BACKED_WRITES=off` BEFORE (or with) any code revert, so
 *      no new connection-backed binding is created;
 *   2. list the affected workspaces: `connections` rows whose `referents` is
 *      non-empty (this script's report, `affected`);
 *   3. drain traffic (so no live session re-saves over the revert), then run
 *      this script: for every connection-backed binding in every stored
 *      session it writes the Connection's credential back into the binding (and
 *      the scalar mirror when it is the D2-marked active binding) and, for the
 *      refresh-token kinds (linear, jira), copies the connection-keyed owner
 *      record to the legacy key `${accountId}::${urlKey}::${provider}` FIRST, so
 *      a reverted binding always has a durable refresh token. LAST it removes the
 *      reverted binding's referent from the Connection, and deletes the
 *      Connection and its connection-keyed record once no referent is left, so
 *      the connection-first read arm can no longer find the reverted workspace:
 *      exactly one live copy of each rotating refresh token (the legacy one);
 *   4. anything skipped is re-linked by the user (the report says why).
 *
 * Properties (pinned by tests/unit/revert-connection-backed.test.js, T28):
 *   - DRY RUN BY DEFAULT: nothing is written without `--execute`;
 *   - IDEMPOTENT: a second run finds no connection-backed binding and writes
 *     nothing; a legacy record already holding the same refresh token is not
 *     rewritten;
 *   - ONE LIVE COPY (review blocker 6): a reverted binding's referent is
 *     removed and its Connection + connection-keyed record are deleted only
 *     when unreferenced (a Connection still referenced by another, unreverted
 *     binding keeps both); nothing is deleted before the legacy record and the
 *     session have been written; a legacy key already holding a DIFFERENT
 *     refresh token (a co-resident legacy site's grant) is never overwritten —
 *     that binding is skipped instead, and keeps its Connection;
 *   - SECRET-SAFE REPORT: urlKeys, provider names and reasons only — never a
 *     token, a session id or an account id.
 *
 * NOT a route and not auto-executed anywhere; it has no import site in the app.
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js and
 * scripts/repair-account-merge-lin2233.js.
 *
 * Usage:
 *   node scripts/revert-connection-backed.js            # dry run (report only)
 *   node scripts/revert-connection-backed.js --execute  # write
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { OwnerCredentialStore } from '../lib/owner-credential-store.js'
import { ConnectionStore } from '../lib/connection-store.js'

const REFRESH_TOKEN_KINDS = new Set(['linear', 'jira'])

const isConnectionBacked = (binding) => !!(binding && typeof binding.connectionId === 'string')

/**
 * Plans (and, with `execute`, applies) the revert over every stored session.
 *
 * @param {Object} deps
 * @param {Object} deps.db - a MongoDB/MangoDB database handle
 * @param {boolean} [deps.execute=false]
 * @param {(line: string) => void} [deps.log]
 * @returns {Promise<Object>} the secret-safe report
 */
export async function runRevert({ db, execute = false, log = console.log }) {
  const sessions = db.collection('sessions')
  const connections = db.collection('connections')
  const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') })
  const connectionStore = new ConnectionStore({ collection: connections })

  const affectedRows = await connections.find({ referents: { $exists: true, $ne: [] } }).toArray()
  const report = {
    execute,
    affected: affectedRows.map(row => ({
      provider: row.provider,
      referents: (row.referents || []).map(r => ({ urlKey: r.urlKey, provider: r.provider, scope: r.scope })),
    })),
    sessionsScanned: 0,
    sessionsChanged: 0,
    reverted: [],
    skipped: [],
    legacyRecordsWritten: 0,
    connectionsReleased: 0,
  }

  for (const row of await sessions.find({}).toArray()) {
    const session = row.session
    if (!session || !Array.isArray(session.workspaces)) continue
    report.sessionsScanned += 1
    const next = structuredClone(session)
    const legacyWrites = []
    const releases = []
    let changed = false

    for (const workspace of next.workspaces) {
      if (!workspace || !Array.isArray(workspace.bindings)) continue
      for (let i = 0; i < workspace.bindings.length; i++) {
        const binding = workspace.bindings[i]
        if (!isConnectionBacked(binding)) continue
        const where = { urlKey: workspace.urlKey, provider: binding.provider, scope: binding.scope }
        const skip = (reason) => report.skipped.push({ ...where, reason })

        const connection = await connections.findOne({ _id: binding.connectionId })
        if (!connection) { skip('connection-missing'); continue }
        if (connection.accountId !== session.accountId) { skip('account-mismatch'); continue }

        const credentials = { ...(connection.credentials || {}) }
        if (REFRESH_TOKEN_KINDS.has(binding.provider)) {
          const record = await ownerCredentialStore.getByConnection(binding.connectionId)
          if (!record?.refreshToken) { skip('owner-record-missing'); continue }
          const existing = await ownerCredentialStore.get(session.accountId, workspace.urlKey, binding.provider)
          if (existing && existing.refreshToken !== record.refreshToken) { skip('legacy-key-occupied'); continue }
          // The owner record is authoritative for a rotated access token (D9).
          if (record.token) credentials.token = record.token
          if (record.tokenExpiresAt !== undefined) credentials.tokenExpiresAt = record.tokenExpiresAt
          if (!existing) {
            legacyWrites.push([session.accountId, workspace.urlKey, {
              provider: binding.provider,
              scope: record.scope ?? binding.scope,
              token: record.token,
              refreshToken: record.refreshToken,
              tokenExpiresAt: record.tokenExpiresAt,
            }])
          }
        }

        workspace.bindings[i] = { provider: binding.provider, scope: binding.scope, credentials }
        const marker = workspace.activeBinding
        if (marker && marker.provider === binding.provider && marker.scope === binding.scope) {
          workspace.credentials = { ...(workspace.credentials || {}), token: credentials.token }
          workspace.accessToken = credentials.token
          if (credentials.tokenExpiresAt !== undefined) workspace.tokenExpiresAt = credentials.tokenExpiresAt
          delete workspace.activeBinding
        }
        report.reverted.push(where)
        releases.push({ connectionId: binding.connectionId, referent: { urlKey: workspace.urlKey, provider: binding.provider, scope: binding.scope } })
        changed = true
      }
    }

    if (!changed) continue
    report.sessionsChanged += 1
    if (!execute) continue
    // Legacy durable records first: a reverted binding never lands without one.
    for (const [accountId, urlKey, record] of legacyWrites) {
      if (await ownerCredentialStore.put(accountId, urlKey, record)) report.legacyRecordsWritten += 1
    }
    await sessions.updateOne({ _id: row._id }, { $set: { session: next } })
    // Last: the connection-first arm must no longer find a reverted binding.
    for (const { connectionId, referent } of releases) {
      await connectionStore.removeReferent(connectionId, referent)
      if (await connectionStore.deleteIfUnreferenced(connectionId)) {
        await ownerCredentialStore.deleteByConnection(connectionId)
        report.connectionsReleased += 1
      }
    }
  }

  log(`[revert-connection-backed] ${execute ? 'EXECUTE' : 'dry run'}: ${report.reverted.length} binding(s) reverted in ${report.sessionsChanged} session(s), ${report.skipped.length} skipped (re-link), ${report.legacyRecordsWritten} legacy record(s) written, ${report.connectionsReleased} Connection(s) released`)
  return report
}

async function main() {
  const execute = process.argv.includes('--execute')
  console.log(`[revert-connection-backed] Order: (1) CONNECTION_BACKED_WRITES=off, (2) drain traffic, (3) run this script${execute ? ' — EXECUTING now' : ' (dry run; --execute to write)'}.`)
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  const db = dbClient.db('linear-viewer')
  try {
    const report = await runRevert({ db, execute })
    if (!execute) console.log('\n[revert-connection-backed] Dry run complete. Set CONNECTION_BACKED_WRITES=off first, then re-run with --execute to write.')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

// Only run when invoked directly, never on import (keeps it test-importable).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[revert-connection-backed] failed:', err)
    process.exitCode = 1
  })
}
