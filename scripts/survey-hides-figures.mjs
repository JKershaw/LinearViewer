// LIN-3188: draw what-hides-between-sessions.md's charts (each pattern by frequency, time to discovery and cost, marked by detector) from survey-hides-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-hides-figures.mjs [--in data/survey-hides/analysis.json] [--out docs/papers/harbour/figures/what-hides-between-sessions]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-hides/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/what-hides-between-sessions');
mkdirSync(outDir, { recursive: true });

// The palette survey-doubling-figures.mjs validated on the light surface.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', grey: '#cbd5e1', grey2: '#94a3b8', node: '#f3f4f6' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const fmtH = (h) => (h == null ? 'n/a' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)} h` : `${Math.round(h / 24)} d`);
const fmtM = (u) => (u >= 1e6 ? `${(u / 1e6).toFixed(u >= 1e7 ? 0 : 1)}M` : `${Math.round(u / 1e3)}k`);

// The detector verdict for a pattern: 'caught' (a simple rule over held data fires on the cases on record),
// 'partly' (it fires on some, or only with many false alarms), 'not' (no rule over held data sees it),
// and 'in-code' (a detector already runs in code today).
const MARK = {
  caught: { fill: C.aqua, stroke: C.aqua, label: 'a simple detector over held data catches it' },
  partly: { fill: '#ffffff', stroke: C.aqua, label: 'a detector catches part of it' },
  'in-code': { fill: C.blue, stroke: C.blue, label: 'already detected in code today' },
  cited: { fill: C.grey, stroke: C.grey2, label: 'measured by an earlier paper\'s script, not re-run' },
  not: { fill: '#ffffff', stroke: C.orange, label: 'no simple detector over held data' },
};

// ---- 1. Headline: each pattern, frequency (x, a month) against time to discovery (y), area by cost, marked by detector.
{
  const rows = A.patterns.filter((p) => p.perMonth > 0);
  const W = 940, H = 600, L = 90, R = 250, T = 70, B = 70;
  const lx = (v) => Math.log10(Math.max(v, 0.1));
  const xmin = -1, xmax = Math.ceil(lx(Math.max(...rows.map((r) => r.perMonth))) + 0.2);
  const hs = rows.map((r) => r.discoveryHours).filter((h) => h != null);
  const ymin = Math.floor(lx(Math.min(...hs, 0.1))), ymax = Math.ceil(lx(Math.max(...hs)) + 0.1);
  const X = (v) => L + ((lx(v) - xmin) / (xmax - xmin)) * (W - L - R);
  const Y = (h) => H - B - ((lx(h) - ymin) / (ymax - ymin)) * (H - T - B);
  const maxCost = Math.max(...rows.map((r) => r.costUnits || 0), 1);
  const rad = (u) => 6 + 34 * Math.sqrt((u || 0) / maxCost);
  let s = svgOpen(W, H, 'What hides between sessions: each cross-session failure pattern by how often it happened, how long it took to surface, and what it cost, marked by whether a detector catches it');
  s += text(24, 26, 'What hides between sessions: September rates, discovery times since June (both repos)', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, 'Each circle is a pattern. Across: occurrences a month. Up: median time from onset to discovery. Area: weighted tokens it cost in September.', { size: 11 });
  for (let e = xmin; e <= xmax; e++) { const v = 10 ** e; s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="${C.grid}"/>` + text(X(v), H - B + 16, v >= 1 ? String(v) : String(v), { size: 10, anchor: 'middle' }); }
  for (let e = ymin; e <= ymax; e++) { const v = 10 ** e; s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/>` + text(L - 8, Y(v) + 4, fmtH(v), { size: 10, anchor: 'end' }); }
  s += text((L + W - R) / 2, H - B + 36, 'occurrences a month (log)', { size: 11, anchor: 'middle', fill: C.ink });
  s += `<text x="24" y="${(T + H - B) / 2}" font-size="11" fill="${C.ink}" text-anchor="middle" transform="rotate(-90 24 ${(T + H - B) / 2})">median time to discovery (log)</text>`;
  const placed = [];
  for (const r of [...rows].sort((a, b) => (b.costUnits || 0) - (a.costUnits || 0))) {
    if (r.discoveryHours == null) continue;
    const cx = X(r.perMonth), cy = Y(r.discoveryHours), rr = rad(r.costUnits); const m = MARK[r.detector] || MARK.not;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" fill="${m.fill}" fill-opacity="${m.fill === '#ffffff' ? 0.9 : 0.55}" stroke="${m.stroke}" stroke-width="2"/>`;
    // The label sits right of its circle, or left if that box is taken, then steps down until it is clear.
    const w = r.short.length * 6.4; let anchor = 'start'; let tx = cx + rr + 5; let ty = cy + 4;
    const clash = (x0, y) => placed.some((b) => x0 < b[0] + b[2] && x0 + w > b[0] && Math.abs(b[1] - y) < 13);
    if (clash(tx, ty) || tx + w > W - R) { anchor = 'end'; tx = cx - rr - 5; }
    let x0 = anchor === 'start' ? tx : tx - w; while (clash(x0, ty)) ty += 13;
    placed.push([x0, ty, w]);
    s += text(tx, ty, `${r.short}`, { size: 11, fill: C.ink, weight: 600, anchor });
  }
  // The side list: each pattern's numbers, so the chart reads without the paper.
  let py = T + 4; const px = W - R + 24;
  s += text(px, py, 'Pattern · a month · to discovery · cost', { size: 11, fill: C.ink, weight: 600 }); py += 20;
  for (const r of rows) {
    const m = MARK[r.detector] || MARK.not;
    s += `<circle cx="${px + 5}" cy="${py - 4}" r="5" fill="${m.fill}" stroke="${m.stroke}" stroke-width="2"/>`;
    s += text(px + 16, py, r.short, { size: 11, fill: C.ink, weight: 600 });
    s += text(px + 16, py + 14, `${r.perMonth < 10 ? r.perMonth.toFixed(1) : Math.round(r.perMonth)} · ${fmtH(r.discoveryHours)} · ${r.costUnits ? fmtM(r.costUnits) : 'n/a'}${r.idleHours ? ` · ${Math.round(r.idleHours)} h idle` : ''}`, { size: 10 });
    py += 34;
  }
  let gy = H - 22; let gx = 24;
  for (const k of ['caught', 'partly', 'in-code', 'cited']) { const m = MARK[k]; s += `<circle cx="${gx + 6}" cy="${gy - 4}" r="6" fill="${m.fill}" stroke="${m.stroke}" stroke-width="2"/>` + text(gx + 16, gy, m.label, { size: 10.5 }); gx += m.label.length * 5.4 + 36; }
  s += '</svg>';
  writeFileSync(join(outDir, 'patterns.svg'), s);
}

// ---- 2. Detectors against the record: for each detector, hits on incidents on record, misses, and alarms with no incident on record.
{
  const D = A.detectors;
  const W = 940, L = 270, R = 130, T = 70, rowH = 34, H = T + D.length * rowH + 60;
  const SHORT = { D1: 'shared error burst', D1f: 'error lines in feedback', D2: 'stopped or circular wait', D5: 'lost wake (parked parent)', D5x: 'lost [done] POST', D7: 'duplicate launch' };
  const max = Math.max(...D.map((d) => (d.hits || 0) + (d.misses || 0) + (d.unrecorded || 0) + (d.falseAlarms || 0)), 1);
  const x = (v) => L + (v / max) * (W - L - R);
  const parts = [['hit on record', C.aqua, 'hits'], ['missed', C.orange, 'misses'], ['real, never recorded', C.blue, 'unrecorded'], ['false alarm', C.grey2, 'falseAlarms']];
  let s = svgOpen(W, H, 'Each detector run over the history: incidents on record it caught and missed, real cases nobody recorded, and false alarms');
  s += text(24, 26, 'Detectors run over the history', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, 'Per detector: incidents on record it fired on and missed, alarms that were real but never recorded, and false alarms (alarms read by hand where sampled).', { size: 11 });
  D.forEach((d, i) => {
    const y = T + i * rowH; let cx = x(0);
    s += text(L - 10, y + 13, `${d.id} ${SHORT[d.id] || d.label} (${d.repo})`, { size: 11.5, fill: C.ink, anchor: 'end' });
    for (const [, col, k] of parts) { const w = x(d[k] || 0) - x(0); if (w > 0.3) s += `<rect x="${cx.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="20" fill="${col}"/>`; cx += w; }
    s += text(cx + 6, y + 14, parts.map(([, , k]) => d[k] ?? '–').join(' / '), { size: 10.5, fill: C.ink });
  });
  const ly = H - 24; let lx = L;
  for (const [label, col] of parts) { s += `<rect x="${lx}" y="${ly - 9}" width="12" height="12" fill="${col}"/>` + text(lx + 17, ly + 1, label, { size: 11 }); lx += label.length * 6 + 46; }
  s += '</svg>';
  writeFileSync(join(outDir, 'detectors.svg'), s);
}
console.log('wrote', outDir);
