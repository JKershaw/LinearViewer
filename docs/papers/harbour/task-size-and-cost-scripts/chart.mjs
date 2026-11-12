#!/usr/bin/env node
// chart.mjs — LIN-4427 (v2). Draws the size–cost chart from an evidence folder's analysis.json (the dispatch-mode fits).
// Hand-written SVG, no dependencies, no shared helper (the ticket's "add no shared helper"). Log–log axes: size in
// production lines (primary) on x, USD on y. One series per leg (floor, work, keep-alive, Survey); a point's marker is its
// repository (circle: LinearViewer, square: simple-dispatcher). Each series with a slope is drawn as its fitted line; a
// dashed slope-1 reference passes through the pooled centroid. The legend gives each slope with its interval, n and the
// verbal reading (rule: fit.mjs readingOf). Dropped zero counts are in the caption.
//
// Usage (LinearViewer root):
//   node docs/papers/harbour/task-size-and-cost-scripts/chart.mjs <evidence-dir> [--out docs/papers/harbour/figures/task-size-and-cost/size-cost.svg]
// Then `npm run figures:theme` adds the dark-mode block.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const EV = process.argv[2];
if (!EV) { console.error('usage: chart.mjs <evidence-dir> [--out <svg>]'); process.exit(2); }
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : 'docs/papers/harbour/figures/task-size-and-cost/size-cost.svg';
const A = JSON.parse(readFileSync(path.join(EV, 'analysis.json'), 'utf8'));
const F = A.v2.fits.primary;
const LEGS = [
  { key: 'floor', label: 'floor', color: '#2a78d6' },
  { key: 'work', label: 'work', color: '#eb6834' },
  { key: 'keepAlive', label: 'keep-alive', color: '#1baf7a' },
  { key: 'survey', label: 'Survey', color: '#7c5cbf' },
];
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', ref: '#9ca3af' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const line = (x1, y1, x2, y2, stroke, o = '') => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" ${o}/>`;

// Every usable point (positive size and cost) across the four legs, for the axis range and the centroid.
const allPts = LEGS.flatMap((l) => F[l.key].points);
const xs = allPts.map((p) => Math.log10(p.size)), ys = allPts.map((p) => Math.log10(p.usd));
const pad = (lo, hi) => [Math.floor(lo), Math.ceil(hi) + (Math.ceil(hi) === Math.floor(hi) ? 1 : 0)];
const [x0, x1] = pad(Math.min(...xs, 0), Math.max(...xs, 1));
const [y0, y1] = pad(Math.min(...ys, -2), Math.max(...ys, 1));

const W = 760, H = 612, L = 78, R = 300, T = 58, B = 120;
const PX = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
const PY = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
const fmtSize = (k) => Number(10 ** k).toLocaleString('en-GB');
const fmtUsd = (k) => { const v = 10 ** k; return v >= 1 ? `$${v.toLocaleString('en-GB')}` : `$${v.toFixed(v < 0.1 ? 3 : 2)}`; };

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="Cost against size on log–log axes, one series per leg"><title>Cost against size on log–log axes, one series per leg</title><rect width="${W}" height="${H}" fill="${C.surface}"/>`;
s += text(16, 24, 'Cost against size, one series per leg', { size: 14, fill: C.ink, weight: 600 });
s += text(16, 42, `Log–log. Exact tickets, 4 Nov 05:00Z to the 12 Nov freeze; USD per leg against production lines (both repositories).`, { size: 11 });

// grid and tick labels: decades
for (let k = Math.ceil(x0); k <= x1; k++) {
  s += line(PX(k), T, PX(k), H - B, C.grid);
  s += text(PX(k), H - B + 16, fmtSize(k), { anchor: 'middle', size: 10 });
}
for (let k = Math.ceil(y0); k <= y1; k++) {
  s += line(L, PY(k), W - R, PY(k), C.grid);
  s += text(L - 8, PY(k) + 4, fmtUsd(k), { anchor: 'end', size: 10 });
}
s += line(L, T, L, H - B, C.muted) + line(L, H - B, W - R, H - B, C.muted);
s += text((L + W - R) / 2, H - B + 34, 'production lines changed (added + deleted, both repositories), log scale', { anchor: 'middle', size: 11 });
s += `<g transform="translate(16 ${(T + H - B) / 2}) rotate(-90)">${text(0, 0, 'API-equivalent USD per leg, log scale', { anchor: 'middle', size: 11 })}</g>`;

// slope-1 reference through the pooled centroid
const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
const refY = (x) => cy + (x - cx);
s += line(PX(x0), PY(refY(x0)), PX(x1), PY(refY(x1)), C.ref, 'stroke-dasharray="5 4" stroke-width="1"');

// fitted lines and points
for (const leg of LEGS) {
  const f = F[leg.key];
  if (f.slope !== null) {
    const ya = f.intercept + f.slope * x0, yb = f.intercept + f.slope * x1;
    s += line(PX(x0), PY(ya), PX(x1), PY(yb), leg.color, 'stroke-width="1.6" opacity="0.85"');
  }
  for (const p of f.points) {
    const px = PX(Math.log10(p.size)), py = PY(Math.log10(p.usd));
    s += p.marker === 'simple-dispatcher'
      ? `<rect x="${(px - 3.5).toFixed(1)}" y="${(py - 3.5).toFixed(1)}" width="7" height="7" fill="${leg.color}" fill-opacity="0.75"/>`
      : `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.6" fill="${leg.color}" fill-opacity="0.75"/>`;
  }
}

// legend: each series with its slope, interval, n and reading
const LX = W - R + 16;
s += text(LX, T + 6, 'slope (log–log), 95% interval, n', { size: 11, fill: C.ink, weight: 600 });
LEGS.forEach((leg, i) => {
  const f = F[leg.key], y = T + 26 + i * 44;
  s += `<rect x="${LX}" y="${y - 9}" width="11" height="11" fill="${leg.color}"/>`;
  s += text(LX + 18, y, leg.label, { size: 11, fill: C.ink, weight: 600 });
  const sl = f.slope === null ? 'no slope' : `${f.slope.toFixed(2)} [${f.ci[0].toFixed(2)}, ${f.ci[1].toFixed(2)}]`;
  s += text(LX + 18, y + 14, `${sl}, n=${f.n}`, { size: 10.5 });
  s += text(LX + 18, y + 27, f.reading, { size: 10.5 });
});
s += line(LX, T + 26 + 4 * 44 - 4, LX + 12, T + 26 + 4 * 44 - 4, C.ref, 'stroke-dasharray="5 4"');
s += text(LX + 18, T + 26 + 4 * 44, 'dashed: slope 1 (a straight line)', { size: 10.5 });
s += `<circle cx="${LX + 6}" cy="${T + 26 + 4 * 44 + 18}" r="3.6" fill="${C.muted}"/>` + text(LX + 18, T + 26 + 4 * 44 + 22, 'LinearViewer', { size: 10.5 });
s += `<rect x="${LX + 2.5}" y="${T + 26 + 4 * 44 + 30}" width="7" height="7" fill="${C.muted}"/>` + text(LX + 18, T + 26 + 4 * 44 + 38, 'simple-dispatcher', { size: 10.5 });

// caption: dropped zero counts, the reading rule, the fit's seed and the freeze that the numbers come from
const dropped = LEGS.map((l) => `${l.label} ${F[l.key].dropped.zeroOrNullSize}/${F[l.key].dropped.zeroOrNullCost}`).join(', ');
const cap = [
  `Dropped before each fit, as size/cost zero or null: ${dropped}. Zero primary size is not plotted.`,
  'Reading: about 1 is a straight line; above 1 bends up; below 1 flattens. OLS of log10 USD on log10 size.',
  `Bootstrap ${A.v2.bootstrap.resamples} resamples, seed ${A.v2.bootstrap.seed}; minimum n ${A.v2.bootstrap.minN} for a slope. Frozen ${A.v2.freezeFinishedAt}.`,
  'Evidence: docs/papers/harbour/task-size-and-cost-evidence/2026-11-12 (manifest.json, analysis.json).',
];
cap.forEach((c, i) => { s += text(16, H - 62 + i * 16, c, { size: 10.5 }); });
s += '</svg>\n';

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, s);
console.log(`wrote ${OUT}`);
