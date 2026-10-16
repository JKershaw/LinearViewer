#!/usr/bin/env node
// Behavioural replay of two versions of Harbour's write-side proxy routers:
// routes/proxy-writes.js, routes/proxy-rulings.js, routes/proxy-tokens-admin.js.
//
//   node replay.mjs --old <dirOrFiles> --new <dirOrFiles> [--files writes,rulings,tokens-admin]
//                   [--seed 1] [--n 3000] [--out report.json]
//   node replay.mjs --self-check [--base <dir>] [--seed 1] [--n 3000] [--out selfcheck.json]
//
// See README.md.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import util from 'node:util';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = path.join(TOOL_DIR, 'pinned', 'origin-main');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    old: null, new: null, files: null, seed: 1, n: 3000, out: null, repo: '/home/user/LinearViewer', timeoutMs: 5000,
    only: null, keepWork: false, selfCheck: false, base: DEFAULT_BASE, quiet: false, jobs: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--old') opts.old = next();
    else if (a === '--new') opts.new = next();
    else if (a === '--files') opts.files = next();
    else if (a === '--seed') opts.seed = Number(next());
    else if (a === '--n') opts.n = Number(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--repo') opts.repo = path.resolve(next());
    else if (a === '--timeout-ms') opts.timeoutMs = Number(next());
    else if (a === '--only') opts.only = Number(next());
    else if (a === '--keep-work') opts.keepWork = true;
    else if (a === '--self-check') opts.selfCheck = true;
    else if (a === '--base') opts.base = path.resolve(next());
    else if (a === '--jobs') opts.jobs = Number(next());
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '-h' || a === '--help') { process.stdout.write(readFileSync(path.join(TOOL_DIR, 'README.md'), 'utf8')); process.exit(0); }
    else { process.stderr.write(`unknown argument: ${a}\n`); process.exit(2); }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const out = (s) => process.stdout.write(s + '\n');
const { SLOTS, SLOT_NAMES } = await import('./lib/routers.mjs');

function pickSlots(spec) {
  const names = spec ? spec.split(',').map(s => s.trim()).filter(Boolean) : SLOT_NAMES;
  for (const n of names) if (!SLOTS[n]) { process.stderr.write(`unknown --files entry: ${n} (known: ${SLOT_NAMES.join(', ')})\n`); process.exit(2); }
  return names;
}

if (opts.selfCheck) {
  await runSelfCheck(opts);
} else {
  if (!opts.old || !opts.new) {
    process.stderr.write('usage: node replay.mjs --old <dirOrFiles> --new <dirOrFiles> [--files writes,rulings,tokens-admin] [--seed 1] [--n 3000] [--out report.json]\n       node replay.mjs --self-check [--base <dir>]\n');
    process.exit(2);
  }
  const report = await runReplay(opts);
  process.exit(report.fatal ? 3 : 0);
}

// ===========================================================================
// Replay
// ===========================================================================
async function runReplay(opts) {
  const slotNames = pickSlots(opts.files);
  // ---- 1. hermetic process: no proxy env, loopback-only sockets, frozen clock
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[k];
  process.env.NODE_ENV = 'test';
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

  const { FIXED_NOW, mulberry32, snap } = await import('./lib/common.mjs');
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED_NOW); else super(...a); }
    static now() { return FIXED_NOW; }
  }
  globalThis.Date = FrozenDate;

  const { startCoverage, takeCoverage, lineCoverage } = await import('./lib/coverage.mjs');
  const coverageSession = await startCoverage();

  // randomUUID (e.g. lib/proxy-dedupe.js's generation tags) drawn from the
  // per-request seeded Math.random, so both sides mint the same tags.
  const cryptoMod = (await import('node:module')).createRequire(import.meta.url)('node:crypto');
  cryptoMod.randomUUID = () => {
    const h = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  (await import('node:module')).syncBuiltinESMExports();

  // ---- 2. production error plumbing BEFORE any router exists
  const repoUrl = (p) => pathToFileURL(path.join(opts.repo, p)).href;
  const { installAsyncErrorForwarding } = await import(repoUrl('lib/async-errors.js'));
  installAsyncErrorForwarding();
  const express = (await import(repoUrl('node_modules/express/index.js'))).default;
  const errorsLib = await import(repoUrl('lib/errors.js'));

  // ---- 3. sides: resolve inputs, lay out work trees, register the hook
  const { resolveSide, layoutSide } = await import('./lib/prepare.mjs');
  const wanted = Object.fromEntries(slotNames.map(n => [n, SLOTS[n]]));
  const workDir = path.join(TOOL_DIR, 'work', `run-${process.pid}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const report = { tool: 'proxy write-side behavioural replay', repo: opts.repo, seed: opts.seed, n: opts.n, frozenNow: new RealDate(FIXED_NOW).toISOString(), fatal: null };
  const sides = [];
  for (const [label, spec] of [['old', opts.old], ['new', opts.new]]) {
    let side;
    try { side = resolveSide(spec, wanted); } catch (e) { report.fatal = `${label}: ${e.message}`; break; }
    if (side.missing.length) { report.fatal = `${label}: no file for ${side.missing.join(', ')} in ${spec}`; break; }
    sides.push({ ...layoutSide(label, workDir, side), spec });
  }
  report.old = sides[0]?.copies && Object.fromEntries(Object.entries(sides[0].copies).map(([k, v]) => [k, v.src]));
  report.new = sides[1]?.copies && Object.fromEntries(Object.entries(sides[1].copies).map(([k, v]) => [k, v.src]));
  if (report.fatal) return finish(report);

  const { register } = await import('node:module');
  const { MessageChannel } = await import('node:worker_threads');
  const ch = new MessageChannel();
  const resolutions = [];
  ch.port1.on('message', (m) => resolutions.push(m));
  ch.port1.unref();
  register(pathToFileURL(path.join(TOOL_DIR, 'lib/hooks.mjs')).href, import.meta.url, {
    data: { sides: sides.map(s => ({ label: s.label, workRootUrl: s.workRootUrl, workRoutesPath: s.workRoutesPath, srcDirs: s.srcDirs })), repoRoutes: path.join(opts.repo, 'routes'), port: ch.port2 },
    transferList: [ch.port2],
  });

  const fakes = await import('./lib/fakes.mjs');
  const { compareOutcomes, pathPattern, diffPaths, canonical } = await import('./lib/compare.mjs');

  // ---- console capture
  let active = null;
  const realStderr = (s) => process.stderr.write(s);
  // Stack frames carry per-side work paths, so they are stripped. Shared lib
  // modules that warn ONCE per process (pipeline-loops' _warnMalformedOnce)
  // would fire for whichever side runs first, so those lines are kept apart
  // (rec.libConsole, not compared).
  const LIB_WARN_ONCE = /^pipeline-loops: skipping malformed/;
  for (const level of ['log', 'error', 'warn', 'info', 'debug']) {
    console[level] = (...args) => {
      const msg = util.format(...args).replace(/\n\s+at .*/g, '');
      if (active?.ctx && LIB_WARN_ONCE.test(msg)) (active.ctx.rec.libConsole ||= []).push({ level, msg });
      else if (active?.ctx) active.ctx.rec.console.push({ level, msg });
      else if (active?.importCensus) active.importCensus.console.push({ level, msg });
      else if (!opts.quiet) realStderr(`[${level}] ${msg}\n`);
    };
  }
  const onAsyncFault = (info) => {
    if (active?.ctx) {
      active.ctx.rec.unhandled.push(info);
      const res = active.ctx.res;
      if (res && !res.headersSent) res.destroy();
      return true;
    }
    if (active?.importCensus) { active.importCensus.unhandled.push(info); return true; }
    return false;
  };
  process.on('unhandledRejection', (reason) => {
    const info = reason instanceof Error ? { name: reason.name, message: reason.message } : { thrown: String(reason) };
    if (!onAsyncFault(info)) realStderr(`[replay] unhandled rejection outside a request: ${util.inspect(reason)}\n`);
  });
  process.on('uncaughtException', (err) => {
    if (!onAsyncFault({ name: err?.name, message: err?.message, uncaught: true })) {
      realStderr(`[replay] uncaught exception outside a request: ${err?.stack}\n`);
      process.exit(4);
    }
  });

  // Egress: none of these routers should fetch; any fetch is recorded and refused.
  globalThis.fetch = async (url, init) => {
    if (active?.ctx) active.ctx.rec.fetch.push({ url: String(url), init: snap(init) });
    throw new TypeError('fetch failed (replay: egress disabled)');
  };

  // ---- 4. import every copy (census of import-time side effects)
  async function importCopy(side, slot) {
    const copy = side.copies[slot];
    const census = { console: [], unhandled: [], envReads: [], newGlobals: [], newActiveResources: [], socketEscapes: [], modulesFirstLoaded: [], sideResolutions: [] };
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
    try { mod = await import(copy.url); } catch (e) { importError = { name: e.name, message: e.message }; } finally { process.env = realEnv; }
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 20));
    census.envReads = [...reads].filter(k => k !== 'WATCH_REPORT_DEPENDENCIES').sort();
    census.newGlobals = Object.getOwnPropertyNames(globalThis).filter(k => !globalsBefore.has(k));
    const tally = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    const tb = tally(resBefore);
    const ta = tally(process.getActiveResourcesInfo());
    census.newActiveResources = Object.entries(ta).filter(([k, v]) => v > (tb[k] || 0)).map(([k, v]) => `${k} x${v - (tb[k] || 0)}`);
    census.socketEscapes = socketEscapes.slice(escBefore);
    const seenBefore = new Set(resolutions.slice(0, resolBefore).map(r => r.url));
    const mine = resolutions.slice(resolBefore);
    census.modulesFirstLoaded = [...new Set(mine.map(r => r.url))].filter(u => !seenBefore.has(u) && u !== copy.url)
      .map(u => u.replace('file://' + opts.repo, '<repo>').replace(pathToFileURL(workDir).href, '<work>')).sort();
    census.sideResolutions = mine.filter(r => r.side === side.label && r.via !== 'repo').map(r => ({ specifier: r.specifier, via: r.via }));
    active = null;
    const factory = mod?.[SLOTS[slot].factory];
    if (!importError && typeof factory !== 'function') importError = { name: 'MissingExport', message: `module does not export ${SLOTS[slot].factory}` };
    return { mod, factory, census, importError };
  }

  const imported = {};
  report.importSideEffects = {};
  for (const slot of slotNames) {
    imported[slot] = {};
    report.importSideEffects[slot] = {};
    for (const side of sides) {
      const r = await importCopy(side, slot);
      imported[slot][side.label] = r;
      report.importSideEffects[slot][side.label] = { ...r.census, importError: r.importError };
      if (r.importError) report.fatal = `${side.label}/${slot}: import failed: ${r.importError.message}`;
    }
  }
  const libs = await fakes.loadRepoLibs(opts.repo);

  // Exported surface (non-factory exports, e.g. isDefaultCopyMint / COPY_PURPOSES)
  const exportShape = (mod) => {
    const o = {};
    for (const k of Object.keys(mod || {}).sort()) o[k] = typeof mod[k] === 'function' ? { __fn: mod[k].name, length: mod[k].length } : snap(mod[k]);
    return o;
  };
  report.exportsDiff = {};
  for (const slot of slotNames) {
    const [a, b] = sides.map(s => exportShape(imported[slot][s.label].mod));
    report.exportsDiff[slot] = diffPaths(canonical(a), canonical(b));
  }
  if (report.fatal) return finish(report);

  // ---- 5. one app per (side, slot, variant), each on its own 127.0.0.1 port
  const holders = Object.fromEntries(sides.map(s => [s.label, { label: s.label, ctx: null }]));
  const apps = {};
  for (const slot of slotNames) {
    apps[slot] = {};
    for (const side of sides) {
      apps[slot][side.label] = {};
      const holder = holders[side.label];
      const { factory, mod } = imported[slot][side.label];
      for (const variant of SLOTS[slot].variants) {
        let router;
        try {
          router = factory(SLOTS[slot].buildDeps(holder, libs, variant, mod));
        } catch (e) {
          report.fatal = `${side.label}/${slot}/${variant}: factory threw: ${e.message}`;
          return finish(report);
        }
        const app = express();
        app.use((req, res, next) => { if (holder.ctx) holder.ctx.res = res; next(); });
        // server.js:975-976 — the global body parsers every proxy route sits behind
        app.use(express.urlencoded({ extended: false }));
        app.use(express.json({ limit: '250kb' }));
        // express-session stand-in: the request's session document
        app.use((req, res, next) => { req.session = buildSession(holder.ctx?.sc.session); next(); });
        app.use(router);
        app.use(finalErrorHandler(holder));
        const server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
        apps[slot][side.label][variant] = { server, port: server.address().port };
      }
    }
  }

  function buildSession(spec) {
    if (!spec) return {};
    const s = JSON.parse(JSON.stringify(spec));
    if (s.__throwingWorkspaces) {
      delete s.__throwingWorkspaces;
      Object.defineProperty(s, 'workspaces', { get() { throw new Error('session store corrupted'); }, enumerable: true });
    }
    return s;
  }

  // Transcription of server.js's final four-argument error handler (LIN-608/
  // LIN-1158). HTML pages are stubbed; the stack in the 500 log line is
  // replaced by name+message (stacks carry per-side work paths).
  function finalErrorHandler(holder) {
    // eslint-disable-next-line no-unused-vars
    return (err, req, res, next) => {
      holder.ctx?.rec.expressErrors.push({ name: err?.name, message: err?.message, status: err?.status ?? err?.statusCode, type: err?.type });
      if (res.headersSent) return next(err);
      const wantsJson = req.path.includes('/api/') || req.xhr || (req.headers.accept || '').includes('application/json');
      const clientStatus = errorsLib.clientErrorStatus(err);
      if (clientStatus !== null) {
        console.warn('Client request error:', req.method, req.originalUrl, '-', clientStatus, err?.type || err?.message);
        const message = errorsLib.clientErrorMessage(clientStatus, err);
        if (wantsJson) errorsLib.jsonError(res, clientStatus, message);
        else res.status(clientStatus).send(`<!doctype html><title>stub:error-page</title>${message}`);
        return;
      }
      console.error('Unhandled route error:', req.method, req.originalUrl, '-', `${err?.name}: ${err?.message}`);
      if (wantsJson) errorsLib.serverError.json(res, 'Internal server error');
      else res.status(500).send('<!doctype html><title>stub:error-page</title>');
    };
  }

  // ---- 6. requests
  const bigCache = new Map();
  function bodyBuffer(b) {
    switch (b?.kind) {
      case undefined: case 'none': return { buf: null, type: null };
      case 'json': return { buf: Buffer.from(JSON.stringify(b.value)), type: b.contentType || 'application/json' };
      case 'raw': case 'text': return { buf: Buffer.from(b.text, 'utf8'), type: b.contentType };
      case 'form': return { buf: Buffer.from(new URLSearchParams(b.pairs).toString()), type: 'application/x-www-form-urlencoded' };
      case 'pad': return { buf: Buffer.from(JSON.stringify({ ...(b.value && typeof b.value === 'object' && !Array.isArray(b.value) ? b.value : { value: b.value }), __pad: 'p'.repeat(b.padBytes) })), type: b.contentType };
      case 'bigImage': {
        if (!bigCache.has(b.bytes)) {
          const raw = Buffer.alloc(b.bytes, 0x61);
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(raw);
          bigCache.set(b.bytes, 'data:image/png;base64,' + raw.toString('base64'));
        }
        return { buf: Buffer.from(JSON.stringify({ ...b.fields, image: bigCache.get(b.bytes) })), type: b.contentType };
      }
      default: throw new Error(`unknown body kind ${b.kind}`);
    }
  }

  function send(port, sc) {
    return new Promise((resolve) => {
      const headers = {};
      if (sc.auth?.authorization !== undefined) headers.authorization = sc.auth.authorization;
      const { buf, type } = bodyBuffer(sc.body);
      if (type) headers['content-type'] = type;
      if (buf) headers['content-length'] = buf.length;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
      const req = http.request({ host: '127.0.0.1', port, method: sc.method, path: sc.path, headers, agent: false }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
        res.on('error', (e) => done({ status: 'NO_RESPONSE', error: e.message, headers: {}, buf: Buffer.alloc(0) }));
      });
      const timer = setTimeout(() => { req.destroy(new Error('replay timeout')); }, opts.timeoutMs);
      req.on('error', (e) => done({ status: e.message === 'replay timeout' ? 'TIMEOUT' : 'NO_RESPONSE', error: e.code === 'EPIPE' || e.code === 'ECONNRESET' ? 'connection reset' : e.message, headers: {}, buf: Buffer.alloc(0) }));
      if (buf) req.end(buf); else req.end();
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

  function applyEnv(env) {
    for (const [k, v] of Object.entries(env || {})) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  async function runOne(sideLabel, slot, sc) {
    const holder = holders[sideLabel];
    const ctx = fakes.newContext(sc, libs);
    holder.ctx = ctx;
    active = holder;
    Math.random = mulberry32(sc.randomSeed);
    applyEnv(sc.env);
    const r = await send(apps[slot][sideLabel][sc.variant].port, sc);
    // flush fire-and-forget work (onTicketWrite after the response, logEvent ->
    // recordEvent, ledger repair) into THIS request's recorder
    for (let k = 0; k < 6; k++) await new Promise(res => setImmediate(res));
    await new Promise(res => setTimeout(res, 0));
    for (let k = 0; k < 2; k++) await new Promise(res => setImmediate(res));
    active = null;
    holder.ctx = null;
    const headers = {};
    for (const [k, v] of Object.entries(r.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    return { status: r.status, transportError: r.error, headers, body: decodeBody(r), calls: ctx.rec };
  }

  report.files = {};
  const t0 = performance.now();
  let totalDiff = 0;
  for (const slot of slotNames) {
    const gen = SLOTS[slot].gen;
    const groups = new Map();
    const perRoute = {};
    let diffRequests = 0;
    const onlyDetail = [];
    const indices = opts.only != null ? [opts.only] : Array.from({ length: opts.n }, (_, i) => i);
    const ts = performance.now();
    for (const i of indices) {
      const sc = gen.generateScenario(opts.seed, i);
      const o = await runOne('old', slot, sc);
      const nn = await runOne('new', slot, sc);
      const ep = (perRoute[sc.routeKey] ||= { requests: 0, diffRequests: 0, oldStatus: {}, newStatus: {}, statusLogPairs: {} });
      ep.requests++;
      ep.oldStatus[o.status] = (ep.oldStatus[o.status] || 0) + 1;
      ep.newStatus[nn.status] = (ep.newStatus[nn.status] || 0) + 1;
      const pair = `${o.status} | logEvent ${o.calls.log.map(l => l.status).join(',') || '-'}`;
      ep.statusLogPairs[pair] = (ep.statusLogPairs[pair] || 0) + 1;
      for (const tag of new Set(SLOTS[slot].tags?.(sc, o) || [])) (ep.tags ||= {})[tag] = (ep.tags[tag] || 0) + 1;
      const diffs = compareOutcomes(o, nn);
      if (opts.only != null) onlyDetail.push({ scenario: sc, old: o, new: nn, diffs });
      if (diffs.length) {
        diffRequests++;
        ep.diffRequests++;
        for (const d of diffs) {
          const key = `${sc.routeKey}\u0000${d.kind}`;
          let gEntry = groups.get(key);
          if (!gEntry) { gEntry = { endpoint: sc.routeKey, kind: d.kind, count: 0, requestIndexes: [], bodyPaths: {}, example: null }; groups.set(key, gEntry); }
          gEntry.count++;
          if (gEntry.requestIndexes.length < 25) gEntry.requestIndexes.push(i);
          if (d.kind === 'body') for (const p of d.detail) gEntry.bodyPaths[pathPattern(p.path)] = (gEntry.bodyPaths[pathPattern(p.path)] || 0) + 1;
          if (!gEntry.example) {
            gEntry.example = {
              requestIndex: i, variant: sc.variant,
              request: { method: sc.method, path: sc.path, authorization: sc.auth?.authorization ?? null, body: trim(sc.body) },
              difference: trim(d.detail), old: summarize(o), new: summarize(nn), scenario: trim(sc),
            };
          }
        }
      }
      if (!opts.quiet && (i + 1) % 1000 === 0) realStderr(`[replay] ${slot}: ${i + 1}/${indices.length} requests, ${diffRequests} differing\n`);
    }
    totalDiff += diffRequests;
    const thin = [];
    for (const [rk, ep] of Object.entries(perRoute)) {
      for (const [p, c] of Object.entries(ep.statusLogPairs)) if (c < 5) thin.push({ route: rk, pair: p, count: c });
    }
    report.files[slot] = {
      summary: { requests: indices.length, differingRequests: diffRequests, groups: groups.size, elapsedMs: Math.round(performance.now() - ts) },
      perRoute,
      thinStatusLogPairs: thin,
      differences: [...groups.values()].sort((a, b) => b.count - a.count),
      ...(opts.only != null ? { onlyDetail } : {}),
    };
  }
  const elapsedMs = Math.round(performance.now() - t0);

  // ---- 7. coverage of every work-tree file (router copies + helpers)
  const cov = await takeCoverage(coverageSession);
  report.coverage = {};
  for (const side of sides) {
    report.coverage[side.label] = {};
    const walk = (d) => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk(side.workRoutesPath)) {
      const url = pathToFileURL(f).href;
      const sc = cov.find(c => c.url === url);
      const rel = path.relative(side.workRoutesPath, f);
      if (!sc) { report.coverage[side.label][rel] = { error: 'not loaded' }; continue; }
      report.coverage[side.label][rel] = lineCoverage(readFileSync(f, 'utf8'), sc);
    }
  }

  for (const slot of slotNames) for (const side of sides) for (const a of Object.values(apps[slot][side.label])) await new Promise(r => a.server.close(r));
  ch.port1.close();

  report.summary = {
    requests: Object.values(report.files).reduce((s, f) => s + f.summary.requests, 0),
    differingRequests: totalDiff,
    elapsedMs,
    socketEscapesDuringReplay: socketEscapes.length,
  };
  return finish(report, { workDir, sides, socketEscapes });
}

function finish(report, ctx = {}) {
  const outFile = path.resolve(opts.out || path.join(process.cwd(), 'report.json'));
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  if (!opts.keepWork && ctx.workDir) rmSync(ctx.workDir, { recursive: true, force: true });
  if (report.fatal) out(`FATAL: ${report.fatal}`);
  if (report.summary) out(`replay: ${report.summary.requests} requests (seed ${opts.seed}) in ${report.summary.elapsedMs} ms; differing requests: ${report.summary.differingRequests}`);
  for (const [slot, f] of Object.entries(report.files || {})) {
    out(`== ${slot}: ${f.summary.requests} requests, ${f.summary.differingRequests} differing, ${f.summary.groups} groups`);
    for (const g of f.differences.slice(0, 25)) out(`  ${String(g.count).padStart(5)}  ${g.endpoint}  [${g.kind}]  e.g. #${g.example.requestIndex} ${g.example.request.method} ${g.example.request.path.slice(0, 70)}`);
    if (f.differences.length > 25) out(`  … ${f.differences.length - 25} more groups in the report`);
    const ed = report.exportsDiff?.[slot];
    if (ed?.length) out(`  exports differ: ${ed.map(d => d.path).join(', ')}`);
    for (const side of ['old', 'new']) {
      const own = report[side]?.[slot] ? path.basename(report[side][slot]) : null;
      for (const [file, c] of Object.entries(report.coverage?.[side] || {})) {
        if (c.pct === undefined || (file !== own && Object.values(report[side] || {}).map(f => path.basename(f)).includes(file))) continue;
        if (side === 'new' && report.old && report.new && JSON.stringify(report.old) === JSON.stringify(report.new)) continue;
        out(`  coverage ${side} ${file}: ${c.pct}% (${c.coveredLines}/${c.executableLines}); uncovered: ${c.uncovered.map(u => u.line).join(', ') || 'none'}`);
      }
    }
  }
  if (ctx.socketEscapes?.length) out(`WARNING: ${ctx.socketEscapes.length} non-loopback socket attempts were blocked`);
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
  const slotNames = pickSlots(opts.files);
  const base = opts.base;
  const dir = path.join(TOOL_DIR, 'work', `selfcheck-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const child = (label, a, b, files) => new Promise((resolve) => {
    const rep = path.join(dir, `${label}.json`);
    const args = [path.join(TOOL_DIR, 'replay.mjs'), '--old', a, '--new', b, '--files', files, '--seed', String(opts.seed), '--n', String(opts.n), '--out', rep, '--repo', opts.repo, '--quiet'];
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errText = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (c) => { errText += c; });
    p.on('close', () => {
      if (!existsSync(rep)) return resolve({ label, error: errText.slice(-2000) || 'no report' });
      resolve({ label, report: JSON.parse(readFileSync(rep, 'utf8')) });
    });
  });

  const jobs = [{ label: 'identity', a: base, b: base, files: slotNames.join(',') }];
  const mutantMeta = {};
  for (const slot of slotNames) {
    const src = readFileSync(path.join(base, SLOTS[slot].file), 'utf8');
    for (const m of SLOTS[slot].mutants) {
      const id = `${slot}.${m.id}`;
      const occurrences = src.split(m.from).length - 1;
      mutantMeta[id] = { slot, m, occurrences };
      if (occurrences !== 1) continue;
      const mdir = path.join(dir, id);
      mkdirSync(mdir, { recursive: true });
      for (const f of readdirSync(base)) if (/\.m?js$/.test(f)) writeFileSync(path.join(mdir, f), readFileSync(path.join(base, f)));
      writeFileSync(path.join(mdir, SLOTS[slot].file), src.replace(m.from, m.to));
      jobs.push({ label: id, a: base, b: mdir, files: slot });
    }
  }
  out(`self-check on ${base} (seed ${opts.seed}, n ${opts.n} per file, ${jobs.length} child runs, ${opts.jobs} at a time)`);
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, opts.jobs) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      results.push(await child(j.label, j.a, j.b, j.files));
    }
  }));
  const byLabel = Object.fromEntries(results.map(r => [r.label, r]));

  const summary = { base, seed: opts.seed, n: opts.n, checks: [] };
  const ident = byLabel.identity;
  if (ident.error || ident.report.fatal) {
    summary.checks.push({ id: 'identity', pass: false, error: ident.error || ident.report.fatal });
  } else {
    for (const slot of slotNames) {
      const f = ident.report.files[slot];
      summary.checks.push({ id: `${slot}.identity`, what: 'old vs old (two independent copies)', pass: f.summary.differingRequests === 0 && (ident.report.exportsDiff[slot] || []).length === 0, differingRequests: f.summary.differingRequests, groups: f.differences.map(g => `${g.endpoint} [${g.kind}] x${g.count}`) });
    }
    summary.coverage = ident.report.coverage.old;
    summary.perRoute = Object.fromEntries(slotNames.map(s => [s, ident.report.files[s].perRoute]));
    summary.thinStatusLogPairs = Object.fromEntries(slotNames.map(s => [s, ident.report.files[s].thinStatusLogPairs]));
    summary.importSideEffects = Object.fromEntries(slotNames.map(s => [s, ident.report.importSideEffects[s].old]));
    summary.elapsedMs = ident.report.summary.elapsedMs;
  }
  for (const [id, { m, occurrences }] of Object.entries(mutantMeta)) {
    if (occurrences !== 1) { summary.checks.push({ id, what: m.what, pass: false, error: `mutation site found ${occurrences} times in base (need exactly 1)` }); continue; }
    const run = byLabel[id];
    if (run.error || run.report.fatal) { summary.checks.push({ id, what: m.what, pass: false, error: run.error || run.report.fatal }); continue; }
    const f = Object.values(run.report.files)[0];
    const groups = f.differences.map(g => ({ endpoint: g.endpoint, kind: g.kind, count: g.count }));
    const detected = groups.some(g => m.expect.kinds.includes(g.kind) && m.expect.endpoints.includes(g.endpoint));
    const offTarget = groups.filter(g => !m.expect.endpoints.includes(g.endpoint));
    summary.checks.push({
      id, what: m.what, pass: detected && offTarget.length === 0, detected, differingRequests: f.summary.differingRequests,
      groups: groups.map(g => `${g.endpoint} [${g.kind}] x${g.count}`), offTargetGroups: offTarget.map(g => `${g.endpoint} [${g.kind}] x${g.count}`),
    });
  }

  const outFile = path.resolve(opts.out || path.join(process.cwd(), 'selfcheck.json'));
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  if (!opts.keepWork) rmSync(dir, { recursive: true, force: true });
  for (const c of summary.checks) {
    out(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(24)} ${c.what || ''}  differing=${c.differingRequests ?? '-'}${c.error ? '  error: ' + String(c.error).split('\n').slice(-3).join(' | ') : ''}`);
    for (const g of c.groups || []) out(`        ${g}`);
  }
  for (const [file, c] of Object.entries(summary.coverage || {})) {
    if (c.pct === undefined) continue;
    out(`coverage ${file}: ${c.pct}% lines (${c.coveredLines}/${c.executableLines}); uncovered: ${c.uncovered.map(u => u.line).join(', ') || 'none'}`);
  }
  for (const [slot, thin] of Object.entries(summary.thinStatusLogPairs || {})) {
    if (thin.length) out(`thin (status, logEvent) pairs in ${slot} (<5 hits): ${thin.map(t => `${t.route} {${t.pair}} x${t.count}`).join('; ')}`);
  }
  out(`self-check report: ${outFile}`);
  process.exit(summary.checks.every(c => c.pass) ? 0 : 1);
}
