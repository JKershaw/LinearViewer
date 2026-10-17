// Value observation: a JSON-safe, tagged snapshot of any JS value (functions,
// Dates, errors, Maps, Sets, symbols, bigints, -0, NaN, holes, cycles, frozen
// objects, class instances). Objects keep their insertion key order in `ko`
// so key order can be compared separately from content.

import crypto from 'node:crypto';

const LONG = process.env.REPLAY_FULL_STRINGS ? Infinity : 240;

export function ser(v, { depth = 8, seen = new Map(), path = '$', shallowInstances = false, top = true, mapString = null } = {}) {
  if (v === undefined) return { $: 'undef' };
  if (v === null) return null;
  const t = typeof v;
  if (t === 'boolean') return v;
  if (t === 'number') {
    if (Number.isNaN(v)) return { $: 'num', v: 'NaN' };
    if (!Number.isFinite(v)) return { $: 'num', v: v > 0 ? 'Inf' : '-Inf' };
    if (Object.is(v, -0)) return { $: 'num', v: '-0' };
    return v;
  }
  if (t === 'string') {
    if (mapString) v = mapString(v);
    if (v.length <= LONG) return v;
    return { $: 'str', len: v.length, sha1: crypto.createHash('sha1').update(v).digest('hex').slice(0, 16), head: v.slice(0, 80), tail: v.slice(-40) };
  }
  if (t === 'bigint') return { $: 'bigint', v: String(v) };
  if (t === 'symbol') return { $: 'symbol', v: v.description ?? '' };
  if (t === 'function') return { $: 'fn', name: v.name || '' };
  if (seen.has(v)) return { $: 'cycle', to: seen.get(v) };
  if (depth <= 0) return { $: 'deep' };
  seen.set(v, path);
  const next = (x, p) => ser(x, { depth: depth - 1, seen, path: p, shallowInstances, top: false, mapString });
  try {
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') {
      const ms = Date.prototype.getTime.call(v);
      return { $: 'date', v: Number.isNaN(ms) ? 'Invalid' : new Date(ms).toISOString() };
    }
    if (v instanceof Error) {
      const props = {};
      for (const k of Object.keys(v)) props[k] = next(v[k], `${path}.${k}`);
      return { $: 'error', name: v.name, ctor: v.constructor?.name ?? null, message: mapString ? mapString(String(v.message)) : String(v.message), props, ko: Object.keys(v).join(',') };
    }
    if (v instanceof RegExp) return { $: 're', src: v.source, flags: v.flags, lastIndex: v.lastIndex };
    if (typeof v.then === 'function' && v instanceof Promise) return { $: 'promise' };
    if (v instanceof Map) return { $: 'map', entries: [...v].map(([k, x], i) => [next(k, `${path}<k${i}>`), next(x, `${path}<${i}>`)]) };
    if (v instanceof Set) return { $: 'set', items: [...v].map((x, i) => next(x, `${path}<${i}>`)) };
    if (Buffer.isBuffer(v)) return { $: 'buf', len: v.length, sha1: crypto.createHash('sha1').update(v).digest('hex').slice(0, 16) };
    if (Array.isArray(v)) {
      const items = [];
      for (let i = 0; i < v.length; i++) items.push(i in v ? next(v[i], `${path}[${i}]`) : { $: 'hole' });
      const extra = Object.keys(v).filter(k => !/^\d+$/.test(k));
      const out = { $: 'arr', items };
      if (extra.length) out.props = Object.fromEntries(extra.map(k => [k, next(v[k], `${path}.${k}`)]));
      if (Object.isFrozen(v) && v.length) out.frozen = true;
      return out;
    }
    const proto = Object.getPrototypeOf(v);
    const ctor = proto === null ? 'null-proto' : (proto === Object.prototype ? null : (proto?.constructor?.name || 'anon'));
    // Test tier: real store/collection instances are identity, not data.
    if (shallowInstances && !top && ctor && ctor !== 'null-proto') return { $: 'inst', ctor };
    const keys = Object.keys(v);
    const o = {};
    for (const k of keys) {
      let x;
      try { x = v[k]; } catch (e) { o[k] = { $: 'getter-threw', message: String(e?.message) }; continue; }
      o[k] = next(x, `${path}.${k}`);
    }
    const out = { $: 'obj', o, ko: keys.join('\u0001') };
    if (ctor) out.ctor = ctor;
    const syms = Object.getOwnPropertySymbols(v);
    if (syms.length) out.syms = syms.map(s => s.description ?? '');
    if (keys.length && Object.isFrozen(v)) out.frozen = true;
    return out;
  } finally {
    seen.delete(v);
  }
}

/** Drop key-order fields; sort keys -> stable JSON string (content identity). */
export function canon(x) {
  return JSON.stringify(strip(x));
}
function strip(x) {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === 'object') {
    const out = {};
    for (const k of Object.keys(x).sort()) {
      if (k === 'ko') continue;
      out[k] = strip(x[k]);
    }
    return out;
  }
  return x;
}

/** All key-order strings in a tree, by path (for the info-only key-order check). */
export function keyOrders(x, path = '$', out = {}) {
  if (Array.isArray(x)) { x.forEach((y, i) => keyOrders(y, `${path}[${i}]`, out)); return out; }
  if (x && typeof x === 'object') {
    if (typeof x.ko === 'string') out[path] = x.ko;
    for (const k of Object.keys(x)) if (k !== 'ko') keyOrders(x[k], k === 'o' || k === 'items' || k === 'props' ? path : `${path}.${k}`, out);
  }
  return out;
}

/** First differing path between two ser() trees (content, key order ignored). */
export function firstDiff(a, b, path = '$') {
  if (canon(a) === canon(b)) return null;
  const ta = tagOf(a); const tb = tagOf(b);
  if (ta !== tb) return { path, kind: 'type', old: brief(a), new: brief(b) };
  if (ta === 'obj') {
    const keys = [...new Set([...Object.keys(a.o), ...Object.keys(b.o)])].sort();
    for (const k of keys) {
      if (!(k in a.o)) return { path: `${path}.${k}`, kind: 'added', old: undefined, new: brief(b.o[k]) };
      if (!(k in b.o)) return { path: `${path}.${k}`, kind: 'removed', old: brief(a.o[k]), new: undefined };
      const d = firstDiff(a.o[k], b.o[k], `${path}.${k}`);
      if (d) return d;
    }
    return { path, kind: 'meta', old: brief({ ...a, o: undefined }), new: brief({ ...b, o: undefined }) };
  }
  if (ta === 'arr') {
    const n = Math.min(a.items.length, b.items.length);
    for (let i = 0; i < n; i++) { const d = firstDiff(a.items[i], b.items[i], `${path}[${i}]`); if (d) return d; }
    if (a.items.length !== b.items.length) return { path: `${path}.length`, kind: 'length', old: a.items.length, new: b.items.length };
    return { path, kind: 'meta', old: brief({ ...a, items: undefined }), new: brief({ ...b, items: undefined }) };
  }
  if (ta === 'error') {
    for (const k of ['name', 'ctor', 'message']) if (a[k] !== b[k]) return { path: `${path}.${k}`, kind: 'value', old: a[k], new: b[k] };
    const keys = [...new Set([...Object.keys(a.props), ...Object.keys(b.props)])].sort();
    for (const k of keys) {
      if (!(k in a.props)) return { path: `${path}.${k}`, kind: 'added', old: undefined, new: brief(b.props[k]) };
      if (!(k in b.props)) return { path: `${path}.${k}`, kind: 'removed', old: brief(a.props[k]), new: undefined };
      const d = firstDiff(a.props[k], b.props[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return { path, kind: 'value', old: brief(a), new: brief(b) };
}
function tagOf(x) {
  if (x === null) return 'null';
  if (typeof x !== 'object') return typeof x;
  return x.$ || 'json';
}
export function brief(v) {
  // Sorted keys, no key-order fields: a brief never encodes key order.
  const s = v === undefined ? undefined : JSON.stringify(strip(v));
  return s && s.length > 200 ? s.slice(0, 197) + '...' : s;
}

/** Collapse array indices so one root cause groups together. */
export function pathSig(p) {
  return String(p).replace(/\[\d+\]/g, '[]');
}
