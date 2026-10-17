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

// #4b: an object property whose value is `undefined` is recorded by snap() as
// {__undefined:true}. A callee reading `x.key` cannot tell it from an absent key,
// so (unless --strict-undefined) such properties are dropped before comparing
// dependency and store arguments; the raw difference is still reported as info.
export function dropUndefinedProps(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(dropUndefinedProps);
  const out = {};
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x && typeof x === 'object' && !Array.isArray(x) && x.__undefined === true && Object.keys(x).length === 1) continue;
    out[k] = dropUndefinedProps(x);
  }
  return out;
}

/** Compare two recorded outcomes; returns [{kind, detail, info?}] */
export function compareOutcomes(o, n, { strictUndefined = false } = {}) {
  const diffs = [];
  const norm = strictUndefined ? (x) => x : dropUndefinedProps;
  // Body bytes (key order and whitespace included). A JSON body that is deep-equal
  // but serialised in another key order differs here and nowhere else.
  if (o.bodySha256 !== n.bodySha256) diffs.push({ kind: 'bodyBytes', detail: { old: { bytes: o.bodyBytes, sha256: o.bodySha256 }, new: { bytes: n.bodyBytes, sha256: n.bodySha256 }, oldKeys: topKeys(o.body), newKeys: topKeys(n.body) } });
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
    ['deps', 'depCalls'],
    ['log', 'logEvent'],
    ['registry', 'credentialRegistry'],
    ['fetch', 'egressFetch'],
    ['fs', 'fsAndTty'],
    ['console', 'console'],
    ['unhandled', 'unhandledRejection'],
    ['expressErrors', 'expressErrorHandler'],
  ];
  // What the server tried to send, compared only when a client saw no
  // complete response (hang-up / socket destroyed / timeout) on either side.
  if (typeof o.status !== 'number' || typeof n.status !== 'number') {
    const a = o.calls.serverResponse; const b = n.calls.serverResponse;
    if (stableStringify(a) !== stableStringify(b)) diffs.push({ kind: 'serverResponse', detail: { old: a, new: b } });
  }
  for (const [field, kind] of callKinds) {
    const a = field === 'deps' ? norm(o.calls[field]) : o.calls[field];
    const b = field === 'deps' ? norm(n.calls[field]) : n.calls[field];
    if (field === 'deps' && !strictUndefined && stableStringify(o.calls[field]) !== stableStringify(n.calls[field]) && stableStringify(a) === stableStringify(b)) diffs.push({ kind: 'info:depCalls-undefinedProps', info: true, detail: null });
    if (stableStringify(a) !== stableStringify(b)) {
      diffs.push({ kind, detail: { paths: diffPaths(canonical(a), canonical(b), '$', [], 10), old: a, new: b } });
    }
  }
  // Store ops, one kind per store (order within a store is significant).
  // A queue write is compared as the doc the store would persist (op.persisted);
  // its raw argument object is compared too, as info only.
  const view = (op) => (op.persisted !== undefined
    ? { store: op.store, op: op.op, urlKey: op.args[0], persisted: op.persisted }
    : { store: op.store, op: op.op, args: norm(op.args) });
  const byStore = (ops) => {
    const m = {};
    for (const op of ops || []) (m[op.store] ||= []).push(view(op));
    return m;
  };
  const rawA = (o.calls.store || []).filter(x => x.persisted !== undefined).map(x => x.args);
  const rawB = (n.calls.store || []).filter(x => x.persisted !== undefined).map(x => x.args);
  if (stableStringify(rawA) !== stableStringify(rawB)) diffs.push({ kind: 'info:addItem-rawArgs', info: true, detail: { paths: diffPaths(canonical(rawA), canonical(rawB), '$', [], 10) } });
  const sa = byStore(o.calls.store);
  const sb = byStore(n.calls.store);
  for (const name of [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort()) {
    const a = sa[name] || [];
    const b = sb[name] || [];
    if (stableStringify(a) !== stableStringify(b)) {
      diffs.push({ kind: `store:${name}`, detail: { paths: diffPaths(canonical(a), canonical(b), '$', [], 10), old: a, new: b } });
    }
  }
  return diffs;
}

function topKeys(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
}
