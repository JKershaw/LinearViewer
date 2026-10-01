// LIN-3182: draw how-process-changes-land.md's SVG charts (the change timeline against cost per correct change, the charging rules, the half-finished ages); hand-written SVG, no dependencies.
// Usage: node scripts/survey-landing-figures.mjs [--out docs/papers/harbour/figures/how-process-changes-land]
// Reads data/survey/scorecard.json (survey-scorecard.mjs), docs/papers/harbour/how-process-changes-land-changes.json (the coded catalogue),
// data/survey/landing-charge.json (survey-landing-charge.mjs) and data/survey/landing-halfdone.json (survey-landing-halfdone.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outDir = arg('--out', 'docs/papers/harbour/figures/how-process-changes-land');
const card = JSON.parse(readFileSync('data/survey/scorecard.json', 'utf8'));
const cat = JSON.parse(readFileSync('docs/papers/harbour/how-process-changes-land-changes.json', 'utf8'));
const charge = JSON.parse(readFileSync('data/survey/landing-charge.json', 'utf8'));
mkdirSync(outDir, { recursive: true });

// Categorical slots as in the other survey figures (validated on the light surface; every chart carries a legend and the paper the numbers).
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', grey: '#cbd5e1', grey2: '#94a3b8' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const DAY = 86400000; const t0 = (iso) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil(v / p) * p; };
// A round step for four gridlines, and the axis maximum it implies.
const niceStep = (v) => { const raw = v / 4; const p = 10 ** Math.floor(Math.log10(raw)); const m = [1, 2, 2.5, 5, 10].find((k) => k * p >= raw); return m * p; };
function axisY(x0, x1, y, max, ticks, fmt = (v) => String(Math.round(v))) { let s = ''; for (let i = 0; i <= ticks; i++) { const v = (max * i) / ticks; const Y = y(v); s += `<line x1="${x0}" x2="${x1}" y1="${Y.toFixed(1)}" y2="${Y.toFixed(1)}" stroke="${C.grid}"/>` + text(x0 - 6, Y + 4, fmt(v), { anchor: 'end', size: 10 }); } return s; }
const bar = (x, y, w, h, fill, tip) => { if (h <= 0.4) return ''; const r = Math.min(4, h, w / 2); const d = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; return `<path d="${d}" fill="${fill}"><title>${esc(tip)}</title></path>`; };

// The marker for a change: colour says finished or not; fill says measured before and after (solid), one side or partly (half), or not at all (hollow).
const finishedColour = (f) => (f === 'finished' ? C.blue : f === 'half-finished' ? C.orange : C.grey2);
const measured = (c) => {
  const b = c.measuredBefore?.value, a = c.measuredAfter?.value;
  if (b === 'yes' && a === 'yes') return 'both';
  if (b === 'yes' || a === 'yes' || b === 'partial' || a === 'partial') return 'partly';
  return 'none';
};
function marker(x, y, c, r = 6) {
  const col = finishedColour(c.finished?.value); const m = measured(c);
  const tip = `${c.date} ${c.name}: ${c.finished?.value}; measured ${m}`;
  if (m === 'both') return `<circle cx="${x.toFixed(1)}" cy="${y}" r="${r}" fill="${col}" stroke="${col}" stroke-width="1.5"><title>${esc(tip)}</title></circle>`;
  if (m === 'partly') return `<g><title>${esc(tip)}</title><circle cx="${x.toFixed(1)}" cy="${y}" r="${r}" fill="${C.surface}" stroke="${col}" stroke-width="1.5"/><path d="M${(x - r).toFixed(1)},${y}A${r},${r} 0 0 0 ${(x + r).toFixed(1)},${y}Z" fill="${col}"/></g>`;
  return `<circle cx="${x.toFixed(1)}" cy="${y}" r="${r}" fill="${C.surface}" stroke="${col}" stroke-width="1.5"><title>${esc(tip)}</title></circle>`;
}

// ---- 1. Headline: the change timeline against cost per correct change.
{
  const changes = [...cat.changes].sort((a, b) => a.date.localeCompare(b.date));
  const W = 960, L = 60, R = 24, T = 92;
  const panelH = 120, gap = 34, laneH = 26 + 18 * Math.ceil(changes.length / 1) * 0;
  const from = t0('2026-06-01'), to = t0('2026-10-05');
  const x = (ms) => L + ((ms - from) / (to - from)) * (W - L - R);
  const rows = card.rows.filter((r) => r.full);
  const lane = (changes.length * 0 + 1);
  const yA0 = T, yB0 = yA0 + panelH + gap, yC0 = yB0 + panelH + gap, yLane = yC0 + panelH + gap;
  const laneRows = []; // stack labels so they do not overlap
  const H = yLane + 40 + changes.length * 15 + 80;
  let s = svgOpen(W, H, 'Process changes since June against cost per correct change, both repos');
  s += text(L, 22, 'Process changes since June, against what a correct, complete change cost (both repos)', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 40, 'By merge week. Cost is fleet dispatches and working hours over correct, complete changes; the runner census starts 13 July. Weeks from 31 Aug are provisional.', { size: 11 });
  s += text(L, 55, 'Markers: blue finished, orange half-finished, grey unclear; solid measured before and after, half measured on one side or in part, hollow not measured.', { size: 11 });
  const panels = [
    [yA0, 'Fleet dispatches per correct, complete change', (r) => (r.fleetDispatches != null && r.good ? r.fleetDispatches / r.good : null), C.blue],
    [yB0, 'Working hours per correct, complete change', (r) => (r.fleetWorkH != null && r.good ? r.fleetWorkH / r.good : null), C.aqua],
    [yC0, 'Correct, complete changes a week', (r) => r.good, C.grey2],
  ];
  for (const [y0, title, f, col] of panels) {
    const vals = rows.map((r) => ({ w: t0(r.week), v: f(r), prov: !r.mature }));
    const step = niceStep(Math.max(...vals.filter((p) => p.v != null).map((p) => p.v)) * 1.05); const max = step * 4;
    const y = (v) => y0 + (1 - v / max) * panelH;
    s += text(L, y0 - 8, title, { size: 11.5, fill: C.ink, weight: 600 });
    s += axisY(L, W - R, y, max, 4, (v) => (max < 10 ? v.toFixed(1) : String(Math.round(v))));
    if (col !== C.grey2) s += `<rect x="${x(from).toFixed(1)}" y="${y0}" width="${(x(t0('2026-07-13')) - x(from)).toFixed(1)}" height="${panelH}" fill="#f3f4f6"/>` + text(x(from) + 6, y0 + 14, 'no cost series before 13 July', { size: 10 });
    const pts = vals.filter((p) => p.v != null);
    if (col === C.grey2) {
      const bw = x(from + 7 * DAY) - x(from) - 4;
      for (const p of pts) s += bar(x(p.w) + 2, y(p.v), bw, y0 + panelH - y(p.v), p.prov ? C.grey : C.grey2, `${fmtDate(p.w)}: ${p.v}`);
    } else {
      const firm = pts.filter((p) => !p.prov), prov = pts.filter((p, i) => p.prov || (pts[i + 1] && pts[i + 1].prov));
      const mid = (p) => x(p.w + 3.5 * DAY);
      s += `<path d="${firm.map((p, i) => `${i ? 'L' : 'M'}${mid(p).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}" fill="none" stroke="${col}" stroke-width="2.2"/>`;
      s += `<path d="${prov.map((p, i) => `${i ? 'L' : 'M'}${mid(p).toFixed(1)},${y(p.v).toFixed(1)}`).join('')}" fill="none" stroke="${col}" stroke-width="2.2" stroke-dasharray="4 3"/>`;
      for (const p of pts) s += `<circle cx="${mid(p).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" fill="${col}"><title>${fmtDate(p.w)}: ${p.v.toFixed(1)}</title></circle>`;
    }
    for (const c of changes) s += `<line x1="${x(t0(c.date)).toFixed(1)}" x2="${x(t0(c.date)).toFixed(1)}" y1="${y0}" y2="${y0 + panelH}" stroke="${finishedColour(c.finished?.value)}" stroke-opacity="0.35" stroke-dasharray="2 3"/>`;
  }
  // Month ticks.
  for (const m of ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']) s += text(x(t0(m)), yLane - 6, fmtDate(t0(m)), { size: 10, anchor: 'middle' });
  // The lane: numbered markers, stacked where dates collide.
  const placed = [];
  changes.forEach((c, i) => {
    const X = x(t0(c.date)); let level = 0;
    while (placed.some((p) => p.level === level && Math.abs(p.X - X) < 15)) level++;
    placed.push({ X, level });
    const Y = yLane + 12 + level * 16;
    s += marker(X, Y, c, 6) + text(X, Y + 3.5, String(i + 1), { size: 8, anchor: 'middle', fill: measured(c) === 'both' ? C.surface : C.ink, weight: 600 });
  });
  const levels = Math.max(...placed.map((p) => p.level)) + 1;
  const keyY = yLane + 12 + levels * 16 + 14;
  changes.forEach((c, i) => {
    const X = L, Y = keyY + i * 15;
    s += text(X, Y, `${i + 1}. ${c.date.slice(5)} ${c.name}${c.repos?.length ? ` (${c.repos.map((r) => (r === 'LinearViewer' ? 'LV' : 'SD')).join(', ')})` : ''}`, { size: 10, fill: C.ink });
  });
  const realH = keyY + changes.length * 15 + 6;
  s = s.replace(`viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"`, `viewBox="0 0 ${W} ${realH}" width="${W}" height="${realH}"`).replace(`<rect width="${W}" height="${H}"`, `<rect width="${W}" height="${realH}"`);
  writeFileSync(join(outDir, 'timeline.svg'), s + '</svg>\n');
}

// ---- 2. The charging rules: dispatches per correct, complete change by block under each rule, and the share each rule charges at all.
{
  const blocks = ['13 Jul – 9 Aug', '10 Aug – 12 Sep', '13 – 30 Sep'];
  const rules = [['child named', 'child', C.blue], ['session entered', 'session', C.aqua], ['lineage spread', 'lineage', C.yellow], ['pooled (scorecard)', 'pooled', C.grey2]];
  const W = 900, H = 400, L = 56, R = 20, T = 74, B = 70;
  const get = (b, k) => { const r = charge.table.find((t) => t.block === b && t.repo === 'both'); return k === 'pooled' ? r.pooled.perChange : r[k].mean; };
  const max = niceMax(Math.max(...blocks.flatMap((b) => rules.map(([, k]) => get(b, k)))) * 1.08);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  let s = svgOpen(W, H, 'Dispatches per correct, complete change under four charging rules, both repos');
  s += text(L, 22, 'Dispatches per correct, complete change, by how a dispatch is charged (both repos)', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 40, 'Mean per change, by the block its last merge fell in. Under each bar: the share of all claimed dispatches the rule charges to any correct, complete change.', { size: 11 });
  s += axisY(L, W - R, y, max, 5);
  const gw = (W - L - R) / blocks.length, bw = (gw - 60) / rules.length;
  blocks.forEach((b, i) => {
    const gx = L + i * gw + 30;
    rules.forEach(([label, k, col], j) => {
      const v = get(b, k); const X = gx + j * bw;
      s += bar(X + 3, y(v), bw - 6, y(0) - y(v), col, `${b}, ${label}: ${v}`) + text(X + bw / 2, y(v) - 5, String(v), { size: 10.5, anchor: 'middle', fill: C.ink });
      const cov = k === 'pooled' ? 100 : charge.coverage[b][k];
      s += text(X + bw / 2, y(0) + 14, `${Math.round(cov)}%`, { size: 9.5, anchor: 'middle' });
    });
    s += text(gx + (rules.length * bw) / 2, y(0) + 32, b, { size: 11, anchor: 'middle', fill: C.ink, weight: 600 });
  });
  rules.forEach(([label, , col], j) => { const X = L + j * 200; s += `<rect x="${X}" y="${H - 22}" width="12" height="10" rx="2" fill="${col}"/>` + text(X + 18, H - 13, label, { size: 10.5, fill: C.ink }); });
  writeFileSync(join(outDir, 'charging-rules.svg'), s + '</svg>\n');
}

// ---- 3. Half-finished items today, by class and age.
if (existsSync('data/survey/landing-halfdone.json')) {
  const hd = JSON.parse(readFileSync('data/survey/landing-halfdone.json', 'utf8'));
  const items = [...(hd.items || []), ...(hd.followUps || [])].filter((it) => it.ageDays != null);
  const NAMES = { flag: 'flags', 'dual-path': 'dual paths', experiment: 'parked experiments', 'follow-up': 'open follow-ups', 'review-residue': 'open review residue' };
  const classes = Object.keys(NAMES).filter((k) => items.some((it) => it.class === k));
  const W = 900, L = 170, R = 30, T = 70, rowH = 64, H = T + classes.length * rowH + 60;
  const max = niceMax(Math.max(...items.map((it) => it.ageDays)) * 1.05);
  const x = (d) => L + (d / max) * (W - L - R);
  let s = svgOpen(W, H, 'Half-finished items in the process code today, by class and age, both repos');
  s += text(24, 22, 'Half-finished items in the process code at HEAD, by class and age in days (both repos)', { size: 14, fill: C.ink, weight: 600 });
  s += text(24, 40, 'One dot per item: blue LinearViewer (Harbour), orange simple-dispatcher (the runner). Age at 1 October; follow-up ages are mostly interpolated.', { size: 11 });
  for (let d = 0; d <= max; d += max / 5) s += `<line x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${T}" y2="${T + classes.length * rowH}" stroke="${C.grid}"/>` + text(x(d), T + classes.length * rowH + 16, String(Math.round(d)), { size: 10, anchor: 'middle' });
  s += text(x(max / 2), T + classes.length * rowH + 34, 'days old', { size: 10.5, anchor: 'middle' });
  classes.forEach((k, i) => {
    const Y = T + i * rowH + rowH / 2; const its = items.filter((it) => it.class === k);
    s += text(L - 10, Y + 4, `${NAMES[k]} (${its.length})`, { size: 11, anchor: 'end', fill: C.ink });
    const seen = new Map();
    for (const it of its.sort((a, b) => a.ageDays - b.ageDays)) {
      const bucket = Math.round(x(it.ageDays) / 7); const n = seen.get(bucket) || 0; seen.set(bucket, n + 1);
      const dy = (n % 8) * 5.5 - 19;
      s += `<circle cx="${x(it.ageDays).toFixed(1)}" cy="${(Y + dy).toFixed(1)}" r="3.4" fill="${it.repo === 'simple-dispatcher' ? C.orange : C.blue}" fill-opacity="0.85"><title>${esc(`${it.repo}: ${it.ticket ? `${it.ticket} ${it.title}` : it.flag || it.what || it.path} — ${it.ageDays} days`)}</title></circle>`;
    }
  });
  writeFileSync(join(outDir, 'half-finished.svg'), s + '</svg>\n');
}
console.log('wrote', outDir);
