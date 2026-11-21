/**
 * Unit tests for the brief quote's shape (lib/brief-quote.js) and the legacy readers over it (lib/asked-of.js).
 * Ported from the As-asked module's own tests (LIN-4351) when LIN-4502 retired that module.
 *
 * The quote holds the task's `asked`, byte for byte. These tests pin its fixed shape (quoteAsked), how a text
 * splits around it (splitQuote), how its two marker lines are found (after normalizeEscaping, so Linear's
 * backslash escapes still match: a description filed before LIN-4502 carries the block in this same shape).
 * LIN-4504 retired the fact reader that read code-read lines around it.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/brief-quote.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ASKED_HEADING, ASKED_END, quoteAsked, splitQuote } from '../../lib/brief-quote.js';

// Spelled out here on purpose, once: the test pins the shape the module owns.
// Production code must import the constants, never repeat these strings.
const HEADING = '## As asked';
const END = '*End of what was asked. Steps write below this line; nothing above it changes.*';

// How Linear stores the same two lines: markdown punctuation backslash-escaped.
const LINEAR_HEADING = '\\#\\# As asked';
const LINEAR_END = '\\*End of what was asked\\. Steps write below this line; nothing above it changes\\.\\*';


describe('markers', () => {
  test('the module exports the two marker lines exactly', () => {
    assert.strictEqual(ASKED_HEADING, HEADING);
    assert.strictEqual(ASKED_END, END);
  });
});

describe('quoteAsked', () => {
  test('writes the fixed shape: heading, blank, body byte for byte, blank, end sentence', () => {
    const body = 'Please write a full guide on how to properly configure it.\n\n- one\n- two';
    assert.strictEqual(quoteAsked(body), `${HEADING}\n\n${body}\n\n${END}`);
  });

  test('keeps the body byte for byte: escapes, trailing spaces, CRLF and leading blank lines untouched', () => {
    const body = '\n\\#\\# Not a heading  \r\nline with \\*stars\\*\t\n';
    const sealed = quoteAsked(body);
    assert.ok(sealed.startsWith(`${HEADING}\n\n`));
    assert.ok(sealed.endsWith(`\n\n${END}`));
    assert.strictEqual(sealed.slice(HEADING.length + 2, sealed.length - END.length - 2), body);
  });

  test('null and undefined seal as an empty body (the caller decides whether to seal)', () => {
    assert.strictEqual(quoteAsked(undefined), `${HEADING}\n\n\n\n${END}`);
    assert.strictEqual(quoteAsked(null), `${HEADING}\n\n\n\n${END}`);
  });
});

describe('splitQuote', () => {
  test('a sealed body splits back to its exact words with nothing below', () => {
    const body = 'Fix the login.\n\n## Current\nThe person wrote this heading.';
    const parts = splitQuote(quoteAsked(body));
    assert.strictEqual(parts.words, body);
    assert.strictEqual(parts.below, '');
    assert.strictEqual(parts.before, '');
  });

  test('round-trips odd bodies byte for byte (leading/trailing blank lines, empty body)', () => {
    for (const body of ['', '\n', '\n\nx\n\n', 'a\r\nb', '  indented\n']) {
      assert.strictEqual(splitQuote(quoteAsked(body)).words, body, JSON.stringify(body));
    }
  });

  test('returns the text below the block, and offsets that bound the block', () => {
    const sealed = quoteAsked('The ask.');
    const desc = `${sealed}\n\n## Notes\n\nStep one.`;
    const parts = splitQuote(desc);
    assert.strictEqual(parts.words, 'The ask.');
    assert.strictEqual(parts.below, '\n\n## Notes\n\nStep one.');
    assert.strictEqual(parts.start, 0);
    assert.strictEqual(parts.end, sealed.length);
    assert.strictEqual(desc.slice(parts.start, parts.end), sealed);
    assert.strictEqual(desc.slice(parts.end), parts.below);
  });

  test('no block is a distinct result (null), not an empty split', () => {
    assert.strictEqual(splitQuote('Just a plain description.'), null);
    assert.strictEqual(splitQuote(''), null);
    assert.strictEqual(splitQuote(null), null);
    assert.strictEqual(splitQuote(undefined), null);
  });

  test('a heading with no end line is not a block', () => {
    assert.strictEqual(splitQuote(`${HEADING}\n\nThe ask, never closed.`), null);
  });

  test('an end line with no heading before it is not a block', () => {
    assert.strictEqual(splitQuote(`The ask.\n\n${END}\n\n${HEADING}`), null);
  });

  test('marker lines must be exact: a near miss is not a marker', () => {
    assert.strictEqual(splitQuote(`## As asked:\n\nx\n\n${END}`), null);
    assert.strictEqual(splitQuote(`### As asked\n\nx\n\n${END}`), null);
    assert.strictEqual(splitQuote(`${HEADING}\n\nx\n\n${END} (edited)`), null);
    assert.strictEqual(splitQuote(`Intro ## As asked\n\nx\n\n${END}`), null);
  });

  test('the block runs to the FIRST end line after the heading', () => {
    const desc = `${quoteAsked('ask')}\n\nbelow\n\n${END}\n\nmore`;
    const parts = splitQuote(desc);
    assert.strictEqual(parts.words, 'ask');
    assert.strictEqual(parts.below, `\n\nbelow\n\n${END}\n\nmore`);
  });

  test('text above the heading is reported as before, not as the block', () => {
    const desc = `Preamble.\n\n${quoteAsked('ask')}\n\nbelow`;
    const parts = splitQuote(desc);
    assert.strictEqual(parts.before, 'Preamble.\n\n');
    assert.strictEqual(parts.words, 'ask');
    assert.strictEqual(parts.below, '\n\nbelow');
  });

  test('a Linear-escaped block is found: marker lines compare after normalizeEscaping', () => {
    // Linear stores `## As asked` as `\#\# As asked`. Detection compares the marker
    // lines normalised; the words come back as STORED (escapes kept), byte for byte.
    const words = 'Write a \\*full\\* guide\\.';
    const desc = `${LINEAR_HEADING}\n\n${words}\n\n${LINEAR_END}\n\nbelow`;
    const parts = splitQuote(desc);
    assert.ok(parts, 'escaped block should be detected');
    assert.strictEqual(parts.words, words);
    assert.strictEqual(parts.below, '\n\nbelow');
  });

  test('CRLF line endings still find both marker lines', () => {
    const desc = `${HEADING}\r\n\r\nask\r\n\r\n${END}\r\nbelow`;
    const parts = splitQuote(desc);
    assert.ok(parts, 'CRLF block should be detected');
    assert.strictEqual(parts.below, '\r\nbelow');
  });
});

// LIN-4504 retired the fact reader with its last caller: no reader takes a plan fact from a description.

