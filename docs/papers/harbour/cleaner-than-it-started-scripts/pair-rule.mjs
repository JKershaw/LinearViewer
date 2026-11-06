// pair-rule.mjs — LIN-4334 (paper v2). The pair-baseline selection rule, as logged before any pair was read:
// docs/plans/survey/log.md at 1c894016, the 12:30 UTC entry (Next 2). Pure: it takes the frozen merge rows and
// returns the pairs. No git, no network, no file reads; freeze.mjs writes the rows, analyse.mjs calls this.
//
// The rule, as logged:
//   - the candidates are first-parent merges that touch a production file: a path under one of the
//     production prefixes (lib/, routes/, public/) or the file server.js;
//   - in date order, each unused candidate is paired with the next unused candidate that is within
//     window_hours after it and shares a production file with it (the same path);
//   - no merge is used twice; the first `take` pairs are the selection.
// Times are parsed with Date: the source mixes +01:00 and Z offsets, so string comparison is wrong.
//
// Rule parameters come from the inputs file (pair_baseline.rule_params), so the scripts hold no v2 constants.

export function isProductionFile(file, production) {
  return production.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));
}

// merges: [{ full, short, committed, subject, files: string[] }], in any order.
// rule: { production: string[], window_hours: number, take: number }
// Returns [{ first, second, label }] in selection order; label is '<first8>→<second8>'.
// Throws when a merge has no parseable time: a silent NaN would sort wrongly and pair the wrong merges.
export function selectPairs(merges, rule) {
  const windowMs = rule.window_hours * 3600 * 1000;
  const candidates = merges
    .map((m) => ({ ...m, t: Date.parse(m.committed), prod: new Set(m.files.filter((f) => isProductionFile(f, rule.production))) }))
    .filter((m) => m.prod.size > 0)
    .map((m) => {
      if (Number.isNaN(m.t)) throw new Error(`pair rule: merge ${m.short} has no parseable committed time: ${JSON.stringify(m.committed)}`);
      return m;
    })
    .sort((a, b) => a.t - b.t || (a.full < b.full ? -1 : a.full > b.full ? 1 : 0));

  const used = new Set();
  const pairs = [];
  for (let i = 0; i < candidates.length && pairs.length < rule.take; i++) {
    const a = candidates[i];
    if (used.has(a.full)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (b.t - a.t > windowMs) break;            // sorted by time: nothing later is within the window either
      if (used.has(b.full)) continue;
      if ([...a.prod].some((f) => b.prod.has(f))) {
        used.add(a.full);
        used.add(b.full);
        pairs.push({ first: a, second: b, label: `${a.full.slice(0, 8)}→${b.full.slice(0, 8)}` });
        break;
      }
    }
  }
  return pairs.slice(0, rule.take);
}
