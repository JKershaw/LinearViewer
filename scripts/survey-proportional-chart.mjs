// LIN-3166: draw the SVG figures for proportional-process-backtest.md from survey-proportional-backtest.mjs's output, by hand (no dependencies).
// Usage: node scripts/survey-proportional-chart.mjs [--in data/survey-proportional/backtest.json] [--svg docs/papers/harbour/figures/proportional-process-backtest]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const b = JSON.parse(readFileSync(arg('--in', 'data/survey-proportional/backtest.json'), 'utf8'));
const dir = arg('--svg', 'docs/papers/harbour/figures/proportional-process-backtest');
mkdirSync(dir, { recursive: true });
if (!b.results[0].read) throw new Error('run the backtest with the hand codes first');

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', band: '#f3f4f6', wrong: '#b91c1c', caught: '#1d4ed8', raw: '#9ca3af', bubble: '#f59e0b' };
const SERIES = { M1: '#1e40af', M2: '#60a5fa', M3: '#047857', M4: '#b45309', P1: '#7c3aed', P2: '#db2777' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>\n`;

// ---- Figure 1 (headline): share routed light against what went wrong in the light group and what review caught there ----
{
  const rs = b.results;
  const W = 760, L = 64, R = 560, T = 64, H0 = 300, B = T + H0;
  const xmax = Math.max(40, Math.ceil(Math.max(...rs.map((r) => r.share)) / 10) * 10);
  const ymax = Math.max(8, Math.ceil(Math.max(...rs.flatMap((r) => [r.light.outcomes.escaped + r.light.outcomes.namedFix, r.read.wentWrong.length, r.read.caughtRealFault.length])) / 4) * 4);
  const x = (v) => L + (v / xmax) * (R - L), y = (v) => B - (v / ymax) * H0;
  let s = text(20, 26, 'Each classifier: share of Done changes routed light, and what happened on the light ones', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Both repos, 1 June – 29 September 2026. Bubble area: the light group\'s share of all working hours it consumed.', { size: 11 });
  for (let v = 0; v <= xmax; v += 10) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${B}" stroke="${C.grid}"/>` + text(x(v), B + 16, `${v}%`, { anchor: 'middle' });
  for (let v = 0; v <= ymax; v += ymax / 4) s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + text(L - 8, y(v) + 4, v, { anchor: 'end' });
  s += text((L + R) / 2, B + 36, 'share of Done changes routed light', { anchor: 'middle', fill: C.ink });
  s += `<text transform="translate(18 ${(T + B) / 2}) rotate(-90)" font-size="11" fill="${C.ink}" text-anchor="middle">light changes (count)</text>`;
  const placed = [];
  for (const r of rs) {
    const cx = x(r.share); const rad = 4 + Math.sqrt(r.effortShare.workH || 0) * 3.2;
    s += `<circle cx="${cx}" cy="${y(r.read.wentWrong.length)}" r="${rad}" fill="${C.bubble}" fill-opacity="0.25" stroke="${C.bubble}"/>`;
    const raw = r.light.outcomes.escaped + r.light.outcomes.namedFix;
    s += `<line x1="${cx}" x2="${cx}" y1="${y(raw)}" y2="${y(r.read.wentWrong.length)}" stroke="${C.raw}" stroke-dasharray="2 2"/>`;
    s += `<circle cx="${cx}" cy="${y(raw)}" r="4" fill="#fff" stroke="${C.raw}" stroke-width="1.5"/>`;
    s += `<circle cx="${cx}" cy="${y(r.read.wentWrong.length)}" r="4.5" fill="${C.wrong}"/>`;
    s += `<path d="M${cx - 5},${y(r.read.caughtRealFault.length)} l5,-5 l5,5 l-5,5 z" fill="${C.caught}"/>`;
    let ly = y(Math.max(raw, r.read.caughtRealFault.length, r.read.wentWrong.length)) - rad - 6;
    while (placed.some((p) => Math.abs(p.x - cx) < 60 && Math.abs(p.y - ly) < 13)) ly -= 13;
    placed.push({ x: cx, y: ly });
    s += text(cx, ly, `${r.key} · ${r.effortShare.workH}% of hours`, { anchor: 'middle', fill: C.ink, size: 10.5, weight: 600 });
  }
  // Legend and key
  let ky = T + 4; const kx = R + 24;
  const key = [
    [(k) => `<circle cx="${kx + 5}" cy="${k - 4}" r="4" fill="#fff" stroke="${C.raw}" stroke-width="1.5"/>`, 'went wrong by the scorecard', '(escaped Bug or named fix)'],
    [(k) => `<circle cx="${kx + 5}" cy="${k - 4}" r="4.5" fill="${C.wrong}"/>`, 'went wrong after reading', '(finder rows and mentions out)'],
    [(k) => `<path d="M${kx},${k - 4} l5,-5 l5,5 l-5,5 z" fill="${C.caught}"/>`, 'review caught a real fault', '(send-back found, then fixed)'],
    [(k) => `<circle cx="${kx + 5}" cy="${k - 4}" r="8" fill="${C.bubble}" fill-opacity="0.25" stroke="${C.bubble}"/>`, 'light group\'s share of hours', ''],
  ];
  for (const [mark, a, c] of key) { s += mark(ky) + text(kx + 16, ky, a, { fill: C.ink }) + (c ? text(kx + 16, ky + 13, c, { size: 10 }) : ''); ky += 34; }
  ky += 6;
  for (const r of b.results) { s += text(kx, ky, `${r.key}  ${r.name}`, { size: 10, fill: SERIES[r.key] }); ky += 14; }
  writeFileSync(join(dir, 'light-share-vs-escapes.svg'), svg(W, B + 50, s));
}

// ---- Figure 2: share routed light by month, per classifier ----------------------------------------------------------------
{
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  const W = 760, L = 56, R = 540, T = 60, H0 = 240, B = T + H0;
  const ymax = Math.max(10, Math.ceil(Math.max(...b.results.flatMap((r) => months.map((m) => r.byMonth[m].share))) / 10) * 10);
  const x = (i) => L + 30 + i * ((R - L - 60) / (months.length - 1)), y = (v) => B - (v / ymax) * H0;
  let s = text(20, 26, 'Share of each month\'s Done changes that each classifier routes light', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, `Both repos, by month of last merge (changes: ${months.map((m) => b.coverage.byMonth[m]).join(', ')}). Red rings: light changes that went wrong after reading.`, { size: 11 });
  for (let v = 0; v <= ymax; v += 10) s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + text(L - 8, y(v) + 4, `${v}%`, { anchor: 'end' });
  months.forEach((m, i) => { s += text(x(i), B + 16, ['June', 'July', 'August', 'September'][i], { anchor: 'middle' }); });
  const wrongMonth = new Map();
  for (const r of b.results) {
    const pts = months.map((m, i) => [x(i), y(r.byMonth[m].share)]);
    s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${SERIES[r.key]}" stroke-width="2"/>`;
    s += pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${SERIES[r.key]}"/>`).join('');
    wrongMonth.set(r.key, months.map((m) => r.read.wentWrongByMonth?.[m] || 0));
    months.forEach((m, i) => { const k = r.read.wentWrongByMonth?.[m] || 0; if (k) s += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="${3 + 1.6 * k}" fill="none" stroke="${C.wrong}" stroke-width="1.2"/>`; });
    s += text(R + 8, pts.at(-1)[1] + 4, `${r.key} ${r.name}`, { size: 10, fill: SERIES[r.key] });
  }
  // de-overlap the right-hand labels crudely: redraw handled by reader; labels are short
  writeFileSync(join(dir, 'monthly-light-share.svg'), svg(W, B + 30, s));
}
console.log(`wrote ${dir}/light-share-vs-escapes.svg and monthly-light-share.svg`);
