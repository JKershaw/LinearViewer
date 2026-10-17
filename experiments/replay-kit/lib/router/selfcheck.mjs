// Router replay self-check (replay-kit/lib/router; generalised from
// rung5c/replay/selfcheck.mjs): (1) old vs an independent copy of old → 0
// differences on every seed, with line coverage of the pinned file(s) ≥ the
// floor; (2) each planted mutant must be detected in an expected kind on an
// expected endpoint and nowhere else.
//
//   await runRouterSelfcheck({ toolDir, base, mutants, argv })
//   mutant: { id, file, what, from, to, expect: { kinds: [...], endpoints: [...] } }
//   argv flags: --n --mutant-n --seeds 1,7 --jobs 4 --out f --lib DIR --coverage-floor 95
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

export async function runRouterSelfcheck({ toolDir, base, mutants, argv = process.argv }) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
  const N = Number(arg('--n', 3000));
  const MN = Number(arg('--mutant-n', 1500));
  const SEEDS = arg('--seeds', '1,7').split(',').map(Number);
  const JOBS = Number(arg('--jobs', 4));
  const OUT = path.resolve(arg('--out', path.join(toolDir, 'reports', 'selfcheck.json')));
  const LIB = arg('--lib', null);
  const FLOOR = Number(arg('--coverage-floor', 95));

  const dir = path.join(toolDir, 'work', `selfcheck-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const copyDir = (src, dst) => { mkdirSync(dst, { recursive: true }); for (const f of readdirSync(src)) if (/\.m?js$/.test(f)) copyFileSync(path.join(src, f), path.join(dst, f)); };
  const oldCopy = path.join(dir, 'old-copy');
  copyDir(base, oldCopy);

  const jobs = [];
  for (const seed of SEEDS) jobs.push({ label: `identity-seed${seed}`, a: base, b: oldCopy, seed, n: N, coverage: true });
  const meta = {};
  for (const m of mutants) {
    const src = readFileSync(path.join(base, m.file), 'utf8');
    const occ = src.split(m.from).length - 1;
    meta[m.id] = { m, occ };
    if (occ !== 1) continue;
    const mdir = path.join(dir, m.id);
    copyDir(base, mdir);
    writeFileSync(path.join(mdir, m.file), src.replace(m.from, m.to));
    jobs.push({ label: m.id, a: base, b: mdir, seed: SEEDS[0], n: MN });
  }

  const run = (j) => new Promise((resolve) => {
    const rep = path.join(dir, `${j.label}.json`);
    const args = [path.join(toolDir, 'replay.mjs'), '--old', j.a, '--new', j.b, '--seed', String(j.seed), '--n', String(j.n), '--out', rep, '--quiet', ...(j.coverage ? ['--coverage'] : []), ...(LIB ? ['--lib', LIB] : [])];
    const t0 = Date.now();
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', () => {}); p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ ...j, code, ms: Date.now() - t0, report: existsSync(rep) ? JSON.parse(readFileSync(rep, 'utf8')) : null, err: err.slice(-1500) }));
  });
  process.stdout.write(`self-check: ${jobs.length} replay runs (${JOBS} at a time), identity n=${N} (+edge+test) on seeds ${SEEDS.join(',')}, mutants n=${MN}\n`);
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: JOBS }, async () => { while (next < jobs.length) results.push(await run(jobs[next++])); }));
  const by = Object.fromEntries(results.map(r => [r.label, r]));

  const summary = { base, lib: LIB || 'default', n: N, mutantN: MN, seeds: SEEDS, checks: [], coverage: {} };
  for (const seed of SEEDS) {
    const r = by[`identity-seed${seed}`];
    const rep = r.report;
    const ok = rep && !rep.fatal && rep.summary.differingRequests === 0 && Object.values(rep.exportsDiff).every(d => d.length === 0);
    summary.checks.push({ id: `identity-seed${seed}`, what: 'old vs an independent copy of old', pass: !!ok, requests: rep?.summary?.requests, perTier: rep?.summary?.perTier, differing: rep?.summary?.differingRequests, groups: (rep?.differences || []).map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: r.ms, error: rep?.fatal || (rep ? undefined : r.err) });
    if (rep?.coverage?.old) summary.coverage[`seed${seed}`] = Object.fromEntries(Object.entries(rep.coverage.old).filter(([, c]) => c.pct !== undefined).map(([f, c]) => [f, { pct: c.pct, covered: c.coveredLines, executable: c.executableLines, uncovered: c.uncovered.map(u => `${u.line}: ${u.text}`) }]));
    if (seed === SEEDS[0] && rep) {
      summary.thinStatusPairs = rep.thinStatusPairs.filter(t => t.route !== 'UNMATCHED');
      summary.perRouteRequests = Object.fromEntries(Object.entries(rep.perRoute).map(([k, v]) => [k, v.requests]));
      summary.minPerRoute = Math.min(...Object.entries(rep.perRoute).filter(([k]) => k !== 'UNMATCHED').map(([, v]) => v.requests));
      summary.importSideEffects = rep.importSideEffects?.old;
    }
  }
  for (const [id, { m, occ }] of Object.entries(meta)) {
    if (occ !== 1) { summary.checks.push({ id, what: m.what, pass: false, error: `mutation site found ${occ} times (need 1)` }); continue; }
    const rep = by[id].report;
    if (!rep || rep.fatal) { summary.checks.push({ id, what: m.what, pass: false, error: rep?.fatal || by[id].err }); continue; }
    const groups = rep.differences.map(g => ({ endpoint: g.endpoint, kind: g.kind, count: g.count }));
    const detected = groups.filter(g => m.expect.kinds.includes(g.kind) && m.expect.endpoints.includes(g.endpoint));
    const offTarget = groups.filter(g => !m.expect.endpoints.includes(g.endpoint));
    summary.checks.push({ id, what: m.what, pass: detected.length > 0 && offTarget.length === 0, differing: rep.summary.differingRequests, detectedIn: detected.map(g => `${g.kind} x${g.count}`), groups: groups.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), offTarget: offTarget.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: by[id].ms });
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  rmSync(dir, { recursive: true, force: true });
  for (const c of summary.checks) {
    process.stdout.write(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} ${c.what}  differing=${c.differing ?? '-'}${c.detectedIn ? `  detected: ${c.detectedIn.join(', ')}` : ''}${c.error ? `  error: ${String(c.error).split('\n').slice(-3).join(' | ')}` : ''}\n`);
    if (!c.pass) for (const g of c.groups || []) process.stdout.write(`        ${g}\n`);
  }
  for (const [seed, files] of Object.entries(summary.coverage)) for (const [f, c] of Object.entries(files)) process.stdout.write(`coverage ${seed} ${f}: ${c.pct}% (${c.covered}/${c.executable}); uncovered: ${c.uncovered.map(u => u.split(':')[0]).join(', ') || 'none'}\n`);
  process.stdout.write(`min requests per route: ${summary.minPerRoute}; thin status pairs (<5): ${summary.thinStatusPairs?.length ?? '?'}\n`);
  process.stdout.write(`self-check report: ${OUT}\n`);
  const covOk = Object.values(summary.coverage).length === SEEDS.length && Object.values(summary.coverage).every(fs => Object.values(fs).every(c => c.pct >= FLOOR));
  return summary.checks.every(c => c.pass) && covOk ? 0 : 1;
}
