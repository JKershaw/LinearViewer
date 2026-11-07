// Generates the five figures for docs/papers/harbour/the-place-became-somebodys-job.md (version 4).
//   figure 1 two pipelines (drawing), figure 2 copy at the edge (drawing), figure 3 owner or finishing (drawing),
//   figure 4 census (data), figure 5 area readings and pairs (data).
// Version 4 replaced version 3's loop figure (loop-before-during-after.svg) with the two-pipelines drawing.
// The function comments below keep their version 3 figure numbers; the essay numbers them as above.
//   node docs/papers/harbour/the-place-became-somebodys-job-scripts/charts.mjs docs/papers/harbour/figures/the-place-became-somebodys-job && npm run figures:theme
//
// Data is read IN PLACE from the paper's version 2 evidence folder (cleaner-than-it-started-evidence/2026-11-06-v2/),
// located relative to this file. Nothing is copied into this folder.
//   analysis.json           single_and_area_reads (9 area readings over 15 tickets; 16 singles), pair_baseline.readings (4 pairs)
//   git/census-by-merge.json  the census count at each LinearViewer first-parent merge (git show at each merge)
// The two-pipelines figure draws docs/plans/survey/notes-2026-11-05.md@1c894016:132-152 and 182-185 (the loop; "a network of tasks rather than a line") and carries no numbers.
// The copy-at-the-edge and owner-or-finishing figures are Claude's drawings of the copy at the edge and of owner-versus-finishing: no data, no numbers.
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

// ---------- figure 5: nine area readings, and four pairs, two cells each ----------
// Row names are plain descriptions of what each change did (LIN-4335). The ticket IDs live in the essay's
// "Where to check" table, keyed here by the same subject strings the analysis uses. Every row must have a name.
const AREA_NAMES = {
  'LIN-4247+LIN-4246+LIN-4293': 'run-end and repaint, then tidy',
  'LIN-4251+LIN-4277': 'pull-request wording, then its tidy',
  'LIN-4252+LIN-4255': 'shared test helper, then its follow-on',
  'LIN-4254': 'moving the last fake pages',
  'LIN-4255': 'hand-written fakes onto shared fake',
  'LIN-4263+LIN-4276': 'cost split, then its tidy',
  'LIN-4292+LIN-4304': 'defensive checks removed, one rule',
  'LIN-4296+LIN-4254': 'shared fake gains dropdowns; tests move',
  'LIN-4313+LIN-4317': 'review-run route, then one rule',
};
const PAIR_NAMES = {
  '0eb4a2d1→a6e0ae11': 'free-tier check, then a key registry',
  'c1d5c700→71a42131': 'stats charts, then a cost figure',
  'd10e7398→8ddb0f3b': 'end-of-run checks, then one stop rule',
  '0da144c8→c5295b42': 'workspace charts, then PR times',
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
  o.push(`<text x="${X_CELL1 + cellW / 2}" y="${groupA - 12}" font-size="10.5" fill="${MUTED}" text-anchor="middle">reader 1</text>`);
  o.push(`<text x="${X_CELL2 + cellW / 2}" y="${groupA - 12}" font-size="10.5" fill="${MUTED}" text-anchor="middle">reader 2</text>`);
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
  o.push(`<text x="20" y="${groupB - 22}" font-size="14" font-weight="600" fill="${INK}">Ordinary earlier pairs, read the same way</text>`);
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
  o.push(`<text x="20" y="${H - 40}" font-size="11" fill="${INK}">Not a comparison with untouched code. Both groups were judged by the same readers with the same instructions.</text>`);
  o.push(`<text x="20" y="${H - 22}" font-size="11" fill="${MUTED}">Blue: better. Grey: mixed (no reader judged any of these worse). Source: cleaner-than-it-started-evidence/2026-11-06-v2/analysis.json.</text>`);
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
  o.push(`<text x="20" y="${(Y0 + Y1) / 2}" font-size="11" fill="${MUTED}" transform="rotate(-90 20 ${(Y0 + Y1) / 2})" text-anchor="middle">hand-written fake pages on the list</text>`);
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
  note('69e8f1754', '56 · 5 Nov, afternoon', 10, -10);
  note('af55cb737', '25 · 5 Nov, evening (9 marked stop)', 10, -12);
  // the six: label above the falling line, with a leader down to the point
  { const p = pts.find(q => q.short === 'ce42e7217');
    o.push(`<line x1="${x(p.i).toFixed(1)}" y1="${y(30).toFixed(1)}" x2="${x(p.i).toFixed(1)}" y2="${(y(6) - 6).toFixed(1)}" stroke="${MUTED}" stroke-width="1"/>`);
    o.push(`<text x="${(x(p.i) - 8).toFixed(1)}" y="${y(31).toFixed(1)}" font-size="11" fill="${INK}" font-family="${MONO}" text-anchor="end">6 · 6 Nov, before noon</text>`); }
  o.push(`<line x1="${x(firstStopSplit).toFixed(1)}" y1="${Y1 - 6}" x2="${x(firstStopSplit).toFixed(1)}" y2="${Y0}" stroke="${MUTED}" stroke-dasharray="4 4"/>`);
  o.push(`<text x="${(x(firstStopSplit) + 6).toFixed(1)}" y="${Y1 + 8}" font-size="10.5" fill="${MUTED}">files first marked stop</text>`);
  o.push(`<text x="${X0}" y="${Y0 + 18}" font-size="10.5" fill="${MUTED}">first merge counted · 5 Nov</text>`);
  o.push(`<text x="${X1}" y="${Y0 + 18}" font-size="10.5" fill="${MUTED}" text-anchor="end">merge ${n} · 6 Nov</text>`);
  // legend
  o.push(`<circle cx="${X0}" cy="${H - 70}" r="4" fill="${GREY}"/><text x="${X0 + 10}" y="${H - 66}" font-size="11" fill="${INK}">total, before the stops were marked</text>`);
  o.push(`<circle cx="${X0 + 250}" cy="${H - 70}" r="4" fill="${BLUE}"/><text x="${X0 + 260}" y="${H - 66}" font-size="11" fill="${INK}">movable entries</text>`);
  o.push(`<circle cx="${X0 + 380}" cy="${H - 70}" r="4" fill="${ORANGE}"/><text x="${X0 + 390}" y="${H - 66}" font-size="11" fill="${INK}">marked stop (cannot move yet)</text>`);
  o.push(`<text x="${X0}" y="${H - 20}" font-size="11" fill="${MUTED}">This counts the files on the test suite's list. It is not a count of copies, and a cruder text count over the same tests (46 to 51) is a different measure.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 1 (version 4): two pipelines, a drawing with no data ----------
// The old line of tickets, where each agent finishes its own ticket and leaves, so leftovers pile up between
// tickets; and the new pipeline, where each change is looked at, sized, made, and then tidied after. The
// leftover counts drawn are illustrative (one more per ticket), not measured.
function twoPipelinesFigure() {
  const W = 960, H = 470;
  const o = [svgOpen(W, H, 'Two pipelines, a drawing with no data. Top, the old line: four tickets in a row, each done by an agent that then leaves; small orange leftovers pile up between the tickets, one more each time, and clearing them is no one\'s job. Bottom, the new pipeline: for each change, a look first, then a decision on how big the move should be, then the change, then a tidy of what the change left behind; the leftovers from the change are cleared by the tidy, and the next change starts on a clearer floor.')];
  o.push(`<defs><marker id="ar2" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${MUTED}"/></marker></defs>`);
  const LEFT = '#fff7f3';
  const scrap = (x, y) => `<rect x="${x}" y="${y}" width="12" height="12" rx="2" fill="${ORANGE}"/>`;
  const ghost = (x, y) => `<rect x="${x}" y="${y}" width="12" height="12" rx="2" fill="none" stroke="${ORANGE}" stroke-width="1.2" stroke-dasharray="3 2"/>`;
  // --- top: the old line ---
  o.push(`<text x="20" y="30" font-size="14" font-weight="600" fill="${INK}">The old line: each agent finishes its own ticket and leaves</text>`);
  const TY = 52, TW = 170, TH = 58, GAP = 62;
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * (TW + GAP);
    o.push(`<rect x="${x}" y="${TY}" width="${TW}" height="${TH}" rx="8" fill="#f3f4f6" stroke="${GREY}" stroke-width="1.4"/>`);
    o.push(`<text x="${x + 14}" y="${TY + 24}" font-size="13" font-weight="600" fill="${INK}">Ticket ${i + 1}</text>`);
    o.push(`<text x="${x + 14}" y="${TY + 44}" font-size="11.5" fill="${MUTED}">done, and the agent leaves</text>`);
    if (i < 3) o.push(`<line x1="${x + TW + 4}" y1="${TY + TH / 2}" x2="${x + TW + GAP - 6}" y2="${TY + TH / 2}" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ar2)"/>`);
    // the floor under each ticket: leftovers so far, one more per ticket
    for (let k = 0; k <= i; k++) o.push(scrap(x + 14 + k * 18, TY + TH + 22));
  }
  o.push(`<line x1="20" y1="${TY + TH + 38}" x2="${20 + 4 * TW + 3 * GAP}" y2="${TY + TH + 38}" stroke="${RULE}" stroke-width="2"/>`);
  o.push(`<text x="20" y="${TY + TH + 60}" font-size="11.5" fill="${INK}">Leftovers (a second copy of a rule, a list nobody updated) pile up between tickets. Each ticket is done; clearing them is no one's job.</text>`);
  // --- bottom: the new pipeline ---
  const BY = 230;
  o.push(`<text x="20" y="${BY - 12}" font-size="14" font-weight="600" fill="${INK}">The new pipeline: four steps for each change</text>`);
  const steps = [
    { t: '1. Look first', s: ['a read-only look at the code', 'around the ticket'], fill: '#eef4fd', stroke: BLUE },
    { t: '2. Decide the size', s: ['how big a move: just the', 'task, or tidy the area too'], fill: '#eef4fd', stroke: BLUE },
    { t: '3. Make the change', s: ['the work itself, which may', 'leave copies at its edges'], fill: '#f3f4f6', stroke: GREY },
    { t: '4. Tidy what it left', s: ['straight after, a small', 'follow-on clears them'], fill: LEFT, stroke: ORANGE },
  ];
  const SW = 196, SH = 74, SG = 32;
  steps.forEach((st, i) => {
    const x = 20 + i * (SW + SG);
    o.push(`<rect x="${x}" y="${BY}" width="${SW}" height="${SH}" rx="8" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.4"/>`);
    o.push(`<text x="${x + 14}" y="${BY + 24}" font-size="13" font-weight="600" fill="${INK}">${esc(st.t)}</text>`);
    st.s.forEach((line, j) => o.push(`<text x="${x + 14}" y="${BY + 44 + j * 16}" font-size="11.5" fill="${MUTED}">${esc(line)}</text>`));
    if (i < 3) o.push(`<line x1="${x + SW + 3}" y1="${BY + SH / 2}" x2="${x + SW + SG - 5}" y2="${BY + SH / 2}" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#ar2)"/>`);
  });
  // floor: leftovers appear after step 3 and are cleared by step 4
  const FY = BY + SH + 22;
  const x3 = 20 + 2 * (SW + SG), x4 = 20 + 3 * (SW + SG);
  o.push(scrap(x3 + 14, FY)); o.push(scrap(x3 + 32, FY));
  o.push(`<text x="${x3 + 54}" y="${FY + 10}" font-size="11" fill="${MUTED}">left at the edges</text>`);
  o.push(ghost(x4 + 14, FY)); o.push(ghost(x4 + 32, FY));
  o.push(`<text x="${x4 + 54}" y="${FY + 10}" font-size="11" fill="${MUTED}">cleared</text>`);
  o.push(`<line x1="20" y1="${FY + 18}" x2="${x4 + SW}" y2="${FY + 18}" stroke="${RULE}" stroke-width="2"/>`);
  // loop back to the next change
  o.push(`<path d="M${x4 + SW / 2} ${FY + 26} C ${x4 + SW / 2} ${FY + 62}, 120 ${FY + 62}, 118 ${BY + SH + 8}" fill="none" stroke="${MUTED}" stroke-width="1.4" stroke-dasharray="6 5" marker-end="url(#ar2)"/>`);
  o.push(`<text x="${(x4 + SW / 2 + 118) / 2}" y="${FY + 72}" font-size="11" fill="${MUTED}" text-anchor="middle">the next change starts on a clearer floor; anything still left is written down for it</text>`);
  o.push(`<text x="20" y="${H - 14}" font-size="11" fill="${MUTED}">A drawing, not data. Orange squares: leftovers, drawn one more per ticket to show the build-up, not counted. Dashed: cleared.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 3: the copy at the edge (a drawing, no data) ----------
function copyAtEdgeFigure() {
  const W = 960, H = 260;
  const o = [svgOpen(W, H, 'Three panels. One decision written in three boxes; then one box changed while two still hold the old rule, marked left behind; then the changed box kept and the two others reading from it, marked gathered by the tidy-after. A drawing, not data.')];
  o.push(`<defs><marker id="ar3" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${MUTED}"/></marker></defs>`);
  const panels = [
    { x: 20, title: '1. One decision, three places' },
    { x: 340, title: '2. A change fixes one place' },
    { x: 660, title: '3. The tidy-after gathers them' },
  ];
  for (const pn of panels) {
    o.push(`<rect x="${pn.x}" y="20" width="280" height="200" rx="8" fill="#fbfbfc" stroke="${RULE}" stroke-width="1.2"/>`);
    o.push(`<text x="${pn.x + 14}" y="44" font-size="13" font-weight="600" fill="${INK}">${esc(pn.title)}</text>`);
  }
  const box = (x, y, text, fill, stroke, dash) =>
    `<rect x="${x}" y="${y}" width="232" height="34" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dash ? ' stroke-dasharray="5 4"' : ''}/>` +
    `<text x="${x + 116}" y="${y + 22}" font-size="12" fill="${INK}" text-anchor="middle">${esc(text)}</text>`;
  const note = (x, y, text) => `<text x="${x}" y="${y}" font-size="11" fill="${MUTED}" text-anchor="middle">${esc(text)}</text>`;
  // panel 1: three identical copies
  for (let i = 0; i < 3; i++) o.push(box(44, 60 + i * 46, 'the rule, as written here', '#f3f4f6', GREY, false));
  o.push(note(160, 205, 'same decision, three spots'));
  // panel 2: one changed, two left behind
  o.push(box(364, 60, 'the rule, changed', '#eef4fd', BLUE, false));
  o.push(box(364, 106, 'the rule, old', '#f3f4f6', ORANGE, true));
  o.push(box(364, 152, 'the rule, old', '#f3f4f6', ORANGE, true));
  o.push(note(480, 205, 'two copies left at the edge'));
  // panel 3: changed kept, two now read from it
  o.push(box(684, 60, 'the rule, changed', '#eef4fd', BLUE, false));
  o.push(box(684, 106, 'reads the rule above', '#ffffff', GREY, true));
  o.push(box(684, 152, 'reads the rule above', '#ffffff', GREY, true));
  o.push(`<line x1="800" y1="96" x2="800" y2="104" stroke="${MUTED}" stroke-width="1.4" marker-end="url(#ar3)"/>`);
  o.push(`<line x1="800" y1="142" x2="800" y2="150" stroke="${MUTED}" stroke-width="1.4" marker-end="url(#ar3)"/>`);
  o.push(note(800, 205, 'copies gathered'));
  o.push(`<text x="20" y="${H - 12}" font-size="11" fill="${MUTED}">A drawing, not data. Blue: the changed place. Dashed orange: a copy left behind. Dashed grey: a copy that now reads the changed place.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 4: adding an owner beside the copies, or finishing (a drawing, no data) ----------
function ownerOrFinishingFigure() {
  const W = 960, H = 300;
  const o = [svgOpen(W, H, 'Two panels. Left: a new owner added beside three old copies that stay, read mixed. Right: one owner with the copies deleted, read better. A drawing of the hypothesis from eleven cases, not data.')];
  const panel = (x, title) => {
    o.push(`<rect x="${x}" y="20" width="450" height="250" rx="8" fill="#fbfbfc" stroke="${RULE}" stroke-width="1.2"/>`);
    o.push(`<text x="${x + 16}" y="44" font-size="13" font-weight="600" fill="${INK}">${esc(title)}</text>`);
  };
  const box = (x, y, w, text, fill, stroke, dash) =>
    `<rect x="${x}" y="${y}" width="${w}" height="40" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${dash ? ' stroke-dasharray="5 4"' : ''}/>` +
    `<text x="${x + w / 2}" y="${y + 24}" font-size="12" fill="${INK}" text-anchor="middle">${esc(text)}</text>`;
  const pill = (x, y, text, fill) =>
    `<rect x="${x}" y="${y}" width="120" height="28" rx="14" fill="${fill}"/>` +
    `<text x="${x + 60}" y="${y + 19}" font-size="12" fill="#fff" text-anchor="middle" font-family="${MONO}">${esc(text)}</text>`;
  // Layout guard: the lowest box's top and the caption's y, kept as constants so the assert below can check them.
  const LOWEST_BOX_Y = 170, BOX_H = 40, CAPTION_Y = 234;
  assert.ok(CAPTION_Y > LOWEST_BOX_Y + BOX_H, 'figure 4: caption sits below the lowest box');
  panel(20, 'Adding an owner beside the copies');
  o.push(box(44, 78, 190, 'new owner', '#eef4fd', BLUE, false));
  o.push(box(264, 78, 180, 'old copy', '#f3f4f6', GREY, false));
  o.push(box(264, 124, 180, 'old copy', '#f3f4f6', GREY, false));
  o.push(box(264, LOWEST_BOX_Y, 180, 'old copy', '#f3f4f6', GREY, false));
  o.push(pill(44, 150, 'mixed', GREY));
  // caption sits below the lowest box (the third old copy spans y 170 to 210)
  o.push(`<text x="44" y="${CAPTION_Y}" font-size="11" fill="${MUTED}">The new owner sits beside the copies it leaves running.</text>`);
  panel(490, 'Finishing: the copies deleted');
  o.push(box(514, 78, 190, 'one owner', '#eef4fd', BLUE, false));
  o.push(`<text x="514" y="146" font-size="11" fill="${MUTED}">The copies are gone; nothing is left</text>`);
  o.push(`<text x="514" y="162" font-size="11" fill="${MUTED}">beside the owner to disagree with it.</text>`);
  o.push(pill(514, 180, 'better', BLUE));
  o.push(`<text x="20" y="${H - 12}" font-size="11" fill="${MUTED}">A drawing, not data: the hypothesis from eleven cases.</text>`);
  o.push('</svg>');
  return o.join('\n') + '\n';
}

const outFiles = {
  'two-pipelines.svg': twoPipelinesFigure(),
  'copy-at-the-edge.svg': copyAtEdgeFigure(),
  'owner-or-finishing.svg': ownerOrFinishingFigure(),
  'area-readings-and-pairs.svg': areaAndPairFigure(),
  'census-by-merge.svg': censusFigure(),
};
for (const [name, svg] of Object.entries(outFiles)) writeFileSync(`${OUT}/${name}`, svg);
console.log(`written ${Object.keys(outFiles).length} figures to ${OUT}`);
