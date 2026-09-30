// LIN-3172: draw wake-inventory.md's two SVG charts (who wakes whom; what each delivery path led to) from survey-wake-analyse.mjs's snapshot; hand-written SVG, no dependencies.
// Usage: node scripts/survey-wake-figures.mjs [--in data/survey-wake/analysis.json] [--out docs/papers/harbour/figures/wake-inventory]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-wake/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/wake-inventory');
mkdirSync(outDir, { recursive: true });

// The palette survey-doubling-figures.mjs validated on the light surface.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', grey: '#cbd5e1', grey2: '#94a3b8', node: '#f3f4f6' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const fmt = (n) => n.toLocaleString('en-GB');

// ---- 1. Headline: who wakes whom. Each edge runs from the child that produced the wake to the layer it woke; width is September's
// count, colour is whether most of those wakes changed nothing, and the label gives count · per correct code change · share quiet.
{
  const W = 940, H = 640;
  const N = { worker: [300, 580, 'Worker session', 'fresh leg or beat'], stepper: [300, 400, 'Stepper', 'autopilot, one beat at a time'], autopilot: [110, 215, 'Ticket autopilot', "the ticket's own"], leg: [490, 215, 'Passage leg', 'autopilot a Runner dispatched'], Runner: [490, 80, 'Passage Runner', 'flies the passage'] };
  const E = A.edges; const max = Math.max(...Object.values(E).map((e) => e.n));
  let s = svgOpen(W, H, 'Who wakes whom in September: every Harbour wake edge between session layers, with its count, wakes per correct change and the share that changed nothing');
  s += text(24, 26, 'Who wakes whom, September (both repos)', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, 'An arrow runs from the child whose feedback minted the wake to the session it woke. Label: wakes in the month · per correct code change · share that changed nothing.', { size: 11 });
  s += `<defs>${['blue', 'orange'].map((c) => `<marker id="ah-${c}" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${C[c]}"/></marker>`).join('')}</defs>`;
  const edge = (from, to, key, ox, oy, curve = 0) => {
    const e = E[key]; if (!e) return '';
    const [x1, y1] = N[from]; const [x2, y2] = N[to]; const col = e.quietPct >= 50 ? 'orange' : 'blue';
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); const ux = dx / len, uy = dy / len;
    const sx = x1 + ux * 34, sy = y1 + uy * 34, ex = x2 - ux * 40, ey = y2 - uy * 40;
    const mx = (sx + ex) / 2 - uy * curve, my = (sy + ey) / 2 + ux * curve;
    const w = 1.5 + (10 * e.n) / max;
    let o = `<path d="M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${C[col]}" stroke-width="${w.toFixed(1)}" stroke-opacity="0.85" marker-end="url(#ah-${col})"/>`;
    const label = `${fmt(e.n)} · ${e.per.code.toFixed(1)} · ${e.quietPct}%`;
    // The label sits at the curve's midpoint, nudged by (ox, oy).
    const lx = 0.25 * sx + 0.5 * mx + 0.25 * ex + ox, ly = 0.25 * sy + 0.5 * my + 0.25 * ey + oy;
    o += `<rect x="${(lx - 4).toFixed(1)}" y="${(ly - 12).toFixed(1)}" width="${(label.length * 6.1 + 8).toFixed(1)}" height="17" rx="3" fill="${C.surface}" fill-opacity="0.92"/>` + text(lx, ly + 1, label, { size: 11, fill: C.ink, weight: 600 });
    return o;
  };
  s += edge('worker', 'stepper', 'worker→stepper', 10, 4);
  s += edge('worker', 'autopilot', 'worker→autopilot', -118, 0, -60);
  s += edge('worker', 'leg', 'worker→leg', 12, 44, 60);
  s += edge('stepper', 'autopilot', 'stepper→autopilot', -20, -4, 10);
  s += edge('stepper', 'leg', 'stepper→leg', -86, -4, -10);
  s += edge('leg', 'Runner', 'leg→Runner', 10, 4);
  s += text(N.leg[0] + 10, 0.5 * (N.leg[1] + N.Runner[1]) + 22, 'few of them on a code change', { size: 10 });
  // A stepper under a stepper (nested steppers): a loop on the stepper node.
  const ss = E['stepper→stepper'];
  if (ss) { const [x, y] = N.stepper; const col = ss.quietPct >= 50 ? 'orange' : 'blue'; s += `<path d="M${x + 60},${y - 12} C${x + 150},${y - 60} ${x + 150},${y + 50} ${x + 62},${y + 14}" fill="none" stroke="${C[col]}" stroke-width="${(1.5 + (10 * ss.n) / max).toFixed(1)}" stroke-opacity="0.85" marker-end="url(#ah-${col})"/>` + text(x + 140, y + 4, `${fmt(ss.n)} · ${ss.per.code.toFixed(1)} · ${ss.quietPct}%`, { size: 11, fill: C.ink, weight: 600 }) + text(x + 140, y + 18, 'stepper under a stepper', { size: 10 }); }
  for (const [k, [x, y, name, sub]] of Object.entries(N)) {
    s += `<rect x="${x - 78}" y="${y - 26}" width="156" height="52" rx="8" fill="${C.node}" stroke="${C.grey2}"/>` + text(x, y - 3, name, { size: 12.5, fill: C.ink, weight: 600, anchor: 'middle' }) + text(x, y + 13, sub, { size: 10, anchor: 'middle' });
  }
  // The runner's own turns and the other paths into the same sessions, which are not Harbour wakes.
  const px = 690; let py = 80; const src = A.sources; const g = A.gates;
  s += `<rect x="${px - 14}" y="${py - 20}" width="${W - px - 10}" height="282" rx="8" fill="none" stroke="${C.grid}"/>`;
  s += text(px, py, 'Also into the same sessions', { size: 12.5, fill: C.ink, weight: 600 }); py += 22;
  const lines = [
    [`${fmt(g.n)} completion gates`, `runner (SD); ${Math.round((100 * g.replies['PENDING-EXTERNAL']) / g.n)}% answered PENDING-EXTERNAL`],
    [`${fmt((src['failsafe-reconfirm']?.n || 0))} stall-failsafe re-fires`, 'runner (SD); resumed to re-ask'],
    [`${fmt(A.selfWakes.taskNotifications + A.selfWakes.scheduled)} self-armed wake-ups`, `harness; ${fmt(A.selfWakes.ciOrPr)} of them CI or PR polls`],
    [`${fmt(src.beat?.n || 0)} beats into held workers`, 'a stepper, via Harbour'],
    [`${fmt(src.relay?.n || 0)} relayed rulings and notes`, 'a person or a supervisor, via Harbour'],
    [`${fmt(A.edgeLinks.none)} wakes whose child is not linked`, 'left off the diagram'],
  ];
  for (const [a, b] of lines) { s += text(px, py, a, { size: 11.5, fill: C.ink, weight: 600 }) + text(px, py + 14, b, { size: 10 }); py += 40; }
  // Legend.
  const ly = H - 28;
  s += `<line x1="24" x2="52" y1="${ly}" y2="${ly}" stroke="${C.blue}" stroke-width="4"/>` + text(58, ly + 4, 'most wakes led to an action', { size: 11 });
  s += `<line x1="240" x2="268" y1="${ly}" y2="${ly}" stroke="${C.orange}" stroke-width="4"/>` + text(274, ly + 4, 'most wakes changed nothing', { size: 11 });
  s += text(470, ly + 4, `Width: wakes in September. Per correct change: ${A.cohort.code.correct} correct code changes, 1–28 Sep.`, { size: 11 });
  s += '</svg>';
  writeFileSync(join(outDir, 'who-wakes-whom.svg'), s);
}

// ---- 2. What each delivery path led to, per correct code change, split by the woken session's most consequential act.
{
  const rows = [
    ['Terminal wake (Harbour)', ['wake-terminal']],
    ['Pause wake (Harbour)', ['wake-pause']],
    ['Beat into a held worker', ['beat', 'follow-up']],
    ['Self-armed wake-up (harness)', ['task-notification', 'scheduled']],
    ['Relayed ruling or note', ['relay']],
    ['Stall-failsafe re-fire (runner)', ['failsafe-reconfirm', 'silence-refire']],
  ];
  const parts = [['changed nothing (read, re-arm)', C.orange, ['none', 'arm', 'read']], ['acted (write, push, PR, edit)', C.blue, ['act']], ['dispatched', C.aqua, ['dispatch']]];
  const data = rows.map(([label, keys]) => {
    const xs = keys.map((k) => A.sources[k]).filter(Boolean); const n = xs.reduce((a, x) => a + x.n, 0);
    const per = xs.reduce((a, x) => a + x.per.code, 0); const share = xs.reduce((a, x) => a + x.shareUnits, 0);
    const seg = parts.map(([, , outs]) => xs.reduce((a, x) => a + outs.reduce((b, o) => b + (x.out[o] || 0), 0) * x.n, 0) / Math.max(1, n) / 100 * per);
    return { label, n, per, share, seg };
  });
  const W = 940, L = 230, R = 250, T = 78, rowH = 40, H = T + rows.length * rowH + 70;
  const max = Math.ceil(Math.max(...data.map((d) => d.per)) / 2) * 2; const x = (v) => L + (v / max) * (W - L - R);
  let s = svgOpen(W, H, 'What each path into a held session led to in September, per correct code change, split by what the session did');
  s += text(24, 26, 'What each path into a held session led to, September (both repos)', { size: 15, fill: C.ink, weight: 600 });
  s += text(24, 44, "Deliveries per correct code change, split by the most consequential thing the session did before its next delivery (the runner's completion gate folded in).", { size: 11 });
  for (let v = 0; v <= max; v += 2) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 8}" y2="${T + rows.length * rowH - 8}" stroke="${C.grid}"/>` + text(x(v), T + rows.length * rowH + 6, String(v), { size: 10, anchor: 'middle' });
  data.forEach((d, i) => {
    const y = T + i * rowH; let cx = x(0);
    s += text(L - 10, y + 13, d.label, { size: 11.5, fill: C.ink, anchor: 'end' });
    d.seg.forEach((v, j) => { const w = x(v) - x(0); if (w > 0.3) s += `<rect x="${cx.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="20" fill="${parts[j][1]}"/>`; cx += w; });
    s += text(cx + 6, y + 14, `${d.per.toFixed(1)}  (${fmt(d.n)} in the month; ${d.share}% of tokens)`, { size: 10.5, fill: C.ink });
  });
  const ly = H - 26; let lx = L;
  for (const [label, col] of parts) { s += `<rect x="${lx}" y="${ly - 9}" width="12" height="12" fill="${col}"/>` + text(lx + 17, ly + 1, label, { size: 11 }); lx += label.length * 6 + 50; }
  s += '</svg>';
  writeFileSync(join(outDir, 'what-wakes-lead-to.svg'), s);
}
console.log('wrote', outDir);
