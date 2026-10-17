// Transport encoding for call arguments, so captured and generated inputs can
// be v8-serialized and revived into FRESH objects for each version.
//
//   registered provider instance  -> { __provider: name }   (revived from the
//                                     shared registry — same instance both sides)
//   function                       -> { __fn: source }       (re-compiled; a
//                                     closure over outer variables throws a
//                                     ReferenceError when called, identically
//                                     on both sides)
//   class instance (non-plain)     -> own enumerable props + { __class: name }
//   Map / Set / Date / RegExp / typed arrays / primitives -> as-is (v8 handles)
//   shared refs / cycles           -> preserved (one output object per input object)

const PLAIN = new Set([Object.prototype, null]);

export function toTransport(v, providerIds, seen = new Map()) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function') return { __fn: Function.prototype.toString.call(v), name: v.name };
    if (typeof v === 'symbol') return { __symbol: String(v.description) };
    return v;
  }
  if (providerIds && providerIds.has(v)) return { __provider: providerIds.get(v) };
  // Shared references and cycles map to ONE output object, so v8.serialize
  // (structured clone) preserves the input's aliasing graph exactly.
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Date || v instanceof RegExp || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
  let out;
  if (Array.isArray(v)) { out = []; seen.set(v, out); for (const x of v) out.push(toTransport(x, providerIds, seen)); }
  else if (v instanceof Map) { out = new Map(); seen.set(v, out); for (const [k, x] of v) out.set(toTransport(k, providerIds, seen), toTransport(x, providerIds, seen)); }
  else if (v instanceof Set) { out = new Set(); seen.set(v, out); for (const x of v) out.add(toTransport(x, providerIds, seen)); }
  else if (v instanceof Error) { out = { __error: v.name, message: v.message }; seen.set(v, out); }
  else {
    out = {};
    seen.set(v, out);
    const proto = Object.getPrototypeOf(v);
    if (!PLAIN.has(proto)) out.__class = proto?.constructor?.name || 'anonymous';
    for (const k of Object.keys(v)) {
      let x;
      try { x = v[k]; } catch (e) { x = { __getterThrew: String(e?.message || e) }; }
      out[k] = toTransport(x, providerIds, seen);
    }
    if (out.__class) {
      // carry prototype methods (fake provider classes) so they can be called
      for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const name of Object.getOwnPropertyNames(p)) {
          if (name === 'constructor' || name in out) continue;
          const d = Object.getOwnPropertyDescriptor(p, name);
          if (d && typeof d.value === 'function') out[name] = { __fn: Function.prototype.toString.call(d.value), name };
          else if (d && d.get) { try { out[name] = toTransport(d.get.call(v), providerIds, seen); } catch { /* skip */ } }
        }
      }
    }
  }
  return out;
}

function compileFn(src, name) {
  const attempts = [
    () => (0, eval)(`(${src})`),
    () => { const o = (0, eval)(`({${src}})`); return Object.values(o)[0] ?? Object.getOwnPropertyDescriptors(o)[Object.keys(o)[0]]?.get; },
    () => { const o = (0, eval)(`({${src.replace(/^async\s+/, 'async ')}})`); return o[name]; }
  ];
  for (const a of attempts) {
    try { const f = a(); if (typeof f === 'function') return f; } catch { /* next */ }
  }
  return function uncompilable() { throw new Error(`replay: captured function ${name || ''} could not be re-compiled`); };
}

export function revive(v, getProvider, done = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (done.has(v)) return done.get(v);
  if (v instanceof Date || v instanceof RegExp || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
  if (Array.isArray(v)) { done.set(v, v); for (let i = 0; i < v.length; i++) v[i] = revive(v[i], getProvider, done); return v; }
  if (v instanceof Map) { const m = new Map(); done.set(v, m); for (const [k, x] of v) m.set(revive(k, getProvider, done), revive(x, getProvider, done)); return m; }
  if (v instanceof Set) { const s = new Set(); done.set(v, s); for (const x of v) s.add(revive(x, getProvider, done)); return s; }
  if (typeof v.__provider === 'string' && Object.keys(v).length === 1) { const p = getProvider(v.__provider); done.set(v, p); return p; }
  if (typeof v.__fn === 'string') { const f = compileFn(v.__fn, v.name); done.set(v, f); return f; }
  done.set(v, v);
  for (const k of Object.keys(v)) v[k] = revive(v[k], getProvider, done);
  if (v.__class) Object.defineProperty(v, '__class', { enumerable: false, value: v.__class });
  return v;
}
