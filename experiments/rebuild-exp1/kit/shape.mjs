#!/usr/bin/env node
// shape.mjs <implFile> [--out file.json]
// Facts about code shape (no composite score). Definitions: kit/README.md and
// the `definitions` key of the output.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyse, DEFINITIONS } from './lib/shape-core.mjs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const outIdx = args.indexOf('--out')
if (!file) {
  console.error('usage: node shape.mjs <implFile> [--out file.json]')
  process.exit(2)
}
const path = resolve(file)
const report = { file: path, nodeVersion: process.version, ...analyse(readFileSync(path, 'utf8')), definitions: DEFINITIONS }
const json = JSON.stringify(report, null, 2)
if (outIdx !== -1) writeFileSync(args[outIdx + 1], `${json}\n`)
process.stdout.write(`${json}\n`)
