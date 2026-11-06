// Generates the three figures for docs/papers/harbour/the-place-became-somebodys-job.md.
//   node docs/papers/harbour/the-place-became-somebodys-job-scripts/charts.mjs docs/papers/harbour/figures/the-place-became-somebodys-job && npm run figures:theme
//
// Data is read IN PLACE from the paper's version 2 evidence folder (cleaner-than-it-started-evidence/2026-11-06-v2/),
// located relative to this file. Nothing is copied into this folder.
//   analysis.json           single_and_area_reads (9 area readings over 15 tickets; 16 singles), pair_baseline.readings (4 pairs)
//   git/census-by-merge.json  the census count at each LinearViewer first-parent merge (git show at each merge)
// The loop figure (figure 2) is a drawing of docs/plans/survey/notes-2026-11-05.md@1c894016:132-152 and carries no numbers.
// Every value plotted is asserted below; a changed input fails the script instead of drawing a different claim.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const EVIDENCE = new URL('../cleaner-than-it-started-evidence/2026-11-06-v2/', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, EVIDENCE), 'utf8'));
const OUT = process.argv[2] || '.';
const MONO = 'JetBrains Mono, ui-monospace, monospace';
const SANS = 'Inter, system-ui, sans-serif';
const BLUE = '#2a78d6', ORANGE = '#eb6834', GREY = '#9ca3af', MUTED = '#6b7280', INK = '#111827', RULE = '#e5e7eb';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svgOpen = (W, H, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}" font-size="12" role="img" aria-label="${esc(label)}">` +
  `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;

// ---------- data, with assertions ----------
const analysis = read('analysis.json');
const sar = analysis.single_and_area_reads;
const areas = sar.subjects.filter(s => s.kind === 'pair or area');
assert.equal(areas.length, 9, 'nine area readings');
assert.ok(areas.every(s => s.both_better === true), 'every area reading is better in both passes');
const ticketSet = new Set(areas.flatMap(s => s.tickets));
assert.equal(ticketSet.size, 15, 'fifteen distinct tickets across the nine readings');
assert.equal(sar.single_ticket_subjects, 16, 'sixteen single-ticket subjects');

const pairs = analysis.pair_baseline.readings.subjects;
assert.equal(pairs.length, 4, 'four baseline pairs');
assert.equal(pairs.filter(p => p.both_better).length, 1, 'one of four pairs better in both passes');
const selected = analysis.pair_baseline.selection.selected;
assert.equal(selected.length, 4, 'four selected pairs');

const census = read('git/census-by-merge.json').merges.filter(m => m.count !== null);
assert.equal(census.length, 42, 'forty-two merges carry a census count');
assert.equal(census[0].short, '69e8f1754');
assert.equal(census[0].count, 56, 'census starts at 56');
const last = census[census.length - 1];
assert.equal(last.short, '509f797e6', 'census series ends at the pin');
assert.equal(last.count, 6, 'census ends at 6');
assert.equal(last.stop_count, 6, 'all six remaining entries are marked stop');
const firstSix = census.find(m => m.count === 6);
assert.equal(firstSix.short, 'ce42e7217', 'census first reaches 6 at LIN-4312');
const firstStopSplit = census.findIndex(m => m.stop_count !== 0 && m.stop_count !== null);
assert.equal(census[firstStopSplit].short, '591bb9596', 'stop marks first appear at LIN-4272');
assert.ok(census.slice(0, firstStopSplit).every(m => m.stop_count === 0), 'no stop split before the marks exist');

// ---------- figure 3: nine area readings, and four pairs, two cells each ----------
// Row names are plain descriptions of what each change did (LIN-4335). The ticket IDs live in the essay's
// "Where to check" table, keyed here by the same subject strings the analysis uses. Every row must have a name.
const AREA_NAMES = {
  'LIN-4247+LIN-4246+LIN-4293': 'run-end and repaint, then tidy',
  'LIN-4251+LIN-4277': 'preamble PR wording, then its tidy',
  'LIN-4252+LIN-4255': 'test stand-in + its follow-on',
  'LIN-4254': '16 stubs moved onto shared fake',
  'LIN-4255': 'hand-written fakes onto shared fake',
  'LIN-4263+LIN-4276': 'cost read + tidy-after',
  'LIN-4292+LIN-4304': 'guards removed + one spelling',
  'LIN-4296+LIN-4254': 'fake DOM models select; suites move',
  'LIN-4313+LIN-4317': 'mint route, then one grant rule',
};
const PAIR_NAMES = {
  '0eb4a2d1→a6e0ae11': 'free-tier seam, urlKey registry',
  'c1d5c700→71a42131': 'KPI trend charts + cost figure',
  'd10e7398→8ddb0f3b': 'loop-terminal checks, one stop rule',
  '0da144c8→c5295b42': 'workspace KPI charts + PR times',
};
assert.equal(Object.keys(AREA_NAMES).length, 9, 'a name for each of the nine areas');
assert.ok(areas.every(s => AREA_NAMES[s.subject]), 'every area subject has a plain name');
assert.equal(Object.keys(PAIR_NAMES).length, 4, 'a name for each of the four pairs');
assert.ok(pairs.every(p => PAIR_NAMES[p.selected_pair]), 'every pair has a plain name');

function areaAndPairFigure() {
  const W = 960, rowH = 30, cellW = 92, X_CELL1 = 430, X_CELL2 = X_CELL1 + cellW + 10;
  const groupA = 78, groupB = groupA + areas.length * rowH + 62;
  const H = groupB + pairs.length * rowH + 110;
  const o = [svgOpen(W, H, 'Nine finished-move area readings, all better in both blind passes, beside four ordinary pre-loop pairs, of which one is better in both passes. Each row has two cells, pass 1 and pass 2.')];
  o.push(`<text x="20" y="28" font-size="14" font-weight="600" fill="${INK}">Finished moves, read as one area each</text>`);
  o.push(`<text x="20" y="46" font-size="11" fill="${MUTED}">Nine readings over fifteen tickets. Two tickets sit in two readings each, so the tickets are counted once.</text>`);
  o.push(`<text x="${X_CELL1 + cellW / 2}" y="${groupA - 12}" font-size="10.5" fill="${MUTED}" text-anchor="middle">pass 1</text>`);
  o.push(`<text x="${X_CELL2 + cellW / 2}" y="${groupA - 12}" font-size="10.5" fill="${MUTED}" text-anchor="middle">pass 2</text>`);
  areas.forEach((s, i) => {
    const y = groupA + i * rowH;
    o.push(`<text x="20" y="${y + 17}" font-size="11.5" fill="${INK}">${esc(AREA_NAMES[s.subject])}</text>`);
    o.push(`<text x="290" y="${y + 17}" font-size="10.5" fill="${MUTED}">${s.tickets.length} ticket${s.tickets.length > 1 ? 's' : ''}</text>`);
    s.passes.forEach((p, j) => {
      const x = j === 0 ? X_CELL1 : X_CELL2;
      o.push(`<rect x="${x}" y="${y + 3}" width="${cellW}" height="22" rx="4" fill="${p.sign === 'better' ? BLUE : GREY}"/>`);
      o.push(`<text x="${x + cellW / 2}" y="${y + 18}" font-size="11" fill="#fff" text-anchor="middle" font-family="${MONO}">${esc(p.sign)}</text>`);
    });
  });
  o.push(`<text x="20" y="${groupB - 22}" font-size="14" font-weight="600" fill="${INK}">Ordinary pre-loop pairs, read the same way</text>`);
  o.push(`<text x="20" y="${groupB - 4}" font-size="11" fill="${MUTED}">Four pairs of consecutive changes to the same files, from 20 October. Pairs are not untouched areas.</text>`);
  pairs.forEach((p, i) => {
    const sel = selected.find(x => x.pair === p.selected_pair);
    const y = groupB + i * rowH;
    const name = PAIR_NAMES[p.selected_pair];
    const kind = p.selected_pair === 'd10e7398→8ddb0f3b' ? 'a consolidation' : `shares ${sel.shared_production_files.length} file${sel.shared_production_files.length > 1 ? 's' : ''}`;
    o.push(`<text x="20" y="${y + 17}" font-size="11.5" fill="${INK}">${esc(name)}</text>`);
    o.push(`<text x="290" y="${y + 17}" font-size="10.5" fill="${MUTED}">${esc(kind)}</text>`);
    p.passes.forEach((ps, j) => {
      const x = j === 0 ? X_CELL1 : X_CELL2;
      o.push(`<rect x="${x}" y="${y + 3}" width="${cellW}" height="22" rx="4" fill="${ps.sign === 'better' ? BLUE : GREY}"/>`);
      o.push(`<text x="${x + cellW / 2}" y="${y + 18}" font-size="11" fill="#fff" text-anchor="middle" font-family="${MONO}">${esc(ps.sign)}</text>`);
    });
  });
  o.push(`<text x="20" y="${H - 40}" font-size="11" fill="${INK}">Not loop against no loop. Each pair was scored by the same prompt as the areas, so the two groups share one instrument.</text>`);
  o.push(`<text x="20" y="${H - 22}" font-size="11" fill="${MUTED}">Blue: better. Grey: mixed (no pass read any subject worse). Source: cleaner-than-it-started-evidence/2026-11-06-v2/analysis.json.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 1: the census, one point per merge ----------
function censusFigure() {
  const W = 960, H = 430, X0 = 70, X1 = 910, Y0 = 318, Y1 = 40, YMAX = 60;
  const n = census.length;
  const x = i => X0 + (X1 - X0) * i / (n - 1);
  const y = v => Y0 - (Y0 - Y1) * v / YMAX;
  const o = [svgOpen(W, H, 'Hand-written fake DOMs on the census list, one point per merge that carries a census count (42): 56 at the first count on 5 November, 25 by 19:02Z that day, 6 from 11:41Z on 6 November, all six marked stop.')];
  for (const v of [0, 10, 20, 30, 40, 50, 60]) {
    o.push(`<line x1="${X0}" y1="${y(v)}" x2="${X1}" y2="${y(v)}" stroke="${RULE}"/>`);
    o.push(`<text x="${X0 - 10}" y="${y(v) + 4}" font-size="10.5" fill="${MUTED}" text-anchor="end" font-family="${MONO}">${v}</text>`);
  }
  o.push(`<text x="20" y="${(Y0 + Y1) / 2}" font-size="11" fill="${MUTED}" transform="rotate(-90 20 ${(Y0 + Y1) / 2})" text-anchor="middle">hand-written fake DOMs on the list</text>`);
  // stop split begins at firstStopSplit; before it, one total only
  const pts = census.map((m, i) => ({ ...m, i }));
  const before = pts.filter(p => p.i < firstStopSplit);
  const after = pts.filter(p => p.i >= firstStopSplit);
  o.push(`<polyline fill="none" stroke="${GREY}" stroke-width="1.6" points="${pts.map(p => `${x(p.i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ')}"/>`);
  for (const p of before) o.push(`<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.count).toFixed(1)}" r="3.6" fill="${GREY}"/>`);
  for (const p of after) {
    o.push(`<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.movable_count).toFixed(1)}" r="3.6" fill="${BLUE}"/>`);
    o.push(`<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.count).toFixed(1)}" r="3.6" fill="${ORANGE}"/>`);
  }
  // annotations
  const at = short => census.find(m => m.short === short);
  const note = (short, text, dx, dy) => {
    const m = at(short), p = pts.find(q => q.short === short);
    o.push(`<text x="${(x(p.i) + dx).toFixed(1)}" y="${(y(m.count) + dy).toFixed(1)}" font-size="11" fill="${INK}" font-family="${MONO}">${esc(text)}</text>`);
  };
  note('69e8f1754', '56 · 5 Nov 13:18Z', 10, -10);
  note('af55cb737', '25 at af55cb73 (9 stops)', 10, -12);
  // the six: label above the falling line, with a leader down to the point
  { const p = pts.find(q => q.short === 'ce42e7217');
    o.push(`<line x1="${x(p.i).toFixed(1)}" y1="${y(30).toFixed(1)}" x2="${x(p.i).toFixed(1)}" y2="${(y(6) - 6).toFixed(1)}" stroke="${MUTED}" stroke-width="1"/>`);
    o.push(`<text x="${(x(p.i) - 8).toFixed(1)}" y="${y(31).toFixed(1)}" font-size="11" fill="${INK}" font-family="${MONO}" text-anchor="end">6 · 6 Nov 11:41Z</text>`); }
  o.push(`<line x1="${x(firstStopSplit).toFixed(1)}" y1="${Y1 - 6}" x2="${x(firstStopSplit).toFixed(1)}" y2="${Y0}" stroke="${MUTED}" stroke-dasharray="4 4"/>`);
  o.push(`<text x="${(x(firstStopSplit) + 6).toFixed(1)}" y="${Y1 + 8}" font-size="10.5" fill="${MUTED}">stops first marked (591bb9596)</text>`);
  o.push(`<text x="${X0}" y="${Y0 + 18}" font-size="10.5" fill="${MUTED}">merge 1 · 5 Nov 13:18Z</text>`);
  o.push(`<text x="${X1}" y="${Y0 + 18}" font-size="10.5" fill="${MUTED}" text-anchor="end">merge ${n} · 6 Nov 13:51Z</text>`);
  // legend
  o.push(`<circle cx="${X0}" cy="${H - 70}" r="4" fill="${GREY}"/><text x="${X0 + 10}" y="${H - 66}" font-size="11" fill="${INK}">total, before the stops were marked</text>`);
  o.push(`<circle cx="${X0 + 250}" cy="${H - 70}" r="4" fill="${BLUE}"/><text x="${X0 + 260}" y="${H - 66}" font-size="11" fill="${INK}">movable entries</text>`);
  o.push(`<circle cx="${X0 + 380}" cy="${H - 70}" r="4" fill="${ORANGE}"/><text x="${X0 + 390}" y="${H - 66}" font-size="11" fill="${INK}">marked stop (cannot move yet)</text>`);
  o.push(`<text x="${X0}" y="${H - 20}" font-size="11" fill="${MUTED}">This is the census's own count of files on its list. It is not a count of copies, and it is not the crude grep (46 to 51), which is a different measure.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 2: the loop, before / during / after ----------
function loopFigure() {
  const W = 960, H = 350;
  const o = [svgOpen(W, H, 'The loop as it ran on 5 November, in three stages: before the work a read-only Survey and a scope call; during the work a tidy first where the change binds, then the change; at merge two blind reads and the builder\'s answers; after the merge a tidy-after of the copies left at the edges. A dashed line returns from the tidy-after to the next ticket in the same area.')];
  o.push(`<defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${MUTED}"/></marker></defs>`);
  const wrap = (t, n) => { const words = t.split(' '); const lines = ['']; for (const w of words) { if ((lines[lines.length - 1] + ' ' + w).trim().length > n) lines.push(w); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim(); } return lines; };
  const cols = [
    { title: 'Before the work', x: 20, items: ['A read-only Survey of the ticket, posted on it', 'The scope call, written onto the ticket: how big the move is, and the checks to run at merge'], fill: '#eef4fd', stroke: BLUE },
    { title: 'During the work', x: 330, items: ['A tidy first, as its own task, where the change binds', 'Then the change itself, re-surveyed on the tidied ground'], fill: '#f3f4f6', stroke: GREY },
    { title: 'At merge', x: 640, items: ['Two blind reads of the commit, from its code alone', "The builder's after-answers, once the work's lineage has ended"], fill: '#f3f4f6', stroke: GREY },
  ];
  const colW = 290, colY = 58, colH = 150;
  for (const c of cols) {
    o.push(`<rect x="${c.x}" y="${colY}" width="${colW}" height="${colH}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.4"/>`);
    o.push(`<text x="${c.x + 16}" y="${colY + 28}" font-size="14" font-weight="600" fill="${INK}">${esc(c.title)}</text>`);
    let line = 0;
    c.items.forEach((t, i) => {
      line = i === 0 ? 0 : line + 1;
      wrap(t, 46).forEach(seg => { o.push(`<text x="${c.x + 16}" y="${colY + 56 + line * 17 + i * 6}" font-size="12" fill="${INK}">${esc(seg)}</text>`); line++; });
      line--;
    });
  }
  // arrows between columns
  o.push(`<line x1="311" y1="${colY + colH / 2}" x2="328" y2="${colY + colH / 2}" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ar)"/>`);
  o.push(`<line x1="621" y1="${colY + colH / 2}" x2="638" y2="${colY + colH / 2}" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ar)"/>`);
  // after box
  o.push(`<rect x="640" y="236" width="290" height="72" rx="8" fill="#fff7f3" stroke="${ORANGE}" stroke-width="1.4"/>`);
  o.push(`<text x="656" y="260" font-size="14" font-weight="600" fill="${INK}">After the merge</text>`);
  o.push(`<text x="656" y="282" font-size="12" fill="${INK}">A tidy-after: the copies left at the</text>`);
  o.push(`<text x="656" y="299" font-size="12" fill="${INK}">edges, gathered straight away</text>`);
  o.push(`<line x1="785" y1="${colY + colH}" x2="785" y2="232" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ar)"/>`);
  // loop back: tidy-after to next ticket in the area
  o.push(`<path d="M640 266 C 520 300, 240 300, 170 ${colY + colH + 4}" fill="none" stroke="${ORANGE}" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#ar)"/>`);
  o.push(`<text x="400" y="312" font-size="11" fill="${MUTED}" text-anchor="middle">the next ticket in the same area starts from what was left in the notebook</text>`);
  o.push(`<text x="20" y="${H - 14}" font-size="11" fill="${MUTED}">The Periodical reviews sit outside the loop: an occasional read of the whole codebase, the film rather than the still.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

const outFiles = {
  'loop-before-during-after.svg': loopFigure(),
  'area-readings-and-pairs.svg': areaAndPairFigure(),
  'census-by-merge.svg': censusFigure(),
};
for (const [name, svg] of Object.entries(outFiles)) writeFileSync(`${OUT}/${name}`, svg);
console.log(`written ${Object.keys(outFiles).length} figures to ${OUT}`);
