#!/usr/bin/env node
// survivor-probe.mjs <mutants.json> [--private [file]] [--out probe.json] [--private-out file]
//                    [--work dir] [--batch N] [--jobs N]
//
// For every SURVIVING mutant of a mutate.mjs run, replays the corpus through
// the original and the mutant (same six functions and comparison as diff.mjs)
// and reports whether ANY corpus input tells them apart.
//   distinguished   — some input changes an output: the tests miss a real
//                     behaviour change (a test gap the corpus can witness);
//   undistinguished — no corpus input changes any output: probably an
//                     equivalent mutant (or a behaviour the corpus never reaches).
// The mutants are regenerated from the implementation recorded in
// mutants.json (its sha256 must match) and written to a scratch directory.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import os from 'node:os'
import { generateMutants } from './lib/mutants.mjs'
import { loadCorpus, DEFAULT_CORPUS_DIR } from './lib/corpus.mjs'
import { signatureFor } from './lib/signature.mjs'
import { encode } from './lib/serial.mjs'
import { parseCli, privatePathFrom, assertNotInKit } from './lib/cli.mjs'

const opts = parseCli(process.argv.slice(2), ['private'])
const mutantsFile = opts.positional[0]
if (!mutantsFile) { console.error('usage: node survivor-probe.mjs <mutants.json> [--private] [--out probe.json]'); process.exit(2) }
const run = JSON.parse(readFileSync(mutantsFile, 'utf8'))
const source = readFileSync(run.meta.impl, 'utf8')
if (createHash('sha256').update(source).digest('hex') !== run.meta.implSha256) throw new Error(`${run.meta.impl} changed since the mutation run`)
const privatePath = privatePathFrom(opts)
if (privatePath && opts['private-out']) assertNotInKit(opts['private-out'], '--private-out')
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)
const started = Date.now()

const survivorIds = new Set(run.survivors.map(s => s.id))
const { mutants } = generateMutants(source)
const work = resolve(opts.work || join(dirname(resolve(mutantsFile)), '.survivor-probe-tmp'))
mkdirSync(work, { recursive: true })
const files = mutants.filter(m => survivorIds.has(m.id)).map(m => {
  const path = join(work, `${m.id}.mjs`)
  writeFileSync(path, m.source)
  return { id: m.id, path }
})
if (files.length !== survivorIds.size) throw new Error('could not regenerate every survivor (operator set changed?)')

const { items, sources } = loadCorpus({ dir: opts.corpus ? resolve(opts.corpus) : DEFAULT_CORPUS_DIR, privatePath })
const batchSize = Number(opts.batch ?? 100)
const batches = []
for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize).map((it, k) => ({ index: i + k, domain: it.domain, input: it.input })))
log(`[probe] ${files.length} survivors × ${items.length} inputs in ${batches.length} batches`)

const hits = []
const failures = [] // [mutantId, batchIndex, 'timeout' | 'crash'] — the mutant hung or blew its heap where the original did not
let timeouts = 0
// One worker per mutant (original + that mutant only), memory-capped, with a
// per-batch watchdog: a mutant that loops or allocates without bound loses
// only its own batch, and that loss is itself recorded as distinguishing.
let nextMutant = 0
let mutantsDone = 0
const stoppedEarly = new Set()
async function lane() {
  for (;;) {
    const mi = nextMutant++
    if (mi >= files.length) return
    const file = files[mi]
    let worker = null
    const start = () => new Promise((res, rej) => {
      worker = new Worker(new URL('./lib/probe-worker.mjs', import.meta.url), { workerData: { original: run.meta.impl, mutants: [file] }, resourceLimits: { maxOldGenerationSizeMb: 768 } })
      worker.once('message', m => (m.type === 'ready' ? res(m) : rej(new Error('bad start'))))
      worker.once('error', rej)
    })
    await start()
    for (let b = 0; b < batches.length; b += 1) {
      const result = await new Promise(res => {
        const timer = setTimeout(() => res({ failed: 'timeout' }), Number(opts['batch-timeout'] ?? 5000))
        const onMsg = m => { clearTimeout(timer); worker.off('error', onErr); res(m) }
        const onErr = () => { clearTimeout(timer); worker.off('message', onMsg); res({ failed: 'crash' }) }
        worker.once('message', onMsg)
        worker.once('error', onErr)
        worker.postMessage({ id: b, batch: batches[b] })
      })
      if (result.failed) {
        timeouts += 1
        failures.push([file.id, b, result.failed])
        await worker.terminate().catch(() => {})
        // already distinguished; stop paying a watchdog per batch for it
        if (failures.filter(f => f[0] === file.id).length >= 3) { stoppedEarly.add(file.id); break }
        await start()
        continue
      }
      hits.push(...result.hits)
    }
    await worker.terminate().catch(() => {})
    log(`[probe] ${++mutantsDone}/${files.length} ${file.id} (${Math.round((Date.now() - started) / 1000)}s)`)
  }
}
await Promise.all(Array.from({ length: Number(opts.jobs ?? os.availableParallelism()) }, lane))
rmSync(work, { recursive: true, force: true })

const per = new Map(run.survivors.map(s => [s.id, { ...s, cells: 0, privateCells: 0, inputs: new Set(), byFn: {}, bySource: {}, smallest: null, failedBatches: [] }]))
for (const [id, b, kind] of failures) per.get(id).failedBatches.push({ batch: b, kind, inputs: `${batches[b][0].index}..${batches[b][batches[b].length - 1].index}`, private: batches[b].some(x => items[x.index].private) })
for (const [id, index, fn, cls] of hits) {
  const p = per.get(id)
  const it = items[index]
  if (it.private) { p.privateCells += 1; continue }
  p.cells += 1
  p.inputs.add(index)
  p.byFn[fn] = (p.byFn[fn] || 0) + 1
  p.bySource[it.source] = (p.bySource[it.source] || 0) + 1
  if (!p.smallest || it.size < items[p.smallest.index].size) p.smallest = { index, fn, cls }
}
const rows = [...per.values()].map(p => ({
  id: p.id, owner: p.owner, line: p.line, operator: p.operator, original: p.original, replacement: p.replacement,
  distinguished: p.cells > 0 || p.privateCells > 0 || p.failedBatches.length > 0,
  failedBatches: p.failedBatches.length ? p.failedBatches : undefined,
  stoppedEarly: stoppedEarly.has(p.id) || undefined,
  publicCells: p.cells, publicInputs: p.inputs.size, privateCells: privatePath ? p.privateCells : undefined,
  byFn: p.byFn, bySource: p.bySource,
  smallestPublicExample: p.smallest ? { id: items[p.smallest.index].id, fn: p.smallest.fn, cls: p.smallest.cls, signature: signatureFor(items[p.smallest.index].domain, items[p.smallest.index].input), size: items[p.smallest.index].size, input: items[p.smallest.index].size < 2000 ? encode(items[p.smallest.index].input) : '(large; see id)' } : null,
}))
const report = {
  meta: { mutants: resolve(mutantsFile), impl: run.meta.impl, implSha256: run.meta.implSha256, testFiles: run.meta.testFiles, corpus: sources, batchTimeouts: timeouts, ms: Date.now() - started, node: process.version },
  totals: {
    survivors: rows.length,
    distinguished: rows.filter(r => r.distinguished).length,
    distinguishedByPublicCorpus: rows.filter(r => r.publicCells > 0).length,
    hangOrCrashOnSomeBatch: rows.filter(r => r.failedBatches).length,
    distinguishedOnlyByPrivateCorpus: rows.filter(r => r.publicCells === 0 && !r.failedBatches?.some(f => !f.private) && r.distinguished).length,
    undistinguished: rows.filter(r => !r.distinguished).length,
  },
  survivors: rows,
}
if (opts.out) writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report.totals))
log(`[probe] done in ${((Date.now() - started) / 1000).toFixed(1)}s (${timeouts} batch timeouts)`)
