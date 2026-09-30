// LIN-3165: draw model-choice.md's three SVG charts (who did the work, whole-life cost per correct change, the afterlife curve) from survey-model-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-model-figures.mjs [--in data/survey-model/analysis.json] [--out docs/papers/harbour/figures/model-choice]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-model/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/model-choice');
mkdirSync(outDir, { recursive: true });

// Categorical order fixed by tier; checked with the dataviz validator (light surface): all checks pass, cheap needs its direct label.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', marker: '#9ca3af', frontier: '#2a78d6', mid: '#eb6834', cheap: '#1baf7a', unattributed: '#cbd5e1' };
const TIERS = ['frontier', 'mid', 'cheap'];
const LABEL = { frontier: 'frontier', mid: 'mid', cheap: 'cheap', unattributed: 'tier not stated' };
const DAY = 86400000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.rotate ? ` transform="rotate(${o.rotate} ${x.toFixed(1)} ${y.toFixed(1)})"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const t0 = (iso) => Date.parse(iso + 'T00:00:00Z');
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Routing changes (the per-kind model rule; see the paper's timeline). Short labels only.
const ROUTING = [
  ['2026-07-05', 'cheap harness added'],
  ['2026-07-12', 'sessions run at the chosen tier: implementation → mid'],
  ['2026-07-20', 'close-out → frontier'],
  ['2026-08-07', 'row-atomic routing'],
  ['2026-09-08', 'cheap bake-off'],
  ['2026-09-11', 'review effort → medium'],
  ['2026-09-25', 'implementation → cheap'],
];
// Each routing change is a numbered dashed line; the key under the chart names them.
function markers(x, top, bottom, from, to, labelled = true) {
  let s = '';
  ROUTING.forEach(([d], i) => {
    const ms = t0(d); if (ms < from || ms > to) return;
    const X = x(ms);
    s += `<line x1="${X}" x2="${X}" y1="${top}" y2="${bottom}" stroke="${C.marker}" stroke-dasharray="3 3"/>`;
    if (labelled) s += text(X + 3, top + 10 + (i % 2) * 11, String(i + 1), { size: 9.5, fill: C.ink, weight: 600 });
  });
  return s;
}
const routingKey = (x0, y, perLine = 4) => ROUTING.map(([d, label], i) => `${i + 1} ${label} (${fmtDate(t0(d))})`).reduce((lines, item, i) => { (lines[Math.floor(i / perLine)] ||= []).push(item); return lines; }, []).map((items, k) => text(x0, y + k * 13, items.join('   ·   '), { size: 9.5 })).join('');
const provisional = (x, top, h, to) => `<rect x="${x(t0('2026-08-31')).toFixed(1)}" y="${top}" width="${(x(to) - x(t0('2026-08-31'))).toFixed(1)}" height="${h}" fill="#f3f4f6"/>`;
function axisY(x0, x1, y, max, ticks, fmt = (v) => v) {
  let s = '';
  for (let i = 0; i <= ticks; i++) { const v = (max * i) / ticks; const Y = y(v); s += `<line x1="${x0}" x2="${x1}" y1="${Y}" y2="${Y}" stroke="${C.grid}"/>` + text(x0 - 6, Y + 4, fmt(v), { anchor: 'end', size: 10 }); }
  return s;
}
function axisX(x, y, from, to, stepDays) {
  let s = '';
  for (let ms = from; ms <= to; ms += stepDays * DAY) s += text(x(ms), y, fmtDate(ms), { anchor: 'middle', size: 10 });
  return s;
}
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil(v / p) * p; };

// ---- 1. Who did the work: changes merged per week by implementer tier, per repo (since January); fleet working hours by session tier.
{
  const W = 920, H = 600, L = 60, R = 20;
  const from = t0('2026-01-05'), to = t0('2026-09-28') + 7 * DAY;
  const x = (ms) => L + ((ms - from) / (to - from)) * (W - L - R);
  const bw = (7 * DAY / (to - from)) * (W - L - R);
  let s = svgOpen(W, H, 'Who did the work: changes merged per week by implementer tier in each repo, and fleet working hours by session tier');
  s += text(L, 20, 'Who did the work, by tier', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 36, 'Commits by their Co-Authored-By trailer (a cheap-tier session or a person leaves none: grey); fleet working hours by the tier each session ran at', { size: 10.5 });
  const weeks = {};
  for (const [wk, byRepo] of Object.entries(A.commitWeek)) for (const [repo, v] of Object.entries(byRepo)) (weeks[repo] ||= {})[wk] = v;
  const panels = [['LinearViewer', 70, 140, 'commits on main a week by the tier their trailer names'], ['simple-dispatcher', 250, 90, 'commits on main a week']];
  for (const [repo, top, h, what] of panels) {
    const rows = Object.fromEntries(Object.entries(weeks[repo] || {}).filter(([wk]) => t0(wk) >= from)); const max = niceMax(Math.max(...Object.values(rows).map((w) => Object.values(w).reduce((a, b) => a + b, 0))));
    const y = (v) => top + h - (v / max) * h;
    s += axisY(L, W - R, y, max, 2) + text(L, top - 4, `${repo}: ${what}`, { size: 11, fill: C.ink, weight: 600 });
    for (const [wk, w] of Object.entries(rows)) {
      const X = x(t0(wk)); let base = 0;
      for (const t of [...TIERS, 'unattributed']) { const v = w[t] || 0; if (!v) continue; s += `<rect x="${(X + 1).toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" fill="${C[t]}"/>`; base += v; }
    }
    s += markers(x, top, top + h, from, to, repo === 'LinearViewer');
  }
  s += axisX(x, 356, t0('2026-01-05'), to, 28);
  // B: fleet working hours by session tier (runner oplog, from 12 July).
  const top = 400, h = 110; const fw = Object.entries(A.fleetWeek).filter(([w]) => w >= '2026-07-06');
  const max = niceMax(Math.max(...fw.map(([, v]) => TIERS.reduce((a, t) => a + (v.hours[t] || 0), 0))));
  const hx0 = t0('2026-07-06'); const hx = (ms) => L + ((ms - hx0) / (to - hx0)) * (W - L - R); const hbw = (7 * DAY / (to - hx0)) * (W - L - R);
  const y = (v) => top + h - (v / max) * h;
  s += axisY(L, W - R, y, max, 2) + text(L, top - 4, 'Fleet working hours a week by session tier (both repos; the oplog starts on 12 July)', { size: 11, fill: C.ink, weight: 600 });
  for (const [wk, v] of fw) { let base = 0; const X = hx(t0(wk)); for (const t of TIERS) { const q = v.hours[t] || 0; if (!q) continue; s += `<rect x="${(X + 2).toFixed(1)}" y="${y(base + q).toFixed(1)}" width="${(hbw - 4).toFixed(1)}" height="${(y(base) - y(base + q)).toFixed(1)}" fill="${C[t]}"/>`; base += q; } }
  s += markers(hx, top, top + h, hx0, to, false) + axisX(hx, top + h + 16, hx0, to, 14);
  let lx = L; for (const t of [...TIERS, 'unattributed']) { s += `<rect x="${lx}" y="${H - 24}" width="12" height="12" fill="${C[t]}"/>` + text(lx + 16, H - 12, LABEL[t], { fill: C.ink }); lx += 120; }
  s += routingKey(L, H - 56, 4);
  writeFileSync(join(outDir, 'who-did-the-work.svg'), s + '</svg>\n');
}

// Two-week bins from 13 July for the per-change series.
const BIN0 = t0('2026-07-13');
const binOf = (week) => Math.floor((t0(week) - BIN0) / (14 * DAY));
const code = A.changes.filter((c) => c.scored && c.prodLines > 0);

// ---- 2. Whole-life cost per correct change by implementer tier over time.
{
  const W = 920, H = 540, L = 60, R = 130;
  const from = t0('2026-06-01'), to = t0('2026-09-28');
  const x = (ms) => L + ((ms - from) / (to - from)) * (W - L - R);
  let s = svgOpen(W, H, 'Whole-life cost per correct change by implementer tier, two-week bins, with routing changes marked');
  s += text(L, 20, 'What a correct change costs over its whole life, by implementer tier', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 36, 'Both repos. Two-week bins; a point needs 5+ correct changes at that tier. Shaded: provisional (the 30-day window is still open).', { size: 10.5 });
  const series = (metric, since) => {
    const bins = {};
    for (const c of code) { if (!c.implementer || t0(c.week) < since) continue; const b = Math.floor((t0(c.week) - since) / (14 * DAY)); const k = `${c.implementer}|${b}`; (bins[k] ||= []).push(c); }
    const out = {};
    for (const [k, cs] of Object.entries(bins)) { const [t, b] = k.split('|'); const v = metric(cs); if (v == null) continue; (out[t] ||= []).push([since + (+b * 14 + 7) * DAY, v, cs.filter((c) => c.good).length]); }
    for (const t of Object.keys(out)) out[t].sort((a, b) => a[0] - b[0]);
    return out;
  };
  const perGood = (f) => (cs) => { const g = cs.filter((c) => c.good).length; if (g < 5) return null; return cs.reduce((a, c) => a + f(c), 0) / g; };
  const panels = [
    ['Working hours per correct change: own sessions plus attributed rework (same-file ceiling); the oplog starts 12 July', 76, 150, series(perGood((c) => (c.workH ?? 0) + c.afterlife.reworkCeilH), BIN0), (v) => v.toFixed(0) + ' h'],
    ['Dispatches per correct change, own plus rework (runner logs start 20 June)', 290, 140, series(perGood((c) => (c.dispatches ?? 0) + c.afterlife.reworkCeilDispatches), t0('2026-06-22')), (v) => v.toFixed(0)],
  ];
  for (const [title, top, h, ser, fmt] of panels) {
    const all = Object.values(ser).flat().map((p) => p[1]); const max = niceMax(Math.max(...all));
    const y = (v) => top + h - (Math.min(v, max) / max) * h;
    s += provisional(x, top, h, to) + axisY(L, W - R, y, max, 2, fmt) + text(L, top - 18, title, { size: 11, fill: C.ink, weight: 600 });
    s += markers(x, top, top + h, from, to, true);
    for (const t of TIERS) {
      const pts = ser[t] || []; if (!pts.length) continue;
      s += `<polyline fill="none" stroke="${C[t]}" stroke-width="2" points="${pts.map(([ms, v]) => `${x(ms).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
      for (const [ms, v, g] of pts) s += `<circle cx="${x(ms).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${C[t]}" stroke="${C.surface}" stroke-width="2"><title>${LABEL[t]}, fortnight from ${fmtDate(ms - 7 * DAY)}: ${fmt(v)} per correct change (${g} correct)</title></circle>`;
      const [lms, lv] = pts.at(-1); s += text(x(lms) + 8, y(lv) + 4, `${LABEL[t]} ${fmt(lv)}`, { fill: C.ink, size: 10.5 });
    }
  }
  s += axisX(x, 446, from, to, 21) + routingKey(L, H - 30, 4);
  let lx = L; for (const t of TIERS) { s += `<line x1="${lx}" x2="${lx + 16}" y1="${H - 58}" y2="${H - 58}" stroke="${C[t]}" stroke-width="2"/>` + text(lx + 20, H - 54, `${LABEL[t]} implementer`, { fill: C.ink }); lx += 150; }
  writeFileSync(join(outDir, 'whole-life-cost.svg'), s + '</svg>\n');
}

// ---- 3. The afterlife curve: cumulative rework hours per change by days since merge.
{
  const W = 720, H = 380, L = 60, R = 140, top = 56, h = 260;
  let s = svgOpen(W, H, 'Afterlife curve: cumulative rework working hours per change after it merged, by implementer tier');
  s += text(L, 20, 'A change\'s afterlife: rework hours it causes after merging', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 36, 'Both repos; code changes merged 13 July to 1 August (60 days mature). Solid: same-file ceiling. Dashed: named floor.', { size: 10.5 });
  const x = (d) => L + (d / 60) * (W - L - R);
  const max = niceMax(Math.max(...TIERS.flatMap((t) => A.curve[t].ceil.map((p) => p[1]))));
  const y = (v) => top + h - (v / max) * h;
  s += axisY(L, W - R, y, max, 5, (v) => v.toFixed(1) + ' h');
  for (let d = 0; d <= 60; d += 10) s += text(x(d), top + h + 16, `${d}`, { anchor: 'middle', size: 10 });
  s += text(x(30), top + h + 32, 'days since the change merged', { anchor: 'middle', size: 10.5 });
  for (const t of TIERS) {
    const cv = A.curve[t]; if (!cv.n) continue;
    for (const [k, dash] of [['ceil', ''], ['floor', ' stroke-dasharray="5 4"']]) s += `<polyline fill="none" stroke="${C[t]}" stroke-width="2"${dash} points="${cv[k].map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
    const [, lv] = cv.ceil.at(-1); s += text(x(60) + 8, y(lv) + 4, `${LABEL[t]} (n=${cv.n}) ${lv.toFixed(2)} h`, { fill: C.ink, size: 10.5 });
  }
  writeFileSync(join(outDir, 'afterlife-curve.svg'), s + '</svg>\n');
}
console.log('wrote', outDir);
