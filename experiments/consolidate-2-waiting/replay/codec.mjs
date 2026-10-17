// Tagged JSON codec: round-trips Date, Set, Map, undefined, NaN, ±Infinity, -0, RegExp,
// BigInt and Error; functions become opaque {$fn: name}. Used for capture (args) and
// for canonical comparison (sorted object keys).
export function toTagged(v, seen = new WeakSet()) {
  if (v === undefined) return { $u: 1 };
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $n: 'NaN' };
    if (v === Infinity) return { $n: 'Inf' };
    if (v === -Infinity) return { $n: '-Inf' };
    if (Object.is(v, -0)) return { $n: '-0' };
    return v;
  }
  if (typeof v === 'bigint') return { $big: String(v) };
  if (typeof v === 'function') return { $fn: v.name || '' };
  if (typeof v === 'symbol') return { $sym: String(v.description) };
  if (seen.has(v)) return { $cycle: 1 };
  seen.add(v);
  let out;
  if (v instanceof Date) out = { $date: Number.isNaN(v.getTime()) ? 'invalid' : v.toISOString() };
  else if (v instanceof RegExp) out = { $re: [v.source, v.flags] };
  else if (v instanceof Error) out = { $err: [v.name, v.message] };
  else if (v instanceof Set) out = { $set: [...v].map(x => toTagged(x, seen)) };
  else if (v instanceof Map) out = { $map: [...v].map(([k, x]) => [toTagged(k, seen), toTagged(x, seen)]) };
  else if (Array.isArray(v)) {
    out = [];
    for (let i = 0; i < v.length; i++) out.push(i in v ? toTagged(v[i], seen) : { $hole: 1 });
  } else {
    out = {};
    for (const k of Object.keys(v)) out[k.startsWith('$') ? `$$${k}` : k] = toTagged(v[k], seen);
  }
  seen.delete(v);
  return out;
}

export function fromTagged(t) {
  if (t === null || typeof t !== 'object') return t;
  if (Array.isArray(t)) {
    const a = [];
    t.forEach((x, i) => { if (!(x && x.$hole === 1)) a[i] = fromTagged(x); else a.length = i + 1; });
    return a;
  }
  if ('$u' in t) return undefined;
  if ('$n' in t) return { NaN: NaN, Inf: Infinity, '-Inf': -Infinity, '-0': -0 }[t.$n];
  if ('$big' in t) return BigInt(t.$big);
  if ('$fn' in t) { const f = function () { return undefined; }; Object.defineProperty(f, 'name', { value: t.$fn }); return f; }
  if ('$sym' in t) return Symbol(t.$sym);
  if ('$cycle' in t) return null;
  if ('$date' in t) return new Date(t.$date === 'invalid' ? NaN : t.$date);
  if ('$re' in t) return new RegExp(t.$re[0], t.$re[1]);
  if ('$err' in t) { const e = new Error(t.$err[1]); e.name = t.$err[0]; return e; }
  if ('$set' in t) return new Set(t.$set.map(fromTagged));
  if ('$map' in t) return new Map(t.$map.map(([k, x]) => [fromTagged(k), fromTagged(x)]));
  const o = {};
  for (const k of Object.keys(t)) o[k.startsWith('$$') ? k.slice(2) : k] = fromTagged(t[k]);
  return o;
}

const sortKeys = (t) => {
  if (t === null || typeof t !== 'object') return t;
  if (Array.isArray(t)) return t.map(sortKeys);
  const o = {};
  for (const k of Object.keys(t).sort()) o[k] = sortKeys(t[k]);
  return o;
};
/** Canonical string of any value (sorted keys, tagged specials). */
export const canon = (v) => JSON.stringify(sortKeys(toTagged(v)));
