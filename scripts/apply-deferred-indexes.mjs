#!/usr/bin/env node
/**
 * Deferred index build (LIN-3811): prints, and with `--apply` builds, the
 * indexes `lib/db-indexes.js` declares with `tier: 'deferred'`. Boot builds the
 * boot tier only; after `listen` the server builds any still-pending deferred
 * spec itself in the background (LIN-3865, `scheduleDeferredIndexBuild`, which
 * calls the same `applyDeferredIndexes`). This script is the manual tool, and
 * it is how the first production build was run (over `railway ssh` on the app
 * service); runbook: docs/runbooks/deferred-index-build.md.
 *
 * `--plan` is the default and writes nothing. NOT a route and NOT imported by
 * the app.
 *
 * Usage:
 *   MONGODB_URI=<set in your shell> node scripts/apply-deferred-indexes.mjs
 *   MONGODB_URI=<set in your shell> node scripts/apply-deferred-indexes.mjs --apply [--only <collection>:<name>]
 *
 * Exit codes: 0 done, 1 a build failed (or an unreadable index state under
 * --plan), 2 neither MONGODB_URI nor HARBOUR_DATA_DIR is set, 4 unknown --only.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'
import { INDEX_SPECS, tierOf, deferredIndexState, applyDeferredIndexes, deferredSpecId } from '../lib/db-indexes.js'

export const EXIT_FAILED = 1
export const EXIT_NO_DATABASE = 2
export const EXIT_UNKNOWN_ONLY = 4

export class DeferredIndexError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'DeferredIndexError'
    this.code = code
  }
}

export function parseArgs(argv) {
  const opts = { apply: false, only: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--plan') opts.apply = false
    else if (arg === '--apply') opts.apply = true
    else if (arg === '--only') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new DeferredIndexError('--only needs a <collection>:<name> value', EXIT_UNKNOWN_ONLY)
      opts.only = value
    } else throw new DeferredIndexError(`unknown argument ${arg}`, EXIT_FAILED)
  }
  return opts
}

const statusOf = built => (built === true ? 'built' : built === false ? 'pending' : 'unknown')

export async function main(argv = process.argv.slice(2), env = process.env, { logger = console, client } = {}) {
  if (!client && !env.MONGODB_URI && !env.HARBOUR_DATA_DIR) {
    logger.error('[deferred-indexes] set MONGODB_URI or HARBOUR_DATA_DIR')
    return EXIT_NO_DATABASE
  }
  const opts = parseArgs(argv)
  const ids = INDEX_SPECS.filter(spec => tierOf(spec) === 'deferred').map(deferredSpecId)
  if (opts.only !== undefined && !ids.includes(opts.only)) {
    logger.error(`[deferred-indexes] unknown --only "${opts.only}"; deferred specs: ${ids.join(', ')}`)
    return EXIT_UNKNOWN_ONLY
  }
  const dbClient = client ?? (env.MONGODB_URI ? new MongoClient(env.MONGODB_URI) : new MangoClient(env.HARBOUR_DATA_DIR))
  await dbClient.connect()
  try {
    const db = dbClient.db('linear-viewer')
    if (!opts.apply) {
      const state = await deferredIndexState(db, { logger })
      for (const entry of state) logger.log(`[deferred-indexes] ${statusOf(entry.built).padEnd(7)} ${deferredSpecId(entry)}`)
      logger.log('[deferred-indexes] plan only: nothing was built. Re-run with --apply to build the pending specs.')
      return state.some(entry => entry.built === 'unknown') ? EXIT_FAILED : 0
    }
    const { failed } = await applyDeferredIndexes(db, { logger, only: opts.only })
    return failed.length ? EXIT_FAILED : 0
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

/** Only our own refusals carry a meaningful code: a driver error's integer `code` must not read as this script's 2 or 4. */
export const exitCodeOf = (err) => (err?.name === 'DeferredIndexError' ? err.code : 1)

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => { process.exitCode = code }).catch(err => {
    console.error(`[deferred-indexes] failed: ${err?.name === 'DeferredIndexError' ? err.message : (err?.code ?? err?.name ?? 'error')}`)
    process.exitCode = exitCodeOf(err)
  })
}
