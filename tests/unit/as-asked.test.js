/**
 * Unit tests for lib/as-asked.js (LIN-4351, piece A of LIN-4345).
 *
 * The `## As asked` block holds the description as filed, byte for byte. These
 * tests pin its fixed shape (seal), how a description splits around it, how its
 * two marker lines are found (after normalizeEscaping, so Linear's backslash
 * escapes still match), the edit check piece B's proxy guard uses, and the fact
 * reader every code-read line goes through ("below the block wins").
 *
 * Run with: node --test tests/unit/as-asked.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  AS_ASKED_HEADING,
  AS_ASKED_END,
  sealAsAsked,
  splitAsAsked,
  checkAsAsked,
  readFact,
  hasMarkerLine,
} from '../../lib/as-asked.js';

// Spelled out here on purpose, once: the test pins the shape the module owns.
// Production code must import the constants, never repeat these strings.
const HEADING = '## As asked';
const END = '*End of what was asked. Steps write below this line; nothing above it changes.*';

// How Linear stores the same two lines: markdown punctuation backslash-escaped.
const LINEAR_HEADING = '\\#\\# As asked';
const LINEAR_END = '\\*End of what was asked\\. Steps write below this line; nothing above it changes\\.\\*';

const DUE = /plan-review due:\**[ \t]*(yes|no)\b/i;
const readDue = (text) => (text.match(DUE)?.[1] || '').toLowerCase() || null;

describe('markers', () => {
  test('the module exports the two marker lines exactly', () => {
    assert.strictEqual(AS_ASKED_HEADING, HEADING);
    assert.strictEqual(AS_ASKED_END, END);
  });
});

describe('sealAsAsked', () => {
  test('writes the fixed shape: heading, blank, body byte for byte, blank, end sentence', () => {
    const body = 'Please write a full guide on how to properly configure it.\n\n- one\n- two';
    assert.strictEqual(sealAsAsked(body), `${HEADING}\n\n${body}\n\n${END}`);
  });

  test('keeps the body byte for byte: escapes, trailing spaces, CRLF and leading blank lines untouched', () => {
    const body = '\n\\#\\# Not a heading  \r\nline with \\*stars\\*\t\n';
    const sealed = sealAsAsked(body);
    assert.ok(sealed.startsWith(`${HEADING}\n\n`));
    assert.ok(sealed.endsWith(`\n\n${END}`));
    assert.strictEqual(sealed.slice(HEADING.length + 2, sealed.length - END.length - 2), body);
  });

  test('null and undefined seal as an empty body (the caller decides whether to seal)', () => {
    assert.strictEqual(sealAsAsked(undefined), `${HEADING}\n\n\n\n${END}`);
    assert.strictEqual(sealAsAsked(null), `${HEADING}\n\n\n\n${END}`);
  });
});

describe('splitAsAsked', () => {
  test('a sealed body splits back to its exact words with nothing below', () => {
    const body = 'Fix the login.\n\n## Current\nThe person wrote this heading.';
    const parts = splitAsAsked(sealAsAsked(body));
    assert.strictEqual(parts.words, body);
    assert.strictEqual(parts.below, '');
    assert.strictEqual(parts.before, '');
  });

  test('round-trips odd bodies byte for byte (leading/trailing blank lines, empty body)', () => {
    for (const body of ['', '\n', '\n\nx\n\n', 'a\r\nb', '  indented\n']) {
      assert.strictEqual(splitAsAsked(sealAsAsked(body)).words, body, JSON.stringify(body));
    }
  });

  test('returns the text below the block, and offsets that bound the block', () => {
    const sealed = sealAsAsked('The ask.');
    const desc = `${sealed}\n\n## Implementation Plan\n\nStep one.`;
    const parts = splitAsAsked(desc);
    assert.strictEqual(parts.words, 'The ask.');
    assert.strictEqual(parts.below, '\n\n## Implementation Plan\n\nStep one.');
    assert.strictEqual(parts.start, 0);
    assert.strictEqual(parts.end, sealed.length);
    assert.strictEqual(desc.slice(parts.start, parts.end), sealed);
    assert.strictEqual(desc.slice(parts.end), parts.below);
  });

  test('no block is a distinct result (null), not an empty split', () => {
    assert.strictEqual(splitAsAsked('Just a plain description.'), null);
    assert.strictEqual(splitAsAsked(''), null);
    assert.strictEqual(splitAsAsked(null), null);
    assert.strictEqual(splitAsAsked(undefined), null);
  });

  test('a heading with no end line is not a block', () => {
    assert.strictEqual(splitAsAsked(`${HEADING}\n\nThe ask, never closed.`), null);
  });

  test('an end line with no heading before it is not a block', () => {
    assert.strictEqual(splitAsAsked(`The ask.\n\n${END}\n\n${HEADING}`), null);
  });

  test('marker lines must be exact: a near miss is not a marker', () => {
    assert.strictEqual(splitAsAsked(`## As asked:\n\nx\n\n${END}`), null);
    assert.strictEqual(splitAsAsked(`### As asked\n\nx\n\n${END}`), null);
    assert.strictEqual(splitAsAsked(`${HEADING}\n\nx\n\n${END} (edited)`), null);
    assert.strictEqual(splitAsAsked(`Intro ## As asked\n\nx\n\n${END}`), null);
  });

  test('the block runs to the FIRST end line after the heading', () => {
    const desc = `${sealAsAsked('ask')}\n\nbelow\n\n${END}\n\nmore`;
    const parts = splitAsAsked(desc);
    assert.strictEqual(parts.words, 'ask');
    assert.strictEqual(parts.below, `\n\nbelow\n\n${END}\n\nmore`);
  });

  test('text above the heading is reported as before, not as the block', () => {
    const desc = `Preamble.\n\n${sealAsAsked('ask')}\n\nbelow`;
    const parts = splitAsAsked(desc);
    assert.strictEqual(parts.before, 'Preamble.\n\n');
    assert.strictEqual(parts.words, 'ask');
    assert.strictEqual(parts.below, '\n\nbelow');
  });

  test('a Linear-escaped block is found: marker lines compare after normalizeEscaping', () => {
    // Linear stores `## As asked` as `\#\# As asked`. Detection compares the marker
    // lines normalised; the words come back as STORED (escapes kept), byte for byte.
    const words = 'Write a \\*full\\* guide\\.';
    const desc = `${LINEAR_HEADING}\n\n${words}\n\n${LINEAR_END}\n\nbelow`;
    const parts = splitAsAsked(desc);
    assert.ok(parts, 'escaped block should be detected');
    assert.strictEqual(parts.words, words);
    assert.strictEqual(parts.below, '\n\nbelow');
  });

  test('CRLF line endings still find both marker lines', () => {
    const desc = `${HEADING}\r\n\r\nask\r\n\r\n${END}\r\nbelow`;
    const parts = splitAsAsked(desc);
    assert.ok(parts, 'CRLF block should be detected');
    assert.strictEqual(parts.below, '\r\nbelow');
  });
});

describe('checkAsAsked', () => {
  const live = `${sealAsAsked('Line one.\nLine two.')}\n\nPlan below.`;

  test('an edit that kept the block (changing only text below) is ok', () => {
    const next = `${sealAsAsked('Line one.\nLine two.')}\n\nA different plan.`;
    assert.deepStrictEqual(checkAsAsked(live, next), { ok: true, kind: 'kept' });
  });

  test('re-escaping the kept block is still ok (both sides compared normalised)', () => {
    const next = `${LINEAR_HEADING}\n\nLine one\\.\nLine two\\.\n\n${LINEAR_END}\n\nPlan below.`;
    assert.deepStrictEqual(checkAsAsked(live, next), { ok: true, kind: 'kept' });
  });

  test('an edit that changed one character inside the block is refused and names the line', () => {
    const next = `${sealAsAsked('Line one.\nLine 2.')}\n\nPlan below.`;
    const result = checkAsAsked(live, next);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.kind, 'changed');
    assert.deepStrictEqual(result.line, { number: 2, expected: 'Line two.', actual: 'Line 2.' });
  });

  test('an edit that dropped a line from the block names the first missing line', () => {
    const next = `${sealAsAsked('Line one.')}\n\nPlan below.`;
    const result = checkAsAsked(live, next);
    assert.strictEqual(result.kind, 'changed');
    assert.deepStrictEqual(result.line, { number: 2, expected: 'Line two.', actual: null });
  });

  test('an edit that removed the block is refused', () => {
    const result = checkAsAsked(live, 'Line one.\nLine two.\n\nPlan below.');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.kind, 'removed');
  });

  test('an edit that adds a block to an unsealed ticket is refused (no forging the words)', () => {
    const result = checkAsAsked('Plain ticket.', sealAsAsked('Plain ticket.'));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.kind, 'added');
  });

  test('an unsealed ticket edited without a block is ok', () => {
    assert.deepStrictEqual(checkAsAsked('Plain.', 'Plain, edited.'), { ok: true, kind: 'none' });
    assert.deepStrictEqual(checkAsAsked(null, 'New.'), { ok: true, kind: 'none' });
  });
});

describe('readFact', () => {
  const block = sealAsAsked('Child slice.\n\n**Plan-review due:** no — covered by the parent');

  test('below the block wins over the block', () => {
    const desc = `${block}\n\n## Implementation Plan\n\nplan-review due: yes`;
    assert.strictEqual(readFact(desc, readDue), 'yes');
  });

  test('falls back to the block when the text below lacks the fact', () => {
    assert.strictEqual(readFact(block, readDue), 'no');
    assert.strictEqual(readFact(`${block}\n\nSome notes, no due line.`, readDue), 'no');
  });

  test('an unsealed ticket reads its whole description, as today', () => {
    const desc = 'plan-review due: no\n\nlater: plan-review due: yes';
    assert.strictEqual(readFact(desc, readDue), readDue(desc));
    assert.strictEqual(readFact(desc, readDue), 'no');
  });

  test('block yes, below no reads no: a negative answer below is not absence', () => {
    const desc = `${sealAsAsked('plan-review due: yes')}\n\nplan-review due: no`;
    assert.strictEqual(readFact(desc, readDue), 'no');
    // A reader whose negative answer is `false` (and absence `null`) must keep it.
    const dueBool = (t) => { const m = t.match(DUE); return m ? m[1].toLowerCase() === 'yes' : null; };
    assert.strictEqual(readFact(desc, dueBool), false);
    assert.strictEqual(readFact(sealAsAsked('plan-review due: yes'), dueBool), true);
  });

  test('only null and undefined count as absent below; false is an answer', () => {
    const maybe = (t) => (t.includes('needle') ? 'found' : undefined);
    assert.strictEqual(readFact(sealAsAsked('needle'), maybe), 'found');
    const orNull = (t) => (t.includes('needle') ? 'found' : null);
    assert.strictEqual(readFact(sealAsAsked('needle'), orNull), 'found');
    // A presence predicate says "absent" with null, not false (see readFact's doc).
    const has = (t) => /needle/.test(t) || null;
    assert.strictEqual(readFact(sealAsAsked('needle'), has), true);
    assert.strictEqual(readFact(`${sealAsAsked('hay')}\n\nhay`, has), null);
    assert.strictEqual(readFact(`${sealAsAsked('needle')}\n\nhay`, (t) => /needle/.test(t)), false);
  });

  test('text above a block reads with the text below, ahead of the block', () => {
    const desc = `plan-review due: yes\n\n${block}`;
    assert.strictEqual(readFact(desc, readDue), 'yes');
  });

  test('`after` text (a plan comment) reads with the text below, ahead of the block', () => {
    const block = sealAsAsked('plan-review due: no');
    assert.strictEqual(readFact(block, readDue, { after: 'plan-review due: yes' }), 'yes');
    assert.strictEqual(readFact(block, readDue, { after: 'no line here' }), 'no');
    // Unsealed: the description then the after text, joined as callers joined them before.
    const seen = [];
    readFact('desc', (t) => { seen.push(t); return null; }, { after: 'comment' });
    assert.deepStrictEqual(seen, ['desc\n\ncomment']);
  });

  test('an empty or missing description is read as the empty string', () => {
    assert.strictEqual(readFact(undefined, readDue), null);
    assert.strictEqual(readFact('', (t) => t), '');
  });
});

describe('hasMarkerLine', () => {
  test('finds either marker line, raw or Linear-escaped', () => {
    assert.strictEqual(hasMarkerLine(`intro\n${HEADING}\nmore`), true);
    assert.strictEqual(hasMarkerLine(`intro\n${LINEAR_END}`), true);
    assert.strictEqual(hasMarkerLine(sealAsAsked('x')), true);
  });

  test('is false for ordinary text and near misses', () => {
    assert.strictEqual(hasMarkerLine('## As asked, he said'), false);
    assert.strictEqual(hasMarkerLine('As asked'), false);
    assert.strictEqual(hasMarkerLine(''), false);
    assert.strictEqual(hasMarkerLine(null), false);
  });
});
