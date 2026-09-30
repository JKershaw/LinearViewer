// LIN-3155: draw the two SVG figures for why-throughput-halved.md from survey-halving.mjs's analysis, by hand (no dependencies).
// Usage: node scripts/survey-halving-chart.mjs [--in data/survey-halving/analysis.json] [--svg docs/papers/harbour/figures/why-throughput-halved]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const a = JSON.parse(readFileSync(arg('--in', 'data/survey-halving/analysis.json'), 'utf8'));
const dir = arg('--svg', 'docs/papers/harbour/figures/why-throughput-halved');
mkdirSync(dir, { recursive: true });

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', band: '#f3f4f6', frontier: '#1e40af', mid: '#60a5fa', unstated: '#cbd5e1', prod: '#b45309', test: '#047857', driver: '#7c3aed', up: '#b91c1c', down: '#1d4ed8' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const fmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? Math.round(v) : v.toFixed(1));

// ---- Figure 1: the weekly count, what was delivered, and the drivers on one time axis ------------------------------------
const weeks = a.weekly.filter((w) => w.week <= '2026-09-21');
const W = 760, L = 58, R = 700, n = weeks.length, bw = (R - L) / n;
const x = (i) => L + i * bw;
const stepX = x(weeks.findIndex((w) => w.week === '2026-07-13'));
const juneA = x(weeks.findIndex((w) => w.week === a.june[0])), juneZ = x(weeks.findIndex((w) => w.week === a.june.at(-1)) + 1);
let s = '';
// Panel A: stacked bars by tier; net product and test lines on the right axis.
const A0 = 52, AH = 200, maxC = 160, maxL = 40000;
const yC = (v) => A0 + AH - (v / maxC) * AH, yL = (v) => A0 + AH - (Math.max(0, v) / maxL) * AH;
s += text(L, 34, 'Correct, complete changes a week by the tier that wrote them, and net lines landed on main', { size: 13, fill: C.ink, weight: 600 });
s += `<rect x="${juneA}" y="${A0}" width="${juneZ - juneA}" height="${AH}" fill="${C.band}"/>` + text((juneA + juneZ) / 2, A0 + 12, 'June block', { anchor: 'middle' });
for (const v of [0, 40, 80, 120, 160]) s += `<line x1="${L}" x2="${R}" y1="${yC(v)}" y2="${yC(v)}" stroke="${C.grid}"/>` + text(L - 6, yC(v) + 4, v, { anchor: 'end' });
for (const v of [0, 10000, 20000, 30000, 40000]) s += text(R + 6, yL(v) + 4, `${v / 1000}k`, { fill: C.prod });
weeks.forEach((w, i) => {
  let base = 0;
  for (const t of ['frontier', 'mid', 'unstated']) { const v = w.byTier[t] || 0; if (!v) continue; s += `<rect x="${x(i) + 3}" y="${yC(base + v)}" width="${bw - 6}" height="${yC(base) - yC(base + v)}" fill="${C[t]}"/>`; base += v; }
  s += text(x(i) + bw / 2, yC(w.good) - 4, w.good, { anchor: 'middle', size: 10, fill: C.ink });
});
const path = (vals, y, color, dash) => { const pts = vals.map((v, i) => [x(i) + bw / 2, y(v)]); return `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${color}"/>`).join(''); };
s += path(weeks.map((w) => w.netProd), yL, C.prod) + path(weeks.map((w) => w.netTest), yL, C.test, '5 3');
s += `<line x1="${stepX}" x2="${stepX}" y1="${A0 - 4}" y2="${A0 + AH}" stroke="${C.ink}" stroke-dasharray="3 3"/>` + text(stepX + 4, A0 + 26, '12 Jul: sessions start at the', { fill: C.ink, size: 10 }) + text(stepX + 4, A0 + 38, "dispatch's tier (LIN-1285)", { fill: C.ink, size: 10 });
// Legend
const lg = [[C.frontier, 'frontier tier', 'rect'], [C.mid, 'mid tier', 'rect'], [C.unstated, 'tier not stated', 'rect'], [C.prod, 'net product lines (right)', 'line'], [C.test, 'net test lines (right)', 'dash']];
let lx = L; const ly = A0 + AH + 34;
for (const [c, t, k] of lg) { s += k === 'rect' ? `<rect x="${lx}" y="${ly - 9}" width="10" height="10" fill="${c}"/>` : `<line x1="${lx}" x2="${lx + 14}" y1="${ly - 4}" y2="${ly - 4}" stroke="${c}" stroke-width="2"${k === 'dash' ? ' stroke-dasharray="4 2"' : ''}/>`; s += text(lx + 18, ly, t, { fill: C.ink }); lx += 18 + t.length * 6.1 + 16; }
// x labels under panel A
weeks.forEach((w, i) => { if (i % 2 === 0) s += text(x(i) + bw / 2, A0 + AH + 14, `${+w.week.slice(8)} ${['Jun', 'Jul', 'Aug', 'Sep'][+w.week.slice(5, 7) - 6]}`, { anchor: 'middle', size: 10 }); });
// Driver strips: each its own scale, a shared time axis, the June and Later block means printed at the right.
const strips = [
  ['Share of correct changes that are mainly UI', (w) => (w.good ? (w.byArea.ui || 0) / w.good * 100 : null), '%'],
  ['Median test lines per correct change', (w) => w.medTestLinesGood, ''],
  ['Median fleet dispatches per change (runner logs; from 22 Jun)', (w) => w.medDispatches, ''],
  ['What agents are told to read, KB (both repos)', (w) => w.readingKB, ''],
  ['Tickets filed a week (from ticket numbers)', (w) => w.filed, ''],
  ['Correct, complete share of merged tickets', (w) => (w.goodShare == null ? null : w.goodShare * 100), '%'],
];
let y0 = ly + 22; const SH = 38, GAP = 22;
for (const [label, f, unit] of strips) {
  const vals = weeks.map(f); const vs = vals.filter((v) => v != null); const lo = Math.min(0, ...vs), hi = Math.max(...vs) * 1.08 || 1;
  const y = (v) => y0 + SH - ((v - lo) / (hi - lo)) * SH;
  s += text(L, y0 - 5, label, { fill: C.ink, size: 11 });
  s += `<rect x="${juneA}" y="${y0}" width="${juneZ - juneA}" height="${SH}" fill="${C.band}"/><line x1="${L}" x2="${R}" y1="${y0 + SH}" y2="${y0 + SH}" stroke="${C.grid}"/>`;
  s += `<line x1="${stepX}" x2="${stepX}" y1="${y0}" y2="${y0 + SH}" stroke="${C.ink}" stroke-dasharray="3 3"/>`;
  let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i) + bw / 2},${y(v)} `; pen = true; });
  s += `<path d="${d}" fill="none" stroke="${C.driver}" stroke-width="1.8"/>` + vals.map((v, i) => (v == null ? '' : `<circle cx="${x(i) + bw / 2}" cy="${y(v)}" r="2" fill="${C.driver}"/>`)).join('');
  const mean = (ws) => { const xs = ws.map(f).filter((v) => v != null); return xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null; };
  const jm = mean(weeks.filter((w) => a.june.includes(w.week))), lm = mean(weeks.filter((w) => a.later.includes(w.week)));
  s += text(R + 6, y0 + 14, jm == null ? 'June –' : `June ${fmt(jm)}${unit}`, { size: 10 }) + text(R + 6, y0 + 28, `later ${fmt(lm)}${unit}`, { size: 10 });
  y0 += SH + GAP;
}
weeks.forEach((w, i) => { if (i % 2 === 0) s += text(x(i) + bw / 2, y0 - GAP + 14, `${+w.week.slice(8)} ${['Jun', 'Jul', 'Aug', 'Sep'][+w.week.slice(5, 7) - 6]}`, { anchor: 'middle', size: 10 }); });
const H1 = y0 + 4;
writeFileSync(join(dir, 'weekly-drivers.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H1}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H1}" fill="#fff"/>${s}</svg>\n`);

// ---- Figure 2: Later ÷ June for each measure, grouped by candidate explanation -------------------------------------------
const J = a.blocks.June, Lb = a.blocks.Later;
const r = (l, j) => l / j;
const rows = [
  ['Outcome', [['Correct, complete changes a week', r(Lb.good, J.good)], ['Merged tickets a week', r(Lb.merged, J.merged)], ['Correct, complete share of merged', r(Lb.goodShare, J.goodShare)]]],
  ['Ticket size', [['Median product lines per correct change', r(Lb.medProdLinesGood, J.medProdLinesGood)], ['Correct changes of 1–49 product lines', r(Lb.band['1–49'], J.band['1–49'])], ['… of 50–299 lines', r(Lb.band['50–299'], J.band['50–299'])], ['… of 300+ lines', r(Lb.band['300+'], J.band['300+'])]]],
  ['What landed', [['Net product lines a week', r(Lb.netProd, J.netProd)], ['Net test lines a week', r(Lb.netTest, J.netTest)]]],
  ['Work mix', [['Correct changes, mainly UI', r(Lb.area.ui, J.area.ui)], ['… mainly server', r(Lb.area.server, J.area.server)], ['… mainly runner', r(Lb.area.runner, J.area.runner)], ['… docs or tests only', r(Lb.area['docs/tests only'], J.area['docs/tests only'])]]],
  ['Measurement', [['Commits on main that name a ticket (share)', r(Lb.namedShare, J.namedShare)], ['Product lines in ticket-naming commits (share)', r(Lb.prodChurnNamedShare, J.prodChurnNamedShare)]]],
  ['Correctness', [['Merged tickets with a named escape', r(Lb.escaped, J.escaped)], ['Merged tickets that filed a follow-up', r(Lb.incomplete, J.incomplete)], ['Merged tickets with a named fix', r(Lb.namedFix, J.namedFix)]]],
  ['Capacity', [['Correct changes written at frontier tier', r(Lb.tier.frontier, J.tier.frontier)], ['Days a week with a merge', r(Lb.activeDays, J.activeDays)]]],
  ['Process weight', [['Median test lines per correct change', r(Lb.medTestLinesGood, J.medTestLinesGood)], ['PR open to merge, median (Harbour)', r(Lb.prs.LinearViewer.medOpenToMergeH, J.prs.LinearViewer.medOpenToMergeH)], ['Reading load at the end of the block', r(Lb.readingKBEnd, J.readingKBEnd)]]],
  ['Organisational', [['Tickets filed a week', r(Lb.filed, J.filed)], ['Correct changes with no kind label', r(Lb.kind.unlabelled, J.kind.unlabelled)], ['Correct review-residue changes', r(Lb.kind['review-residue'], J.kind['review-residue'])]]],
];
const W2 = 760, PL = 300, PR = 690, lx2 = (v) => PL + ((Math.log10(v) + 1) / 2) * (PR - PL);
let s2 = text(20, 30, 'Each measure in the later weeks (13 Jul – 21 Sep) as a multiple of June (8 – 29 Jun)', { size: 13, fill: C.ink, weight: 600 });
let yy = 60;
const top = yy;
let body = '';
for (const [g, items] of rows) {
  body += text(20, yy + 4, g, { fill: C.ink, weight: 600, size: 11 }); yy += 16;
  for (const [label, v] of items) {
    const col = v >= 1 ? C.up : C.down;
    body += text(32, yy + 4, label, { fill: C.ink, size: 11 });
    body += `<line x1="${lx2(1)}" x2="${lx2(v)}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-width="2"/><circle cx="${lx2(v)}" cy="${yy}" r="4" fill="${col}"/>`;
    body += text(v >= 1 ? lx2(v) + 8 : lx2(v) - 8, yy + 4, `×${v >= 10 ? v.toFixed(0) : v.toFixed(2)}`, { anchor: v >= 1 ? 'start' : 'end', size: 10, fill: col });
    yy += 17;
  }
  yy += 6;
}
let grid = '';
for (const v of [0.1, 0.25, 0.5, 1, 2, 4, 10]) grid += `<line x1="${lx2(v)}" x2="${lx2(v)}" y1="${top - 6}" y2="${yy}" stroke="${v === 1 ? C.muted : C.grid}"/>` + text(lx2(v), yy + 14, `×${v}`, { anchor: 'middle', size: 10 });
s2 += grid + body + text(PL, yy + 30, 'Log scale. Blue fell, red rose. Both repos together.', { size: 10 });
const H2 = yy + 40;
writeFileSync(join(dir, 'june-vs-later.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W2} ${H2}" font-family="Inter, system-ui, sans-serif"><rect width="${W2}" height="${H2}" fill="#fff"/>${s2}</svg>\n`);
console.log(`wrote ${join(dir, 'weekly-drivers.svg')} (${n} weeks) and ${join(dir, 'june-vs-later.svg')} (${rows.reduce((k, [, i]) => k + i.length, 0)} measures)`);
