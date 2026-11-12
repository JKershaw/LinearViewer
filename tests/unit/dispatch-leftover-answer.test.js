/**
 * LIN-4414 (W3): the leftover answer's retirement line, checked in lib/dispatch-leftover-answer.js.
 *
 * - The check acts only on the builder's leftover answer: a comment whose first non-blank line,
 *   trimmed, is the leftover heading. A review verdict with that heading further down (the real
 *   LIN-4393 review, tests/fixtures/leftover-answers/lin-4393-review.json), a mid-sentence mention,
 *   and a retirement line in a comment that does not open with the heading all pass untouched.
 * - An answer needs exactly one retirement line in one of three forms; no line is MISSING, and
 *   two lines, a path with no words, an unknown reason, or "nothing fix-sized" without the smallest
 *   entry or its reason are SHAPE.
 * - A real builder answer (LIN-4415's, tests/fixtures/leftover-answers/lin-4415-builder-answer.json)
 *   fails as it was posted and passes once a retirement line is added, so real prose around the
 *   line is accepted.
 * - The refusal's literal examples each pass, so a builder refused once can retry from them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEFTOVERS_HEADING, RETIRES_LABEL, RETIRES_NONE } from '../../lib/prompts/leftover-words.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import {
  checkLeftoverAnswer, isLeftoverAnswer, leftoverAnswerRefusal, retiresExamples, LEFTOVER_ANSWER_CODES
} from '../../lib/dispatch-leftover-answer.js';

// Real comments read from Linear on 12 Nov, kept as JSON ({ issue, commentId, createdAt, body }) so the docs sweeps do not read their prose as citations.
const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/leftover-answers/${name}`, import.meta.url)), 'utf8')).body;
const REVIEW_4393 = fixture('lin-4393-review.json');
const BUILDER_4415 = fixture('lin-4415-builder-answer.json');

const answer = (...lines) => [LEFTOVERS_HEADING, '', 'PR: https://github.com/o/r/pull/1 · head `abc1234`', '', '- `lib/a.js`: a stale comment. **tidied**', ...lines].join('\n');
const ENTRY = `${RETIRES_LABEL} \`lib/dispatch-factory.js\`: tests \`provider.name === 'linear'\` beside \`isHermeticTestToken\` for a test-only transport.`;
const NO_WAITING = `${RETIRES_LABEL} ${RETIRES_NONE.noWaiting}`;
const NOTHING_FIX_SIZED = `${RETIRES_LABEL} ${RETIRES_NONE.nothingFixSized}: the smallest in runs-and-dispatch is \`lib/cost-read.js\` (split out \`readCalls\`), which moves a store boundary, larger than a fix.`;

describe('which comments the check acts on (the opening line only)', () => {
  test('an answer that opens with the heading is checked, after blank lines and indentation too', () => {
    assert.equal(isLeftoverAnswer(answer()), true);
    assert.equal(isLeftoverAnswer(`\n\n   ${LEFTOVERS_HEADING}  \n\nnothing`), true);
  });

  test('a comment with no heading line passes untouched', () => {
    assert.deepEqual(checkLeftoverAnswer('## Implementation: PR open, CI green\n\nAll good.'), { ok: true, applies: false });
  });

  test('a comment that mentions the heading in backticks mid-sentence passes untouched', () => {
    const body = `## Note\n\nThe builder posted its \`${LEFTOVERS_HEADING}\` comment earlier; nothing here.`;
    assert.deepEqual(checkLeftoverAnswer(body), { ok: true, applies: false });
  });

  test('a comment with a retirement line but no opening heading passes untouched', () => {
    assert.deepEqual(checkLeftoverAnswer(`## Close-out\n\n${RETIRES_LABEL} something odd`), { ok: true, applies: false });
  });

  test('the real LIN-4393 review, with the heading as a subsection further down, passes untouched', () => {
    const lines = REVIEW_4393.split('\n');
    assert.match(lines[0], /^## Review — LIN-4393/);
    assert.ok(lines.slice(1).some((l) => l.trim() === LEFTOVERS_HEADING), 'the fixture carries the heading mid-comment');
    assert.ok(!REVIEW_4393.includes(RETIRES_LABEL), 'and no retirement line');
    assert.deepEqual(checkLeftoverAnswer(REVIEW_4393), { ok: true, applies: false });
  });

  test('a body that is not a string is not an answer', () => {
    assert.equal(isLeftoverAnswer(undefined), false);
    assert.equal(isLeftoverAnswer(''), false);
  });
});

describe('the three valid forms', () => {
  test('an entry: its file in backticks, then its opening words', () => {
    const check = checkLeftoverAnswer(answer(ENTRY));
    assert.equal(check.ok, true);
    assert.equal(check.form, 'entry');
    assert.equal(check.path, 'lib/dispatch-factory.js');
    assert.equal(check.line.number, 6);
  });

  test('none, no waiting entry (alone, or with a reason after it)', () => {
    assert.equal(checkLeftoverAnswer(answer(NO_WAITING)).form, 'no-waiting');
    assert.equal(checkLeftoverAnswer(answer(`${NO_WAITING} (this repo has no area notes)`)).form, 'no-waiting');
  });

  test('none, nothing fix-sized, naming the smallest entry and why it is larger', () => {
    const check = checkLeftoverAnswer(answer(NOTHING_FIX_SIZED));
    assert.equal(check.form, 'nothing-fix-sized');
    assert.equal(check.path, 'lib/cost-read.js');
  });

  test('a list marker or bold label is accepted, and the label is not case-sensitive', () => {
    assert.equal(checkLeftoverAnswer(answer(`- ${ENTRY}`)).form, 'entry');
    assert.equal(checkLeftoverAnswer(answer(`**${RETIRES_LABEL}** ${RETIRES_NONE.noWaiting}`)).form, 'no-waiting');
    assert.equal(checkLeftoverAnswer(answer(NO_WAITING.toLowerCase())).form, 'no-waiting');
  });

  test('every literal example the refusal gives passes', () => {
    const forms = retiresExamples().map((line) => checkLeftoverAnswer(answer(line)).form);
    assert.deepEqual(forms, ['entry', 'no-waiting', 'nothing-fix-sized']);
  });
});

describe('refused shapes', () => {
  const shape = (line) => checkLeftoverAnswer(answer(line));

  test('an answer with no retirement line is MISSING', () => {
    assert.deepEqual(checkLeftoverAnswer(answer()), { ok: false, code: LEFTOVER_ANSWER_CODES.missing });
    assert.equal(checkLeftoverAnswer(`${LEFTOVERS_HEADING}\n\nnothing`).code, LEFTOVER_ANSWER_CODES.missing);
  });

  test('a retirement line inside a fenced block does not count', () => {
    assert.equal(checkLeftoverAnswer(answer('```', ENTRY, '```')).code, LEFTOVER_ANSWER_CODES.missing);
  });

  test('a retirement line mid-sentence does not count', () => {
    assert.equal(checkLeftoverAnswer(answer(`I would have written ${ENTRY}`)).code, LEFTOVER_ANSWER_CODES.missing);
  });

  for (const [name, lines, kind] of [
    ['two retirement lines', [ENTRY, NO_WAITING], 'repeated'],
    ['a path with no words', [`${RETIRES_LABEL} \`lib/dispatch-factory.js\``], 'no-words'],
    ['a path with one word', [`${RETIRES_LABEL} \`lib/dispatch-factory.js\`: tests`], 'no-words'],
    ['words with no path', [`${RETIRES_LABEL} the factory's provider-name test`], 'no-path'],
    ['a symbol, not a path', [`${RETIRES_LABEL} \`isHermeticTestToken\` beside the provider name test`], 'no-path'],
    ['an empty line', [`${RETIRES_LABEL}`], 'no-path'],
    ['a bare none', [`${RETIRES_LABEL} none`], 'unknown-reason'],
    ['an unknown reason', [`${RETIRES_LABEL} none, not busy`], 'unknown-reason'],
    ['a reason run on into another word', [`${RETIRES_LABEL} ${RETIRES_NONE.noWaiting}way`], 'unknown-reason'],
    ['nothing fix-sized without a path', [`${RETIRES_LABEL} ${RETIRES_NONE.nothingFixSized}: every entry is a big refactor here`], 'fix-sized-no-entry'],
    ['nothing fix-sized with a path but no reason', [`${RETIRES_LABEL} ${RETIRES_NONE.nothingFixSized}: \`lib/cost-read.js\``], 'fix-sized-no-reason']
  ]) {
    test(`${name} is SHAPE (${kind})`, () => {
      const check = shape(lines.join('\n'));
      assert.equal(check.ok, false);
      assert.equal(check.code, LEFTOVER_ANSWER_CODES.shape);
      assert.equal(check.kind, kind);
      assert.ok(check.line.number > 1, 'names the line');
    });
  }
});

describe('real builder prose', () => {
  test('LIN-4415\'s answer, as posted, opens with the heading and has no retirement line: MISSING', () => {
    assert.equal(BUILDER_4415.split('\n')[0], LEFTOVERS_HEADING);
    assert.equal(checkLeftoverAnswer(BUILDER_4415).code, LEFTOVER_ANSWER_CODES.missing);
  });

  test('the same answer with a retirement line added passes, in each form', () => {
    for (const line of [ENTRY, NO_WAITING, NOTHING_FIX_SIZED]) {
      const withLine = BUILDER_4415.replace('\n\nConsidered, not a leftover:', `\n\n${line}\n\nConsidered, not a leftover:`);
      assert.notEqual(withLine, BUILDER_4415, 'the line went in');
      assert.equal(checkLeftoverAnswer(withLine).ok, true, line);
    }
  });
});

describe('the refusal message', () => {
  test('explains the opening-line trigger, names the fault and gives one literal example per form', () => {
    const missing = leftoverAnswerRefusal(checkLeftoverAnswer(answer()));
    assert.ok(missing.includes(`opens with the line "${LEFTOVERS_HEADING}"`));
    assert.match(missing, /has no such line/);
    for (const example of retiresExamples()) assert.ok(missing.includes(example), example);
    assert.match(missing, /must not open with that heading/);
    const repeated = leftoverAnswerRefusal(checkLeftoverAnswer(answer(ENTRY, NO_WAITING)));
    assert.match(repeated, /its line 7 has more than one such line/);
  });
});

describe('one home for the forms (LIN-4414 leftovers)', () => {
  test('the proxy catalog renders the forms from retiresExamples(), not its own words', () => {
    const catalog = buildInstructions({ baseUrl: 'https://harbour.example', scope: 'readWrite' });
    for (const example of retiresExamples()) assert.ok(catalog.includes(example), example);
  });
});
