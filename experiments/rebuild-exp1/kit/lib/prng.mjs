// Seeded PRNG (mulberry32) plus the few helpers the generators need.
// Same seed ⇒ byte-identical corpus on any machine / Node version.

export function makeRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    chance: p => next() < p,
    pick: arr => arr[Math.floor(next() * arr.length)],
    // weighted pick: [[weight, value], ...]
    weighted: pairs => {
      const total = pairs.reduce((s, [w]) => s + w, 0)
      let r = next() * total
      for (const [w, v] of pairs) { if ((r -= w) < 0) return v }
      return pairs[pairs.length - 1][1]
    },
    times: (lo, hi, fn) => Array.from({ length: rng.int(lo, hi) }, (_, i) => fn(i)),
  }
  return rng
}
