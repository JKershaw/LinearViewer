#!/usr/bin/env node
/**
 * Read-only production acceptance check for the LIN-3163 paged-list indexes.
 *
 * LIN-3163 extends the four full-history paged-list indexes so each key matches
 * its list's sort exactly (after the `urlKey:1` prefix):
 *
 *   proxy-events   {urlKey:1, timestamp:-1, _id:-1}
 *   foreman-status {urlKey:1, timestamp:-1, _id:-1}
 *   llm-call-log   {urlKey:1, timestamp:-1, _id:-1}
 *   prompt-traces  {urlKey:1, timestamp:-1, _seq:-1, _id:-1}
 *
 * CI runs MangoDB, which has no query planner, so nothing in CI can prove the
 * planner actually picks these indexes and drops the blocking sort. This script
 * is the repeatable, read-only way to collect that production evidence, and
 * LIN-3164 can reuse it.
 *
 * NOT a route, NOT autopilot-reachable, NOT auto-executed anywhere — this file
 * has no import site in the app. Read-only: it issues `getIndexes()`, clears the
 * plan cache, and runs `explain()`; it writes no documents and creates/drops no
 * indexes.
 *
 * Usage:
 *   MONGODB_URI="<prod>" node scripts/explain-paged-lists-lin3163.js
 *   MONGODB_URI="<prod>" LIN3163_URL_KEY=linearviewer node scripts/explain-paged-lists-lin3163.js
 *
 * Same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js. The pure verdict
 * function is unit-tested against fixture explain JSON in
 * tests/unit/explain-paged-lists-lin3163.test.js.
 */

import { MongoClient } from 'mongodb'
import { MangoClient } from '@jkershaw/mangodb'

export const EXTENDED_INDEX_NAMES = {
  'proxy-events': 'urlKey_1_timestamp_-1__id_-1',
  'foreman-status': 'urlKey_1_timestamp_-1__id_-1',
  'llm-call-log': 'urlKey_1_timestamp_-1__id_-1',
  'prompt-traces': 'urlKey_1_timestamp_-1__seq_-1__id_-1'
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Flatten a winningPlan tree into its stage nodes. Walks the classic
 * `inputStage`/`inputStages` shape plus SBE's nested `queryPlan`.
 *
 * @param {object} plan
 * @param {Array<object>} [out]
 * @returns {Array<object>}
 */
export function collectPlanStages(plan, out = []) {
  if (!plan || typeof plan !== 'object') return out
  if (plan.stage) out.push(plan)
  if (plan.inputStage) collectPlanStages(plan.inputStage, out)
  if (Array.isArray(plan.inputStages)) {
    for (const stage of plan.inputStages) collectPlanStages(stage, out)
  }
  if (plan.queryPlan) collectPlanStages(plan.queryPlan, out)
  return out
}

/**
 * Pure verdict for one `explain("executionStats")` of a paged-list find.
 *
 * Pass criteria (design, LIN-3163): no COLLSCAN anywhere; no SORT stage; the
 * winning IXSCAN is the expected extended index; `totalDocsExamined` no more
 * than the page can hold (`maxDocs`); `totalKeysExamined` no more than
 * `skip + limit`.
 *
 * The task-filtered agent-status read may instead win on
 * `urlKey_1_taskIdentifier_1` with a SORT bounded by that task's rows — allowed
 * only when `allowTaskBoundedIndex` names that index, there is still no
 * COLLSCAN, and `maxDocs` is set to the task's own row count (never the
 * workspace's).
 *
 * @param {object} args
 * @param {object} args.explain - the explain() result
 * @param {string} args.expectedIndex - the extended index name that must win
 * @param {number} args.limit - the page limit
 * @param {number} [args.skip=0] - the page offset
 * @param {number} [args.maxDocs] - max docs that may be examined (defaults to limit)
 * @param {string|null} [args.allowTaskBoundedIndex=null] - alternative index permitted for a task-bounded read
 * @returns {{pass: boolean, reasons: string[], indexName: (string|null), hasSort: boolean, hasCollscan: boolean, docsExamined: (number|null), keysExamined: (number|null)}}
 */
export function evaluatePagedListExplain({
  explain,
  expectedIndex,
  limit,
  skip = 0,
  maxDocs,
  allowTaskBoundedIndex = null
} = {}) {
  const winningPlan = explain?.queryPlanner?.winningPlan
  const stages = collectPlanStages(winningPlan)
  const stageNames = stages.map(s => s.stage)
  const hasSort = stageNames.includes('SORT') || stageNames.includes('SORT_MERGE')
  const hasCollscan = stageNames.includes('COLLSCAN')
  const ixscan = stages.find(s => s.stage === 'IXSCAN')
  const indexName = ixscan?.indexName ?? null
  const docsExamined = explain?.executionStats?.totalDocsExamined ?? null
  const keysExamined = explain?.executionStats?.totalKeysExamined ?? null

  const taskBounded = Boolean(allowTaskBoundedIndex) && indexName === allowTaskBoundedIndex
  const docBudget = maxDocs === undefined ? limit : maxDocs
  const reasons = []

  if (!winningPlan) reasons.push('no winningPlan in explain result')
  if (hasCollscan) reasons.push('plan contains a COLLSCAN')
  if (hasSort && !taskBounded) reasons.push('plan contains a blocking SORT stage')
  if (indexName !== expectedIndex && !taskBounded) {
    reasons.push(`winning IXSCAN is ${indexName ?? 'none'}, expected ${expectedIndex}`)
  }
  if (docsExamined === null) reasons.push('no executionStats.totalDocsExamined')
  else if (docsExamined > docBudget) {
    reasons.push(`totalDocsExamined ${docsExamined} exceeds the page budget ${docBudget}`)
  }
  if (keysExamined === null) reasons.push('no executionStats.totalKeysExamined')
  else if (keysExamined > skip + limit) {
    reasons.push(`totalKeysExamined ${keysExamined} exceeds skip+limit ${skip + limit}`)
  }

  return { pass: reasons.length === 0, reasons, indexName, hasSort, hasCollscan, docsExamined, keysExamined }
}

/**
 * Pure verdict for the `countDocuments({urlKey})` explain: a key-only COUNT_SCAN
 * that examines no documents.
 *
 * @param {object} explain
 * @returns {{pass: boolean, reasons: string[], indexName: (string|null)}}
 */
export function evaluateCountExplain(explain) {
  const stages = collectPlanStages(explain?.queryPlanner?.winningPlan)
  const stageNames = stages.map(s => s.stage)
  const docsExamined = explain?.executionStats?.totalDocsExamined ?? null
  const indexName = stages.find(s => s.stage === 'COUNT_SCAN')?.indexName ?? null
  const reasons = []
  if (!stageNames.includes('COUNT_SCAN')) reasons.push('winning plan is not a COUNT_SCAN')
  if (stageNames.includes('COLLSCAN')) reasons.push('plan contains a COLLSCAN')
  if (docsExamined !== 0) reasons.push(`totalDocsExamined is ${docsExamined}, expected 0`)
  return { pass: reasons.length === 0, reasons, indexName }
}

/**
 * Pure acceptance verdict over the collected production evidence.
 *
 * @param {object} args
 * @param {Object<string, string[]>} args.indexes - collection -> index names from getIndexes()
 * @param {Array<object>} args.findShapes - [{ key, collection, explain, limit, skip?, maxDocs?, allowTaskBoundedIndex? }]
 * @param {Array<object>} [args.countShapes] - [{ key, collection, explain }]
 * @returns {{pass: boolean, rows: Array<{key: string, pass: boolean, reasons: string[]}>}}
 */
export function evaluateAcceptance({ indexes = {}, findShapes = [], countShapes = [] } = {}) {
  const rows = []

  for (const [collection, expectedName] of Object.entries(EXTENDED_INDEX_NAMES)) {
    const present = Array.isArray(indexes[collection]) && indexes[collection].includes(expectedName)
    rows.push({
      key: `index present: ${collection} ${expectedName}`,
      pass: present,
      reasons: present ? [] : [`index ${expectedName} not found among ${JSON.stringify(indexes[collection] || [])}`]
    })
  }

  for (const shape of findShapes) {
    const verdict = evaluatePagedListExplain(shape)
    rows.push({ key: shape.key, pass: verdict.pass, reasons: verdict.reasons })
  }

  for (const shape of countShapes) {
    const verdict = evaluateCountExplain(shape.explain)
    rows.push({ key: shape.key, pass: verdict.pass, reasons: verdict.reasons })
  }

  return { pass: rows.every(r => r.pass), rows }
}

async function runExplain(cursor) {
  return cursor.explain('executionStats')
}

async function collectIndexNames(db, collection) {
  const list = await db.collection(collection).indexes()
  return list.map(idx => idx.name).filter(Boolean)
}

async function main() {
  const urlKey = process.env.LIN3163_URL_KEY || 'linearviewer'
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data')
  await dbClient.connect()
  const db = dbClient.db('linear-viewer')

  try {
    const indexes = {}
    for (const collection of Object.keys(EXTENDED_INDEX_NAMES)) {
      indexes[collection] = await collectIndexNames(db, collection)
      // Deterministic planner comparison: clear the cache, as the design requires.
      try {
        await db.command({ planCacheClear: collection })
      } catch {
        // planCacheClear is best-effort; some deployments/engines may not expose it.
      }
    }

    const findShapes = []
    const addFind = async (key, collection, build, opts = {}) => {
      try {
        const explain = await runExplain(build(db.collection(collection)))
        findShapes.push({ key, collection, explain, ...opts })
      } catch (err) {
        findShapes.push({ key, collection, explain: null, ...opts, error: err.message })
      }
    }

    await addFind('proxy-events page 1 (limit 50)', 'proxy-events',
      c => c.find({ urlKey }).sort({ timestamp: -1, _id: -1 }).limit(50),
      { limit: 50, skip: 0 })
    await addFind('proxy-events deep page (skip 5000, limit 50)', 'proxy-events',
      c => c.find({ urlKey }).sort({ timestamp: -1, _id: -1 }).skip(5000).limit(50),
      { limit: 50, skip: 5000 })
    await addFind('prompt-traces page 1 (limit 50)', 'prompt-traces',
      c => c.find({ urlKey }).sort({ timestamp: -1, _seq: -1, _id: -1 }).limit(50),
      { limit: 50, skip: 0 })
    await addFind('llm-call-log page 1 (limit 50)', 'llm-call-log',
      c => c.find({ urlKey }).sort({ timestamp: -1, _id: -1 }).limit(50),
      { limit: 50, skip: 0 })
    await addFind('foreman-status page 1 (limit 20)', 'foreman-status',
      c => c.find({ urlKey }).sort({ timestamp: -1, _id: -1 }).limit(20),
      { limit: 20, skip: 0 })

    // Task-filtered agent-status read: may win on the task index with a bounded
    // SORT, so cap docsExamined at the task's own row count.
    const sample = await db.collection('foreman-status').findOne({ urlKey }, { projection: { taskIdentifier: 1 } })
    if (sample?.taskIdentifier) {
      const taskRows = await db.collection('foreman-status').countDocuments({ urlKey, taskIdentifier: sample.taskIdentifier })
      await addFind(`foreman-status task=${sample.taskIdentifier} (limit 20)`, 'foreman-status',
        c => c.find({ urlKey, taskIdentifier: sample.taskIdentifier }).sort({ timestamp: -1, _id: -1 }).limit(20),
        { limit: 20, skip: 0, maxDocs: taskRows, allowTaskBoundedIndex: 'urlKey_1_taskIdentifier_1' })
    } else {
      findShapes.push({ key: 'foreman-status task-filtered (limit 20)', collection: 'foreman-status', explain: null, limit: 20, skip: 0, error: 'no taskIdentifier row to sample' })
    }

    const now = Date.now()
    await addFind('foreman-status live-console range (limit 20)', 'foreman-status',
      c => c.find({ urlKey, timestamp: { $gte: new Date(now - DAY_MS), $lt: new Date(now) } }).sort({ timestamp: -1, _id: -1 }).limit(20),
      { limit: 20, skip: 0 })

    const countShapes = []
    try {
      const explain = await db.command({ explain: { count: 'proxy-events', query: { urlKey } }, verbosity: 'executionStats' })
      countShapes.push({ key: 'proxy-events countDocuments({urlKey})', explain })
    } catch (err) {
      countShapes.push({ key: 'proxy-events countDocuments({urlKey})', explain: null, error: err.message })
    }

    const shapesForVerdict = findShapes.map(s => ({
      key: s.key,
      collection: s.collection,
      explain: s.explain,
      limit: s.limit,
      skip: s.skip,
      maxDocs: s.maxDocs,
      allowTaskBoundedIndex: s.allowTaskBoundedIndex,
      expectedIndex: EXTENDED_INDEX_NAMES[s.collection],
      ...(s.error ? { explain: { error: s.error } } : {})
    }))

    const verdict = evaluateAcceptance({ indexes, findShapes: shapesForVerdict, countShapes })

    console.log(`[lin3163] urlKey=${urlKey}`)
    console.log('')
    console.log('shape'.padEnd(52), 'verdict'.padEnd(8), 'reasons')
    for (const row of verdict.rows) {
      console.log(row.key.padEnd(52), (row.pass ? 'PASS' : 'FAIL').padEnd(8), row.reasons.join('; '))
    }
    console.log('')
    console.log(verdict.pass ? '[lin3163] OVERALL: PASS' : '[lin3163] OVERALL: FAIL')
    if (!verdict.pass) process.exitCode = 1
  } finally {
    if (dbClient.close) await dbClient.close()
  }
}

// Only run when invoked directly, never on import — keeps the script
// test-importable without side effects (same convention as
// scripts/scan-mis-mirrored-workspaces-lin1981.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[lin3163] failed:', err)
    process.exitCode = 1
  })
}