/**
 * LIN-4553 (LIN-4546 piece 5): the shared question card carries its own frame (lib/question-record-card.js, `.sess-qcard` in
 * public/style.css), so a host's row around it draws none. Observation's Questions tab (`.obs-ruling`) and Flight Companion's
 * fold (`.fc-decision`) each drew a bordered, padded, filled box around the card, a card in a card; at 390px the second frame
 * took width from options that are already long sentences.
 *
 * The check reads each page's own sheets in the order the page loads them (tests/helpers/css-rules.js) and asks what applies to
 * the host row: no border, no background and no padding. The card's own frame is asserted too, so the one frame is the card's.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, rulesFor, appliedDecls } from '../helpers/css-rules.js';

/** The host row on each page that draws the card, with the sheets that page loads (its renderer's stylesheet list). */
const HOSTS = [
  { page: 'Observation (lib/render-observation.js)', row: '.obs-ruling', sheets: ['/style.css', '/common-actions.css', '/observation.css', '/chat.css'] },
  { page: 'Flight Companion (lib/render-flight-companion.js)', row: '.fc-decision', sheets: ['/style.css', '/common-actions.css', '/chat.css', '/flight-companion.css'] },
];

const FRAME = /^(border(-(top|right|bottom|left))?(-(width|style|color))?|background(-color)?|padding(-(top|right|bottom|left))?|box-shadow)$/;

describe('one frame per question card: the host row draws none (LIN-4553)', () => {
  for (const { page, row, sheets } of HOSTS) {
    test(`${page}: ${row} has no border, background or padding of its own`, () => {
      const parsed = readSheets(sheets);
      const framing = rulesFor(parsed, row).length
        ? [...appliedDecls(parsed, row).entries()].filter(([prop, value]) => FRAME.test(prop) && !/^(0|none|transparent)$/.test(String(value).trim()))
        : [];
      assert.deepEqual(framing, [], `${row} frames the card: ${framing.map(([p, v]) => `${p}: ${v}`).join('; ')}`);
    });

    test(`${page}: the card itself keeps its frame`, () => {
      const card = appliedDecls(readSheets(sheets), '.sess-qcard');
      assert.ok(card.get('border') || card.get('border-left-width'), 'the card draws its own border');
      assert.ok(card.get('background'), 'the card draws its own background');
    });
  }
});
