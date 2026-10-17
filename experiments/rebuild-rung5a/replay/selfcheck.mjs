#!/usr/bin/env node
// Self-checks for replay.mjs against the pinned origin/main copies (f4749b91).
//   node selfcheck.mjs [--n 3000] [--seeds 1,7] [--jobs 4] [--mutant-tests] [--quick]
// 1. old vs old = 0 differences on two seeds (all tiers incl. the test tier);
// 2. planted mutants (temp copies of old) are each caught; one key-order-only
//    mutant must produce 0 differences and >0 info entries;
// 3. line coverage of the old files from the replay inputs >= 95%.
// Writes mutants + reports under work/selfcheck/, prints a table, exit 0 iff all pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, 'work', 'selfcheck');
const BASE = path.join(HERE, 'pinned', 'origin-main');
fs.mkdirSync(DIR, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };
const n = opt('n', '3000');
const seeds = opt('seeds', '1,7').split(',');
const jobs = opt('jobs', '4');
const mutantTiers = argv.includes('--mutant-tests') ? 'test,edge,gen-v,gen-vx,gen-f' : 'edge,gen-v,gen-vx,gen-f';
const quick = argv.includes('--quick');

const read = (f) => fs.readFileSync(path.join(BASE, f), 'utf8');
function mutant(name, file, from, to) {
  const src = read(file);
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`mutant ${name}: pattern occurs ${count} times in ${file}`);
  const dir = path.join(DIR, `mutant-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['dispatch-factory.js', 'dispatch-validation.js']) fs.writeFileSync(path.join(dir, f), f === file ? src.replace(from, to) : read(f));
  return dir;
}
const F = 'dispatch-factory.js'; const V = 'dispatch-validation.js';
const MUTANTS = [
  { name: 'flip-condition', what: 'duplicate-guard gate: force !== true -> force === true', dir: () => mutant('flip-condition', F, '    && fields.force !== true\n    && !!fields.issueIdentifier\n    && typeof store.findRecentFreshDispatch', '    && fields.force === true\n    && !!fields.issueIdentifier\n    && typeof store.findRecentFreshDispatch') },
  { name: 'drop-field', what: 'addItem argument drops `terminal`', dir: () => mutant('drop-field', F, '    terminal: terminal || null,\n', '') },
  { name: 'change-default', what: 'applyDefaultHarness default true -> false', dir: () => mutant('change-default', F, '  applyDefaultHarness = true,', '  applyDefaultHarness = false,') },
  { name: 'error-message', what: "'sessionId must not be empty' -> 'sessionId must be non-empty'", dir: () => mutant('error-message', V, "'sessionId must not be empty'", "'sessionId must be non-empty'") },
  { name: 'validation-bound', what: 'MAX_IDENTIFIER_LENGTH 100 -> 101', dir: () => mutant('validation-bound', V, 'const MAX_IDENTIFIER_LENGTH = 100;', 'const MAX_IDENTIFIER_LENGTH = 101;') },
  { name: 'runaway-bound', what: 'taskDispatches >= 30 -> > 30', dir: () => mutant('runaway-bound', F, 'if (result.taskDispatches >= MAX_FRESH_SESSIONS_PER_TASK) {', 'if (result.taskDispatches > MAX_FRESH_SESSIONS_PER_TASK) {') },
  { name: 'check-order', what: 'issueId check moved after followUpTo check (first-error order)', dir: () => mutant('check-order', V, "  if (issueId && !isValidIssueId(issueId)) {\n    return { error: 'Invalid issueId format' };\n  }\n\n  // Follow-up reference (LIN-415): well-formed UUID + cli/web-only target.\n  const followUpToMessage = followUpToError({ followUpTo, target });\n  if (followUpToMessage) return { error: followUpToMessage };\n", "  // Follow-up reference (LIN-415): well-formed UUID + cli/web-only target.\n  const followUpToMessage = followUpToError({ followUpTo, target });\n  if (followUpToMessage) return { error: followUpToMessage };\n  if (issueId && !isValidIssueId(issueId)) {\n    return { error: 'Invalid issueId format' };\n  }\n\n") },
  { name: 'per-call-cache', what: 'guard cache default: module singleton -> fresh per call', dir: () => mutant('per-call-cache', F, '  guardTaskDoneCache = dispatchGuardTaskDoneCache,', '  guardTaskDoneCache = createTaskDoneCache(),') },
  { name: 'clock-source', what: 'pilot armDecidedAt: Date.now() -> injected now', dir: () => mutant('clock-source', F, '        armDecidedAt = Date.now();', '        armDecidedAt = pilotNowMs;') },
  { name: 'warn-dropped', what: 'unknown-effort console.warn removed', dir: () => mutant('warn-dropped', V, '    console.warn(`Unknown dispatch effort level: ${effort}`);\n', '') },
  { name: 'key-order-only', what: 'addItem argument: model/harness keys swapped (must be info only)', expect: 'none-with-info', dir: () => mutant('key-order-only', F, '    model: resolvedModel,\n    harness: resolvedHarness,\n', '    harness: resolvedHarness,\n    model: resolvedModel,\n') }
];

function run(label, newDir, { seed, tiers, coverage }) {
  const out = path.join(DIR, `report-${label}.json`);
  const args = [path.join(HERE, 'replay.mjs'), '--old', BASE, '--new', newDir, '--n', n, '--seed', seed, '--out', out, '--jobs', jobs, '--quiet', '--tiers', tiers];
  if (coverage) args.push('--coverage');
  const t0 = performance.now();
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status === 2 || !fs.existsSync(out)) { console.error(r.stderr); throw new Error(`replay failed for ${label}`); }
  const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
  return { rep, out, secs: ((performance.now() - t0) / 1000).toFixed(0) };
}

const rows = [];
for (const seed of seeds) {
  const { rep, out, secs } = run(`identity-seed${seed}`, BASE, { seed, tiers: quick ? 'edge,gen-v,gen-vx,gen-f' : 'test,edge,gen-v,gen-vx,gen-f', coverage: seed === seeds[0] });
  const row = { check: `old vs old, seed ${seed}`, ok: rep.totals.differing === 0, differing: rep.totals.differing, inputs: rep.totals.inputs, byTier: rep.totals.byTier, info: rep.totals.infoOnly, groups: rep.groups.slice(0, 5).map(g => `${g.count}x ${g.sig}`), secs, report: out };
  if (rep.coverage) {
    row.coverage = Object.fromEntries(Object.entries(rep.coverage.old).map(([f, c]) => [f, { lines: `${c.linesCovered}/${c.linesTotal}`, pct: c.pct, uncovered: c.uncoveredLines.map(u => u.line), blocks: `${c.blocksHit}/${c.blocksTotal}`, unhitBlocks: c.unhitBlocks.map(b => `L${b.line}: ${b.code}`) }]));
    rows.push({ check: 'line coverage of old files >= 95%', ok: Object.values(rep.coverage.old).every(c => c.pct >= 95), detail: row.coverage });
  }
  rows.push(row);
}
for (const m of MUTANTS) {
  const dir = m.dir();
  const { rep, out, secs } = run(`mutant-${m.name}`, dir, { seed: seeds[0], tiers: mutantTiers });
  const byTier = Object.fromEntries(Object.entries(rep.totals.byTier).filter(([, v]) => v.differing).map(([k, v]) => [k, v.differing]));
  const ok = m.expect === 'none-with-info' ? rep.totals.differing === 0 && rep.totals.infoOnly > 0 : rep.totals.differing > 0;
  rows.push({ check: `mutant ${m.name}: ${m.what}`, ok, differing: rep.totals.differing, info: rep.totals.infoOnly, byTier, groups: rep.groups.slice(0, 3).map(g => `${g.count}x ${g.sig}`), infoGroups: (rep.infoGroups || []).slice(0, 2).map(g => `${g.count}x ${g.sig}`), secs, report: out });
}
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check}${r.differing !== undefined ? `: ${r.differing} differing${r.inputs ? ` of ${r.inputs}` : ''}, info ${r.info}${r.byTier && !r.check.startsWith('old') ? ' ' + JSON.stringify(r.byTier) : ''}${r.secs ? ` (${r.secs}s)` : ''}` : ''}`);
  for (const g of r.groups || []) console.log(`        ${g}`);
  for (const g of r.infoGroups || []) console.log(`        info: ${g}`);
  if (r.detail) for (const [f, c] of Object.entries(r.detail)) console.log(`        ${f}: lines ${c.lines} (${c.pct}%), blocks ${c.blocks}; uncovered lines ${JSON.stringify(c.uncovered)}; unhit blocks ${JSON.stringify(c.unhitBlocks)}`);
}
fs.writeFileSync(path.join(DIR, 'selfcheck.json'), JSON.stringify(rows, null, 2));
const pass = rows.filter(r => r.ok).length;
const mut = rows.filter(r => r.check.startsWith('mutant'));
console.log(`\n${pass}/${rows.length} checks pass; mutants caught ${mut.filter(r => r.ok).length}/${mut.length}`);
process.exitCode = rows.every(r => r.ok) ? 0 : 1;
