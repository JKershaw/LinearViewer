#!/usr/bin/env node
/**
 * Read-only operator scan (LIN-3332 / LIN-3334).
 *
 * LIN-3332's rule is "a workspace has one ticket source of each kind": with it
 * in place, nothing may ADD a second binding for a provider a workspace already
 * holds (see `sameKindSourceBound` in `lib/workspace.js`). But existing stored
 * data may already hold such a pair — a GitHub account container with two repo
 * bindings, a Jira container with two sites, a legacy two-repo workspace. Those
 * predate the rule and are the C8 class: production rows, not source.
 *
 * This script answers the one question the rule's rollout needs: **how many
 * stored workspaces already hold two sources of the same kind?** It reads two
 * durable places and reports each offending workspace:
 *
 *   - the `workspaces` collection (lib/workspace-store.js) — one doc per workspace;
 *   - the `sessions` collection — each row's `session.workspaces[]` (a session's
 *     copy of the same workspaces, which can drift from the durable doc).
 *
 * If the count is zero (as the ticket expects) no compatibility code is needed;
 * a nonzero count is the "tell John before the removal merges" signal
 * (LIN-3335 must not merge until this has been run against production).
 *
 * Secret-safe: it keeps only `urlKey`, provider names and scopes — never a
 * token, never an account id, never a session id. The report is the same class
 * of output as `scripts/dry-run-workspace-ownership.mjs`.
 *
 * Read-only: `find` only, no `--execute` flag, NOT a route, NOT imported by the
 * app (contrast `scripts/repair-account-merge-lin2233.js`).
 *
 * Usage:
 *   node scripts/scan-same-kind-sources-lin3332.mjs
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js and scripts/dry-run-workspace-ownership.mjs.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'

/**
 * The same-kind conflicts in one workspace object: providers with more than one
 * binding. `bindings` is the LIN-562 shape (`{provider, scope, ...}`); a
 * same-scope duplicate is also a conflict (linkProvider upserts, so it should
 * not occur — if it does, the data is doubly wrong).
 *
 * @param {Object} workspace
 * @returns {{provider: string, count: number, scopes: (string|null)[]}[]}
 */
export function sameKindConflicts(workspace) {
  const byProvider = new Map()
  for (const binding of workspace?.bindings || []) {
    if (!binding || typeof binding.provider !== 'string') continue
    if (!byProvider.has(binding.provider)) byProvider.set(binding.provider, [])
    byProvider.get(binding.provider).push(typeof binding.scope === 'string' ? binding.scope : null)
  }
  const conflicts = []
  for (const [provider, scopes] of byProvider) {
    if (scopes.length > 1) conflicts.push({ provider, count: scopes.length, scopes: [...new Set(scopes)] })
  }
  return conflicts
}

function parseSessionData(row) {
  return typeof row.session === 'string' ? JSON.parse(row.session) : row.session
}

/**
 * Fold raw docs into the report. Pure and IO-free, so it is unit-testable
 * without a store.
 *
 * @param {{workspaceDocs?: Object[], sessionDocs?: Object[]}} [input]
 * @returns {{scannedWorkspaces: number, scannedSessionEntries: number, flagged: Array<{source: 'workspaces'|'sessions', urlKey: (string|null), conflicts: Object[]}>}}
 */
export function scanForSameKindSources({ workspaceDocs = [], sessionDocs = [] } = {}) {
  const flagged = []

  for (const doc of workspaceDocs) {
    if (!doc) continue
    const conflicts = sameKindConflicts(doc)
    if (conflicts.length) flagged.push({ source: 'workspaces', urlKey: typeof doc.urlKey === 'string' ? doc.urlKey : null, conflicts })
  }

  let scannedSessionEntries = 0
  for (const row of sessionDocs) {
    let data
    try {
      data = parseSessionData(row)
    } catch {
      continue // malformed row — skip rather than abort the whole pass
    }
    for (const workspace of Array.isArray(data?.workspaces) ? data.workspaces : []) {
      scannedSessionEntries++
      const conflicts = sameKindConflicts(workspace)
      if (conflicts.length) flagged.push({ source: 'sessions', urlKey: typeof workspace.urlKey === 'string' ? workspace.urlKey : null, conflicts })
    }
  }

  return { scannedWorkspaces: workspaceDocs.length, scannedSessionEntries, flagged }
}

/**
 * Read the two collections and build the report.
 * @param {Object} options
 * @param {Object} options.db - MongoDB/MangoDB db handle
 * @returns {Promise<Object>} the report
 */
export async function computeSameKindReport({ db } = {}) {
  const workspaceDocs = await db.collection('workspaces').find({}).toArray()
  const sessionDocs = await db.collection('sessions').find({}).toArray()
  return { generatedAt: new Date().toISOString(), ...scanForSameKindSources({ workspaceDocs, sessionDocs }) }
}

/**
 * One-screen human summary.
 * @param {Object} report - from computeSameKindReport / scanForSameKindSources
 * @returns {string}
 */
export function formatSummary(report) {
  const lines = [
    '[scan] LIN-3332/3334 — stored workspaces holding two sources of one kind (read-only)',
    `  scanned ${report.scannedWorkspaces} durable workspace doc(s) and ${report.scannedSessionEntries} session workspace entr${report.scannedSessionEntries === 1 ? 'y' : 'ies'}`,
  ]
  if (report.flagged.length === 0) {
    lines.push('  none: no stored workspace holds two sources of the same kind — no compatibility code needed.')
  } else {
    lines.push(`  ${report.flagged.length} workspace(s) violate the one-source-per-kind rule — tell John before LIN-3335 merges:`)
    for (const entry of report.flagged) {
      lines.push(`    - [${entry.source}] urlKey=${entry.urlKey ?? '(none)'}: ${entry.conflicts.map(c => `${c.provider} x${c.count}`).join(', ')}`)
    }
  }
  lines.push('  read-only: this scan changes nothing.')
  return lines.join('\n')
}

async function main() {
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    const report = await computeSameKindReport({ db: dbClient.db('linear-viewer') })
    process.stdout.write(`${formatSummary(report)}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[scan] failed:', err)
    process.exitCode = 1
  })
}
