// LIN-3189: draws replay-small-work.md's two SVG figures from survey-replay-analyse.mjs's and survey-replay-chores.mjs's output, by hand (no dependencies).
// Usage: node scripts/survey-replay-figures.mjs [--in data/survey-replay/analysis.json] [--chores data/survey-replay/chores.json] [--svg docs/papers/harbour/figures/replay-small-work]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const a = JSON.parse(readFileSync(arg('--in', 'data/survey-replay/analysis.json'), 'utf8'));
const chores = JSON.parse(readFileSync(arg('--chores', 'data/survey-replay/chores.json'), 'utf8'));
const dir = arg('--svg', 'docs/papers/harbour/figures/replay-small-work');
mkdirSync(dir, { recursive: true });

const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', band: '#f9fafb', harbour: '#1d4ed8', runner: '#b45309', ghost: '#9ca3af', worse: '#b91c1c', equivalent: '#6b7280', better: '#047857' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || C.muted}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svg = (W, H, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>\n`;
const mark = (shape, cx, cy, r, fill, stroke, hollow) => shape === 'diamond'
  ? `<path d="M${cx},${cy - r - 1} l${r + 1},${r + 1} l${-(r + 1)},${r + 1} l${-(r + 1)},${-(r + 1)} z" fill="${hollow ? '#fff' : fill}" stroke="${stroke}" stroke-width="1.6"/>`
  : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hollow ? '#fff' : fill}" stroke="${stroke}" stroke-width="1.6"/>`;

// ---- Figure 1 (headline): per ticket, lean ÷ original cost against the correctness verdict -------------------------------
{
  const W = 960, L = 150, R = 660, T = 92, rowH = 92;
  const rowsY = { better: T + rowH / 2, equivalent: T + rowH * 1.5, worse: T + rowH * 2.5 };
  const B = T + rowH * 3;
  const lo = Math.log10(0.005), hi = Math.log10(0.3);
  const x = (v) => L + ((Math.log10(v) - lo) / (hi - lo)) * (R - L);
  let s = text(20, 26, 'Thirteen small tickets replayed lean: what it cost against what shipped, and how the replay compared', { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Lean = one implementer, one review, one close-out, all mid tier, in-session. Original = whole-life cost of the ticket as Harbour shipped it.', { size: 11 });
  s += text(20, 60, 'Verdict as pre-registered: the blind reader\'s judgement, moved to "worse" when a shipped test fails on behaviour or the replay ships the known fault.', { size: 11 });
  for (const [k, y] of Object.entries(rowsY)) {
    s += `<rect x="${L}" y="${y - rowH / 2 + 4}" width="${R - L}" height="${rowH - 8}" fill="${C.band}"/>`;
    s += text(L - 12, y + 4, `replay ${k}`, { anchor: 'end', fill: C[k], weight: 600, size: 12 });
  }
  for (const v of [0.005, 0.01, 0.02, 0.05, 0.1, 0.2]) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${B}" stroke="${C.grid}"/>` + text(x(v), B + 16, v >= 0.01 ? `${Math.round(v * 100)}%` : '0.5%', { anchor: 'middle' });
  s += text((L + R) / 2, B + 36, 'lean cost ÷ original whole-life cost (log scale)', { anchor: 'middle', fill: C.ink });
  // Jitter within a row so labels do not collide.
  const placed = {};
  for (const r of a.rows.filter((r) => r.verdict)) {
    const tok = r.cost.ratio.tokensBySession; const ratio = tok ?? r.cost.ratio.hours; const hollow = tok == null;
    const shape = r.stratum === 'escape' ? 'diamond' : 'circle';
    const col = r.repo === 'LinearViewer' ? C.harbour : C.runner;
    const cx = x(ratio);
    const n = (placed[r.verdict] ||= []); let dy = -26; while (n.some((p) => Math.abs(p.x - cx) < 52 && p.dy === dy)) dy += 17; n.push({ x: cx, dy });
    const cy = rowsY[r.verdict] + dy + 8;
    if (r.overrides.length && r.blind && r.blind !== r.verdict) {
      const gy = rowsY[r.blind] + dy + 8;
      s += mark(shape, cx, gy, 4, C.ghost, C.ghost, true) + `<line x1="${cx}" x2="${cx}" y1="${gy + 6}" y2="${cy - 7}" stroke="${C.ghost}" stroke-dasharray="3 2"/>`;
    }
    s += mark(shape, cx, cy, 5, col, col, hollow);
    s += text(cx + 9, cy + 4, r.id.replace('LIN-', ''), { size: 10, fill: C.ink });
  }
  // Key
  let ky = T + 2; const kx = R + 34;
  const key = [
    [mark('circle', kx + 5, ky - 4, 5, C.harbour, C.harbour), 'Harbour (LinearViewer)'],
    [mark('circle', kx + 5, ky + 14, 5, C.runner, C.runner), 'runner (simple-dispatcher)'],
    [mark('diamond', kx + 5, ky + 32, 5, C.ink, C.ink), 'known escape or named fix'],
    [mark('circle', kx + 5, ky + 50, 5, C.ink, C.ink), 'clean'],
    [mark('circle', kx + 5, ky + 68, 5, C.ink, C.ink, true), 'no transcripts (August):'],
  ];
  key.forEach(([m, t], i) => { s += m + text(kx + 16, ky + i * 18, t, { fill: C.ink }); });
  s += text(kx + 16, ky + 5 * 18 - 4, 'ratio in working hours', { size: 10 });
  s += mark('circle', kx + 5, ky + 6 * 18 + 4, 4, C.ghost, C.ghost, true) + text(kx + 16, ky + 6 * 18 + 8, 'blind reader\'s own judgement,', { fill: C.ink });
  s += text(kx + 16, ky + 7 * 18 + 4, 'where the rule moved it to worse', { size: 10 });
  const sm = a.summary;
  let ny = ky + 9 * 18 + 6;
  for (const line of [
    `Median ratio: ${(sm.ratios.tokensBySession.median * 100).toFixed(1)}% of tokens (${sm.ratios.tokensBySession.n} tickets),`,
    `${(sm.ratios.hours.median * 100).toFixed(1)}% of working hours (all ${sm.n}).`,
    'Charging wakes to the child named instead of',
    `the session entered: ${(sm.ratios.tokensByChild.median * 100).toFixed(1)}%.`,
    `Blind readers agreed with each other on`,
    `${sm.blindAgreement.agree} of ${sm.blindAgreement.both} with the order swapped.`,
  ]) { s += text(kx, ny, line, { size: 10.5, fill: C.ink }); ny += 15; }
  writeFileSync(join(dir, 'cost-ratio-vs-verdict.svg'), svg(W, B + 52, s));
}

// ---- Figure 2: where the original's tokens went, against the lean replay, pooled over the tickets with transcripts --------
{
  const rows = a.rows.filter((r) => r.cost.original.unitsBySession != null);
  const kinds = a.summary.originalByKind;
  const orig = Object.values(kinds).reduce((t, k) => t + k.units, 0);
  const lean = rows.reduce((t, r) => t + r.cost.lean.units, 0);
  const role = (n) => rows.reduce((t, r) => t + r.cost.roles.filter((x) => x.role === n).reduce((u, x) => u + x.units, 0), 0);
  const W = 900, L = 150, R = 860, T = 84, barH = 46;
  const x = (v) => L + (v / orig) * (R - L);
  let s = text(20, 26, `Where the original tokens went, and what the lean replay spent, pooled over ${rows.length} tickets with transcripts`, { size: 13, fill: C.ink, weight: 600 });
  s += text(20, 44, 'Weighted tokens (frontier-input equivalents), charged to the session entered. Both repos.', { size: 11 });
  const PAL = ['#1d4ed8', '#60a5fa', '#047857', '#34d399', '#b45309', '#f59e0b', '#7c3aed', '#c084fc', '#db2777', '#9ca3af'];
  // Original, by kind of session
  let cx = L; let i = 0; const y1 = T;
  s += text(L - 12, y1 + barH / 2 + 4, 'original', { anchor: 'end', fill: C.ink, weight: 600, size: 12 });
  s += text(L - 12, y1 + barH / 2 + 18, `${(orig / 1e6).toFixed(1)}M`, { anchor: 'end', size: 10.5 });
  const legend = [];
  for (const [k, v] of Object.entries(kinds)) {
    const w = x(v.units) - L; const col = PAL[i++ % PAL.length];
    s += `<rect x="${cx}" y="${y1}" width="${w}" height="${barH}" fill="${col}"/>`;
    if (w > 46) s += text(cx + 4, y1 + 16, k, { size: 10, fill: '#fff' }) + text(cx + 4, y1 + 30, `${Math.round(v.share * 100)}%`, { size: 10, fill: '#fff' });
    else legend.push(`${k} ${Math.round(v.share * 100)}%`);
    cx += w;
  }
  if (legend.length) s += text(L, y1 + barH + 14, `also: ${legend.join(', ')}`, { size: 10 });
  // What those sessions did with their turns
  const y2 = T + barH + 44;
  s += text(L - 12, y2 + barH / 2 + 4, 'original, by', { anchor: 'end', fill: C.ink, weight: 600, size: 12 });
  s += text(L - 12, y2 + barH / 2 + 18, 'what each turn did', { anchor: 'end', size: 10.5 });
  cx = L; i = 0;
  const ACT = { tracker: '#7c3aed', remote: '#c084fc', wait: '#e9d5ff', read: '#1d4ed8', edit: '#047857', test: '#34d399', text: '#9ca3af', other: '#d1d5db' };
  const order = ['tracker', 'remote', 'wait', 'read', 'edit', 'test', 'text', 'other'];
  for (const k of order) {
    const v = chores.all[k]; if (!v) continue;
    const w = (R - L) * v.share;
    s += `<rect x="${cx}" y="${y2}" width="${w}" height="${barH}" fill="${ACT[k]}"/>`;
    if (w > 40) s += text(cx + 4, y2 + 16, k, { size: 10, fill: ['wait', 'other', 'text'].includes(k) ? C.ink : '#fff' }) + text(cx + 4, y2 + 30, `${Math.round(v.share * 100)}%`, { size: 10, fill: ['wait', 'other', 'text'].includes(k) ? C.ink : '#fff' });
    cx += w;
  }
  const choreShare = ['tracker', 'remote', 'wait'].reduce((t, k) => t + (chores.all[k]?.share || 0), 0);
  s += `<line x1="${L}" x2="${L + (R - L) * choreShare}" y1="${y2 + barH + 8}" y2="${y2 + barH + 8}" stroke="${C.ink}"/>`;
  s += text(L, y2 + barH + 22, `chores the lean replay never did (tracker, git remote / PR / CI, waiting): ${Math.round(choreShare * 100)}%`, { size: 10.5, fill: C.ink });
  // Lean
  const y3 = y2 + barH + 64;
  s += text(L - 12, y3 + barH / 2 + 4, 'lean replay', { anchor: 'end', fill: C.ink, weight: 600, size: 12 });
  s += text(L - 12, y3 + barH / 2 + 18, `${(lean / 1e6).toFixed(2)}M`, { anchor: 'end', size: 10.5 });
  cx = L;
  for (const [n, col] of [['implementer', '#047857'], ['reviewer', '#1d4ed8'], ['close-out', '#b45309']]) { const w = x(role(n)) - L; s += `<rect x="${cx}" y="${y3}" width="${w}" height="${barH}" fill="${col}"/>`; cx += w; }
  s += text(cx + 8, y3 + 18, `${(lean / orig * 100).toFixed(1)}% of the original: implementer, review and close-out`, { size: 10.5, fill: C.ink });
  const sh = chores.sessionShape;
  s += text(cx + 8, y3 + 34, `A fleet implementation leg ran a median ${sh.implementation.medianTurns} turns at ${Math.round(sh.implementation.medianUnitsPerTurn / 1000)}k a turn; the replay's implementer ran ${a.summary.lean.medianTurns ? '' : ''}`, { size: 10.5 });
  s += text(cx + 8, y3 + 48, `${medRole(a.rows, 'implementer', 'turns')} turns at ${Math.round(medRole(a.rows, 'implementer', 'perTurn') / 1000)}k a turn.`, { size: 10.5 });
  writeFileSync(join(dir, 'where-the-gap-is.svg'), svg(W, y3 + barH + 30, s));
}

function medRole(rows, role, what) {
  const xs = rows.flatMap((r) => r.cost.roles.filter((x) => x.role === role)).map((x) => (what === 'turns' ? x.turns : x.units / x.turns)).sort((p, q) => p - q);
  const n = xs.length; return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
}
