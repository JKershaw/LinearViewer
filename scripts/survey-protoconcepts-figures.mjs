// LIN-3187: draw prototype-concepts.md's SVG charts — the concept-by-lever evidence matrix and the per-study cost comparison — by hand (no dependencies).
// Usage: node scripts/survey-protoconcepts-figures.mjs [--matrix docs/papers/harbour/prototype-concepts-matrix.json] [--harbour data/survey-protoconcepts/harbour.json] [--lighthouse data/survey-protoconcepts/lighthouse.json] [--out docs/papers/harbour/figures/prototype-concepts]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const matrix = JSON.parse(readFileSync(arg('--matrix', 'docs/papers/harbour/prototype-concepts-matrix.json'), 'utf8'));
const harbour = JSON.parse(readFileSync(arg('--harbour', 'data/survey-protoconcepts/harbour.json'), 'utf8'));
const lighthouse = JSON.parse(readFileSync(arg('--lighthouse', 'data/survey-protoconcepts/lighthouse.json'), 'utf8'));
const dir = arg('--out', 'docs/papers/harbour/figures/prototype-concepts');
mkdirSync(dir, { recursive: true });

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', lh: '#047857', paper: '#1d4ed8', code: '#b45309' };
// Evidence strength 0–3, light to dark; null (lever not served) is left blank.
const SHADE = ['#f3f4f6', '#dbeafe', '#93c5fd', '#1d4ed8'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>\n`;

// ---- Figure 1 (headline): concepts against levers, shaded by strength of evidence -----------------------------------------
{
  const levers = matrix.levers; const rows = matrix.concepts;
  const W = 1080, L = 430, T = 118, cw = (W - L - 30) / levers.length, rh = 34, B = T + rows.length * rh;
  let s = text(20, 26, 'Which prototype concepts serve which of Harbour\'s levers, and how strong the evidence for each is', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Shade: the strongest evidence the prototype produced for that lever, on its own endpoint, not on Harbour\'s. Blank: the concept does not serve the lever.', { size: 11 });
  s += text(20, 60, '0 idea only · 1 recorded observation, no control · 2 controlled comparison, single runs or an internal endpoint · 3 controlled, repeated, stated endpoint', { size: 11 });
  levers.forEach((lv, j) => {
    const cx = L + j * cw + cw / 2;
    lv.label.split('\n').forEach((ln, k) => { s += text(cx, T - 30 + k * 13, ln, { anchor: 'middle', fill: C.ink, size: 11 }); });
  });
  rows.forEach((r, i) => {
    const y0 = T + i * rh;
    s += text(L - 10, y0 + 15, r.concept, { anchor: 'end', fill: C.ink, size: 11.5 });
    s += text(L - 10, y0 + 28, r.repo, { anchor: 'end', size: 9.5 });
    levers.forEach((lv, j) => {
      const v = r.levers[lv.key]; const x0 = L + j * cw;
      s += `<rect x="${x0 + 2}" y="${y0 + 2}" width="${cw - 4}" height="${rh - 4}" fill="${v == null ? '#fff' : SHADE[v]}" stroke="${C.grid}"/>`;
      if (v != null) s += text(x0 + cw / 2, y0 + rh / 2 + 4, r.primary === lv.key ? `${v} ●` : String(v), { anchor: 'middle', fill: v >= 3 ? '#fff' : C.ink, size: 11, weight: r.primary === lv.key ? 600 : null });
    });
  });
  s += text(20, B + 20, '● the lever the concept chiefly serves. Strength is of the prototype\'s own evidence; none of it was measured inside Harbour except the pointer probe (LIN-2115).', { size: 10 });
  writeFileSync(join(dir, 'concept-lever-matrix.svg'), svg(W, B + 34, s));
}

// ---- Figure 2: what one study or change costs, Lighthouse against Harbour, in list-price dollars at one price table --------
{
  const P = harbour.populations;
  const pop = (k, label, col, sub) => ({ k: label, v: P[k].usdEntered.median, lo: P[k].usdEntered.p25, hi: P[k].usdEntered.p75, col, sub: `n=${P[k].n}, ${sub}` });
  const bars = [
    ...lighthouse.studyRows.map((r) => ({ k: `Lighthouse ${r.id}`, v: r.usd, col: C.lh, sub: r.id === 'LH017' ? 'the driving session did the research' : `review ${Math.round(100 * (r.reviewShareOfSubagents ?? 0))}% of subagent spend${r.unknownReview ? ', + relayed review' : ''}` })),
    pop('lean paper', 'Harbour paper, one session', C.paper, 'median and IQR'),
    { k: 'Harbour paper with its check', v: harbour.checks.paperWithCheckUsd.median, lo: harbour.checks.paperWithCheckUsd.p25, hi: harbour.checks.paperWithCheckUsd.p75, col: C.paper, sub: `n=${harbour.checks.priced}, plus its share of the check` },
    pop('pipeline paper', 'Harbour paper through the pipeline', C.paper, 'research, review, close-out'),
    pop('code change', 'Harbour code change', C.code, 'merged in September'),
  ];
  const W = 960, L = 280, R = 820, T = 92, rh = 30, B = T + bars.length * rh;
  const xmax = Math.ceil(Math.max(...bars.map((b) => b.hi || b.v)) / 10) * 10; const x = (v) => L + (v / xmax) * (R - L);
  let s = text(20, 26, 'What one piece of work costs: a Lighthouse study, a Harbour research paper and a Harbour code change', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'List-price dollars at Lighthouse\'s own price table. Lighthouse: each study\'s research, review and driving session as its own records give them', { size: 11 });
  s += text(20, 60, '(driving-session figures marked incomplete there). Harbour: every session on the ticket, charged to the session entered, from local transcripts, September.', { size: 11 });
  s += text(20, 76, 'Harbour bars are medians with interquartile ranges. Research and code changes are not like for like.', { size: 11 });
  const step = xmax <= 50 ? 5 : xmax <= 100 ? 10 : 20;
  for (let v = 0; v <= xmax; v += step) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${B}" stroke="${C.grid}"/>` + text(x(v), B + 16, `$${v}`, { anchor: 'middle' });
  bars.forEach((b, i) => {
    const y0 = T + i * rh;
    s += text(L - 10, y0 + 12, b.k, { anchor: 'end', fill: C.ink, size: 11 }) + text(L - 10, y0 + 24, b.sub, { anchor: 'end', size: 9.5 });
    s += `<rect x="${L}" y="${y0 + 4}" width="${Math.max(1, x(b.v) - L)}" height="14" fill="${b.col}"/>`;
    if (b.lo != null) s += `<line x1="${x(b.lo)}" x2="${x(b.hi)}" y1="${y0 + 11}" y2="${y0 + 11}" stroke="${C.ink}"/><line x1="${x(b.lo)}" x2="${x(b.lo)}" y1="${y0 + 6}" y2="${y0 + 16}" stroke="${C.ink}"/><line x1="${x(b.hi)}" x2="${x(b.hi)}" y1="${y0 + 6}" y2="${y0 + 16}" stroke="${C.ink}"/>`;
    s += text(Math.max(x(b.v), b.hi ? x(b.hi) : 0) + 6, y0 + 15, `$${b.v.toFixed(0)}`, { fill: C.ink, size: 10.5 });
  });
  writeFileSync(join(dir, 'cost-per-piece.svg'), svg(W, B + 30, s));
}
console.log(`wrote ${dir}/concept-lever-matrix.svg and cost-per-piece.svg`);
