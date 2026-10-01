// LIN-3207: draw prompt-kinds.md's headline SVG (September's dispatches of each of the 17 template kinds, by the route that chose the kind) from survey-kinds-analyse.mjs's census, by hand (no dependencies).
// Usage: node scripts/survey-kinds-figures.mjs [--in data/survey-kinds/census.json] [--out docs/papers/harbour/figures/prompt-kinds]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const a = JSON.parse(readFileSync(arg('--in', 'data/survey-kinds/census.json'), 'utf8'));
const dir = arg('--out', 'docs/papers/harbour/figures/prompt-kinds');
mkdirSync(dir, { recursive: true });

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb' };
const ROUTES = [['recommender', '#1d4ed8', 'the engine chose it'], ['override', '#7c3aed', 'a supervisor pinned it; template body'],
  ['written', '#b45309', 'a supervisor labelled its own prompt'], ['beat', '#f59e0b', 'a written follow-up into a held session'],
  ['untraced', '#9ca3af', 'UI, server-minted, passage legs, other harness']];
const KINDS = ['blocked', 'bug', 'plan', 'look-into', 'triage', 'breakdown', 'research', 'scoping', 'design', 'spike', 'context',
  'plan-review', 'implementation', 'review', 'close-out', 'retrospective-audit', 'retro'];
const CORE = new Set(['plan', 'plan-review', 'implementation', 'review', 'close-out', 'research']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>\n`;

const rows = KINDS.map((k) => { const c = a.census[k] || {}; const parts = ROUTES.map(([r]) => c[r] || 0); return { k, parts, total: parts.reduce((s, x) => s + x, 0) }; })
  .sort((p, q) => q.total - p.total);
const all = rows.reduce((s, r) => s + r.total, 0); const core = rows.filter((r) => CORE.has(r.k)).reduce((s, r) => s + r.total, 0);
const W = 900, L = 150, R = 700, T = 96, rowH = 22, B = T + rows.length * rowH;
const xmax = Math.ceil(Math.max(...rows.map((r) => r.total)) / 100) * 100; const x = (v) => L + (v / xmax) * (R - L);
let s = text(20, 26, 'Six kinds carry the work: September\'s dispatches of each template kind, by who chose the kind', { size: 13, fill: C.ink, weight: 600 });
s += text(20, 44, `${all.toLocaleString('en')} dispatches labelled with a template kind that a local session enqueued or fetched, 1–30 September (wakes, kickoffs and custom prompts left out).`, { size: 11 });
s += text(20, 60, `The six core kinds are ${Math.round((100 * core) / all)}% of them; the other eleven share ${all - core}. Bars in bold are the core loop plus research.`, { size: 11 });
for (let v = 0; v <= xmax; v += 100) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${B}" stroke="${C.grid}"/>` + text(x(v), B + 16, `${v}`, { anchor: 'middle' });
rows.forEach((r, i) => {
  const y0 = T + i * rowH; let cx = L;
  s += text(L - 10, y0 + 12, r.k, { anchor: 'end', fill: C.ink, size: 11.5, weight: CORE.has(r.k) ? 600 : 400 });
  r.parts.forEach((n, j) => { if (!n) return; const w = Math.max(1.5, x(n) - L); s += `<rect x="${cx}" y="${y0 + 2}" width="${w}" height="14" fill="${ROUTES[j][1]}"/>`; cx += w; });
  s += text(cx + 6, y0 + 13, r.total ? `${r.total}` + (CORE.has(r.k) ? '' : `  (engine ${r.parts[0]})`) : '0 — never dispatched', { size: 10.5, fill: C.ink });
});
let ky = T + 150; const kx = R - 150;
s += text(kx, ky - 22, 'Who chose the kind', { fill: C.ink, weight: 600 });
for (const [r, col, sub] of ROUTES) { s += `<rect x="${kx}" y="${ky - 10}" width="12" height="10" fill="${col}"/>` + text(kx + 18, ky, r, { fill: C.ink }) + text(kx + 18, ky + 13, sub, { size: 10 }); ky += 32; }
s += text(20, B + 40, `Source: survey-kinds-transcripts.mjs → survey-kinds-analyse.mjs (LinearViewer). The runner launched ${a.coverage.shapes.fresh.claimed.toLocaleString('en')} fresh sessions in September; transcripts show ${a.coverage.shapes.fresh.seen.toLocaleString('en')} of them.`, { size: 10 });
writeFileSync(join(dir, 'kinds-by-route.svg'), svg(W, B + 54, s));
console.log(`wrote ${join(dir, 'kinds-by-route.svg')}: ${all} dispatches, core ${core}`);
