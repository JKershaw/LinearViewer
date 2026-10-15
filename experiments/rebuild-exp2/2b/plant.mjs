// plant.mjs <id> <adf.js at e7f7bd57> <out.js>
// Re-plants one gap-list fault: replaces `original` with `replacement` at line:column, after
// checking the line still reads as recorded. Nothing else changes.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const [id, src, out] = process.argv.slice(2)
if (!id || !src || !out) { console.error('usage: node plant.mjs <id> <adf.js at e7f7bd57> <out.js>'); process.exit(2) }
const { rows } = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'gap-list.json'), 'utf8'))
const row = rows.find(r => r.id === id)
if (!row) { console.error(`no gap-list row ${id}`); process.exit(2) }
const lines = readFileSync(src, 'utf8').split('\n')
const line = lines[row.line - 1]
if (line !== row.lineBefore) { console.error(`line ${row.line} does not read as recorded (is this e7f7bd57's adf.js?)\n  expected: ${row.lineBefore}\n  found:    ${line}`); process.exit(1) }
const at = row.column - 1
if (line.slice(at, at + row.original.length) !== row.original) { console.error(`'${row.original}' not found at column ${row.column}`); process.exit(1) }
lines[row.line - 1] = line.slice(0, at) + row.replacement + line.slice(at + row.original.length)
if (lines[row.line - 1] !== row.lineAfter) { console.error('planted line differs from the recorded mutant'); process.exit(1) }
writeFileSync(out, lines.join('\n'))
console.log(`planted ${id} at ${row.line}:${row.column} (${row.operator}) -> ${out}`)
