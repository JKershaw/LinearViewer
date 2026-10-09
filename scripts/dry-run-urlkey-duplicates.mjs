#!/usr/bin/env node
/**
 * Read-only operator dry-run: which `urlKey`s are held by more than one
 * account (LIN-3381, slice S1.1 of LIN-2954, finding A1).
 *
 * Two accounts holding one `urlKey` share one queue, tracker or credential
 * across tenants. This script sizes that before any production decision. It
 * imports the one holder definition (`findUrlKeyHolders` / `loadAllHolders`,
 * lib/urlkey-holders.js: owner-credentials, connections.referents,
 * proxy-tokens, dispatch-tokens) and reports, per key:
 *
 *   - COLLISIONS: holders with no `account-workspaces` edge to a common
 *     workspace id linked to the key. Only these are actionable. A common edge
 *     to some OTHER workspace is still a collision, flagged
 *     `commonWorkspaceUnlinked`. Each carries rightful-holder evidence: owner
 *     edge, owner-credentials record (a connection-keyed one counts via its
 *     referent), earliest token createdAt per store.
 *   - SHARED MEMBERSHIPS: holders that all reach one workspace id linked to the
 *     key (union-find over shared linked edges: one group is shared, two or
 *     more is a collision).
 *   - SUSPECTED COLLISIONS, ACTOR EVIDENCE ONLY: keys where actor stores
 *     (dispatchedBy, saved chats, task-mode and funnel events, credential
 *     lifecycle events, task-share owner, close-out events, the user-preferences per-workspace maps,
 *     declared-mint owner) name an account
 *     that is not a holder. Labelled evidence; it never changes the holder set.
 *   - LIVE SESSIONS: a labelled LOWER BOUND (sessions expire after 30 days,
 *     stale-present rows are counted apart, string-encoded rows are unscannable).
 *   - KEYS WITH NO HOLDER, in disjoint buckets (first match wins): liveSession,
 *     staleSession, actorOnly, dataOnly. Only `dataOnly` sizes the S1.2
 *     residual (a random-id workspace with only C1 rows).
 *
 * Expect Jira teammates on one site to appear as collisions: the key is the
 * tenant hostname but the workspace id is `jira:<person>` (routes/jira-auth.js).
 *
 * Secret safety: projections only. No tokenHash, credential payload or session
 * object is read into the report. Account, token and connection ids print cut
 * to 8 characters; workspace ids keep their kind prefix; site URLs and
 * connection `_id`s are never printed; urlKeys print in full (they are the
 * subject). String-encoded sessions are counted, never parsed.
 *
 * Read-only: `find`, `countDocuments` and `distinct` only. No `$out`/`$merge`,
 * no `--execute`. NOT a route and NOT imported by the app. Running it on
 * production is John's call (LIN-2954).
 *
 * Usage:
 *   node scripts/dry-run-urlkey-duplicates.mjs
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR convention as
 * scripts/dry-run-workspace-ownership.mjs.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { canonicalise, sessionWorkspaceRefs } from './dry-run-workspace-ownership.mjs'
import { createUrlKeyHolderFinder } from '../lib/urlkey-holders.js'
import { createReferentHolderReader } from '../lib/connection-credential.js'
import { ConnectionStore } from '../lib/connection-store.js'
import { OwnerCredentialStore } from '../lib/owner-credential-store.js'
import { ProxyTokenStore } from '../lib/proxy-tokens.js'
import { DispatchTokenStore } from '../lib/dispatch-tokens.js'

/** Projection for the ONE sessions read: expiry, account and workspaces only. */
export const SESSIONS_URLKEY_PROJECTION = Object.freeze({
  _id: 0, expires: 1, 'session.workspaces': 1, 'session.accountId': 1
})

/**
 * Class C: every store that carries a urlKey, by storage shape, for the
 * no-holder count. `field` reads a top-level `urlKey` with `distinct`; `id`
 * means the document `_id` IS the key; `id` with `parse` extracts the key from
 * a composite `_id`; composite caches whose key cannot be split safely are
 * listed in `UNENUMERATED_SOURCES`. Fields absent from a collection read as
 * empty.
 */
export const URLKEY_SOURCES = Object.freeze([
  ...[
    'proxy-tokens', 'dispatch-tokens', 'dispatch-queue', 'dispatch-history', 'wake_shadow',
    'foreman-status', 'observation-sessions', 'proxy-events', 'llm-call-log', 'prompt-traces',
    'task-mode-events', 'close-out-events', 'liveness-alarms', 'custom-prompts', 'report-history',
    'task-snapshots', 'task-decisions', 'run-paragraph', 'workspaces', 'task_share_links',
    'observer-shadow-log', 'saved-chats', 'funnel-events', 'credential-lifecycle-events',
    'owner-credentials', 'dismissal-suggestions', 'dispatch-presets', 'run-proposals', 'shelved-rulings',
    'ship-biscuit-editions', 'collective-characters', 'collective-presets'
  ].map(collection => ({ collection, shape: 'field', field: 'urlKey' })),
  { collection: 'local-issues', shape: 'field', field: 'scope' },
  { collection: 'workspace-halt', shape: 'id' },
  { collection: 'workspace-preferences', shape: 'id' },
  // `_id` is `${urlKey}::${commentId}`.
  { collection: 'harbour-comments', shape: 'id', parse: id => id.split('::')[0] },
  // `_id` is `sweep:v1:${urlKey}` or `companion:v1:${urlKey}[:proxy]`; other ids carry no key.
  {
    collection: 'observer-state',
    shape: 'id',
    parse: id => {
      const m = /^(?:sweep|companion):v1:(.+?)(?::proxy)?$/.exec(id)
      return m ? m[1] : null
    }
  },
  // `_id` is `${workspaceId}:${issueId}`; an issue id carries no colon.
  { collection: 'brief-cache', shape: 'id', parse: id => id.slice(0, Math.max(id.lastIndexOf(':'), 0)) },
  { collection: 'recap-cache', shape: 'id', parse: id => id.slice(0, Math.max(id.lastIndexOf(':'), 0)) }
])

/**
 * Class C members deliberately NOT read by the no-holder count, with the
 * reason. The report prints these so `keysWithNoHolder` is never read as a
 * complete universe.
 */
export const UNENUMERATED_SOURCES = Object.freeze([
  { collection: 'run-summary-cache', reason: '_id is `${workspaceId}:${loopId}`; the loop id format is not guaranteed colon-free, so the key cannot be split safely' },
  { collection: 'session-summary-cache', reason: '_id is `${workspaceId}:${sessionId}`; the session id format is not guaranteed colon-free, so the key cannot be split safely' }
])

/**
 * Actor stores (class B): labelled evidence only, never holders. Each entry
 * names the account-bearing fields. Dotted fields are read with `find` and a
 * projection.
 */
export const ACTOR_SOURCES = Object.freeze([
  { collection: 'dispatch-queue', fields: ['dispatchedBy', 'grantDeclaration.ownerAccountId'] },
  { collection: 'dispatch-history', fields: ['dispatchedBy', 'grantDeclaration.ownerAccountId'] },
  { collection: 'saved-chats', fields: ['accountId'] },
  { collection: 'task-mode-events', fields: ['accountId'] },
  { collection: 'funnel-events', fields: ['accountId'] },
  { collection: 'credential-lifecycle-events', fields: ['accountId'] },
  { collection: 'task_share_links', fields: ['ownerAccountId'] },
  { collection: 'close-out-events', fields: ['accountId'] },
  // `_id` is the account; the keys of each map are workspace keys.
  {
    collection: 'user-preferences',
    keyedBy: 'prefsMaps',
    maps: ['selectedTeamByWorkspace', 'northStarByWorkspace', 'northStarDocVersionByWorkspace']
  }
])

/** Every collection this script is allowed to open. */
export const READ_COLLECTIONS = Object.freeze([
  ...new Set([
    'accounts', 'account-workspaces', 'sessions', 'connections', 'owner-credentials',
    'proxy-tokens', 'dispatch-tokens', 'task_share_links',
    ...URLKEY_SOURCES.map(s => s.collection),
    ...ACTOR_SOURCES.map(s => s.collection)
  ])
])

const LIVE_SESSION_TTL_NOTE = 'lower bound: only sessions still in the store; sessions expire after 30 days (server.js SESSION_TTL_SECONDS), stale-present rows are not cleaned on a schedule, and string-encoded rows are unscannable'
const LOCAL_SHAPE_RE = /-[0-9a-f]{8}$/

const short = id => (typeof id === 'string' && id ? `${id.slice(0, 8)}…` : String(id))

/** Workspace ids keep their kind prefix (`github:`, `jira:`); the rest is cut. */
function shortWorkspace(id) {
  if (typeof id !== 'string') return String(id)
  const colon = id.indexOf(':')
  if (colon > 0) return `${id.slice(0, colon + 1)}${short(id.slice(colon + 1))}`
  return short(id)
}

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function getPath(doc, path) {
  let value = doc
  for (const part of path.split('.')) value = value?.[part]
  return value
}

function addTo(map, key, value) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(value)
  return map.get(key)
}

/**
 * Union-find over `accounts`: two join when they share a workspace id in
 * `linked`. Returns the groups and whether two groups share an edge to a
 * workspace id that is NOT linked to the key.
 */
function groupAccounts(accounts, linked, edgesOf) {
  const parent = new Map(accounts.map(a => [a, a]))
  const find = a => (parent.get(a) === a ? a : (parent.set(a, find(parent.get(a))), parent.get(a)))
  const byWorkspace = new Map()
  for (const account of accounts) {
    for (const ws of edgesOf.get(account) || []) {
      if (!linked.has(ws)) continue
      if (byWorkspace.has(ws)) parent.set(find(account), find(byWorkspace.get(ws)))
      else byWorkspace.set(ws, account)
    }
  }
  const groups = new Map()
  for (const account of accounts) addTo(groups, find(account), account)
  const list = [...groups.values()].map(s => [...s].sort(byString))
  let commonWorkspaceUnlinked = false
  if (list.length > 1) {
    const unlinkedOwner = new Map()
    for (const account of accounts) {
      for (const ws of edgesOf.get(account) || []) {
        if (linked.has(ws)) continue
        const seen = unlinkedOwner.get(ws)
        if (seen !== undefined && find(seen) !== find(account)) commonWorkspaceUnlinked = true
        else if (seen === undefined) unlinkedOwner.set(ws, account)
      }
    }
  }
  return { groups: list, commonWorkspaceUnlinked }
}

/**
 * Compute the report.
 * @param {Object} options
 * @param {Object} options.db - MongoDB/MangoDB db handle
 * @param {Date} [options.now]
 * @returns {Promise<Object>} the JSON report
 */
export async function computeUrlKeyDuplicateReport({ db, now = new Date() } = {}) {
  const mergedRows = await db.collection('accounts')
    .find({ mergedInto: { $exists: true } }, { projection: { _id: 1, mergedInto: 1 } })
    .toArray()
  const mergedInto = new Map(mergedRows.map(r => [r._id, r.mergedInto]))
  const canon = accountId => canonicalise(accountId, mergedInto)

  const { holdersByKey, ownerlessTokens, unresolvableHolders } = await createUrlKeyHolderFinder({
    readReferents: createReferentHolderReader({ connectionStore: new ConnectionStore({ collection: db.collection('connections') }) }),
    ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
    proxyTokenStore: new ProxyTokenStore({ collection: db.collection('proxy-tokens') }),
    dispatchTokenStore: new DispatchTokenStore({ collection: db.collection('dispatch-tokens') }),
    resolveCanonicalAccountId: async id => canon(id)
  }).loadAllHolders()

  // account-workspaces edges: no credentials, only these fields.
  const edgeRows = await db.collection('account-workspaces')
    .find({}, { projection: { _id: 0, accountId: 1, workspaceId: 1, role: 1 } })
    .toArray()
  const edgesOf = new Map()
  const ownerEdgesOf = new Map()
  for (const edge of edgeRows) {
    const account = canon(edge.accountId)
    if (account === null) continue
    addTo(edgesOf, account, edge.workspaceId)
    if (edge.role === 'owner') addTo(ownerEdgesOf, account, edge.workspaceId)
  }

  // L(K): workspace ids linked to each key.
  const linksByKey = new Map()
  const link = (urlKey, workspaceId) => {
    if (typeof urlKey === 'string' && typeof workspaceId === 'string' && urlKey && workspaceId) {
      addTo(linksByKey, urlKey, workspaceId)
    }
  }
  for (const [urlKey, holders] of holdersByKey) {
    for (const holder of holders) for (const ws of holder.linkedWorkspaceIds) link(urlKey, ws)
  }

  // The ONE sessions read.
  const sessionRows = await db.collection('sessions').find({}, { projection: SESSIONS_URLKEY_PROJECTION }).toArray()
  const unscannableSessionRows = await db.collection('sessions').countDocuments({ session: { $type: 'string' } })
  const liveAccountsByKey = new Map()
  const staleAccountsByKey = new Map()
  const liveKeys = new Set()
  const staleKeys = new Set()
  for (const row of sessionRows) {
    const live = row.expires ? new Date(row.expires).getTime() > now.getTime() : false
    const account = typeof row?.session?.accountId === 'string' ? canon(row.session.accountId) : null
    for (const ref of sessionWorkspaceRefs(row)) {
      if (!ref.urlKey) continue
      link(ref.urlKey, ref.id)
      ;(live ? liveKeys : staleKeys).add(ref.urlKey)
      if (account) addTo(live ? liveAccountsByKey : staleAccountsByKey, ref.urlKey, account)
    }
  }

  for (const row of await db.collection('task_share_links')
    .find({}, { projection: { _id: 0, urlKey: 1, workspaceId: 1 } }).toArray()) {
    link(row.urlKey, row.workspaceId)
  }

  // Actor tier (class B) and the declared-mint workspace link (class E).
  const actorsByKey = new Map()
  for (const source of ACTOR_SOURCES) {
    if (source.keyedBy === 'prefsMaps') {
      const prefsProjection = { _id: 1 }
      for (const map of source.maps) prefsProjection[`preferences.${map}`] = 1
      for (const row of await db.collection(source.collection).find({}, { projection: prefsProjection }).toArray()) {
        const account = typeof row._id === 'string' ? canon(row._id) : null
        if (!account) continue
        for (const map of source.maps) {
          const value = row.preferences?.[map]
          if (value && typeof value === 'object') for (const key of Object.keys(value)) if (key) addTo(actorsByKey, key, account)
        }
      }
      continue
    }
    const projection = { _id: 0, urlKey: 1 }
    for (const field of source.fields) projection[field] = 1
    const wantsDeclaration = source.fields.some(f => f.startsWith('grantDeclaration.'))
    if (wantsDeclaration) projection['grantDeclaration.workspaceId'] = 1
    for (const row of await db.collection(source.collection).find({}, { projection }).toArray()) {
      if (typeof row.urlKey !== 'string') continue
      if (wantsDeclaration) link(row.urlKey, getPath(row, 'grantDeclaration.workspaceId'))
      for (const field of source.fields) {
        const raw = getPath(row, field)
        const account = typeof raw === 'string' ? canon(raw) : null
        if (account) addTo(actorsByKey, row.urlKey, account)
      }
    }
  }

  // Classify keys that have holders.
  const collisions = []
  const sharedMemberships = []
  const suspectedActorOnly = []
  const multiWorkspace = []
  let singleHolderKeys = 0
  const holderRow = (urlKey, holder, linked) => ({
    account: short(holder.accountId),
    sources: holder.sources,
    ownerOfLinkedWorkspace: [...(ownerEdgesOf.get(holder.accountId) || [])].some(ws => linked.has(ws)),
    ownerCredential: holder.ownerCredential,
    earliestTokenAt: holder.earliestTokenAt,
    linkedWorkspaces: [...(edgesOf.get(holder.accountId) || [])].filter(ws => linked.has(ws)).map(shortWorkspace).sort()
  })
  for (const [urlKey, holders] of [...holdersByKey].sort(([a], [b]) => byString(a, b))) {
    const linked = linksByKey.get(urlKey) || new Set()
    const accounts = holders.map(h => h.accountId)
    for (const holder of holders) {
      const own = [...(edgesOf.get(holder.accountId) || [])].filter(ws => linked.has(ws))
      if (own.length > 1) multiWorkspace.push({ urlKey, account: short(holder.accountId), workspaces: own.map(shortWorkspace).sort() })
    }
    if (holders.length === 1) {
      singleHolderKeys++
      const actors = [...(actorsByKey.get(urlKey) || [])].filter(a => !accounts.includes(a))
      if (actors.length > 0) {
        suspectedActorOnly.push({ urlKey, holder: short(accounts[0]), actorAccounts: actors.map(short).sort() })
      }
      continue
    }
    const { groups, commonWorkspaceUnlinked } = groupAccounts(accounts, linked, edgesOf)
    if (groups.length === 1) {
      sharedMemberships.push({ urlKey, holders: holders.length, sharedWorkspaces: [...linked].filter(ws => accounts.every(a => (edgesOf.get(a) || new Set()).has(ws))).map(shortWorkspace).sort() })
    } else {
      collisions.push({
        urlKey,
        groups: groups.length,
        commonWorkspaceUnlinked,
        holders: holders.map(h => holderRow(urlKey, h, linked))
      })
    }
  }

  // Class C: the key universe and the no-holder breakdown.
  const universe = new Set()
  for (const source of URLKEY_SOURCES) {
    const collection = db.collection(source.collection)
    if (source.shape === 'field') {
      for (const value of await collection.distinct(source.field)) if (typeof value === 'string' && value) universe.add(value)
    } else {
      for (const row of await collection.find({}, { projection: { _id: 1 } }).toArray()) {
        if (typeof row._id !== 'string' || !row._id) continue
        const key = source.parse ? source.parse(row._id) : row._id
        if (typeof key === 'string' && key) universe.add(key)
      }
    }
  }
  for (const urlKey of holdersByKey.keys()) universe.add(urlKey)
  const noHolder = { liveSession: 0, staleSession: 0, actorOnly: 0, dataOnly: 0 }
  let dataOnlyLocalShape = 0
  for (const urlKey of universe) {
    if (holdersByKey.has(urlKey)) continue
    if (liveKeys.has(urlKey)) noHolder.liveSession++
    else if (staleKeys.has(urlKey)) noHolder.staleSession++
    else if (actorsByKey.has(urlKey)) noHolder.actorOnly++
    else {
      noHolder.dataOnly++
      if (LOCAL_SHAPE_RE.test(urlKey)) dataOnlyLocalShape++
    }
  }

  const liveNotHolders = []
  let livePairs = 0
  for (const [urlKey, accounts] of liveAccountsByKey) {
    const held = new Set((holdersByKey.get(urlKey) || []).map(h => h.accountId))
    for (const account of accounts) {
      livePairs++
      if (!held.has(account)) liveNotHolders.push({ urlKey, account: short(account) })
    }
  }

  const sortByKey = rows => rows.sort((a, b) => byString(a.urlKey, b.urlKey))
  return {
    generatedAt: now.toISOString(),
    totals: {
      keysWithHolders: holdersByKey.size,
      keysInUrlKeyStores: universe.size,
      singleHolderKeys,
      ownerlessTokens,
      unresolvableHolders,
      sessionRows: sessionRows.length,
      unscannableSessionRows
    },
    collisions: { count: collisions.length, actionable: true, rows: collisions },
    sharedMemberships: { count: sharedMemberships.length, actionable: false, rows: sharedMemberships },
    suspectedCollisionsActorOnly: {
      count: suspectedActorOnly.length,
      caveat: 'evidence only (a lower bound: actor stores are read for the accounts they name, and a store that names none adds nothing): an actor store names an account that holds no token, credential or referent for the key; never changes the holder set',
      rows: sortByKey(suspectedActorOnly)
    },
    keysOnMultipleWorkspaceIds: { count: multiWorkspace.length, informational: true, rows: sortByKey(multiWorkspace) },
    liveSessionHolders: {
      caveat: LIVE_SESSION_TTL_NOTE,
      liveKeys: liveKeys.size,
      staleKeys: staleKeys.size,
      liveKeyAccountPairs: livePairs,
      liveNotInHolderSet: { count: liveNotHolders.length, rows: sortByKey(liveNotHolders) },
      unscannableSessionRows
    },
    keysWithNoHolder: {
      total: noHolder.liveSession + noHolder.staleSession + noHolder.actorOnly + noHolder.dataOnly,
      buckets: noHolder,
      s1_2Residual: { count: noHolder.dataOnly, localShapeSubCount: dataOnlyLocalShape },
      unenumeratedSources: UNENUMERATED_SOURCES,
      note: 'a lower bound: unenumeratedSources are not read. Disjoint buckets, first match wins: liveSession, staleSession, actorOnly, dataOnly. Only dataOnly (data rows and nothing else) sizes the S1.2 residual.'
    }
  }
}

/**
 * The one-screen human summary of a report.
 * @param {Object} report - from computeUrlKeyDuplicateReport
 * @returns {string}
 */
export function formatSummary(report) {
  const t = report.totals
  const n = report.keysWithNoHolder
  return [
    '[dry-run] LIN-3381 urlKey holders (read-only)',
    `  keys with a holder: ${t.keysWithHolders} (single holder: ${t.singleHolderKeys}); keys in urlKey stores: ${t.keysInUrlKeyStores}`,
    `  COLLISIONS (no common linked workspace edge; actionable): ${report.collisions.count}`,
    `  shared memberships (all holders reach one linked workspace; not actionable): ${report.sharedMemberships.count}`,
    `  suspected collisions, actor evidence only: ${report.suspectedCollisionsActorOnly.count}`,
    `  keys held under more than one workspace id (informational): ${report.keysOnMultipleWorkspaceIds.count}`,
    `  live sessions — ${report.liveSessionHolders.caveat}`,
    `      live keys: ${report.liveSessionHolders.liveKeys}; stale-present keys: ${report.liveSessionHolders.staleKeys}; live (key, account) not in holder set: ${report.liveSessionHolders.liveNotInHolderSet.count}; unscannable string rows: ${t.unscannableSessionRows}`,
    `  keys with no holder: ${n.total} (live session ${n.buckets.liveSession}, stale session ${n.buckets.staleSession}, actor only ${n.buckets.actorOnly}, data only ${n.buckets.dataOnly})`,
    `      not read (lower bound): ${n.unenumeratedSources.map(u => u.collection).join(', ') || 'none'}`,
    `      S1.2 residual signal = data only: ${n.s1_2Residual.count} (of which local-shape slug-<8 hex>: ${n.s1_2Residual.localShapeSubCount})`,
    `  ownerless tokens (counted, not holders): ${t.ownerlessTokens}; holders with a corrupt mergedInto chain: ${t.unresolvableHolders}`,
    '  Expect Jira teammates on one site to show as collisions (key = tenant host, workspace id = jira:<person>).',
    '  Ids are cut to 8 chars; urlKeys are printed in full. This script changes nothing; the S1.7 proposal goes to John.'
  ].join('\n')
}

/**
 * Compute the report and write the summary, then the JSON, to `out`.
 * @param {Object} options
 * @param {Object} options.db
 * @param {{write: function(string): void}} options.out - e.g. process.stdout
 * @returns {Promise<Object>} the report
 */
export async function runDryRun({ db, out, now } = {}) {
  const report = await computeUrlKeyDuplicateReport({ db, now })
  out.write(`${formatSummary(report)}\n`)
  out.write(`${JSON.stringify(report, null, 2)}\n`)
  return report
}

/** @param {string[]} argv - arguments after the script path */
export function parseArgs(argv) {
  if (argv.length > 0) throw new Error(`unexpected argument ${JSON.stringify(argv[0])}: this script takes none`)
  return {}
}

async function main() {
  parseArgs(process.argv.slice(2))
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  try {
    await runDryRun({ db: dbClient.db('linear-viewer'), out: process.stdout })
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
