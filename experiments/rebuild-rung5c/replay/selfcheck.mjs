#!/usr/bin/env node
// Self-check: (1) old vs an independent copy of old → 0 differences on two
// seeds; (2) planted mutants, each must be detected in an expected kind on an
// expected endpoint and nowhere else; (3) line coverage of each old file.
//
//   node selfcheck.mjs [--n 6000] [--seeds 1,7] [--mutant-n 3000] [--jobs 4] [--out reports/selfcheck.json]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(TOOL, 'pinned', 'origin-main');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 6000));
const MN = Number(arg('--mutant-n', 3000));
const SEEDS = arg('--seeds', '1,7').split(',').map(Number);
const JOBS = Number(arg('--jobs', 4));
const OUT = path.resolve(arg('--out', path.join(TOOL, 'reports', 'selfcheck.json')));
const LIB = arg('--lib', null);

const SD = 'POST /workspace/:urlKey/api/dispatch';
const MUTANTS = [
  { id: 'd1-status', file: 'dispatch.js', what: "trim 'not-downward' 409 → 422",
    from: "return jsonError(res, 409, 'Trim must reduce", to: "return jsonError(res, 422, 'Trim must reduce",
    expect: { kinds: ['status', 'body'], endpoints: ['PATCH /workspace/:urlKey/api/dispatch/:sessionId/trim'] } },
  { id: 'd2-field', file: 'dispatch.js', what: 'session 201 drops item.consumerLastSeenAt',
    from: '          consumerLastSeenAt: item.consumerLastSeenAt,\n          ...(item.budgetPosition', to: '          ...(item.budgetPosition',
    expect: { kinds: ['body'], endpoints: [SD] } },
  { id: 'd3-store-arg', file: 'dispatch.js', what: "broker plain mint label 'refire-broker' → 'refire'",
    from: "label: 'refire-broker',\n        ttl: BOOTSTRAP_TOKEN_TTL_SECONDS", to: "label: 'refire',\n        ttl: BOOTSTRAP_TOKEN_TTL_SECONDS",
    expect: { kinds: ['store:proxyTokenStore'], endpoints: ['POST /api/dispatch/broker-token'] } },
  { id: 'd4-gate', file: 'dispatch.js', what: 'DELETE …/halt loses its owner gate',
    from: "router.delete('/workspace/:urlKey/api/dispatch/halt', workspaceFromUrl, async (req, res) => {\n    if (await refuseNonOwner(req, res)) return;\n",
    to: "router.delete('/workspace/:urlKey/api/dispatch/halt', workspaceFromUrl, async (req, res) => {\n",
    expect: { kinds: ['status', 'body', 'store:workspaceHaltStore', 'depCalls', 'console'], endpoints: ['DELETE /workspace/:urlKey/api/dispatch/halt'] } },
  { id: 'd5-fire-and-forget', file: 'dispatch.js', what: 'task-mode record drops the caller surface',
    from: 'surface: hasSurface ? surface : null', to: 'surface: null',
    expect: { kinds: ['store:taskModeStore'], endpoints: [SD] } },
  { id: 'p1-logEvent', file: 'proxy-dispatch.js', what: 'list route audits 200 as 201',
    from: "logEvent(req, '/api/proxy/dispatch', 200);", to: "logEvent(req, '/api/proxy/dispatch', 201);",
    expect: { kinds: ['logEvent', 'store:proxyEventStore'], endpoints: ['GET /api/proxy/dispatch'] } },
  { id: 'p2-longpoll', file: 'proxy-dispatch.js', what: 'long-poll re-check interval 1500 → 1000 ms',
    from: 'const DISPATCH_WAIT_POLL_MS = 1500;', to: 'const DISPATCH_WAIT_POLL_MS = 1000;',
    expect: { kinds: ['body', 'store:dispatchQueueStore', 'serverResponse', 'header-derived:content-length', 'store:dispatchTokenStore', 'store:proxyTokenStore'], endpoints: ['GET /api/proxy/dispatch/:id'] } },
  { id: 'p3-field', file: 'proxy-dispatch.js', what: 'override arm drops `override: true`',
    from: '              override: true\n', to: '',
    expect: { kinds: ['body', 'serverResponse'], endpoints: ['POST /api/proxy/recommend-and-dispatch'] } },
  { id: 'p4-keepalive', file: 'proxy-dispatch.js', what: 'defer refusal answers on res, not the armed keepalive',
    from: "return keepaliveError(keepalive, 422, 'Recommendation did not resolve to an actionable task', {",
    to: "return jsonError(res, 422, 'Recommendation did not resolve to an actionable task', {",
    expect: { kinds: ['body', 'status', 'expressErrorHandler', 'console', 'unhandledRejection', 'serverResponse', 'header:content-type', 'header-derived:content-length'], endpoints: ['POST /api/proxy/recommend-and-dispatch'] } },
  { id: 'k1-store-arg', file: 'proxy-kickoff.js', what: 'kickoff row waitForFollowUps true → false',
    from: '          waitForFollowUps: true,', to: '          waitForFollowUps: false,',
    expect: { kinds: ['store:dispatchQueueStore'], endpoints: ['POST /api/proxy/autopilot/kickoff'] } },
  { id: 'k2-declared-site', file: 'proxy-kickoff.js', what: "kickoff declaredSite 'M1' → 'M2'",
    from: "declaredSite: 'M1',", to: "declaredSite: 'M2',",
    expect: { kinds: ['store:dispatchQueueStore'], endpoints: ['POST /api/proxy/autopilot/kickoff'] } },
  { id: 'k3-bound', file: 'proxy-kickoff.js', what: 'GET kickoff goal cap 1000 → 999',
    from: 'req.query.goal.slice(0, 1000)', to: 'req.query.goal.slice(0, 999)',
    expect: { kinds: ['body', 'header-derived:content-length', 'header-derived:etag'], endpoints: ['GET /api/proxy/autopilot/kickoff'] } },
];

const dir = path.join(TOOL, 'work', `selfcheck-${process.pid}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const copyDir = (src, dst) => { mkdirSync(dst, { recursive: true }); for (const f of readdirSync(src)) if (/\.m?js$/.test(f)) copyFileSync(path.join(src, f), path.join(dst, f)); };
const oldCopy = path.join(dir, 'old-copy');
copyDir(BASE, oldCopy);

const jobs = [];
for (const seed of SEEDS) jobs.push({ label: `identity-seed${seed}`, a: BASE, b: oldCopy, seed, n: N, coverage: true });
const meta = {};
for (const m of MUTANTS) {
  const src = readFileSync(path.join(BASE, m.file), 'utf8');
  const occ = src.split(m.from).length - 1;
  meta[m.id] = { m, occ };
  if (occ !== 1) continue;
  const mdir = path.join(dir, m.id);
  copyDir(BASE, mdir);
  writeFileSync(path.join(mdir, m.file), src.replace(m.from, m.to));
  jobs.push({ label: m.id, a: BASE, b: mdir, seed: SEEDS[0], n: MN });
}

const run = (j) => new Promise((resolve) => {
  const rep = path.join(dir, `${j.label}.json`);
  const args = [path.join(TOOL, 'replay.mjs'), '--old', j.a, '--new', j.b, '--seed', String(j.seed), '--n', String(j.n), '--out', rep, '--quiet', ...(j.coverage ? ['--coverage'] : []), ...(LIB ? ['--lib', LIB] : [])];
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

const summary = { base: BASE, lib: LIB || '/home/user/LinearViewer', n: N, mutantN: MN, seeds: SEEDS, checks: [], coverage: {} };
for (const seed of SEEDS) {
  const r = by[`identity-seed${seed}`];
  const rep = r.report;
  const ok = rep && !rep.fatal && rep.summary.differingRequests === 0 && Object.values(rep.exportsDiff).every(d => d.length === 0);
  summary.checks.push({ id: `identity-seed${seed}`, what: 'old vs an independent copy of old', pass: !!ok, requests: rep?.summary?.requests, perTier: rep?.summary?.perTier, differing: rep?.summary?.differingRequests, groups: (rep?.differences || []).map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: r.ms, error: rep?.fatal || (rep ? undefined : r.err) });
  if (rep?.coverage?.old) summary.coverage[`seed${seed}`] = Object.fromEntries(Object.entries(rep.coverage.old).map(([f, c]) => [f, { pct: c.pct, covered: c.coveredLines, executable: c.executableLines, uncovered: c.uncovered.map(u => `${u.line}: ${u.text}`) }]));
  if (seed === SEEDS[0] && rep) {
    summary.thinStatusLogPairs = rep.thinStatusLogPairs.filter(t => t.route !== 'UNMATCHED');
    summary.perRouteRequests = Object.fromEntries(Object.entries(rep.perRoute).map(([k, v]) => [k, v.requests]));
    summary.minPerRoute = Math.min(...Object.entries(rep.perRoute).filter(([k]) => k !== 'UNMATCHED').map(([, v]) => v.requests));
    summary.importSideEffects = rep.importSideEffects?.old;
  }
}
for (const [id, { m, occ }] of Object.entries(meta)) {
  if (occ !== 1) { summary.checks.push({ id, what: m.what, pass: false, error: `mutation site found ${occ} times (need 1)` }); continue; }
  const r = by[id];
  const rep = r.report;
  if (!rep || rep.fatal) { summary.checks.push({ id, what: m.what, pass: false, error: rep?.fatal || r.err }); continue; }
  const groups = rep.differences.map(g => ({ endpoint: g.endpoint, kind: g.kind, count: g.count }));
  const detected = groups.filter(g => m.expect.kinds.includes(g.kind) && m.expect.endpoints.includes(g.endpoint));
  const offTarget = groups.filter(g => !m.expect.endpoints.includes(g.endpoint));
  summary.checks.push({ id, what: m.what, pass: detected.length > 0 && offTarget.length === 0, differing: rep.summary.differingRequests, detectedIn: detected.map(g => `${g.kind} x${g.count}`), groups: groups.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), offTarget: offTarget.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), ms: r.ms });
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2));
rmSync(dir, { recursive: true, force: true });
for (const c of summary.checks) {
  process.stdout.write(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(20)} ${c.what}  differing=${c.differing ?? '-'}${c.detectedIn ? `  detected: ${c.detectedIn.join(', ')}` : ''}${c.error ? `  error: ${String(c.error).split('\n').slice(-3).join(' | ')}` : ''}\n`);
  if (!c.pass) for (const g of c.groups || []) process.stdout.write(`        ${g}\n`);
}
for (const [seed, files] of Object.entries(summary.coverage)) for (const [f, c] of Object.entries(files)) process.stdout.write(`coverage ${seed} ${f}: ${c.pct}% (${c.covered}/${c.executable}); uncovered: ${c.uncovered.map(u => u.split(':')[0]).join(', ') || 'none'}\n`);
process.stdout.write(`min requests per URL form: ${summary.minPerRoute}; thin (status, logEvent) pairs: ${summary.thinStatusLogPairs?.length ?? '?'}\n`);
process.stdout.write(`self-check report: ${OUT}\n`);
process.exit(summary.checks.every(c => c.pass) && Object.values(summary.coverage).every(fs => Object.values(fs).every(c => c.pct >= 95)) ? 0 : 1);
