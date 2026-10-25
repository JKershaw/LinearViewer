// Key-order-aware canonical JSON for one surface's output. Two outputs are the
// same only if they are byte-identical here: object keys keep insertion order
// (a reordered key is a difference), and the values JSON cannot carry (undefined,
// NaN, ±Infinity, -0, Date, Map, Set, functions) are tagged rather than dropped
// or coerced, so a change to one of them cannot pass as "no change".

export function canon(value) {
  return walk(value, new Set());
}

function walk(v, seen) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'undefined': return '{"$undef":1}';
    case 'boolean': return v ? 'true' : 'false';
    case 'string': return JSON.stringify(v);
    case 'bigint': return `{"$big":${JSON.stringify(String(v))}}`;
    case 'function': return `{"$fn":${JSON.stringify(v.name)}}`;
    case 'symbol': return `{"$sym":${JSON.stringify(String(v))}}`;
    case 'number':
      if (Number.isNaN(v)) return '{"$num":"NaN"}';
      if (v === Infinity) return '{"$num":"Infinity"}';
      if (v === -Infinity) return '{"$num":"-Infinity"}';
      if (Object.is(v, -0)) return '{"$num":"-0"}';
      return String(v);
  }
  if (seen.has(v)) return '{"$cycle":1}';
  seen.add(v);
  try {
    if (v instanceof Date) return `{"$date":${JSON.stringify(Number.isNaN(v.getTime()) ? 'Invalid' : v.toISOString())}}`;
    if (v instanceof Map) return `{"$map":[${[...v].map(([k, x]) => `[${walk(k, seen)},${walk(x, seen)}]`).join(',')}]}`;
    if (v instanceof Set) return `{"$set":[${[...v].map(x => walk(x, seen)).join(',')}]}`;
    if (Array.isArray(v)) return `[${v.map(x => walk(x, seen)).join(',')}]`;
    const parts = Object.keys(v).map(k => `${JSON.stringify(k)}:${walk(v[k], seen)}`);
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(v);
  }
}
