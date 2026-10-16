// Behavioural properties observe.mjs reports for ONE implementation, written
// as pure functions of evaluation results so the same code classifies bulk
// results (main thread) and drives the shrinker (worker thread).
import { isDeepStrictEqual } from 'node:util'
import { evaluate } from './fns.mjs'

const jsonNormal = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** A node list with the docstring's four enumerated round-trip exceptions normalised away. */
export function stripDocumentedExceptions(content) {
  const fix = (node, topLevel, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node
    let n = { ...node }
    if (n.attrs && typeof n.attrs === 'object' && 'localId' in n.attrs) { // exception 3
      const { localId, ...rest } = n.attrs
      void localId
      n.attrs = Object.keys(rest).length ? rest : undefined
      if (n.attrs === undefined) delete n.attrs
    }
    if (n.type === 'orderedList' && n.attrs && typeof n.attrs === 'object') { // exception 2
      const keys = Object.keys(n.attrs)
      if (keys.length === 0 || (keys.length === 1 && n.attrs.order === 1)) delete n.attrs
    }
    if (Array.isArray(n.content)) {
      n.content = n.content
        .filter(c => !(c && c.type === 'text' && c.text === '' && !(Array.isArray(c.marks) && c.marks.length))) // exception 1
        .map((c, i) => fix(c, false, i))
    }
    void topLevel
    void index
    return n
  }
  if (!Array.isArray(content)) return content
  return content
    .filter((b, i) => !(i > 0 && b && b.type === 'paragraph' && (b.content === undefined || (Array.isArray(b.content) && b.content.length === 0)))) // exception 4 (non-leading top-level empty paragraph)
    .map((b, i) => fix(b, true, i))
}

/**
 * Classify the ADF → md → ADF round trip of an object input.
 * 'equal' | 'equal-mod-exceptions' | 'lossy' | 'n/a' (non-object input or a throw).
 */
export function classifyAdfRoundTrip(input, rt) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !rt || !rt.ok || typeof rt.ok !== 'object') return 'n/a'
  const before = jsonNormal(input.content ?? [])
  const after = jsonNormal(rt.ok.content)
  if (isDeepStrictEqual(before, after)) return 'equal'
  if (isDeepStrictEqual(jsonNormal(stripDocumentedExceptions(input.content ?? [])), after)) return 'equal-mod-exceptions'
  return 'lossy'
}

/** Predicates the shrinker can be asked to preserve. `m` = the implementation module. */
export const PREDICATES = {
  // gate says "rebuildable" but the round trip changes the document (beyond the documented exceptions)
  rtAdfLossyWhenPermitted: (m, x) => {
    const g = evaluate(m, 'gate', x)
    return g.ok === false && classifyAdfRoundTrip(x, evaluate(m, 'rt_adf', x)) === 'lossy'
  },
  // round trip changes the document (any gate verdict)
  rtAdfLossy: (m, x) => classifyAdfRoundTrip(x, evaluate(m, 'rt_adf', x)) === 'lossy',
  // gate refuses although the round trip is exact
  gateRefusesExact: (m, x) => evaluate(m, 'gate', x).ok === true && classifyAdfRoundTrip(x, evaluate(m, 'rt_adf', x)) === 'equal',
  // Markdown normal form is not a fixpoint: rt(rt(md)) !== rt(md)
  mdNotIdempotent: (m, x) => {
    const y = evaluate(m, 'rt_md', x)
    if (!('ok' in y)) return false
    const z = evaluate(m, 'rt_md', y.ok)
    return 'ok' in z && z.ok !== y.ok
  },
  // ADF normal form is not a fixpoint
  adfNotIdempotent: (m, x) => {
    const y = evaluate(m, 'rt_adf', x)
    if (!('ok' in y)) return false
    const z = evaluate(m, 'rt_adf', y.ok)
    return 'ok' in z && !isDeepStrictEqual(jsonNormal(z.ok), jsonNormal(y.ok))
  },
  // the gate flags something the writer itself produced
  gateFlagsWriterOutput: (m, x) => evaluate(m, 'gate_m2a', x).ok === true,
  // Markdown does not survive md → ADF → md byte-for-byte
  mdNotExact: (m, x) => { const y = evaluate(m, 'rt_md', x); return 'ok' in y && y.ok !== x },
}
