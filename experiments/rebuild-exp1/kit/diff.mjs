#!/usr/bin/env node
// diff.mjs <oldImpl> <newImpl> [--corpus dir] [--private [real-markdown.json]]
//          [--out report.json] [--private-out file.json] [--jobs N] [--timeout ms]
//          [--shrink-limit N] [--shrink-budget N]
//
// Loads both implementations in isolation (separate module instances inside
// watchdogged worker threads), runs every corpus input through
//   ADF inputs:      adfToMarkdown, adfHasUnrenderableContent, markdownToAdf∘adfToMarkdown
//   Markdown inputs: markdownToAdf, adfToMarkdown∘markdownToAdf, adfHasUnrenderableContent∘markdownToAdf
// and compares the outputs (Markdown: exact string; ADF: deepStrictEqual, with
// "json-equal" for differences JSON.stringify erases; predicate: boolean;
// throws: error class + message). Every difference is shrunk to a small input
// that still differs the same way, then grouped by that input's shape signature.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { EvalPool } from './lib/pool.mjs'
import { loadCorpus, DEFAULT_CORPUS_DIR } from './lib/corpus.mjs'
import { FNS, FNS_BY_DOMAIN, compareResults, describeResult } from './lib/fns.mjs'
import { signatureFor, features } from './lib/signature.mjs'
import { sizeOf, encode } from './lib/serial.mjs'
import { parseCli, privatePathFrom, assertNotInKit } from './lib/cli.mjs'

const opts = parseCli(process.argv.slice(2), ['private'])
const [oldImpl, newImpl] = opts.positional.map(p => resolve(p))
if (!oldImpl || !newImpl) {
  console.error('usage: node diff.mjs <oldImpl> <newImpl> [--corpus dir] [--private [file]] [--out report.json] [--private-out file]')
  process.exit(2)
}
const privatePath = privatePathFrom(opts)
// --out carries only counts for private items; --private-out carries their
// signatures and examples and is refused under kit/.
if (privatePath && opts['private-out']) assertNotInKit(opts['private-out'], '--private-out')
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)
const shrinkLimit = Number(opts['shrink-limit'] ?? 50000)
const shrinkBudget = Number(opts['shrink-budget'] ?? 600)
const started = Date.now()

const { items, sources } = loadCorpus({ dir: opts.corpus ? resolve(opts.corpus) : DEFAULT_CORPUS_DIR, privatePath })
log(`[diff] ${items.length} inputs from ${Object.keys(sources).join(', ')}`)

const pool = await new EvalPool({ impls: { A: oldImpl, B: newImpl }, size: opts.jobs ? Number(opts.jobs) : undefined, timeoutMs: Number(opts.timeout ?? 5000) }).start()
if (pool.loadErrors) log(`[diff] LOAD ERRORS: ${JSON.stringify(pool.loadErrors)}`)

const cells = [] // one per (item, fn)
for (const item of items) for (const fn of FNS_BY_DOMAIN[item.domain]) cells.push({ item, fn })
const messages = []
for (const c of cells) for (const side of ['A', 'B']) messages.push({ type: 'eval', side, fn: c.fn, input: c.item.input })
const results = await pool.map(messages, (d, t) => log(`[diff] eval ${d}/${t}`))
cells.forEach((c, i) => { c.A = results[2 * i]; c.B = results[2 * i + 1]; c.cls = compareResults(c.A, c.B) })
log(`[diff] evaluated ${messages.length} calls in ${((Date.now() - started) / 1000).toFixed(1)}s (${pool.timeouts} timeouts)`)

// ---- counts ----------------------------------------------------------------
const blank = () => ({ inputs: 0, identical: 0, jsonEqual: 0, different: 0 })
const perFn = {}
const perSource = {}
for (const c of cells) {
  for (const [table, key] of [[perFn, c.fn], [perSource, `${c.item.source} ${c.fn}`]]) {
    table[key] ??= blank()
    table[key].inputs += 1
    table[key][c.cls === 'json-equal' ? 'jsonEqual' : c.cls] += 1
  }
}

// ---- shrink + group differences --------------------------------------------
const diffs = cells.filter(c => c.cls !== 'identical').sort((a, b) => a.item.size - b.item.size)
const toShrink = diffs.slice(0, shrinkLimit)
log(`[diff] ${diffs.length} differing (input, fn) cells; shrinking ${toShrink.length}`)
const shrunk = await pool.map(toShrink.map(c => ({ type: 'shrink', kind: 'differs', cls: c.cls, fn: c.fn, domain: c.item.domain, input: c.item.input, budget: shrinkBudget })))
await pool.close()

const groups = new Map()
diffs.forEach((c, i) => {
  const s = i < toShrink.length ? shrunk[i] : null
  const minimal = s && !s.timeout && 'value' in s ? s.value : c.item.input
  const sig = `${c.fn} | ${c.cls} | ${s && !s.timeout ? '' : '(unshrunk) '}${signatureFor(c.item.domain, minimal)}`
  const key = `${c.item.private ? 'private' : 'public'}::${sig}`
  const g = groups.get(key) || { fn: c.fn, cls: c.cls, signature: sig, private: c.item.private, count: 0, sources: {}, ids: [], best: null }
  g.count += 1
  g.sources[c.item.source] = (g.sources[c.item.source] || 0) + 1
  if (g.ids.length < 20) g.ids.push(c.item.id)
  const size = sizeOf(minimal)
  if (!g.best || size < g.best.size) {
    g.best = {
      id: c.item.id,
      originalSize: c.item.size,
      size,
      features: features(c.item.domain, minimal),
      input: encode(minimal),
      old: encode(describeResult(s?.final?.A ?? c.A)),
      new: encode(describeResult(s?.final?.B ?? c.B)),
    }
  }
  groups.set(key, g)
})
const allGroups = [...groups.values()].sort((a, b) => b.count - a.count)
const publicGroups = allGroups.filter(g => !g.private)
const privateGroups = allGroups.filter(g => g.private)

// coarse roll-up: fn × features of the minimal example
const coarse = {}
for (const g of publicGroups) {
  const k = `${g.fn} | ${g.best.features.join(',')}`
  coarse[k] = (coarse[k] || 0) + g.count
}

const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const meta = {
  old: { path: oldImpl, sha256: sha(oldImpl) },
  new: { path: newImpl, sha256: sha(newImpl) },
  node: process.version,
  corpus: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { ...v }])),
  functions: Object.fromEntries(Object.entries(FNS).map(([k, v]) => [k, v.label])),
  comparison: 'Markdown/string: ===; ADF: util.isDeepStrictEqual (json-equal = equal only after JSON round-trip); boolean: ===; throw: constructor name + message; timeout: both-timeout counts as identical',
  loadErrors: pool.loadErrors,
  timeouts: pool.timeouts,
  shrink: { limit: shrinkLimit, budget: shrinkBudget, shrunk: toShrink.length, differences: diffs.length },
  ms: Date.now() - started,
}
const privateCount = diffs.filter(c => c.item.private).length
const report = {
  meta,
  totals: perFn,
  perSource: Object.fromEntries(Object.entries(perSource).sort()),
  differences: diffs.length,
  privateDifferences: privateCount,
  groups: publicGroups,
  privateGroups: privatePath ? { count: privateGroups.length, cells: privateCount, note: 'signatures and examples withheld; see --private-out' } : undefined,
  coarse: Object.fromEntries(Object.entries(coarse).sort((a, b) => b[1] - a[1])),
}
if (opts.out) { mkdirSync(dirname(resolve(opts.out)), { recursive: true }); writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`) }
if (privatePath && opts['private-out']) {
  mkdirSync(dirname(resolve(opts['private-out'])), { recursive: true })
  writeFileSync(opts['private-out'], `${JSON.stringify({ meta, groups: privateGroups }, null, 2)}\n`)
}

// ---- console summary (counts only for private items) ------------------------
const line = (k, v) => `${k.padEnd(10)} ${String(v.inputs).padStart(6)} inputs  ${String(v.identical).padStart(6)} identical  ${String(v.jsonEqual).padStart(4)} json-equal  ${String(v.different).padStart(6)} different`
console.log(`diff ${oldImpl}\n  vs ${newImpl}`)
for (const [k, v] of Object.entries(perFn)) console.log(line(k, v))
console.log(`${diffs.length} differing cells (${privateCount} private) in ${allGroups.length} groups (${privateGroups.length} private); ${pool.timeouts} timeouts; ${(meta.ms / 1000).toFixed(1)}s`)
for (const g of publicGroups.slice(0, 15)) console.log(`  ${String(g.count).padStart(5)}  ${g.signature.slice(0, 140)}`)
