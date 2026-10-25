// Generator + fake-world helpers shared by the targets' generators.
//   - Rng: a per-input PRNG from (seed, tier, index), so `--only gen:1234`
//     reproduces one input at any --n.
//   - canary(): distinctive marker strings to seed into fields that must never
//     reach an output (privacy scans grep the output for them).
//   - recordDep(): wraps a fake's methods so every call is recorded on the
//     current step (io.call), results are handed out (io.handOut, for
//     store-result-mutation checks), and an object result that has methods
//     (a cursor) is recorded too (`name.find()`); the wrapper is marked as an
//     opaque dep for canon.
//   - deliver(): the failure-injection modes (sync/throw/reject/…) of rung5d's fakes.
//   - memCollection(): an in-memory MangoDB collection — the real MangoDB
//     query matcher, projection and aggregation engine over a private array —
//     plus a `mock` flavour shaped like the unit tests' hand-rolled mocks.
import { mulberry32, hash32 } from './hermetic.mjs';
import { markDep } from './canon.mjs';
import { MangoCollection } from '../../../node_modules/@jkershaw/mangodb/dist/collection.js';

export class Rng {
  constructor(seed, tier, index) { this.r = mulberry32(hash32(`${seed}|${tier}|${index}`)); }
  next() { return this.r(); }
  int(lo, hi) { return lo + Math.floor(this.r() * (hi - lo + 1)); }
  chance(p) { return this.r() < p; }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  weighted(pairs) { const tot = pairs.reduce((s, [, w]) => s + w, 0); let x = this.r() * tot; for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[pairs.length - 1][0]; }
  hex(n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(this.r() * 16).toString(16); return s; }
  shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  subset(arr, p = 0.5) { return arr.filter(() => this.r() < p); }
}

/** A canary string naming the field it was planted in. */
export const CANARY_RE = /cnry-[a-z0-9]+-[0-9a-f]{4,}/gi;
export function canary(rng, field) { return `cnry-${String(field).toLowerCase().replace(/[^a-z0-9]/g, '')}-${rng.hex(6)}`; }

export function deliver(mode, value, label) {
  switch (mode) {
    case 'sync': return value;
    case 'throw': throw new Error(`fake ${label} failed (sync)`);
    case 'reject': return Promise.reject(new Error(`fake ${label} failed (async)`));
    case 'rejectBare': return Promise.reject(`fake ${label} failed (bare string)`);
    case 'rejectNotFound': return Promise.reject(new Error(`Issue not found: ${label}`));
    case 'typeerror': throw new TypeError(`fake ${label}: cannot read properties of undefined`);
    default: return Promise.resolve(value);
  }
}

const hasMethods = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v instanceof Date) return false;
  for (let p = v; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) { if (k !== 'constructor') { const d = Object.getOwnPropertyDescriptor(p, k); if (d && typeof d.value === 'function') return true; } }
  }
  return false;
};

/**
 * Record every method call on `impl` as `name.method(args)`.
 * `opts.pure`: the calls are info-only (a pure injected helper).
 */
export function recordDep(name, impl, io, opts = {}) {
  const wrapRes = (v, label) => (hasMethods(v) ? recordDep(label, v, io, opts) : io.handOut(v));
  if (typeof impl === 'function') {
    const f = function (...args) {
      io.call(name, '()', args, opts.pure ? { pure: true } : {});
      const r = impl.apply(this, args);
      if (r && typeof r.then === 'function') return r.then(v => wrapRes(v, `${name}()`));
      return wrapRes(r, `${name}()`);
    };
    Object.defineProperty(f, 'length', { value: impl.length });
    return markDep(f, name);
  }
  const out = {};
  for (let p = impl; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const k of Object.getOwnPropertyNames(p)) {
      if (k === 'constructor' || k in out) continue;
      const d = Object.getOwnPropertyDescriptor(p, k);
      if (!d || typeof d.value !== 'function') continue;
      out[k] = function (...args) {
        io.call(name, k, args, opts.pure ? { pure: true } : {});
        const r = impl[k](...args);
        if (r && typeof r.then === 'function') return r.then(v => wrapRes(v, `${name}.${k}()`));
        return wrapRes(r, `${name}.${k}()`);
      };
    }
  }
  for (const k of Object.keys(impl)) if (!(k in out)) out[k] = impl[k];
  return markDep(out, name);
}

class MemCollection extends MangoCollection {
  constructor(docs) { super('/nonexistent-replay-kit', 'db', 'mem'); this._docs = docs; }
  async readDocuments() { return structuredClone(this._docs); }
}

/**
 * A collection over `docs` (Dates preserved). flavour:
 *   'mango'       real MangoDB semantics incl. aggregate()
 *   'mango-noagg' the same without aggregate() (the find fallback)
 *   'mock'        the unit tests' mock: JS comparisons for $gte/$gt/$lt/$lte
 *                 and equality, no projection, no aggregate
 *   'mock-naive'  ignores filter and projection (a careless test double)
 * fail: { method: 'throw'|'reject'|'rejectBare' } — injected failures
 * (cursor methods: 'toArray' fails the cursor's toArray).
 */
export function memCollection(docs, { flavour = 'mango', fail = {} } = {}) {
  // A cursor-returning method (find/aggregate) fails the way a driver does:
  // 'throw' throws synchronously; 'reject'/'rejectBare' hand back a cursor
  // whose toArray() rejects.
  const failWrap = (method, fn) => {
    if (!fail[method]) return fn;
    if ((method === 'find' || method === 'aggregate') && fail[method] !== 'throw') return () => ({ toArray: () => deliver(fail[method], undefined, method) });
    return () => deliver(fail[method], undefined, method);
  };
  const cursorOf = (p) => ({ toArray: failWrap('toArray', () => p()) });
  if (flavour === 'mock-naive') {
    // Like many test doubles: ignores the filter and the projection entirely.
    return {
      find: failWrap('find', () => cursorOf(async () => structuredClone(docs))),
      countDocuments: failWrap('countDocuments', async () => docs.length),
    };
  }
  if (flavour === 'mock') {
    const fieldMatches = (value, c) => {
      if (c && typeof c === 'object' && !(c instanceof Date)) {
        if ('$gte' in c) return value >= c.$gte;
        if ('$gt' in c) return value > c.$gt;
        if ('$lt' in c) return value < c.$lt;
        if ('$lte' in c) return value <= c.$lte;
      }
      return value === c;
    };
    const matches = (doc, filter) => Object.entries(filter || {}).every(([k, c]) => fieldMatches(doc[k], c));
    return {
      find: failWrap('find', (filter = {}) => cursorOf(async () => structuredClone(docs.filter(d => matches(d, filter))))),
      countDocuments: failWrap('countDocuments', async (filter = {}) => docs.filter(d => matches(d, filter)).length),
    };
  }
  const c = new MemCollection(docs);
  const out = {
    find: failWrap('find', (filter = {}, options = {}) => { const cur = c.find(filter, options); return cursorOf(() => cur.toArray()); }),
    countDocuments: failWrap('countDocuments', (filter = {}) => c.countDocuments(filter)),
  };
  if (flavour === 'mango') out.aggregate = failWrap('aggregate', (pipeline) => { const cur = c.aggregate(pipeline); return cursorOf(() => cur.toArray()); });
  return out;
}

/** Every string anywhere in `v` (keys excluded), with its path. */
export function stringsIn(v, path = '$', out = [], seen = new Set()) {
  if (typeof v === 'string') { out.push({ path, s: v }); return out; }
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (v instanceof Map) { for (const [k, x] of v) { stringsIn(k, `${path}<k>`, out, seen); stringsIn(x, `${path}<v>`, out, seen); } return out; }
  if (v instanceof Set) { for (const x of v) stringsIn(x, `${path}{}`, out, seen); return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => stringsIn(x, `${path}[${i}]`, out, seen)); return out; }
  for (const k of Object.keys(v)) { stringsIn(k, `${path}.<key>`, out, seen); stringsIn(v[k], `${path}.${k}`, out, seen); }
  return out;
}
