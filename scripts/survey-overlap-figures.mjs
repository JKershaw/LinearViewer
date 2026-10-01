// LIN-3179: draw step-overlap.md's SVG charts (the overlap matrices, and the read multiplier over time) from survey-overlap-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-overlap-figures.mjs [--in data/survey-overlap/analysis.json] [--out docs/papers/harbour/figures/step-overlap]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-overlap/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/step-overlap');
mkdirSync(outDir, { recursive: true });

// The survey's palette (survey-doubling-figures.mjs): categorical slots in fixed order, then greys; every chart carries a legend.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', grey: '#cbd5e1', grey2: '#94a3b8' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const rect = (x, y, w, h, fill, tip) => (h <= 0.2 || w <= 0.2 ? '' : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"><title>${esc(tip)}</title></rect>`);
const legend = (x, y, entries, colW) => entries.map(([label, fill], i) => `<rect x="${x + i * colW}" y="${y - 9}" width="10" height="10" rx="2" fill="${fill}"/>` + text(x + i * colW + 14, y, label, { size: 10 })).join('');
// Sequential single hue: white to the survey blue, by share 0–1 (capped at 0.6 so the low cells stay readable).
const shade = (v) => { const t = Math.min(1, v / 0.6); const mix = (a, b) => Math.round(a + (b - a) * t); return `rgb(${mix(241, 42)},${mix(245, 120)},${mix(249, 214)})`; };
const pct = (v) => (v == null ? '' : `${Math.round(v * 100)}%`);

// ---- 1. Headline: the overlap matrices. Rows are the later step; columns the earlier one; the last column pools every earlier step.
{
  const LATER = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'];
  const EARLIER = ['description', 'research', 'plan', 'plan-review', 'implementation', 'review'];
  const SHORT = { description: 'descr.', research: 'research', plan: 'plan', 'plan-review': 'plan rev.', implementation: 'impl.', review: 'review', 'close-out': 'close-out', prior: 'any earlier' };
  const W = 1040, H = 420, cw = 52, ch = 30;
  let s = svgOpen(W, H, 'How much of each step restates an earlier step, in text and in the files it reads');
  s += text(20, 24, 'How much of each step is already in an earlier step: in what it writes, and in what it reads', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, `Four-step census: ${A.census.n} tickets with research, plan, plan-review and implementation sessions on disk (29 Aug–30 Sep). Median per ticket; hover for n and quartiles.`, { size: 10 });
  const panel = (x0, title, sub, get) => {
    let o = text(x0, 72, title, { size: 12, fill: C.ink, weight: 600 }) + text(x0, 87, sub, { size: 10 });
    const cols = [...EARLIER, 'prior'];
    cols.forEach((c, j) => { o += text(x0 + 92 + j * cw + cw / 2, 112, SHORT[c], { size: 10, anchor: 'middle', fill: c === 'prior' ? C.ink : C.muted, weight: c === 'prior' ? 600 : null }); });
    LATER.forEach((r, i) => {
      const Y = 120 + i * ch; o += text(x0 + 86, Y + 19, SHORT[r], { size: 11, anchor: 'end', fill: C.ink });
      cols.forEach((c, j) => {
        const X = x0 + 92 + j * cw; const v = get(c, r);
        if (!v) { o += `<rect x="${X + 1}" y="${Y + 1}" width="${cw - 2}" height="${ch - 2}" fill="${C.surface}" stroke="${C.grid}"/>`; return; }
        o += rect(X + 1, Y + 1, cw - 2, ch - 2, shade(v.mid), `${SHORT[r]} after ${SHORT[c]}: median ${pct(v.mid)} (quartiles ${pct(v.lo)}–${pct(v.hi)}), n=${v.n}`);
        o += text(X + cw / 2, Y + 19, pct(v.mid), { size: 10, anchor: 'middle', fill: v.mid > 0.33 ? '#ffffff' : C.ink });
      });
    });
    return o;
  };
  s += panel(10, 'Text: share of the later step\'s code references the earlier step named', 'Files, path:line anchors, backticked identifiers. Verbatim restatement is near zero.',
    (c, r) => { const m = A.census.matrix[`${c}>${r}`]; return m && { mid: m.refs[1], lo: m.refs[0], hi: m.refs[2], n: m.n }; });
  s += panel(520, 'Work: share of the later session\'s file reads on files an earlier step read', 'Bytes read (Read, cat, sed, head, tail) on paths an earlier session of that step had read.',
    (c, r) => { const m = A.work.byPair[`${c}>${r}`]; return m && { mid: m.share[1], lo: m.share[0], hi: m.share[2], n: m.n }; });
  s += legend(102, 330, [['0%', shade(0)], ['15%', shade(0.15)], ['30%', shade(0.3)], ['45%', shade(0.45)], ['60%+', shade(0.6)]], 70);
  s += text(20, 362, 'Rows are the later step; columns the earlier step; "any earlier" pools every step before it. A blank cell has no ticket with both texts (30+ words each), or both sessions.', { size: 10 });
  s += text(20, 378, 'Text is each step\'s comments and description sections, by posting session (transcripts) or heading. The work diagonal is a repeat round of the same step.', { size: 10 });
  s += text(20, 394, 'Both repos; scripts/survey-overlap-analyse.mjs.', { size: 10 });
  s += '</svg>';
  writeFileSync(join(outDir, 'overlap-matrix.svg'), s);
}

// ---- 2. The read multiplier over time: words written per ticket, and how many later sessions each word could reach (and did).
{
  const bins = Object.entries(A.trend).filter(([b, t]) => b !== 'census' && t.tickets >= 3);
  // Weeks with 30+ comments, and not the last (its comments have had only days for later sessions to read them).
  const weekly = Object.entries(A.readMultiplier.weekly).filter(([d, g]) => g.comments >= 30 && d >= '2026-08-31' && d < '2026-09-28');
  const W = 960, H = 540;
  let s = svgOpen(W, H, 'Words written per ticket, and the read multiplier, by half-month since June');
  s += text(20, 24, 'The read multiplier over time: what each ticket writes, and how many later sessions each word reaches', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, 'Trend sample: Done tickets by the half-month of their first session (runner log, from 20 June), every k-th by number. Both repos.', { size: 10 });
  const STEPCOL = [['description', C.grey2], ['research', C.aqua], ['plan', C.blue], ['plan-review', C.yellow], ['implementation', C.grey], ['review', C.orange], ['close-out', '#7c3aed'], ['orchestrator', '#475569']];
  const x0 = 70, pw = W - 120, bw = pw / bins.length;
  // Top: words per ticket by step.
  const maxW = Math.max(...bins.map(([, t]) => Object.values(t.byStepPerTicket).reduce((a, b) => a + b, 0))) * 1.1;
  const yW = (v) => 70 + 160 - (v / maxW) * 160;
  for (let t = 0; t <= maxW; t += 2000) { s += `<line x1="${x0}" x2="${x0 + pw}" y1="${yW(t)}" y2="${yW(t)}" stroke="${C.grid}"/>` + text(x0 - 6, yW(t) + 4, t.toLocaleString('en-GB'), { anchor: 'end', size: 10 }); }
  s += text(x0, 62, 'Words written per ticket (description and comments), by the step that wrote them', { size: 11, fill: C.ink, weight: 600 });
  bins.forEach(([b, t], i) => {
    let acc = 0; const X = x0 + i * bw + 8;
    for (const [k, fill] of STEPCOL) { const v = t.byStepPerTicket[k] || 0; if (!v) continue; s += rect(X, yW(acc + v), bw - 16, yW(acc) - yW(acc + v), fill, `${b}: ${k} ${v} words per ticket (${t.tickets} tickets)`); acc += v; }
    s += text(X + (bw - 16) / 2, yW(acc) - 4, `${t.wordsPerTicket.toLocaleString('en-GB')}`, { size: 10, anchor: 'middle', fill: C.ink });
  });
  s += legend(x0, 252, STEPCOL.slice(0, 4), 120) + legend(x0, 268, STEPCOL.slice(4), 120);
  // Bottom: multipliers.
  // Per-dispatch counts (both charging rules) are in the paper's table; on this sample they swamp the scale and agree with each other.
  const series = [['later fresh sessions on the ticket (could load it)', C.blue, (t) => t.potentialFresh]];
  const maxM = Math.max(...bins.flatMap(([, t]) => series.map(([, , f]) => f(t) || 0)), ...weekly.map(([, g]) => g.potential)) * 1.15;
  const yM = (v) => 300 + 160 - (v / maxM) * 160;
  s += text(x0, 290, 'Read multiplier: later sessions per word, word-weighted', { size: 11, fill: C.ink, weight: 600 });
  const step = maxM > 20 ? 5 : maxM > 8 ? 2 : 1;
  for (let t = 0; t <= maxM; t += step) s += `<line x1="${x0}" x2="${x0 + pw}" y1="${yM(t)}" y2="${yM(t)}" stroke="${C.grid}"/>` + text(x0 - 6, yM(t) + 4, String(t), { anchor: 'end', size: 10 });
  for (const [label, col, f] of series) {
    const pts = bins.map(([, t], i) => [x0 + i * bw + bw / 2, yM(f(t) || 0), f(t)]);
    s += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`;
    s += pts.map(([x, y, v], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${col}"><title>${esc(`${bins[i][0]}: ${label} ×${v}`)}</title></circle>`).join('');
  }
  // Measured (transcripts): weekly, placed on the half-month axis by date.
  const binStart = (b) => new Date(`${b.slice(0, 7)}-${b.endsWith('a') ? '01' : '16'}T00:00:00Z`).getTime();
  const t0 = binStart(bins[0][0]); const t1 = binStart(bins.at(-1)[0]) + 15 * 864e5;
  const xOf = (d) => x0 + ((new Date(`${d}T00:00:00Z`).getTime() + 3.5 * 864e5 - t0) / (t1 - t0)) * pw;
  s += weekly.map(([d, g]) => `<rect x="${(xOf(d) - 4).toFixed(1)}" y="${(yM(g.potential) - 4).toFixed(1)}" width="8" height="8" fill="none" stroke="${C.blue}"><title>${esc(`week of ${d}: later fresh sessions on the ticket ×${g.potential} (transcripts)`)}</title></rect>`).join('');
  s += weekly.map(([d, g]) => `<rect x="${(xOf(d) - 4).toFixed(1)}" y="${(yM(g.multiplier) - 4).toFixed(1)}" width="8" height="8" fill="${C.orange}"><title>${esc(`week of ${d}: measured ×${g.multiplier} over ${g.comments} comments (could load: ×${g.potential})`)}</title></rect>`).join('');
  bins.forEach(([b], i) => { s += text(x0 + i * bw + bw / 2, 478, `${b.slice(5, 7) === '06' ? 'Jun' : b.slice(5, 7) === '07' ? 'Jul' : b.slice(5, 7) === '08' ? 'Aug' : 'Sep'} ${b.endsWith('a') ? '1–15' : '16–'}`, { size: 10, anchor: 'middle', fill: C.ink }); });
  s += legend(x0, 500, [...series.map(([l, c]) => [l, c]), ['measured: sessions that received any of it (transcripts, by week written)', C.orange]], 330);
  s += text(x0, 524, 'Hollow squares: the same "could load" count from September\'s transcripts, by week written. Last week of September left out (its text has had days to be read).', { size: 10 });
  s += '</svg>';
  writeFileSync(join(outDir, 'read-multiplier.svg'), s);
}
console.log(`wrote ${outDir}/overlap-matrix.svg, read-multiplier.svg`);
