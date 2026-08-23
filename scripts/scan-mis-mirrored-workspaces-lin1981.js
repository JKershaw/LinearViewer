#!/usr/bin/env node
/**
 * Read-only operator scan (LIN-1981).
 *
 * LIN-1981's open root-cause candidate is confirmed at the CODE level:
 * `linkProvider` (lib/workspace.js) mirrors a newly-linked provider's token
 * onto a workspace's scalar fields whenever `workspace.provider` is unset —
 * the legacy Linear state, since absent-provider is read as Linear everywhere
 * (`normalizeProviderName`). What has never been answered is whether any
 * EXISTING stored workspace is actually in that mis-mirrored state, because
 * that requires reading the real session store, which no investigating
 * session so far (including this one) has had production access to do.
 *
 * This script does not need to guess at what a mis-mirrored record looks
 * like in isolation — the mis-mirror overwrites its own evidence (the
 * original Linear scalar fields are gone once a foreign credential lands on
 * them), so a single record can no longer prove what it used to be. What
 * DOES survive is the divergence the LIN-1981 investigation already
 * identified: the proxy/agent lane and the session-cookie lane read
 * DIFFERENT session rows for the same (accountId, urlKey), so a mis-mirror
 * that has happened produces two session rows for the same logical
 * workspace disagreeing about `provider` — one still reading `unset`
 * (≡ Linear), the other reading the foreign provider the mirror wrote.
 *
 * This scan groups every session row by (accountId, urlKey) and flags a
 * group only when BOTH are true: at least one row's RAW `provider` field is
 * unset AND STILL CARRIES A LIVE CREDENTIAL (accessToken or
 * `credentials.token`) — the legacy pre-binding state the mirror guard keys
 * on, still usable, not yet touched by a second link — AND at least one other
 * row's normalized provider is a foreign, non-Linear one. That is
 * deliberately narrower than "any two rows disagree on provider," for two
 * reasons:
 *
 * - `setActiveProvider` (lib/workspace.js) is a legitimate re-point primitive
 *   that can leave a stale device's session row reading the PREVIOUS active
 *   provider for a while (a real, unrelated, already-documented shape — see
 *   the LIN-2235 stale-mirror note). That transition always moves between two
 *   EXPLICIT provider values, never through `unset`, so requiring an unset
 *   row excludes it.
 * - `unlinkProvider` (lib/workspace.js), when the removed binding was a
 *   workspace's LAST one, explicitly `delete`s `provider` AND every scalar
 *   credential field together (`accessToken`/`credentials`/`tokenExpiresAt`).
 *   That is also a legitimate transition through `unset`, reachable from
 *   Settings' remove-a-source route (server.js) — but unlike a genuine
 *   never-yet-mirrored legacy row, it leaves NO credential behind. Requiring
 *   the unset row to still carry a credential is what tells "still-legacy,
 *   not yet mis-mirrored" apart from "deliberately emptied out."
 *
 * Secret-safe by the same contract as lib/credential-diagnostics.js: never a
 * token, never a raw session id, never another account's id in the report —
 * only public urlKeys, provider names, and the `expiryKind` diagnostic
 * (lib/credential-diagnostics.js).
 *
 * Deliberately does NOT report `shapeMismatch` (also from
 * lib/credential-diagnostics.js), even though it names this exact bug in its
 * own doc comment. That field is designed to compare a REQUEST's resolved
 * provider against a credential that may have come from a DIFFERENT source
 * (cache vs. session-scan vs. refresh-on-resolve) at the moment a live call
 * is made — see routes/proxy.js's use of it. A single stored session row's
 * `provider` and its own scalar credential always come from the SAME write
 * (linkProvider always sets both together), so they are self-consistent by
 * construction and this field would simply never fire true here — reporting
 * it would look like coverage this static scan does not actually have.
 *
 * NOT a route, NOT autopilot-reachable, NOT auto-executed anywhere — this
 * file has no import site in the app. Read-only: it performs no writes, so
 * there is no --execute flag (contrast scripts/repair-account-merge-lin2233.js).
 *
 * Usage:
 *   node scripts/scan-mis-mirrored-workspaces-lin1981.js
 *
 * Uses the same MONGODB_URI / HARBOUR_DATA_DIR environment convention as
 * server.js and scripts/repair-account-merge-lin2233.js.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { normalizeProviderName } from '../lib/workspace.js'
import { describeExpiry } from '../lib/credential-diagnostics.js'

function parseSessionData(row) {
  return typeof row.session === 'string' ? JSON.parse(row.session) : row.session
}

/**
 * Groups every workspace entry across every session row by (accountId,
 * urlKey) and flags a group only when it carries the specific LIN-1981
 * signature: at least one row with `provider` genuinely unset (raw, not just
 * normalized) AND still carrying a live scalar credential, alongside at
 * least one other row whose provider is a different, foreign one. See the
 * file header for why this is narrower than "any two rows disagree."
 *
 * @param {Array<{_id: string, session: (string|Object)}>} sessionRows - raw docs from the `sessions` collection
 * @returns {{scannedSessionRows: number, scannedWorkspaceEntries: number, distinctAccountWorkspacePairs: number, flagged: Array<{urlKey: string, distinctProviders: string[], sessionCount: number, entries: Array<{provider: string, unsetWithCredential: boolean, expiryKind: string}>}>}}
 */
export function scanForDivergentWorkspaceProviders(sessionRows) {
  const groups = new Map()

  let scannedWorkspaceEntries = 0
  for (const row of sessionRows) {
    let data
    try {
      data = parseSessionData(row)
    } catch {
      continue // malformed row — not this scan's concern, skip rather than crash the whole pass
    }
    const accountId = data?.accountId
    if (!accountId || !Array.isArray(data?.workspaces)) continue

    for (const ws of data.workspaces) {
      if (!ws?.urlKey) continue
      scannedWorkspaceEntries++
      // A composite key that just concatenates the two fields would mis-group
      // if either ever contained the delimiter; keep them as a real array pair
      // instead of a string to join/split, so grouping never depends on
      // accountId/urlKey never containing "::".
      const key = JSON.stringify([accountId, ws.urlKey])
      if (!groups.has(key)) groups.set(key, { urlKey: ws.urlKey, entries: [] })
      const hasCredential = Boolean(ws.accessToken || ws.credentials?.token)
      groups.get(key).entries.push({
        provider: normalizeProviderName(ws.provider),
        unsetWithCredential: !ws.provider && hasCredential,
        expiryKind: describeExpiry(ws.tokenExpiresAt).expiryKind,
      })
    }
  }

  const flagged = []
  for (const { urlKey, entries } of groups.values()) {
    const distinctProviders = [...new Set(entries.map(e => e.provider))]
    const hasUnsetCredentialedRow = entries.some(e => e.unsetWithCredential)
    const hasForeignRow = entries.some(e => e.provider !== 'linear')
    if (hasUnsetCredentialedRow && hasForeignRow && distinctProviders.length > 1) {
      flagged.push({ urlKey, distinctProviders, sessionCount: entries.length, entries })
    }
  }

  return {
    scannedSessionRows: sessionRows.length,
    scannedWorkspaceEntries,
    distinctAccountWorkspacePairs: groups.size,
    flagged,
  }
}

async function main() {
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  const db = dbClient.db('linear-viewer')

  try {
    const sessionRows = await db.collection('sessions').find({}).toArray()
    const result = scanForDivergentWorkspaceProviders(sessionRows)
    console.log(`[scan] LIN-1981 — scanned ${result.scannedSessionRows} session row(s), ${result.scannedWorkspaceEntries} workspace entr${result.scannedWorkspaceEntries === 1 ? 'y' : 'ies'} across ${result.distinctAccountWorkspacePairs} (account, urlKey) pair(s).`)
    if (result.flagged.length === 0) {
      console.log('[scan] No (account, urlKey) pair showed a still-credentialed unset-provider row alongside a foreign-provider row — no evidence of a live LIN-1981 mis-mirror in this store.')
    } else {
      console.log(`[scan] ${result.flagged.length} pair(s) show the LIN-1981 signature (a still-credentialed unset-provider row alongside a foreign-provider one) — repair-need candidates:`)
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

// Only run when invoked directly, never on import — keeps the script
// test-importable without side effects (same convention as
// scripts/repair-account-merge-lin2233.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[scan] failed:', err)
    process.exitCode = 1
  })
}
