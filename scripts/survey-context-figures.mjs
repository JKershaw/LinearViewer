// LIN-3178: draw starting-context.md's SVG charts from survey-context-analyse.mjs's and survey-context-finder.mjs's snapshots; hand-written SVG, no dependencies.
// Usage: node scripts/survey-context-figures.mjs [--in data/survey-context/analysis.json] [--late data/survey-context/analysis-late.json] [--finder data/survey-context/finder.json] [--out docs/papers/harbour/figures/starting-context]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const A = JSON.parse(readFileSync(arg('--in', 'data/survey-context/analysis.json'), 'utf8'));
const L = JSON.parse(readFileSync(arg('--late', 'data/survey-context/analysis-late.json'), 'utf8'));
const F = JSON.parse(readFileSync(arg('--finder', 'data/survey-context/finder.json'), 'utf8'));
const outDir = arg('--out', 'docs/papers/harbour/figures/starting-context');
mkdirSync(outDir, { recursive: true });

// The survey's palette (survey-doubling-figures.mjs), with warm shades for the parts of orientation; every chart carries a legend.
const C = { ink: '#1f2937', muted: '#6b7280', grid: '#e5e7eb', surface: '#ffffff', blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', grey: '#cbd5e1', grey2: '#94a3b8', sand: '#f6c977', rust: '#b4441b' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size || 11}" fill="${o.fill || C.muted}" text-anchor="${o.anchor || 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const svgOpen = (w, h, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${w}" height="${h}" fill="${C.surface}"/>`;
const rect = (x, y, w, h, fill, tip) => (h <= 0.2 || w <= 0.2 ? '' : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"><title>${esc(tip)}</title></rect>`);
const legendRows = (x, y, entries, colW, perRow) => entries.map(([label, fill], i) => { const X = x + (i % perRow) * colW; const Y = y + Math.floor(i / perRow) * 16; return `<rect x="${X}" y="${Y - 9}" width="10" height="10" rx="2" fill="${fill}"/>` + text(X + 14, Y, label, { size: 10 }); }).join('');
const LABEL = { research: 'research', 'research (custom)': 'survey papers', plan: 'plan', 'plan-review': 'plan review', implementation: 'implementation', review: 'code review', 'close-out': 'close-out', Runner: 'passage Runner', leg: 'passage leg', stepper: 'stepper', autopilot: 'ticket autopilot' };
const ROLES = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out', 'stepper', 'autopilot', 'leg'];

// ---- 1. Headline: a session's weighted tokens split into orientation and work, by role.
{
  const parts = [
    ['bootstrap summarise', 'bootstrap', C.yellow],
    ['prompt, ticket and repo state, before the first file read or search', 'ticketContext', C.sand],
    ['finding the code, up to the first productive call', 'orientation', C.orange],
    ['re-orientation at the start of each later beat', 'reorientation', C.rust],
    ['beats with no productive call (quiet wakes, report-only beats)', 'noActionBeats', C.grey2],
    ['work', 'work', C.blue],
    ['subagents', 'subagents', C.grey],
  ];
  const W = 960, rowH = 30, top = 110, bx = 150, bw = 620;
  const rows = [...ROLES.map((r) => [LABEL[r], A.part1[r], r]), ['all sessions', { share: A.fleet.all, sessions: A.fleet.all.sessions, orientationShare: A.fleet.all.orientationTotal, orientationLowerShare: A.fleet.all.orientationLower }, 'all']];
  const H = top + rows.length * rowH + 110;
  let s = svgOpen(W, H, "A session's weighted tokens split into orientation and work, by role");
  s += text(20, 24, "Where a session's tokens go: finding its bearings, then working", { size: 14, fill: C.ink, weight: 600 });
  [`Dispatched Claude sessions started 31 Aug–30 Sep, both repos (${A.population} sessions); share of each role's weighted tokens. Warm shades are orientation.`,
    'Productive call: implementation, first edit to a repo file; plan, first file written or plan posted; plan review and code review, first run,',
    'file written or verdict posted; close-out, first change to repo, PR or ticket; research, first script run or file written; supervisors, first dispatch,',
    'ticket write, merge or push. Orientation range, right: lower bound (the two lightest shades) to upper bound (all four warm shades).'].forEach((l, i) => { s += text(20, 42 + i * 13, l, { size: 10 }); });
  for (let t = 0; t <= 100; t += 20) { const X = bx + (t / 100) * bw; s += `<line x1="${X}" x2="${X}" y1="${top - 6}" y2="${top + rows.length * rowH - 4}" stroke="${C.grid}"/>` + text(X, top - 10, `${t}%`, { anchor: 'middle', size: 9 }); }
  rows.forEach(([label, v, key], i) => {
    const Y = top + i * rowH; let X = bx;
    const sh = key === 'all' ? v.share : v.share;
    s += text(bx - 8, Y + 15, label, { anchor: 'end', size: 11, fill: C.ink, weight: key === 'all' ? 600 : null });
    s += text(bx - 8, Y + 26, `n=${v.sessions}`, { anchor: 'end', size: 9 });
    for (const [name, k, fill] of parts) { const val = sh[k] || 0; const w = (val / 100) * bw; s += rect(X, Y + 2, Math.max(0, w - 0.5), rowH - 8, fill, `${label}: ${name} ${val}%`); if (w > 26) s += text(X + w / 2, Y + 17, `${Math.round(val)}`, { anchor: 'middle', size: 9, fill: fill === C.blue || fill === C.rust || fill === C.orange ? '#ffffff' : C.ink }); X += w; }
    s += text(bx + bw + 10, Y + 17, `orientation ${v.orientationLowerShare}–${v.orientationShare}%`, { size: 10, fill: C.ink });
  });
  s += legendRows(20, top + rows.length * rowH + 22, parts.map(([n, , f]) => [n, f]), 460, 2);
  s += text(20, H - 24, 'Source: scripts/survey-context-extract.mjs and survey-context-analyse.mjs over local transcripts. Units: frontier-input equivalents at list-price ratios.', { size: 9 });
  s += text(20, H - 11, 'The passage Runner (2 sessions), survey papers (9) and other kinds (135) are in the all-sessions bar but not drawn alone; see the paper.', { size: 9 });
  writeFileSync(join(outDir, 'orientation-by-role.svg'), s + '</svg>\n');
}

// ---- 2. Headline: the share of reads that are repeats, per ticket.
{
  const R = A.part3.byItem; const tk = [...R.perTicket].map((t) => ({ ...t, share: 100 * t.repeatPairs / t.pairs })).sort((a, b) => a.share - b.share);
  const W = 960, H = 420, x0 = 60, pw = 860, top = 92, ph = 220;
  let s = svgOpen(W, H, 'Share of each ticket\'s session-file reads that an earlier session on the same ticket had already made');
  s += text(20, 24, 'Re-finding: how much of what a session reads, an earlier session on the same ticket already read', { size: 14, fill: C.ink, weight: 600 });
  [`${tk.length} tickets with two or more sessions whose first read was on or after 1 Sep, sorted by share. A read is a file in a repo, the ticket, a dispatch`,
    "item's feedback or the proxy instructions, counted once per session (a session-file pair). A pair repeats when an earlier session charged to the",
    "same ticket had read the same thing. Charged to the ticket of the dispatch item being worked."].forEach((l, i) => { s += text(20, 42 + i * 13, l, { size: 10 }); });
  const y = (v) => top + ph - (v / 100) * ph; const bw = pw / tk.length;
  for (let t = 0; t <= 100; t += 25) { s += `<line x1="${x0}" x2="${x0 + pw}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}"/>` + text(x0 - 6, y(t) + 4, `${t}%`, { anchor: 'end', size: 9 }); }
  tk.forEach((t, i) => { s += rect(x0 + i * bw, y(t.share), Math.max(0.6, bw - 0.4), y(0) - y(t.share), t.repo === 'simple-dispatcher' ? C.orange : C.blue, `${t.ticket} (${t.repo}): ${t.repeatPairs} of ${t.pairs} session-file reads repeat an earlier session's; ${t.sessions} sessions`); });
  const m = R.multiSessionCohort; const my = y(m.medianTicketRepeatPairPct);
  s += `<line x1="${x0}" x2="${x0 + pw}" y1="${my}" y2="${my}" stroke="${C.ink}" stroke-dasharray="4 3"/>` + text(x0 + 6, my - 5, `median ticket ${m.medianTicketRepeatPairPct}% (IQR ${m.p25TicketRepeatPairPct}–${m.p75TicketRepeatPairPct}%)`, { size: 10, fill: C.ink });
  s += text(x0, y(0) + 16, 'tickets, sorted by share', { size: 9 });
  s += text(x0, y(0) + 40, `Pooled: ${m.repeatPairPct}% of session-file reads and ${m.repeatPairTokenPct}% of read tokens repeat an earlier session's. Those repeats are ${m.repeatCarryPctOfWindow}% of the context`, { size: 10, fill: C.ink });
  s += text(x0, y(0) + 54, `these sessions carried (all their reads: ${m.readCarryPctOfWindow}%). Charged to the session's own ticket instead: ${A.part3.entered.multiSessionCohort.repeatPairPct}% of pairs, median ticket ${A.part3.entered.multiSessionCohort.medianTicketRepeatPairPct}%. Median ${m.medianSessions} sessions a ticket.`, { size: 10 });
  s += legendRows(x0 + 580, y(0) + 16, [['LinearViewer', C.blue], ['simple-dispatcher', C.orange]], 120, 2);
  writeFileSync(join(outDir, 'repeat-reads-per-ticket.svg'), s + '</svg>\n');
}

// ---- 3. What a session's context holds, by role, after CLAUDE.md was cut (19–30 Sep).
{
  const groups = [
    ['base: system prompt, tools', ['base context (system prompt, tools, CLAUDE.md)'], C.grey2],
    ['prompts, hook text, templates', ['prompts and templates'], C.yellow],
    ['tickets, comments, feedback', ['tickets and comments', 'other proxy reads'], C.sand],
    ['code and tests', ['code', 'test code', 'data'], C.orange],
    ['docs and CLAUDE.md', ['docs', 'CLAUDE.md loaded by the harness'], C.rust],
    ['git, search, command output', ['git and GitHub', 'search results', 'command output', 'session transcripts', 'subagent reports', 'other files', 'other tool results'], C.aqua],
    ["the model's own output", ["the model's own output"], C.blue],
    ['harness reminders, compaction, unattributed', ['harness reminders', 'compaction summaries', 'unattributed'], C.grey],
  ];
  const rowsOf = (P) => [...ROLES.map((r) => [LABEL[r], P[r]]), ['all sessions', P.all]].filter(([, v]) => v);
  const W = 960, rowH = 26, bx = 150, bw = 700;
  const rows = rowsOf(L.part2); const top = 92; const H = top + rows.length * rowH + 80;
  let s = svgOpen(W, H, "What a session's context holds, by role, 19–30 September");
  s += text(20, 24, "What a session's context holds, by role", { size: 14, fill: C.ink, weight: 600 });
  s += text(20, 42, `Sessions started 19–30 Sep (${L.population}), after LIN-2896 cut LinearViewer's CLAUDE.md on 18 Sep. Each block's tokens times the turns that carry it, as a share of the summed per-turn window.`, { size: 10 });
  s += text(20, 56, 'Bytes are converted at 2.6 a token, the ratio the extractor measures from window growth. Under 4% is left unattributed for any role; the supervisors', { size: 10 });
  s += text(20, 69, "attribute up to 5% more than their window (prose tokenizes at more bytes a token than code), and those rows are scaled to 100%.", { size: 10 });
  for (let t = 0; t <= 100; t += 20) { const X = bx + (t / 100) * bw; s += `<line x1="${X}" x2="${X}" y1="${top - 6}" y2="${top + rows.length * rowH - 4}" stroke="${C.grid}"/>` + text(X, top - 10, `${t}%`, { anchor: 'middle', size: 9 }); }
  rows.forEach(([label, v], i) => {
    const Y = top + i * rowH; let X = bx;
    s += text(bx - 8, Y + 15, `${label} (${v.sessions})`, { anchor: 'end', size: 11, fill: C.ink, weight: label === 'all sessions' ? 600 : null });
    for (const [name, keys, fill] of groups) { const val = keys.reduce((a, k) => a + (v[k] || 0), 0); const w = (val / 100) * bw; s += rect(X, Y + 2, Math.max(0, w - 0.5), rowH - 6, fill, `${label}: ${name} ${val.toFixed(1)}%`); if (w > 24) s += text(X + w / 2, Y + 16, `${Math.round(val)}`, { anchor: 'middle', size: 9, fill: [C.blue, C.rust, C.orange, C.aqua].includes(fill) ? '#ffffff' : C.ink }); X += w; }
  });
  s += legendRows(bx, top + rows.length * rowH + 20, groups.map(([n, , f]) => [n, f]), 240, 3);
  writeFileSync(join(outDir, 'context-by-role.svg'), s + '</svg>\n');
}

// ---- 4. What a deterministic finder would get: recall of edited files against precision, per method.
{
  const M = ['named paths', 'symbol grep', 'imports only (forward)', 'import neighbours', 'co-change history', 'named paths + imports', 'all four'];
  const COL = { 'named paths': C.blue, 'symbol grep': C.aqua, 'imports only (forward)': C.yellow, 'import neighbours': C.sand, 'co-change history': C.grey2, 'named paths + imports': C.orange, 'all four': C.rust };
  const W = 960, H = 420, x0 = 80, pw = 520, top = 70, ph = 280;
  let s = svgOpen(W, H, 'Recall and precision of four deterministic starting-context finders against what implementers edited and read');
  s += text(20, 24, 'What a deterministic finder would have handed the implementer', { size: 14, fill: C.ink, weight: 600 });
  s += text(20, 42, `${F.sample} implementation sessions, 31 Aug–30 Sep (LinearViewer ${F.byRepo.LinearViewer}, simple-dispatcher ${F.byRepo['simple-dispatcher']}), each method run against origin/main as it stood when the session started.`, { size: 10 });
  s += text(20, 56, 'Recall: share of the edited files that existed then which the method names. Precision: share of what it names that the session edited or read.', { size: 10 });
  const X = (v) => x0 + (v / 100) * pw; const Y = (v) => top + ph - (v / 100) * ph;
  for (let t = 0; t <= 100; t += 20) { s += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + ph}" stroke="${C.grid}"/>` + text(X(t), top + ph + 14, `${t}%`, { anchor: 'middle', size: 9 }); s += `<line x1="${x0}" x2="${x0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/>` + text(x0 - 6, Y(t) + 4, `${t}%`, { anchor: 'end', size: 9 }); }
  s += text(x0 + pw / 2, top + ph + 32, 'recall of edited files (pooled)', { anchor: 'middle', size: 10, fill: C.ink });
  s += `<text x="24" y="${top + ph / 2}" font-size="10" fill="${C.ink}" text-anchor="middle" transform="rotate(-90 24 ${top + ph / 2})">precision against files used (pooled)</text>`;
  const lx = x0 + pw + 40; let ly = top + 6;
  for (const m of M) {
    const r = F.results[m]?.all; if (!r || r.precisionUsed == null) { s += text(lx, ly, `${m}: names nothing`, { size: 10 }); ly += 30; continue; }
    s += `<circle cx="${X(r.recallEdited)}" cy="${Y(r.precisionUsed)}" r="6" fill="${COL[m]}"><title>${esc(`${m}: recall ${r.recallEdited}%, precision ${r.precisionUsed}%, median ${r.medianSuggested} files named`)}</title></circle>`;
    s += `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${COL[m]}"/>` + text(lx + 16, ly, m, { size: 11, fill: C.ink }) + text(lx + 16, ly + 13, `recall ${r.recallEdited}% · precision ${r.precisionUsed}% · names ${r.medianSuggested} files (median)`, { size: 9 });
    ly += 32;
  }
  s += text(lx, ly + 8, `New files were ${F.newFileShare}% of edits; no finder can name them.`, { size: 9 });
  writeFileSync(join(outDir, 'finder-recall-precision.svg'), s + '</svg>\n');
}
console.log(`wrote 4 charts to ${outDir}`);
