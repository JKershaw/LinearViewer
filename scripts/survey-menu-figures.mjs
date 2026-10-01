// LIN-3194 (version 2, LIN-3195): draw steady-base-menu.md's SVG charts from survey-menu-analyse.mjs's output, by hand (no dependencies).
// Usage: node scripts/survey-menu-figures.mjs [--in data/survey-menu/menu.json] [--out docs/papers/harbour/figures/steady-base-menu]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const a = JSON.parse(readFileSync(arg('--in', 'data/survey-menu/menu.json'), 'utf8'));
const dir = arg('--out', 'docs/papers/harbour/figures/steady-base-menu');
mkdirSync(dir, { recursive: true });

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', bound: '#b91c1c', two: '#047857' };
const FCOL = { F1: '#1d4ed8', F2: '#7c3aed', F3: '#b45309', F4: '#db2777', F5: '#6b7280' };
const FNAME = { F1: 'supervision plumbing', F2: 'legs that need not run', F3: 'tokens per session', F4: 'which changes get the full process', F5: 'hours, not tokens' };
const RISK = ['none or positive', 'low', 'low–medium', 'medium', 'high'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>\n`;

// ---- Figure 1 (headline): the menu, size against risk, with the stack that reaches 2× marked ---------------------------------
{
  const opts = a.options.filter((o) => o.factor !== 'F6');
  const tokenOpts = opts.filter((o) => !(o.factor === 'F5' && o.hi === 0));
  const hourOpts = opts.filter((o) => o.factor === 'F5' && o.hi === 0);
  const twoX = new Set(['M3', 'M4', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M16', 'M17', 'M21']); // S4's members; M1, M2, M5 sit inside M3
  const hollow = new Set(['M1', 'M2', 'M5', 'M6', 'M15']);
  const W = 1100, L = 150, R = 700, T = 96;
  const byRisk = RISK.map((_, i) => tokenOpts.filter((o) => o.risk === i).sort((p, q) => (q.hi || 0) - (p.hi || 0)));
  const rowH = byRisk.map((rows) => Math.max(44, 17 * rows.length + 16));
  const rowY = rowH.map((_, i) => T + rowH.slice(0, i).reduce((p, q) => p + q, 0));
  const B = T + rowH.reduce((p, q) => p + q, 0);
  const xmin = 0.1, xmax = 30; // log scale, share of fleet tokens
  const x = (v) => L + (Math.log10(Math.max(v, xmin)) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin)) * (R - L);
  let s = text(20, 26, 'The menu: each option\'s size against its risk to correctness, with the stack that reaches 2× marked', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Size: share of September\'s fleet weighted tokens the option would save, both repos, as the cited paper states it at version 2 or later (bar: its range).', { size: 11 });
  s += text(20, 60, 'Risk: the paper\'s own words. Dark outline: in stack S4, the only stack whose top reaches 2×. Hollow: inside or overlapping M3, so not a separate saving.', { size: 11 });
  for (const v of [0.1, 0.3, 1, 3, 10, 30]) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${B}" stroke="${C.grid}"/>` + text(x(v), B + 16, `${v}%`, { anchor: 'middle' });
  s += text((L + R) / 2, B + 34, 'share of fleet weighted tokens saved (log scale)', { anchor: 'middle', fill: C.ink });
  RISK.forEach((r, i) => {
    s += `<line x1="${L}" x2="${R}" y1="${rowY[i] + rowH[i]}" y2="${rowY[i] + rowH[i]}" stroke="${C.grid}"/>` + text(L - 8, rowY[i] + rowH[i] / 2 + 4, r, { anchor: 'end', fill: C.ink, size: 11.5 });
  });
  byRisk.forEach((rows, i) => {
    rows.forEach((o, k) => {
      const y = rowY[i] + 14 + k * 17; const col = FCOL[o.factor]; const inStack = twoX.has(o.id) || ['M1', 'M2', 'M5', 'M15'].includes(o.id); const h = hollow.has(o.id);
      const x0 = x(o.lo || xmin), x1 = x(o.hi);
      if (x1 - x0 > 1) s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="${inStack ? 3 : 1.5}" stroke-opacity="${h ? 0.45 : 0.9}"/>`;
      s += `<circle cx="${x1}" cy="${y}" r="${inStack ? 5 : 4}" fill="${h ? '#fff' : col}" stroke="${inStack ? C.ink : col}" stroke-width="${inStack ? 2 : 1}"/>`;
      s += text(x1 + 9, y + 4, `${o.id} ${o.label.replace(/ \(.*\)$/, '')}${o.derived ? ' *' : ''}`, { size: 9.5, fill: C.ink });
    });
  });
  // options sized in hours or friction, not tokens
  let hy = B + 58;
  s += text(20, hy, 'Sized in hours or friction, not tokens:', { fill: C.ink, size: 11.5, weight: 600 }); hy += 17;
  hourOpts.forEach((o) => { s += `<circle cx="${26}" cy="${hy - 4}" r="4" fill="${FCOL.F5}"/>` + text(36, hy, `${o.id} ${o.label}: ${o.hours} (risk ${RISK[o.risk]})`, { size: 9.5, fill: C.ink }); hy += 15; });
  let ky = T + 2; const kx = 880;
  for (const f of ['F1', 'F2', 'F3', 'F4', 'F5']) { s += `<rect x="${kx}" y="${ky - 9}" width="12" height="9" fill="${FCOL[f]}"/>` + text(kx + 18, ky, FNAME[f], { fill: C.ink, size: 10.5 }); ky += 18; }
  ky += 8; s += text(kx, ky, '* a range this paper derived', { size: 9.5 }); ky += 13; s += text(kx, ky, '  from checked figures', { size: 9.5 });
  writeFileSync(join(dir, 'menu-size-vs-risk.svg'), svg(W, hy + 6, s));
}

// ---- Figure 2: the stacks against 2× and cost-mix's bound ----------------------------------------------------------------------
{
  const st = a.stacks; const W = 1000, L = 330, R = 800, T = 116, rowH = 40, B = T + st.length * rowH + 50;
  const xmax = 3; const x = (m) => L + ((m - 1) / (xmax - 1)) * (R - L);
  let s = text(20, 26, 'How the options combine: each stack\'s multiple of correct work per weekly budget, against 2× and the bound', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Within a cost factor, overlapping options count once; across factors the multiples multiply. Solid bar: multiplied, low to high end of every member\'s range.', { size: 11 });
  s += text(20, 60, 'Thin grey: the same shares added, as if nothing overlapped. Dotted: the same stack applied to everything but credential work, which is held at today\'s cost.', { size: 11 });
  s += text(20, 76, 'Red: cost-mix v2\'s bound on that same footing, credential work held and everything else three times cheaper.', { size: 11 });
  for (let m = 1; m <= xmax; m += 0.5) s += `<line x1="${x(m)}" x2="${x(m)}" y1="${T - 6}" y2="${B - 40}" stroke="${C.grid}"/>` + text(x(m), B - 24, `${m}×`, { anchor: 'middle' });
  s += `<line x1="${x(2)}" x2="${x(2)}" y1="${T - 10}" y2="${B - 40}" stroke="${C.two}" stroke-width="2" stroke-dasharray="5 3"/>` + text(x(2), T - 14, '2×, John\'s aim', { anchor: 'middle', fill: C.two, size: 10.5 });
  s += `<line x1="${x(2.5)}" x2="${x(2.5)}" y1="${T - 10}" y2="${B - 40}" stroke="${C.bound}" stroke-width="2"/>` + text(x(2.5), T - 14, 'bound 2.5×', { anchor: 'middle', fill: C.bound, size: 10.5 });
  s += `<line x1="${x(1.7)}" x2="${x(1.8)}" y1="${T - 2}" y2="${T - 2}" stroke="${C.muted}" stroke-width="4"/>` + text(x(1.75), T - 24, 'cost-mix options 1–4', { anchor: 'middle', size: 9.5 });
  st.forEach((k, i) => {
    const y = T + i * rowH + 16;
    s += text(L - 10, y + 4, k.name, { anchor: 'end', fill: C.ink, size: 11 });
    const add1 = Math.min(k.ifAdded.hi, xmax);
    s += `<line x1="${x(k.ifAdded.lo)}" x2="${x(add1)}" y1="${y}" y2="${y}" stroke="#d1d5db" stroke-width="3"/>`;
    if (k.ifAdded.hi > xmax) s += text(x(xmax) + 6, y + 4, `added: ×${k.ifAdded.hi}`, { size: 9.5 });
    s += `<rect x="${x(k.multiple.lo)}" y="${y - 7}" width="${Math.max(2, x(k.multiple.hi) - x(k.multiple.lo))}" height="14" fill="${k.multiple.hi >= 2 ? C.two : '#1d4ed8'}" fill-opacity="0.85"/>`;
    s += `<line x1="${x(k.creditHeld.lo)}" x2="${x(k.creditHeld.hi)}" y1="${y + 12}" y2="${y + 12}" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
    s += text(x(k.multiple.hi) + 6, y + 4, `×${k.multiple.lo}–${k.multiple.hi}`, { size: 10, fill: C.ink });
  });
  s += text(20, B - 4, `Added as if nothing overlapped, the menu's token options come to ${a.naiveSum}% of the budget: more than the whole. Counted once per factor and multiplied, the whole menu is ×${st.at(-1).multiple.lo}–${st.at(-1).multiple.hi}.`, { size: 10.5, fill: C.ink });
  writeFileSync(join(dir, 'stacks-vs-bound.svg'), svg(W, B + 6, s));
}
console.log(`wrote ${dir}/menu-size-vs-risk.svg, stacks-vs-bound.svg`);
