// Test tier, inside one test child process: wrap each export of the side's
// target so every call the existing unit tests make (directly, or through
// lib/routes/server modules that import the target) is recorded in the SAME
// observation shape the in-process tiers use (runner.mjs), so compare.mjs
// compares them unchanged. Adapted from rung5a/replay/lib/test-record.mjs:
//   - dependency calls made through the arguments (functions, and objects
//     with methods, nested up to 3 plain levels deep — `access.provider`,
//     `collections.sessions`) are recorded, attributed to the active call with
//     AsyncLocalStorage; an object a dep method returns that itself has
//     methods (a cursor) is wrapped too, so `find().toArray()` shows;
//   - a factory's returned plain object gets its methods recorded as
//     `<factory>().<method>` calls;
//   - console lines, settle mode, value (canon), key order, aliasing to the
//     args, and argument mutation;
//   - the target's optional `inspect()` runs on every settled call (privacy scan).
// Records are written as JSON at process exit to $REPLAY_REC_OUT.
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { canon, diffCanon, indexInputs, DEP } from './canon.mjs';

const als = new AsyncLocalStorage();
const records = [];
let seq = 0;
const PORT_RE = /(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}/g;
const mapPorts = (s) => (typeof s === 'string' && s.includes(':') ? s.replace(PORT_RE, '$1:PORT') : s);
const portless = (v) => JSON.parse(JSON.stringify(v ?? null, (k, x) => mapPorts(x)));
const target = process.env.REPLAY_TARGET_URL ? await import(process.env.REPLAY_TARGET_URL) : {};
const SNAP = process.env.REPLAY_SNAPSHOT_DIR || '/nonexistent';

function caller() {
  const lines = String(new Error().stack).split('\n').slice(2);
  for (const l of lines) {
    if (l.includes('/replay-kit/lib/') || l.includes('/work/run-') || l.includes('node:')) continue;
    const i = l.indexOf(SNAP);
    if (i === -1) continue;
    const m = l.slice(i + SNAP.length).match(/^\/((?:tests|routes|lib|scripts|server)[^\s):]*):(\d+)/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return 'unknown';
}

// Built-in containers are data, never deps (proxying them breaks their
// internal-slot methods).
const BUILTIN = [Map, Set, WeakMap, WeakSet, Date, RegExp, Promise, Error, ArrayBuffer, DataView];
const isBuiltin = (o) => BUILTIN.some(C => o instanceof C) || ArrayBuffer.isView(o);
const hasFnMember = (o) => {
  if (!o || typeof o !== 'object' || isBuiltin(o)) return false;
  for (let p = o, d = 0; p && p !== Object.prototype && d < 5; p = Object.getPrototypeOf(p), d++) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (k === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(p, k);
      if (desc && typeof desc.value === 'function') return true;
    }
  }
  return false;
};
const isPlain = (o) => o && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);

function logCall(name, method, args) {
  const rec = als.getStore();
  if (rec) rec.calls.push({ dep: name, method, args: portless(canon(args).value) });
}

// Strings in the data a dep handed back (with their key path), so a target's
// inspect() can check outputs for echoes of input content (privacy scans).
const MAX_DEP_STRINGS = 20000;
function collectStrings(v, p, out, seen = new Set(), depth = 0) {
  if (out.length >= MAX_DEP_STRINGS) return;
  if (typeof v === 'string') { out.push({ path: p, s: v }); return; }
  if (!v || typeof v !== 'object' || seen.has(v) || depth > 12 || v instanceof Date) return;
  seen.add(v);
  if (Array.isArray(v)) { v.forEach((x, i) => collectStrings(x, `${p}[${i}]`, out, seen, depth + 1)); return; }
  if (hasFnMember(v) && !isPlain(v)) return;
  for (const k of Object.keys(v)) collectStrings(v[k], `${p}.${k}`, out, seen, depth + 1);
}
function wrapResult(v, name) {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && typeof v.then !== 'function' && hasFnMember(v) && !v[DEP]) return proxyObject(v, name);
  const rec = als.getStore();
  if (rec && target.inspect) collectStrings(v, name, rec.depStrings || (rec.depStrings = []));
  return v;
}

function wrapFn(fn, name, method = '()') {
  if (fn[DEP]) return fn;
  const w = function (...args) {
    logCall(name, method, args);
    const r = fn.apply(this, args);
    if (r && typeof r.then === 'function') return r.then(v => wrapResult(v, `${name}${method === '()' ? '()' : '.' + method + '()'}`));
    return wrapResult(r, `${name}${method === '()' ? '()' : '.' + method + '()'}`);
  };
  Object.defineProperty(w, DEP, { value: name });
  Object.defineProperty(w, 'name', { value: fn.name });
  Object.defineProperty(w, 'length', { value: fn.length });
  return w;
}

function proxyObject(t, name) {
  return new Proxy(t, {
    get(obj, k) {
      if (k === DEP) return name;
      const v = Reflect.get(obj, k, obj);
      if (typeof v === 'function' && typeof k === 'string' && k !== 'constructor') return wrapFn(v.bind(obj), name, k);
      if (typeof v === 'function' && typeof k === 'symbol') return v.bind(obj);
      if (typeof k === 'string' && v && typeof v === 'object' && !Array.isArray(v) && hasFnMember(v)) return proxyObject(v, `${name}.${k}`);
      return v;
    }
  });
}

/** Replace deps inside the args (depth ≤ 3 through plain objects) with recorders. */
function instrument(v, name, depth = 0) {
  if (typeof v === 'function') return wrapFn(v, name);
  if (!v || typeof v !== 'object' || v instanceof Date || Array.isArray(v)) return v;
  if (!isPlain(v)) return hasFnMember(v) ? proxyObject(v, name) : v;
  if (depth >= 3) return v;
  let touched = false;
  const out = {};
  for (const k of Object.keys(v)) {
    const x = v[k];
    const y = (typeof x === 'function' || (x && typeof x === 'object' && !Array.isArray(x) && (hasFnMember(x) || isPlain(x)))) ? instrument(x, name === '$' ? k : `${name}.${k}`, depth + 1) : x;
    if (y !== x) touched = true;
    out[k] = y;
  }
  return touched ? out : v;
}

for (const m of ['log', 'warn', 'error', 'info', 'debug']) {
  const prev = console[m];
  console[m] = function (...a) {
    const rec = als.getStore();
    if (rec) rec.console.push([m, mapPorts(a.map(x => (typeof x === 'string' ? x : JSON.stringify(canon(x).value))).join(' '))]);
    return prev.apply(this, a);
  };
}

function settle(rec, args, before, mode, value, err) {
  rec.mode = mode;
  if (err !== undefined) rec.error = err && typeof err === 'object' ? { name: err.name, ctor: err.constructor?.name, message: mapPorts(String(err.message)) } : { thrown: canon(err).value };
  if (mode === 'return' || mode === 'resolve') {
    const idx = indexInputs(args, '$args');
    const c = canon(value, { inputIndex: idx });
    rec.value = portless(c.value); rec.order = c.order; rec.alias = c.alias;
    if (target.inspect) {
      try { rec.findings = target.inspect({ scenario: { tier: 'test', world: null, args }, step: { fn: rec.fn }, obs: rec, result: value, args }) || null; } catch (e) { rec.findings = [{ kind: 'inspect-error', sig: `inspect threw ${e.message}` }]; }
    }
  }
  const after = portless(canon(args).value);
  rec.inputMutated = JSON.stringify(before) !== JSON.stringify(after);
  rec.inputAfter = rec.inputMutated ? after : null;
  rec.inputMutation = rec.inputMutated ? diffCanon(before, after, 4) : [];
  delete rec.depStrings;
}

export function wrapExport(name, real, { factoryMethods = false } = {}) {
  if (typeof real !== 'function') return real;
  const wrapped = function (...args) {
    const rec = { seq: seq++, fn: name, caller: caller(), calls: [], console: [], storeResultMutation: [], unhandled: [] };
    records.push(rec);
    const callArgs = args.map((a, i) => instrument(a, args.length === 1 ? '$' : `arg${i}`));
    const before = portless(canon(callArgs).value);
    let ret;
    try {
      ret = als.run(rec, () => real.apply(this, callArgs));
    } catch (e) {
      settle(rec, callArgs, before, 'throw', undefined, e);
      throw e;
    }
    if (ret && typeof ret.then === 'function') {
      rec.returnsPromise = true;
      return ret.then(
        (v) => { settle(rec, callArgs, before, 'resolve', v); return v; },
        (e) => { settle(rec, callArgs, before, 'reject', undefined, e); throw e; }
      );
    }
    rec.returnsPromise = false;
    settle(rec, callArgs, before, 'return', ret);
    if (factoryMethods && isPlain(ret)) {
      const out = {};
      for (const [k, v] of Object.entries(ret)) out[k] = typeof v === 'function' ? wrapExport(`${name}().${k}`, v) : v;
      return out;
    }
    return ret;
  };
  Object.defineProperty(wrapped, 'name', { value: real.name });
  Object.defineProperty(wrapped, 'length', { value: real.length });
  return wrapped;
}

process.on('exit', () => {
  for (const r of records) if (!r.mode) r.mode = 'pending';
  if (process.env.REPLAY_REC_OUT) fs.writeFileSync(process.env.REPLAY_REC_OUT, JSON.stringify(records));
});
