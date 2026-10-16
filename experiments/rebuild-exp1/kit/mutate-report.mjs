#!/usr/bin/env node
// mutate-report.mjs <mutants.json> [--vs <mutants2.json>] [--out summary.md]
//
// Markdown summary of a mutate.mjs run: totals, per operator, survivors
// grouped by function/region. With --vs (a second run of the SAME candidate
// with a wider test set), also: kill counts side by side, which survivors of
// the first run the second kills (and by which tests), and any mutant whose
// status got worse (a flakiness / consistency signal).
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--vs' && argv[argv.indexOf(a) - 1] !== '--out')
const vsIdx = argv.indexOf('--vs')
const outIdx = argv.indexOf('--out')
if (!file) { console.error('usage: node mutate-report.mjs <mutants.json> [--vs <mutants2.json>] [--out summary.md]'); process.exit(2) }
const A = JSON.parse(readFileSync(file, 'utf8'))
const B = vsIdx === -1 ? null : JSON.parse(readFileSync(argv[vsIdx + 1], 'utf8'))
const out = []
const p = s => out.push(s)
const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, '⏎')
const clip = (s, n = 70) => { const t = esc(s); return t.length > n ? `${t.slice(0, n)}…` : t }
const testsLabel = r => r.meta.testFiles.map(f => basename(f)).join(' + ')

function totalsRow(r) {
  const t = r.totals
  return `| ${testsLabel(r)} | ${t.mutants} | ${t.killed} | ${t.survived} | ${t.timeout} | ${t.invalid.total} (syntax ${t.invalid.syntax}, import ${t.invalid.import}) | ${(t.killRate * 100).toFixed(1)}% | ${(t.score * 100).toFixed(1)}% |`
}

p(`# Mutation sweep — ${basename(A.meta.impl)}`)
p('')
p(`- impl: \`${A.meta.impl}\` (sha256 \`${A.meta.implSha256.slice(0, 16)}…\`)`)
p(`- operator set: \`${A.meta.operatorSet}\`; node ${A.meta.node}; ${A.meta.jobs} parallel jobs; per-mutant timeout ${A.meta.timeoutMs} ms`)
for (const r of [A, B].filter(Boolean)) {
  p(`- [${testsLabel(r)}] one unmutated test run: ${r.meta.baselineRunMs.median} ms median (${r.meta.baselineRunMs.runs.join('/')} ms; ${r.meta.baselineRunMs.tests?.pass} tests); full sweep ${(r.meta.sweepMs / 1000).toFixed(1)} s wall`)
}
if (A.meta.filtered) p(`- FILTERED RUN: ${JSON.stringify(A.meta.filtered)}`)
p('')
p('kill rate = killed / (killed + survived + timeout); score = (killed + timeout) / (same). Invalid mutants are excluded from both.')
p('')
p('| tests | mutants | killed | survived | timeout | invalid | kill rate | score |')
p('|---|---|---|---|---|---|---|---|')
p(totalsRow(A))
if (B) p(totalsRow(B))
p('')
p('## By operator')
p('')
p(`| operator | mutants | survived${B ? ' (1)' : ''} |${B ? ' survived (2) |' : ''}`)
p(`|---|---|---|${B ? '---|' : ''}`)
for (const [op, v] of Object.entries(A.byOperator).sort((a, b) => b[1].survived - a[1].survived)) {
  p(`| ${op} | ${v.total} | ${v.survived} |${B ? ` ${B.byOperator[op]?.survived ?? 0} |` : ''}`)
}
p('')
p(`## Survivors by function / region${B ? ' (run 1)' : ''}`)
p('')
const killedByB = new Map(B ? B.mutants.filter(m => m.status !== 'survived').map(m => [m.id, m]) : [])
const byOwner = new Map()
for (const s of A.survivors) { if (!byOwner.has(s.owner)) byOwner.set(s.owner, []); byOwner.get(s.owner).push(s) }
p(`| function / region | mutants | survived${B ? ' (1)' : ''} |${B ? ' survived (2) |' : ''}`)
p(`|---|---|---|${B ? '---|' : ''}`)
for (const [owner, v] of Object.entries(A.byOwner).sort((a, b) => b[1].survived - a[1].survived || b[1].total - a[1].total)) {
  if (!v.survived && !B) continue
  p(`| ${owner} | ${v.total} | ${v.survived} |${B ? ` ${B.byOwner[owner]?.survived ?? 0} |` : ''}`)
}
p('')
for (const [owner, list] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
  p(`### ${owner} — ${list.length} survivor${list.length === 1 ? '' : 's'}`)
  p('')
  p(`| id | line | operator | original → mutated | source line |${B ? ' run 2 |' : ''}`)
  p(`|---|---|---|---|---|${B ? '---|' : ''}`)
  for (const s of list) {
    const b = killedByB.get(s.id)
    p(`| ${s.id} | ${s.line} | ${s.operator}${s.note ? ` ${s.note}` : ''} | \`${clip(s.original, 40)}\` → \`${clip(s.replacement, 40)}\` | \`${clip(s.lineBefore.trim(), 80)}\` |${B ? ` ${b ? b.status : 'survived'} |` : ''}`)
  }
  p('')
}
if (B) {
  const newlyKilled = A.survivors.filter(s => killedByB.has(s.id))
  p(`## Survivors of run 1 that run 2 kills: ${newlyKilled.length} of ${A.survivors.length}`)
  p('')
  if (newlyKilled.length) {
    p('| id | function | line | operator | original → mutated | status (2) | killing tests (2) |')
    p('|---|---|---|---|---|---|---|')
    for (const s of newlyKilled) {
      const b = killedByB.get(s.id)
      p(`| ${s.id} | ${s.owner} | ${s.line} | ${s.operator} | \`${clip(s.original, 30)}\` → \`${clip(s.replacement, 30)}\` | ${b.status} | ${b.killedBy ? `${b.killedBy.count}: ${clip(b.killedBy.tests.slice(0, 2).join('; '), 140)}` : ''} |`)
    }
    p('')
  }
  const bKilled = B.mutants.filter(m => m.status === 'killed' && m.killedBy?.byFile)
  if (bKilled.length) {
    const aFiles = new Set(A.meta.testFiles.map(f => basename(f)))
    const perFile = {}
    for (const m of bKilled) for (const f of Object.keys(m.killedBy.byFile)) perFile[f] = (perFile[f] || 0) + 1
    const onlyNew = bKilled.filter(m => Object.keys(m.killedBy.byFile).every(f => !aFiles.has(f)))
    p(`Run 2 killed mutants with ≥1 failing test, per file: ${Object.entries(perFile).map(([f, n]) => `${f} ${n}`).join('; ')}. Killed ONLY by files not in run 1: ${onlyNew.length}.`)
    p('')
  }
  const aStatus = new Map(A.mutants.map(m => [m.id, m.status]))
  const worse = B.mutants.filter(m => m.status === 'survived' && aStatus.get(m.id) !== 'survived')
  const sameIds = A.meta.implSha256 === B.meta.implSha256
  p(`Consistency: ${sameIds ? 'same candidate (mutant ids comparable)' : 'DIFFERENT candidates — ids not comparable'}; mutants killed in run 1 but surviving run 2: ${worse.length}${worse.length ? ` (${worse.map(m => m.id).join(', ')})` : ''}.`)
  p('')
}
const md = `${out.join('\n')}\n`
if (outIdx !== -1) writeFileSync(argv[outIdx + 1], md)
else process.stdout.write(md)
