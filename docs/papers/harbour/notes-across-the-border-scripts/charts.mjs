// Generates the five figures for docs/papers/harbour/notes-across-the-border.md (version 2, LIN-4484).
//   figure 1 how two lanes are wired (drawing), figure 2 eleven notes (data), figure 3 four lanes (data),
//   figure 4 a note that gets read (drawing), figure 5 line or network (drawing).
//   node docs/papers/harbour/notes-across-the-border-scripts/charts.mjs docs/papers/harbour/figures/notes-across-the-border && npm run figures:theme
//
// Data is read IN PLACE from the paper's evidence folder (lanes-across-the-seam-evidence/), located relative
// to this file. Nothing is copied into this folder.
//   census.json   directed_messages (the eleven notes one lane wrote to the other), merged_prs_by_lane,
//                 shared_files_by_lane_pair, files_changed, files_changed_by_more_than_one_lane
//   prs.json      the merge time of the change that went ahead on its fallback (#2432)
//   issues/LIN-4447.json  when the Runs lane closed (completedAt)
//   issues/LIN-4468.json  John's ruling on the border at 22:00 (comment 24e376c1)
// One event sits outside that folder: the Prompts lane's last step (PR #2457, commit 06a7da871, 14 Nov 10:52Z),
// read from `git show 06a7da871` (docs/areas/areas.json and docs/areas/runs-and-dispatch.md).
// Every value plotted is asserted below; a changed input fails the script instead of drawing a different claim.
// The essay calls the lanes by plain names: "Runs" is Runs & dispatch (LIN-4447), "Prompts" is LLM & prompts (LIN-4448).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const EVIDENCE = new URL('../lanes-across-the-seam-evidence/', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, EVIDENCE), 'utf8'));
const OUT = process.argv[2] || '.';
const MONO = 'JetBrains Mono, ui-monospace, monospace';
const SANS = 'Inter, system-ui, sans-serif';
const BLUE = '#2a78d6', ORANGE = '#eb6834', GREY = '#9ca3af', MUTED = '#6b7280', INK = '#111827', RULE = '#e5e7eb';
// MARK: a dark fill the dark theme lifts to a mid grey (scripts/lib/figure-theme.mjs DARK_DATA_FILLS); INK fills would vanish.
const MARK = '#1f2937';
const PANEL = '#f9fafb', BOX = '#f3f4f6', BLUE_TINT = '#dbeafe', WARM_TINT = '#fff7ed';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svgOpen = (W, H, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}" font-size="12" role="img" aria-label="${esc(label)}">` +
  `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
const marker = (id, color) =>
  `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="${color}"/></marker>`;
const text = (x, y, s, { size = 12, fill = INK, weight, anchor, family, style } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${weight ? ` font-weight="${weight}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''}${family ? ` font-family="${family}"` : ''}${style ? ` font-style="${style}"` : ''}>${esc(s)}</text>`;
const lines = (x, y, arr, opts = {}, lh = 15) => arr.map((s, i) => text(x, y + i * lh, s, opts)).join('');

// ---------- data, with assertions ----------
const census = read('census.json');
const RUNS = 'Runs & dispatch', PROMPTS = 'LLM & prompts', FRONT = 'Front end', JIRA = 'Jira';
const notes = census.directed_messages;
assert.equal(notes.length, 11, 'eleven notes written by one lane to the other');
assert.ok(notes.every(n => [RUNS, PROMPTS].includes(n.writer)), 'every note was written by the Runs or the Prompts lane');
assert.ok(notes.every(n => (n.writer === RUNS ? n.posted_on === 'LIN-4448' : n.posted_on === 'LIN-4447')),
  "every note sits on the other lane's parent ticket");
assert.deepEqual(notes.map(n => n.id),
  ['d3ba7421', '08c9c898', '097a3442', '1a2e7cba', '0510ffe0', 'b564445b', '15de14a7', 'b555094d', '3300ab65', '36a9d8e0', '29848ba2'],
  'the eleven notes, in time order');
const asked = notes.filter(n => n.asks_for_reply);
assert.equal(asked.length, 5, 'five notes asked for an answer');
assert.deepEqual(asked.filter(n => n.answered_by).map(n => n.id), ['d3ba7421'], 'one of the five was answered');
assert.equal(notes[0].answered_by, '08c9c898', 'the proposal was answered by the agreement');
assert.deepEqual(notes.filter(n => n.cited_by_receiving_lane.length).map(n => n.id), ['08c9c898', '097a3442'],
  'the agreement and the correction are the two notes the receiving lane later cites');
assert.equal(notes.filter(n => !n.heading.startsWith('## ')).length, 1, 'one note of the eleven carries no heading');
const hhmm = n => n.at.slice(11, 16);
assert.deepEqual(notes.map(hhmm), ['13:36', '15:39', '15:55', '16:42', '16:42', '17:06', '21:49', '21:58', '09:17', '09:17', '09:17']);
assert.ok(notes.slice(0, 8).every(n => n.at.startsWith('2026-11-13')) && notes.slice(8).every(n => n.at.startsWith('2026-11-14')));

const prs = read('prs.json');
const fallbackMerge = prs.find(p => p.number === 2432);
assert.equal(fallbackMerge.mergedAt.slice(0, 16), '2026-11-13T17:12', 'the Runs change merged at 17:12, six minutes after its last note');
assert.equal(fallbackMerge.lane, RUNS);
const runsClosed = read('issues/LIN-4447.json').completedAt;
assert.equal(runsClosed.slice(0, 16), '2026-11-14T09:02', 'the Runs lane closed at 09:02 on 14 November');
const ruling = read('issues/LIN-4468.json').comments.find(c => c.id.startsWith('24e376c1'));
assert.ok(ruling.body.startsWith('Allow the store change'), "John's ruling on the border: 'Allow the store change'");
assert.equal(ruling.createdAt.slice(0, 16), '2026-11-13T22:00', 'John ruled at 22:00 on 13 November');

assert.equal(census.merged_prs, 29);
assert.deepEqual(census.merged_prs_by_lane, { [FRONT]: 6, [JIRA]: 4, [PROMPTS]: 7, [RUNS]: 12 });
assert.equal(census.files_changed, 353);
assert.equal(census.files_changed_by_more_than_one_lane, 48);
const shared = census.shared_files_by_lane_pair;
assert.deepEqual(shared, {
  'Front end + Jira': 5, 'Front end + LLM & prompts': 8, 'Front end + Runs & dispatch': 10,
  'Jira + LLM & prompts': 15, 'Jira + Runs & dispatch': 13, 'LLM & prompts + Runs & dispatch': 29,
});

// ---------- figure 1: how two lanes are wired (a drawing, no data) ----------
function wiringFigure() {
  const W = 960, H = 560;
  const o = [svgOpen(W, H, 'Two lanes side by side with a border between them. In each lane a driver agent and its step agents exchange live messages, up and down, and questions go up to the person. Across the border there is only a note left on the other lane\'s ticket, read when that lane\'s next agent starts, and the shared code, tested at every merge. The two drivers could message each other but neither knows the other\'s address. A drawing, not data.')];
  o.push(`<defs>${marker('w-blue', BLUE)}${marker('w-orange', ORANGE)}${marker('w-grey', MUTED)}</defs>`);
  o.push(text(20, 28, 'Two lanes, side by side: what can reach whom', { size: 14, weight: 600 }));
  // the person
  o.push(`<rect x="340" y="48" width="280" height="50" rx="8" fill="${BOX}" stroke="${GREY}" stroke-width="1.4"/>`);
  o.push(text(480, 69, 'John', { size: 13, weight: 600, anchor: 'middle' }));
  o.push(text(480, 87, 'settles what only a person can decide', { size: 11.5, fill: MUTED, anchor: 'middle' }));
  const LX = 30, RX = 570, PW = 360, PY = 128, PH = 318;
  const lane = (x, name, sub) => {
    o.push(`<rect x="${x}" y="${PY}" width="${PW}" height="${PH}" rx="10" fill="${PANEL}" stroke="${RULE}" stroke-width="1.4"/>`);
    o.push(text(x + 18, PY + 26, name, { size: 13.5, weight: 600 }));
    o.push(text(x + 18, PY + 44, sub, { size: 11.5, fill: MUTED }));
    const bx = x + 40, bw = PW - 80;
    const box = (y, t, s, fill, stroke) => {
      o.push(`<rect x="${bx}" y="${y}" width="${bw}" height="50" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`);
      o.push(text(bx + 14, y + 21, t, { size: 12.5, weight: 600 }));
      o.push(text(bx + 14, y + 39, s, { size: 11.5, fill: MUTED }));
    };
    box(PY + 62, 'Driver agent', 'hands out the steps, one at a time', BLUE_TINT, BLUE);
    box(PY + 152, 'Step agents', 'look, plan, build, review; each starts fresh', BLUE_TINT, BLUE);
    box(PY + 242, 'The lane\'s tickets', 'every agent reads the notes here first', WARM_TINT, ORANGE);
    // live messages, up and down
    const ax = x + PW / 2;
    o.push(`<line x1="${ax}" y1="${PY + 116}" x2="${ax}" y2="${PY + 148}" stroke="${BLUE}" stroke-width="2" marker-start="url(#w-blue)" marker-end="url(#w-blue)"/>`);
    o.push(text(ax + 12, PY + 136, 'live messages', { size: 11, fill: MUTED }));
    o.push(`<line x1="${ax}" y1="${PY + 206}" x2="${ax}" y2="${PY + 238}" stroke="${MUTED}" stroke-width="1.4" marker-start="url(#w-grey)" marker-end="url(#w-grey)"/>`);
    o.push(text(ax + 12, PY + 226, 'reads, then writes', { size: 11, fill: MUTED }));
  };
  lane(LX, 'Runs lane', 'the code that starts agent runs and tracks them');
  lane(RX, 'Prompts lane', 'the code that writes each agent\'s instructions');
  // person to each lane: questions up, rulings down
  o.push(`<path d="M336 73 L210 73 L210 ${PY - 4}" fill="none" stroke="${MUTED}" stroke-width="1.6" marker-start="url(#w-grey)" marker-end="url(#w-grey)"/>`);
  o.push(`<path d="M624 73 L750 73 L750 ${PY - 4}" fill="none" stroke="${MUTED}" stroke-width="1.6" marker-start="url(#w-grey)" marker-end="url(#w-grey)"/>`);
  o.push(text(198, 104, 'questions up, rulings down', { size: 11, fill: MUTED, anchor: 'end' }));
  o.push(text(762, 104, 'questions up, rulings down', { size: 11, fill: MUTED }));
  // the border
  o.push(`<line x1="480" y1="${PY - 6}" x2="480" y2="${PY + PH + 6}" stroke="${GREY}" stroke-width="1.6" stroke-dasharray="3 6"/>`);
  o.push(`<rect x="432" y="${PY - 2}" width="96" height="20" fill="#fff"/>`);
  o.push(text(480, PY + 12, 'the border', { size: 11.5, fill: INK, weight: 600, anchor: 'middle' }));
  // driver to driver: possible, unused
  const dy = PY + 87;
  o.push(`<line x1="${LX + PW - 40 + 4}" y1="${dy}" x2="${RX + 40 - 4}" y2="${dy}" stroke="${GREY}" stroke-width="1.6" stroke-dasharray="2 5"/>`);
  o.push(`<rect x="408" y="${dy - 50}" width="144" height="40" fill="#fff"/>`);
  o.push(lines(480, dy - 36, ['could send, never has:', 'neither knows the other\'s', 'address'], { size: 10.5, fill: MUTED, anchor: 'middle' }, 13));
  // the one way across: a note on the other lane's ticket (elbow from Runs' step agents to Prompts' tickets)
  const sy = PY + 177, ty = PY + 267;
  o.push(`<path d="M${LX + PW - 40 + 4} ${sy} L462 ${sy} L462 ${ty} L${RX + 40 - 6} ${ty}" fill="none" stroke="${ORANGE}" stroke-width="2" stroke-dasharray="7 5" marker-end="url(#w-orange)"/>`);
  o.push(`<rect x="470" y="${sy + 8}" width="96" height="62" fill="#fff"/>`);
  o.push(lines(474, sy + 22, ['the one way', 'across: a note', 'left to be found', '(either direction)'], { size: 10.5, fill: INK }, 13));
  // the shared code
  const gy = PY + PH + 24;
  o.push(`<rect x="${LX}" y="${gy}" width="${RX + PW - LX}" height="40" rx="8" fill="${BOX}" stroke="${GREY}" stroke-width="1.4"/>`);
  o.push(text(480, gy + 25, 'The shared code: every change, from either lane, is tested when it merges', { size: 12.5, weight: 600, anchor: 'middle' }));
  o.push(text(20, H - 30, 'A drawing, not data. Blue: messages that reach an agent while it works. All of them run up and down, inside one lane.', { size: 11, fill: MUTED }));
  o.push(text(20, H - 14, 'Orange dashed: the only way across, a note that waits on the other lane\'s ticket until that lane\'s next agent starts.', { size: 11, fill: MUTED }));
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 2: eleven notes across the border (data) ----------
function notesFigure() {
  const W = 960, xL = 300, xR = 620, xOut = 648, ROW = 46, TOP = 118;
  // One row per note, in time order; the three reports of 09:17 share a row. Events that are not notes are rows too.
  const kind = n => (n.answered_by || n.cited_by_receiving_lane.length ? 'taken' : n.asks_for_reply ? 'unanswered' : 'unasked');
  const LABELS = {
    d3ba7421: ['Three moves proposed: "reply … with agree"', 'answered at 15:39'],
    '08c9c898': ['"Agree to all three"', 'Runs builds on it'],
    '097a3442': ['A correction: "That was wrong."', 'Runs builds on it'],
    '1a2e7cba': ['The ask renewed, with a new detail', 'no reply on record'],
    '0510ffe0': ['"Please confirm … before the PR merges"', 'no reply on record'],
    b564445b: ['An addition to that ask', 'no reply on record'],
    '15de14a7': ['A heads-up: a shared list is changing', 'no answer asked for'],
    b555094d: ['One more file: "say so here"', 'no reply on record'],
  };
  assert.deepEqual(Object.keys(LABELS).sort(), notes.slice(0, 8).map(n => n.id).sort(), 'a label for each of the first eight notes');
  assert.deepEqual(notes.slice(0, 8).map(kind), ['taken', 'taken', 'taken', 'unanswered', 'unanswered', 'unanswered', 'unasked', 'unanswered']);
  assert.ok(notes.slice(8).every(n => kind(n) === 'unasked' && n.writer === PROMPTS), 'the three reports asked for no answer');
  assert.ok(notes.slice(8).every(n => n.at > runsClosed), 'the three reports were posted after the Runs lane closed');
  const rows = [
    { day: '13 November 2026' },
    ...notes.slice(0, 6).map((n, i) => ({ n, num: `${i + 1}` })),
    { event: 'runs', time: '17:12', label: 'Runs goes ahead, on the fallback it had stated' },
    ...notes.slice(6, 8).map((n, i) => ({ n, num: `${i + 7}` })),
    { event: 'prompts', time: ruling.createdAt.slice(11, 16), label: 'John rules: “Allow the store change”', out: 'the one ruling by a person', outFill: INK },
    { day: '14 November' },
    { event: 'runs', time: runsClosed.slice(11, 16), label: 'The Runs lane closes', close: true },
    { n: notes[8], num: '9–11', triple: true, label: ['Three reports', 'posted to a lane that had closed'] },
    { event: 'prompts', time: '10:52', label: 'Prompts\' last step changes two things on Runs\' side', out: 'nothing posted to Runs' },
  ];
  const H = TOP + rows.length * ROW + 78;
  const COLOR = { taken: BLUE, unanswered: ORANGE, unasked: GREY };
  const o = [svgOpen(W, H, 'Eleven notes between the Runs lane and the Prompts lane on 13 and 14 November, in time order. The first three, a proposal, an agreement and a correction, were answered or taken up. Four later notes that asked for an answer have no reply on record. One heads-up asked for none. John ruled on the border at 22:00. Three reports were posted after the Runs lane had closed.')];
  o.push(`<defs>${marker('n-taken', BLUE)}${marker('n-unanswered', ORANGE)}${marker('n-unasked', GREY)}</defs>`);
  o.push(text(20, 28, 'Eleven notes across the border', { size: 14, weight: 600 }));
  o.push(text(20, 46, 'Every note one lane wrote to the other, 13 and 14 November, in order. Times are UTC.', { size: 11.5, fill: MUTED }));
  // lane heads
  const head = (x, name) => {
    o.push(`<rect x="${x - 70}" y="62" width="140" height="30" rx="8" fill="${BLUE_TINT}" stroke="${BLUE}" stroke-width="1.4"/>`);
    o.push(text(x, 82, name, { size: 12.5, weight: 600, anchor: 'middle' }));
  };
  head(xL, 'Runs lane'); head(xR, 'Prompts lane');
  o.push(text(xOut, 82, '', {}));
  const closeIdx = rows.findIndex(r => r.close);
  const yOf = i => TOP + i * ROW + 20;
  // lifelines: Runs' line is solid until the lane closes, then faint
  o.push(`<line x1="${xL}" y1="92" x2="${xL}" y2="${yOf(closeIdx)}" stroke="${MUTED}" stroke-width="1.4"/>`);
  o.push(`<line x1="${xL}" y1="${yOf(closeIdx)}" x2="${xL}" y2="${yOf(rows.length - 1) + 16}" stroke="${GREY}" stroke-width="1.2" stroke-dasharray="2 5"/>`);
  o.push(`<line x1="${xR}" y1="92" x2="${xR}" y2="${yOf(rows.length - 1) + 16}" stroke="${MUTED}" stroke-width="1.4"/>`);
  rows.forEach((r, i) => {
    const y = yOf(i);
    if (r.day) {
      o.push(`<line x1="20" y1="${y}" x2="${W - 20}" y2="${y}" stroke="${RULE}" stroke-width="1.4"/>`);
      o.push(`<rect x="20" y="${y - 10}" width="${r.day.length * 7.2 + 14}" height="20" fill="#fff"/>`);
      o.push(text(20, y + 4, r.day, { size: 11.5, weight: 600 }));
      return;
    }
    if (r.event) {
      const x = r.event === 'runs' ? xL : xR;
      o.push(text(20, y + 4, r.time, { size: 11.5, fill: MUTED, family: MONO }));
      o.push(`<rect x="${x - 6}" y="${y - 6}" width="12" height="12" rx="2" fill="${MARK}"/>`);
      if (r.event === 'runs') o.push(text(x + 16, y + 4, r.label, { size: 12, weight: 600 }));
      else {
        o.push(`<rect x="${xL + 8}" y="${y - 11}" width="${xR - xL - 24}" height="22" fill="#fff"/>`);
        o.push(text(x - 16, y + 4, r.label, { size: 12, weight: 600, anchor: 'end' }));
      }
      if (r.out) o.push(text(xOut, y + 4, r.out, { size: 11.5, fill: r.outFill || ORANGE, weight: 600 }));
      return;
    }
    const k = kind(r.n), c = COLOR[k];
    const fromRuns = r.n.writer === RUNS;
    const [x1, x2] = fromRuns ? [xL, xR] : [xR, xL];
    const [label, outcome] = r.label || LABELS[r.n.id];
    o.push(text(20, y + 4, hhmm(r.n), { size: 11.5, fill: MUTED, family: MONO }));
    const dash = k === 'unasked' ? ' stroke-dasharray="6 4"' : '';
    const ys = r.triple ? [y - 5, y, y + 5] : [y];
    for (const yy of ys) o.push(`<line x1="${x1}" y1="${yy}" x2="${x2 + (fromRuns ? -3 : 3)}" y2="${yy}" stroke="${c}" stroke-width="${r.triple ? 1.4 : 2}"${dash} marker-end="url(#n-${k})"/>`);
    // number badge at the sending end
    const bw = r.triple ? 38 : 20;
    o.push(`<rect x="${x1 - bw / 2}" y="${y - 10}" width="${bw}" height="20" rx="10" fill="${c}"/>`);
    o.push(text(x1, y + 4, r.num, { size: 11, fill: '#fff', anchor: 'middle', family: MONO }));
    o.push(text((xL + xR) / 2, y - 9 - (r.triple ? 4 : 0), label, { size: 11.5, anchor: 'middle' }));
    o.push(text(xOut, y + 4, outcome, { size: 11.5, fill: k === 'unasked' ? MUTED : c, weight: 600 }));
  });
  // notes 4 to 6 were left on the lane's main ticket (posted_on LIN-4448, asserted above) while its agents worked on smaller ones
  const wrongDoor = rows.map((r, i) => (r.n && ['1a2e7cba', '0510ffe0', 'b564445b'].includes(r.n.id) ? i : -1)).filter(i => i >= 0);
  assert.equal(wrongDoor.length, 3);
  const by1 = yOf(wrongDoor[0]) - 12, by2 = yOf(wrongDoor[2]) + 12, bx = xOut + 132;
  o.push(`<path d="M${bx} ${by1} L${bx + 8} ${by1} L${bx + 8} ${by2} L${bx} ${by2}" fill="none" stroke="${GREY}" stroke-width="1.4"/>`);
  o.push(lines(bx + 18, (by1 + by2) / 2 - 10, ['left on the main ticket,', 'while the lane\'s agents', 'worked on smaller ones'], { size: 10.5, fill: MUTED }, 13));
  const fy = H - 46;
  const key = (x, c, t, dash) => {
    o.push(`<line x1="${x}" y1="${fy - 4}" x2="${x + 26}" y2="${fy - 4}" stroke="${c}" stroke-width="2"${dash ? ' stroke-dasharray="6 4"' : ''}/>`);
    o.push(text(x + 34, fy, t, { size: 11, fill: MUTED }));
  };
  key(20, BLUE, 'answered, or built on by the lane it was sent to');
  key(350, ORANGE, 'asked for an answer; none on record');
  key(620, GREY, 'asked for none; no sign it was read', true);
  o.push(text(20, H - 16, 'Squares are events. Source: lanes-across-the-seam-evidence/census.json (directed_messages), prs.json, issues/LIN-4447.json and LIN-4468.json; commit 06a7da871.', { size: 11, fill: MUTED }));
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 3: where the lanes overlapped, and where they talked (data) ----------
function fourLanesFigure() {
  const W = 960, H = 530;
  const o = [svgOpen(W, H, 'Four lanes drawn as boxes joined by six lines, one for each pair. Line width shows how many files both lanes changed: Runs and Prompts 29, Prompts and Jira 15, Runs and Jira 13, Runs and front end 10, Prompts and front end 8, front end and Jira 5. Only Runs and Prompts wrote notes to each other, eleven of them.')];
  o.push(text(20, 28, 'Where the lanes overlapped, and where they talked', { size: 14, weight: 600 }));
  o.push(text(20, 46, `One day, four lanes: ${census.merged_prs} merged changes to ${census.files_changed} files, of which ${census.files_changed_by_more_than_one_lane} were changed by more than one lane.`, { size: 11.5, fill: MUTED }));
  const NW = 200, NH = 54;
  // Three lanes outside and one in the middle, so no two lines cross.
  const nodes = {
    [RUNS]: { x: 70, y: 96, name: 'Runs lane' },
    [PROMPTS]: { x: 690, y: 96, name: 'Prompts lane' },
    [FRONT]: { x: 380, y: 222, name: 'Front-end lane' },
    [JIRA]: { x: 380, y: 384, name: 'Jira lane' },
  };
  const cx = n => nodes[n].x + NW / 2, cy = n => nodes[n].y + NH / 2;
  // label position: t along the line from a to b, with an offset; the label sits on its line, on a white plate
  const edges = [
    { a: RUNS, b: PROMPTS, key: 'LLM & prompts + Runs & dispatch', t: 0.5, dy: -22, notes: notes.length },
    { a: RUNS, b: JIRA, key: 'Jira + Runs & dispatch', t: 0.56 },
    { a: PROMPTS, b: JIRA, key: 'Jira + LLM & prompts', t: 0.56 },
    { a: RUNS, b: FRONT, key: 'Front end + Runs & dispatch', t: 0.5 },
    { a: PROMPTS, b: FRONT, key: 'Front end + LLM & prompts', t: 0.5 },
    { a: FRONT, b: JIRA, key: 'Front end + Jira', t: 0.5 },
  ];
  assert.deepEqual(edges.map(e => e.key).sort(), Object.keys(shared).sort(), 'one line for each pair of lanes');
  for (const e of edges) {
    const n = shared[e.key], talked = !!e.notes;
    o.push(`<line x1="${cx(e.a)}" y1="${cy(e.a)}" x2="${cx(e.b)}" y2="${cy(e.b)}" stroke="${talked ? BLUE : GREY}" stroke-width="${n * 0.55}" stroke-linecap="round"/>`);
  }
  for (const e of edges) {
    const n = shared[e.key], talked = !!e.notes;
    const x = cx(e.a) + (cx(e.b) - cx(e.a)) * e.t, y = cy(e.a) + (cy(e.b) - cy(e.a)) * e.t + (e.dy || 0) + 4;
    const label = talked ? `${n} files · ${e.notes} notes` : `${n} files · no notes`;
    const w = label.length * 7.3 + 14;
    o.push(`<rect x="${x - w / 2}" y="${y - 15}" width="${w}" height="22" rx="4" fill="#fff"/>`);
    o.push(text(x, y, label, { size: 12, fill: talked ? BLUE : INK, weight: talked ? 600 : undefined, anchor: 'middle', family: MONO }));
  }
  for (const [key, nd] of Object.entries(nodes)) {
    o.push(`<rect x="${nd.x}" y="${nd.y}" width="${NW}" height="${NH}" rx="8" fill="${BOX}" stroke="${GREY}" stroke-width="1.4"/>`);
    o.push(text(nd.x + NW / 2, nd.y + 23, nd.name, { size: 13, weight: 600, anchor: 'middle' }));
    o.push(text(nd.x + NW / 2, nd.y + 41, `${census.merged_prs_by_lane[key]} merged changes`, { size: 11.5, fill: MUTED, anchor: 'middle' }));
  }
  o.push(text(20, H - 46, 'Line width: the files both lanes changed. A file changed by three lanes counts on three lines, so the lines add up to more than 48.', { size: 11, fill: INK }));
  o.push(text(20, H - 30, 'Blue: the one pair that wrote notes to each other. Grey: no notes at all; the shared code and its tests did the coordinating.', { size: 11, fill: MUTED }));
  o.push(text(20, H - 14, 'Source: lanes-across-the-seam-evidence/census.json (shared_files_by_lane_pair, merged_prs_by_lane, directed_messages).', { size: 11, fill: MUTED }));
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 4: a note that gets read (a drawing, no data) ----------
function noteFigure() {
  const W = 960, H = 520;
  const o = [svgOpen(W, H, 'A note card with five numbered parts, and beside it what each part is for and how much of it the lanes already did on 13 November. One: signed, with a heading Harbour recognises. Two: pinned where the reader is working. Three: a default if nobody answers, and a deadline the reader can meet. Four: a bell, sent to the other lane\'s driver. Five: a receipt, where agreed points at the other side\'s own words. A drawing, not data.')];
  o.push(text(20, 28, 'A note that gets read', { size: 14, weight: 600 }));
  o.push(text(20, 46, 'Five small habits. The lanes had part of three of them already.', { size: 11.5, fill: MUTED }));
  const CX = 30, CY = 70, CW = 400, CH = 376;
  o.push(`<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" rx="6" fill="${WARM_TINT}" stroke="${ORANGE}" stroke-width="1.4"/>`);
  o.push(`<circle cx="${CX + CW / 2}" cy="${CY + 2}" r="7" fill="${ORANGE}"/>`);
  const badge = (x, y, n) => `<circle cx="${x}" cy="${y}" r="10" fill="${MARK}"/>` + text(x, y + 4, n, { size: 11, fill: '#fff', anchor: 'middle', family: MONO });
  const tx = CX + 46;
  const rule = y => `<line x1="${CX + 16}" y1="${y}" x2="${CX + CW - 16}" y2="${y}" stroke="${ORANGE}" stroke-width="1" stroke-opacity="0.45"/>`;
  o.push(badge(CX + 24, CY + 36, '1'));
  o.push(text(tx, CY + 40, 'From the Runs lane, for the Prompts lane', { size: 12.5, weight: 600 }));
  o.push(badge(CX + 24, CY + 70, '2'));
  o.push(text(tx, CY + 74, 'Pinned on the ticket you are working on now', { size: 12 }));
  o.push(rule(CY + 92));
  o.push(lines(tx, CY + 118, ['We would like the rule that sorts comments', 'to live on our side.', 'If you would rather keep it, it stays with', 'you and we borrow it. One copy either way.'], { size: 12 }, 17));
  o.push(rule(CY + 188));
  o.push(badge(CX + 24, CY + 212, '3'));
  o.push(lines(tx, CY + 216, ['If we hear nothing once your next step has', 'run, we go ahead with the first option.'], { size: 12 }, 17));
  o.push(rule(CY + 250));
  o.push(badge(CX + 24, CY + 274, '4'));
  o.push(text(tx, CY + 278, 'Also sent to your driver, so it reaches you', { size: 12 }));
  // tear line and receipt
  o.push(`<line x1="${CX}" y1="${CY + 304}" x2="${CX + CW}" y2="${CY + 304}" stroke="${ORANGE}" stroke-width="1.4" stroke-dasharray="5 5"/>`);
  o.push(badge(CX + 24, CY + 334, '5'));
  o.push(lines(tx, CY + 330, ['Receipt: "agreed" means their words,', 'on their ticket, and says where'], { size: 12 }, 17));
  o.push(text(CX, CY + CH + 20, 'The wording is made up for the drawing, after the first note of 13 November.', { size: 11, fill: MUTED }));
  // the five habits
  const RXX = 470;
  const habits = [
    ['◐', 'Signed', 'A heading Harbour recognises, so a lane\'s note is', 'never taken for the person\'s word.', 'Ten of the eleven had a heading. Harbour has no kind for a note between lanes.'],
    ['◐', 'Pinned where the reader is', 'On the ticket the other lane is working on now,', 'not the one at its front door.', 'The first note was. Three later ones were not.'],
    ['◐', 'A default, and a deadline the reader can meet', 'Silence means the default, once the other lane\'s', 'next step has had its chance to object.', 'Three of the five asks said what silence would mean. The deadline was loose.'],
    ['○', 'A bell', 'The driver passes the note to the other lane\'s', 'driver, which can be reached while it works.', 'The drivers had the permission, and not each other\'s address.'],
    ['○', 'A receipt', 'Every "agreed" points at the other side\'s own', 'words; nothing changes on its side unannounced.', 'Nothing checked this.'],
  ];
  habits.forEach(([mark, title, a, b, was], i) => {
    const y = CY + 8 + i * 76;
    o.push(badge(RXX + 10, y + 10, `${i + 1}`));
    o.push(text(RXX + 30, y + 15, title, { size: 13, weight: 600 }));
    o.push(text(RXX + 30, y + 32, a, { size: 11.5, fill: INK }));
    o.push(text(RXX + 30, y + 47, b, { size: 11.5, fill: INK }));
    o.push(text(RXX + 30, y + 64, `${mark}  ${was}`, { size: 11.5, fill: MUTED }));
  });
  o.push(text(20, H - 14, 'A drawing, not data.   ◐ partly there on 13 November   ○ not there yet', { size: 12, fill: MUTED }));
  o.push('</svg>');
  return o.join('\n') + '\n';
}

// ---------- figure 5: a line or a network, and three new ways to go wrong (a drawing, no data) ----------
function networkFigure() {
  const W = 960, H = 520;
  const o = [svgOpen(W, H, 'Top: under today\'s rule work that shares a file takes turns, one piece after another; with notes that work, two lanes run side by side and settle the border as they go. Bottom, three new ways to go wrong: waits, where a question waits as long as the slowest party; knots, where two lanes each hold work and wait for the other; and unseen decisions, where one side decides for both where only it looks. A drawing, not data.')];
  o.push(`<defs>${marker('k-grey', MUTED)}${marker('k-orange', ORANGE)}${marker('k-blue', BLUE)}</defs>`);
  o.push(text(20, 28, 'What it opens, and what it costs', { size: 14, weight: 600 }));
  const panel = (x, y, w, h, title) => {
    o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${PANEL}" stroke="${RULE}" stroke-width="1.2"/>`);
    o.push(text(x + 16, y + 24, title, { size: 13, weight: 600 }));
  };
  const box = (x, y, w, t, fill = BOX, stroke = GREY) =>
    `<rect x="${x}" y="${y}" width="${w}" height="36" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>` + text(x + w / 2, y + 23, t, { size: 12, anchor: 'middle' });
  // top left: taking turns
  panel(20, 46, 450, 172, 'Today\'s rule: work that shares a file takes turns');
  o.push(box(44, 92, 170, 'one side of the tangle'));
  o.push(`<line x1="218" y1="110" x2="270" y2="110" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#k-grey)"/>`);
  o.push(box(276, 92, 170, 'then the other side'));
  o.push(lines(44, 160, ['One lane, one piece after another. Nothing collides,', 'and the second side waits for the first.'], { size: 11.5, fill: MUTED }, 16));
  // top right: side by side
  panel(490, 46, 450, 172, 'With notes that work: side by side');
  o.push(box(514, 92, 170, 'one side of the tangle', BLUE_TINT, BLUE));
  o.push(box(746, 92, 170, 'the other side', BLUE_TINT, BLUE));
  o.push(`<line x1="715" y1="84" x2="715" y2="138" stroke="${GREY}" stroke-width="1.6" stroke-dasharray="3 6"/>`);
  o.push(`<line x1="690" y1="103" x2="740" y2="103" stroke="${ORANGE}" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#k-orange)"/>`);
  o.push(`<line x1="740" y1="117" x2="690" y2="117" stroke="${ORANGE}" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#k-orange)"/>`);
  o.push(lines(514, 160, ['Two lanes at once. The border is settled by note, as the', 'work shows where it should run. Tests still check every merge.'], { size: 11.5, fill: MUTED }, 16));
  // bottom: three new ways to go wrong
  o.push(text(20, 252, 'Three new ways to go wrong', { size: 13, weight: 600 }));
  const PY = 266, PW = 296, PH = 196;
  const small = (x, y, t, fill = BOX, stroke = GREY, w = 64) =>
    `<rect x="${x}" y="${y}" width="${w}" height="30" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>` + text(x + w / 2, y + 20, t, { size: 11.5, anchor: 'middle' });
  // waits
  panel(20, PY, PW, PH, 'Waits');
  o.push(small(40, PY + 44, 'lane A'));
  o.push(`<line x1="108" y1="${PY + 59}" x2="134" y2="${PY + 59}" stroke="${ORANGE}" stroke-width="1.8" marker-end="url(#k-orange)"/>`);
  o.push(small(140, PY + 44, 'lane B'));
  o.push(`<line x1="208" y1="${PY + 59}" x2="234" y2="${PY + 59}" stroke="${ORANGE}" stroke-width="1.8" marker-end="url(#k-orange)"/>`);
  o.push(small(240, PY + 44, 'John', BOX, GREY, 56));
  o.push(lines(40, PY + 104, ['A question waits as long as the slowest', 'party behind it, and that can be a person.'], { size: 11.5 }, 16));
  o.push(lines(40, PY + 150, ['What helps: a default with a deadline,', 'so the asker is never stuck.'], { size: 11.5, fill: MUTED }, 16));
  // knots
  const kx = 20 + PW + 16;
  panel(kx, PY, PW, PH, 'Knots');
  o.push(small(kx + 44, PY + 44, 'lane A'));
  o.push(small(kx + 188, PY + 44, 'lane B'));
  o.push(`<path d="M${kx + 112} ${PY + 52} C ${kx + 136} ${PY + 38}, ${kx + 160} ${PY + 38}, ${kx + 184} ${PY + 52}" fill="none" stroke="${ORANGE}" stroke-width="1.8" marker-end="url(#k-orange)"/>`);
  o.push(`<path d="M${kx + 184} ${PY + 66} C ${kx + 160} ${PY + 80}, ${kx + 136} ${PY + 80}, ${kx + 112} ${PY + 66}" fill="none" stroke="${ORANGE}" stroke-width="1.8" marker-end="url(#k-orange)"/>`);
  o.push(lines(kx + 20, PY + 104, ['Each holds its work and waits for the', 'other. Every wait is reasonable.'], { size: 11.5 }, 16));
  o.push(lines(kx + 20, PY + 150, ['What helps: the same default breaks the', 'circle; so does a check for waiting circles.'], { size: 11.5, fill: MUTED }, 16));
  // unseen decisions
  const ux = kx + PW + 16;
  panel(ux, PY, PW, PH, 'Unseen decisions');
  o.push(small(ux + 24, PY + 44, 'lane A'));
  o.push(`<line x1="${ux + 92}" y1="${PY + 59}" x2="${ux + 150}" y2="${PY + 59}" stroke="${ORANGE}" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#k-orange)"/>`);
  o.push(`<rect x="${ux + 156}" y="${PY + 44}" width="116" height="30" rx="6" fill="#fff" stroke="${GREY}" stroke-width="1.4" stroke-dasharray="4 4"/>`);
  o.push(text(ux + 214, PY + 64, 'B has gone home', { size: 11.5, fill: MUTED, anchor: 'middle' }));
  o.push(lines(ux + 20, PY + 104, ['One side decides for both, in a place', 'where only it looks.'], { size: 11.5 }, 16));
  o.push(lines(ux + 20, PY + 150, ['What helps: a receipt, and a note on the', 'other side\'s ticket even after it closes.'], { size: 11.5, fill: MUTED }, 16));
  o.push(text(20, H - 30, 'A drawing, not data. Orange arrows are waits and notes.', { size: 11, fill: MUTED }));
  o.push(text(20, H - 14, 'The top-right picture is what happened on 13 November; the record does not show the notes were what made it possible.', { size: 11, fill: MUTED }));
  o.push('</svg>');
  return o.join('\n') + '\n';
}

const outFiles = {
  'how-two-lanes-are-wired.svg': wiringFigure(),
  'eleven-notes.svg': notesFigure(),
  'four-lanes.svg': fourLanesFigure(),
  'a-note-that-gets-read.svg': noteFigure(),
  'line-or-network.svg': networkFigure(),
};
mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(outFiles)) writeFileSync(`${OUT}/${name}`, svg);
console.log(`written ${Object.keys(outFiles).length} figures to ${OUT}`);
