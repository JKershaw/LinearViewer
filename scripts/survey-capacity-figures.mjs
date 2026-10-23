// cheaper-capacity.md: draw its four SVG charts from survey-capacity-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-capacity-figures.mjs [--in docs/papers/harbour/cheaper-capacity-data.json] [--out docs/papers/harbour/figures/cheaper-capacity]
// Then `npm run figures:theme` adds the dark-mode block.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'docs/papers/harbour/cheaper-capacity-data.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/cheaper-capacity');
mkdirSync(outDir, { recursive: true });

// The same categorical colours as model-choice's figures: blue, orange, green; each series is also labelled directly.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', marker: '#9ca3af', blue: '#2a78d6', orange: '#eb6834', green: '#1baf7a', band: '#eef2f7' };
const FAMILY = { claude: C.blue, closed: C.orange, open: C.green };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const line = (x1, y1, x2, y2, stroke, o = '') => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" ${o}/>`;
const usd = (x) => (x >= 100 ? `$${Math.round(x).toLocaleString('en-GB')}` : `$${x.toFixed(x < 1 ? 2 : 0)}`);

// ---- 1. Where October's money went: API-equivalent cost by stage, by model.
{
  const JUDGE_MINOR = new Set(['blocked', 'bug', 'custom', 'design', 'retrospective-audit', 'breakdown', 'spike', 'scoping']);
  const rows = new Map();
  for (const s of A.october.stages) {
    if (s.usd < 1) continue;
    const kind = JUDGE_MINOR.has(s.kind) ? 'other (bug, blocked, design…)' : s.kind;
    const model = s.model === 'claude-opus-5-5' ? 'opus' : s.model === 'claude-sonnet-5-5' ? 'sonnet' : 'other';
    if (!rows.has(kind)) rows.set(kind, { opus: 0, sonnet: 0, other: 0 });
    rows.get(kind)[model] += s.usd;
  }
  const list = [...rows].map(([k, v]) => ({ k, ...v, t: v.opus + v.sonnet + v.other })).sort((a, b) => b.t - a.t);
  const W = 720, rowH = 26, top = 64, left = 190, right = 90, H = top + list.length * rowH + 40;
  const max = Math.max(...list.map((r) => r.t));
  const x = (v) => left + (v / max) * (W - left - right);
  let s = svgOpen(W, H, `Where October's money went: API-equivalent cost of ${A.october.lineages} worker sessions on ${A.october.ticketsWithLineage} Done tickets, by stage and model`);
  const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  s += text(16, 24, `Where October's money went (${day(A.october.firstDispatch)} to ${day(A.october.lastDispatch)})`, { size: 14, fill: C.ink, weight: 600 });
  s += text(16, 42, `API-equivalent USD, ${A.october.lineages.toLocaleString('en-GB')} worker sessions on ${A.october.ticketsWithLineage} Done tickets; total ${usd(A.october.totalUsd)}`, { size: 11 });
  s += `<rect x="${W - 250}" y="34" width="10" height="10" fill="${C.blue}"/>` + text(W - 236, 43, 'Opus 5.5', { fill: C.ink });
  s += `<rect x="${W - 170}" y="34" width="10" height="10" fill="${C.orange}"/>` + text(W - 156, 43, 'Sonnet 5.5', { fill: C.ink });
  list.forEach((r, i) => {
    const y = top + i * rowH;
    s += text(left - 8, y + 15, r.k, { anchor: 'end', fill: C.ink });
    let cx = left;
    for (const [m, col] of [['opus', C.blue], ['sonnet', C.orange], ['other', C.marker]]) {
      if (!r[m]) continue;
      const w = x(r[m]) - left;
      s += `<rect x="${cx.toFixed(1)}" y="${y + 4}" width="${Math.max(w, 1).toFixed(1)}" height="${rowH - 9}" fill="${col}"/>`;
      cx += w;
    }
    s += text(cx + 6, y + 15, `${usd(r.t)} · ${Math.round((r.t / A.october.totalUsd) * 100)}%`, { fill: C.ink });
  });
  s += text(16, H - 12, 'Source: GET /api/proxy/issues/{id}/cost for every Done ticket LIN-3350 and above, read 23 October; a lineage under two tickets counted once.', { size: 10 });
  writeFileSync(join(outDir, 'stage-cost.svg'), s + '</svg>\n');
}

// ---- 2. The bar and the price: Terminal-Bench 4.0 against the price of one reference session (log scale).
{
  const pts = A.candidates.filter((c) => c.tb4 != null && c.session && c.session.base);
  const W = 760, H = 500, L = 64, R = 30, T = 70, B = 64;
  const lx = (v) => Math.log10(v);
  const x0 = lx(0.01), x1 = lx(10);
  const X = (v) => L + ((lx(v) - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - v / 70) * (H - T - B);
  let s = svgOpen(W, H, 'The bar and the price: independent Terminal-Bench 4.0 score against the price of one reference agent session, with the scores of the models Harbour has seen judge and build');
  s += text(16, 24, 'The bar and the price', { size: 14, fill: C.ink, weight: 600 });
  s += text(16, 42, 'Terminal-Bench 4.0 (Vals, independent, 22 Oct) against the list price of one reference session on OpenRouter (23 Oct), log scale', { size: 11 });
  // Builder band: from the lowest to the highest score among models Harbour has seen build to its gate's standard.
  const builders = A.candidates.filter((c) => (c.harbour === 'builder' || c.harbour === 'small') && c.tb4 != null).map((c) => c.tb4);
  const bLo = Math.min(...builders), bHi = Math.max(...builders);
  s += `<rect x="${L}" y="${Y(bHi).toFixed(1)}" width="${W - L - R}" height="${(Y(bLo) - Y(bHi)).toFixed(1)}" fill="${C.band}"/>`;
  s += text(L + 6, Y(bLo) + 14, `shaded: where the models Harbour has seen build score (${bLo}–${bHi})`, { fill: C.ink, size: 10 });
  const judge = A.candidates.find((c) => c.harbour === 'judge');
  s += line(L, Y(judge.tb4), W - R, Y(judge.tb4), C.ink, 'stroke-dasharray="4 3"');
  s += text(L + 6, Y(judge.tb4) - 5, `Opus 5, Harbour's judge until September (${judge.tb4})`, { fill: C.ink, size: 10 });
  for (let v = 0; v <= 70; v += 10) { s += line(L, Y(v), W - R, Y(v), C.grid); s += text(L - 6, Y(v) + 4, String(v), { anchor: 'end', size: 10 }); }
  for (const v of [0.01, 0.03, 0.1, 0.3, 1, 3, 10]) { s += line(X(v), T, X(v), H - B, C.grid); s += text(X(v), H - B + 16, usd(v), { anchor: 'middle', size: 10 }); }
  s += text((L + W - R) / 2, H - B + 34, 'price of one reference session (2M input-side tokens, 92% cache reads, 30k output)', { anchor: 'middle', size: 10 });
  // Labels placed right of the point unless that would run off the chart.
  const OFFSET = { 'Sonnet 5.5': [8, 12], 'Opus 5.5': [8, -4], 'GPT-6.1 Sol': [8, 14], 'Gemini 4 Argon': [-8, -2, 'end'], 'Fable 5.1': [-8, 4, 'end'], 'GPT-6 Astra': [-8, -6, 'end'], 'GLM-5.3 Flash': [8, 12], 'Qwen 3.8 Max': [8, -2], 'DeepSeek V4.1 Flash 1017': [-8, -4, 'end'], 'MiMo V2.6 Pro': [8, 12], 'Step 5 Preview': [8, 4], 'GLM-5.3': [8, -4], 'Haiku 5.5': [-8, 4, 'end'], 'MiMo V2.6 Flash': [-8, 12, 'end'], 'MiniMax M3.1 Flash': [8, 4], 'DeepSeek V4.1 Flash (Sept)': [8, 18], 'Gemini 3.8 Flash': [8, -8], 'DeepSeek V4 Flash 0731': [8, 4], 'GPT-6 Luna': [-8, 12, 'end'], 'Kimi K3': [8, 4], 'Grok 4.7': [8, 4], 'Sonnet 5': [8, 4], 'Opus 5': [8, 12], Inkling: [8, -4] };
  for (const c of pts) {
    const cx = X(c.session.base), cy = Y(c.tb4), col = FAMILY[c.family];
    s += c.harbour ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="${col}"/>` : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${C.surface}" stroke="${col}" stroke-width="2"/>`;
    const [dx, dy, anchor] = OFFSET[c.label] || [8, 4];
    s += text(cx + dx, cy + dy, c.label, { anchor: anchor || 'start', fill: C.ink, size: 10 });
  }
  const ly = T - 12;
  s += `<circle cx="${L + 6}" cy="${ly}" r="5" fill="${C.ink}"/>` + text(L + 16, ly + 4, 'seen in Harbour', { fill: C.ink, size: 10 });
  s += `<circle cx="${L + 120}" cy="${ly}" r="5" fill="${C.surface}" stroke="${C.ink}" stroke-width="2"/>` + text(L + 130, ly + 4, 'not yet tried', { fill: C.ink, size: 10 });
  [['Claude', C.blue], ['other closed', C.orange], ['open weight', C.green]].forEach(([n, col], i) => { s += `<rect x="${L + 230 + i * 100}" y="${ly - 5}" width="10" height="10" fill="${col}"/>` + text(L + 244 + i * 100, ly + 4, n, { fill: C.ink, size: 10 }); });
  s += text(16, H - 10, 'gpt-oss-120b (produced no work in Harbour) has no Terminal-Bench 4.0 score. Inkling is free on OpenRouter today.', { size: 10 });
  writeFileSync(join(outDir, 'bar-and-price.svg'), s + '</svg>\n');
}

// ---- 3. What one dollar buys, in reference sessions, by route (log scale).
{
  const rows = A.routes.map((r) => ({ ...r })).sort((a, b) => b.perDollar - a.perDollar);
  const W = 760, rowH = 26, top = 60, left = 330, right = 70, H = top + rows.length * rowH + 60;
  const fmt = (v) => (v >= 10 ? String(Math.round(v)) : String(v));
  const x0 = Math.log10(0.3), x1 = Math.log10(3000);
  const X = (v) => left + ((Math.log10(v) - x0) / (x1 - x0)) * (W - left - right);
  let s = svgOpen(W, H, 'What one dollar buys: reference agent sessions per dollar by route, Claude subscription, coding plans and pay-per-token');
  s += text(16, 24, 'What one dollar buys', { size: 14, fill: C.ink, weight: 600 });
  s += text(16, 42, 'Reference sessions per dollar, log scale. Subscriptions at the vendor’s own volume statement; API at OpenRouter list price, 23 Oct.', { size: 11 });
  for (const v of [1, 10, 100, 1000]) { s += line(X(v), top - 4, X(v), top + rows.length * rowH, C.grid); s += text(X(v), top + rows.length * rowH + 14, String(v), { anchor: 'middle', size: 10 }); }
  rows.forEach((r, i) => {
    const y = top + i * rowH, col = r.kind === 'subscription' ? C.blue : C.green;
    s += text(left - 8, y + 15, r.route, { anchor: 'end', fill: C.ink, size: 10.5 });
    s += `<rect x="${left}" y="${y + 5}" width="${(X(r.perDollar) - left).toFixed(1)}" height="${rowH - 10}" fill="${col}"/>`;
    if (r.perDollarHigh) s += `<rect x="${X(r.perDollar).toFixed(1)}" y="${y + 5}" width="${(X(r.perDollarHigh) - X(r.perDollar)).toFixed(1)}" height="${rowH - 10}" fill="${col}" fill-opacity="0.35"/>`;
    s += text(X(r.perDollarHigh || r.perDollar) + 6, y + 15, r.perDollarHigh ? `${fmt(r.perDollar)}–${fmt(r.perDollarHigh)}` : fmt(r.perDollar), { fill: C.ink, size: 10.5 });
  });
  s += `<rect x="16" y="${H - 42}" width="10" height="10" fill="${C.blue}"/>` + text(30, H - 33, 'subscription or plan', { fill: C.ink, size: 10 });
  s += `<rect x="150" y="${H - 42}" width="10" height="10" fill="${C.green}"/>` + text(164, H - 33, 'pay per token', { fill: C.ink, size: 10 });
  s += text(16, H - 12, 'Claude rows assume the weekly window draws in proportion to API price, which Anthropic does not state.', { size: 10 });
  writeFileSync(join(outDir, 'per-dollar.svg'), s + '</svg>\n');
}

// ---- 4. Re-tiering inside the window: how many Octobers the same weekly window would carry.
{
  const sc = A.scenarios;
  const rows = [
    { label: 'Today: Opus 5.5 judges, Sonnet 5.5 builds', lo: sc[0].capacity, hi: sc[0].capacity },
    { label: 'Judging stages to Sonnet 5.5', lo: sc[1].capacity, hi: sc[1].capacity },
    { label: 'Building stages to Haiku 5.5', lo: sc[3].capacity, hi: sc[2].capacity },
    { label: 'Both', lo: sc[5].capacity, hi: sc[4].capacity },
  ];
  const W = 720, rowH = 34, top = 64, left = 270, right = 80, H = top + rows.length * rowH + 40;
  const X = (v) => left + (v / 3) * (W - left - right);
  let s = svgOpen(W, H, 'Re-tiering inside the window: work the same weekly window would carry, as a multiple of October, if stages moved to cheaper Claude models');
  s += text(16, 24, 'Re-tiering inside the window', { size: 14, fill: C.ink, weight: 600 });
  s += text(16, 42, "October's sessions re-priced at another Claude model's list price; work carried as a multiple of today", { size: 11 });
  for (const v of [0, 1, 2, 3]) { s += line(X(v), top - 4, X(v), top + rows.length * rowH, C.grid); s += text(X(v), top + rows.length * rowH + 14, `×${v}`, { anchor: 'middle', size: 10 }); }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    s += text(left - 8, y + 20, r.label, { anchor: 'end', fill: C.ink });
    s += `<rect x="${left}" y="${y + 8}" width="${(X(r.lo) - left).toFixed(1)}" height="${rowH - 16}" fill="${C.blue}"/>`;
    if (r.hi > r.lo) s += `<rect x="${X(r.lo).toFixed(1)}" y="${y + 8}" width="${(X(r.hi) - X(r.lo)).toFixed(1)}" height="${rowH - 16}" fill="${C.blue}" fill-opacity="0.35"/>`;
    s += text(X(r.hi) + 6, y + 21, r.hi > r.lo ? `×${r.lo}–${r.hi}` : `×${r.lo}`, { fill: C.ink });
  });
  s += text(16, H - 12, "Pale: Haiku 5.5's long-context price (prompts over 100k) against its base price. Assumes the window draws in proportion to API price.", { size: 10 });
  writeFileSync(join(outDir, 'retiering.svg'), s + '</svg>\n');
}
console.log('wrote 4 figures to', outDir);
