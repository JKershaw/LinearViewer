// LIN-3149: draw the reliability-baseline figures as hand-written SVG from survey-reliability.mjs's analysis, into docs/papers/harbour/figures/reliability-baseline/.
// Usage: node scripts/survey-reliability-figures.mjs [--out docs/papers/harbour/figures/reliability-baseline] (same cache/verdict flags as survey-reliability.mjs)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { load } from './survey-reliability-git.mjs';
import { analyse } from './survey-reliability.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const out = arg('--out', 'docs/papers/harbour/figures/reliability-baseline');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const depthPath = arg('--depth', 'data/survey/reliability-depth.json');
const a = analyse({ ...load(), depth: existsSync(depthPath) ? readJson(depthPath) : null, verdicts: readJson(arg('--verdicts', 'docs/papers/harbour/reliability-baseline-defects.json')) });

const C = { lv: '#0f766e', sd: '#d97706', ink: '#1f2328', dim: '#667085', grid: '#e5e7eb', bg: '#ffffff', mark: '#b42318' };
const MON = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug', '09': 'Sep' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 12}" fill="${o.fill || C.ink}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">\n<rect width="${w}" height="${h}" fill="${C.bg}"/>\n${body}\n</svg>\n`;
const niceMax = (v) => { const steps = [1, 2, 2.5, 5, 10]; const p = 10 ** Math.floor(Math.log10(v || 1)); return p * steps.find((s) => s * p >= v); };

// Grouped monthly bars for two repos, with the fleet-start marker between May and June.
function monthlyBars({ x0, y0, w, h, series, max, fmt, label, marker = true }) {
  const months = a.monthly.map((r) => r.month); const n = months.length; const band = w / n; const bw = band * 0.34;
  const y = (v) => y0 + h - (h * v) / max;
  let s = '';
  for (let t = 0; t <= 5; t++) { const v = (max * t) / 5; s += `<line x1="${x0}" x2="${x0 + w}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + txt(x0 - 6, y(v) + 4, fmt(v), { anchor: 'end', size: 11, fill: C.dim }); }
  months.forEach((m, i) => {
    const cx = x0 + band * i + band / 2;
    series.forEach((ser, j) => {
      const v = ser.values[i]; if (v == null) return;
      const bx = cx - bw + j * bw;
      s += `<rect x="${bx.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y0 + h - y(v)).toFixed(1)}" fill="${ser.color}"/>`;
      if (ser.inner?.[i]) s += `<rect x="${bx.toFixed(1)}" y="${y(ser.inner[i]).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y0 + h - y(ser.inner[i])).toFixed(1)}" fill="#ffffff" fill-opacity="0.55"/>`;
      if (ser.labels?.[i]) s += txt(bx + bw / 2 - 1, y(v) - 4, ser.labels[i], { anchor: 'middle', size: 10, fill: C.dim });
    });
    s += txt(cx, y0 + h + 16, MON[m.slice(5)], { anchor: 'middle', size: 12 });
  });
  if (marker) {
    const mx = x0 + band * 5;
    s += `<line x1="${mx}" x2="${mx}" y1="${y0 - 6}" y2="${y0 + h}" stroke="${C.mark}" stroke-dasharray="4 3"/>` + txt(mx + 5, y0 + 6, 'fleet starts 4 Jun', { size: 11, fill: C.mark });
  }
  if (label) s += txt(x0, y0 - 14, label, { size: 13, weight: 600 });
  return s;
}
const legend = (x, y, items) => items.map((it, i) => `<rect x="${x + i * 190}" y="${y - 9}" width="10" height="10" fill="${it.color}"/>` + txt(x + 14 + i * 190, y, it.label, { size: 12 })).join('');

mkdirSync(out, { recursive: true });

// 1. Headline: escaped defects per 100 merged PRs, by month filed and repo.
{
  const lv = a.monthly.map((r) => (r.LinearViewer.prs ? r.LinearViewer.per100 : null));
  const sd = a.monthly.map((r) => (r['simple-dispatcher'].prs ? r['simple-dispatcher'].per100 : null));
  const max = niceMax(Math.max(...lv, ...sd.filter((v) => v != null)));
  const body = txt(20, 26, 'Escaped defects per 100 merged PRs, by month the Bug was filed', { size: 15, weight: 600 })
    + txt(20, 44, 'Bug tickets reporting a fault in merged product behaviour, not filed from the shipping ticket\'s own gate. Label: escaped / merged PRs.', { size: 11, fill: C.dim })
    + legend(64, 70, [{ color: C.lv, label: 'LinearViewer (Harbour)' }, { color: C.sd, label: 'simple-dispatcher (runner)' }])
    + `<rect x="444" y="61" width="10" height="10" fill="${C.lv}"/><rect x="444" y="61" width="10" height="10" fill="#ffffff" fill-opacity="0.55"/>` + txt(458, 70, 'pale part: found by a later ticket\'s review', { size: 12 })
    + monthlyBars({ x0: 64, y0: 96, w: 640, h: 230, max, fmt: (v) => v.toFixed(v < 10 ? 1 : 0),
      series: [
        { color: C.lv, values: lv, inner: a.monthly.map((r) => r.LinearViewer.laterPer100), labels: a.monthly.map((r) => `${r.LinearViewer.escaped}/${r.LinearViewer.prs}`) },
        { color: C.sd, values: sd, inner: a.monthly.map((r) => r['simple-dispatcher'].laterPer100), labels: a.monthly.map((r) => (r['simple-dispatcher'].prs ? `${r['simple-dispatcher'].escaped}/${r['simple-dispatcher'].prs}` : '')) },
      ] })
    + txt(20, 370, 'Before June almost no PR names a ticket and the Bug label is sparse, so the left of the chart is a floor. Source: scripts/survey-reliability.mjs.', { size: 11, fill: C.dim });
  writeFileSync(join(out, 'escaped-per-100-prs.svg'), svg(730, 385, body, 'Escaped defects per 100 merged PRs by month and repo'));
}

// 2. The git-side series: red CI on main per 100 runs, and fix-follow-ups naming the PR's ticket per 100 production PRs.
{
  const g = a.git; const R = ['LinearViewer', 'simple-dispatcher'];
  const ci = R.map((r) => a.monthly.map((m) => (g[r][m.month].ciRuns ? (100 * g[r][m.month].ciRed) / g[r][m.month].ciRuns : null)));
  const fu = R.map((r) => a.monthly.map((m) => (g[r][m.month].prodPRs ? (100 * g[r][m.month].followUpNamed30) / g[r][m.month].prodPRs : null)));
  const body = txt(20, 26, 'Two git-side signals, by month and repo', { size: 15, weight: 600 })
    + legend(64, 50, [{ color: C.lv, label: 'LinearViewer (Harbour)' }, { color: C.sd, label: 'simple-dispatcher (runner)' }])
    + monthlyBars({ x0: 64, y0: 94, w: 640, h: 150, max: niceMax(Math.max(...ci.flat().filter((v) => v != null))), fmt: (v) => `${v.toFixed(0)}%`, label: 'Red CI on main: failed push runs per 100 (final attempt)',
      series: R.map((r, j) => ({ color: j ? C.sd : C.lv, values: ci[j], labels: a.monthly.map((m) => (g[r][m.month].ciRuns ? `${g[r][m.month].ciRed}` : '')) })) })
    + monthlyBars({ x0: 64, y0: 314, w: 640, h: 150, max: niceMax(Math.max(...fu.flat().filter((v) => v != null))), fmt: (v) => `${v.toFixed(0)}%`, label: 'Named fix-follow-ups: PRs whose files a later fix commit touched within 30 days, naming the PR\'s ticket, per 100',
      series: R.map((r, j) => ({ color: j ? C.sd : C.lv, values: fu[j], labels: a.monthly.map((m) => (g[r][m.month].prodPRs ? `${g[r][m.month].followUpNamed30}` : '')) })) })
    + txt(20, 504, 'simple-dispatcher CI starts 25 Jul (LIN-1580). Bar labels are counts. Source: scripts/survey-reliability-git.mjs.', { size: 11, fill: C.dim });
  writeFileSync(join(out, 'ci-and-follow-ups.svg'), svg(730, 520, body, 'Red CI on main and named fix-follow-ups by month and repo'));
}

// 3. Size and depth: attributed escapes per 100 shipped tickets, June–September.
{
  const bar = (x0, y0, w, h, rows, key, label, max) => {
    const band = w / rows.length; const y = (v) => y0 + h - (h * v) / max; let s = txt(x0, y0 - 14, label, { size: 13, weight: 600 });
    for (let t = 0; t <= 5; t++) { const v = (max * t) / 5; s += `<line x1="${x0}" x2="${x0 + w}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + txt(x0 - 6, y(v) + 4, v.toFixed(1), { anchor: 'end', size: 11, fill: C.dim }); }
    rows.forEach((r, i) => {
      const cx = x0 + band * i + band / 2; const v = r.per100 || 0;
      s += `<rect x="${cx - band * 0.3}" y="${y(v)}" width="${band * 0.6}" height="${y0 + h - y(v)}" fill="${C.lv}"/>`
        + txt(cx, y(v) - 4, `${r.withEscape} of ${r.tickets ?? `~${r.estTickets}`}`, { anchor: 'middle', size: 10, fill: C.dim })
        + txt(cx, y0 + h + 16, r[key], { anchor: 'middle', size: 12 });
    });
    return s;
  };
  const max = niceMax(Math.max(...a.bySize.map((r) => r.per100 || 0), ...a.byDepth.map((r) => r.per100 || 0)));
  const body = txt(20, 26, 'Tickets with an attributed escaped defect, per 100 shipped tickets (Jun–Sep, both repos)', { size: 15, weight: 600 })
    + bar(64, 70, 290, 200, a.bySize, 'size', 'By ticket size (lines across its PRs)', max)
    + bar(424, 70, 290, 200, a.byDepth.map((d) => ({ ...d, label: `${d.gates} gate${d.gates === 1 ? '' : 's'}` })), 'label', 'By process depth (gates seen in comments)', max)
    + txt(20, 318, `Depth denominators are estimated from a systematic 1-in-8 sample (${a.depthSample.n} tickets). Only escapes whose Bug names the shipping ticket are counted.`, { size: 11, fill: C.dim });
  writeFileSync(join(out, 'size-and-depth.svg'), svg(730, 332, body, 'Attributed escaped defects by ticket size and process depth'));
}
console.log(`wrote 3 figures to ${out}`);
