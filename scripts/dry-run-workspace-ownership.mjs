#!/usr/bin/env node
/**
 * Read-only operator dry-run: who could own each existing workspace
 * (LIN-1892 S1).
 *
 * From S1 on, a workspace's first bind writes a `role: 'owner'` edge
 * (lib/account-workspace-store.js). Workspaces bound before S1 get nothing
 * automatically; assigning owners to them is Open decision 2, John's data
 * call. This script gives that decision its numbers:
 *
 *   (a) workspaces with exactly one distinct canonical account → a derivable owner;
 *   (b) workspaces with more than one distinct canonical account, with the
 *       inferred kind, edge count and earliest binder (first-binder candidate);
 *   (c) workspace ids seen in session rows with no edge at all — a LOWER
 *       bound, since sessions expire after 30 days (server.js SESSION_TTL_SECONDS);
 *   (d) canonical accounts whose identities are all `local`;
 *   (e) with `--s1-deployed-at <ISO>`: workspaces whose first edge was created
 *       at or after that instant but which have no owner edge — crash-gap
 *       candidates (see bindAccountToWorkspace). Not computed without the flag.
 *
 * plus the number of edges already carrying `role: 'owner'`.
 *
 * Read-only: `find` and `countDocuments` only, no `--execute` flag
 * (contrast scripts/repair-account-merge-lin2233.js). NOT a route and NOT
 * imported by the app.
 *
 * What it reads, and why it is secret-safe:
 *
 * - `sessions` rows (`{_id: sid, session, expires}`, lib/session-store.js)
 *   hold live provider tokens. The ONE read projects `session.workspaces`
 *   whole, and only `id`/`urlKey` are kept from it, in memory. The rest of
 *   each entry is dropped at once and nothing else is retained or printed:
 *   no sid, token, name or session object. It projects the array whole
 *   rather than `session.workspaces.id` because MangoDB 0.1.2 returns only
 *   the FIRST array element for a dotted projection into an array, which
 *   would under-count every multi-workspace session (LIN-1892 S1-1).
 * - `accounts`: merged accounts are read as `{_id, mergedInto}` only, for
 *   canonicalisation. Bucket (d) is a server-side `countDocuments` over
 *   `identities.provider`, so no identity (or its credentials) ever comes
 *   back (S1-2). MangoDB's dotted projection has the same first-element loss,
 *   and it ignores an `_id`-only projection outright.
 * - `account-workspaces` edges carry no credentials, only
 *   `{_id, accountId, workspaceId, createdAt, role?}`.
 *
 * The owner-edge count reads `role` from the same edge scan rather than
 * calling `getWorkspaceOwnerAccountId` per workspace: one consistent
 * snapshot, and the question here is "which workspaces have an owner", not
 * "who is this workspace's owner". That method's JSDoc names its consumer.
 *
 * Usage:
 *   node scripts/dry-run-workspace-ownership.mjs [--s1-deployed-at <ISO>]
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js and scripts/scan-mis-mirrored-workspaces-lin1981.js.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'

export const SESSIONS_FIND_PROJECTION = Object.freeze({ _id: 0, 'session.workspaces': 1 })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The workspace kind a workspace id implies. A UUID id is a container whose
 * provider the id alone doesn't say: a local workspace, or a fresh GitHub
 * container (LIN-2802).
 * @param {string} workspaceId
 * @returns {'github'|'jira'|'container'|'linear-org'}
 */
export function inferWorkspaceKind(workspaceId) {
  if (workspaceId.startsWith('github:')) return 'github'
  if (workspaceId.startsWith('jira:')) return 'jira'
  if (UUID_RE.test(workspaceId)) return 'container'
  return 'linear-org'
}

// Same walk as AccountStore.resolveCanonicalAccountId, over a pre-read
// `mergedInto` map. A corrupt chain (cycle, or deeper than 8 hops) resolves
// to null and is counted, rather than aborting the whole report.
function canonicalise(accountId, mergedInto) {
  let current = accountId
  const visited = new Set([current])
  for (let hop = 0; hop < 8; hop++) {
    const next = mergedInto.get(current)
    if (!next) return current
    if (visited.has(next)) return null
    visited.add(next)
    current = next
  }
  return null
}

function byCreatedAtThenId(a, b) {
  const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  if (diff !== 0) return diff
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0
}

/**
 * Only `id`/`urlKey` survive from a session's `workspaces` entries.
 * @param {Object} row - one projected `sessions` row
 * @returns {{id: string, urlKey: (string|null)}[]}
 */
function sessionWorkspaceRefs(row) {
  const workspaces = row?.session?.workspaces
  if (!Array.isArray(workspaces)) return []
  const refs = []
  for (const ws of workspaces) {
    if (typeof ws?.id !== 'string') continue
    refs.push({ id: ws.id, urlKey: typeof ws.urlKey === 'string' ? ws.urlKey : null })
  }
  return refs
}

/**
 * Compute the ownership report.
 * @param {Object} options
 * @param {Object} options.db - MongoDB/MangoDB db handle
 * @param {Date} [options.s1DeployedAt] - enables bucket (e)
 * @returns {Promise<Object>} the JSON report
 */
export async function computeOwnershipReport({ db, s1DeployedAt } = {}) {
  const accounts = db.collection('accounts')
  const edgesCollection = db.collection('account-workspaces')

  const mergedRows = await accounts
    .find({ mergedInto: { $exists: true } }, { projection: { _id: 1, mergedInto: 1 } })
    .toArray()
  const mergedInto = new Map(mergedRows.map(r => [r._id, r.mergedInto]))

  const edges = await edgesCollection
    .find({}, { projection: { _id: 1, accountId: 1, workspaceId: 1, createdAt: 1, role: 1 } })
    .toArray()

  const byWorkspace = new Map()
  let unresolvableAccountEdges = 0
  for (const edge of edges) {
    const canonical = canonicalise(edge.accountId, mergedInto)
    if (canonical === null) unresolvableAccountEdges++
    if (!byWorkspace.has(edge.workspaceId)) byWorkspace.set(edge.workspaceId, [])
    byWorkspace.get(edge.workspaceId).push({ ...edge, canonical })
  }

  const derivable = []
  const multiAccount = []
  const crashGapCandidates = []
  for (const [workspaceId, wsEdges] of byWorkspace) {
    wsEdges.sort(byCreatedAtThenId)
    const first = wsEdges[0]
    const hasOwner = wsEdges.some(e => e.role === 'owner')
    const distinct = new Set(wsEdges.map(e => e.canonical ?? `unresolvable:${e.accountId}`))
    if (distinct.size === 1) {
      derivable.push({ workspaceId, kind: inferWorkspaceKind(workspaceId), accountId: first.canonical, hasOwner })
    } else {
      multiAccount.push({
        workspaceId,
        kind: inferWorkspaceKind(workspaceId),
        edgeCount: wsEdges.length,
        distinctAccountCount: distinct.size,
        firstBinderCandidate: first.canonical,
        firstEdgeCreatedAt: new Date(first.createdAt).toISOString(),
        hasOwner
      })
    }
    if (s1DeployedAt && !hasOwner && new Date(first.createdAt).getTime() >= s1DeployedAt.getTime()) {
      crashGapCandidates.push({
        workspaceId,
        kind: inferWorkspaceKind(workspaceId),
        firstEdgeCreatedAt: new Date(first.createdAt).toISOString()
      })
    }
  }

  // The ONLY sessions read (LIN-1892 N9 / S1-1).
  const sessionRows = await db.collection('sessions').find({}, { projection: SESSIONS_FIND_PROJECTION }).toArray()
  const seenInSessions = new Map()
  let sessionWorkspaceEntries = 0
  for (const row of sessionRows) {
    for (const ref of sessionWorkspaceRefs(row)) {
      sessionWorkspaceEntries++
      if (!seenInSessions.has(ref.id)) seenInSessions.set(ref.id, ref.urlKey)
    }
  }
  const sessionOnly = [...seenInSessions]
    .filter(([id]) => !byWorkspace.has(id))
    .map(([workspaceId, urlKey]) => ({ workspaceId, urlKey, kind: inferWorkspaceKind(workspaceId) }))
  // Rows whose `session` isn't a document (a legacy string encoding) can't be
  // projected into, so they aren't scanned. Counted, never read.
  const unscannableSessionRows = await db.collection('sessions').countDocuments({ session: { $type: 'string' } })

  const localOnlyAccounts = await accounts.countDocuments({
    mergedInto: { $exists: false },
    'identities.0': { $exists: true },
    identities: { $not: { $elemMatch: { provider: { $ne: 'local' } } } }
  })

  const ownerEdges = await edgesCollection.countDocuments({ role: 'owner' })

  const sortById = rows => rows.sort((x, y) => (x.workspaceId < y.workspaceId ? -1 : x.workspaceId > y.workspaceId ? 1 : 0))
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      edges: edges.length,
      workspacesWithEdges: byWorkspace.size,
      ownerEdges,
      mergedAccounts: mergedRows.length,
      unresolvableAccountEdges,
      sessionRows: sessionRows.length,
      sessionWorkspaceEntries,
      unscannableSessionRows
    },
    a_derivableOwner: { count: derivable.length, rows: sortById(derivable) },
    b_multiAccount: { count: multiAccount.length, rows: sortById(multiAccount) },
    c_sessionOnlyNoEdge: {
      count: sessionOnly.length,
      caveat: 'lower bound: only workspaces in session rows still in the store; sessions expire after 30 days (server.js SESSION_TTL_SECONDS), so older session-only workspaces are not visible',
      rows: sortById(sessionOnly)
    },
    d_localOnlyAccounts: { count: localOnlyAccounts },
    e_crashGapCandidates: s1DeployedAt
      ? { computed: true, s1DeployedAt: s1DeployedAt.toISOString(), count: crashGapCandidates.length, rows: sortById(crashGapCandidates) }
      : { computed: false, note: 'not computed: pass --s1-deployed-at <ISO>' }
  }
}

/**
 * The one-screen human summary of a report.
 * @param {Object} report - from computeOwnershipReport
 * @returns {string}
 */
export function formatSummary(report) {
  const { totals: t } = report
  const lines = [
    '[dry-run] LIN-1892 workspace ownership (read-only)',
    `  edges: ${t.edges} across ${t.workspacesWithEdges} workspace(s); owner edges: ${t.ownerEdges}; merged accounts: ${t.mergedAccounts}`,
    `  (a) derivable owner (exactly one canonical account): ${report.a_derivableOwner.count}`,
    `  (b) more than one canonical account: ${report.b_multiAccount.count}`,
    `  (c) seen in sessions, no edge: ${report.c_sessionOnlyNoEdge.count} — ${report.c_sessionOnlyNoEdge.caveat}`,
    `      scanned ${t.sessionRows} session row(s), ${t.sessionWorkspaceEntries} workspace entr${t.sessionWorkspaceEntries === 1 ? 'y' : 'ies'}; unscannable (string-encoded) rows: ${t.unscannableSessionRows}`,
    `  (d) accounts with only local identities: ${report.d_localOnlyAccounts.count}`,
    report.e_crashGapCandidates.computed
      ? `  (e) first edge at/after ${report.e_crashGapCandidates.s1DeployedAt} with no owner (crash-gap candidates): ${report.e_crashGapCandidates.count}`
      : `  (e) ${report.e_crashGapCandidates.note}`
  ]
  if (t.unresolvableAccountEdges > 0) {
    lines.push(`  warning: ${t.unresolvableAccountEdges} edge(s) name an account with a corrupt mergedInto chain`)
  }
  lines.push('  kinds: github / jira by id prefix; container = UUID id (local, or a fresh GitHub container); linear-org otherwise')
  lines.push('  Assigning owners to existing workspaces is Open decision 2 — this script changes nothing.')
  return lines.join('\n')
}

/**
 * Compute the report and write the summary, then the JSON, to `out`.
 * @param {Object} options
 * @param {Object} options.db
 * @param {{write: function(string): void}} options.out - e.g. process.stdout
 * @param {Date} [options.s1DeployedAt]
 * @returns {Promise<Object>} the report
 */
export async function runDryRun({ db, out, s1DeployedAt } = {}) {
  const report = await computeOwnershipReport({ db, s1DeployedAt })
  out.write(`${formatSummary(report)}\n`)
  out.write(`${JSON.stringify(report, null, 2)}\n`)
  return report
}

/**
 * @param {string[]} argv - arguments after the script path
 * @returns {{s1DeployedAt?: Date}}
 */
export function parseArgs(argv) {
  const i = argv.indexOf('--s1-deployed-at')
  if (i === -1) return {}
  const value = argv[i + 1]
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`--s1-deployed-at needs an ISO timestamp, got ${JSON.stringify(value ?? null)}`)
  }
  return { s1DeployedAt: date }
}

async function main() {
  const { s1DeployedAt } = parseArgs(process.argv.slice(2))
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    await runDryRun({ db: dbClient.db('linear-viewer'), out: process.stdout, s1DeployedAt })
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[dry-run] failed:', err)
    process.exitCode = 1
  })
}
