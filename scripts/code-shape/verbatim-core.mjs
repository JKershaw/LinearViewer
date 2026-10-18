// Verbatim share: how much of the new code's non-trivial lines appear word for word in the old (LIN-3628).
// Pure: file contents in, data out. From experiments/verbatim/verbatim.mjs (line rules) and
// experiments/consolidate-4-entrance/4c/verbatim/vb.mjs (trailing-semicolon normalisation).
// Line rules: trimmed; blank lines, punctuation-only lines, comment lines and import / export-from
// statements are ignored; matching is a multiset over all old files together.

// Strip import / export-from statements (including multi-line ones) before line-splitting.
const stripImports = (src) => src
  .replace(/^[ \t]*import\b[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
  .replace(/^[ \t]*import\s*['"][^'"\n]+['"][ \t]*;?/gm, '')
  .replace(/^[ \t]*export\s*(\*|\{)[^;]*?\bfrom\s*['"][^'"\n]+['"][ \t]*;?/gm, '');

const TRIVIAL = /^[{}\[\]();,\s]*$/;
export const nonTrivialLines = (src) => stripImports(src).split('\n').map((l) => l.trim())
  .filter((l) => l && !TRIVIAL.test(l) && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));

const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : null);

// regionOf(path) names the region of a NEW file. New files are consumed in sorted path order so the
// split between regions (and the location of the longest run) is reproducible.
export function measureVerbatim({ oldFiles, newFiles, regionOf = () => '(all)' }) {
  const share = (norm) => {
    const f = norm ? (l) => l.replace(/;$/, '') : (l) => l;
    const pool = new Map();
    let oldLines = 0;
    for (const path of Object.keys(oldFiles).sort()) {
      for (const l of nonTrivialLines(oldFiles[path])) { pool.set(f(l), (pool.get(f(l)) || 0) + 1); oldLines++; }
    }
    let newLines = 0, matched = 0;
    let longest = { length: 0, file: null, ntLine: null };
    const regions = new Map();
    for (const path of Object.keys(newFiles).sort()) {
      const region = regionOf(path);
      if (!regions.has(region)) regions.set(region, { region, files: 0, newLines: 0, matched: 0 });
      const r = regions.get(region);
      r.files++;
      // A run is within one file: it starts over at each file.
      let run = 0, runStart = 0, i = 0;
      for (const l0 of nonTrivialLines(newFiles[path])) {
        const l = f(l0);
        newLines++; r.newLines++; i++;
        const c = pool.get(l) || 0;
        if (c > 0) {
          pool.set(l, c - 1); matched++; r.matched++;
          if (run === 0) runStart = i;
          run++;
          if (run > longest.length) longest = { length: run, file: path, ntLine: runStart };
        } else run = 0;
      }
    }
    return {
      newLines, oldLines, matched,
      newVerbatimPct: pct(matched, newLines), oldSurvivingPct: pct(matched, oldLines),
      longestRun: longest,
      regions: [...regions.values()].sort((a, b) => (a.region < b.region ? -1 : 1))
        .map((r) => ({ ...r, newVerbatimPct: pct(r.matched, r.newLines) })),
    };
  };
  const raw = share(false), normalised = share(true);
  const { regions, ...rawTotals } = raw;
  const { regions: regionsNormalised, ...normTotals } = normalised;
  return {
    raw: rawTotals,
    semicolonsNormalised: normTotals,
    regions: regions.map((r, i) => ({
      region: r.region, files: r.files, newLines: r.newLines,
      raw: { matched: r.matched, newVerbatimPct: r.newVerbatimPct },
      semicolonsNormalised: { matched: regionsNormalised[i].matched, newVerbatimPct: regionsNormalised[i].newVerbatimPct },
    })),
  };
}
