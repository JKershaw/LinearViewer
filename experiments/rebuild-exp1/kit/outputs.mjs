#!/usr/bin/env node
// outputs.mjs <impl> --out outputs.jsonl.gz [--private [file] --private-out file.jsonl.gz] [--corpus dir]
//
// Records one implementation's outputs for every corpus input and function
// (the same cells diff.mjs compares), one JSON line per input:
//   {"id", "source", "results": {fn: {ok}|{threw}|{timeout}}}  (values serial-encoded)
// Private inputs go only to --private-out (refused under kit/).
import { createWriteStream, mkdirSync } from 'node:fs'
import { createGzip } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { once } from 'node:events'
import { EvalPool } from './lib/pool.mjs'
import { loadCorpus, DEFAULT_CORPUS_DIR } from './lib/corpus.mjs'
import { FNS_BY_DOMAIN } from './lib/fns.mjs'
import { encode } from './lib/serial.mjs'
import { parseCli, privatePathFrom, assertNotInKit } from './lib/cli.mjs'

const opts = parseCli(process.argv.slice(2), ['private'])
const impl = opts.positional[0] && resolve(opts.positional[0])
if (!impl || !opts.out) {
  console.error('usage: node outputs.mjs <impl> --out file.jsonl.gz [--private [file] --private-out file.jsonl.gz]')
  process.exit(2)
}
const privatePath = privatePathFrom(opts)
if (privatePath) {
  if (!opts['private-out']) { console.error('--private needs --private-out'); process.exit(2) }
  assertNotInKit(opts['private-out'], '--private-out')
}
const { items } = loadCorpus({ dir: opts.corpus ? resolve(opts.corpus) : DEFAULT_CORPUS_DIR, privatePath })
const pool = await new EvalPool({ impls: { A: impl }, size: opts.jobs ? Number(opts.jobs) : undefined }).start()
const cells = []
for (const item of items) for (const fn of FNS_BY_DOMAIN[item.domain]) cells.push({ item, fn })
const results = await pool.map(cells.map(c => ({ type: 'eval', side: 'A', fn: c.fn, input: c.item.input })))
await pool.close()

function sink(path) {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  const gz = createGzip()
  const file = createWriteStream(path)
  gz.pipe(file)
  return { gz, file }
}
const pub = sink(opts.out)
const priv = privatePath ? sink(opts['private-out']) : null
const byItem = new Map()
cells.forEach((c, i) => {
  if (!byItem.has(c.item)) byItem.set(c.item, {})
  byItem.get(c.item)[c.fn] = encode(results[i])
})
let n = 0
for (const [item, res] of byItem) {
  const target = item.private ? priv : pub
  target.gz.write(`${JSON.stringify({ id: item.id, source: item.source, results: res })}\n`)
  n += 1
}
for (const s of [pub, priv].filter(Boolean)) { s.gz.end(); await once(s.file, 'finish') }
process.stderr.write(`[outputs] ${n} inputs × fns recorded for ${impl} (${pool.timeouts} timeouts)\n`)
