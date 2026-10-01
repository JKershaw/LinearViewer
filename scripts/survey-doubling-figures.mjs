// LIN-3170: draw what-doubled-the-dispatches.md's four SVG charts from survey-doubling-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-doubling-figures.mjs [--in data/survey-doubling/analysis.json] [--out docs/papers/harbour/figures/what-doubled-the-dispatches]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-doubling/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/what-doubled-the-dispatches');
mkdirSync(outDir, { recursive: true });

// Four categorical slots in fixed order, validated with the dataviz validator on the light surface (all checks pass; yellow and
// aqua sit under 3:1 against the surface, so every chart carries a legend and the paper carries the numbers as tables).
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', marker: '#9ca3af', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', grey: '#cbd5e1', grey2: '#94a3b8' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const DAY = 86400000; const t0 = (iso) => Date.parse(iso + 'T00:00:00Z');
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil(v / p) * p; };
function axisY(x0, x1, y, max, ticks) { let s = ''; for (let i = 0; i <= ticks; i++) { const v = (max * i) / ticks; const Y = y(v); s += `<line x1="${x0}" x2="${x1}" y1="${Y}" y2="${Y}" stroke="${C.grid}"/>` + text(x0 - 6, Y + 4, String(Math.round(v)), { anchor: 'end', size: 10 }); } return s; }
// A bar with its data end rounded (4px) and square at the baseline.
const bar = (x, y, w, h, fill, tip, roundTop = true) => { if (h <= 0.4) return ''; const r = roundTop ? Math.min(4, h, w / 2) : 0; const d = `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`; return `<path d="${d}" fill="${fill}"><title>${esc(tip)}</title></path>`; };
const legend = (x, y, entries, perRow = 4, colW = 215) => entries.map(([label, fill, dash], i) => { const X = x + (i % perRow) * colW, Y = y + Math.floor(i / perRow) * 16; return (dash ? `<line x1="${X}" x2="${X + 14}" y1="${Y - 4}" y2="${Y - 4}" stroke="${fill}" stroke-width="2" stroke-dasharray="${dash}"/>` : `<rect x="${X}" y="${Y - 9}" width="12" height="10" rx="2" fill="${fill}"/>`) + text(X + 18, Y, label, { size: 10.5, fill: C.ink }); }).join('');

// Dated process changes (the paper's timeline table; dates are first-parent merges on origin/main in either repo).
export const MARKERS = [
  ['2026-06-30', 'wakes, steppers and held autopilots begin (30 Jun–2 Jul)'],
  ['2026-07-10', 'DONE no longer held; AWAITING_EXTERNAL (10–11 Jul)'],
  ['2026-07-12', 'tier per dispatch; hook cap and re-fire; oplog'],
  ['2026-07-15', 'a wake per stepper beat (15–16 Jul)'],
  ['2026-07-17', 'dispatch presets per kind'],
  ['2026-07-26', 'plan-review leg'],
  ['2026-08-16', 'bootstrap-free launches'],
  ['2026-08-24', 'review mutation check'],
  ['2026-09-13', 'wakes carry an issue id (log only)'],
  ['2026-09-17', 'passage Runner and legs live'],
  ['2026-09-25', 'legs skipped for approved plans; session cap'],
];

// ---- 1. Headline: dispatches per correct change by merge week, stacked by component.
{
  const W = 940, H = 600, L = 56, R = 20, T = 84, B = 210;
  const groups = [
    ['worker legs, fresh session', C.blue, (c) => c.research + c.plan + c['plan-review'] + c.implementation + c.review + c['close-out']],
    ['autopilot session, fresh', C.yellow, (c) => c['autopilot session']],
    ['other or kind unread, fresh', C.grey2, (c) => c['other fresh'] + c['fresh, kind unread']],
    ['wake into an autopilot', C.orange, (c) => c.wake],
    ['beat into a worker session', C.aqua, (c) => c['beat into a worker']],
    ['follow-up, kind unread', C.grey, (c) => c['follow-up, session kind unread'] + c['other follow-up']],
  ];
  const weeks = A.weekly.filter((w) => w.comp && w.week >= '2026-06-29');
  const from = t0(weeks[0].week), to = t0(weeks.at(-1).week) + 7 * DAY;
  const x = (ms) => L + ((ms - from) / (to - from)) * (W - L - R);
  const max = niceMax(Math.max(...weeks.map((w) => w.total)) * 1.05); const y = (v) => T + (1 - v / max) * (H - T - B);
  let s = svgOpen(W, H, 'Dispatches per correct change by merge week, stacked by component, both repos');
  s += text(L, 22, 'Dispatches per correct change, by the week the change merged (code changes, both repos)', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 40, 'Stacked by what each dispatch was. Dashed line: the count model-choice.md used (only dispatches whose own log line names the ticket).', { size: 11 });
  s += `<rect x="${x(t0('2026-07-06')).toFixed(1)}" y="${T}" width="${(x(t0('2026-07-13')) - x(t0('2026-07-06'))).toFixed(1)}" height="${H - T - B}" fill="#f3f4f6"/>` + text(x(t0('2026-07-06')) + 3, T + 12, 'log gap', { size: 9.5 });
  s += axisY(L, W - R, y, max, 5);
  const bw = (x(from + 7 * DAY) - x(from)) - 6;
  for (const w of weeks) {
    let acc = 0; const X = x(t0(w.week)) + 3; const segs = groups.map(([label, fill, f]) => [label, fill, f(w.comp)]).filter((g) => g[2] > 0);
    segs.forEach(([label, fill, v], i) => { const y1 = y(acc + v), y0 = y(acc); s += bar(X, y1 + (i ? 0 : 0), bw, Math.max(0, y0 - y1 - (i < segs.length - 1 ? 2 : 0)), fill, `${fmtDate(t0(w.week))} week: ${label} ${v.toFixed(1)} per correct change (${w.good} correct of ${w.changes})`, i === segs.length - 1); acc += v; });
    s += text(X + bw / 2, y(w.total) - 5, w.total.toFixed(0), { anchor: 'middle', size: 10, fill: C.ink });
  }
  // model-choice's count
  const pts = weeks.map((w) => `${(x(t0(w.week)) + 3 + bw / 2).toFixed(1)},${y(w.issueLineOnly).toFixed(1)}`).join(' ');
  s += `<polyline points="${pts}" fill="none" stroke="${C.ink}" stroke-width="2" stroke-dasharray="5 3"/>`;
  MARKERS.forEach(([d], i) => { const X = x(t0(d)); s += `<line x1="${X}" x2="${X}" y1="${T - 4 - (i % 3) * 10}" y2="${H - B}" stroke="${C.ink}" stroke-width="1" stroke-dasharray="2 3"/>` + text(X + 2, T - 6 - (i % 3) * 10, String(i + 1), { size: 9.5, fill: C.ink, weight: 600 }); });
  for (let ms = from; ms <= to; ms += 14 * DAY) s += text(x(ms), H - B + 16, fmtDate(ms), { anchor: 'middle', size: 10 });
  s += legend(L, H - B + 40, [...groups.map(([l, f]) => [l, f]), ['model-choice.md count', C.ink, '5 3']], 4, 215);
  s += MARKERS.map(([d, l], i) => text(L + (i % 2) * 440, H - B + 90 + Math.floor(i / 2) * 15, `${i + 1}  ${fmtDate(t0(d))}: ${l}`, { size: 10.5, fill: C.ink })).join('');
  s += text(L, H - 8, 'Weeks from 29 June; June before it has 10 logged changes. Sources: simple-dispatcher run logs and oplog, local transcripts, git, scorecard.', { size: 10 });
  writeFileSync(join(outDir, 'dispatches-by-week.svg'), s + '</svg>\n');
}

// ---- 2. Steps against beats: fresh sessions and follow-ups per correct change, and wakes per autopilot session, by period.
{
  const W = 940, H = 380, T = 64, B = 70; const P = A.periods.filter((p) => p.good && !p.period.startsWith('June'));
  const SB = A.stepsBeats.filter((p) => !p.period.startsWith('June'));
  let s = svgOpen(W, H, 'Fresh sessions and follow-ups per correct change, and wakes per autopilot session, by period');
  s += text(40, 22, 'More beats, not more steps: fresh sessions per correct change level off in August; follow-ups keep climbing', { size: 14, fill: C.ink, weight: 600 });
  s += text(40, 40, 'Left: per correct change, by merge period (code changes, both repos). Right: follow-ups each autopilot session took.', { size: 11 });
  // left panel
  { const L = 60, Rr = 520; const max = niceMax(Math.max(...P.map((p) => p.warm + p.cold)) * 1.1); const y = (v) => T + (1 - v / max) * (H - T - B);
    s += axisY(L, Rr, y, max, 4); const gw = (Rr - L) / P.length;
    P.forEach((p, i) => { const X = L + i * gw + 10; const bw = (gw - 24) / 2;
      s += bar(X, y(p.fresh), bw, y(0) - y(p.fresh), C.blue, `${p.period}: ${p.fresh.toFixed(1)} fresh sessions per correct change`);
      s += bar(X + bw + 2, y(p.warm + p.cold), bw, y(0) - y(p.warm + p.cold), C.orange, `${p.period}: ${(p.warm + p.cold).toFixed(1)} follow-ups per correct change (${p.warm.toFixed(1)} warm, ${p.cold.toFixed(1)} cold)`);
      s += text(X + bw / 2, y(p.fresh) - 4, p.fresh.toFixed(1), { anchor: 'middle', size: 9.5, fill: C.ink }) + text(X + bw * 1.5 + 2, y(p.warm + p.cold) - 4, (p.warm + p.cold).toFixed(1), { anchor: 'middle', size: 9.5, fill: C.ink });
      s += text(X + bw, H - B + 15, p.period, { anchor: 'middle', size: 9.5 }); });
    s += legend(L, H - 22, [['fresh sessions (steps)', C.blue], ['follow-ups (beats)', C.orange]], 2, 200); }
  // right panel
  { const L = 600, Rr = 920; const vals = SB.map((p) => p.phase.autopilot.beatsPerSession || 0); const max = niceMax(Math.max(...vals) * 1.1); const y = (v) => T + (1 - v / max) * (H - T - B);
    s += axisY(L, Rr, y, max, 3); const gw = (Rr - L) / SB.length;
    SB.forEach((p, i) => { const v = p.phase.autopilot.beatsPerSession; if (v == null) { s += text(L + i * gw + gw / 2, y(0) - 4, 'n/a', { anchor: 'middle', size: 9.5 }); } else { s += bar(L + i * gw + 8, y(v), gw - 16, y(0) - y(v), C.yellow, `${p.period}: ${v.toFixed(1)} follow-ups per autopilot session`) + text(L + i * gw + gw / 2, y(v) - 4, v.toFixed(1), { anchor: 'middle', size: 9.5, fill: C.ink }); }
      s += text(L + i * gw + gw / 2, H - B + 15, p.period.replace(' (from 20 Jun logs)', ''), { anchor: 'middle', size: 9.5 }); });
    s += text(L, H - 22, 'follow-ups per autopilot session (kind read from 16 Jul)', { size: 10.5, fill: C.ink }); }
  writeFileSync(join(outDir, 'steps-and-beats.svg'), s + '</svg>\n');
}

// ---- 3. Size held fixed: dispatches per correct change by production-size band and period.
{
  const W = 940, H = 360, L = 60, R = 190, T = 60, B = 60; const P = A.bySize.filter((p) => !p.period.startsWith('June'));
  const bands = [['0', 'docs or tests only', '#86b6ef'], ['1-49', '1–49 lines', '#3987e5'], ['50-299', '50–299 lines', '#1c5cab'], ['300+', '300+ lines', '#0d366b']];
  const max = niceMax(Math.max(...P.flatMap((p) => bands.map(([b]) => p[b]?.perGood || 0))) * 1.05); const y = (v) => T + (1 - v / max) * (H - T - B);
  const x = (i) => L + 30 + i * ((W - L - R - 60) / (P.length - 1));
  let s = svgOpen(W, H, 'Dispatches per correct change by production-size band and period');
  s += text(L, 22, 'The rise holds at every size, and is steepest for the largest changes', { size: 14, fill: C.ink, weight: 600 });
  s += text(L, 40, 'Dispatches per correct change, by size band and merge period (both repos). Hover a point for the count of changes.', { size: 11 });
  s += axisY(L, W - R, y, max, 4);
  P.forEach((p, i) => { s += text(x(i), H - B + 16, p.period, { anchor: 'middle', size: 9.5 }); });
  const ends = [];
  for (const [b, label, col] of bands) {
    const pts = P.map((p, i) => (p[b] ? [x(i), y(p[b].perGood), p] : null)).filter(Boolean);
    s += `<polyline points="${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2"/>`;
    s += pts.map((q) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="4" fill="${col}" stroke="${C.surface}" stroke-width="2"><title>${esc(`${label}, ${q[2].period}: ${q[2][b].perGood} per correct change (${q[2][b].good} correct of ${q[2][b].n})`)}</title></circle>`).join('');
    ends.push([pts.at(-1), `${label} (${pts.at(-1)[2][b].perGood})`]);
  }
  ends.sort((a, b) => a[0][1] - b[0][1]); let prev = -1e9;
  for (const [q, l] of ends) { const Y = Math.max(q[1] + 4, prev + 14); prev = Y; s += text(q[0] + 10, Y, l, { size: 10.5, fill: C.ink }); }
  s += text(L, H - 12, 'Bands are production lines changed. Passage epics are left out; in late September 39% of docs-only dispatches are passage legs flying papers.', { size: 10 });
  writeFileSync(join(outDir, 'by-size.svg'), s + '</svg>\n');
}

// ---- 4. September's dispatches per correct change, split into the steady-base map's candidate rows.
{
  const rows = A.attribution; const W = 940, rowH = 22, T = 60, L = 330, R = 90; const H = T + rows.length * rowH + 50;
  const max = niceMax(Math.max(...rows.map((r) => r.perGood)) * 1.05); const x = (v) => L + (v / max) * (W - L - R);
  const colour = (b) => (/^1 |^2 |^3 /.test(b) ? C.orange : /^8 |test or CI/.test(b) ? C.aqua : C.grey2);
  let s = svgOpen(W, H, "September's dispatches per correct change by steady-base candidate");
  s += text(20, 22, `September: ${(A.septTotal / A.septGood).toFixed(1)} dispatches per correct change, split by the steady-base map's candidate rows`, { size: 14, fill: C.ink, weight: 600 });
  s += text(20, 40, 'Code changes merged 1–28 Sep, both repos. Orange: supervision rows 1–3. Aqua: review and CI rounds. Grey: not in any row.', { size: 11 });
  rows.forEach((r, i) => { const Y = T + i * rowH; s += text(L - 8, Y + 14, r.bucket, { anchor: 'end', size: 10.5, fill: C.ink });
    const w = x(r.perGood) - L; if (w > 0.5) s += `<path d="M${L},${Y + 4}H${L + w - Math.min(4, w)}Q${L + w},${Y + 4} ${L + w},${Y + 8}V${Y + 14}Q${L + w},${Y + 18} ${L + w - Math.min(4, w)},${Y + 18}H${L}Z" fill="${colour(r.bucket)}"><title>${esc(`${r.bucket}: ${r.perGood} per correct change, ${(r.share * 100).toFixed(0)}% of September's dispatches`)}</title></path>`;
    s += text(L + w + 6, Y + 15, `${r.perGood}  (${(r.share * 100).toFixed(0)}%)`, { size: 10.5, fill: C.ink }); });
  s += text(20, H - 12, 'Row numbers are docs/steady-base.md\'s map. Row 8 is a ceiling: every review round after the first and the re-implementation between them.', { size: 10 });
  writeFileSync(join(outDir, 'september-attribution.svg'), s + '</svg>\n');
}
console.log('wrote 4 charts to', outDir);
