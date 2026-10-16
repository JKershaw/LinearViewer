// (From rung5d/replay/lib/canon.mjs.) Canonical, JSON-able form of arbitrary JS values for deep comparison.
//   - object keys are sorted (key ORDER is captured separately as `order`)
//   - Date / Map / Set / function / Error / undefined / NaN / -0 are tagged
//   - `undefined`-valued own keys are kept (distinct from an absent key)
//   - cycles become {$cycle: path}; shared (non-cyclic) refs are expanded
//   - aliasing (an output object that IS an input object, or appears twice in
//     the output) is reported separately as `alias`, never as a value diff
import { RealDate } from './hermetic.mjs';

// World deps (fake stores, injected functions) carry this symbol; canon
// encodes them as an opaque {$dep: name} so their internals never count as
// "input mutation" or "return value".
export const DEP = Symbol.for('replay-kit.dep');
export function markDep(obj, name) { try { Object.defineProperty(obj, DEP, { value: name, enumerable: false }); } catch { /* frozen */ } return obj; }

const MAX_ALIAS = 200;

export function indexInputs(value, label = '$in', index = new Map()) {
  const walk = (v, path, depth) => {
    if (!v || typeof v !== 'object' || depth > 40) return;
    if (index.has(v)) return;
    index.set(v, path);
    if (v instanceof Map) { let i = 0; for (const [, x] of v) walk(x, `${path}<${i++}>`, depth + 1); return; }
    if (v instanceof Set) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`, depth + 1);
  };
  walk(value, label, 0);
  return index;
}

function isDate(v) { return v instanceof RealDate || Object.prototype.toString.call(v) === '[object Date]'; }

export function canon(value, { inputIndex = null } = {}) {
  const order = [];
  const alias = [];
  const seenOut = new Map();
  const stack = new Set();
  const enc = (v, path) => {
    if (v === undefined) return { $u: 1 };
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number') {
      if (Number.isNaN(v)) return { $num: 'NaN' };
      if (!Number.isFinite(v)) return { $num: v > 0 ? 'Inf' : '-Inf' };
      if (Object.is(v, -0)) return { $num: '-0' };
      return v;
    }
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'bigint') return { $big: String(v) };
    if (t === 'symbol') return { $sym: String(v.description) };
    // Function NAMES are not behaviour (a rebuild may name a closure
    // differently); arity is kept.
    if (t === 'function') return v[DEP] ? { $dep: v[DEP] } : { $fn: 1, len: v.length };
    // objects
    if (v[DEP]) return { $dep: v[DEP] };
    if (stack.has(v)) return { $cycle: 1 };
    if (inputIndex && inputIndex.has(v)) { if (alias.length < MAX_ALIAS) alias.push(`${path} = ${inputIndex.get(v)}`); }
    else if (seenOut.has(v)) { if (alias.length < MAX_ALIAS) alias.push(`${path} = ${seenOut.get(v)}`); }
    else seenOut.set(v, path);
    if (isDate(v)) { const ms = RealDate.prototype.getTime.call(v); return { $date: Number.isNaN(ms) ? 'Invalid' : new RealDate(ms).toISOString() }; }
    if (v instanceof Error) return { $err: v.name, message: v.message };
    if (typeof v.then === 'function' && Object.prototype.toString.call(v) === '[object Promise]') return { $promise: 1 };
    stack.add(v);
    try {
      if (v instanceof Map) {
        const entries = [...v].map(([k, x], i) => [enc(k, `${path}<k${i}>`), enc(x, `${path}<${typeof k === 'string' ? k : i}>`)]);
        if (entries.length > 1) order.push(`${path}: map ${entries.map(e => JSON.stringify(e[0])).join(',')}`);
        entries.sort((a, b) => (JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1));
        return { $map: entries };
      }
      if (v instanceof Set) {
        const items = [...v].map((x, i) => enc(x, `${path}{${i}}`));
        if (items.length > 1) order.push(`${path}: set ${items.map(e => JSON.stringify(e)).join(',')}`);
        return { $set: items.map(x => JSON.stringify(x)).sort() };
      }
      if (Array.isArray(v)) {
        const out = [];
        for (let i = 0; i < v.length; i++) out.push(i in v ? enc(v[i], `${path}[${i}]`) : { $hole: 1 });
        return out;
      }
      const proto = Object.getPrototypeOf(v);
      const keys = Object.keys(v);
      if (keys.length > 1) order.push(`${path}: ${keys.join(',')}`);
      const o = {};
      if (proto !== Object.prototype) o.$proto = proto === null ? 'null' : (proto.constructor?.name || '?');
      for (const k of [...keys].sort()) o[k] = enc(v[k], `${path}.${k}`);
      return o;
    } finally {
      stack.delete(v);
    }
  };
  const value_ = enc(value, '$');
  return { value: value_, order, alias };
}

const short = (x, n = 240) => {
  const s = JSON.stringify(x);
  return s === undefined ? 'undefined' : (s.length > n ? s.slice(0, n) + '…' : s);
};

/** Deep diff of two canon trees. Returns up to `max` {path, old, new}. */
export function diffCanon(a, b, max = 6) {
  const out = [];
  const walk = (x, y, path) => {
    if (out.length >= max) return;
    if (x === y) return;
    const tx = x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x;
    const ty = y === null ? 'null' : Array.isArray(y) ? 'array' : typeof y;
    if (tx !== ty) { out.push({ path, old: short(x), new: short(y) }); return; }
    if (tx === 'array') {
      if (x.length !== y.length) out.push({ path: `${path}.length`, old: x.length, new: y.length });
      const n = Math.min(x.length, y.length);
      for (let i = 0; i < n; i++) walk(x[i], y[i], `${path}[${i}]`);
      return;
    }
    if (tx === 'object') {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of [...keys].sort()) {
        if (!(k in x)) { out.push({ path: `${path}.${k}`, old: '(absent)', new: short(y[k]) }); continue; }
        if (!(k in y)) { out.push({ path: `${path}.${k}`, old: short(x[k]), new: '(absent)' }); continue; }
        walk(x[k], y[k], `${path}.${k}`);
        if (out.length >= max) return;
      }
      return;
    }
    out.push({ path, old: short(x), new: short(y) });
  };
  walk(a, b, '$');
  return out;
}

export function sameJSON(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** Path → signature: drop array indices and map keys so one cause groups. */
export function sigPath(path) {
  return path.replace(/\[\d+\]/g, '[]').replace(/<[^>]*>/g, '<>');
}
