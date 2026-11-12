// fit.mjs — LIN-4427 (v2). The statistics for the size–cost paper, as pure functions: no network, no files, no clock.
// analyse.mjs (dispatch mode) calls these; the chart and the bridge read what analyse writes.
//
// Every number here is fixed by inputs.json before any slope is seen (the rules are read through need() in analyse.mjs):
//   - the fit is OLS of log10(USD) on log10(size), one leg at a time (floor, work, keep-alive, Survey);
//   - the interval is a 95% percentile bootstrap, resampling tickets with replacement from a seeded PRNG;
//   - a series with fewer than `minN` usable points reports no slope (its points are still shown);
//   - a point with zero size or zero cost cannot sit on a log axis: it is dropped, and the count is printed.
//
// PRNG: mulberry32, by Tommy Ettinger (public domain). The same algorithm as scripts/survey-landing-accretion.mjs:65
// and test-surplus-scripts/sites.mjs; restated here rather than imported, so the paper stays self-contained.

// mulberry32(seed) → a function returning floats in [0, 1). Deterministic for a given integer seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ordinary least squares of y on one x. Returns null when x has no spread (no slope exists).
export function olsSimple(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const se = Math.sqrt(rss / (n - 2) / sxx);
  return { n, slope, intercept, se };
}

// OLS with several regressors (rows[i] is the regressor vector for observation i, intercept included by the caller).
// Solved by Gaussian elimination on the normal equations. Returns the coefficient vector, or null when singular.
export function olsMulti(rows, ys) {
  const k = rows[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  rows.forEach((r, i) => {
    for (let p = 0; p < k; p++) {
      b[p] += r[p] * ys[i];
      for (let q = 0; q < k; q++) A[p][q] += r[p] * r[q];
    }
  });
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let q = c; q < k; q++) A[r][q] -= f * A[c][q];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

// Percentile of a sorted array, linear interpolation between order statistics.
function percentileOf(sorted, p) {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

// Seeded bootstrap of the OLS slope over tickets. Resamples that have no x spread are counted and not used.
// Returns { lo, hi, used, degenerate } with the 95% percentile interval for `level` (default 0.95).
export function bootstrapSlope(xs, ys, { seed, resamples, level = 0.95 }) {
  const rng = mulberry32(seed);
  const n = xs.length;
  const slopes = [];
  let degenerate = 0;
  for (let b = 0; b < resamples; b++) {
    const bx = new Array(n), by = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      bx[i] = xs[j]; by[i] = ys[j];
    }
    const f = olsSimple(bx, by);
    if (f === null) degenerate++; else slopes.push(f.slope);
  }
  slopes.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return { lo: percentileOf(slopes, alpha), hi: percentileOf(slopes, 1 - alpha), used: slopes.length, degenerate };
}

// The verbal reading of a slope, from its point estimate and its interval (rule fixed in inputs.json, fit.reading):
//   interval includes 1         → "straight line" (cost scales with size)
//   interval entirely below 1   → "flattens" (a fixed cost dominates)
//   interval entirely above 1   → "bends up" (each unit of size costs more than the last)
export function readingOf(slope, lo, hi) {
  if (lo === null || hi === null) return 'no reading';
  if (lo <= 1 && hi >= 1) return `${slope.toFixed(2)}: consistent with a straight line`;
  if (hi < 1) return `${slope.toFixed(2)}: flattens`;
  return `${slope.toFixed(2)}: bends up`;
}

// Fit one series. `points` are { ticket, marker, size, usd } (size and usd as numbers, possibly 0 or null).
// Returns the usable points, the dropped counts, and, when n >= minN and x has spread, the slope with its interval.
export function fitSeries(points, { seed, resamples, minN, level = 0.95 }) {
  const dropped = { zeroOrNullSize: 0, zeroOrNullCost: 0 };
  const usable = [];
  for (const p of points) {
    if (p.size === null || p.size === undefined || p.size <= 0) { dropped.zeroOrNullSize++; continue; }
    if (p.usd === null || p.usd === undefined || p.usd <= 0) { dropped.zeroOrNullCost++; continue; }
    usable.push({ ticket: p.ticket, marker: p.marker, x: Math.log10(p.size), y: Math.log10(p.usd), size: p.size, usd: p.usd });
  }
  const n = usable.length;
  const base = { n, dropped, points: usable.map(({ ticket, marker, size, usd }) => ({ ticket, marker, size, usd })) };
  if (n < minN) return { ...base, slope: null, intercept: null, ci: null, se: null, reading: `n=${n} < ${minN}: no slope` };
  const ols = olsSimple(usable.map((u) => u.x), usable.map((u) => u.y));
  if (ols === null) return { ...base, slope: null, intercept: null, ci: null, se: null, reading: 'no size spread: no slope' };
  const boot = bootstrapSlope(usable.map((u) => u.x), usable.map((u) => u.y), { seed, resamples, level });
  return { ...base, slope: ols.slope, intercept: ols.intercept, se: ols.se, ci: [boot.lo, boot.hi],
    bootstrap: { resamples, used: boot.used, degenerate: boot.degenerate },
    reading: readingOf(ols.slope, boot.lo, boot.hi) };
}

// Seeded bootstrap of several OLS coefficients over tickets: X[i] is the regressor row of ticket i (intercept included).
// Returns a percentile interval per coefficient, with the resample counts. A resample whose design is singular is counted.
export function bootstrapCoefs(X, ys, { seed, resamples, level = 0.95 }) {
  const rng = mulberry32(seed);
  const n = X.length, k = X[0].length;
  const draws = Array.from({ length: k }, () => []);
  let singular = 0;
  for (let b = 0; b < resamples; b++) {
    const bx = new Array(n), by = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      bx[i] = X[j]; by[i] = ys[j];
    }
    const beta = olsMulti(bx, by);
    if (beta === null) { singular++; continue; }
    beta.forEach((v, p) => draws[p].push(v));
  }
  const alpha = (1 - level) / 2;
  const ci = draws.map((d) => { const s = [...d].sort((a, c) => a - c); return [percentileOf(s, alpha), percentileOf(s, 1 - alpha)]; });
  return { ci, used: draws[0].length, singular };
}
