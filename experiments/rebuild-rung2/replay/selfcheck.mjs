#!/usr/bin/env node
// Self-checks for replay.mjs against the pinned main renderer (c2bc9a65).
//   node selfcheck.mjs [--n 3000] [--seed 1]
// Writes mutants + reports under work/selfcheck/, prints a pass/fail table.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, 'work', 'selfcheck');
fs.mkdirSync(DIR, { recursive: true });
const argv = process.argv.slice(2);
const n = argv.includes('--n') ? argv[argv.indexOf('--n') + 1] : '3000';
const seed = argv.includes('--seed') ? argv[argv.indexOf('--seed') + 1] : '1';

const base = execFileSync('git', ['-C', '/home/user/LinearViewer', 'show', 'c2bc9a65:lib/render-roadmap.js'], { encoding: 'utf8' });
const basePath = path.join(DIR, 'render-roadmap.c2bc9a65.js');
fs.writeFileSync(basePath, base);

function mutant(name, from, to) {
  const count = base.split(from).length - 1;
  if (count !== 1) throw new Error(`mutant ${name}: pattern occurs ${count} times`);
  const p = path.join(DIR, `mutant-${name}.js`);
  fs.writeFileSync(p, base.replace(from, to));
  return p;
}

const checks = [
  { name: 'identity (old vs old)', file: basePath, expect: 'none', coverage: true },
  { name: 'class rename ship-bucket-heading', file: mutant('class', 'class="ship-bucket-heading"', 'class="ship-bucket-title"'), expect: 'detect' },
  { name: 'escapeHtml removed on ship-item title', file: mutant('escape', "const title = escapeHtml(item.title || '');", "const title = (item.title || '');"), expect: 'detect-generated' },
  { name: 'JSON payload value change (trend default)', file: mutant('json', "trend: velocity.trend || 'stable'", "trend: velocity.trend || 'flat'"), expect: 'detect' },
  { name: 'JSON key reorder only (must be ignored)', file: mutant('keyorder', '    risks,\n    urlKey: urlKey || \'\',\n    hasAI\n', '    hasAI,\n    urlKey: urlKey || \'\',\n    risks\n'), expect: 'none' },
  { name: 'indentation-only change (must be ignored)', file: mutant('indent', '<div class="roadmap-chat-body">', '\n\n      <div class="roadmap-chat-body">'), expect: 'none' },
  { name: 'space removed between tags (must count)', file: mutant('space', '</summary>\n      <div class="roadmap-chat-body">', '</summary><div class="roadmap-chat-body">'), expect: 'detect' }
];

const rows = [];
for (const c of checks) {
  const out = path.join(DIR, `report-${c.file === basePath ? 'identity' : path.basename(c.file, '.js')}.json`);
  const args = [path.join(HERE, 'replay.mjs'), basePath, c.file, '--n', n, '--seed', seed, '--out', out, '--quiet'];
  if (c.coverage) args.push('--coverage');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status === 2 || !fs.existsSync(out)) { console.error(r.stderr); throw new Error(`replay failed for ${c.name}`); }
  const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
  const byTier = Object.fromEntries(Object.entries(rep.totals.byTier).filter(([, v]) => v.differing).map(([k, v]) => [k, v.differing]));
  const generated = (byTier['gen-a'] || 0) + (byTier['gen-b'] || 0);
  const ok = c.expect === 'none' ? rep.totals.differing === 0
    : c.expect === 'detect' ? rep.totals.differing > 0
    : generated > 0;
  rows.push({ check: c.name, ok, differing: rep.totals.differing, of: rep.totals.inputs, byTier, groups: rep.groups.length, topSignature: rep.groups[0]?.signature ?? null, report: out });
  if (c.coverage) rows[rows.length - 1].coverage = rep.coverage?.old && {
    lines: `${rep.coverage.old.all.linesCovered}/${rep.coverage.old.all.linesTotal} (${rep.coverage.old.all.pct}%)`,
    blocks: `${rep.coverage.old.all.blocksHit}/${rep.coverage.old.all.blocksTotal}`,
    uncoveredLines: rep.coverage.old.all.uncoveredLines.map(u => u.line),
    unhitBlocks: rep.coverage.old.all.unhitBlocks.map(b => `L${b.line}: ${b.code}`),
    existingTestsOnly: `${rep.coverage.old.existingTestsAndMockOnly.pct}% lines, ${rep.coverage.old.existingTestsAndMockOnly.blocksHit} blocks; uncovered lines ${rep.coverage.old.existingTestsAndMockOnly.uncoveredLines.join(',')}`
  };
}
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check}: ${r.differing}/${r.of} differing ${JSON.stringify(r.byTier)} groups=${r.groups}${r.topSignature ? `\n        top: ${r.topSignature}` : ''}`);
  if (r.coverage) console.log(`        coverage: lines ${r.coverage.lines}, blocks ${r.coverage.blocks}, unhit ${JSON.stringify(r.coverage.unhitBlocks)}\n        existing tests only: ${r.coverage.existingTestsOnly}`);
}
fs.writeFileSync(path.join(DIR, 'selfcheck.json'), JSON.stringify(rows, null, 2));
process.exitCode = rows.every(r => r.ok) ? 0 : 1;
