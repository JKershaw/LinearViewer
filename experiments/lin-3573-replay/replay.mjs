#!/usr/bin/env node
// Old-vs-new replay of routes/proxy-writes.js + routes/proxy-rulings.js (LIN-3573 / LIN-3574).
//
//   node replay.mjs --repo <checkout> [--seed 1] [--n 3000] [--out report.json]
//        [--old-writes F] [--old-rulings F] [--new-writes F] [--new-rulings F]
//        [--mutant <id>] [--coverage] [--only <i>] [--quiet]
//
// Defaults: old = new = the base files stored beside this script (base/routes/*.js, committed
// verbatim). `.mjs` copies are generated at run time with the pinned prepare.mjs against
// the checkout given by --repo, so every copy shares that checkout's lib/ modules.
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import util from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { seed: 1, n: 3000, out: null, repo: null, mutant: null, coverage: false, only: null, quiet: false, timeoutMs: 90000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === '--seed') o.seed = Number(next());
    else if (a === '--n') o.n = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--repo') o.repo = path.resolve(next());
    else if (a === '--old-writes') o.oldWrites = path.resolve(next());
    else if (a === '--old-rulings') o.oldRulings = path.resolve(next());
    else if (a === '--new-writes') o.newWrites = path.resolve(next());
    else if (a === '--new-rulings') o.newRulings = path.resolve(next());
    else if (a === '--mutant') o.mutant = next();
    else if (a === '--coverage') o.coverage = true;
    else if (a === '--only') o.only = Number(next());
    else if (a === '--quiet') o.quiet = true;
    else throw new Error(`unknown arg ${a}`);
  }
  if (!o.repo) throw new Error('--repo <checkout> is required');
  o.oldWrites ||= path.join(TOOL, 'base/routes/proxy-writes.js');
  o.oldRulings ||= path.join(TOOL, 'base/routes/proxy-rulings.js');
  o.newWrites ||= o.oldWrites;
  o.newRulings ||= o.oldRulings;
  return o;
}

const opts = parseArgs(process.argv.slice(2));
process.env.NODE_ENV = 'test';                                     // composer's limiter is skipped under test
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

// ---- hermetic: loopback sockets only ----------------------------------------------------------
const socketEscapes = [];
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guarded(...args) {
  const o = typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) ? args[0] : { port: args[0], host: args[1] };
  const host = o?.host ?? o?.hostname;
  if (!(typeof o?.path === 'string' || host === undefined || host === '127.0.0.1' || host === '::1' || host === 'localhost')) {
    socketEscapes.push({ host, port: o?.port });
    throw new Error(`replay: blocked non-loopback connect to ${host}`);
  }
  return origConnect.apply(this, args);
};

// ---- clock FIRST (see util.installClock), then everything else ----------------------------------
const { installClock, mulberry32 } = await import('./lib/util.mjs');
const clock = installClock();

const { startCoverage, takeCoverage, lineCoverage } = await import('./lib/coverage.mjs');
const coverageSession = opts.coverage ? await startCoverage() : null;

const workDir = mkdtempSync(path.join(os.tmpdir(), 'lin3573-replay-'));
const { register } = await import('node:module');
const { MessageChannel } = await import('node:worker_threads');
const { prepareCopy } = await import('./lib/prepare.mjs');
const { MUTANTS } = await import('./lib/mutants.mjs');

const mutant = opts.mutant ? MUTANTS.find(m => m.id === opts.mutant) : null;
if (opts.mutant && !mutant) throw new Error(`unknown mutant ${opts.mutant}`);

// Run-time copies: one dir per file, because the pinned prepareCopy always writes <dest>/proxy-reads.mjs.
const copies = {};
const sources = { old: { writes: opts.oldWrites, rulings: opts.oldRulings }, new: { writes: opts.newWrites, rulings: opts.newRulings } };
for (const label of ['old', 'new']) {
  copies[label] = {};
  for (const which of ['writes', 'rulings']) {
    const transform = (label === 'new' && mutant && mutant.file === which) ? mutant.apply : null;
    copies[label][which] = prepareCopy(sources[label][which], path.join(workDir, `${label}-${which}`), opts.repo, transform);
  }
}

const ch = new MessageChannel();
const resolutions = [];
ch.port1.on('message', m => resolutions.push(m));
register(pathToFileURL(path.join(TOOL, 'lib/hooks.mjs')).href, import.meta.url, {
  data: { workDirUrl: pathToFileURL(workDir).href, repoParentUrl: pathToFileURL(path.join(opts.repo, 'routes/proxy.js')).href, port: ch.port2 },
  transferList: [ch.port2],
});
register(pathToFileURL(path.join(TOOL, 'lib/redirect-hook.mjs')).href, import.meta.url, {
  data: { map: { old: { writes: copies.old.writes.url, rulings: copies.old.rulings.url }, new: { writes: copies.new.writes.url, rulings: copies.new.rulings.url } } },
});

// ---- repo libraries -----------------------------------------------------------------------------
const L = (p) => import(pathToFileURL(path.join(opts.repo, p)).href);
const [errorsMod, pwe, refMod, dsStore, tdStore, digestMod, feedMod, asyncMod] = await Promise.all([
  L('lib/errors.js'), L('lib/partial-write-error.js'), L('lib/proxy-ref-resolver.js'), L('lib/dismissal-suggestions-store.js'),
  L('lib/task-decisions-store.js'), L('lib/digest-feedback.js'), L('lib/sessions-feed-cache.js'), L('lib/async-errors.js'),
]);
asyncMod.installAsyncErrorForwarding();
const libs = {
  clientErrorStatus: errorsMod.clientErrorStatus, clientErrorMessage: errorsMod.clientErrorMessage, jsonError: errorsMod.jsonError, serverError: errorsMod.serverError,
  PartialWriteError: pwe.PartialWriteError, RefResolutionError: refMod.RefResolutionError,
  DismissalSuggestionsStore: dsStore.DismissalSuggestionsStore, TaskDecisionsStore: tdStore.TaskDecisionsStore,
  digestFeedback: digestMod.digestFeedback, createSessionsFeedCache: feedMod.createSessionsFeedCache,
};

const { bootVariant, seedTaskDecisions, rulingsWorld, WS } = await import('./lib/world.mjs');
const { createGenerator, FORMS, FORM_KEYS, WRITE_FORMS } = await import('./lib/gen.mjs');
const { compareOutcomes, normalizeHeaders } = await import('./lib/compare.mjs');
const { blockReport } = await import('./lib/blocks.mjs');

// ---- capture console, unhandled errors, outbound fetch per active variant ------------------------
let active = null;
const realErr = (s) => process.stderr.write(s);
for (const level of ['log', 'error', 'warn', 'info', 'debug']) {
  console[level] = (...a) => { const msg = util.format(...a); if (active?.rec) active.rec.console.push({ level, msg }); else if (!opts.quiet) realErr(`[${level}] ${msg}\n`); };
}
process.on('unhandledRejection', (r) => { const info = r instanceof Error ? { name: r.name, message: r.message } : { thrown: String(r) }; if (active?.rec) { active.rec.unhandled.push(info); try { active.ctx?.res?.destroy(); } catch { /* */ } } else realErr(`[replay] unhandled outside a request: ${util.inspect(r)}\n`); });
process.on('uncaughtException', (e) => { if (active?.rec) { active.rec.unhandled.push({ name: e?.name, message: e?.message, uncaught: true }); try { active.ctx?.res?.destroy(); } catch { /* */ } } else { realErr(`[replay] uncaught outside a request: ${e?.stack}\n`); process.exit(4); } });
globalThis.fetch = (...a) => { active?.rec?.outbound.push({ url: String(a[0]?.url ?? a[0]) }); return Promise.reject(new TypeError('fetch blocked by replay')); };

// ---- boot both variants --------------------------------------------------------------------------
const base = { repo: opts.repo, libs, clock, exportName: null };
const composerUrl = (label) => pathToFileURL(path.join(opts.repo, 'routes/proxy.js')).href + `?variant=${label}`;
void composerUrl;
const variants = {};
for (const label of ['old', 'new']) {
  variants[label] = await bootVariant(label, { ...base, copies: copies[label] });
  await seedTaskDecisions(variants[label], clock);
  // deterministic scannedAt ordering for the seeded task rows
  const docs = variants[label].taskCollection._docs;
  docs.forEach((d, i) => { d.scannedAt = new Date(clock.t - (docs.length - i) * 60000); });
}

// ---- transport ---------------------------------------------------------------------------------
function send(port, sc) {
  return new Promise((resolve) => {
    const headers = { ...sc.headers };
    if (sc.body !== undefined) headers['content-length'] = Buffer.byteLength(sc.body);
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = http.request({ host: '127.0.0.1', port, method: sc.method, path: sc.path + (sc.query ? `?${sc.query}` : ''), headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => fin({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
      res.on('error', e => fin({ status: 'NO_RESPONSE', error: e.message, headers: {}, buf: Buffer.alloc(0) }));
    });
    const timer = setTimeout(() => req.destroy(new Error('replay timeout')), opts.timeoutMs);
    req.on('error', e => fin({ status: e.message === 'replay timeout' ? 'TIMEOUT' : `NO_RESPONSE`, error: e.message, headers: {}, buf: Buffer.alloc(0) }));
    if (sc.body !== undefined) req.write(sc.body);
    req.end();
  });
}
const decode = (r) => {
  if (r.buf.length === 0) return { __empty: true };
  const ct = String(r.headers['content-type'] || '');
  const txt = r.buf.toString('utf8');
  if (ct.includes('json')) { try { return JSON.parse(txt); } catch { return { __invalidJson: txt.slice(0, 300) }; } }
  return { __text: txt.slice(0, 300) };
};
const settle = async () => { for (let k = 0; k < 14; k++) await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 1)); };

async function runOne(v, sc) {
  v.ctx = { idx: sc.idx, script: sc.script, counts: {}, res: null };
  v.rec = { calls: [], console: [], unhandled: [], outbound: [] };
  active = v;
  Math.random = mulberry32(0x9e3779b9 ^ sc.idx);
  const r = await send(v.port(sc.mode), sc);
  await settle();
  const rec = v.rec;
  active = null; v.rec = null;
  return { status: r.status, transportError: r.error, headers: normalizeHeaders(r.headers), body: decode(r), calls: rec.calls, console: rec.console, unhandled: rec.unhandled, outbound: rec.outbound };
}

// ---- run ---------------------------------------------------------------------------------------
const taskRowId = tdStore.TaskDecisionsStore.buildId('99999999-0000-4000-8000-000000000001', 'a'.repeat(64));
const gen = createGenerator(opts.seed, { openTaskRowId: taskRowId });
const stats = {
  perForm: Object.fromEntries(FORM_KEYS.map(k => [k, { requests: 0, withSource: 0, sourceValues: {}, pairs: {}, expectedPairs: {}, diffs: 0 }])),
  tags: {},
};
const groups = new Map();
let diffRequests = 0; let total = 0;
const t0 = performance.now();
const only = [];
for (const sc of gen.all(opts.n)) {
  if (opts.only != null && sc.idx !== opts.only) { clock.t += sc.advance; continue; }
  clock.t += sc.advance;
  if (sc.script.rworld && typeof sc.script.rworld === 'string') sc.script.rworld = rulingsWorld(sc.script.rworld, clock.t);
  if (sc.resetCache) { variants.old.resetCache(); variants.new.resetCache(); }
  const o = await runOne(variants.old, sc);
  const n = await runOne(variants.new, sc);
  total++;
  const f = stats.perForm[sc.form];
  f.requests++;
  if (sc.source !== undefined) { f.withSource++; f.sourceValues[sc.source === '' ? '(empty)' : sc.source] = (f.sourceValues[sc.source === '' ? '(empty)' : sc.source] || 0) + 1; }
  const events = o.calls.filter(c => c.ch === 'event');
  const logged = events.length ? events[events.length - 1].args[0].status : 'n';
  const pair = `${o.status}/${logged}`;
  f.pairs[pair] = (f.pairs[pair] || 0) + 1;
  if (sc.expect) f.expectedPairs[sc.expect] = (f.expectedPairs[sc.expect] || 0) + 1;
  const tagKey = sc.tag.split('+')[0]; stats.tags[tagKey] = (stats.tags[tagKey] || 0) + 1;
  if (sc.expect && sc.expect !== pair && opts.only == null) { (stats.expectMismatch ||= []).length < 60 && stats.expectMismatch.push({ idx: sc.idx, tag: sc.tag, expected: sc.expect, observed: pair }); stats.expectMismatchCount = (stats.expectMismatchCount || 0) + 1; }
  if (o.outbound.length || n.outbound.length) stats.outboundRequests = (stats.outboundRequests || 0) + 1;
  if (o.unhandled.length || n.unhandled.length) stats.unhandledRequests = (stats.unhandledRequests || 0) + 1;
  if (o.status === 'TIMEOUT' || n.status === 'TIMEOUT' || String(o.status).startsWith('NO_RESPONSE') || String(n.status).startsWith('NO_RESPONSE')) stats.transportFailures = (stats.transportFailures || 0) + 1;
  const diffs = compareOutcomes(o, n);
  if (opts.only != null) only.push({ sc, old: o, new: n, diffs });
  if (diffs.length) {
    diffRequests++; f.diffs++;
    for (const d of diffs) {
      const key = `${sc.form}\u0000${d.kind}`;
      let g = groups.get(key);
      if (!g) { g = { form: sc.form, kind: d.kind, count: 0, requestIndexes: [], example: null }; groups.set(key, g); }
      g.count++;
      if (g.requestIndexes.length < 20) g.requestIndexes.push(sc.idx);
      if (!g.example) g.example = { idx: sc.idx, tag: sc.tag, request: { method: sc.method, path: sc.path, query: sc.query, auth: sc.headers.authorization }, detail: d.detail };
    }
  }
  if (!opts.quiet && total % 1000 === 0) realErr(`[replay] ${total} requests, ${diffRequests} differing\n`);
}
const elapsedMs = Math.round(performance.now() - t0);

// ---- coverage over the OLD copies -------------------------------------------------------------
let coverage = null;
if (coverageSession) {
  const cov = await takeCoverage(coverageSession);
  coverage = {};
  for (const label of ['old', 'new']) {
    coverage[label] = {};
    for (const which of ['writes', 'rulings']) {
      const copy = copies[label][which];
      const sc = cov.find(c => c.url === copy.url);
      if (!sc) { coverage[label][which] = { error: 'no coverage data' }; continue; }
      const src = readFileSync(copy.dest, 'utf8');
      const lc = lineCoverage(src, sc);
      const br = blockReport(src, sc, { min: 5 });
      coverage[label][which] = { source: sources[label][which], lines: { executable: lc.executableLines, covered: lc.coveredLines, uncovered: lc.uncovered, partial: lc.partial.length }, blocks: { total: br.totalBlocks, underMin: br.underMin.length, zero: br.zero.length }, underMinBlocks: br.underMin.map(b => ({ fn: b.fn, line: b.startLine, endLine: b.endLine, count: b.count, isFunction: b.isFunctionRange, snippet: b.snippet })) };
    }
  }
}

await Promise.all(Object.values(variants).map(v => v.close()));
ch.port1.close();

const gitHash = (f) => { try { return execFileSync('git', ['hash-object', f], { encoding: 'utf8' }).trim(); } catch { return null; } };
const report = {
  tool: 'lin-3573 replay', node: process.version, repo: opts.repo, seed: opts.seed, n: opts.n,
  mutant: mutant ? { id: mutant.id, what: mutant.what, expect: mutant.expect } : null,
  sources: { old: { writes: [sources.old.writes, gitHash(sources.old.writes)], rulings: [sources.old.rulings, gitHash(sources.old.rulings)] }, new: { writes: [sources.new.writes, gitHash(sources.new.writes)], rulings: [sources.new.rulings, gitHash(sources.new.rulings)] } },
  startClock: new Date(clock.RealDate.UTC(2026, 9, 16, 10, 0, 0)).toISOString(),
  summary: { requests: total, differingRequests: diffRequests, groups: groups.size, elapsedMs, socketEscapes: socketEscapes.length, expectMismatches: stats.expectMismatchCount || 0, outboundRequests: stats.outboundRequests || 0, unhandledRequests: stats.unhandledRequests || 0, transportFailures: stats.transportFailures || 0 },
  perForm: stats.perForm, tags: stats.tags, expectMismatch: stats.expectMismatch || [],
  differences: [...groups.values()].sort((a, b) => b.count - a.count),
  coverage, only: opts.only != null ? only : undefined,
};
const outFile = opts.out ? path.resolve(opts.out) : path.join(process.cwd(), 'report.json');
writeFileSync(outFile, JSON.stringify(report, null, 1));
rmSync(workDir, { recursive: true, force: true });
const out = (s) => process.stdout.write(s + '\n');
out(`replay: ${total} requests (seed ${opts.seed}) in ${elapsedMs} ms${mutant ? `  [mutant ${mutant.id}]` : ''}`);
out(`differing requests: ${diffRequests}; groups: ${groups.size}; expect-mismatches: ${report.summary.expectMismatches}`);
for (const g of report.differences.slice(0, 30)) out(`  ${String(g.count).padStart(5)}  ${g.form}  [${g.kind}]  e.g. #${g.example.idx} ${g.example.tag}`);
out(`report: ${outFile}`);
process.exit(0);
