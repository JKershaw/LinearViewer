#!/usr/bin/env node
// build-corpus.mjs [--impl <file>] [--tree <dir>] [--tests <file>]... [--out <dir>]
//                  [--adf-seed N] [--adf-count N] [--md-seed N] [--md-count N]
//
// Writes the PUBLIC corpus (everything except the private real-Markdown set):
//   tests-adf.json  arguments adfToMarkdown / adfHasUnrenderableContent received
//                   while the test file(s) ran (dedup'd; provenance kept)
//   tests-md.json   arguments markdownToAdf received
//   gen-adf.json    seeded generated ADF documents (lib/gen-adf.mjs)
//   gen-md.json     seeded generated Markdown strings (lib/gen-md.mjs)
//   manifest.json   counts, seeds, sha256 per file
// The private real-Markdown corpus is never copied: diff.mjs / observe.mjs
// read it in place when given --private.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareWorkerTrees, writeSlot, runTests } from './lib/tree-runner.mjs'
import { encode, decode, canonical } from './lib/serial.mjs'
import { generateAdfCorpus } from './lib/gen-adf.mjs'
import { generateMdCorpus } from './lib/gen-md.mjs'

const KIT = dirname(new URL(import.meta.url).pathname)
const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf(name); return i === -1 ? dflt : argv[i + 1] }
const multi = name => argv.flatMap((a, i) => (a === name ? argv[i + 1].split(',') : []))

const tree = resolve(opt('--tree', join(KIT, '..', 'tree')))
const slot = opt('--slot', 'lib/providers/jira/adf.js')
const impl = resolve(opt('--impl', join(tree, slot)))
const testFiles = multi('--tests').length ? multi('--tests') : ['tests/unit/jira-provider-adf-codec.test.js', 'tests/unit/jira-provider.test.js']
const outDir = resolve(opt('--out', join(KIT, 'corpus')))
const adfSeed = Number(opt('--adf-seed', 20261015))
const adfCount = Number(opt('--adf-count', 3000))
const mdSeed = Number(opt('--md-seed', 20261016))
const mdCount = Number(opt('--md-count', 3000))
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)
mkdirSync(outDir, { recursive: true })

// ---- (a) record what the tests pass to the three exports -------------------
const work = `${tree}.record-work`
rmSync(work, { recursive: true, force: true })
const [dir] = prepareWorkerTrees(tree, work, 1)
const implCopyName = 'adf.__kit_impl__.js'
const slotDir = dirname(join(dir, slot))
copyFileSync(impl, join(slotDir, implCopyName))
const recorderUrl = pathToFileURL(join(KIT, 'lib', 'recorder.mjs')).href
writeSlot(dir, slot, [
  '// adf-kit recording wrapper (temporary; lives only in the recording tree)',
  `import * as impl from './${implCopyName}'`,
  `import { record } from ${JSON.stringify(recorderUrl)}`,
  'export function adfToMarkdown(...args) { record(\'adfToMarkdown\', args); return impl.adfToMarkdown(...args) }',
  'export function markdownToAdf(...args) { record(\'markdownToAdf\', args); return impl.markdownToAdf(...args) }',
  'export function adfHasUnrenderableContent(...args) { record(\'adfHasUnrenderableContent\', args); return impl.adfHasUnrenderableContent(...args) }',
  '',
].join('\n'))
const recDir = join(work, 'records')
mkdirSync(recDir, { recursive: true })
const run = await runTests(dir, testFiles, { timeoutMs: 120000, env: { ADF_KIT_RECORD_DIR: recDir } })
log(`[corpus] recording run: ${run.status} (${run.summary?.pass ?? '?'} pass, ${run.summary?.fail ?? '?'} fail) in ${Math.round(run.ms)} ms`)
if (run.status !== 'pass') for (const f of run.failing.slice(0, 10)) log(`   failing: ${f}`)

const calls = []
for (const f of readdirSync(recDir)) for (const line of readFileSync(join(recDir, f), 'utf8').split('\n')) if (line) calls.push(JSON.parse(line))
rmSync(work, { recursive: true, force: true })

const DOMAIN = { adfToMarkdown: 'adf', adfHasUnrenderableContent: 'adf', markdownToAdf: 'md' }
const byDomain = { adf: new Map(), md: new Map() }
const callStats = { total: calls.length, byFn: {}, byTest: {}, multiArgCalls: 0, unencodable: 0 }
for (const c of calls) {
  callStats.byFn[c.fn] = (callStats.byFn[c.fn] || 0) + 1
  callStats.byTest[c.test] = (callStats.byTest[c.test] || 0) + 1
  if (c.unencodable) { callStats.unencodable += 1; continue }
  if (c.argc !== 1) callStats.multiArgCalls += 1
  const value = c.argc === 0 ? undefined : decode(c.args[0])
  const key = canonical(value)
  const map = byDomain[DOMAIN[c.fn]]
  const entry = map.get(key) || { input: c.args[0] ?? encode(undefined), fns: new Set(), from: new Set(), calls: 0 }
  entry.fns.add(c.fn)
  entry.from.add(c.test)
  entry.calls += 1
  map.set(key, entry)
}
const testItems = domain => [...byDomain[domain].values()].map((e, i) => ({ id: `tests-${domain}#${i}`, tag: [...e.from].sort().join('+'), fns: [...e.fns].sort(), calls: e.calls, input: e.input }))

// ---- (c) + (d) generated ----------------------------------------------------
const genAdf = generateAdfCorpus({ seed: adfSeed, count: adfCount }).map(it => ({ ...it, input: encode(it.input) }))
const genMd = generateMdCorpus({ seed: mdSeed, count: mdCount }).map(it => ({ ...it, input: encode(it.input) }))

const files = {
  'tests-adf.json': { name: 'tests-adf', domain: 'adf', description: 'arguments adfToMarkdown / adfHasUnrenderableContent received while the test files ran', testFiles, items: testItems('adf') },
  'tests-md.json': { name: 'tests-md', domain: 'md', description: 'arguments markdownToAdf received while the test files ran', testFiles, items: testItems('md') },
  'gen-adf.json': { name: 'gen-adf', domain: 'adf', description: 'seeded generated ADF (lib/gen-adf.mjs); tag = profile/size', seed: adfSeed, items: genAdf },
  'gen-md.json': { name: 'gen-md', domain: 'md', description: 'seeded generated Markdown (lib/gen-md.mjs); tag = size', seed: mdSeed, items: genMd },
}
const manifest = { builtAt: new Date().toISOString(), node: process.version, recordedAgainst: { impl, sha256: createHash('sha256').update(readFileSync(impl)).digest('hex'), testFiles, run: { status: run.status, summary: run.summary } }, callStats, files: {} }
for (const [name, body] of Object.entries(files)) {
  const text = `${JSON.stringify(body)}\n`
  writeFileSync(join(outDir, name), text)
  const tags = {}
  for (const it of body.items) tags[it.tag] = (tags[it.tag] || 0) + 1
  manifest.files[name] = { domain: body.domain, items: body.items.length, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), tags }
}
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
log(`[corpus] wrote ${Object.entries(manifest.files).map(([n, f]) => `${n}=${f.items}`).join(' ')} to ${outDir}`)
void basename
