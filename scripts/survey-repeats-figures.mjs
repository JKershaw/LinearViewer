// LIN-3174: draw why-legs-repeat.md's two SVG charts from survey-repeats-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-repeats-figures.mjs [--in data/survey-repeats/analysis.json] [--out docs/papers/harbour/figures/why-legs-repeat]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-repeats/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/why-legs-repeat');
mkdirSync(outDir, { recursive: true });

// The survey's palette (survey-doubling-figures.mjs): four categorical slots in fixed order, then greys; every chart carries a legend.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', grey: '#cbd5e1', grey2: '#94a3b8' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const rect = (x, y, w, h, fill, tip) => (h <= 0.2 || w <= 0.2 ? '' : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"><title>${esc(tip)}</title></rect>`);
const legend = (x, y, entries, colW) => entries.map(([label, fill], i) => `<rect x="${x + i * colW}" y="${y - 9}" width="10" height="10" rx="2" fill="${fill}"/>` + text(x + i * colW + 14, y, label, { size: 10 })).join('');
const LEGS = ['plan', 'plan-review', 'review', 'close-out'];
const fmt = (w) => new Date(w + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ---- 1. Headline: legs per active ticket by week, first against repeat, per kind; then the sampled repeats' reasons, stacked.
{
  const W = 940, H = 790, weeks = A.census.weekly;
  let s = svgOpen(W, H, 'Planning, review and close-out legs per active Done ticket by week, first against repeat, and why the sampled repeats ran');
  s += text(20, 24, 'Legs per active ticket, by week of launch: first of its kind on the ticket, or a repeat', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, `Done tickets, both repos, legs launched 1 Aug–30 Sep, by week starting Monday. Active ticket: any of these legs launched that week. ${A.census.legs.n} legs, ${A.census.legs.repeat} repeats.`, { size: 10 });
  const per = weeks.map((w) => LEGS.map((k) => (w[k].first + w[k].repeat) / w.tickets));
  const max = Math.ceil(Math.max(...per.flat()) * 5) / 5 + 0.2;
  const pw = 205, ph = 190, top = 62, gap = 26;
  LEGS.forEach((k, j) => {
    const x0 = 44 + j * (pw + gap), y = (v) => top + 20 + ph - (v / max) * ph, bw = pw / weeks.length - 4;
    s += text(x0, top + 10, k, { size: 12, fill: C.ink, weight: 600 });
    for (let t = 0; t <= max + 1e-9; t += 0.2) { const Y = y(t); s += `<line x1="${x0}" x2="${x0 + pw}" y1="${Y}" y2="${Y}" stroke="${C.grid}"/>`; if (j === 0) s += text(x0 - 6, Y + 4, t.toFixed(1), { anchor: 'end', size: 10 }); }
    weeks.forEach((w, i) => {
      const f = w[k].first / w.tickets, r = w[k].repeat / w.tickets, X = x0 + 2 + i * (pw / weeks.length);
      s += rect(X, y(f), bw, y(0) - y(f), C.grey2, `${k}, week of ${w.week}: ${w[k].first} first legs over ${w.tickets} active tickets`);
      s += rect(X, y(f + r), bw, y(f) - y(f + r), C.orange, `${k}, week of ${w.week}: ${w[k].repeat} repeats over ${w.tickets} active tickets`);
    });
    s += text(x0, y(0) + 14, fmt(weeks[0].week), { size: 9 }) + text(x0 + pw, y(0) + 14, `${fmt(weeks.at(-1).week)} (3 days)`, { size: 9, anchor: 'end' });
    const c = A.census.byKind[k]; s += text(x0, y(0) + 28, `${c.repeat} repeats of ${c.n} legs (${Math.round((100 * c.repeat) / c.n)}%)`, { size: 10, fill: C.ink });
  });
  s += legend(44, top + ph + 70, [['first leg of its kind on the ticket', C.grey2], ['repeat (round 2 or later)', C.orange]], 250);
  // Reasons, then what the round changed.
  const y0 = top + ph + 108;
  const LABEL = { other: 'not a real repeat (kind misread, or a new phase)' };
  const stack = (yTop, byKind, order, colour, title) => {
    let o = text(20, yTop, title, { size: 13, fill: C.ink, weight: 600 });
    const all = {}; for (const k of LEGS) for (const [r, n] of Object.entries(byKind[k])) all[r] = (all[r] || 0) + n;
    const rows = [...LEGS.map((k) => [k, byKind[k]]), ['all sampled', all]];
    const bx = 130, bwid = W - bx - 70, bh = 20;
    rows.forEach(([label, dist], i) => {
      const Y = yTop + 14 + i * (bh + 6); const n = Object.values(dist).reduce((a, b) => a + b, 0); let X = bx;
      o += text(bx - 8, Y + 14, label, { anchor: 'end', size: 11, fill: C.ink, weight: label === 'all sampled' ? 600 : null });
      for (const [r, fill] of order) { const v = dist[r] || 0; if (!v) continue; const w = (v / n) * bwid; o += rect(X, Y, w - 1, bh, fill, `${label}: ${LABEL[r] || r} ${v} of ${n}`); if (w > 20) o += text(X + w / 2, Y + 14, String(v), { anchor: 'middle', size: 10, fill: fill === C.blue || fill === C.orange ? '#ffffff' : C.ink }); X += w; }
      o += text(bx + bwid + 8, Y + 14, `n=${n}`, { size: 10 });
    });
    const ly = yTop + 14 + rows.length * (bh + 6) + 14;
    o += order.map(([r, fill], i) => `<rect x="${bx + (i % 3) * 250}" y="${ly + Math.floor(i / 3) * 16 - 9}" width="10" height="10" rx="2" fill="${fill}"/>` + text(bx + (i % 3) * 250 + 14, ly + Math.floor(i / 3) * 16, LABEL[r] || r, { size: 10 })).join('');
    return o;
  };
  s += stack(y0, A.reasonsByKind, [['changes-requested', C.blue], ['plan-revised-after-research', C.aqua], ['failed-or-cut-off', C.yellow], ['other', C.grey]], null,
    `Why the repeat ran: a systematic sample of ${A.sample.n} repeats (every 13th by launch time), coded twice blind`);
  s += stack(y0 + 230, A.boughtByKind, [['substance', C.orange], ['wording-tests', C.yellow], ['nothing', C.grey2], ['unclear', C.grey]], null,
    'What that round changed: the plan\'s substance or production code, only wording or tests, or nothing');
  s += '</svg>';
  writeFileSync(join(outDir, 'legs-by-week.svg'), s);
}

// ---- 2. Convergence: rounds per ticket for each gate, by production lines changed.
{
  const W = 980, H = 330;
  let s = svgOpen(W, H, 'Rounds of plan-review and review per Done ticket, by production lines changed');
  s += text(20, 24, 'How many rounds each gate took per ticket, by production lines the ticket changed', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, 'Done tickets with at least one leg of the gate, launched since 1 Aug; both repos. Share of tickets; n on the right.', { size: 10 });
  const BANDS = ['0', '1-49', '50-299', '300+', 'no merge'], G = [['1', C.grey2], ['2', C.blue], ['3+', C.orange]];
  ['plan-review', 'review'].forEach((k, j) => {
    const x0 = 110 + j * 470, bw = 290, cv = A.convergence[k];
    s += text(x0, 68, `${k} (${cv.n} tickets)`, { size: 12, fill: C.ink, weight: 600 });
    BANDS.forEach((b, i) => {
      const d = cv.bySize[b]; if (!d) return; const Y = 80 + i * 34; const two = d.n - d.one - d.threePlus; let X = x0;
      s += text(x0 - 8, Y + 15, b === 'no merge' ? 'no merge' : `${b} lines`, { anchor: 'end', size: 11, fill: C.ink });
      for (const [g, fill] of G) { const v = g === '1' ? d.one : g === '2' ? two : d.threePlus; const w = (v / d.n) * bw; s += rect(X, Y, w - 1, 22, fill, `${k}, ${b}: ${g} round(s) on ${v} of ${d.n} tickets`); if (w > 26) s += text(X + w / 2, Y + 15, `${Math.round((100 * v) / d.n)}%`, { anchor: 'middle', size: 10, fill: g === '1' ? C.ink : '#ffffff' }); X += w; }
      s += text(x0 + bw + 8, Y + 15, `n=${d.n}`, { size: 10 });
    });
  });
  s += legend(110, 272, [['one round', C.grey2], ['two rounds', C.blue], ['three or more', C.orange]], 150);
  s += text(20, 310, 'Lines are production lines changed over the ticket in either repo (survey-model-git.mjs); "no merge" tickets closed without a merge naming them.', { size: 10 });
  s += '</svg>';
  writeFileSync(join(outDir, 'convergence.svg'), s);
}
console.log(`wrote ${outDir}/legs-by-week.svg, convergence.svg`);
