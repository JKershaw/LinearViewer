#!/usr/bin/env node
// Behavioural replay of two versions of Harbour's dispatch routers:
// routes/dispatch.js (session + consumer lane), routes/proxy-dispatch.js and
// routes/proxy-kickoff.js (proxy lane). See README.md.
//
//   node replay.mjs --old <dirOrFiles> --new <dirOrFiles> [--n 6000] [--seed 1] [--out report.json]
//                   [--coverage] [--lib DIR] [--tiers gen,edge,test] [--only <id>] [--quiet]
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import util from 'node:util';
import crypto from 'node:crypto';
import { createRequire, register, syncBuiltinESMExports } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = '/home/user/LinearViewer';
const VIRTUAL_TMP = '/replay-virtual-tmp';

function parseArgs(argv) {
  const o = { old: path.join(TOOL_DIR, 'pinned', 'origin-main'), new: null, n: 6000, seed: 1, out: null, coverage: false, lib: DEFAULT_REPO, tiers: 'gen,edge,test', only: null, quiet: false, keepWork: false, timeoutMs: 5000 };
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
    else if (a === '-h' || a === '--help') { process.stdout.write(readFileSync(path.join(TOOL_DIR, 'README.md'), 'utf8')); process.exit(0); }
    else { process.stderr.write(`unknown argument: ${a}\n`); process.exit(2); }
  }
  if (!o.new) { process.stderr.write('usage: node replay.mjs --old <dirOrFiles> --new <dirOrFiles> [--n 6000] [--seed 1] [--out f] [--coverage] [--lib DIR]\n'); process.exit(2); }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const out = (s) => process.stdout.write(s + '\n');
const realStderr = (s) => process.stderr.write(s);

// ===========================================================================
// 1. Hermetic process
// ===========================================================================
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS']) delete process.env[k];
for (const k of ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY', 'DISPATCH_OWNERLESS_BROKER_COMPAT', 'HARBOUR_FILE_POINTER_PILOT', 'MONGODB_URI', 'LINEAR_API_KEY']) delete process.env[k];
process.env.NODE_ENV = 'test';
process.env.TMPDIR = VIRTUAL_TMP; // HARBOUR_STAGING_DIR resolves under here; every write there is intercepted
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

const vclock = await import('./lib/vclock.mjs');
const { real, RealDate } = vclock.install();
const { FIXED_NOW, mulberry32, snap, materialize } = await import('./lib/common.mjs');
vclock.setIdleNow(FIXED_NOW);

let coverageSession = null;
if (opts.coverage) {
  const { startCoverage } = await import('./lib/coverage.mjs');
  coverageSession = await startCoverage();
}

// Seeded randomUUID (per-request Math.random), identical on both sides.
const cryptoCjs = createRequire(import.meta.url)('node:crypto');
cryptoCjs.randomUUID = () => {
  const h = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ---------------------------------------------------------------------------
// fs + /dev/tty interception: the Harbour OS staging file and the OSC spawn
// write never touch the disk or a terminal; both are recorded.
// ---------------------------------------------------------------------------
let active = null; // { ctx } while a request runs, { importCensus } while importing
const fsCjs = createRequire(import.meta.url)('node:fs');
const FAKE_TTY_FD = 987654;
const underVirtualTmp = (p) => typeof p === 'string' && (p === VIRTUAL_TMP || p.startsWith(VIRTUAL_TMP + '/'));
const sha1 = (d) => crypto.createHash('sha1').update(typeof d === 'string' ? d : Buffer.from(d)).digest('hex').slice(0, 16);
const fsOrig = { mkdirSync: fsCjs.mkdirSync, writeFileSync: fsCjs.writeFileSync, openSync: fsCjs.openSync, writeSync: fsCjs.writeSync, closeSync: fsCjs.closeSync };
const fsRec = (e) => { if (active?.ctx) active.ctx.rec.fs.push(e); else if (active?.importCensus) active.importCensus.fs.push(e); };
fsCjs.mkdirSync = function mkdirSync(p, o) {
  if (!underVirtualTmp(String(p))) return fsOrig.mkdirSync.apply(this, arguments);
  fsRec({ op: 'mkdirSync', path: String(p), options: snap(o) });
  if (active?.ctx?.sc.staging?.mkdirThrow) { const e = new Error(`EACCES: permission denied, mkdir '${p}'`); e.code = 'EACCES'; throw e; }
  return undefined;
};
fsCjs.writeFileSync = function writeFileSync(p, d, o) {
  if (!underVirtualTmp(String(p))) return fsOrig.writeFileSync.apply(this, arguments);
  fsRec({ op: 'writeFileSync', path: String(p), bytes: Buffer.byteLength(typeof d === 'string' ? d : Buffer.from(d)), sha1: sha1(d), options: snap(o) });
  if (active?.ctx?.sc.staging?.writeThrow) { const e = new Error(`ENOSPC: no space left on device, open '${p}'`); e.code = 'ENOSPC'; throw e; }
  return undefined;
};
fsCjs.openSync = function openSync(p) {
  if (String(p) !== '/dev/tty') return fsOrig.openSync.apply(this, arguments);
  const ok = active?.ctx?.sc.tty === 'ok';
  fsRec({ op: 'tty.open', ok });
  if (!ok) { const e = new Error("ENXIO: no such device or address, open '/dev/tty'"); e.code = 'ENXIO'; throw e; }
  return FAKE_TTY_FD;
};
fsCjs.writeSync = function writeSync(fd, data) {
  if (fd !== FAKE_TTY_FD) return fsOrig.writeSync.apply(this, arguments);
  const s = String(data);
  let payload = s;
  const m = /^\x1b\]harbour:spawn;(.*)\x07$/s.exec(s);
  if (m) { try { payload = JSON.parse(m[1]); } catch { payload = m[1]; } }
  fsRec({ op: 'tty.write', osc: !!m, payload: snap(payload) });
  return Buffer.byteLength(s);
};
fsCjs.closeSync = function closeSync(fd) {
  if (fd !== FAKE_TTY_FD) return fsOrig.closeSync.apply(this, arguments);
  fsRec({ op: 'tty.close' });
};
for (const k of ['mkdir', 'writeFile', 'open']) {
  const orig = fsCjs.promises[k];
  fsCjs.promises[k] = async function (p, ...rest) {
    if (underVirtualTmp(String(p))) { fsRec({ op: `promises.${k}`, path: String(p) }); return k === 'open' ? { write: async () => ({}), close: async () => {} } : undefined; }
    return orig.call(this, p, ...rest);
  };
}
syncBuiltinESMExports();

// Egress: none of these routers may fetch; any fetch is recorded and refused.
globalThis.fetch = async (url, init) => {
  if (active?.ctx) active.ctx.rec.fetch.push({ url: String(url), method: init?.method ?? 'GET' });
  throw new TypeError('fetch failed (replay: egress disabled)');
};

// ---------------------------------------------------------------------------
// Console + async faults
// ---------------------------------------------------------------------------
let workDir = null;
const normalise = (s) => {
  let t = s.replace(/\n\s+at .*/g, '');
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

// ===========================================================================
// 2. Sides, hook, imports
// ===========================================================================
const report = { tool: 'dispatch routers behavioural replay (rung 5c)', lib: opts.lib, libHead: gitHead(opts.lib), seed: opts.seed, n: opts.n, tiers: opts.tiers, fatal: null };
function gitHead(dir) { try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }

const { resolveSide, layoutSide, SLOT_FILES } = await import('./lib/prepare.mjs');
workDir = path.join(TOOL_DIR, 'work', `run-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
const sides = [];
for (const [label, spec] of [['old', opts.old], ['new', opts.new]]) {
  let side;
  try { side = resolveSide(spec); } catch (e) { report.fatal = `${label}: ${e.message}`; break; }
  if (side.missing.length) { report.fatal = `${label}: no file for ${side.missing.join(', ')} in ${spec}`; break; }
  sides.push({ ...layoutSide(label, workDir, side), spec });
}
if (report.fatal) finish();
report.old = Object.fromEntries(Object.entries(sides[0].copies).map(([k, v]) => [k, v.src]));
report.new = Object.fromEntries(Object.entries(sides[1].copies).map(([k, v]) => [k, v.src]));

const ch = new MessageChannel();
const resolutions = [];
ch.port1.on('message', (m) => resolutions.push(m));
ch.port1.unref();
register(pathToFileURL(path.join(TOOL_DIR, 'lib/hooks.mjs')).href, import.meta.url, {
  data: { sides: sides.map(s => ({ label: s.label, workRootUrl: s.workRootUrl, workRoutesPath: s.workRoutesPath, srcDirs: s.srcDirs })), libRoot: opts.lib, fallbackRoot: DEFAULT_REPO, port: ch.port2 },
  transferList: [ch.port2],
});

const fakes = await import('./lib/fakes.mjs');
const { compareOutcomes, pathPattern, diffPaths, canonical } = await import('./lib/compare.mjs');
const gen = await import('./lib/gen.mjs');

// Production error plumbing first (server.js installs it before any router).
const libUrl = (p, label) => `${pathToFileURL(path.join(opts.lib, p)).href}${label ? `?side=${label}` : ''}`;
for (const s of sides) (await import(libUrl('lib/async-errors.js', s.label))).installAsyncErrorForwarding();
const express = (await import(pathToFileURL(resolveExpress()).href)).default;
function resolveExpress() {
  for (const root of [opts.lib, DEFAULT_REPO]) { const p = path.join(root, 'node_modules/express/index.js'); if (existsSync(p)) return p; }
  throw new Error('express not found');
}

async function importCopy(side, slot) {
  const copy = side.copies[slot];
  const census = { console: [], unhandled: [], fs: [], envReads: [], newGlobals: [], socketEscapes: [], modulesFirstLoaded: [], sideResolutions: [] };
  active = { importCensus: census };
  const realEnv = process.env;
  const reads = new Set();
  process.env = new Proxy(realEnv, { get(t, k) { if (typeof k === 'string') reads.add(k); return Reflect.get(t, k); } });
  const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));
  const escBefore = socketEscapes.length;
  const resolBefore = resolutions.length;
  let mod; let importError = null;
  try { mod = await import(copy.url); } catch (e) { importError = { name: e.name, message: e.message }; } finally { process.env = realEnv; }
  await new Promise(r => real.setImmediate(r));
  await new Promise(r => real.setTimeout(r, 20));
  census.envReads = [...reads].filter(k => k !== 'WATCH_REPORT_DEPENDENCIES').sort();
  census.newGlobals = Object.getOwnPropertyNames(globalThis).filter(k => !globalsBefore.has(k));
  census.socketEscapes = socketEscapes.slice(escBefore);
  const mine = resolutions.slice(resolBefore);
  census.modulesFirstLoaded = mine.length;
  census.sideResolutions = mine.filter(r => r.side === side.label && (r.via === 'side' || r.via === 'side-copied')).map(r => ({ specifier: r.specifier, via: r.via }));
  active = null;
  const factory = mod?.[SLOT_FILES[slot].factory];
  if (!importError && typeof factory !== 'function') importError = { name: 'MissingExport', message: `module does not export ${SLOT_FILES[slot].factory}` };
  return { mod, factory, census, importError };
}

const imported = {};
report.importSideEffects = {};
for (const side of sides) {
  imported[side.label] = {};
  report.importSideEffects[side.label] = {};
  for (const slot of Object.keys(SLOT_FILES)) {
    const r = await importCopy(side, slot);
    imported[side.label][slot] = r;
    report.importSideEffects[side.label][slot] = { ...r.census, importError: r.importError };
    if (r.importError && !report.fatal) report.fatal = `${side.label}/${slot}: import failed: ${r.importError.message}`;
  }
}
if (report.fatal) finish();

const exportShape = (mod) => {
  const o = {};
  for (const k of Object.keys(mod || {}).sort()) {
    const v = mod[k];
    if (typeof v === 'function') o[k] = { __fn: v.name, length: v.length };
    else o[k] = snap(v);
  }
  return o;
};
report.exportsDiff = {};
for (const slot of Object.keys(SLOT_FILES)) report.exportsDiff[slot] = diffPaths(canonical(exportShape(imported.old[slot].mod)), canonical(exportShape(imported.new[slot].mod)));

// Per-side lib instances (same ones the side's routers import) + vocabulary.
const libs = {};
const holders = {};
for (const s of sides) {
  libs[s.label] = await fakes.loadSideLibs(opts.lib, s.label);
  holders[s.label] = { label: s.label, ctx: null };
  fakes.patchRegistry(holders[s.label], libs[s.label]);
}
const K = await loadVocabulary();
async function loadVocabulary() {
  const pt = await import(libUrl('lib/prompt-templates.js', 'gen'));
  const per = await import(libUrl('lib/periodicals.js', 'gen'));
  const ds = await import(libUrl('lib/dispatch-store.js', 'gen'));
  return {
    TEMPLATE_KEYS: Object.keys(pt.PROMPT_TEMPLATES), DDK: pt.DISPATCH_DEFAULT_KINDS, PERIODICAL_AUTOPILOT_TAIL: per.PERIODICAL_AUTOPILOT_TAIL,
    gateMarker: per.buildPeriodicalGateMarker(per.getPeriodicals().find(p => p.id === 'security-review')?.title || 'Security Review'),
    FEEDBACK_ENTRY_KINDS: ds.FEEDBACK_ENTRY_KINDS,
  };
}

// ===========================================================================
// 3. Apps: per side, session lane x {full, sparse}, proxy lane x {full, sparse, noQueue}
// ===========================================================================
const apps = {};
for (const side of sides) {
  const holder = holders[side.label];
  const lib = libs[side.label];
  const im = imported[side.label];
  apps[side.label] = { session: {}, proxy: {} };
  for (const variant of fakes.SESSION_VARIANTS) {
    const mem = { items: [] };
    let router;
    try { router = im.session.factory(fakes.buildSessionDeps(holder, lib, variant, mem)); } catch (e) { report.fatal = `${side.label}/session/${variant}: factory threw: ${e.message}`; finish(); }
    apps[side.label].session[variant] = await listen(holder, lib, [router], { mem });
  }
  for (const variant of fakes.PROXY_VARIANTS) {
    const mem = { items: [] };
    const deps = fakes.buildProxyDeps(holder, lib, variant, mem);
    let kick; let disp;
    try {
      kick = im.kickoff.factory(deps.kickoff);
      disp = im.proxyDispatch.factory(deps.dispatch);
    } catch (e) { report.fatal = `${side.label}/proxy/${variant}: factory threw: ${e.message}`; finish(); }
    // routes/proxy.js order: kickoff router (:1576) then dispatch router (:1580)
    apps[side.label].proxy[variant] = await listen(holder, lib, [kick, disp], { mem, buildProvider: deps.buildProvider });
  }
}

async function listen(holder, lib, routers, extra) {
  const app = express();
  app.use((req, res, next) => {
    const ctx = holder.ctx;
    if (ctx) {
      ctx.res = res;
      // a client that goes away mid-request: armed when the request reaches the app
      if (ctx.sc.clientAbortAfterMs) setTimeout(() => { ctx.rec.deps.push({ fn: 'client.abort', atMs: ctx.sc.clientAbortAfterMs }); res.socket?.destroy(); }, ctx.sc.clientAbortAfterMs);
      const chunks = [];
      const w = res.write.bind(res);
      const e = res.end.bind(res);
      res.write = (c, ...a) => { if (c != null && typeof c !== 'function') chunks.push(Buffer.from(c)); return w(c, ...a); };
      res.end = (c, ...a) => { if (c != null && typeof c !== 'function') chunks.push(Buffer.from(c)); return e(c, ...a); };
      // what the server sent/attempted, snapshotted at the END of the request (after drain)
      ctx.resSnapshot = () => ({ statusCode: res.statusCode, ended: res.writableEnded, headersSent: res.headersSent, contentType: String(res.getHeader('content-type') || ''), body: Buffer.concat(chunks).toString('utf8').slice(0, 4000) });
    }
    next();
  });
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '250kb' }));
  app.use((req, res, next) => { req.session = buildSession(holder.ctx?.sc.session); next(); });
  for (const r of routers) app.use(r);
  app.use(finalErrorHandler(holder, lib));
  const server = await new Promise((resolve) => { const srv = app.listen(0, '127.0.0.1', () => resolve(srv)); });
  return { server, port: server.address().port, ...extra };
}

function buildSession(spec) {
  if (!spec) return {};
  return JSON.parse(JSON.stringify(spec));
}

// Transcription of server.js's final error handler (origin/main). HTML pages
// are stubbed; the stack in the 500 log line is reduced to name + message.
function finalErrorHandler(holder, lib) {
  const errorsLib = lib.errors;
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    holder.ctx?.rec.expressErrors.push({ name: err?.name, message: normalise(String(err?.message)), status: err?.status ?? err?.statusCode, type: err?.type });
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

// ===========================================================================
// 4. One request
// ===========================================================================
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
    const req = http.request({ host: '127.0.0.1', port, method: sc.method, path: sc.path, headers, agent: false, setHost: !headers.host }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
      res.on('error', (e) => done({ status: 'NO_RESPONSE', error: e.message, headers: {}, buf: Buffer.alloc(0) }));
      res.on('aborted', () => done({ status: 'NO_RESPONSE', error: 'aborted mid-body', headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    const timer = real.setTimeout(() => { req.destroy(new Error('replay timeout')); }, opts.timeoutMs);
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
  if (ct.startsWith('text/')) {
    const t = r.buf.toString('utf8');
    return { __text: t.length > 3000 ? { length: t.length, sha256: crypto.createHash('sha256').update(t).digest('hex'), head: t.slice(0, 1500) } : t };
  }
  return { __bytes: r.buf.length, sha256: crypto.createHash('sha256').update(r.buf).digest('hex') };
}

const MANAGED_ENV = ['NODE_ENV', 'OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY', 'DISPATCH_OWNERLESS_BROKER_COMPAT', 'HARBOUR_FILE_POINTER_PILOT'];
function applyEnv(env) {
  // every managed key is set from the scenario or removed: nothing leaks across requests
  for (const k of new Set([...MANAGED_ENV, ...Object.keys(env || {})])) {
    const v = env?.[k] ?? (k === 'NODE_ENV' ? 'test' : undefined);
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const { newRecorder } = await import('./lib/common.mjs');
async function runOne(sideLabel, sc) {
  const holder = holders[sideLabel];
  const lib = libs[sideLabel];
  const lane = sc.lane === 'either' ? 'session' : sc.lane;
  const app = apps[sideLabel][lane][sc.variant] || apps[sideLabel][lane].full;
  const ctx = { sc, rec: newRecorder(), callCounts: new Map(), res: null, provider: null };
  if (lane === 'proxy' && sc.provider) ctx.provider = app.buildProvider(materialize(sc.provider, lib));
  else if (lane === 'proxy') ctx.provider = app.buildProvider({ name: 'linear' });
  holder.ctx = ctx;
  active = { ctx };
  Math.random = mulberry32(sc.randomSeed);
  applyEnv(sc.env);
  vclock.begin(sc.clockBase, ctx.rec.timers);
  let r = null;
  const p = send(app.port, sc).then(v => { r = v; });
  // virtual timers fire only while the handler is waiting (its response not yet ended)
  await vclock.pumpUntil(() => r !== null, () => !!ctx.res && !ctx.res.writableEnded);
  await p;
  // a request whose client went away (or was answered early) keeps running server-side
  if (typeof r.status !== 'number' || (ctx.res && !ctx.res.writableEnded)) await vclock.drain(120_000);
  // flush fire-and-forget work (taskModeStore.record, recordEvent, …) into THIS request
  for (let k = 0; k < 6; k++) await new Promise(res => real.setImmediate(res));
  await new Promise(res => real.setTimeout(res, 0));
  for (let k = 0; k < 2; k++) await new Promise(res => real.setImmediate(res));
  ctx.rec.serverResponse = ctx.resSnapshot ? ctx.resSnapshot() : null;
  ctx.rec.timersPending = vclock.end();
  active = null;
  holder.ctx = null;
  const headers = {};
  for (const [k, v] of Object.entries(r.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
  return { status: r.status, transportError: r.error, headers, body: decodeBody(r), calls: ctx.rec };
}

// ===========================================================================
// 5. Scenarios
// ===========================================================================
const tiers = opts.tiers.split(',').map(s => s.trim()).filter(Boolean);
function* scenarios() {
  if (tiers.includes('gen')) {
    const sched = gen.schedule(opts.seed, opts.n);
    for (let i = 0; i < sched.length; i++) yield () => gen.generateScenario(opts.seed, i, K, sched[i]);
  }
  if (tiers.includes('edge')) {
    const { edgeScenarios } = edgeMod;
    const list = edgeScenarios(opts.seed, K);
    for (const sc of list) yield () => sc;
  }
  if (tiers.includes('test')) {
    const { testScenarios } = edgeMod;
    for (const sc of testScenarios(opts.seed, K, path.join(TOOL_DIR, 'pinned', 'test-calls.json'))) yield () => sc;
  }
}
const edgeMod = await import('./lib/edge.mjs');

const groups = new Map();
const perRoute = {};
const perTier = {};
const perIntent = {};
let total = 0;
let differing = 0;
const onlyDetail = [];
const t0 = performance.now();
for (const make of scenarios()) {
  const sc = make();
  if (opts.only && sc.id !== opts.only) continue;
  const o = await runOne('old', sc);
  const nn = await runOne('new', sc);
  total++;
  const pt = (perTier[sc.tier] ||= { requests: 0, differing: 0 });
  pt.requests++;
  const ep = (perRoute[sc.routeKey] ||= { requests: 0, differing: 0, byTier: {}, oldStatus: {}, newStatus: {}, statusLogPairs: {}, tags: {} });
  ep.requests++;
  ep.byTier[sc.tier] = (ep.byTier[sc.tier] || 0) + 1;
  ep.oldStatus[o.status] = (ep.oldStatus[o.status] || 0) + 1;
  ep.newStatus[nn.status] = (ep.newStatus[nn.status] || 0) + 1;
  const sStatus = typeof o.status === 'number' ? o.status : `${o.status}(server ${o.calls.serverResponse?.statusCode ?? '-'})`;
  const pair = `${sStatus} | logEvent ${o.calls.log.map(l => l.status).join(',') || '-'}`;
  ep.statusLogPairs[pair] = (ep.statusLogPairs[pair] || 0) + 1;
  for (const tag of outcomeTags(sc, o)) ep.tags[tag] = (ep.tags[tag] || 0) + 1;
  if (sc.tier === 'edge') { const pi = (perIntent[`${sc.routeKey} ${sc.intent}`] ||= {}); pi[pair] = (pi[pair] || 0) + 1; }
  const diffs = compareOutcomes(o, nn);
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
      if (!gEntry.example) gEntry.example = { id: sc.id, request: { method: sc.method, path: sc.path, headers: sc.headers, body: trim(sc.body) }, difference: trim(d.detail), old: summarize(o), new: summarize(nn) };
    }
  }
  if (!opts.quiet && total % 1000 === 0) realStderr(`[replay] ${total} requests, ${differing} differing\n`);
}
const elapsedMs = Math.round(performance.now() - t0);

function outcomeTags(sc, o) {
  const b = o.body || {};
  const t = [`variant:${sc.variant}`];
  if (sc.intent) t.push(`intent:${sc.intent}`);
  if (b.code) t.push(`code:${b.code}`);
  if (b.statusCode) t.push(`keepaliveFlushed:${b.statusCode}`);
  if (b.reason && typeof b.reason === 'string') t.push(`reason:${b.reason}`);
  if (b.spawn) t.push(`spawn:${b.spawn.success}`);
  if (b.warning) t.push('warning');
  if (b.budgetPosition) t.push('budgetPosition');
  if (b.override) t.push('override');
  if (b.descent) t.push('descent');
  if (b.halt) t.push('halt');
  if (o.headers['retry-after']) t.push('retry-after');
  if (o.calls.fs.some(f => f.op === 'tty.write')) t.push('ttyWrite');
  if (o.calls.store.some(s => s.op === 'addItem')) t.push('enqueued');
  if (o.calls.store.some(s => s.op === 'mintGrantBootstrap')) t.push('declaredMint');
  if (o.calls.deps.some(d => d.fn === 'client.hangUp' || d.fn === 'client.abort')) t.push('clientGone');
  return t;
}

// ===========================================================================
// 6. Coverage + report
// ===========================================================================
if (coverageSession) {
  const { takeCoverage, lineCoverage } = await import('./lib/coverage.mjs');
  const cov = await takeCoverage(coverageSession);
  report.coverage = {};
  for (const side of sides) {
    report.coverage[side.label] = {};
    const walk = (d) => readdirSync(d).flatMap(f => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk(side.workRoutesPath)) {
      const url = pathToFileURL(f).href;
      const scov = cov.find(c => c.url === url);
      const rel = path.relative(side.workRoutesPath, f);
      report.coverage[side.label][rel] = scov ? lineCoverage(readFileSync(f, 'utf8'), scov) : { error: 'not loaded' };
    }
  }
}
for (const side of sides) for (const lane of ['session', 'proxy']) for (const a of Object.values(apps[side.label][lane])) await new Promise(r => a.server.close(r));

const thin = [];
for (const [rk, ep] of Object.entries(perRoute)) for (const [p, c] of Object.entries(ep.statusLogPairs)) if (c < 5) thin.push({ route: rk, pair: p, count: c });
report.summary = { requests: total, differingRequests: differing, groups: groups.size, perTier, elapsedMs, socketEscapesDuringReplay: socketEscapes.length, fetchAttempts: null };
report.perRoute = perRoute;
report.edgeOutcomes = perIntent;
report.thinStatusLogPairs = thin;
report.differences = [...groups.values()].sort((a, b) => b.count - a.count);
if (opts.only) report.onlyDetail = onlyDetail;
finish();

function summarize(o) { return trim({ status: o.status, transportError: o.transportError, headers: o.headers, body: o.body, calls: o.calls }); }
function trim(v, depth = 0) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + `…(+${v.length - 300})`;
    return v;
  }
  if (depth > 10) return '…';
  if (Array.isArray(v)) { const h = v.slice(0, 8).map(x => trim(x, depth + 1)); if (v.length > 8) h.push(`…(+${v.length - 8} more)`); return h; }
  const o = {};
  for (const k of Object.keys(v)) o[k] = trim(v[k], depth + 1);
  return o;
}

function finish() {
  const outFile = path.resolve(opts.out || path.join(TOOL_DIR, 'work', 'report.json'));
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  if (!opts.keepWork && workDir) rmSync(workDir, { recursive: true, force: true });
  if (report.fatal) out(`FATAL: ${report.fatal}`);
  if (report.summary) {
    const s = report.summary;
    out(`replay: ${s.requests} requests (seed ${opts.seed}; ${Object.entries(s.perTier).map(([k, v]) => `${k} ${v.requests}`).join(', ')}) in ${s.elapsedMs} ms; differing: ${s.differingRequests} in ${s.groups} groups`);
    for (const g of report.differences.slice(0, 30)) out(`  ${String(g.count).padStart(5)}  ${g.endpoint}  [${g.kind}]  e.g. ${g.example.id} ${g.example.request.method} ${String(g.example.request.path).slice(0, 70)}`);
    if (report.differences.length > 30) out(`  … ${report.differences.length - 30} more groups in the report`);
    for (const [slot, d] of Object.entries(report.exportsDiff || {})) if (d.length) out(`  exports differ (${slot}): ${d.map(x => x.path).join(', ')}`);
    for (const [label, files] of Object.entries(report.coverage || {})) for (const [f, c] of Object.entries(files)) if (c.pct !== undefined) out(`  coverage ${label} ${f}: ${c.pct}% (${c.coveredLines}/${c.executableLines}); uncovered: ${c.uncovered.map(u => u.line).join(', ') || 'none'}`);
    if (socketEscapes.length) out(`WARNING: ${socketEscapes.length} non-loopback socket attempts were blocked`);
  }
  out(`report: ${outFile}`);
  process.exit(report.fatal ? 2 : (report.summary?.differingRequests || Object.values(report.exportsDiff || {}).some(d => d.length)) ? 1 : 0);
}
