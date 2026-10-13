// LIN-3551: minimal set of test files covering a universe (mutants or lines). Greedy, then exact branch-and-bound.
// Exported for analyse.mjs.

// sets: Map<file, Set<element>>; universe: Set<element> (elements not covered by any set are ignored).
export function greedy(sets, universe) {
  const left = new Set([...universe].filter((e) => [...sets.values()].some((s) => s.has(e))));
  const chosen = [];
  while (left.size) {
    let best = null, bestN = 0;
    for (const [f, s] of [...sets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      let n = 0; for (const e of s) if (left.has(e)) n++;
      if (n > bestN) { best = f; bestN = n; }
    }
    chosen.push(best); for (const e of sets.get(best)) left.delete(e);
  }
  // prune redundant files (reverse order)
  for (const f of [...chosen].reverse()) {
    const others = chosen.filter((g) => g !== f);
    const cov = new Set(others.flatMap((g) => [...sets.get(g)]));
    if ([...sets.get(f)].filter((e) => universe.has(e)).every((e) => cov.has(e))) chosen.splice(chosen.indexOf(f), 1);
  }
  return chosen.sort();
}

// Exact minimum cardinality set cover by branch and bound on the element with fewest covering sets.
// Elements are first collapsed into classes by their covering-set signature; dominated classes dropped.
export function exact(sets, universe, { timeLimitMs = 120_000, enumerateAll = false, maxSolutions = 200 } = {}) {
  const files = [...sets.keys()].sort();
  const coverers = new Map();
  for (const e of universe) {
    const c = files.filter((f) => sets.get(f).has(e));
    if (c.length) coverers.set(e, c);
  }
  // collapse identical signatures; drop an element whose coverer set is a superset of another's (implied)
  const sigs = [...new Map([...coverers.values()].map((c) => [c.join('|'), c])).values()].sort((a, b) => a.length - b.length);
  const kept = [];
  for (const c of sigs) { const cs = new Set(c); if (!kept.some((k) => k.every((f) => cs.has(f)))) kept.push(c); }
  const t0 = Date.now();
  let best = greedy(sets, universe); let bestN = best.length;
  const solutions = [];
  let timedOut = false, capped = false;
  const lowerBound = (rem) => {
    // disjoint-element bound: greedily pick elements whose coverer sets are pairwise disjoint
    let lb = 0; const used = new Set();
    for (const c of rem) if (c.every((f) => !used.has(f))) { lb++; c.forEach((f) => used.add(f)); }
    return lb;
  };
  const rec = (chosen, rem) => {
    if (Date.now() - t0 > timeLimitMs) { timedOut = true; return; }
    if (enumerateAll && solutions.length >= maxSolutions) { capped = true; return; }
    if (!rem.length) {
      if (chosen.length < bestN) { bestN = chosen.length; best = [...chosen].sort(); solutions.length = 0; }
      if (enumerateAll && chosen.length === bestN && solutions.length < maxSolutions) solutions.push([...chosen].sort());
      return;
    }
    const bound = enumerateAll ? bestN : bestN - 1;
    if (chosen.length + lowerBound(rem) > bound) return;
    let pivot = rem[0]; for (const c of rem) if (c.length < pivot.length) pivot = c;
    for (const f of pivot) {
      chosen.push(f);
      rec(chosen, rem.filter((c) => !c.includes(f)));
      chosen.pop();
      if (timedOut) return;
    }
  };
  rec([], kept);
  if (enumerateAll) {
    const uniq = [...new Map(solutions.map((s) => [s.join('|'), s])).values()];
    return { best, size: bestN, optimal: !timedOut, solutions: uniq, capped, classes: kept.length };
  }
  return { best, size: bestN, optimal: !timedOut, classes: kept.length };
}
