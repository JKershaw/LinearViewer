// Deep comparison (object key order ignored, array order significant) and
// per-request outcome diffing.

export function canonical(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
  return out;
}

export function stableStringify(v) {
  return JSON.stringify(canonical(v));
}

/** List differing paths between a and b (bounded). */
export function diffPaths(a, b, path = '$', out = [], limit = 40) {
  if (out.length >= limit) return out;
  if (a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { out.push({ path, old: brief(a), new: brief(b) }); return out; }
  if (ta === 'array') {
    if (a.length !== b.length) out.push({ path: `${path}.length`, old: a.length, new: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n && out.length < limit; i++) diffPaths(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      if (out.length >= limit) break;
      if (!(k in a)) out.push({ path: `${path}.${k}`, old: '<absent>', new: brief(b[k]) });
      else if (!(k in b)) out.push({ path: `${path}.${k}`, old: brief(a[k]), new: '<absent>' });
      else diffPaths(a[k], b[k], `${path}.${k}`, out, limit);
    }
    return out;
  }
  if (Number.isNaN(a) && Number.isNaN(b)) return out;
  out.push({ path, old: brief(a), new: brief(b) });
  return out;
}

function brief(v) {
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 200 ? JSON.parse(JSON.stringify(s.slice(0, 200) + '…')) : v;
}

/** Normalize a path for grouping: array indices collapse to []. */
export function pathPattern(p) {
  return p.replace(/\[\d+\]/g, '[]');
}

// Headers that carry no handler-controlled information.
const VOLATILE_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);
// Headers derived purely from the body (a body diff already reports them).
const DERIVED_HEADERS = new Set(['etag', 'content-length']);

/** Compare two recorded outcomes; returns [{kind, detail}] */
export function compareOutcomes(o, n) {
  const diffs = [];
  if (o.status !== n.status) diffs.push({ kind: 'status', detail: { old: o.status, new: n.status } });

  const hk = new Set([...Object.keys(o.headers || {}), ...Object.keys(n.headers || {})]);
  for (const h of [...hk].sort()) {
    if (VOLATILE_HEADERS.has(h)) continue;
    const a = o.headers?.[h];
    const b = n.headers?.[h];
    if (a !== b) diffs.push({ kind: DERIVED_HEADERS.has(h) ? `header-derived:${h}` : `header:${h}`, detail: { old: a ?? '<absent>', new: b ?? '<absent>' } });
  }

  const bd = diffPaths(o.body, n.body);
  if (bd.length) diffs.push({ kind: 'body', detail: bd });

  const callKinds = [
    ['provider', 'providerCalls'],
    ['log', 'logEvent'],
    ['store', 'eventStore'],
    ['deps', 'depCalls'],
    ['fetch', 'egressFetch'],
    ['registry', 'credentialRegistry'],
    ['console', 'console'],
    ['unhandled', 'unhandledRejection'],
    ['expressErrors', 'expressErrorHandler'],
  ];
  for (const [field, kind] of callKinds) {
    const a = o.calls[field];
    const b = n.calls[field];
    if (stableStringify(a) !== stableStringify(b)) {
      diffs.push({ kind, detail: { paths: diffPaths(canonical(a), canonical(b), '$', [], 10), old: a, new: b } });
    }
  }
  return diffs;
}
