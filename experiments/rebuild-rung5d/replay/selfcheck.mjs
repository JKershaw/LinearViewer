#!/usr/bin/env node
// Self-checks for replay.mjs against the pinned origin/main copy (f4749b91).
//   node selfcheck.mjs [--n 3000] [--mutant-n 1500]
// 1. old vs old = 0 differences (and 0 info) on seeds 1 and 2, with coverage
//    (line coverage of the pinned file must be ≥ 95%).
// 2. planted mutants: each must be caught in its expected kind; two
//    "must be ignored" mutants (key order only, aliasing only) must produce 0
//    behaviour differences but show up in the info groups.
// Writes mutants and reports under work/selfcheck/; exit 0 iff all pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, 'work', 'selfcheck');
fs.mkdirSync(DIR, { recursive: true });
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const n = arg('n', '3000');
const mn = arg('mutant-n', '1500');
const PIN = path.join(HERE, 'pinned', 'origin-main', 'pipeline-loops.js');
const base = fs.readFileSync(PIN, 'utf8');

function mutant(name, pairs) {
  let src = base;
  for (const [from, to] of pairs) {
    const count = src.split(from).length - 1;
    if (count !== 1) throw new Error(`mutant ${name}: pattern occurs ${count} times: ${from}`);
    src = src.replace(from, to);
  }
  const d = path.join(DIR, `mutant-${name}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'pipeline-loops.js'), src);
  return d;
}

const checks = [
  { name: 'identity seed 1 (old vs old)', dir: path.dirname(PIN), seed: '1', n, expect: 'none', coverage: true },
  { name: 'identity seed 2 (old vs old)', dir: path.dirname(PIN), seed: '2', n, expect: 'none', coverage: true },
  { name: 'M1 agentState blocked→running', dir: mutant('agentstate', [["if (agentStatus === 'blocked') return 'waiting';", "if (agentStatus === 'blocked') return 'running';"]]), expect: 'detect', kind: 'return' },
  { name: 'M2 window upper bound inclusive→exclusive', dir: mutant('window', [['if (ft > upper.getTime()) continue;', 'if (ft >= upper.getTime()) continue;']]), expect: 'detect', kind: 'return' },
  { name: 'M3 warn-once removed (warn every time)', dir: mutant('warnonce', [['if (_warnedMalformedCauses.has(cause)) return;', '']]), expect: 'detect', kind: 'console' },
  { name: 'M4 _assembleSession sorts the caller\'s array in place', dir: mutant('mutate', [['const ordered = [...loops].sort((a, b) => {', 'const ordered = loops.sort((a, b) => {']]), expect: 'detect', kind: 'input-mutation' },
  { name: 'M5 lean projection keeps feedback', dir: mutant('projection', [['historyOpts.projection = { prompt: 0, feedback: 0 };', 'historyOpts.projection = { prompt: 0 };']]), expect: 'detect', kind: 'storeCalls' },
  { name: 'M6 lean promptText present-as-undefined', dir: mutant('undefkey', [['...(lean ? {} : { promptText: item.prompt || null }),', 'promptText: lean ? undefined : (item.prompt || null),']]), expect: 'detect', kind: 'return' },
  { name: 'M7 live cutoff off-by-one (< → <=)', dir: mutant('cutoff', [["    if (!unbounded && dispatchedAt.getTime() < cutoff.getTime()) continue;\n    rawLoops.push({\n      _source: 'live',", "    if (!unbounded && dispatchedAt.getTime() <= cutoff.getTime()) continue;\n    rawLoops.push({\n      _source: 'live',"]]), expect: 'detect', kind: 'return' },
  { name: 'M8 self-heal write-back drops the version guard', dir: mutant('guard', [['{ _id: raw._id, feedbackVersion: raw.feedbackVersion ?? null },', '{ _id: raw._id },']]), expect: 'detect', kind: 'storeCalls' },
  { name: 'I1 key order only (must be info, not a difference)', dir: mutant('keyorder', [['        issueTitle: item.issueTitle || null,\n        issueUrl: item.issueUrl || null,', '        issueUrl: item.issueUrl || null,\n        issueTitle: item.issueTitle || null,']]), expect: 'info', infoKind: 'key-order' },
  { name: 'I2 feedback copied instead of shared (aliasing only)', dir: mutant('alias', [['feedback: lean ? [] : (Array.isArray(item.feedback) ? item.feedback : []),', 'feedback: lean ? [] : (Array.isArray(item.feedback) ? [...item.feedback] : []),']]), expect: 'info', infoKind: 'alias' },
];

const rows = [];
for (const c of checks) {
  const slug = c.name.split(' ')[0] + (c.seed ? `-s${c.seed}` : '');
  const out = path.join(DIR, `report-${slug}.json`);
  const args = [path.join(HERE, 'replay.mjs'), '--old', path.dirname(PIN), '--new', c.dir, '--n', c.n || mn, '--seed', c.seed || '1', '--out', out, '--quiet'];
  if (c.coverage) args.push('--coverage');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  if (r.status === 2 || !fs.existsSync(out)) { console.error(r.stderr); throw new Error(`replay failed for ${c.name}`); }
  const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
  const T = rep.totals;
  const byTier = Object.fromEntries(Object.entries(T.byTier).map(([k, v]) => [k, v.differing]));
  let ok;
  if (c.expect === 'none') ok = T.differing === 0 && rep.infoGroups.length === 0 && rep.exportsDiff.differences.length === 0;
  else if (c.expect === 'detect') ok = T.differing > 0 && (!c.kind || (T.kinds[c.kind] || 0) > 0);
  else ok = T.differing === 0 && rep.infoGroups.some(g => g.kind === c.infoKind);
  const row = { check: c.name, ok, differing: T.differing, of: T.inputs, byTier, kinds: T.kinds, groups: rep.groups.length, top: rep.groups[0]?.signature ?? null, info: rep.infoGroups.slice(0, 2).map(g => `${g.inputs}× ${g.signature}`), seconds: +((Date.now() - t0) / 1000).toFixed(0), report: out };
  if (c.coverage) {
    const cov = rep.coverage['old:pipeline-loops.js'];
    row.coverage = { lines: `${cov.all.linesCovered}/${cov.all.linesTotal} (${cov.all.pct}%)`, blocks: `${cov.all.blocksHit}/${cov.all.blocksTotal}`, byTier: Object.fromEntries(Object.entries(cov.byTier).map(([k, v]) => [k, `${v.pct}%`])), unhitBlocks: cov.all.unhitBlocks.map(b => `L${b.line}: ${b.code}`), uncoveredLines: cov.all.uncoveredLines.map(u => u.line) };
    row.ok = row.ok && cov.all.pct >= 95;
  }
  rows.push(row);
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.check}: ${row.differing}/${row.of} differing ${JSON.stringify(row.byTier)} kinds=${JSON.stringify(row.kinds)} (${row.seconds}s)${row.top ? `\n        top: ${row.top}` : ''}${row.info.length ? `\n        info: ${row.info.join(' | ')}` : ''}`);
  if (row.coverage) console.log(`        coverage: lines ${row.coverage.lines}, blocks ${row.coverage.blocks}, by tier ${JSON.stringify(row.coverage.byTier)}\n        unhit blocks: ${row.coverage.unhitBlocks.join(' ; ')}`);
}
fs.writeFileSync(path.join(DIR, 'selfcheck.json'), JSON.stringify(rows, null, 2));
process.exitCode = rows.every(r => r.ok) ? 0 : 1;
