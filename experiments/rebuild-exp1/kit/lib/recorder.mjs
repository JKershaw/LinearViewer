// Imported by the temporary wrapper build-corpus.mjs puts in the tree's slot.
// Appends every argument list the three exports receive to a per-process
// JSONL file, encoded at call time (before the callee or the test can mutate it).
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { encode } from './serial.mjs'

const dir = process.env.ADF_KIT_RECORD_DIR
const file = dir ? join(dir, `rec-${process.pid}.jsonl`) : null
const testFile = (process.argv.find(a => a.endsWith('.test.js') || a.endsWith('.test.mjs')) || '').split('/').pop()

export function record(fn, args) {
  if (!file) return
  let line
  try { line = JSON.stringify({ fn, test: testFile, argc: args.length, args: args.map(encode) }) } catch (err) { line = JSON.stringify({ fn, test: testFile, unencodable: String(err) }) }
  appendFileSync(file, `${line}\n`)
}
