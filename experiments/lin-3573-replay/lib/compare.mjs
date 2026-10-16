// Per-request comparison of two recorded outcomes (status, body, handler-set headers,
// and every recorded call grouped by channel). Key order never matters.
import { sanitize, stableStringify } from './util.mjs';

const IGNORED_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'etag', 'x-powered-by', 'transfer-encoding']);

export function normalizeHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    const key = k.toLowerCase();
    if (IGNORED_HEADERS.has(key)) continue;
    out[key] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

export function groupCalls(calls) {
  const g = {};
  for (const c of calls) (g[c.ch] ||= []).push({ op: c.op, args: c.args });
  return g;
}

export function compareOutcomes(a, b) {
  const diffs = [];
  const add = (kind, detail) => diffs.push({ kind, detail });
  if (a.status !== b.status) add('status', { old: a.status, new: b.status });
  if (stableStringify(a.body) !== stableStringify(b.body)) add('body', { old: a.body, new: b.body });
  if (stableStringify(a.headers) !== stableStringify(b.headers)) add('headers', { old: a.headers, new: b.headers });
  const ga = groupCalls(a.calls); const gb = groupCalls(b.calls);
  for (const ch of new Set([...Object.keys(ga), ...Object.keys(gb)])) {
    if (stableStringify(ga[ch] || []) !== stableStringify(gb[ch] || [])) add(`calls:${ch}`, { old: ga[ch] || [], new: gb[ch] || [] });
  }
  // console output is class (c) wording; only the level sequence is compared.
  const la = a.console.map(c => c.level).join(','); const lb = b.console.map(c => c.level).join(',');
  if (la !== lb) add('console', { old: a.console, new: b.console });
  if (stableStringify(a.unhandled) !== stableStringify(b.unhandled)) add('unhandled', { old: a.unhandled, new: b.unhandled });
  if (stableStringify(a.outbound) !== stableStringify(b.outbound)) add('outbound', { old: a.outbound, new: b.outbound });
  return diffs;
}

export { sanitize };
