#!/usr/bin/env node
// mutate.mjs <implFile> [--tests <file>]... [--tree <dir>] [--slot <path>] [--jobs N]
//            [--timeout ms] [--out mutants.json] [--work <dir>] [--keep-work]
//            [--limit N] [--operators a,b]
//
// Plants every mutant of the fixed operator set (lib/mutants.mjs) into the
// tree's slot file, one at a time, and runs the test file(s) against it.
// Status per mutant: killed | survived | timeout | invalid (syntax error, or
// the module throws when imported). See README.md.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import os from 'node:os'
import { generateMutants, OPERATORS, OPERATOR_SET_VERSION } from './lib/mutants.mjs'
import { analyse, lineOwner } from './lib/shape-core.mjs'
import { prepareWorkerTrees, writeSlot, runTests, importCheck } from './lib/tree-runner.mjs'

const KIT = dirname(new URL(import.meta.url).pathname)

function parseArgs(argv) {
  const opts = { tests: [], positional: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const take = () => argv[++i]
    if (a === '--tests') opts.tests.push(...take().split(',').filter(Boolean))
    else if (a === '--tree') opts.tree = take()
    else if (a === '--slot') opts.slot = take()
    else if (a === '--jobs') opts.jobs = Number(take())
    else if (a === '--timeout') opts.timeout = Number(take())
    else if (a === '--out') opts.out = take()
    else if (a === '--work') opts.work = take()
    else if (a === '--keep-work') opts.keepWork = true
    else if (a === '--limit') opts.limit = Number(take())
    else if (a === '--operators') opts.operators = take().split(',')
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.positional.push(a)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
const implFile = opts.positional[0]
if (!implFile) {
  console.error('usage: node mutate.mjs <implFile> [--tests tests/unit/x.test.js]... [--tree dir] [--jobs N] [--out file]')
  process.exit(2)
}
const tree = resolve(opts.tree || join(KIT, '..', 'tree'))
const slot = opts.slot || 'lib/providers/jira/adf.js'
const testFiles = opts.tests.length ? opts.tests : ['tests/unit/jira-provider-adf-codec.test.js']
const jobs = opts.jobs || Math.max(1, os.availableParallelism())
const work = resolve(opts.work || `${tree}.mutate-work`)
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)

const source = readFileSync(resolve(implFile), 'utf8')
const shape = analyse(source)
let { mutants, duplicates, sitesConsidered } = generateMutants(source)
if (opts.operators) mutants = mutants.filter(m => opts.operators.includes(m.operator))
if (opts.limit) mutants = mutants.slice(0, opts.limit)
log(`[mutate] ${mutants.length} mutants (${sitesConsidered} sites, ${duplicates} duplicates dropped) from ${implFile}`)

const sweepStart = Date.now()
const dirs = prepareWorkerTrees(tree, work, jobs)
log(`[mutate] ${dirs.length} worker trees under ${work}`)
for (const d of dirs) writeSlot(d, slot, source)

// Baseline: the unmutated candidate must pass, and we time it.
const baselineRuns = []
for (let i = 0; i < 3; i += 1) {
  const r = await runTests(dirs[0], testFiles, { timeoutMs: 60000 })
  baselineRuns.push(r)
  if (r.status !== 'pass') {
    log(`[mutate] ABORT: the unmutated candidate does not pass ${testFiles.join(', ')} (${r.status}; ${r.failing.length} failing)`)
    for (const f of r.failing.slice(0, 20)) log(`   - ${f}`)
    if (r.failing.length === 0) log(r.stderrTail)
    if (opts.out) writeFileSync(opts.out, `${JSON.stringify({ aborted: true, reason: 'baseline-fails', failing: r.failing, status: r.status }, null, 2)}\n`)
    process.exit(3)
  }
}
const baselineMs = baselineRuns.map(r => Math.round(r.ms)).sort((a, b) => a - b)
const baselineMedian = baselineMs[1]
const timeoutMs = opts.timeout || Math.max(10000, 20 * baselineMedian)
const baselineTests = baselineRuns[0].summary
log(`[mutate] baseline passes (${baselineTests?.pass} tests), runs ${baselineMs.join('/')} ms; per-mutant timeout ${timeoutMs} ms`)

// Sweep.
let next = 0
let done = 0
const results = new Array(mutants.length)
async function worker(dir) {
  for (;;) {
    const idx = next
    next += 1
    if (idx >= mutants.length) return
    const m = mutants[idx]
    const base = {
      id: m.id, operator: m.operator, note: m.note, line: m.line, column: m.column,
      owner: lineOwner(shape, m.line),
      original: m.original.length > 300 ? `${m.original.slice(0, 300)}…` : m.original,
      replacement: m.replacement,
      lineBefore: m.lineBefore.length > 400 ? `${m.lineBefore.slice(0, 400)}…` : m.lineBefore,
      lineAfter: m.lineAfter.length > 400 ? `${m.lineAfter.slice(0, 400)}…` : m.lineAfter,
    }
    if (m.syntaxError) {
      results[idx] = { ...base, status: 'invalid', invalidKind: 'syntax', error: m.syntaxError, ms: 0 }
    } else {
      writeSlot(dir, slot, m.source)
      const r = await runTests(dir, testFiles, { timeoutMs })
      let status = r.status === 'pass' ? 'survived' : r.status === 'timeout' ? 'timeout' : 'killed'
      let invalidKind = null
      let error = null
      if (status === 'killed') {
        const ic = await importCheck(dir, slot)
        if (!ic.ok) { status = 'invalid'; invalidKind = 'import'; error = ic.error }
      }
      results[idx] = {
        ...base, status, invalidKind, error, ms: Math.round(r.ms),
        killedBy: status === 'killed' ? {
          count: r.failing.length,
          byFile: r.failing.reduce((acc, t) => { const f = t.split(' :: ')[0]; acc[f] = (acc[f] || 0) + 1; return acc }, {}),
          tests: r.failing.slice(0, 8),
        } : undefined,
        network: r.network.length ? r.network : undefined,
      }
    }
    done += 1
    if (done % 25 === 0 || done === mutants.length) log(`[mutate] ${done}/${mutants.length} (${Math.round((Date.now() - sweepStart) / 1000)}s)`)
  }
}
await Promise.all(dirs.map(d => worker(d)))
for (const d of dirs) writeSlot(d, slot, source)
const sweepMs = Date.now() - sweepStart
if (!opts.keepWork && !opts.work) rmSync(work, { recursive: true, force: true })

const count = s => results.filter(r => r.status === s).length
const killed = count('killed')
const survived = count('survived')
const timeout = count('timeout')
const invalid = results.filter(r => r.status === 'invalid')
const valid = killed + survived + timeout
const byOperator = {}
const byOwner = {}
for (const r of results) {
  for (const [table, key] of [[byOperator, r.operator], [byOwner, r.owner]]) {
    table[key] ??= { total: 0, killed: 0, survived: 0, timeout: 0, invalid: 0 }
    table[key].total += 1
    table[key][r.status] += 1
  }
}
const report = {
  meta: {
    impl: resolve(implFile),
    implSha256: createHash('sha256').update(source).digest('hex'),
    tree,
    slot,
    testFiles,
    node: process.version,
    operatorSet: OPERATOR_SET_VERSION,
    operators: OPERATORS,
    jobs: dirs.length,
    timeoutMs,
    baselineRunMs: { runs: baselineMs, median: baselineMedian, tests: baselineTests },
    sweepMs,
    finishedAt: new Date().toISOString(),
    filtered: opts.limit || opts.operators ? { limit: opts.limit ?? null, operators: opts.operators ?? null } : null,
  },
  totals: {
    sitesConsidered,
    duplicatesDropped: duplicates,
    mutants: results.length,
    killed,
    survived,
    timeout,
    invalid: { total: invalid.length, syntax: invalid.filter(r => r.invalidKind === 'syntax').length, import: invalid.filter(r => r.invalidKind === 'import').length },
    killRate: valid ? +(killed / valid).toFixed(4) : null,
    score: valid ? +((killed + timeout) / valid).toFixed(4) : null,
    networkAttempts: results.filter(r => r.network).length,
  },
  byOperator,
  byOwner,
  survivors: results.filter(r => r.status === 'survived').map(({ id, operator, note, line, column, owner, original, replacement, lineBefore, lineAfter }) => ({ id, operator, note, line, column, owner, original, replacement, lineBefore, lineAfter })),
  mutants: results,
}
const json = JSON.stringify(report, null, 2)
if (opts.out) writeFileSync(opts.out, `${json}\n`)
log(`[mutate] done in ${(sweepMs / 1000).toFixed(1)}s: ${killed} killed, ${survived} survived, ${timeout} timeout, ${invalid.length} invalid; kill rate ${report.totals.killRate}`)
if (!opts.out) process.stdout.write(`${json}\n`)
