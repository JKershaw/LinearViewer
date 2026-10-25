// Router replay harness (replay-kit/lib/router). Generalised from
// rung5c/replay/replay.mjs: a target supplies a cfg and calls
// `runRouterReplay(cfg)` from its replay.mjs. See ../../README.md ("Router
// replays") for the cfg contract. Hermetic process (env scrub, non-loopback
// sockets blocked, recorded `fetch` fake, virtual clock + timers, seeded
// Math.random / randomUUID per request), per-side private lib graphs
// (hooks.mjs), seam shims, real Express apps on 127.0.0.1:0, one HTTP request
// per scenario sent to both sides, per-request comparison (compare.mjs),
// aggregation, coverage, AI-path floors (ai-coverage.mjs), report.
// Exit 0 same / 1 differ / 2 tool failure / 3 AI-path floor missed (fail mode).
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import util from 'node:util';
import crypto from 'node:crypto';
import { createRequire, register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateAiCoverage, AI_FLOOR_MODES } from './ai-coverage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv, cfg) {
  const o = { old: cfg.defaultOld, new: null, n: cfg.defaultN ?? 3000, seed: 1, out: null, coverage: false, lib: cfg.defaultLib, tiers: cfg.defaultTiers ?? 'gen,edge,test', only: null, quiet: false, keepWork: false, timeoutMs: 5000, aiFloor: 'fail' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--old') o.old = next();
    else if (a === '--new') o.new = next();
    else if (a === '--n') o.n = Number(next());
    else if (a === '--seed') o.seed = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--coverage') o.coverage = true;
    else if (a === '--lib') o.lib = path.resolve(next());
    else if (a === '--tiers') o.tiers = next();
    else if (a === '--only') o.only = next();
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--keep-work') o.keepWork = true;
    else if (a === '--timeout-ms') o.timeoutMs = Number(next());
    else if (a === '--dump') o.dump = next();
    else if (a === '--ai-floor') {
      o.aiFloor = next();
      if (!AI_FLOOR_MODES.includes(o.aiFloor)) { process.stderr.write(`--ai-floor takes ${AI_FLOOR_MODES.join(', ')}, got "${o.aiFloor}"\n`); process.exit(2); }
    }
    else if (a === '-h' || a === '--help') { process.stdout.write(readFileSync(path.join(cfg.toolDir, 'README.md'), 'utf8')); process.exit(0); }
    else { process.stderr.write(`unknown argument: ${a}\n`); process.exit(2); }
  }
  if (!o.new) { process.stderr.write(`usage: node replay.mjs --old <dirOrFiles> --new <dirOrFiles> [--n ${o.n}] [--seed 1] [--out f] [--coverage] [--lib DIR] [--tiers ${o.tiers}] [--only id]\n`); process.exit(2); }
  return o;
}

export async function runRouterReplay(cfg) {
  const opts = parseArgs(process.argv.slice(2), cfg);
  const out = (s) => process.stdout.write(s + '\n');
  const realStderr = (s) => process.stderr.write(s);
  const VIRTUAL_TMP = cfg.virtualTmp || '/replay-virtual-tmp';

  // =========================================================================
  // 1. Hermetic process
  // =========================================================================
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', ...(cfg.scrubEnv || [])]) delete process.env[k];
  process.env.NODE_ENV = 'test';
  process.env.TMPDIR = VIRTUAL_TMP;
  const socketEscapes = [];
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const o = typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) ? args[0] : Array.isArray(args[0]) ? args[0][0] : { port: args[0], host: args[1] };
    const host = o?.host ?? o?.hostname;
    const isPipe = typeof o?.path === 'string';
    if (!(isPipe || host === undefined || host === '127.0.0.1' || host === '::1' || host === 'localhost')) {
      socketEscapes.push({ host, port: o?.port });
      throw new Error(`replay: blocked non-loopback connect to ${host}:${o?.port}`);
    }
    return origConnect.apply(this, args);
  };

  const vclock = await import('./vclock.mjs');
  const { real } = vclock.install();
  const common = await import('./common.mjs');
  const { FIXED_NOW, mulberry32, snap, materialize, newRecorder } = common;
  vclock.setIdleNow(FIXED_NOW);

  let coverageSession = null;
  if (opts.coverage) {
    const { startCoverage } = await import('./coverage.mjs');
    coverageSession = await startCoverage();
  }

  const cryptoCjs = createRequire(import.meta.url)('node:crypto');
  cryptoCjs.randomUUID = () => {
    const h = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  // crypto.randomBytes is left real only outside requests; inside, seeded.
  const realRandomBytes = cryptoCjs.randomBytes;
  cryptoCjs.randomBytes = function randomBytes(n, cb) {
    if (!active?.ctx) return realRandomBytes.apply(this, arguments);
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    if (typeof cb === 'function') { process.nextTick(cb, null, b); return undefined; }
    return b;
  };

  let active = null; // { ctx } while a request runs, { importCensus } while importing

  // Egress: every fetch is recorded; the target's fetchHandler answers it
  // from the scenario (a Response), else it is refused.
  globalThis.fetch = async (url, init) => {
    const ctx = active?.ctx;
    const entry = { url: String(url?.url ?? url), method: init?.method ?? 'GET', headers: cfg.describeFetchHeaders ? cfg.describeFetchHeaders(init?.headers) : snap(init?.headers ?? null), redirect: init?.redirect ?? null, body: init?.body === undefined ? undefined : cfg.describeFetchBody ? cfg.describeFetchBody(init.body) : snap(typeof init.body === 'string' ? init.body.slice(0, 2000) : init.body) };
    if (ctx) ctx.rec.fetch.push(entry);
    else if (active?.importCensus) active.importCensus.fetch.push(entry);
    if (ctx && cfg.fetchHandler) return cfg.fetchHandler(ctx, entry, init, libsBySide[ctx.side]);
    throw new TypeError('fetch failed (replay: egress disabled)');
  };

  // Console + async faults
  let workDir = null;
  const normalise = (s) => {
    let t = String(s).replace(/\n\s+at .*/g, '');
    if (workDir) t = t.split(pathToFileURL(workDir).href).join('<work>').split(workDir).join('<work>');
    return t.split(opts.lib).join('<lib>');
  };
  for (const level of ['log', 'error', 'warn', 'info', 'debug']) {
    console[level] = (...args) => {
      const msg = normalise(util.format(...args));
      if (active?.ctx) active.ctx.rec.console.push({ level, msg });
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
    const info = reason instanceof Error ? { name: reason.name, message: normalise(String(reason.message)) } : { thrown: String(reason) };
    if (!onAsyncFault(info)) realStderr(`[replay] unhandled rejection outside a request: ${util.inspect(reason)}\n`);
  });
  process.on('uncaughtException', (err) => {
    if (!onAsyncFault({ name: err?.name, message: normalise(String(err?.message)), uncaught: true })) {
      realStderr(`[replay] uncaught exception outside a request: ${err?.stack}\n`);
      process.exit(4);
    }
  });

  // =========================================================================
  // 2. Sides, hook, imports
  // =========================================================================
  const report = { tool: cfg.name, lib: opts.lib, libHead: libHead(opts.lib), seed: opts.seed, n: opts.n, tiers: opts.tiers, fatal: null };
  function libHead(dir) {
    try { return readFileSync(path.join(dir, 'SHA'), 'utf8').trim(); } catch { /* not a snapshot */ }
    try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
  }

  const { resolveSide, layoutSide } = await import('./prepare.mjs');
  workDir = path.join(cfg.toolDir, 'work', `run-${process.pid}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const sides = [];
  for (const [label, spec] of [['old', opts.old], ['new', opts.new]]) {
    let side;
    try { side = resolveSide(spec, cfg.slots); } catch (e) { report.fatal = `${label}: ${e.message}`; break; }
    if (side.missing.length) { report.fatal = `${label}: no file for ${side.missing.join(', ')} in ${spec}`; break; }
    sides.push({ ...layoutSide(label, workDir, side, cfg.slots, cfg.subdir || 'routes'), spec });
  }
  if (report.fatal) return finish();
  report.old = Object.fromEntries(Object.entries(sides[0].copies).map(([k, v]) => [k, v.src]));
  report.new = Object.fromEntries(Object.entries(sides[1].copies).map(([k, v]) => [k, v.src]));

  // Seam shims are written after a probe import tells us each module's exports.
  const seamShims = { old: {}, new: {} };
  const seamDir = path.join(workDir, 'seams');
  for (const label of ['old', 'new']) for (const rel of Object.keys(cfg.seams || {})) seamShims[label][rel] = pathToFileURL(path.join(seamDir, label, rel.replace(/\W/g, '_') + '.mjs')).href;

  const ch = new MessageChannel();
  const resolutions = [];
  ch.port1.on('message', (m) => resolutions.push(m));
  ch.port1.unref();
  register(pathToFileURL(path.join(HERE, 'hooks.mjs')).href, import.meta.url, {
    data: { sides: sides.map(s => ({ label: s.label, workRootUrl: s.workRootUrl, workDirPath: s.workDirPath, srcDirs: s.srcDirs })), libRoot: opts.lib, fallbackRoot: cfg.fallbackRoot, port: ch.port2, subdir: cfg.subdir || 'routes', seamShims },
    transferList: [ch.port2],
  });
  const libUrl = (p, label) => `${pathToFileURL(path.join(opts.lib, p)).href}${label ? `?side=${label}` : ''}`;

  // Seam dispatcher: shims call globalThis.__replaySeams.call(label, rel, name, args, realFn)
  const seamHandlers = {};
  globalThis.__replaySeams = {
    call(label, rel, name, args, realFn) {
      const h = holders[label];
      const ctx = h?.ctx;
      if (!ctx) return realFn(...args); // outside a request (import-time use): the real function
      return seamHandlers[label](ctx, rel, name, args, realFn);
    },
  };
  for (const [rel, names] of Object.entries(cfg.seams || {})) {
    const probe = await import(libUrl(rel, 'seamprobe'));
    for (const label of ['old', 'new']) {
      const realUrl = `${pathToFileURL(path.join(opts.lib, rel)).href}?side=${label}&seamreal=1`;
      const lines = [`import * as real from ${JSON.stringify(realUrl)};`];
      for (const k of Object.keys(probe)) {
        if (names.includes(k)) {
          lines.push(`export const ${k} = Object.defineProperty(function ${k}(...a) { return globalThis.__replaySeams.call(${JSON.stringify(label)}, ${JSON.stringify(rel)}, ${JSON.stringify(k)}, a, real[${JSON.stringify(k)}]); }, 'length', { value: real[${JSON.stringify(k)}].length });`);
        } else if (k === 'default') lines.push(`export { default } from ${JSON.stringify(realUrl)};`);
        else lines.push(`export { ${k} } from ${JSON.stringify(realUrl)};`);
      }
      const f = fileURLToPath(seamShims[label][rel]);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, lines.join('\n') + '\n');
    }
  }

  const { compareOutcomes, pathPattern, diffPaths, canonical } = await import('./compare.mjs');

  // Production error plumbing first (server.js installs it before any router).
  for (const s of sides) { try { (await import(libUrl('lib/async-errors.js', s.label))).installAsyncErrorForwarding(); } catch { /* lib without it */ } }
  const express = (await import(pathToFileURL(resolvePkg('express/index.js')).href)).default;
  function resolvePkg(rel) {
    for (const root of [opts.lib, cfg.fallbackRoot]) { const p = path.join(root, 'node_modules', rel); if (existsSync(p)) return p; }
    throw new Error(`${rel} not found`);
  }

  async function importCopy(side, slot) {
    const copy = side.copies[slot];
    const census = { console: [], unhandled: [], fs: [], fetch: [], envReads: [], newGlobals: [], socketEscapes: [], modulesFirstLoaded: 0, sideResolutions: [] };
    active = { importCensus: census };
    const realEnv = process.env;
    const reads = new Set();
    process.env = new Proxy(realEnv, { get(t, k) { if (typeof k === 'string') reads.add(k); return Reflect.get(t, k); } });
    const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));
    const escBefore = socketEscapes.length;
    const resolBefore = resolutions.length;
    let mod; let importError = null;
    try { mod = await import(copy.url); } catch (e) { importError = { name: e.name, message: e.message, stack: String(e.stack).split('\n').slice(0, 4).join(' | ') }; } finally { process.env = realEnv; }
    await new Promise(r => real.setImmediate(r));
    await new Promise(r => real.setTimeout(r, 20));
    census.envReads = [...reads].filter(k => !['WATCH_REPORT_DEPENDENCIES', 'NODE_V8_COVERAGE'].includes(k)).sort();
    census.newGlobals = Object.getOwnPropertyNames(globalThis).filter(k => !globalsBefore.has(k));
    census.socketEscapes = socketEscapes.slice(escBefore);
    const mine = resolutions.slice(resolBefore);
    census.modulesFirstLoaded = mine.length;
    census.sideResolutions = mine.filter(r => r.side === side.label && (r.via === 'side' || r.via === 'side-copied')).map(r => ({ specifier: r.specifier, via: r.via }));
    active = null;
    const factory = mod?.[cfg.slots[slot].factory];
    if (!importError && typeof factory !== 'function') importError = { name: 'MissingExport', message: `module does not export ${cfg.slots[slot].factory}` };
    return { mod, factory, census, importError };
  }

  // Per-side libs first (registry providers registered as server.js does),
  // then the target copies.
  const libsBySide = {};
  const holders = {};
  for (const s of sides) {
    holders[s.label] = { label: s.label, ctx: null };
    libsBySide[s.label] = await cfg.loadSideLibs({ libRoot: opts.lib, label: s.label, libUrl: (p) => libUrl(p, s.label) });
    if (cfg.onSideLibs) cfg.onSideLibs(holders[s.label], libsBySide[s.label]);
    seamHandlers[s.label] = cfg.seamHandler ? cfg.seamHandler(holders[s.label], libsBySide[s.label]) : (ctx, rel, name, args, realFn) => realFn(...args);
  }
  const imported = {};
  report.importSideEffects = {};
  for (const side of sides) {
    imported[side.label] = {};
    report.importSideEffects[side.label] = {};
    for (const slot of Object.keys(cfg.slots)) {
      const r = await importCopy(side, slot);
      imported[side.label][slot] = r;
      report.importSideEffects[side.label][slot] = { ...r.census, importError: r.importError };
      if (r.importError && !report.fatal) report.fatal = `${side.label}/${slot}: import failed: ${r.importError.message}`;
    }
  }
  if (report.fatal) return finish();

  const exportShape = (mod) => {
    const o = {};
    for (const k of Object.keys(mod || {}).sort()) {
      const v = mod[k];
      if (typeof v === 'function') o[k] = { __fn: v.name, length: v.length };
      else if (v && typeof v === 'object') o[k] = { __object: Object.keys(v).sort().map(p => `${p}:${typeof v[p] === 'function' ? `fn/${v[p].length}` : typeof v[p]}`) };
      else o[k] = snap(v);
    }
    return o;
  };
  report.exportsDiff = {};
  report.exports = {};
  for (const slot of Object.keys(cfg.slots)) {
    report.exports[slot] = Object.keys(exportShape(imported.old[slot].mod));
    report.exportsDiff[slot] = diffPaths(canonical(exportShape(imported.old[slot].mod)), canonical(exportShape(imported.new[slot].mod)));
  }

  const K = cfg.loadVocabulary ? await cfg.loadVocabulary({ libUrl: (p) => libUrl(p, 'gen') }) : {};

  // =========================================================================
  // 3. Apps: per side, one per variant
  // =========================================================================
  const apps = {};
  for (const side of sides) {
    const holder = holders[side.label];
    const libs = libsBySide[side.label];
    apps[side.label] = {};
    for (const variant of cfg.variants) {
      let routers;
      try { routers = cfg.buildRouters({ holder, libs, imported: imported[side.label], variant, side: side.label }); } catch (e) { report.fatal = `${side.label}/${variant}: factory threw: ${e.message}`; return finish(); }
      apps[side.label][variant] = await listen(holder, libs, routers);
    }
  }

  async function listen(holder, libs, routers) {
    const app = express();
    app.use((req, res, next) => {
      const ctx = holder.ctx;
      if (ctx) {
        ctx.res = res;
        if (ctx.sc.clientAbortAfterMs) setTimeout(() => { ctx.rec.deps.push({ fn: 'client.abort', atMs: ctx.sc.clientAbortAfterMs }); res.socket?.destroy(); }, ctx.sc.clientAbortAfterMs);
        const chunks = [];
        const w = res.write.bind(res);
        const e = res.end.bind(res);
        res.write = (c, ...a) => { if (c != null && typeof c !== 'function') chunks.push(Buffer.from(c)); return w(c, ...a); };
        res.end = (c, ...a) => { if (c != null && typeof c !== 'function') chunks.push(Buffer.from(c)); return e(c, ...a); };
        ctx.resSnapshot = () => ({ statusCode: res.statusCode, ended: res.writableEnded, headersSent: res.headersSent, contentType: String(res.getHeader('content-type') || ''), body: Buffer.concat(chunks).toString('utf8').slice(0, 4000) });
      }
      next();
    });
    for (const mw of cfg.globalMiddleware ? cfg.globalMiddleware({ express, holder, libs }) : []) app.use(mw);
    for (const r of routers) app.use(r);
    app.use(cfg.finalErrorHandler ? cfg.finalErrorHandler({ holder, libs, normalise }) : defaultFinalErrorHandler(holder, libs));
    const server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
    return { server, port: server.address().port };
  }

  function defaultFinalErrorHandler(holder) {
    // eslint-disable-next-line no-unused-vars
    return (err, req, res, next) => {
      holder.ctx?.rec.expressErrors.push({ name: err?.name, message: normalise(String(err?.message)), status: err?.status ?? err?.statusCode, type: err?.type });
      if (res.headersSent) return next(err);
      res.status(500).json({ error: 'Internal server error' });
    };
  }

  // =========================================================================
  // 4. One request
  // =========================================================================
  function bodyBuffer(b) {
    switch (b?.kind) {
      case undefined: case 'none': return { buf: null, type: null };
      case 'json': return { buf: Buffer.from(JSON.stringify(b.value) ?? ''), type: b.contentType || 'application/json' };
      case 'raw': return { buf: Buffer.from(b.text, 'utf8'), type: b.contentType };
      case 'form': return { buf: Buffer.from(new URLSearchParams(b.pairs).toString()), type: 'application/x-www-form-urlencoded' };
      case 'pad': return { buf: Buffer.from(JSON.stringify({ ...(b.value && typeof b.value === 'object' && !Array.isArray(b.value) ? b.value : {}), __pad: 'p'.repeat(b.padBytes) })), type: b.contentType };
      default: throw new Error(`unknown body kind ${b.kind}`);
    }
  }

  function send(port, sc) {
    return new Promise((resolve) => {
      const headers = {};
      for (const [k, v] of Object.entries(sc.headers || {})) if (v !== undefined) headers[k] = v;
      const { buf, type } = bodyBuffer(sc.body);
      if (type) headers['content-type'] = type;
      if (buf) headers['content-length'] = buf.length;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; real.clearTimeout(timer); resolve(v); } };
      let req;
      try {
        req = http.request({ host: '127.0.0.1', port, method: sc.method, path: sc.path, headers, agent: false, setHost: false }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
        res.on('error', (e) => done({ status: 'NO_RESPONSE', error: e.message, headers: {}, buf: Buffer.alloc(0) }));
        res.on('aborted', () => done({ status: 'NO_RESPONSE', error: 'aborted mid-body', headers: res.headers, buf: Buffer.concat(chunks) }));
      });
      } catch (e) {
        // the client itself refused the request (e.g. an unescaped path): no request was sent
        settled = true;
        return resolve({ status: 'CLIENT_REFUSED', error: e.code || e.message, headers: {}, buf: Buffer.alloc(0) });
      }
      const timer = real.setTimeout(() => { req.destroy(new Error('replay timeout')); }, opts.timeoutMs);
      req.on('error', (e) => done({ status: e.message === 'replay timeout' ? 'TIMEOUT' : 'NO_RESPONSE', error: e.code === 'EPIPE' || e.code === 'ECONNRESET' ? 'connection reset' : e.message, headers: {}, buf: Buffer.alloc(0) }));
      if (buf) req.end(buf); else req.end();
    });
  }

  function parseSse(t) {
    const events = [];
    for (const block of t.split(/\n\n/)) {
      if (!block.trim()) continue;
      const ev = {};
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) { (ev.comments ||= []).push(line); continue; }
        const m = /^(event|data|id|retry):\s?(.*)$/.exec(line);
        if (!m) { (ev.junk ||= []).push(line); continue; }
        if (m[1] === 'data') { let d = m[2]; try { d = JSON.parse(d); } catch { /* raw */ } ev.data = ev.data === undefined ? d : [].concat(ev.data, d); } else ev[m[1]] = m[2];
      }
      events.push(ev);
    }
    return events;
  }

  function decodeBody(r) {
    const ct = String(r.headers['content-type'] || '');
    if (r.buf.length === 0) return { __empty: true };
    if (ct.includes('json')) {
      try { return JSON.parse(r.buf.toString('utf8')); } catch { return { __invalidJson: r.buf.toString('utf8').slice(0, 500) }; }
    }
    if (ct.startsWith('text/event-stream')) return { __sse: parseSse(r.buf.toString('utf8')) };
    if (ct.startsWith('text/')) {
      const t = r.buf.toString('utf8');
      return { __text: t.length > 3000 ? { length: t.length, sha256: crypto.createHash('sha256').update(t).digest('hex'), head: t.slice(0, 1500) } : t };
    }
    return { __bytes: r.buf.length, sha256: crypto.createHash('sha256').update(r.buf).digest('hex') };
  }

  const MANAGED_ENV = ['NODE_ENV', ...(cfg.managedEnv || [])];
  function applyEnv(env) {
    for (const k of new Set([...MANAGED_ENV, ...Object.keys(env || {})])) {
      const v = env?.[k] ?? (k === 'NODE_ENV' ? 'test' : undefined);
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  async function runCall(sideLabel, sc) {
    // direct export call (pure exported helpers)
    const holder = holders[sideLabel];
    const libs = libsBySide[sideLabel];
    const ctx = { sc, side: sideLabel, rec: newRecorder(), callCounts: new Map(), res: null };
    holder.ctx = ctx; active = { ctx };
    Math.random = mulberry32(sc.randomSeed);
    applyEnv(sc.env);
    vclock.begin(sc.clockBase, ctx.rec.timers);
    let status; let body;
    try {
      const fn = imported[sideLabel][sc.slot || Object.keys(cfg.slots)[0]].mod[sc.export];
      const v = await fn(...materialize(sc.args || [], libs));
      status = 'RETURN'; body = snap(v);
    } catch (e) { status = 'THROW'; body = { name: e?.name, message: e?.message }; }
    ctx.rec.timersPending = vclock.end();
    active = null; holder.ctx = null;
    return { status, headers: {}, body, calls: ctx.rec };
  }

  async function runOne(sideLabel, sc) {
    if (sc.kind === 'call') return runCall(sideLabel, sc);
    const holder = holders[sideLabel];
    const libs = libsBySide[sideLabel];
    const app = apps[sideLabel][sc.variant] || apps[sideLabel][cfg.variants[0]];
    const ctx = { sc, side: sideLabel, rec: newRecorder(), callCounts: new Map(), res: null, state: {} };
    holder.ctx = ctx;
    active = { ctx };
    Math.random = mulberry32(sc.randomSeed);
    applyEnv(sc.env);
    vclock.begin(sc.clockBase, ctx.rec.timers);
    if (cfg.beforeRequest) cfg.beforeRequest(ctx, libs);
    let r = null;
    const p = send(app.port, sc).then(v => { r = v; });
    await vclock.pumpUntil(() => r !== null, () => !!ctx.res && !ctx.res.writableEnded);
    await p;
    if (typeof r.status !== 'number' || (ctx.res && !ctx.res.writableEnded)) await vclock.drain(120_000);
    for (let k = 0; k < 6; k++) await new Promise(res => real.setImmediate(res));
    await new Promise(res => real.setTimeout(res, 0));
    for (let k = 0; k < 2; k++) await new Promise(res => real.setImmediate(res));
    ctx.rec.serverResponse = ctx.resSnapshot ? ctx.resSnapshot() : null;
    if (cfg.afterRequest) cfg.afterRequest(ctx, libs);
    ctx.rec.timersPending = vclock.end();
    active = null;
    holder.ctx = null;
    const headers = {};
    for (const [k, v] of Object.entries(r.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    return { status: r.status, transportError: r.error, headers, body: decodeBody(r), calls: ctx.rec };
  }

  // =========================================================================
  // 5. Scenarios
  // =========================================================================
  const groups = new Map();
  // AI-path counters per side (cfg.aiCounters): what requests reached the model call, the store write and the fail-closed arms (LIN-3880)
  const aiCounts = { old: {}, new: {} };
  const bump = (side, k) => { aiCounts[side][k] = (aiCounts[side][k] || 0) + 1; };
  const perRoute = {};
  const perTier = {};
  const perIntent = {};
  let total = 0;
  let differing = 0;
  const onlyDetail = [];
  const dumpLines = [];
  const slow = [];
  const t0 = performance.now();
  const statusOf = (o) => (typeof o.status === 'number' || o.status === 'RETURN' || o.status === 'THROW') ? o.status : `${o.status}(server ${o.calls.serverResponse?.statusCode ?? '-'})`;
  for (const make of cfg.scenarios({ opts, K, toolDir: cfg.toolDir })) {
    const sc = make();
    if (opts.only && sc.id !== opts.only) continue;
    if (process.env.REPLAY_TRACE) realStderr(`[trace] ${sc.id} ${sc.intent ?? sc.form ?? ''}\n`);
    const tReq = performance.now();
    const o = await runOne('old', sc);
    const nn = await runOne('new', sc);
    const dReq = performance.now() - tReq;
    if (dReq > 3000) { slow.push({ id: sc.id, intent: sc.intent, routeKey: sc.routeKey, ms: Math.round(dReq), status: o.status }); if (!opts.quiet) realStderr(`[replay] slow ${sc.id} ${sc.intent ?? ''} ${Math.round(dReq)} ms (${o.status})\n`); }
    total++;
    const pt = (perTier[sc.tier] ||= { requests: 0, differing: 0 });
    pt.requests++;
    const ep = (perRoute[sc.routeKey] ||= { requests: 0, differing: 0, byTier: {}, oldStatus: {}, newStatus: {}, statusPairs: {}, tags: {} });
    ep.requests++;
    ep.byTier[sc.tier] = (ep.byTier[sc.tier] || 0) + 1;
    ep.oldStatus[statusOf(o)] = (ep.oldStatus[statusOf(o)] || 0) + 1;
    ep.newStatus[statusOf(nn)] = (ep.newStatus[statusOf(nn)] || 0) + 1;
    const pair = cfg.statusKey ? cfg.statusKey(sc, o, statusOf(o)) : String(statusOf(o));
    ep.statusPairs[pair] = (ep.statusPairs[pair] || 0) + 1;
    for (const tag of cfg.outcomeTags ? cfg.outcomeTags(sc, o) : []) ep.tags[tag] = (ep.tags[tag] || 0) + 1;
    if (sc.tier === 'edge') { const pi = (perIntent[`${sc.routeKey} ${sc.intent}`] ||= {}); pi[pair] = (pi[pair] || 0) + 1; }
    if (cfg.aiCounters) { for (const k of cfg.aiCounters(sc, o)) bump('old', k); for (const k of cfg.aiCounters(sc, nn)) bump('new', k); }
    const diffs = compareOutcomes(o, nn);
    if (opts.dump) dumpLines.push(JSON.stringify({ id: sc.id, intent: sc.intent, routeKey: sc.routeKey, method: sc.method, path: sc.path, variant: sc.variant, ws: sc.wsKey, status: o.status, body: trim(o.body), console: o.calls.console, seams: trim(o.calls.seams), deps: trim(o.calls.deps), store: trim(o.calls.store), fetch: o.calls.fetch, unhandled: o.calls.unhandled, expressErrors: o.calls.expressErrors, session: o.calls.session, diffs: diffs.map(d => d.kind) }));
    if (opts.only) onlyDetail.push({ scenario: sc, old: o, new: nn, diffs });
    if (diffs.length) {
      differing++; pt.differing++; ep.differing++;
      for (const d of diffs) {
        const key = `${sc.routeKey}\u0000${d.kind}`;
        let gEntry = groups.get(key);
        if (!gEntry) { gEntry = { endpoint: sc.routeKey, kind: d.kind, count: 0, ids: [], bodyPaths: {}, example: null }; groups.set(key, gEntry); }
        gEntry.count++;
        if (gEntry.ids.length < 25) gEntry.ids.push(sc.id);
        if (d.kind === 'body') for (const p of d.detail) gEntry.bodyPaths[pathPattern(p.path)] = (gEntry.bodyPaths[pathPattern(p.path)] || 0) + 1;
        if (!gEntry.example) gEntry.example = { id: sc.id, request: { method: sc.method, path: sc.path, variant: sc.variant, headers: sc.headers, body: trim(sc.body) }, difference: trim(d.detail), old: summarize(o), new: summarize(nn) };
      }
    }
    if (!opts.quiet && total % 1000 === 0) realStderr(`[replay] ${total} requests, ${differing} differing\n`);
  }
  const elapsedMs = Math.round(performance.now() - t0);

  // =========================================================================
  // 6. Coverage + report
  // =========================================================================
  if (coverageSession) {
    const { takeCoverage, lineCoverage } = await import('./coverage.mjs');
    const cov = await takeCoverage(coverageSession);
    report.coverage = {};
    for (const side of sides) {
      report.coverage[side.label] = {};
      const walk = (d) => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
      for (const f of walk(side.workDirPath)) {
        const url = pathToFileURL(f).href;
        const scov = cov.find(c => c.url === url);
        const rel = path.relative(side.workDirPath, f);
        report.coverage[side.label][rel] = scov ? lineCoverage(readFileSync(f, 'utf8'), scov) : { error: 'not loaded' };
      }
    }
  }
  for (const side of sides) for (const a of Object.values(apps[side.label])) await new Promise(r => a.server.close(r));

  const thin = [];
  for (const [rk, ep] of Object.entries(perRoute)) for (const [p, c] of Object.entries(ep.statusPairs)) if (c < 5) thin.push({ route: rk, pair: p, count: c });
  report.summary = { requests: total, differingRequests: differing, groups: groups.size, perTier, elapsedMs, socketEscapesDuringReplay: socketEscapes.length };
  if (cfg.aiCounters) report.aiCoverage = evaluateAiCoverage({ counts: aiCounts, floors: cfg.aiFloors || [], tiers: opts.tiers.split(',').map(t => t.trim()), mode: opts.aiFloor, only: !!opts.only });
  report.perRoute = perRoute;
  report.edgeOutcomes = perIntent;
  report.thinStatusPairs = thin;
  report.slowRequests = slow;
  report.differences = [...groups.values()].sort((a, b) => b.count - a.count);
  if (opts.only) report.onlyDetail = onlyDetail;
  if (opts.dump) writeFileSync(opts.dump, dumpLines.join('\n') + '\n');
  return finish();

  function summarize(o) { return trim({ status: o.status, transportError: o.transportError, headers: o.headers, body: o.body, calls: o.calls }); }
  function trim(v, depth = 0) {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + `…(+${v.length - 300})`;
      return v;
    }
    if (depth > 10) return '…';
    if (Array.isArray(v)) { const h = v.slice(0, 12).map(x => trim(x, depth + 1)); if (v.length > 12) h.push(`…(+${v.length - 12} more)`); return h; }
    const o = {};
    for (const k of Object.keys(v)) o[k] = trim(v[k], depth + 1);
    return o;
  }

  function finish() {
    const outFile = path.resolve(opts.out || path.join(cfg.toolDir, 'work', 'report.json'));
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    if (!opts.keepWork && workDir) rmSync(workDir, { recursive: true, force: true });
    if (report.fatal) out(`FATAL: ${report.fatal}`);
    if (report.summary) {
      const s = report.summary;
      out(`replay: ${s.requests} requests (seed ${opts.seed}; ${Object.entries(s.perTier).map(([k, v]) => `${k} ${v.requests}`).join(', ')}) in ${s.elapsedMs} ms; differing: ${s.differingRequests} in ${s.groups} groups`);
      for (const g of report.differences.slice(0, 40)) out(`  ${String(g.count).padStart(5)}  ${g.endpoint}  [${g.kind}]  e.g. ${g.example.id} ${g.example.request.method ?? ''} ${String(g.example.request.path ?? '').slice(0, 70)}`);
      if (report.differences.length > 40) out(`  … ${report.differences.length - 40} more groups in the report`);
      for (const [slot, d] of Object.entries(report.exportsDiff || {})) if (d.length) out(`  exports differ (${slot}): ${d.map(x => x.path).join(', ')}`);
      for (const [label, files] of Object.entries(report.coverage || {})) for (const [f, c] of Object.entries(files)) if (c.pct !== undefined) out(`  coverage ${label} ${f}: ${c.pct}% (${c.coveredLines}/${c.executableLines}); uncovered: ${c.uncovered.map(u => u.line).join(', ') || 'none'}`);
      if (socketEscapes.length) out(`WARNING: ${socketEscapes.length} non-loopback socket attempts were blocked`);
    }
    out(`report: ${outFile}`);
    const ai = report.aiCoverage;
    if (ai && ai.verdict !== 'off') {
      out(`ai-path coverage: ${ai.verdict}${ai.reason ? ` (${ai.reason})` : ''}`);
      const reached = Object.entries(ai.sides.new.counts).filter(([k]) => /^(model|store|arm):/.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`);
      if (reached.length) out(`  reached (new): ${reached.join(', ')}`);
      for (const side of ['old', 'new']) {
        const m = ai.sides[side].missed;
        if (m.length) out(`  ${side}: ${m.map(x => `${x.key} ${x.have}/${x.min}`).join(', ')}`);
      }
      if (ai.verdict === 'fail') out(`FAIL: the AI path was not exercised to its floors; the replay's clean result would not mean the AI path matched`);
      if (ai.verdict === 'warn') out(`WARNING: the AI path was not exercised to its floors (--ai-floor warn)`);
    }
    process.exit(report.fatal ? 2 : ai?.verdict === 'fail' ? 3 : (report.summary?.differingRequests || Object.values(report.exportsDiff || {}).some(d => d.length)) ? 1 : 0);
  }
}
