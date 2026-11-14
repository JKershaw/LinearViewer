#!/usr/bin/env node
/**
 * Draws the two figures of docs/papers/harbour/nothing-fights-its-shape.md (LIN-4485).
 * Both are drawings, not data: the marks in Figure 1 are the essay's own reading of where
 * each kind of statement is written today, set out in MARKS below.
 *
 *   node docs/papers/harbour/nothing-fights-its-shape-scripts/drawings.mjs
 *   npm run figures:theme        # adds the dark-mode block the Library needs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'figures', 'nothing-fights-its-shape');
mkdirSync(OUT, { recursive: true });

const INK = '#111827', MUTED = '#6b7280', LINE = '#e5e7eb', EDGE = '#9ca3af', PANEL = '#f3f4f6';
// TINT is one the shared figure theme maps to a dark blue in dark mode (scripts/lib/figure-theme.mjs).
const BLUE = '#2a78d6', ORANGE = '#eb6834', TINT = '#dbeafe';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const text = (x, y, s, o = {}) =>
  `<text${o.onFill ? ' data-on-fill="1"' : ''} x="${x}" y="${y}" font-size="${o.size || 12}"${o.bold ? ' font-weight="600"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.rotate ? ` transform="rotate(${o.rotate} ${x} ${y})"` : ''} fill="${o.fill || INK}">${esc(s)}</text>`;
const svg = (w, h, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, system-ui, sans-serif" font-size="12" role="img" aria-label="${esc(label)}"><rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>\n${body.join('\n')}\n</svg>\n`;

// ── Figure 1: the circles, and the same contents sorted by kind ─────────────
const PLACES = ['code', 'test', 'commit', 'code comment', 'ticket', 'its thread', 'note', 'doc', 'prompt', 'log'];
const GROUPS = [
  ['WHAT WAS', [
    ['What happened', ['commit', 'its thread', 'log']],
    ['Why', ['commit', 'code comment', 'its thread', 'note', 'doc']],
    ['What was found', ['its thread', 'note', 'doc']],
  ]],
  ['WHAT IS', [
    ['What is so', ['code']],
  ]],
  ['WHAT IS TO BE', [
    ['What is wanted', ['ticket', 'its thread', 'doc', 'prompt']],
    ['What must hold', ['code', 'test', 'code comment', 'note', 'doc', 'prompt']],
    ['What remains to do', ['code comment', 'ticket', 'its thread', 'note', 'doc']],
  ]],
  ['AND THE COPY', [
    ['A description of what is so', ['code comment', 'ticket', 'its thread', 'note', 'doc', 'prompt'], ORANGE],
  ]],
];

function figure1() {
  const b = [];
  b.push(text(20, 30, 'Named for where it is written', { size: 14, bold: true }));
  for (const [cx, cy] of [[130, 170], [230, 170], [180, 255]]) {
    b.push(`<circle cx="${cx}" cy="${cy}" r="95" fill="${BLUE}" fill-opacity="0.07" stroke="${BLUE}" stroke-width="1.4"/>`);
  }
  b.push(text(20, 70, 'ticket and thread', { size: 13, bold: true }));
  b.push(text(240, 70, 'code comment', { size: 13, bold: true }));
  b.push(text(180, 372, 'code', { size: 13, bold: true, anchor: 'middle' }));
  // Each item sits in the region the grid's marks give it (ticket or its thread; code comment; code).
  const item = (x, y, s) => b.push(text(x, y, s, { size: 11, anchor: 'middle' }));
  item(180, 127, 'a reason'); item(180, 141, 'a description'); item(180, 155, 'a to-do');
  item(228, 229, 'a rule');
  item(82, 150, 'what is wanted'); item(82, 166, 'what happened');
  item(180, 318, 'what is so');
  b.push(text(20, 412, 'Open the circles and the same few things sit in', { fill: MUTED }));
  b.push(text(20, 430, 'two at once. The overlap is the contents, not the edges.', { fill: MUTED }));

  const X0 = 400, COL0 = 596, CW = 35, ROW = 32, HEAD = 22;
  b.push(text(X0, 30, 'Sorted by what is said', { size: 14, bold: true }));
  PLACES.forEach((p, i) => b.push(text(COL0 + i * CW + CW / 2 - 4, 100, p, { size: 11.5, rotate: -45, fill: INK })));
  let y = 108;
  for (const [group, rows] of GROUPS) {
    b.push(`<line x1="${X0}" y1="${y}" x2="${COL0 + PLACES.length * CW}" y2="${y}" stroke="${EDGE}" stroke-width="1"/>`);
    b.push(text(X0, y + 15, group, { size: 10.5, fill: MUTED }));
    y += HEAD;
    for (const [kind, places, colour] of rows) {
      b.push(text(X0, y + ROW / 2 + 4, kind, { size: 12.5 }));
      PLACES.forEach((p, i) => {
        const cx = COL0 + i * CW + CW / 2, cy = y + ROW / 2;
        b.push(places.includes(p)
          ? `<circle cx="${cx}" cy="${cy}" r="6" fill="${colour || BLUE}"/>`
          : `<line x1="${cx - 3}" y1="${cy}" x2="${cx + 3}" y2="${cy}" stroke="${LINE}" stroke-width="2"/>`);
      });
      y += ROW;
      b.push(`<line x1="${X0}" y1="${y}" x2="${COL0 + PLACES.length * CW}" y2="${y}" stroke="${LINE}" stroke-width="1"/>`);
    }
  }
  b.push(text(X0, y + 26, 'A test, a commit or a log, named for what it holds, carries one or two kinds.', { fill: MUTED }));
  b.push(text(X0, y + 44, 'A thread, a note or a doc, named for how it is written, carries five or six; a code comment, four.', { fill: MUTED }));
  return svg(960, y + 62,
    'Left: three overlapping circles labelled ticket and thread, code comment, and code. A reason, a description and a to-do sit where ticket and code comment overlap; a rule sits where code comment and code overlap; what is wanted and what happened sit in the ticket alone, and what is so in the code alone. Right: a grid with the kinds of thing said down the side, in three groups (what was, what is, what is to be) plus the description, and the places they are written across the top: code, test, commit, code comment, ticket, its thread, note, doc, prompt, log. Every kind but one has a mark in several places; test, commit and log carry one or two kinds, code comment four, while thread, note and doc carry five or six. A drawing, not data.',
    b);
}

// ── Figure 2: how one kind becomes another ──────────────────────────────────
function figure2() {
  const b = [];
  b.push('<defs><marker id="nf-ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#6b7280"/></marker></defs>');
  const box = (x, y, w, h, title, sub, tinted) => {
    b.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${tinted ? TINT : PANEL}" stroke="${tinted ? BLUE : EDGE}" stroke-width="1.4"/>`);
    b.push(text(x + 14, y + (sub ? 24 : h / 2 + 4.5), title, { size: 13, bold: true }));
    if (sub) b.push(text(x + 14, y + 42, sub, { size: 11.5, fill: MUTED }));
  };
  const arrow = (x1, y1, x2, y2, dashed) =>
    b.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${MUTED}" stroke-width="1.6"${dashed ? ' stroke-dasharray="4 4"' : ''} marker-end="url(#nf-ar)"/>`);

  b.push(text(20, 30, 'How one kind becomes another', { size: 14, bold: true }));
  box(20, 122, 142, 56, 'Talk', 'where it is first said');
  const settled = [['What is wanted', 60], ['A decision, and why', 108], ['A finding', 156], ['A job: what remains to do', 204]];
  for (const [title, y] of settled) {
    box(200, y, 200, 40, title);
    arrow(164, 150, 196, y + 20);
  }
  box(456, 196, 130, 56, 'A change', 'made once');
  arrow(402, 224, 452, 224);
  box(642, 196, 190, 56, 'What is so', 'the code, as it now runs', true);
  arrow(588, 224, 638, 224);
  box(642, 70, 190, 56, 'What must hold', 'a test or a check', true);
  arrow(402, 166, 638, 100);
  b.push(text(470, 138, 'a lesson becomes a test', { size: 11.5, fill: MUTED, rotate: -15.6 }));

  b.push(`<rect x="20" y="310" width="920" height="46" rx="8" fill="${PANEL}" stroke="${EDGE}" stroke-width="1.4"/>`);
  b.push(text(34, 338, 'What happened: the record.', { size: 13, bold: true }));
  b.push(text(222, 338, 'Dated, added to, never edited.', { size: 12, fill: MUTED }));
  arrow(91, 180, 91, 306, true);
  arrow(300, 246, 300, 306, true);
  arrow(521, 254, 521, 306, true);
  b.push(text(531, 286, 'as each closes, it joins the record', { size: 11.5, fill: MUTED }));

  b.push(`<path d="M886 310 V186 H406" fill="none" stroke="${MUTED}" stroke-width="1.6" marker-end="url(#nf-ar)"/>`);
  b.push(text(880, 178, 'read later, the record gives a new finding', { size: 11.5, fill: MUTED, anchor: 'end' }));

  b.push(text(20, 384, 'A healthy move changes the form and closes the old one.', { fill: INK }));
  b.push(text(20, 402, 'The four troubles: it arrives and never leaves, it stops halfway, it travels by retelling, it is sent where nobody is reading.', { fill: MUTED }));
  return svg(960, 420,
    'A flow. Talk settles into four things: what is wanted, a decision and why, a finding, and a job. A finding can become what must hold: a test or a check. The job becomes a change, and the change becomes what is so: the code. Under them all runs one long bar, the record of what happened, dated and never edited; dashed arrows show the talk, the job and the change joining the record as each closes. One arrow returns from the record to a finding: read later, the record gives a new finding. A drawing, not data.',
    b);
}

writeFileSync(join(OUT, 'circles-and-kinds.svg'), figure1());
writeFileSync(join(OUT, 'how-it-moves.svg'), figure2());
console.log('wrote 2 figures to', OUT);
