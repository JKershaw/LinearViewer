#!/usr/bin/env node
// Runs the S1 exit gates for the LIN-3573 replay harness and writes results/GATE-RESULTS.json.
//
//   node gates.mjs --repo <checkout> [--seeds 1,2,3] [--n 9000] [--mutant-n 9000] [--out-dir results] [--only 1,2,3]
//
//   Gate 1  old vs old: 0 differences over >= 3,000 requests; every URL form >= 100 requests;
//           every declared status/logEvent pair >= 5; ?source= on >= 25% of the 13 write forms
//           (all five values); the two bad-`target` order cases; no outbound calls.
//   Gate 2  every planted mutant reads red on its own variant; the one control stays equivalent.
//   Gate 3  V8 precise block coverage over the old copies: every executable handler block
//           reached >= 5 times, or justified in dead-blocks.json.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const repo = path.resolve(arg('--repo'));
const seeds = arg('--seeds', '1,2,3').split(',').map(Number);
const n = Number(arg('--n', '9000'));
const mutantN = Number(arg('--mutant-n', String(n)));
const outDir = path.resolve(arg('--out-dir', path.join(TOOL, 'results')));
const only = (arg('--only', '1,2,3')).split(',').map(Number);
mkdirSync(outDir, { recursive: true });

const { MUTANTS } = await import('./lib/mutants.mjs');
const { FORMS, WRITE_FORMS, FORM_KEYS } = await import('./lib/gen.mjs');
const dead = JSON.parse(readFileSync(path.join(TOOL, 'dead-blocks.json'), 'utf8'));

function run(args, label) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(TOOL, 'replay.mjs'), '--repo', repo, '--quiet', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.stdout.on('data', () => {});
    p.on('close', (code) => resolve({ label, code, err: err.slice(-2000) }));
  });
}
async function pool(tasks, width) {
  const results = []; let i = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (i < tasks.length) { const k = i++; results[k] = await tasks[k](); } }));
  return results;
}
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const results = { generatedAt: new Date().toISOString(), repo, node: process.version, baseSha: readFileSync(path.join(TOOL, 'BASE_SHA'), 'utf8').trim(), seeds, n, mutantN };

// ---------------------------------------------------------------------------------------------
if (only.includes(1) || only.includes(3)) {
  const runs = await pool(seeds.map(seed => () => run(['--seed', String(seed), '--n', String(n), '--coverage', '--out', path.join(outDir, `gate1-seed${seed}.json`)], `seed ${seed}`)), 3);
  const gate1 = []; const gate3 = [];
  for (const [i, seed] of seeds.entries()) {
    const f = path.join(outDir, `gate1-seed${seed}.json`);
    let rep; try { rep = load(f); } catch { gate1.push({ seed, pass: false, failures: [`replay did not produce a report: ${runs[i].err}`] }); continue; }
    const failures = [];
    const s = rep.summary;
    if (s.differingRequests !== 0) failures.push(`${s.differingRequests} differing requests (groups: ${rep.differences.map(d => `${d.form}[${d.kind}]x${d.count}`).join(', ')})`);
    if (s.requests < 3000) failures.push(`only ${s.requests} requests`);
    if (s.expectMismatches) failures.push(`${s.expectMismatches} requests did not take the exit the catalogue named`);
    if (s.outboundRequests) failures.push(`${s.outboundRequests} requests made an outbound fetch`);
    if (s.unhandledRequests) failures.push(`${s.unhandledRequests} requests produced an unhandled rejection`);
    if (s.transportFailures) failures.push(`${s.transportFailures} requests timed out or got no response`);
    if (s.socketEscapes) failures.push(`${s.socketEscapes} non-loopback socket attempts`);
    const perForm = {};
    for (const k of FORM_KEYS) {
      const pf = rep.perForm[k];
      const declared = pf.expectedPairs;
      const short = Object.entries(declared).filter(([, c]) => c < 5).map(([p, c]) => `${p}x${c}`);
      const observedLow = Object.entries(pf.pairs).filter(([, c]) => c < 5).map(([p, c]) => `${p}x${c}`);
      const sourceShare = pf.requests ? pf.withSource / pf.requests : 0;
      perForm[k] = { requests: pf.requests, pairs: pf.pairs, declaredPairs: declared, withSource: pf.withSource, sourceShare: Number(sourceShare.toFixed(3)), sourceValues: pf.sourceValues, declaredBelow5: short, observedBelow5: observedLow };
      if (pf.requests < 100) failures.push(`${k}: only ${pf.requests} requests (< 100)`);
      if (short.length) failures.push(`${k}: declared status/logEvent pairs below 5: ${short.join(' ')}`);
      if (observedLow.length) failures.push(`${k}: observed status/logEvent pairs below 5: ${observedLow.join(' ')}`);
      if (WRITE_FORMS.includes(k)) {
        if (sourceShare < 0.25) failures.push(`${k}: ?source= on only ${(sourceShare * 100).toFixed(1)}% of requests (< 25%)`);
        for (const v of ['jira', 'github', 'linear', 'bogus', '(empty)']) if ((pf.sourceValues[v] || 0) < 5) failures.push(`${k}: ?source=${v} sent ${pf.sourceValues[v] || 0} times (< 5)`);
      }
    }
    for (const t of ['W_ATTACH:bad-target-under-503', 'W_ATTACH:bad-target-under-no-uploadFile', 'W_ATTACH:bad-target']) if ((rep.tags[t] || 0) < 5) failures.push(`order case ${t} sent ${rep.tags[t] || 0} times (< 5)`);
    gate1.push({ seed, requests: s.requests, differingRequests: s.differingRequests, elapsedMs: s.elapsedMs, pass: failures.length === 0, failures, perForm });

    // Gate 3 for this run, over the OLD copies
    const g3 = { seed, files: {}, failures: [] };
    for (const which of ['writes', 'rulings']) {
      const c = rep.coverage?.old?.[which];
      if (!c || c.error) { g3.failures.push(`${which}: no coverage data`); continue; }
      const unexplained = []; const justified = [];
      for (const b of c.underMinBlocks) {
        let reason = null;
        if (b.isFunction && b.fn === '(anonymous)' && b.line === 1) reason = dead.rules.find(r => r.match === 'module-body').reason;
        else if (b.isFunction && /^create(ProxyWrite|Rulings)Routes$/.test(b.fn)) reason = dead.rules.find(r => r.match === 'factory').reason;
        else { const d = dead.blocks.find(x => x.file === which && x.line === b.line && b.snippet.startsWith(x.snippetPrefix)); if (d) reason = d.reason; }
        (reason ? justified : unexplained).push({ ...b, reason });
      }
      g3.files[which] = { executableLines: c.lines.executable, coveredLines: c.lines.covered, uncoveredLines: c.lines.uncovered, blocks: c.blocks, justified, unexplained };
      for (const b of unexplained) g3.failures.push(`${which} L${b.line}-${b.endLine} x${b.count}: ${b.snippet}`);
    }
    g3.pass = g3.failures.length === 0;
    gate3.push(g3);
  }
  results.gate1 = { pass: gate1.every(g => g.pass), runs: gate1 };
  results.gate3 = { pass: gate3.every(g => g.pass), runs: gate3 };
}

// ---------------------------------------------------------------------------------------------
if (only.includes(2)) {
  const tasks = MUTANTS.map(m => () => run(['--seed', '1', '--n', String(mutantN), '--mutant', m.id, '--out', path.join(outDir, `gate2-${m.id}.json`)], m.id));
  const runs = await pool(tasks, 4);
  const out = [];
  for (const [i, m] of MUTANTS.entries()) {
    let rep; try { rep = load(path.join(outDir, `gate2-${m.id}.json`)); } catch { out.push({ id: m.id, pass: false, reason: `no report: ${runs[i].err}` }); continue; }
    const groups = rep.differences.map(d => `${d.form}[${d.kind}]x${d.count}`);
    const onTarget = rep.differences.some(d => m.forms.includes(d.form));
    const first = rep.differences[0]?.example;
    let pass; let verdict;
    if (m.expect === 'red') { pass = rep.summary.differingRequests > 0 && onTarget; verdict = pass ? 'red' : (rep.summary.differingRequests > 0 ? 'red only off-target' : 'GREEN (not detected)'); }
    else { pass = rep.summary.differingRequests === 0; verdict = pass ? 'equivalent (0 differences)' : 'RED (control is not equivalent)'; }
    out.push({ id: m.id, what: m.what, origin: m.origin, expect: m.expect, verdict, pass, differingRequests: rep.summary.differingRequests, groups, example: first ? { idx: first.idx, tag: first.tag, request: first.request, kind: rep.differences[0].kind } : null });
  }
  results.gate2 = { pass: out.every(o => o.pass), mutants: out };
}

writeFileSync(path.join(outDir, 'GATE-RESULTS.json'), JSON.stringify(results, null, 1));
const line = (name, g) => process.stdout.write(`${name}: ${g ? (g.pass ? 'PASS' : 'FAIL') : 'not run'}\n`);
line('Gate 1', results.gate1); line('Gate 2', results.gate2); line('Gate 3', results.gate3);
for (const g of results.gate1?.runs || []) for (const f of g.failures) process.stdout.write(`  gate1 seed ${g.seed}: ${f}\n`);
for (const g of results.gate3?.runs || []) for (const f of g.failures) process.stdout.write(`  gate3 seed ${g.seed}: ${f}\n`);
for (const m of results.gate2?.mutants || []) process.stdout.write(`  gate2 ${m.pass ? 'ok  ' : 'FAIL'} ${m.id}: ${m.verdict}${m.groups?.length ? '  ' + m.groups.slice(0, 3).join(', ') : ''}\n`);
