// The observable surface diff.mjs / observe.mjs compare: the three exports
// plus two round trips plus the writer→gate composition.
import { isDeepStrictEqual } from 'node:util'

export const FNS = {
  a2m: { domain: 'adf', label: 'adfToMarkdown(adf)', run: (m, x) => m.adfToMarkdown(x) },
  gate: { domain: 'adf', label: 'adfHasUnrenderableContent(adf)', run: (m, x) => m.adfHasUnrenderableContent(x) },
  rt_adf: { domain: 'adf', label: 'markdownToAdf(adfToMarkdown(adf))', run: (m, x) => m.markdownToAdf(m.adfToMarkdown(x)) },
  m2a: { domain: 'md', label: 'markdownToAdf(md)', run: (m, x) => m.markdownToAdf(x) },
  rt_md: { domain: 'md', label: 'adfToMarkdown(markdownToAdf(md))', run: (m, x) => m.adfToMarkdown(m.markdownToAdf(x)) },
  gate_m2a: { domain: 'md', label: 'adfHasUnrenderableContent(markdownToAdf(md))', run: (m, x) => m.adfHasUnrenderableContent(m.markdownToAdf(x)) },
}
export const FNS_BY_DOMAIN = {
  adf: Object.keys(FNS).filter(k => FNS[k].domain === 'adf'),
  md: Object.keys(FNS).filter(k => FNS[k].domain === 'md'),
}

/** Run one fn; never throws. Result: {ok: value} | {threw: {name, message}}. */
export function evaluate(mod, fn, input) {
  try {
    return { ok: FNS[fn].run(mod, input) }
  } catch (err) {
    const name = err && typeof err === 'object' ? (err.constructor?.name || err.name || 'Object') : typeof err
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err)
    return { threw: { name, message } }
  }
}

const jsonNormal = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/**
 * 'identical'  — strings equal / booleans equal / deepStrictEqual ADF / same error class+message / both timed out
 * 'json-equal' — differs only in ways JSON.stringify erases (undefined-valued keys, -0): identical on the wire
 * 'different'  — anything else
 */
export function compareResults(a, b) {
  if (a.timeout || b.timeout) return a.timeout && b.timeout ? 'identical' : 'different'
  if (a.threw || b.threw) return a.threw && b.threw && a.threw.name === b.threw.name && a.threw.message === b.threw.message ? 'identical' : 'different'
  if (a.unclonable || b.unclonable) return a.unclonable === b.unclonable ? 'identical' : 'different'
  if (isDeepStrictEqual(a.ok, b.ok)) return 'identical'
  if (typeof a.ok === 'object' && typeof b.ok === 'object' && a.ok && b.ok) {
    try { if (isDeepStrictEqual(jsonNormal(a.ok), jsonNormal(b.ok))) return 'json-equal' } catch { /* cyclic */ }
  }
  return 'different'
}

export function describeResult(r) {
  if (r.timeout) return 'TIMEOUT'
  if (r.threw) return `THROWS ${r.threw.name}: ${r.threw.message}`
  if (r.unclonable) return `UNCLONABLE ${r.unclonable}`
  return r.ok
}
