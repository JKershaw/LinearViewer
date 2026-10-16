#!/usr/bin/env node
// Behavioural replay of two versions of Harbour's routes/proxy-reads.js.
//
//   node replay.mjs <oldRoutesFile> <newRoutesFile> [--seed 1] [--n 3000] [--out report.json]
//   node replay.mjs --self-check [baseRoutesFile] [--seed 1] [--n 3000] [--out selfcheck.json]
//
// See README.md.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import util from 'node:util';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { seed: 1, n: 3000, out: null, repo: '/home/user/LinearViewer', timeoutMs: 3000, only: null, keepWork: false, selfCheck: false, quiet: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--seed') opts.seed = Number(next());
    else if (a === '--n') opts.n = Number(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--repo') opts.repo = path.resolve(next());
    else if (a === '--timeout-ms') opts.timeoutMs = Number(next());
    else if (a === '--only') opts.only = Number(next());
    else if (a === '--keep-work') opts.keepWork = true;
    else if (a === '--self-check') opts.selfCheck = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '-h' || a === '--help') { process.stdout.write(readFileSync(path.join(TOOL_DIR, 'README.md'), 'utf8')); process.exit(0); }
    else opts.positional.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const out = (s) => process.stdout.write(s + '\n');

if (opts.selfCheck) {
  await runSelfCheck(opts);
} else {
  if (opts.positional.length !== 2) {
    process.stderr.write('usage: node replay.mjs <oldRoutesFile> <newRoutesFile> [--seed 1] [--n 3000] [--out report.json]\n       node replay.mjs --self-check [baseRoutesFile]\n');
    process.exit(2);
  }
  const report = await runReplay(path.resolve(opts.positional[0]), path.resolve(opts.positional[1]), opts);
  process.exit(report.fatal ? 3 : 0);
}

// ===========================================================================
// Replay
// ===========================================================================
async function runReplay(oldFile, newFile, opts) {
  // ---- 1. hermetic process: no proxy env, loopback-only sockets, frozen clock
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[k];
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const socketEscapes = [];
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const o = typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) ? args[0] : Array.isArray(args[0]) ? args[0][0] : { port: args[0], host: args[1] };
    const host = o?.host ?? o?.hostname;
    const isPipe = typeof o?.path === 'string';
    const loop = isPipe || host === undefined || host === '127.0.0.1' || host === '::1' || host === 'localhost';
    if (!loop) {
      socketEscapes.push({ host, port: o?.port });
      throw new Error(`replay: blocked non-loopback connect to ${host}:${o?.port}`);
    }
    return origConnect.apply(this, args);
  };

  const { FIXED_NOW, generateScenario, mulberry32 } = await import('./lib/gen.mjs');
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED_NOW); else super(...a); }
    static now() { return FIXED_NOW; }
  }
  globalThis.Date = FrozenDate;

  const { startCoverage, takeCoverage, lineCoverage } = await import('./lib/coverage.mjs');
  const coverageSession = await startCoverage();

  // ---- 2. work dir + module hooks
  const workDir = path.join(TOOL_DIR, 'work', `run-${process.pid}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const { register } = await import('node:module');
  const { MessageChannel } = await import('node:worker_threads');
  const ch = new MessageChannel();
  const resolutions = [];
  ch.port1.on('message', (m) => resolutions.push(m));
  register(pathToFileURL(path.join(TOOL_DIR, 'lib/hooks.mjs')).href, import.meta.url, {
    data: { workDirUrl: pathToFileURL(workDir).href, repoParentUrl: pathToFileURL(path.join(opts.repo, 'routes/proxy-reads.js')).href, port: ch.port2 },
    transferList: [ch.port2],
  });

  const { prepareCopy } = await import('./lib/prepare.mjs');
  const fakes = await import('./lib/fakes.mjs');
  const { compareOutcomes, pathPattern } = await import('./lib/compare.mjs');

  // ---- console capture (handler console output is recorded per request)
  let active = null; // holder currently serving a request
  const realStderr = (s) => process.stderr.write(s);
  for (const level of ['log', 'error', 'warn', 'info', 'debug']) {
    console[level] = (...args) => {
      const msg = util.format(...args);
      if (active?.ctx) active.ctx.rec.console.push({ level, msg });
      else if (active?.importCensus) active.importCensus.console.push({ level, msg });
      else if (!opts.quiet) realStderr(`[${level}] ${msg}\n`);
    };
  }

  process.on('unhandledRejection', (reason) => {
    const info = reason instanceof Error ? { name: reason.name, message: reason.message } : { thrown: String(reason) };
    if (active?.ctx) {
      active.ctx.rec.unhandled.push(info);
      const res = active.ctx.res;
      if (res && !res.headersSent) res.destroy();
    } else if (active?.importCensus) active.importCensus.unhandled.push(info);
    else realStderr(`[replay] unhandled rejection outside a request: ${util.inspect(reason)}\n`);
  });
  process.on('uncaughtException', (err) => {
    const info = { name: err?.name, message: err?.message, uncaught: true };
    if (active?.ctx) {
      active.ctx.rec.unhandled.push(info);
      const res = active.ctx.res;
      if (res && !res.headersSent) res.destroy();
    } else {
      realStderr(`[replay] uncaught exception outside a request: ${err?.stack}\n`);
      process.exit(4);
    }
  });

  // ---- 3. import both copies (census of import-time side effects)
  const expressMod = await import(pathToFileURL(path.join(opts.repo, 'node_modules/express/index.js')).href);
  const express = expressMod.default;

  async function importCopy(label, file) {
    const copy = prepareCopy(file, path.join(workDir, label), opts.repo);
    const census = { console: [], unhandled: [], envReads: [], newGlobals: [], newActiveResources: [], socketEscapes: [], modulesFirstLoaded: [], importRewrites: copy.rewrites };
    const holder = { ctx: null, importCensus: census };
    active = holder;
    const realEnv = process.env;
    const reads = new Set();
    process.env = new Proxy(realEnv, { get(t, k) { if (typeof k === 'string') reads.add(k); return Reflect.get(t, k); } });
    const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));
    const resBefore = process.getActiveResourcesInfo();
    const escBefore = socketEscapes.length;
    const resolBefore = resolutions.length;
    let mod;
    let importError = null;
    try {
      mod = await import(copy.url);
    } catch (e) {
      importError = { name: e.name, message: e.message };
    } finally {
      process.env = realEnv;
    }
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 20));
    // WATCH_REPORT_DEPENDENCIES is read by Node's own ESM loader on every import, not by the copy.
    census.envReads = [...reads].filter(k => k !== 'WATCH_REPORT_DEPENDENCIES').sort();
    census.newGlobals = Object.getOwnPropertyNames(globalThis).filter(k => !globalsBefore.has(k));
    const resAfter = process.getActiveResourcesInfo();
    const tally = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    const tb = tally(resBefore);
    const ta = tally(resAfter);
    census.newActiveResources = Object.entries(ta).filter(([k, v]) => v > (tb[k] || 0)).map(([k, v]) => `${k} x${v - (tb[k] || 0)}`);
    census.socketEscapes = socketEscapes.slice(escBefore);
    const seenBefore = new Set(resolutions.slice(0, resolBefore).map(r => r.url));
    census.modulesFirstLoaded = [...new Set(resolutions.slice(resolBefore).map(r => r.url))].filter(u => !seenBefore.has(u) && u !== copy.url).map(u => u.replace('file://' + opts.repo, '<repo>')).sort();
    census.bareOrUnrewrittenSpecifiers = resolutions.slice(resolBefore).filter(r => r.parent === copy.url && r.via === 'hook').map(r => r.specifier);
    holder.importCensus = null;
    active = null;
    const factory = mod?.createReadRoutes;
    if (!importError && typeof factory !== 'function') importError = { name: 'MissingExport', message: 'module does not export createReadRoutes' };
    return { label, file, copy, mod, factory, census, importError, holder };
  }

  const sides = [await importCopy('old', oldFile), await importCopy('new', newFile)];
  const libs = await fakes.loadRepoLibs(opts.repo);
  const fakeFetchBySide = {};
  const dispatcherFetch = (...args) => {
    if (!active) return Promise.reject(new TypeError('fetch failed (no active request)'));
    return fakeFetchBySide[active.label](...args);
  };
  libs.setProxyFetchImpl(dispatcherFetch);
  globalThis.fetch = dispatcherFetch;

  const report = {
    tool: 'proxy-reads behavioural replay',
    old: oldFile, new: newFile, repo: opts.repo, seed: opts.seed, n: opts.n, frozenNow: new RealDate(FIXED_NOW).toISOString(),
    importSideEffects: {}, fatal: null,
  };
  for (const s of sides) report.importSideEffects[s.label] = { ...s.census, importError: s.importError };
  if (sides.some(s => s.importError)) {
    report.fatal = 'import failed: ' + sides.filter(s => s.importError).map(s => `${s.label}: ${s.importError.message}`).join('; ');
  }

  // ---- 4. mount each router on its own app, bound to 127.0.0.1:0
  for (const s of sides) {
    if (s.importError) continue;
    s.holder.label = s.label;
    fakeFetchBySide[s.label] = fakes.makeFakeFetch(s.holder, libs);
    const deps = fakes.createFakeDeps(s.holder, libs);
    let router;
    try {
      router = s.factory(deps);
    } catch (e) {
      report.fatal = `${s.label}: createReadRoutes threw: ${e.message}`;
      continue;
    }
    const app = express();
    app.use((req, res, next) => { if (s.holder.ctx) s.holder.ctx.res = res; next(); });
    app.use(router);
    // Uniform error handler (replaces finalhandler's stack-bearing HTML page).
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      s.holder.ctx?.rec.expressErrors.push({ name: err?.name, message: err?.message, status: err?.status ?? err?.statusCode });
      if (res.headersSent) return res.destroy();
      res.status(err?.status || err?.statusCode || 500).json({ __expressError: err?.message });
    });
    s.server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
    s.port = s.server.address().port;
  }

  function send(port, sc) {
    return new Promise((resolve) => {
      const headers = {};
      if (sc.auth.authorization !== undefined) headers.authorization = sc.auth.authorization;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      const req = http.request({ host: '127.0.0.1', port, method: sc.method, path: sc.path, headers, agent: false }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
        res.on('error', (e) => done({ status: 'NO_RESPONSE', error: e.message, headers: {}, buf: Buffer.alloc(0) }));
      });
      const timer = setTimeout(() => { req.destroy(new Error('replay timeout')); }, opts.timeoutMs);
      req.on('error', (e) => done({ status: e.message === 'replay timeout' ? 'TIMEOUT' : 'NO_RESPONSE', error: e.message, headers: {}, buf: Buffer.alloc(0) }));
      req.end();
    });
  }

  function decodeBody(r) {
    const ct = String(r.headers['content-type'] || '');
    if (r.buf.length === 0) return { __empty: true };
    if (ct.includes('json')) {
      try { return JSON.parse(r.buf.toString('utf8')); } catch { return { __invalidJson: r.buf.toString('utf8').slice(0, 500) }; }
    }
    if (ct.startsWith('text/')) return { __text: r.buf.toString('utf8').slice(0, 2000) };
    return { __bytes: r.buf.length, sha256: crypto.createHash('sha256').update(r.buf).digest('hex') };
  }

  async function runOne(side, sc) {
    const ctx = fakes.newContext(sc, libs);
    side.holder.ctx = ctx;
    active = side.holder;
    Math.random = mulberry32(sc.randomSeed);
    // Egress transport: the proxy-fetch override (default) or, when the scenario
    // says so, no override -> the route falls back to globalThis.fetch (also fake).
    libs.setProxyFetchImpl(sc.fetchViaGlobal ? null : dispatcherFetch);
    const r = await send(side.port, sc);
    // drain fire-and-forget work (logEvent → recordEvent) into THIS request's recorder
    for (let k = 0; k < 3; k++) await new Promise(res => setImmediate(res));
    active = null;
    const headers = {};
    for (const [k, v] of Object.entries(r.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    return { status: r.status, transportError: r.error, headers, body: decodeBody(r), calls: ctx.rec };
  }

  // ---- 5. replay
  const groups = new Map();
  const perEndpoint = {};
  let diffRequests = 0;
  const indices = opts.only != null ? [opts.only] : Array.from({ length: opts.n }, (_, i) => i);
  const t0 = performance.now();
  const onlyDetail = [];
  if (!report.fatal) {
    for (const i of indices) {
      const sc = generateScenario(opts.seed, i);
      const o = await runOne(sides[0], sc);
      const nn = await runOne(sides[1], sc);
      const ep = (perEndpoint[sc.routeKey] ||= { requests: 0, diffRequests: 0, oldStatus: {}, newStatus: {} });
      ep.requests++;
      ep.oldStatus[o.status] = (ep.oldStatus[o.status] || 0) + 1;
      ep.newStatus[nn.status] = (ep.newStatus[nn.status] || 0) + 1;
      const diffs = compareOutcomes(o, nn);
      if (opts.only != null) onlyDetail.push({ scenario: sc, old: o, new: nn, diffs });
      if (diffs.length) {
        diffRequests++;
        ep.diffRequests++;
        for (const d of diffs) {
          const key = `${sc.routeKey}\u0000${d.kind}`;
          let gEntry = groups.get(key);
          if (!gEntry) {
            gEntry = { endpoint: sc.routeKey, kind: d.kind, count: 0, requestIndexes: [], bodyPaths: {}, example: null };
            groups.set(key, gEntry);
          }
          gEntry.count++;
          if (gEntry.requestIndexes.length < 25) gEntry.requestIndexes.push(i);
          if (d.kind === 'body') for (const p of d.detail) gEntry.bodyPaths[pathPattern(p.path)] = (gEntry.bodyPaths[pathPattern(p.path)] || 0) + 1;
          if (!gEntry.example) {
            gEntry.example = {
              requestIndex: i,
              request: { method: sc.method, path: sc.path, authorization: sc.auth.authorization ?? null },
              difference: trim(d.detail),
              old: summarize(o),
              new: summarize(nn),
              scenario: trim(sc),
            };
          }
        }
      }
      if (!opts.quiet && (i + 1) % 500 === 0) realStderr(`[replay] ${i + 1}/${indices.length} requests, ${diffRequests} differing\n`);
    }
  }
  const elapsedMs = Math.round(performance.now() - t0);

  // ---- 6. coverage of each copy
  const cov = await takeCoverage(coverageSession);
  report.coverage = {};
  for (const s of sides) {
    const sc = cov.find(c => c.url === s.copy.url);
    if (!sc) { report.coverage[s.label] = { error: 'no coverage data (import failed?)' }; continue; }
    const lc = lineCoverage(readFileSync(s.copy.dest, 'utf8'), sc);
    report.coverage[s.label] = { file: s.file, ...lc };
  }

  for (const s of sides) if (s.server) await new Promise(r => s.server.close(r));
  ch.port1.close();

  report.summary = {
    requests: indices.length,
    differingRequests: diffRequests,
    groups: groups.size,
    elapsedMs,
    socketEscapesDuringReplay: socketEscapes.length,
  };
  report.perEndpoint = perEndpoint;
  report.differences = [...groups.values()].sort((a, b) => b.count - a.count);
  if (opts.only != null) report.onlyDetail = onlyDetail;

  const outFile = opts.out ? path.resolve(opts.out) : path.join(process.cwd(), 'report.json');
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  if (!opts.keepWork) rmSync(workDir, { recursive: true, force: true });

  // ---- 7. console summary
  out(`replay: ${report.summary.requests} requests (seed ${opts.seed}) in ${elapsedMs} ms`);
  if (report.fatal) out(`FATAL: ${report.fatal}`);
  out(`differing requests: ${diffRequests}; difference groups: ${groups.size}`);
  for (const gEntry of report.differences.slice(0, 40)) out(`  ${String(gEntry.count).padStart(5)}  ${gEntry.endpoint}  [${gEntry.kind}]  e.g. #${gEntry.example.requestIndex} ${gEntry.example.request.path.slice(0, 80)}`);
  if (report.differences.length > 40) out(`  … ${report.differences.length - 40} more groups in the report`);
  for (const s of sides) {
    const c = report.coverage[s.label];
    if (c?.pct !== undefined) out(`coverage ${s.label}: ${c.pct}% lines (${c.coveredLines}/${c.executableLines}); uncovered: ${c.uncovered.map(u => u.line).join(', ') || 'none'}`);
  }
  for (const s of sides) {
    const ce = report.importSideEffects[s.label];
    out(`import ${s.label}: envReads=[${ce.envReads.join(',')}] newGlobals=[${ce.newGlobals.join(',')}] newResources=[${ce.newActiveResources.join(',')}] console=${ce.console.length} sockets=${ce.socketEscapes.length} firstLoaded=${ce.modulesFirstLoaded.length} modules`);
  }
  if (socketEscapes.length) out(`WARNING: ${socketEscapes.length} non-loopback socket attempts were blocked`);
  out(`report: ${outFile}`);
  return report;
}

function summarize(o) {
  return trim({ status: o.status, transportError: o.transportError, headers: o.headers, body: o.body, calls: o.calls });
}

function trim(v, depth = 0) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + `…(+${v.length - 300})`;
    if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
    return v;
  }
  if (depth > 10) return '…';
  if (Array.isArray(v)) {
    const head = v.slice(0, 6).map(x => trim(x, depth + 1));
    if (v.length > 6) head.push(`…(+${v.length - 6} more)`);
    return head;
  }
  const outObj = {};
  for (const k of Object.keys(v)) outObj[k] = trim(v[k], depth + 1);
  return outObj;
}

// ===========================================================================
// Self-check
// ===========================================================================
async function runSelfCheck(opts) {
  const base = path.resolve(opts.positional[0] || path.join(opts.repo, 'routes/proxy-reads.js'));
  const dir = path.join(TOOL_DIR, 'work', `selfcheck-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(base, 'utf8');

  const MUTANTS = [
    {
      id: 'a-status', what: 'change one status code (cycle-detail not-found 404 -> 410)',
      from: "return notFound.json(res, 'Cycle not found');", to: "return jsonError(res, 410, 'Cycle not found');",
      expect: { kinds: ['status'], endpoints: ['/api/proxy/cycles/:cycleId', '/api/proxy/cycle/:cycleId'] },
    },
    {
      id: 'b-field', what: 'drop one response field (/teams `truncated`)',
      from: 'res.json({ teams, truncated: !!teams.truncated });', to: 'res.json({ teams });',
      expect: { kinds: ['body'], endpoints: ['/api/proxy/teams'] },
    },
    {
      id: 'c-provider-arg', what: 'change one provider call argument (/search first: 50 -> 49)',
      from: 'provider.search(token, query, { first: 50 })', to: 'provider.search(token, query, { first: 49 })',
      expect: { kinds: ['providerCalls'], endpoints: ['/api/proxy/search'] },
    },
    {
      id: 'd-logEvent', what: 'remove one logEvent call (/me success)',
      from: "logEvent(req, '/api/proxy/me', 200);", to: '',
      expect: { kinds: ['logEvent'], endpoints: ['/api/proxy/me'] },
    },
  ];

  const runs = [];
  const child = (label, a, b) => {
    const rep = path.join(dir, `${label}.json`);
    const args = [path.join(TOOL_DIR, 'replay.mjs'), a, b, '--seed', String(opts.seed), '--n', String(opts.n), '--out', rep, '--repo', opts.repo, '--quiet'];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (!existsSync(rep)) return { label, error: (r.stderr || r.stdout || '').slice(-2000) };
    return { label, report: JSON.parse(readFileSync(rep, 'utf8')), stdout: r.stdout };
  };

  out(`self-check on ${base} (seed ${opts.seed}, n ${opts.n})`);
  const ident = child('identity', base, base);
  runs.push(ident);
  const results = { base, seed: opts.seed, n: opts.n, checks: [] };
  if (ident.error) {
    results.checks.push({ id: 'identity', pass: false, error: ident.error });
  } else {
    const r = ident.report;
    results.checks.push({ id: 'identity', what: 'old vs old (two independent copies)', pass: r.summary.differingRequests === 0 && !r.fatal, differingRequests: r.summary.differingRequests, groups: r.differences.map(g => `${g.endpoint} [${g.kind}] x${g.count}`) });
    results.coverage = r.coverage.old;
    results.perEndpoint = r.perEndpoint;
    results.importSideEffects = r.importSideEffects.old;
    results.elapsedMs = r.summary.elapsedMs;
  }

  for (const m of MUTANTS) {
    if (!src.includes(m.from)) { results.checks.push({ id: m.id, what: m.what, pass: null, note: 'mutation site not found in base file (not applicable)' }); continue; }
    const mf = path.join(dir, `${m.id}.js`);
    writeFileSync(mf, src.replace(m.from, m.to));
    const run = child(m.id, base, mf);
    if (run.error) { results.checks.push({ id: m.id, what: m.what, pass: false, error: run.error }); continue; }
    const r = run.report;
    const groups = r.differences.map(g => ({ endpoint: g.endpoint, kind: g.kind, count: g.count }));
    const detected = groups.some(g => m.expect.kinds.includes(g.kind) && m.expect.endpoints.includes(g.endpoint));
    const offTarget = groups.filter(g => !m.expect.endpoints.includes(g.endpoint));
    results.checks.push({
      id: m.id, what: m.what, pass: detected && offTarget.length === 0,
      detected, differingRequests: r.summary.differingRequests,
      groups: groups.map(g => `${g.endpoint} [${g.kind}] x${g.count}`),
      offTargetGroups: offTarget.map(g => `${g.endpoint} [${g.kind}] x${g.count}`),
      example: r.differences[0]?.example ? { request: r.differences[0].example.request, difference: r.differences[0].example.difference } : null,
    });
  }

  const outFile = opts.out ? path.resolve(opts.out) : path.join(process.cwd(), 'selfcheck.json');
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  if (!opts.keepWork) rmSync(dir, { recursive: true, force: true });

  for (const c of results.checks) {
    const verdict = c.pass === null ? 'N/A ' : c.pass ? 'PASS' : 'FAIL';
    out(`${verdict}  ${c.id.padEnd(15)} ${c.what || ''}  differing=${c.differingRequests ?? '-'}${c.error ? '  error: ' + c.error.split('\n').slice(-3).join(' | ') : ''}`);
    for (const g of c.groups || []) out(`        ${g}`);
  }
  if (results.coverage) {
    const c = results.coverage;
    out(`coverage (base copy): ${c.pct}% lines (${c.coveredLines}/${c.executableLines})`);
    out(`uncovered lines: ${c.uncovered.map(u => `${u.line}: ${u.text}`).join('\n                 ') || 'none'}`);
    if (c.partial.length) out(`partially executed lines: ${c.partial.map(u => u.line).join(', ')}`);
  }
  out(`self-check report: ${outFile}`);
  const allPass = results.checks.every(c => c.pass !== false);
  process.exit(allPass ? 0 : 1);
}
