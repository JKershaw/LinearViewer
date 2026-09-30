// LIN-3148: draw the where-the-effort-goes figures as hand-written SVG from data/survey-effort/analysis.json (no dependencies).
// Usage: node scripts/survey-effort-render.mjs [--dir data/survey-effort] [--out docs/papers/harbour/figures/where-the-effort-goes]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-effort');
const outDir = arg('--out', 'docs/papers/harbour/figures/where-the-effort-goes');
mkdirSync(outDir, { recursive: true });
const A = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));

const FONT = 'font-family="Inter, Helvetica, Arial, sans-serif"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// Overrides (`font-size="11" fill="#666"`) replace the defaults rather than repeat an attribute.
const text = (x, y, s, o = '') => {
  const at = { 'font-size': '12', fill: '#333' }; for (const [, k, v] of o.matchAll(/([a-z-]+)="([^"]*)"/g)) at[k] = v;
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${FONT} ${Object.entries(at).map(([k, v]) => `${k}="${v}"`).join(' ')}>${esc(s)}</text>`;
};
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>\n`;
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

// Stacked 100% bars: groups = [{label, n, parts: {key: value}}].
function stacked(title, subtitle, groups, keys, colors, file) {
  const W = 760; const H = 90 + groups.length * 44 + 70; const x0 = 150; const bw = W - x0 - 40;
  let b = text(20, 26, title, 'font-size="15" font-weight="600"') + text(20, 46, subtitle, 'fill="#666"');
  groups.forEach((g, i) => {
    const y = 70 + i * 44; const tot = keys.reduce((a, k) => a + (g.parts[k] || 0), 0) || 1; let x = x0;
    b += text(20, y + 20, g.label) + (g.n !== '' ? text(20, y + 34, `n=${g.n}`, 'fill="#888" font-size="11"') : '');
    for (const k of keys) {
      const w = (bw * (g.parts[k] || 0)) / tot; if (w <= 0) continue;
      b += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="30" fill="${colors[k]}"><title>${esc(k)} ${(100 * (g.parts[k] || 0) / tot).toFixed(1)}%</title></rect>`;
      if (w > 34) b += text(x + 4, y + 19, `${Math.round((100 * (g.parts[k] || 0)) / tot)}%`, 'fill="#fff" font-size="11"');
      x += w;
    }
  });
  let lx = 20; let ly = 70 + groups.length * 44 + 20;
  for (const k of keys) { const w = 22 + k.length * 6.6; if (lx + w > W - 10) { lx = 20; ly += 20; } b += `<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${colors[k]}"/>` + text(lx + 16, ly, k, 'font-size="11"'); lx += w + 10; }
  writeFileSync(join(outDir, file), svg(W, ly + 20, b));
}

// Log-log scatter coloured by class.
function scatter(title, subtitle, pts, xl, yl, classes, colors, file) {
  const W = 760; const H = 480; const L = 70; const R = 20; const T = 84; const B = 60; const pw = W - L - R; const ph = H - T - B;
  const lx = (v) => Math.log10(Math.max(v, 1)); const xs = pts.map((p) => lx(p.x)); const ys = pts.map((p) => Math.log10(Math.max(p.y, 1e-9)));
  const x1 = Math.ceil(Math.max(...xs, 1)); const y0 = Math.floor(Math.min(...ys)); const y1 = Math.ceil(Math.max(...ys));
  const X = (v) => L + (pw * lx(v)) / x1; const Y = (v) => T + ph - (ph * (Math.log10(Math.max(v, 1e-9)) - y0)) / (y1 - y0 || 1);
  let b = text(20, 24, title, 'font-size="15" font-weight="600"') + text(20, 44, subtitle, 'fill="#666"');
  for (let e = 0; e <= x1; e++) { const x = L + (pw * e) / x1; b += `<line x1="${x}" y1="${T}" x2="${x}" y2="${T + ph}" stroke="#eee"/>` + text(x - 10, T + ph + 18, e === 0 ? '≤1' : `${10 ** e >= 1000 ? 10 ** e / 1000 + 'k' : 10 ** e}`, 'font-size="11"'); }
  for (let e = y0; e <= y1; e++) { const y = Y(10 ** e); b += `<line x1="${L}" y1="${y}" x2="${L + pw}" y2="${y}" stroke="#eee"/>` + text(8, y + 4, 10 ** e >= 1e6 ? `${10 ** e / 1e6}M` : 10 ** e >= 1e3 ? `${10 ** e / 1e3}k` : `${10 ** e}`, 'font-size="11"'); }
  b += text(L + pw / 2 - 80, H - 16, xl) + text(8, T - 22, yl, 'font-size="11" fill="#666"');
  for (const c of classes) for (const p of pts.filter((q) => q.c === c)) b += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="5" fill="${colors[c]}" fill-opacity="0.8" stroke="#fff"><title>${esc(p.label)}</title></circle>`;
  let lxp = L + 10; for (const c of classes) { const n = pts.filter((p) => p.c === c).length; b += `<circle cx="${lxp}" cy="${T - 8}" r="5" fill="${colors[c]}"/>` + text(lxp + 9, T - 4, `${c} (${n})`, 'font-size="11"'); lxp += 30 + (c.length + 5) * 6.4; }
  writeFileSync(join(outDir, file), svg(W, H, b));
}

// Figure 1: where the weighted Claude tokens go, fleet-wide, by week (local transcripts; see survey-effort-fleet.mjs).
const LAYERS = ['Runner', 'leg', 'stepper', 'autopilot', 'wakes', 'research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'other worker'];
const C = { Runner: '#3b1f5e', leg: '#6a3d9a', stepper: '#8e63b5', autopilot: '#b594d6', wakes: '#d9c6ec', research: '#1f78b4', plan: '#4a98c9', 'plan-review': '#9ecae1', implementation: '#33a02c', review: '#e6550d', 'close-out': '#fdae6b', 'other worker': '#999' };
const F = JSON.parse(readFileSync(join(dir, 'fleet.json'), 'utf8'));
const WEEKS = { w1: '31 Aug–6 Sep', w2: '7–13 Sep', w3: '14–20 Sep', w4: '21–30 Sep' };
const all = {}; for (const x of Object.values(F.weekly)) for (const [k, v] of Object.entries(x)) all[k] = (all[k] || 0) + v;
stacked('Where the weighted tokens go, week by week', `All dispatched Claude sessions (${F.sessions}), both repos; supervision layers in purple, worker phases after`, [...Object.keys(WEEKS).map((w) => ({ label: WEEKS[w], n: '', parts: F.weekly[w] || {} })), { label: 'All 30 days', n: F.sessions, parts: all }], LAYERS.filter((k) => all[k]), C, 'anatomy-tokens.svg');
const git = A.tickets;

// Figure 2: the monthly march of runner time per ticket (census), working vs waiting.
const TC = { working: '#33a02c', 'waiting on another session': '#9ecae1', 'waiting on a human': '#e6550d' };
const months = [...new Set(A.census.filter((c) => c.timedSessions && c.month >= '2026-07').map((c) => c.month))].sort();
stacked('Runner session time per ticket: working vs waiting', 'Every merged Done ticket the runner dispatched for, by merge month; share of summed session hours (oplog from 12 Jul)', months.map((m) => { const cs = A.census.filter((c) => c.month === m && c.timedSessions); return { label: new Date(m + '-15').toLocaleString('en-GB', { month: 'long' }), n: cs.length, parts: { working: cs.reduce((a, c) => a + c.workH, 0), 'waiting on another session': cs.reduce((a, c) => a + c.peerWaitH, 0), 'waiting on a human': cs.reduce((a, c) => a + c.humanWaitH, 0) } }; }), Object.keys(TC), TC, 'anatomy-time-monthly.svg');

// Figure 3: effort against size, coloured by risk (headline scatter). Tokens: September sample.
const RC = { high: '#d62728', rest: '#1f77b4', 'UI only': '#2ca02c', 'docs/tests only': '#aaa' };
const RISKS = ['docs/tests only', 'UI only', 'rest', 'high'];
scatter('Effort against the size of the change', 'September sample: weighted tokens (frontier-input-equivalent units) vs production lines changed, coloured by risk class', git.map((t) => ({ x: t.prodLines, y: t.total, c: t.risk, label: `${t.id} ${t.prodLines} prod lines, ${(t.total / 1e6).toFixed(2)}M units` })), 'production lines changed (added + deleted, log)', 'weighted tokens (log)', RISKS, RC, 'effort-vs-size.svg');

// Figure 4: dispatches against size for the July–September census, coloured by month.
const MC = { '2026-07': '#9ecae1', '2026-08': '#4a98c9', '2026-09': '#08519c' };
const cs = A.census.filter((c) => c.seen && c.month >= '2026-07');
scatter('Dispatches against the size of the change, by month', 'Every merged Done ticket the runner dispatched for (runner logs), July–September', cs.map((c) => ({ x: c.prodLines, y: c.dispatches, c: c.month, label: `${c.id} ${c.prodLines} prod lines, ${c.dispatches} dispatches` })), 'production lines changed (added + deleted, log)', 'dispatches (log)', Object.keys(MC), MC, 'dispatches-vs-size.svg');
console.log(`wrote 4 figures to ${outDir}; sample n=${git.length}, census n=${cs.length}; median units ${med(git.map((t) => t.total)).toFixed(0)}`);
