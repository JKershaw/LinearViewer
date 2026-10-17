#!/usr/bin/env node
// Self-checks for replay.mjs against the pinned origin/main copies.
//   node selfcheck.mjs [--n 3000] [--jobs 3]
// 1. old vs old = 0 differences on seed 1 and seed 2 (seed 1 also measures
//    line coverage of each old file; target >= 95%).
// 2. planted mutants (one textual edit each) must be caught, and caught as
//    the right KIND: a testid-only edit as a DOM-contract difference, a
//    whitespace-only edit as whitespace-only (never structural/contract), an
//    attribute-order / JSON-key-order edit as serialization-only.
// Writes mutant dirs + reports under work/selfcheck/, prints a table.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, 'work', 'selfcheck');
const BASE = path.join(HERE, 'pinned', 'origin-main');
fs.mkdirSync(DIR, { recursive: true });
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const n = opt('--n', '3000');
const jobs = Number(opt('--jobs', '3'));

function mutant(name, file, from, to) {
  const src = fs.readFileSync(path.join(BASE, file), 'utf8');
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`mutant ${name}: pattern occurs ${count} times in ${file}`);
  const dir = path.join(DIR, `mutant-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(BASE)) if (f.endsWith('.js')) fs.copyFileSync(path.join(BASE, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, file), src.replace(from, to));
  return dir;
}

const kinds = (rep) => Object.keys(rep.totals.byKind).filter(k => k !== 'DOM-CONTRACT');
const checks = [
  { name: 'identity seed 1 (old vs old) + coverage', dir: BASE, seed: 1, coverage: true, expect: r => r.totals.differing === 0 },
  { name: 'identity seed 2 (old vs old)', dir: BASE, seed: 2, expect: r => r.totals.differing === 0 },
  { name: 'testid only: issue-line -> issue-row (must be DOM-contract)', file: 'render.js', from: 'data-testid="issue-line"', to: 'data-testid="issue-row"', expect: r => r.totals.contractDiffering > 0 && r.contractGroups.some(g => g.signature.includes('data-testid')) },
  { name: 'whitespace only: In Progress header indentation (must be whitespace-only, no contract)', file: 'render.js', from: '\n    <div class="in-progress-header">▼ In Progress</div>', to: '\n\n          <div class="in-progress-header">▼ In Progress</div>', expect: r => r.totals.differing > 0 && r.totals.contractDiffering === 0 && kinds(r).every(k => k.startsWith('whitespace-only')) },
  { name: 'whitespace presence: newline dropped between reply-box closing tags', file: 'render-session.js', from: 'aria-live="polite"></span>\n        </div>\n      </div>\n    </div>`;', to: 'aria-live="polite"></span></div>\n      </div>\n    </div>`;', expect: r => r.totals.differing > 0 && r.totals.contractDiffering === 0 && kinds(r).every(k => k.startsWith('whitespace-only')) },
  { name: 'attribute order only: session-run testid/status swap (must be serialization-only)', file: 'render-session.js', from: '<li class="sess-run" data-testid="session-run" data-status="${sm.state}"', to: '<li data-status="${sm.state}" class="sess-run" data-testid="session-run"', expect: r => r.totals.differing > 0 && r.totals.contractDiffering === 0 && kinds(r).every(k => k === 'serialization-only') },
  { name: 'JSON key order only: __SWIPE_DATA__ issues/filters swap (must be serialization-only)', file: 'render-swipe.js', from: '    issues: sortedIssues,\n    filters: filterGroups,', to: '    filters: filterGroups,\n    issues: sortedIssues,', expect: r => r.totals.differing > 0 && kinds(r).every(k => k === 'serialization-only') },
  { name: 'escapeHtml dropped on run-page title', file: 'render-session.js', from: '<span class="sess-heading-title" data-testid="session-title">${escapeHtml(pageTitle)}</span>', to: '<span class="sess-heading-title" data-testid="session-title">${pageTitle}</span>', expect: r => r.totals.differing > 0 },
  { name: 'data-status renamed data-state (contract)', file: 'render.js', from: 'attrs: `data-status="${stateClass}" aria-label', to: 'attrs: `data-state="${stateClass}" aria-label', expect: r => r.totals.contractDiffering > 0 },
  { name: 'swipe promotion threshold 2 -> 3 (data)', file: 'render-swipe.js', from: 'const UNBLOCK_PROMOTION_THRESHOLD = 2;', to: 'const UNBLOCK_PROMOTION_THRESHOLD = 3;', expect: r => r.totals.differing > 0 && Object.keys(r.totals.byKind).includes('data') },
  { name: 'flattenTrees mutates its input (input-mutation)', file: 'render-swipe.js', from: '    items.push(issueToCard(node.issue, projectName, type));', to: '    items.push(issueToCard(node.issue, projectName, type)); node.seen = true;', expect: r => r.totals.differing > 0 && Object.keys(r.totals.byKind).some(k => k === 'input-mutation') },
  { name: 'settings toggle copy "○ off" -> "○ disabled" (text)', file: 'render-settings.js', from: "const stateText = isOn ? '● on' : '○ off';\n  const nextState = isOn ? 'false' : 'true';\n  const stateClass = isOn ? 'toggle-on' : 'toggle-off';\n  const noteHtml", to: "const stateText = isOn ? '● on' : '○ disabled';\n  const nextState = isOn ? 'false' : 'true';\n  const stateClass = isOn ? 'toggle-on' : 'toggle-off';\n  const noteHtml", expect: r => r.totals.differing > 0 && Object.keys(r.totals.byKind).some(k => k.startsWith('structural')) },
  { name: 'formatRelativeTime boundary diffDays < 7 -> <= 7', file: 'render.js', from: 'if (diffDays < 7) return', to: 'if (diffDays <= 7) return', expect: r => r.totals.differing > 0 }
];

function run(c) {
  const dir = c.dir || mutant(c.name.split(':')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase(), c.file, c.from, c.to);
  const tag = c.dir ? `identity-seed${c.seed}` : path.basename(dir);
  const out = path.join(DIR, `report-${tag}.json`);
  const args = [path.join(HERE, 'replay.mjs'), '--old', BASE, '--new', dir, '--n', n, '--seed', String(c.seed || 1), '--out', out, '--quiet', '--work', path.join(DIR, `work-${tag}`)];
  if (c.coverage) args.push('--coverage');
  // share the capture cache
  fs.mkdirSync(path.join(DIR, `work-${tag}`), { recursive: true });
  for (const f of fs.readdirSync(path.join(HERE, 'work')).filter(f => f.startsWith('captured-'))) fs.copyFileSync(path.join(HERE, 'work', f), path.join(DIR, `work-${tag}`, f));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('close', (code) => {
      if (code === 2 || !fs.existsSync(out)) return resolve({ c, ok: false, error: err.slice(-1500) });
      const r = JSON.parse(fs.readFileSync(out, 'utf8'));
      resolve({ c, r, out, ok: !!c.expect(r) });
    });
  });
}

const results = new Array(checks.length);
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => { while (next < checks.length) { const i = next++; results[i] = await run(checks[i]); } }));

const rows = [];
for (const { c, r, ok, error, out } of results) {
  if (error) { console.log(`FAIL  ${c.name}: replay error\n${error}`); rows.push({ check: c.name, ok: false, error }); continue; }
  const t = r.totals;
  const row = { check: c.name, ok, differing: t.differing, of: t.inputs, contract: t.contractDiffering, byKind: t.byKind, byTier: Object.fromEntries(Object.entries(t.byTier).filter(([, v]) => v.differing).map(([k, v]) => [k, v.differing])), groups: r.groups.length, top: r.contractGroups[0]?.signature || r.groups[0]?.signature || null, report: out };
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${t.differing}/${t.inputs} differing, contract ${t.contractDiffering}, kinds ${JSON.stringify(t.byKind)} tiers ${JSON.stringify(row.byTier)}${row.top ? `\n        top: ${String(row.top).slice(0, 200)}` : ''}`);
  if (c.coverage && r.coverage) {
    row.coverage = {};
    for (const [rel, cv] of Object.entries(r.coverage.old)) {
      row.coverage[rel] = { lines: `${cv.all.linesCovered}/${cv.all.linesTotal}`, pct: cv.all.pct, blocks: `${cv.all.blocksHit}/${cv.all.blocksTotal}`, uncovered: cv.all.uncoveredLines, existingTestsOnlyPct: cv.existingTestsOnly.pct, meets95: cv.all.pct >= 95 };
      console.log(`        coverage ${rel}: ${cv.all.linesCovered}/${cv.all.linesTotal} = ${cv.all.pct}% (${cv.all.pct >= 95 ? 'ok' : 'BELOW 95%'})  blocks ${cv.all.blocksHit}/${cv.all.blocksTotal}  tests-only ${cv.existingTestsOnly.pct}%${cv.all.uncoveredLines.length ? `  uncovered L${cv.all.uncoveredLines.join(',')}` : ''}`);
    }
    if (!Object.values(row.coverage).every(x => x.meets95)) { row.ok = false; console.log('        FAIL: a file is below 95% line coverage'); }
  }
  rows.push(row);
}
fs.writeFileSync(path.join(DIR, 'selfcheck.json'), JSON.stringify(rows, null, 2));
const passed = rows.filter(r => r.ok).length;
console.log(`\n${passed}/${rows.length} checks pass; mutants caught ${rows.slice(2).filter(r => r.ok).length}/${rows.length - 2}`);
process.exitCode = rows.every(r => r.ok) ? 0 : 1;
