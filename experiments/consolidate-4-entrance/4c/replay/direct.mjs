#!/usr/bin/env node
// Direct-call class for the dispatch-entrance authority (#4c).
//
// No HTTP request can reach `enterSessionDispatch` without the route's owner gate, so the
// HTTP replay cannot see whether the authority fails closed when the gate is missing, or
// where it runs the gate. This calls each side's lib/dispatch-entrance.js directly (each side
// its own module instance, through the replay's side-tagging hook) with recording
// dependencies, and compares, per case: whether it threw (and the message), every dependency
// call in order with its arguments, every gate call and its position, and what was answered.
// It also compares the module's export surface (names, typeof, arity).
//
//   node direct.mjs --old <tree> --new <tree> [--n 600] [--seed 1] [--out reports/direct.json]
//   exit 0 = identical, 1 = differences, 2 = tool failure
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const TOOL = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const OLD = path.resolve(arg('--old', ''));
const NEW = path.resolve(arg('--new', ''));
const N = Number(arg('--n', 600));
const SEED = Number(arg('--seed', 1));
const OUT = path.resolve(arg('--out', path.join(TOOL, 'reports', `direct-seed${SEED}.json`)));
if (!existsSync(path.join(OLD, 'lib/dispatch-entrance.js')) || !existsSync(path.join(NEW, 'lib/dispatch-entrance.js'))) {
  process.stderr.write('usage: node direct.mjs --old <tree> --new <tree>\n'); process.exit(2);
}

// Hermetic: no proxy, no model keys, no non-loopback socket.
for (const k of Object.keys(process.env)) if (/PROXY|OPENROUTER|MONGODB_URI|LINEAR_API_KEY/i.test(k)) delete process.env[k];
process.env.NODE_ENV = 'test';
let escapes = 0;
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = typeof a[0] === 'object' && a[0] ? a[0] : { host: a[1] };
  const h = o.host ?? o.hostname;
  if (!(typeof o.path === 'string' || h === undefined || h === '127.0.0.1' || h === '::1' || h === 'localhost')) { escapes++; throw new Error('direct: blocked connect'); }
  return origConnect.apply(this, a);
};
// A fixed clock.
const RealDate = Date;
const FIXED = RealDate.UTC(2026, 9, 1, 12, 0, 0);
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };

const ch = new MessageChannel();
ch.port1.on('message', () => {}); ch.port1.unref();
register(pathToFileURL(path.join(TOOL, 'lib/hooks.mjs')).href, import.meta.url, {
  data: { roots: { old: OLD, new: NEW }, fallbackRoot: '/home/user/LinearViewer', port: ch.port2 }, transferList: [ch.port2]
});
const load = (root, label) => import(`${pathToFileURL(path.join(root, 'lib/dispatch-entrance.js')).href}?side=${label}`);
const mods = { old: await load(OLD, 'old'), new: await load(NEW, 'new') };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const safe = (v, d = 0) => {
  if (d > 6) return '[deep]';
  if (v === undefined) return '[undefined]';
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? '[fn]' : v;
  if (v instanceof RealDate) return v.toISOString();
  if (Array.isArray(v)) return v.map(x => safe(x, d + 1));
  return Object.fromEntries(Object.keys(v).map(k => [k, safe(v[k], d + 1)]));
};

// One case: a body, a gate shape, and the gate's verdict.
const GATES = ['absent', 'null', 'true', 'string', 'object', 'refuse', 'pass', 'throws', 'rejects'];
const TARGETS = [undefined, 'cli', 'web', 'dash', 'local', 'bogus', 7];
function makeBody(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const b = {};
  const shape = pick(['valid', 'valid', 'valid', 'noPrompt', 'abort', 'abortFollow', 'cascade', 'badKind', 'badPreset', 'issue', 'badEntryRung', 'followUp', 'rawNull']);
  if (shape === 'rawNull') return null;
  if (shape !== 'noPrompt' && shape !== 'abort' && shape !== 'cascade') b.prompt = pick(['p', 'do the thing', '']);
  const t = pick(TARGETS); if (t !== undefined) b.target = t;
  if (shape === 'abort' || shape === 'abortFollow' || shape === 'cascade') { b.abort = true; b.abortTo = pick(['s-1', undefined, 5]); }
  if (shape === 'abortFollow' || shape === 'followUp') b.followUpTo = pick(['3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'nope']);
  if (shape === 'cascade') b.cascade = pick([true, 'yes']);
  if (shape === 'badKind') b.kind = pick(['nope', 'autopilot', 'research']);
  if (shape === 'badPreset') b.presetId = pick(['', 'preset-1', 'missing', 3]);
  if (shape === 'issue') { b.issueIdentifier = pick(['LIN-1', 'LIN-404']); b.issueSource = pick([undefined, 'linear']); }
  if (shape === 'badEntryRung') b.entryRung = pick(['nope', 'run']);
  if (r() < 0.2) b.attachProxy = pick([true, false, 'x']);
  return b;
}

async function runCase(mod, kase) {
  const events = [];
  const rec = (name) => async (...args) => {
    events.push({ dep: name, args: safe(args) });
    if (name === 'addItem') return { _id: 'item-1', dispatchedAt: new RealDate(FIXED), ...args[1] };
    if (name === 'presets.get') return args[1] === 'preset-1' ? { id: 'preset-1' } : null;
    if (name === 'expandCascadeAborts') return { emitted: 0 };
    if (name === 'listTokens') return [];
    return null;
  };
  const store = (prefix, methods) => Object.fromEntries(methods.map(m => [m, rec(`${prefix ? prefix + '.' : ''}${m}`)]));
  const responses = [];
  const res = {
    headersSent: false,
    status(code) { responses.push({ status: code }); return this; },
    json(body) { if (!responses.length) responses.push({ status: 200 }); responses.at(-1).body = safe(body); return this; },
    set(k, v) { events.push({ header: [k, v] }); return this; },
    setHeader(k, v) { events.push({ header: [k, v] }); },
    on() { return this; }, once() { return this; }, removeListener() { return this; }
  };
  const gateFns = {
    refuse: async (target) => { events.push({ gate: safe(target) }); res.status(403).json({ error: 'owner only' }); return true; },
    pass: async (target) => { events.push({ gate: safe(target) }); return false; },
    throws: (target) => { events.push({ gate: safe(target) }); throw new Error('gate down'); },
    rejects: async (target) => { events.push({ gate: safe(target) }); throw new Error('gate down'); }
  };
  const gateVal = { absent: undefined, null: null, true: true, string: 'gate', object: {} }[kase.gate];
  const ctx = {
    req: { body: kase.body, session: { accountId: 'acct-1' }, protocol: 'http', get: (h) => (h === 'host' ? 'localhost:3000' : undefined) },
    res,
    workspace: { urlKey: 'alpha', id: 'ws-alpha', provider: 'linear' },
    dispatchQueueStore: store('', ['addItem', 'expandCascadeAborts', 'getItemStatus', 'getGrantDeclaration', 'listItems', 'countItems']),
    dispatchTokenStore: store('tokens', ['listTokens']),
    dispatchPresetsStore: store('presets', ['get']),
    workspacePreferencesStore: store('prefs', ['get', 'getPreferences', 'getWorkspacePreferences']),
    afterEnqueue: rec('afterEnqueue'),
    ...(kase.gate === 'absent' ? {} : { ownerGate: gateFns[kase.gate] ?? gateVal })
  };
  let threw = null;
  const saved = { error: console.error, warn: console.warn, log: console.log };
  for (const k of Object.keys(saved)) console[k] = (...a) => events.push({ console: k, text: a.map(x => (x instanceof Error ? x.message : String(x))).join(' ') });
  try { await mod.enterSessionDispatch(ctx); } catch (e) { threw = String(e?.message); } finally { Object.assign(console, saved); }
  return { threw, events, responses };
}

const exportShape = (m) => Object.fromEntries(Object.keys(m).sort().map(k => [k, typeof m[k] === 'function' ? `fn/${m[k].length}` : typeof m[k]]));
const report = { old: OLD, new: NEW, seed: SEED, n: N, exports: { old: exportShape(mods.old), new: exportShape(mods.new) }, cases: 0, differing: 0, groups: {}, examples: [] };
report.exportsDiffer = JSON.stringify(report.exports.old) !== JSON.stringify(report.exports.new);
const r = rng(SEED);
const cases = [];
for (const g of GATES) for (const body of [{ prompt: 'p' }, { prompt: 'p', target: 'dash' }, {}, { abort: true, abortTo: 's-1', target: 'dash' }]) cases.push({ gate: g, body });
while (cases.length < N) cases.push({ gate: GATES[Math.floor(r() * GATES.length)], body: makeBody(r) });
for (const kase of cases) {
  const a = await runCase(mods.old, kase);
  const b = await runCase(mods.new, kase);
  report.cases++;
  const kinds = [];
  if ((a.threw === null) !== (b.threw === null)) kinds.push('threw');
  else if (a.threw !== b.threw) kinds.push('throwText');
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) kinds.push('events');
  if (JSON.stringify(a.responses) !== JSON.stringify(b.responses)) kinds.push('responses');
  if (kinds.length) {
    report.differing++;
    for (const k of kinds) report.groups[k] = (report.groups[k] || 0) + 1;
    if (report.examples.length < 10) report.examples.push({ kase: safe(kase), kinds, old: a, new: b });
  }
}
// The fail-closed property itself, judged on each side (not only old-vs-new).
const failClosed = {};
for (const side of ['old', 'new']) {
  const bad = [];
  for (const g of ['absent', 'null', 'true', 'string', 'object']) {
    const out = await runCase(mods[side], { gate: g, body: { prompt: 'p', target: 'cli', presetId: 'preset-1' } });
    if (out.threw === null || out.events.length || out.responses.length) bad.push(g);
  }
  failClosed[side] = bad.length ? `FAILS for ${bad.join(', ')}` : 'holds';
}
report.failClosed = failClosed;
report.socketEscapes = escapes;
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
process.stdout.write(`direct: ${report.cases} cases, ${report.differing} differing ${JSON.stringify(report.groups)}; exports ${report.exportsDiffer ? 'DIFFER' : 'identical'}; fail-closed old=${failClosed.old} new=${failClosed.new}; escapes ${escapes}\nreport: ${OUT}\n`);
process.exit(report.differing || report.exportsDiffer || failClosed.new !== 'holds' ? 1 : 0);
