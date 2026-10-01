// LIN-3177: draw where-judgement-happens.md's SVG charts (a ticket's life as a strip with its consequential decisions, the judgement share of cost by role, and decisions by type and role and class); hand-written SVG, no dependencies.
// Usage: node scripts/survey-judgement-figures.mjs --median LIN-n --large LIN-n [--codes docs/papers/harbour/where-judgement-happens-codes.json] [--cycles data/survey-judgement/cycles.json] [--analysis data/survey-judgement/analysis.json] [--out docs/papers/harbour/figures/where-judgement-happens]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const codes = JSON.parse(readFileSync(arg('--codes', 'docs/papers/harbour/where-judgement-happens-codes.json'), 'utf8'));
const cycles = JSON.parse(readFileSync(arg('--cycles', 'data/survey-judgement/cycles.json'), 'utf8'));
const A = JSON.parse(readFileSync(arg('--analysis', 'data/survey-judgement/analysis.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/where-judgement-happens');
mkdirSync(outDir, { recursive: true });

// The survey's palette (survey-repeats-figures.mjs).
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', grey: '#cbd5e1', grey2: '#94a3b8', paleBlue: '#a9c9ef' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const rect = (x, y, w, h, fill, tip) => (h <= 0.2 || w <= 0.2 ? '' : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"><title>${esc(tip)}</title></rect>`);
const legend = (x, y, entries, colW) => entries.map(([label, fill, shape], i) => (shape === 'dot' ? `<circle cx="${x + i * colW + 5}" cy="${y - 4}" r="5" fill="${fill}" stroke="${C.ink}" stroke-width="0.6"/>` : `<rect x="${x + i * colW}" y="${y - 9}" width="10" height="10" rx="2" fill="${fill}"/>`) + text(x + i * colW + 14, y, label, { size: 10 })).join('');
const CLS = { a: C.aqua, b: C.yellow, c: C.orange };
const CLS_LABEL = { a: '(a) a rule over observable state', b: '(b) a cheaper or shorter step', c: '(c) reasoning over context' };
const LANES = ['Runner', 'leg', 'autopilot', 'stepper', 'wake', 'research', 'custom', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'other', 'John'];
const laneOf = (r) => (LANES.includes(r) ? r : r === 'other-worker' ? 'other' : LANES.includes(r) ? r : 'other');
const fmtT = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const BUCKET = { decision: C.ink, work: C.paleBlue, bookkeeping: C.grey };

// ---- 1. The strip: one ticket's life, cycles by role, gaps over 45 minutes folded, decisions marked by class.
function strip(T, x0, y0, W) {
  const cs = cycles.filter((c) => c.ticket === T && (c.sessionEntered || c.childNamed));
  const ds = codes.readerA[T].decisions;
  const decCycles = new Set(ds.map((d) => d.cycle));
  const evts = cs.map((c) => ({ t0: Date.parse(c.at), t1: Math.max(Date.parse(c.end || c.at), Date.parse(c.at) + 30e3), lane: laneOf(c.role), c }));
  const human = ds.filter((d) => /^comment /.test(d.cycle)).map((d) => ({ t: Date.parse(`2026-${d.cycle.slice(8)}:00Z`), d }));
  for (const h of human) evts.push({ t0: h.t, t1: h.t + 60e3, lane: laneOf(h.d.role), human: h.d });
  evts.sort((a, b) => a.t0 - b.t0);
  // Active segments, folding any gap over 45 minutes into a fixed break.
  const segs = []; for (const e of evts) { const s = segs.at(-1); if (s && e.t0 - s.t1 <= 45 * 60e3) s.t1 = Math.max(s.t1, e.t1); else segs.push({ t0: e.t0, t1: e.t1 }); }
  const BRK = 14, active = segs.reduce((s, x) => s + (x.t1 - x.t0), 0), scale = (W - 150 - BRK * (segs.length - 1)) / active;
  let acc = x0 + 150; for (const s of segs) { s.x = acc; acc += (s.t1 - s.t0) * scale + BRK; }
  const X = (t) => { const s = segs.find((s) => t >= s.t0 && t <= s.t1) || segs.filter((s) => s.t0 <= t).at(-1) || segs[0]; return s.x + Math.min(t - s.t0, s.t1 - s.t0) * scale; };
  const lanes = LANES.filter((l) => evts.some((e) => e.lane === l));
  const LH = 22; let s = '';
  lanes.forEach((l, i) => { const Y = y0 + i * LH; s += `<line x1="${x0 + 150}" x2="${x0 + W}" y1="${Y + LH / 2}" y2="${Y + LH / 2}" stroke="${C.grid}"/>` + text(x0 + 142, Y + LH / 2 + 4, l, { anchor: 'end', size: 10, fill: C.ink }); });
  for (const sg of segs.slice(1)) s += `<line x1="${sg.x - BRK / 2}" x2="${sg.x - BRK / 2}" y1="${y0 - 4}" y2="${y0 + lanes.length * LH}" stroke="${C.grey2}" stroke-dasharray="2 3"/>`;
  for (const e of evts) {
    if (e.human) continue;
    const Y = y0 + lanes.indexOf(e.lane) * LH + 6; const b = decCycles.has(e.c.cycle) ? 'decision' : e.c.outcome === 'act' || e.c.outcome === 'dispatch' ? 'work' : 'bookkeeping';
    s += rect(X(e.t0), Y, Math.max(2, X(e.t1) - X(e.t0)), LH - 12, BUCKET[b], `${e.c.cycle} ${e.c.role} ${e.c.tier || ''} ${fmtT(e.t0)} ${Math.round(e.c.units / 1000)}k units (${b})`);
  }
  // Decision markers, staggered when they crowd.
  const placed = [];
  for (const d of ds) {
    const e = /^comment /.test(d.cycle) ? evts.find((x) => x.human === d) : evts.find((x) => x.c?.cycle === d.cycle);
    if (!e) continue;
    const cx = X(e.t0); const laneY = y0 + lanes.indexOf(e.lane) * LH;
    const k = placed.filter((p) => Math.abs(p.x - cx) < 9 && p.lane === e.lane).length; placed.push({ x: cx, lane: e.lane });
    const cy = laneY + 3 - k * 7;
    s += `<circle cx="${(cx + k * 4).toFixed(1)}" cy="${cy.toFixed(1)}" r="4.2" fill="${CLS[d.class]}" stroke="${C.ink}" stroke-width="0.6"><title>${esc(`${d.cycle} ${d.type} by ${d.role} (${d.tier}), class ${d.class}: ${d.evidence || ''}`)}</title></circle>`;
  }
  // Time labels at each segment's start.
  let lastX = -1e9;
  for (const sg of segs) if (sg.x - lastX > 70) { const end = sg.x > x0 + W - 80; s += text(end ? x0 + W : sg.x, y0 + lanes.length * LH + 13, fmtT(sg.t0), { size: 9, anchor: end ? 'end' : 'start' }); lastX = sg.x; }
  const hours = (evts.at(-1).t1 - evts[0].t0) / 36e5;
  return { svg: s, height: lanes.length * LH + 20, n: ds.length, cls: ds.reduce((m, d) => ((m[d.class] = (m[d.class] || 0) + 1), m), {}), hours, active: active / 36e5, cycles: cs.length };
}
{
  const W = 960; const Ts = [arg('--median', null), arg('--large', null)].filter(Boolean);
  const meta = Object.fromEntries(codes.sample.map((s) => [s.id, s]));
  let body = ''; let y = 64;
  for (const [i, T] of Ts.entries()) {
    const m = meta[T]; const r = strip(T, 0, y + 30, W - 20);
    const cl = ['a', 'b', 'c'].map((k) => `${r.cls[k] || 0} ${k}`).join(', ');
    body += text(20, y, `${i === 0 ? 'A median ticket' : 'A large ticket'}: ${T}, ${m.prodLines} production lines, ${m.repos.join(' + ')}`, { size: 12, fill: C.ink, weight: 600 });
    body += text(20, y + 15, `${r.cycles} session cycles over ${r.hours.toFixed(1)} h (${r.active.toFixed(1)} h with a cycle running; quieter gaps over 45 min folded at the dashed lines). ${r.n} consequential decisions: ${cl}.`, { size: 10 });
    body += r.svg; y += 30 + r.height + 40;
  }
  let s = svgOpen(W, y + 40, "A ticket's life as a strip, with its consequential decisions marked by class");
  s += text(20, 24, "A ticket's life: every session cycle on it, by role, and the decisions that changed what shipped or how", { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, 'A cycle runs from one delivered turn (launch, wake, gate) to the next; dots are consequential decisions coded by reader A, coloured by what could have made them.', { size: 10 });
  s += body;
  s += legend(20, y + 10, [['cycle holding a decision', BUCKET.decision], ['acting or checking, no decision', BUCKET.work], ['bookkeeping (gate, read, re-arm)', BUCKET.bookkeeping]], 215);
  s += legend(20, y + 28, Object.entries(CLS_LABEL).map(([k, l]) => [l, CLS[k], 'dot']), 215);
  writeFileSync(join(outDir, 'ticket-strip.svg'), s + '</svg>\n');
}

// ---- 2. Judgement share of cost, by role: decision / work / bookkeeping, both charging rules, re-weighted to the population.
{
  const P = A.cost['sessionEntered|population'].roles; const Q = A.cost['childNamed|population'].roles;
  const roles = Object.keys({ ...P, ...Q }).sort((a, b) => (Q[b]?.shareOfTicketCost || 0) - (Q[a]?.shareOfTicketCost || 0));
  const W = 900, bx = 150, bw = 560, bh = 11, rowH = 34; const H = 90 + roles.length * rowH + 50;
  let s = svgOpen(W, H, 'Judgement share of cost, by role');
  s += text(20, 24, "Each role's cost: cycles holding a consequential decision, other acting or checking, and bookkeeping", { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, 'Weighted units on 36 sampled September changes, re-weighted to the population by cell. Upper bar: charged to the session entered; lower: to the child the log names.', { size: 10 });
  s += text(bx + bw + 12, 62, 'share of all ticket cost', { size: 10 });
  roles.forEach((r, i) => {
    const Y = 72 + i * rowH; s += text(bx - 8, Y + 15, r, { anchor: 'end', size: 11, fill: C.ink });
    [[P[r], Y], [Q[r], Y + bh + 2]].forEach(([v, yy], j) => {
      if (!v) return; let X = bx;
      for (const k of ['decision', 'work', 'bookkeeping']) { const w = ((v[k] || 0) / 100) * bw; s += rect(X, yy, w, bh, BUCKET[k], `${r}, ${j ? 'child named' : 'session entered'}: ${k} ${v[k]}%`); X += w; }
      s += text(bx + bw + 12, yy + 9, `${v.shareOfTicketCost}% · decision ${v.decision}%`, { size: 9, fill: j ? C.muted : C.ink });
    });
  });
  s += legend(bx, H - 20, [['cycle holding a consequential decision', BUCKET.decision], ['acting or checking, no decision', BUCKET.work], ['bookkeeping', BUCKET.bookkeeping]], 240);
  writeFileSync(join(outDir, 'judgement-share-by-role.svg'), s + '</svg>\n');
}

// ---- 3. Decisions by type and by role, stacked by class.
{
  const TYPES = { SB: 'send-back', CE: 'caught error', SC: 'scope change', ES: 'escalation', RU: 'ruling', RS: 'rescue', RP: 're-plan', RT: 'routing', MG: 'ship call' };
  const W = 940, bx = 130, bw = 300, bh = 16; const tc = A.census.byTypeClass; const rc = A.census.byRoleClass;
  const rows = (m) => { const o = {}; for (const [k, n] of Object.entries(m)) { const [g, c] = k.split('|'); (o[g] ||= { a: 0, b: 0, c: 0 })[c] += n; } return Object.entries(o).sort((a, b) => (b[1].a + b[1].b + b[1].c) - (a[1].a + a[1].b + a[1].c)); };
  const tr = rows(tc), rr = rows(rc); const max = Math.max(...[...tr, ...rr].map(([, v]) => v.a + v.b + v.c));
  const H = 80 + Math.max(tr.length, rr.length) * (bh + 6) + 50;
  let s = svgOpen(W, H, 'Consequential decisions by type and by role, by class');
  s += text(20, 24, `${A.census.decisions} consequential decisions on ${A.census.tickets} sampled changes: by type, and by who made them`, { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 41, 'Reader A\'s codes, as sampled (not re-weighted). Colour: what could have made the same call.', { size: 10 });
  const panel = (list, px, label, name) => {
    let o = text(px, 64, label, { size: 12, fill: C.ink, weight: 600 });
    list.forEach(([g, v], i) => { const Y = 74 + i * (bh + 6); let X = px + bx - 130 + 120; o += text(X - 8, Y + 12, name(g), { anchor: 'end', size: 11, fill: C.ink }); for (const k of ['a', 'b', 'c']) { const w = (v[k] / max) * bw; o += rect(X, Y, w, bh, CLS[k], `${name(g)}: ${v[k]} class ${k}`); X += w; } o += text(X + 6, Y + 12, String(v.a + v.b + v.c), { size: 10 }); });
    return o;
  };
  s += panel(tr, 20, 'By type', (g) => TYPES[g] || g);
  s += panel(rr, 480, 'By role', (g) => g);
  s += legend(20, H - 18, Object.entries(CLS_LABEL).map(([k, l]) => [l, CLS[k]]), 260);
  writeFileSync(join(outDir, 'decisions-by-class.svg'), s + '</svg>\n');
}
console.log('wrote', outDir);
