#!/usr/bin/env node
/**
 * Read-only operator scan (LIN-3790).
 *
 * LIN-3774 made a connection-backed GitHub-family secondary binding renew before
 * use. LIN-3790 widens that: a connection-backed refresh-token-kind secondary
 * (Jira OAuth, Linear) renews through the same seam, and every other secondary
 * (legacy, i.e. no `connectionId`; or unhydrated) degrades to a
 * `dashboard-source-notice`. How much that matters depends on how many such
 * bindings exist in production, which the repo cannot show.
 *
 * This script answers: **how many stored workspaces carry a SECONDARY (non-active)
 * binding, by shape?** Shapes (C1 in the ticket):
 *   - `connection:<provider>`  a connection-backed secondary (renewed by the seam);
 *   - `legacy:<provider>`      a legacy secondary (degraded, never renewed).
 * The population of interest is the `legacy:*` shapes (d)-(g) and the
 * `connection:jira|linear` refresh-token members (b)/(c).
 *
 * Source of truth: the `workspaces` and `sessions` collections, as in
 * scripts/scan-same-kind-sources-lin3332.mjs. Legacy bindings and their
 * credentials live ONLY there; Connection rows cannot show them.
 *
 * Secret-safe: keeps only `urlKey`, provider names and scopes, never a token,
 * account id or session id. Read-only: `find` only, NOT a route, NOT imported by
 * the app. Not run by the PR that added it (no production MONGODB_URI).
 *
 * Usage:
 *   node scripts/scan-secondary-binding-shapes-lin3790.mjs
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js and scripts/scan-same-kind-sources-lin3332.mjs.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'

/**
 * The secondary bindings of one workspace object, by shape. The active provider
 * is `workspace.provider` defaulted to linear (a legacy workspace may lack it);
 * one source per kind (LIN-3334) makes the provider compare exact. `local`
 * never 401s and is skipped.
 *
 * @param {Object} workspace
 * @returns {{shape: string, provider: string, scope: (string|null)}[]}
 */
export function secondaryShapes(workspace) {
  const active = workspace?.provider || 'linear'
  const found = []
  for (const binding of workspace?.bindings || []) {
    if (!binding || typeof binding.provider !== 'string') continue
    if (binding.provider === active || binding.provider === 'local') continue
    const kind = typeof binding.connectionId === 'string' ? 'connection' : 'legacy'
    found.push({ shape: `${kind}:${binding.provider}`, provider: binding.provider, scope: typeof binding.scope === 'string' ? binding.scope : null })
  }
  return found
}

function parseSessionData(row) {
  return typeof row.session === 'string' ? JSON.parse(row.session) : row.session
}

/**
 * Fold raw docs into the report. Pure and IO-free.
 *
 * @param {{workspaceDocs?: Object[], sessionDocs?: Object[]}} [input]
 * @returns {{scannedWorkspaces: number, scannedSessionEntries: number, shapeCounts: Object<string, number>, flagged: Array<{source: 'workspaces'|'sessions', urlKey: (string|null), secondaries: Object[]}>}}
 */
export function scanForSecondaryShapes({ workspaceDocs = [], sessionDocs = [] } = {}) {
  const flagged = []
  const shapeCounts = {}
  const note = (source, workspace) => {
    const secondaries = secondaryShapes(workspace)
    if (!secondaries.length) return
    for (const s of secondaries) shapeCounts[`${source}:${s.shape}`] = (shapeCounts[`${source}:${s.shape}`] || 0) + 1
    flagged.push({ source, urlKey: typeof workspace.urlKey === 'string' ? workspace.urlKey : null, secondaries })
  }

  for (const doc of workspaceDocs) {
    if (doc) note('workspaces', doc)
  }

  let scannedSessionEntries = 0
  for (const row of sessionDocs) {
    let data
    try {
      data = parseSessionData(row)
    } catch {
      continue // malformed row: skip rather than abort the whole pass
    }
    for (const workspace of Array.isArray(data?.workspaces) ? data.workspaces : []) {
      scannedSessionEntries++
      note('sessions', workspace)
    }
  }

  return { scannedWorkspaces: workspaceDocs.length, scannedSessionEntries, shapeCounts, flagged }
}

/**
 * @param {Object} options
 * @param {Object} options.db - MongoDB/MangoDB db handle
 * @returns {Promise<Object>} the report
 */
export async function computeSecondaryShapeReport({ db } = {}) {
  const workspaceDocs = await db.collection('workspaces').find({}).toArray()
  const sessionDocs = await db.collection('sessions').find({}).toArray()
  return { generatedAt: new Date().toISOString(), ...scanForSecondaryShapes({ workspaceDocs, sessionDocs }) }
}

/**
 * One-screen human summary.
 * @param {Object} report
 * @returns {string}
 */
export function formatSummary(report) {
  const lines = [
    '[scan] LIN-3790 — secondary bindings by shape (read-only)',
    `  scanned ${report.scannedWorkspaces} durable workspace doc(s) and ${report.scannedSessionEntries} session workspace entr${report.scannedSessionEntries === 1 ? 'y' : 'ies'}`,
  ]
  const shapes = Object.entries(report.shapeCounts).sort(([a], [b]) => a.localeCompare(b))
  if (shapes.length === 0) {
    lines.push('  none: no stored workspace carries a secondary binding.')
  } else {
    for (const [shape, count] of shapes) lines.push(`  ${shape}: ${count}`)
    lines.push('  legacy:* are degraded to a source notice (never renewed); connection:jira|linear renew via the seam; connection:github* are LIN-3774.')
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
    const report = await computeSecondaryShapeReport({ db: dbClient.db('linear-viewer') })
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
