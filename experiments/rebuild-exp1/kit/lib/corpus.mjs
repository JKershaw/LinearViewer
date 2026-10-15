// Load the replay corpus. The public part lives in kit/corpus/*.json (built
// by build-corpus.mjs); the private real-Markdown set is read IN PLACE and
// only when asked for, and every item from it is flagged `private: true` so
// reports keep its content (and anything derived from it) out of kit-level
// outputs.
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { decode, sizeOf } from './serial.mjs'

const KIT = resolve(dirname(new URL(import.meta.url).pathname), '..')
export const DEFAULT_CORPUS_DIR = join(KIT, 'corpus')
export const DEFAULT_PRIVATE_PATH = resolve(KIT, '..', 'private-corpus', 'real-markdown.json')
export const PUBLIC_FILES = ['tests-adf.json', 'tests-md.json', 'gen-adf.json', 'gen-md.json']

export function loadCorpus({ dir = DEFAULT_CORPUS_DIR, privatePath = null, only = null } = {}) {
  const items = []
  const sources = {}
  for (const file of PUBLIC_FILES) {
    const path = join(dir, file)
    if (!existsSync(path)) throw new Error(`corpus file missing: ${path} (run build-corpus.mjs)`)
    const text = readFileSync(path, 'utf8')
    const body = JSON.parse(text)
    if (only && !only.includes(body.name)) continue
    sources[body.name] = { domain: body.domain, items: body.items.length, sha256: createHash('sha256').update(text).digest('hex'), private: false }
    for (const it of body.items) {
      const input = decode(it.input)
      items.push({ id: it.id, source: body.name, domain: body.domain, tag: it.tag, input, size: sizeOf(input), private: false })
    }
  }
  if (privatePath) {
    const text = readFileSync(privatePath, 'utf8')
    const rows = JSON.parse(text)
    sources['real-md'] = { domain: 'md', items: rows.length, sha256: createHash('sha256').update(text).digest('hex'), private: true }
    rows.forEach((row, i) => {
      const tag = /:description$/.test(String(row.source)) ? 'description' : /:comment\d*$/.test(String(row.source)) ? 'comment' : 'other'
      items.push({ id: `real-md#${i}`, source: 'real-md', domain: 'md', tag, input: row.markdown, size: sizeOf(row.markdown), private: true })
    })
  }
  return { items, sources }
}
