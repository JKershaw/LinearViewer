// Builds the clean room's SPEC.md from adf.js: every comment, in order, no code.
// Internal (non-exported) top-level names are replaced so the spec carries decisions, not structure.
import { parse } from '/home/user/LinearViewer/node_modules/acorn/dist/acorn.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
const [src, out] = [readFileSync(process.argv[2], 'utf8'), process.argv[3]]
const comments = []
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments })
const exported = new Set(), internal = new Set()
for (const n of ast.body) {
  const decl = n.type === 'ExportNamedDeclaration' ? n.declaration : n
  const names = decl?.type === 'FunctionDeclaration' ? [decl.id.name]
    : decl?.type === 'VariableDeclaration' ? decl.declarations.map(d => d.id.name).filter(Boolean) : []
  for (const nm of names) (n.type === 'ExportNamedDeclaration' ? exported : internal).add(nm)
}
const redact = t => [...internal].sort((a, b) => b.length - a.length)
  .reduce((s, nm) => s.replace(new RegExp('`?\\b' + nm + '\\b`?', 'g'), '`(internal helper)`'), t)
  .replace(/jira-provider\.test\.js/g, 'the codec test file')
// group comments into blocks of consecutive lines; note which export (if any) follows each block
const lines = src.split('\n'); const blocks = []
for (const c of comments) {
  const last = blocks.at(-1)
  if (last && c.loc.start.line <= last.end + 1) { last.end = c.loc.end.line; last.parts.push(c) }
  else blocks.push({ start: c.loc.start.line, end: c.loc.end.line, parts: [c] })
}
let md = ['# Specification: the Jira ADF ↔ Markdown codec', '',
  'Every comment from the original module, in order, with all code removed. The comments record the behaviour decisions and their reasons.',
  'Names of the original\'s internal helpers are replaced with `(internal helper)`: they are not part of the contract.',
  'Where a block sits directly above one of the three exported functions, its signature is shown.',
  'The test file in `tests/unit/` is the other half of the specification; where the two seem to disagree, the tests win.', '']
for (const b of blocks) {
  const text = b.parts.map(c => c.type === 'Block' ? '/*' + c.value + '*/' : '//' + c.value).join('\n')
  const next = lines.slice(b.end, b.end + 2).join('\n')
  const exp = next.match(/^export function (\w+)\(([^)]*)\)/m)
  md.push(exp ? `### Above \`${exp[1]}(${exp[2]})\`` : '---', '', '```', redact(text), '```', '')
}
writeFileSync(out, md.join('\n'))
console.log(`${blocks.length} comment blocks, ${internal.size} internal names redacted, exports: ${[...exported]}`)
