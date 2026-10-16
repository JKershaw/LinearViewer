// Greedy test-case shrinker. Given an input for which `pred` holds, repeatedly
// tries smaller variants and keeps the first one for which `pred` still holds,
// until no variant does or the evaluation budget runs out. Used to turn "this
// 4 KB document differs" into "this 3-node document differs" for grouping.

const DELETE = Symbol('delete')

function replaceAt(root, path, value) {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const copy = root.slice()
    if (rest.length === 0 && value === DELETE) copy.splice(head, 1)
    else copy[head] = replaceAt(root[head], rest, value)
    return copy
  }
  const copy = { ...root }
  if (rest.length === 0 && value === DELETE) delete copy[head]
  else copy[head] = replaceAt(root[head], rest, value)
  return copy
}

function* paths(v, path = [], depth = 0) {
  if (depth > 60) return
  yield [path, v]
  if (v && typeof v === 'object') {
    const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v)
    for (const k of keys) yield* paths(v[k], [...path, k], depth + 1)
  }
}

function* chunkRemovals(len) {
  for (let size = len; size >= 1; size = Math.floor(size / 2)) {
    for (let start = 0; start + size <= len; start += size) yield [start, size]
    if (size === 1) break
  }
}

function* adfCandidates(root) {
  const all = [...paths(root)]
  // 1. shorten arrays (biggest chunks first)
  for (const [p, v] of all) {
    if (!Array.isArray(v) || v.length === 0) continue
    for (const [start, size] of chunkRemovals(v.length)) yield replaceAt(root, p, [...v.slice(0, start), ...v.slice(start + size)])
  }
  // 2. hoist: replace a (non-root) node by one of its content children
  for (const [p, v] of all) {
    if (p.length === 0 || !v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.content)) continue
    for (const child of v.content) if (child && typeof child === 'object' && !Array.isArray(child)) yield replaceAt(root, p, child)
  }
  // 3. drop object keys (never `type`)
  for (const [p, v] of all) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    for (const k of Object.keys(v)) if (k !== 'type') yield replaceAt(root, [...p, k], DELETE)
  }
  // 4. shorten strings (never a node's or mark's `type`: renaming it would turn
  //    a known node into an unknown one and change what is being exercised)
  for (const [p, v] of all) {
    if (typeof v !== 'string' || v.length === 0 || p[p.length - 1] === 'type') continue
    yield replaceAt(root, p, '')
    for (const [start, size] of chunkRemovals(v.length)) {
      if (size < v.length && (v.length <= 80 || size > 1)) yield replaceAt(root, p, v.slice(0, start) + v.slice(start + size))
    }
  }
  // 5. small numbers
  for (const [p, v] of all) {
    if (typeof v !== 'number') continue
    for (const n of [0, 1]) if (v !== n && !(p[p.length - 1] === 'level' || p[p.length - 1] === 'order')) yield replaceAt(root, p, n)
  }
}

function* mdCandidates(s) {
  if (typeof s !== 'string' || s.length === 0) return
  const lines = s.split('\n')
  if (lines.length > 1) {
    for (const [start, size] of chunkRemovals(lines.length)) if (size < lines.length) yield [...lines.slice(0, start), ...lines.slice(start + size)].join('\n')
  }
  for (const [start, size] of chunkRemovals(s.length)) {
    if (size === s.length) { yield ''; continue }
    if (s.length > 400 && size < 4) continue
    yield s.slice(0, start) + s.slice(start + size)
  }
}

export function shrink(domain, input, pred, { budget = 600 } = {}) {
  let current = input
  let evals = 0
  let steps = 0
  const gen = domain === 'adf' ? adfCandidates : mdCandidates
  outer: while (evals < budget) {
    for (const cand of gen(current)) {
      evals += 1
      let ok = false
      try { ok = pred(cand) } catch { ok = false }
      if (ok) { current = cand; steps += 1; continue outer }
      if (evals >= budget) break outer
    }
    break
  }
  return { value: current, evals, steps, exhausted: evals >= budget }
}
