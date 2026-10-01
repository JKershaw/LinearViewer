// LIN-3180: draw cost-mix.md's SVG charts from survey-costmix-analyse.mjs's snapshot, by hand (no dependencies).
// Usage: node scripts/survey-costmix-figures.mjs [--in data/survey-costmix/analysis.json] [--out docs/papers/harbour/figures/cost-mix]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const a = JSON.parse(readFileSync(arg('--in', 'data/survey-costmix/analysis.json'), 'utf8'));
const dir = arg('--out', 'docs/papers/harbour/figures/cost-mix');
mkdirSync(dir, { recursive: true });

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', budget: '#1d4ed8', catch: '#047857', escape: '#b91c1c', change: '#111827', over: '#9ca3af' };
const LINE = ['#1d4ed8', '#b45309', '#7c3aed', '#047857', '#db2777'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>\n`;
const CLASSES = ['credentials/auth', 'fleet machinery', 'simple-dispatcher', 'UI', 'other', 'docs/tests only'];
const sum = (xs) => xs.reduce((p, q) => p + q, 0);

// ---- Figure 1 (headline): budget share by class against its share of pre-merge catches and of escapes -------------------
{
  const faults = sum(a.catchRows.map((r) => r.realFaults)); const escN = sum(a.escRows.map((r) => r.changesWithEscape));
  const rows = [...a.mixRows.map((m) => {
    const c = a.catchRows.find((r) => r.cls === m.bucket); const e = a.escRows.find((r) => r.cls === m.bucket);
    return { k: m.bucket, budget: m.tokSepChild, budgetS: m.tokSepSession, catches: c ? (100 * c.realFaults) / faults : null, escapes: e ? (100 * e.changesWithEscape) / escN : null, changes: m.changesSep != null ? (100 * m.changesSep) / sum(a.mixRows.map((x) => x.changesSep || 0)) : null };
  })];
  const W = 900, L = 170, R = 640, T = 92, rowH = 46, B = T + rows.length * rowH;
  const xmax = Math.ceil(Math.max(...rows.flatMap((r) => [r.budget, r.catches || 0, r.escapes || 0])) / 10) * 10;
  const x = (v) => L + (v / xmax) * (R - L);
  let s = text(20, 26, 'Where September\'s budget went, by kind of change, against where review caught faults and where faults escaped', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, `Budget: share of ${Math.round(a.tokTotalM / 1000 * 10) / 10}B weighted tokens, September, charged to the child the dispatch names. Catches: real faults review found before merge`, { size: 11 });
  s += text(20, 60, `in the last 100 code-reviewed Done tickets (11–29 Sep, ${faults} faults). Escapes: changes merged June–August that a later escaped Bug names (${escN}). Both repos.`, { size: 11 });
  for (let v = 0; v <= xmax; v += 10) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${B}" stroke="${C.grid}"/>` + text(x(v), B + 16, `${v}%`, { anchor: 'middle' });
  rows.forEach((r, i) => {
    const y0 = T + i * rowH; const over = !CLASSES.includes(r.k);
    s += text(L - 10, y0 + 20, r.k, { anchor: 'end', fill: over ? C.muted : C.ink, size: 11.5 });
    s += `<rect x="${L}" y="${y0}" width="${x(r.budget) - L}" height="12" fill="${over ? C.over : C.budget}"/>` + text(x(r.budget) + 5, y0 + 10, `${r.budget}%`, { size: 10, fill: C.ink });
    if (r.catches != null) s += `<rect x="${L}" y="${y0 + 14}" width="${Math.max(1, x(r.catches) - L)}" height="10" fill="${C.catch}"/>` + text(x(r.catches) + 5, y0 + 23, `${Math.round(r.catches)}%`, { size: 10, fill: C.catch });
    if (r.escapes != null) s += `<rect x="${L}" y="${y0 + 26}" width="${Math.max(1, x(r.escapes) - L)}" height="10" fill="${C.escape}"/>` + text(x(r.escapes) + 5, y0 + 35, `${Math.round(r.escapes)}%`, { size: 10, fill: C.escape });
    if (r.changes != null) s += `<line x1="${x(r.changes)}" x2="${x(r.changes)}" y1="${y0 - 2}" y2="${y0 + 38}" stroke="${C.change}" stroke-width="2" stroke-dasharray="3 2"/>`;
  });
  let ky = T + 4; const kx = R + 40;
  for (const [col, t, sub] of [[C.budget, 'share of the budget', 'grey: spend on no merged change'], [C.catch, 'share of pre-merge catches', 'real faults, which-rules-pay codes'], [C.escape, 'share of escapes', 'changes a later Bug names'], [null, 'share of September\'s changes', '']]) {
    s += col ? `<rect x="${kx}" y="${ky - 10}" width="12" height="10" fill="${col}"/>` : `<line x1="${kx + 6}" x2="${kx + 6}" y1="${ky - 12}" y2="${ky + 2}" stroke="${C.change}" stroke-width="2" stroke-dasharray="3 2"/>`;
    s += text(kx + 18, ky, t, { fill: C.ink }) + (sub ? text(kx + 18, ky + 13, sub, { size: 10 }) : ''); ky += 34;
  }
  writeFileSync(join(dir, 'budget-vs-catches.svg'), svg(W, B + 34, s));
}

// ---- Figure 2 (headline): the bound -------------------------------------------------------------------------------------
{
  const scen = a.bound.child; const keys = Object.keys(scen); const F = a.factors.map(Number);
  const fin = F.filter((f) => Number.isFinite(f));
  const W = 900, L = 60, R = 600, T = 70, H0 = 300, B = T + H0;
  const lx = (f) => L + (Math.log(f) / Math.log(fin.at(-1))) * (R - L - 40); const xInf = R;
  const ymax = 12; const y = (v) => B - (v / ymax) * H0;
  let s = `<defs><clipPath id="plot"><rect x="${L}" y="${T - 2}" width="${R - L + 2}" height="${H0 + 4}"/></clipPath></defs>`;
  s += text(20, 26, 'The bound: fleet-wide gain in correct work per weekly budget if some spend falls by a factor and the rest is held', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Amdahl on September\'s weighted-token shares (child-named rule), assuming the same correct output. The right edge is an infinite cut.', { size: 11 });
  for (let v = 0; v <= ymax; v += 2) s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + text(L - 8, y(v) + 4, `${v}×`, { anchor: 'end' });
  for (const f of [1, 2, 3, 5, 10, 20, 50]) s += text(lx(f), B + 16, `${f}×`, { anchor: 'middle' });
  s += text(xInf, B + 16, '∞', { anchor: 'middle' });
  s += text((L + R) / 2, B + 34, 'factor by which the cut spend falls (log scale)', { anchor: 'middle', fill: C.ink });
  keys.forEach((k, i) => {
    const m = scen[k].multiples; const pts = F.map((f, j) => [Number.isFinite(f) ? lx(f) : xInf, y(m[j] ?? 1e3)]);
    s += `<path clip-path="url(#plot)" d="${pts.map((p, j) => `${j ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${LINE[i]}" stroke-width="2"/>`;
    const yl = T + 10 + i * 40;
    s += `<line x1="${R + 30}" x2="${R + 50}" y1="${yl - 4}" y2="${yl - 4}" stroke="${LINE[i]}" stroke-width="2"/>` + text(R + 56, yl, k, { fill: C.ink });
    s += text(R + 56, yl + 13, `held ${Math.round(scen[k].held * 1000) / 10}% · ceiling ${m.at(-1) == null ? '∞' : m.at(-1) + '×'}`, { size: 10 });
  });
  writeFileSync(join(dir, 'bound-curve.svg'), svg(W, B + 44, s));
}

// ---- Figure 3: the effort curve per class, with intervals --------------------------------------------------------------
{
  const cs = a.curve; const W = 900, cols = 4, cw = 210, ch = 170, T = 64, L = 20;
  const ymax = Math.min(1, Math.ceil(Math.max(...cs.flatMap((c) => c.terciles.map((t) => t.hi || 0))) * 10) / 10); const step = ymax > 0.6 ? 0.2 : 0.1;
  let s = text(20, 26, 'Does more effort for its size go with fewer wrong changes? Within each class, by tercile of working hours for size', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Changes merged June–August (mature). Point: share not correct (escaped Bug or named fix within 30 days); bar: Wilson 95% interval. Both repos.', { size: 11 });
  cs.forEach((c, i) => {
    const ox = L + (i % cols) * cw; const oy = T + Math.floor(i / cols) * (ch + 20); const pl = ox + 34, pr = ox + cw - 14, pt = oy + 22, pb = oy + ch - 26;
    const y = (v) => pb - (v / ymax) * (pb - pt); const x = (k) => pl + 18 + k * ((pr - pl - 36) / 2);
    s += text(ox + 4, oy + 12, `${c.cls} (n=${c.n})`, { fill: C.ink, weight: 600 });
    for (let v = 0; v <= ymax + 1e-9; v += step) s += `<line x1="${pl}" x2="${pr}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + text(pl - 4, y(v) + 4, `${Math.round(v * 100)}%`, { anchor: 'end', size: 9 });
    c.terciles.forEach((t, k) => {
      if (t.rate == null) return;
      s += `<line x1="${x(k)}" x2="${x(k)}" y1="${y(t.lo)}" y2="${y(t.hi)}" stroke="${C.escape}" stroke-width="1.5"/>` + `<circle cx="${x(k)}" cy="${y(t.rate)}" r="3.5" fill="${C.escape}"/>`;
      s += text(x(k), pb + 13, ['low', 'mid', 'high'][k], { anchor: 'middle', size: 9.5, fill: C.ink }) + text(x(k), pb + 24, `${t.medWorkH}h`, { anchor: 'middle', size: 9 });
    });
  });
  writeFileSync(join(dir, 'effort-curve.svg'), svg(W, T + 2 * (ch + 20) + 10, s));
}

// ---- Figure 4: the fixed part — median weighted tokens per change by size band ------------------------------------------
{
  const rs = a.floorRows; const W = 720, L = 70, R = 520, T = 70, H0 = 220, B = T + H0;
  const ymax = Math.ceil(Math.max(...rs.map((r) => r.ciM[1] || r.medTokM)) / 5) * 5; const y = (v) => B - (v / ymax) * H0;
  const x = (i) => L + 50 + i * ((R - L - 100) / (rs.length - 1));
  let s = text(20, 26, 'The fixed part: median weighted tokens per change, by production lines changed', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, `Standalone changes first dispatched and merged in September (n=${a.bornStandalone}). Bar: bootstrap 95% interval of the median.`, { size: 11 });
  for (let v = 0; v <= ymax; v += 5) s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + text(L - 8, y(v) + 4, `${v}M`, { anchor: 'end' });
  rs.forEach((r, i) => {
    s += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(r.ciM[0])}" y2="${y(r.ciM[1])}" stroke="${C.budget}" stroke-width="1.5"/>` + `<rect x="${x(i) - 5}" y="${y(r.medTokM) - 5}" width="10" height="10" fill="${C.budget}"/>`;
    s += text(x(i) + 10, y(r.medTokM) + 4, `${r.medTokM}M`, { fill: C.ink, size: 10 });
    s += text(x(i), B + 16, `${r.band} lines`, { anchor: 'middle', fill: C.ink }) + text(x(i), B + 30, `n=${r.n} · ${r.medDisp} dispatch${r.medDisp === 1 ? '' : 'es'}`, { anchor: 'middle', size: 9.5 });
  });
  writeFileSync(join(dir, 'fixed-cost.svg'), svg(W, B + 44, s));
}
console.log(`wrote ${dir}/budget-vs-catches.svg, bound-curve.svg, effort-curve.svg, fixed-cost.svg`);
