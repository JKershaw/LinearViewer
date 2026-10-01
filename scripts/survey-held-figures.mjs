// LIN-3176: draw held-or-fresh.md's three SVG charts (tokens per wake against accumulated context, by role; modelled cost per correct change today against the relay and its variants; sensitivity to handoff size) from survey-held-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-held-figures.mjs [--in data/survey-held/analysis.json] [--out docs/papers/harbour/figures/held-or-fresh]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-held/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/held-or-fresh');
mkdirSync(outDir, { recursive: true });

// The palette survey-doubling-figures.mjs validated on the light surface.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', grey: '#cbd5e1', grey2: '#94a3b8' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const line = (x1, y1, x2, y2, o = {}) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${o.stroke || C.grid}" stroke-width="${o.w || 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const LAYERS = ['Runner', 'leg', 'stepper', 'autopilot'];
const NAME = { Runner: 'Passage Runner', leg: 'Passage leg', stepper: 'Stepper', autopilot: 'Ticket autopilot' };

// ---- 1. Headline: units per wake against the context the session carried into it, one panel per role.
{
  const W = 980, H = 600, pw = 420, ph = 200, X0 = 70, Y0 = 92, gx = 480, gy = 262;
  const XM = 1e6, YM = 600e3;
  let s = svgOpen(W, H, 'Weighted tokens per wake against the context the held supervisor had accumulated, by role, September');
  s += text(24, 26, 'A held supervisor pays for its whole history on every wake (September, both repos)', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, 'Each dot is one wake into a held session: the context it carried in (x) and the weighted tokens it cost (y), gates and handshake included.', { size: 11 });
  s += text(24, 60, 'Blue: the wake acted (wrote, pushed, edited or dispatched). Orange: it changed nothing. The line is the median in each context band; wakes over 600k sit on the top edge.', { size: 11 });
  LAYERS.forEach((L, i) => {
    const ox = X0 + (i % 2) * gx, oy = Y0 + Math.floor(i / 2) * gy; const P = A.part1[L];
    const sx = (x) => ox + (Math.min(x, XM) / XM) * pw, sy = (y) => oy + ph - (Math.min(y, YM) / YM) * ph;
    for (let k = 0; k <= 5; k++) { const y = (k * YM) / 5; s += line(ox, sy(y), ox + pw, sy(y)); s += text(ox - 6, sy(y) + 4, `${y / 1e3}k`, { size: 10, anchor: 'end' }); }
    for (let k = 0; k <= 5; k++) { const x = (k * XM) / 5; s += text(sx(x), oy + ph + 14, `${x / 1e3}k`, { size: 10, anchor: 'middle' }); }
    s += line(ox, oy + ph, ox + pw, oy + ph, { stroke: C.grey2 });
    const pts = A.scatter.filter((p) => p[0] === i);
    // One path per colour, a zero-length round-capped segment per wake: a dot without a circle element each.
    for (const [a, col] of [[0, C.orange], [1, C.blue]]) s += `<path d="${pts.filter((p) => p[3] === a).map((p) => `M${sx(p[1]).toFixed(0)} ${sy(p[2]).toFixed(0)}h0`).join('')}" stroke="${col}" stroke-opacity="0.3" stroke-width="3.2" stroke-linecap="round" fill="none"/>`;
    const mids = P.bins.map((b) => { const [lo, hi] = b.ctxK.split('-').map((v) => +v * 1e3); return [(lo + Math.min(hi, XM)) / 2, b.medianUnits]; });
    s += `<polyline points="${mids.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.ink}" stroke-width="2"/>`;
    for (const [x, y] of mids) s += `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="3" fill="${C.ink}"/>`;
    s += text(ox, oy - 10, `${NAME[L]}: ${P.episodes.toLocaleString('en-GB')} wakes in ${P.sessions} sessions`, { size: 12, fill: C.ink, weight: 600 });
    s += text(ox + 8, oy + 14, `one step ≈ ${(P.fit.perStepIntercept / 1e3).toFixed(1)}k + ${P.fit.perStepSlope.toFixed(2)} × context`, { size: 10.5, fill: C.ink });
  });
  s += text(X0 + (gx + pw) / 2, H - 10, 'context carried into the wake (tokens)', { size: 11, anchor: 'middle' });
  s += `<text x="16" y="${Y0 + ph + 25}" font-size="11" fill="${C.muted}" transform="rotate(-90 16 ${Y0 + ph + 25})" text-anchor="middle">weighted tokens per wake</text>`;
  writeFileSync(join(outDir, 'cost-per-wake.svg'), s + '</svg>\n');
}

// ---- 2. Headline: modelled weighted tokens per correct change, today and under each shape, with the scenario range.
{
  const base = 13.3; // mean of September's four weekly figures, 11.4, 14.4, 11.4 and 16.0M (measuring-throughput.md)
  const S = A.part3.scenarios;
  const rows = [
    ['Today (held supervisors)', 0, 0, 0, C.grey2, 'September, as measured'],
    ['Relay as proposed', S.central.fleetChange, S.cheap.fleetChange, S.dear.fleetChange, C.orange, "quiet wakes to code; each acted wake a fresh session that orients as fresh starts do today"],
    ['Lean relay', S.leanCentral.fleetChange, S.leanCheap.fleetChange, S.leanDear.fleetChange, C.blue, 'as above, but the fresh session reads only a handoff (10–60k tokens) instead of orienting'],
    ['Quiet wakes to code, acted wakes stay held', S.hybrid.fleetChange, S.hybridCheap.fleetChange, S.hybridDear.fleetChange, C.aqua, 'no fresh sessions; the cache may expire between acted wakes'],
    ['Relay for Runner and autopilot only', S.split.fleetChange, S.split.fleetChange, S.split.fleetChange, C.grey2, 'legs and steppers held, quiet wakes to code'],
  ];
  const W = 1000, rowH = 62, X0 = 290, pw = 450, Y0 = 92, H = Y0 + rows.length * rowH + 40, XM = 18;
  const sx = (v) => X0 + (v / XM) * pw;
  let s = svgOpen(W, H, 'Modelled weighted tokens per correct change in September: today against the relay and its variants, with each range');
  s += text(24, 26, 'What September would have cost per correct change under each shape', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, 'Millions of weighted tokens per correct, complete change. Today is the mean of September’s four weeks (11.4–16.0M, measuring-throughput.md); each shape', { size: 11 });
  s += text(24, 60, 'scales it by its modelled change in the fleet’s tokens. The bar is the central case; the whisker runs from the cheap to the dear scenario.', { size: 11 });
  for (let v = 0; v <= XM; v += 3) { s += line(sx(v), Y0 - 8, sx(v), H - 34); s += text(sx(v), H - 18, `${v}M`, { size: 10, anchor: 'middle' }); }
  rows.forEach(([label, c, lo, hi, col, note], i) => {
    const y = Y0 + i * rowH; const v = base * (1 + c / 100), a = base * (1 + Math.min(lo, hi) / 100), b = base * (1 + Math.max(lo, hi) / 100);
    s += text(X0 - 12, y + 16, label, { size: 12, fill: C.ink, anchor: 'end', weight: 600 });
    s += `<rect x="${X0}" y="${y + 4}" width="${(sx(v) - X0).toFixed(1)}" height="18" fill="${col}" fill-opacity="0.85"/>`;
    if (b - a > 0.05) { s += line(sx(a), y + 13, sx(b), y + 13, { stroke: C.ink, w: 1.5 }); s += line(sx(a), y + 7, sx(a), y + 19, { stroke: C.ink, w: 1.5 }); s += line(sx(b), y + 7, sx(b), y + 19, { stroke: C.ink, w: 1.5 }); }
    const lab = i === 0 ? `${v.toFixed(1)}M` : `${v.toFixed(1)}M (${c > 0 ? '+' : ''}${c}%${b - a > 0.05 ? `; ${a.toFixed(1)}–${b.toFixed(1)}M` : ''})`;
    s += text(Math.max(sx(v), sx(b)) + 8, y + 17, lab, { size: 11, fill: C.ink });
    s += text(X0, y + 38, note, { size: 10.5 });
  });
  writeFileSync(join(outDir, 'cost-per-change.svg'), s + '</svg>\n');
}

// ---- 3. Sensitivity: the fleet's change in tokens against the handoff a fresh step must read.
{
  const S = A.part3.handoffSensitivity; const hyb = A.part3.scenarios.hybrid.fleetChange;
  const W = 940, H = 400, X0 = 80, Y0 = 80, pw = 780, ph = 280, XM = 200, YLO = -30, YHI = 50;
  const sx = (h) => X0 + (h / XM) * pw, sy = (v) => Y0 + ph - ((v - YLO) / (YHI - YLO)) * ph;
  let s = svgOpen(W, H, 'How the relay’s saving depends on the size of the handoff each fresh judgement step must read');
  s += text(24, 26, 'The relay pays only if the handoff stays small', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, 'Change in the fleet’s September weighted tokens against the handoff each fresh judgement step reads (thousand tokens). Below zero is a saving.', { size: 11 });
  s += text(24, 60, 'Orange: the fresh step also orients as fresh supervisors do today. Blue: it reads only the handoff. Green: quiet wakes to code, acted wakes stay held.', { size: 11 });
  for (let v = YLO; v <= YHI; v += 10) { s += line(X0, sy(v), X0 + pw, sy(v), v === 0 ? { stroke: C.ink } : {}); s += text(X0 - 8, sy(v) + 4, `${v > 0 ? '+' : ''}${v}%`, { size: 10, anchor: 'end' }); }
  for (const h of [0, 20, 50, 100, 150, 200]) s += text(sx(h), Y0 + ph + 16, `${h}k`, { size: 10, anchor: 'middle' });
  const pl = (k, col) => `<polyline points="${S.map((p) => `${sx(p.handoffK).toFixed(1)},${sy(p[k]).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2.2"/>` + S.map((p) => `<circle cx="${sx(p.handoffK).toFixed(1)}" cy="${sy(p[k]).toFixed(1)}" r="3" fill="${col}"/>`).join('');
  s += line(X0, sy(hyb), X0 + pw, sy(hyb), { stroke: C.aqua, w: 2, dash: '6 4' });
  s += pl('freshFleetChange', C.orange) + pl('leanFleetChange', C.blue);
  s += text(X0 + pw - 4, sy(hyb) + 16, `quiet wakes to code, acted held: ${hyb}%`, { size: 11, fill: C.ink, anchor: 'end' });
  const be = A.part3.breakEvenHandoffK;
  s += text(sx(Math.min(be.fresh, 190)) + 6, sy(0) - 8, `break-even ${be.fresh}k`, { size: 11, fill: C.orange });
  s += text(sx(Math.min(be.lean, 190)) + 6, sy(0) + 16, `break-even ${be.lean}k`, { size: 11, fill: C.blue });
  writeFileSync(join(outDir, 'handoff-sensitivity.svg'), s + '</svg>\n');
}
console.log('wrote', ['cost-per-wake.svg', 'cost-per-change.svg', 'handoff-sensitivity.svg'].map((f) => join(outDir, f)).join(', '));
