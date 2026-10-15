#!/usr/bin/env node
// observe.mjs <impl> [--private [file]] [--out obs.json] [--private-out file.json]
//             [--corpus dir] [--shrink-limit N] [--shrink-budget N] [--jobs N]
//
// Behavioural observations of ONE implementation over the corpus — no
// judgement, just counts plus a shrunk minimal example per group:
//   throws / timeouts per function; adfHasUnrenderableContent verdicts;
//   ADF → md → ADF: equal / equal modulo the four documented exceptions /
//     lossy — split by the gate's verdict (lossy-while-permitted is the
//     interesting cell); gate-refuses-an-exact-round-trip;
//   md → ADF → md: exact / not; normal-form idempotence (both directions);
//   the gate flagging the writer's own output.
// Run it on the old and the new implementation and compare the two files.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { EvalPool } from './lib/pool.mjs'
import { loadCorpus, DEFAULT_CORPUS_DIR } from './lib/corpus.mjs'
import { FNS_BY_DOMAIN, describeResult } from './lib/fns.mjs'
import { classifyAdfRoundTrip } from './lib/observations.mjs'
import { signatureFor, features } from './lib/signature.mjs'
import { sizeOf, encode } from './lib/serial.mjs'
import { parseCli, privatePathFrom, assertNotInKit } from './lib/cli.mjs'

const opts = parseCli(process.argv.slice(2), ['private'])
const impl = opts.positional[0] && resolve(opts.positional[0])
if (!impl) { console.error('usage: node observe.mjs <impl> [--private [file]] [--out obs.json] [--private-out file]'); process.exit(2) }
const privatePath = privatePathFrom(opts)
if (privatePath && opts['private-out']) assertNotInKit(opts['private-out'], '--private-out')
const shrinkLimit = Number(opts['shrink-limit'] ?? 300)
const shrinkBudget = Number(opts['shrink-budget'] ?? 600)
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)
const started = Date.now()
const jsonNormal = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

const { items, sources } = loadCorpus({ dir: opts.corpus ? resolve(opts.corpus) : DEFAULT_CORPUS_DIR, privatePath })
const pool = await new EvalPool({ impls: { A: impl }, size: opts.jobs ? Number(opts.jobs) : undefined, timeoutMs: Number(opts.timeout ?? 5000) }).start()
if (pool.loadErrors) { log(`[observe] LOAD ERROR ${JSON.stringify(pool.loadErrors)}`); process.exit(3) }

// Round 1: every function on every input.
const cells = []
for (const item of items) for (const fn of FNS_BY_DOMAIN[item.domain]) cells.push({ item, fn })
const r1 = await pool.map(cells.map(c => ({ type: 'eval', side: 'A', fn: c.fn, input: c.item.input })))
for (const [i, c] of cells.entries()) { c.item.res ??= {}; c.item.res[c.fn] = r1[i] }
// Round 2: the round trip applied to its own output (normal-form idempotence).
const second = items.filter(it => (it.domain === 'adf' ? 'ok' in it.res.rt_adf : 'ok' in it.res.rt_md))
const r2 = await pool.map(second.map(it => ({ type: 'eval', side: 'A', fn: it.domain === 'adf' ? 'rt_adf' : 'rt_md', input: it.domain === 'adf' ? it.res.rt_adf.ok : it.res.rt_md.ok })))
second.forEach((it, i) => { it.res.rt2 = r2[i] })
log(`[observe] ${cells.length + second.length} evaluations in ${((Date.now() - started) / 1000).toFixed(1)}s`)

// ---- classify each input ---------------------------------------------------
const cats = {} // category -> [item]
const addCat = (cat, item) => { (cats[cat] ??= []).push(item) }
const counters = {}
const bump = (path, by = 1) => {
  const keys = path.split('.')
  let o = counters
  for (const k of keys.slice(0, -1)) o = o[k] ??= {}
  o[keys[keys.length - 1]] = (o[keys[keys.length - 1]] || 0) + by
}
const normMsg = m => String(m).replace(/\d+/g, 'N').slice(0, 120)
const throwGroups = new Map()

for (const it of items) {
  const src = it.source
  for (const fn of FNS_BY_DOMAIN[it.domain]) {
    const r = it.res[fn]
    if (r.threw) {
      bump(`throws.${fn}.${src}`)
      const key = `${fn} | ${r.threw.name}: ${normMsg(r.threw.message)}`
      const g = throwGroups.get(key) || { fn, error: `${r.threw.name}: ${normMsg(r.threw.message)}`, items: [] }
      g.items.push(it)
      throwGroups.set(key, g)
    }
    if (r.timeout) bump(`timeouts.${fn}.${src}`)
  }
  if (it.domain === 'adf') {
    const g = it.res.gate
    const verdict = g.ok === true ? 'true' : g.ok === false ? 'false' : 'threw/timeout'
    bump(`gate.${src}.${verdict}`)
    if (src === 'gen-adf') bump(`gateByProfile.${it.tag.split('/')[0]}.${verdict}`)
    const rt = classifyAdfRoundTrip(it.input, it.res.rt_adf)
    bump(`adfRoundTrip.${src}.gate=${verdict}.${rt}`)
    if (verdict === 'false' && rt === 'lossy') addCat('adf-rt-lossy-while-permitted', it)
    if (verdict === 'true' && rt === 'equal') addCat('gate-refuses-exact-round-trip', it)
    if ('ok' in it.res.rt_adf && it.res.rt2 && 'ok' in it.res.rt2) {
      const idem = isDeepStrictEqual(jsonNormal(it.res.rt2.ok), jsonNormal(it.res.rt_adf.ok))
      bump(`adfIdempotent.${src}.${idem}`)
      if (!idem) addCat('adf-normal-form-not-idempotent', it)
    }
  } else {
    if (typeof it.input === 'string' && 'ok' in it.res.rt_md) {
      const exact = it.res.rt_md.ok === it.input
      bump(`mdRoundTripExact.${src}.${exact}`)
      if (!exact) addCat('md-rt-not-exact', it)
    }
    if (it.res.rt2 && 'ok' in it.res.rt2) {
      const idem = it.res.rt2.ok === it.res.rt_md.ok
      bump(`mdIdempotent.${src}.${idem}`)
      if (!idem) addCat('md-normal-form-not-idempotent', it)
    }
    const gw = it.res.gate_m2a
    bump(`gateOnWriterOutput.${src}.${gw.ok === true ? 'true' : gw.ok === false ? 'false' : 'threw/timeout'}`)
    if (gw.ok === true) addCat('gate-flags-writer-output', it)
  }
}

// ---- shrink each category's members (smallest first) and group --------------
const PRED = {
  'adf-rt-lossy-while-permitted': 'rtAdfLossyWhenPermitted',
  'gate-refuses-exact-round-trip': 'gateRefusesExact',
  'adf-normal-form-not-idempotent': 'adfNotIdempotent',
  'md-rt-not-exact': 'mdNotExact',
  'md-normal-form-not-idempotent': 'mdNotIdempotent',
  'gate-flags-writer-output': 'gateFlagsWriterOutput',
}
const jobs = []
for (const [cat, list] of Object.entries(cats)) {
  // the cap applies per corpus source, so every source gets minimal examples
  const bySource = {}
  for (const it of list) (bySource[it.source] ??= []).push(it)
  const sorted = Object.values(bySource).flatMap(l => [...l].sort((a, b) => a.size - b.size).slice(0, shrinkLimit))
  for (const it of sorted) jobs.push({ cat, it, msg: { type: 'shrink', kind: PRED[cat], side: 'A', domain: it.domain, input: it.input, budget: shrinkBudget } })
}
for (const g of throwGroups.values()) {
  for (const it of [...g.items].sort((a, b) => a.size - b.size).slice(0, 5)) {
    jobs.push({ cat: 'throws', group: g, it, msg: { type: 'shrink', kind: 'throws', side: 'A', fn: g.fn, errorName: it.res[g.fn].threw.name, errorMessage: it.res[g.fn].threw.message, domain: it.domain, input: it.input, budget: shrinkBudget } })
  }
}
log(`[observe] shrinking ${jobs.length} examples`)
const shrunk = await pool.map(jobs.map(j => j.msg))

const groups = new Map()
jobs.forEach((j, i) => {
  const s = shrunk[i]
  const minimal = s && !s.timeout && 'value' in s ? s.value : j.it.input
  const sig = j.cat === 'throws' ? `${j.group.fn} | ${j.group.error} | ${signatureFor(j.it.domain, minimal)}` : signatureFor(j.it.domain, minimal)
  const key = `${j.it.private ? 'private' : 'public'}::${j.cat}::${sig}`
  const g = groups.get(key) || { category: j.cat, signature: sig, private: j.it.private, count: 0, sources: {}, ids: [], best: null }
  g.count += 1
  g.sources[j.it.source] = (g.sources[j.it.source] || 0) + 1
  if (g.ids.length < 10) g.ids.push(j.it.id)
  const size = sizeOf(minimal)
  if (!g.best || size < g.best.size) g.best = { id: j.it.id, domain: j.it.domain, originalSize: j.it.size, size, minimal, features: features(j.it.domain, minimal) }
  groups.set(key, g)
})

// Outputs of each group's minimal example, for the report.
const groupList = [...groups.values()]
const exampleMsgs = []
for (const g of groupList) for (const fn of FNS_BY_DOMAIN[g.best.domain]) exampleMsgs.push({ g, fn, msg: { type: 'eval', side: 'A', fn, input: g.best.minimal } })
const exampleRes = await pool.map(exampleMsgs.map(e => e.msg))
exampleMsgs.forEach((e, i) => { (e.g.best.outputs ??= {})[e.fn] = encode(describeResult(exampleRes[i])) })
await pool.close()
for (const g of groupList) g.best.minimal = encode(g.best.minimal)

const catSummary = {}
for (const [cat, list] of Object.entries(cats)) {
  catSummary[cat] = {
    inputs: list.length,
    private: list.filter(i => i.private).length,
    shrunk: Object.values(list.reduce((acc, i) => { acc[i.source] = (acc[i.source] || 0) + 1; return acc }, {})).reduce((sum, n) => sum + Math.min(n, shrinkLimit), 0),
    groups: groupList.filter(g => g.category === cat && !g.private).length,
  }
}
const sortGroups = gs => gs.sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count)
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const meta = {
  impl: { path: impl, sha256: sha(impl) },
  node: process.version,
  corpus: sources,
  definitions: {
    'adfRoundTrip': 'markdownToAdf(adfToMarkdown(x)).content vs x.content (wrapper type/version ignored; JSON-normalised; non-object inputs = n/a). equal-mod-exceptions = equal after removing the four exceptions adfHasUnrenderableContent documents (empty unmarked text runs; orderedList attrs {} / {order:1}; localId attrs; non-leading top-level empty paragraphs) from x.',
    'mdRoundTripExact': 'adfToMarkdown(markdownToAdf(md)) === md (string inputs only)',
    'mdIdempotent': 'rt(rt(md)) === rt(md) with rt = adfToMarkdown∘markdownToAdf',
    'adfIdempotent': 'rt(rt(x)) deep-equals rt(x) with rt = markdownToAdf∘adfToMarkdown',
    'gateOnWriterOutput': 'adfHasUnrenderableContent(markdownToAdf(md))',
    'groups': `each category's inputs, smallest first (up to ${shrinkLimit} per corpus source), shrunk to a minimal input that keeps the property, grouped by shape signature; throws: up to 5 per error message`,
  },
  shrink: { limit: shrinkLimit, budget: shrinkBudget },
  timeouts: pool.timeouts,
  ms: Date.now() - started,
}
const report = {
  meta,
  counts: counters,
  categories: catSummary,
  throwGroups: [...throwGroups.values()].map(g => ({ fn: g.fn, error: g.error, inputs: g.items.length, private: g.items.filter(i => i.private).length, sources: g.items.reduce((acc, i) => { acc[i.source] = (acc[i.source] || 0) + 1; return acc }, {}) })),
  groups: sortGroups(groupList.filter(g => !g.private)),
  privateGroups: privatePath ? { count: groupList.filter(g => g.private).length, byCategory: groupList.filter(g => g.private).reduce((acc, g) => { acc[g.category] = (acc[g.category] || 0) + 1; return acc }, {}), note: 'signatures and examples withheld; see --private-out' } : undefined,
}
if (opts.out) { mkdirSync(dirname(resolve(opts.out)), { recursive: true }); writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`) }
if (privatePath && opts['private-out']) {
  mkdirSync(dirname(resolve(opts['private-out'])), { recursive: true })
  writeFileSync(opts['private-out'], `${JSON.stringify({ meta, groups: sortGroups(groupList.filter(g => g.private)) }, null, 2)}\n`)
}
console.log(JSON.stringify({ counts: counters, categories: catSummary, throwGroups: report.throwGroups }, null, 1))
log(`[observe] done in ${(meta.ms / 1000).toFixed(1)}s`)
