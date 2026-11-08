/**
 * LIN-4368 (size of the move, piece 2 of 4): the record, its check and its vocabulary.
 *
 * lib/size-of-move.js owns the `## Size of the move` record. These are the pure-function
 * witnesses; tests/unit/size-of-move-guard.test.js drives the same check through the real
 * proxy write routes.
 *
 *   - Refused: a path, a code span (a backticked helper), call syntax, numbered steps; the
 *     standing policy deciding "wrong work"; a write that drops the section; (LIN-4369 arm 3)
 *     any line but the record's four, and each way those four can be wrong.
 *   - Permitted: a record of its four lines; a quoted cut whose quote carries a
 *     code span from the ask (the same span NOT in the ask is refused); an unchanged old
 *     section beside an unrelated write.
 *   - The Finding 9 hand-offs (docs/papers/harbour/cleaner-than-it-started.md), kept verbatim
 *     in tests/fixtures/size-of-move/, are refused wherever they carried how.
 *   - The parser reads the description below the As-asked block only: a ticket whose only
 *     `## Size of the move` is a comment reads as not recorded (in the selector's facts too).
 *   - Close-out's prune keeps the section verbatim (the guard's SIZE_RECORD_DROPPED backs it).
 *   - One home for the heading: no other file in lib/ or routes/ spells it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIZE_OF_MOVE_HEADING, SIZES, DECIDED_BY, SIZE_RECORD_CODES, WRONG_WORK,
  RECORD_LINES, RECORD_PARTS, SIZE_LABEL, WHY_LABEL, CUTS_LABEL, DECIDED_BY_LABEL, NO_CUTS, WHY_MAX_WORDS, CUT_MAX_OTHER_WORDS,
  readSizeRecord, sizeFact, checkSizeRecord, formatSizePolicyLine, recordShape
} from '../../lib/size-of-move.js';
import { sealAsAsked } from '../../lib/as-asked.js';
import { assembleTrailFacts, formatTrailFactsBlock } from '../../lib/recommendation-facts.js';
import { generatePrompt } from '../../lib/prompt-templates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'size-of-move');

const ASK = 'Keep the look-first step as advice (on main: `docs/plans/survey.md`). Write a full guide.';
const SEALED = sealAsAsked(ASK);

/** A record body in the shape scoping writes (LIN-4369 arm 3: four lines and nothing else). */
const PLAIN = [
  `**Size:** ${SIZES[0]}`,
  '**Why:** We are doing the task as asked, because nothing near it binds on this change and a larger move buys this task nothing.',
  '**Cuts:** none.',
  `**Decided by:** ${DECIDED_BY.policy} (err larger)`
].join('\n');

const withRecord = (body, { ask = SEALED, after = '\n\n## Implementation Plan\n\n1. a plan step is not part of the record' } = {}) =>
  `${ask}\n\n${SIZE_OF_MOVE_HEADING}\n\n${body}${after}`;

describe('the vocabulary', () => {
  test('the closed list of sizes and the decided-by values', () => {
    assert.deepEqual([...SIZES], ['just the task', 'a small tidy', 'consolidate the decision this task touches', 'rebuild the area', 'wrong work']);
    assert.equal(WRONG_WORK, 'wrong work');
    assert.deepEqual({ ...DECIDED_BY }, { ruling: 'a ruling', policy: 'the standing policy', pending: 'pending a ruling' });
    assert.equal(SIZE_OF_MOVE_HEADING, '## Size of the move');
  });

  test('one home: no other file in lib/ or routes/ spells the heading', () => {
    const walk = (dir, out = []) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (name.endsWith('.js')) out.push(p);
      }
      return out;
    };
    const spellers = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'routes'))]
      .filter((f) => readFileSync(f, 'utf8').split('\n').some((l) => l.includes(SIZE_OF_MOVE_HEADING) && !/^\s*(\*|\/\/)/.test(l)))
      .map((f) => relative(ROOT, f));
    assert.deepEqual(spellers, ['lib/size-of-move.js'], 'agent-facing text interpolates SIZE_OF_MOVE_HEADING; comments may name it');
  });
});

describe('the parser reads the description outside the As-asked block, never comments', () => {
  test('a record: its size and who decided', () => {
    const record = readSizeRecord(withRecord(PLAIN));
    assert.equal(record.size, 'just the task');
    assert.equal(record.decidedBy, 'policy');
    assert.equal(sizeFact(record), 'chosen just the task (by the standing policy)');
    assert.ok(!record.lines.some((l) => l.includes('a plan step')), 'the section ends at the next level-2 heading');
  });

  test('pending a ruling, a ruling, and a record with no size named', () => {
    assert.equal(sizeFact(readSizeRecord(withRecord(PLAIN.replace(/the standing policy \(err larger\)/, DECIDED_BY.pending)))), 'pending a ruling');
    assert.equal(sizeFact(readSizeRecord(withRecord(PLAIN.replace(/the standing policy \(err larger\)/, 'a ruling (John, 7 Nov)').replace('just the task', 'rebuild the area')))), 'chosen rebuild the area (by a ruling)');
    assert.equal(sizeFact(readSizeRecord(withRecord('We weigh it below.'))), 'recorded, with no size named (by no one named)');
  });

  test('no section is not recorded; a heading quoted inside the As-asked block is not a record', () => {
    assert.equal(readSizeRecord(SEALED), null);
    assert.equal(sizeFact(null), 'not recorded');
    const asked = sealAsAsked(`Please decide.\n\n${SIZE_OF_MOVE_HEADING}\n\n**Size:** rebuild the area`);
    assert.equal(readSizeRecord(asked), null, 'the person\'s words are not a record');
  });

  test('a Linear-escaped description reads the same', () => {
    const escaped = withRecord(PLAIN).replace(/([#*_])/g, '\\$1');
    assert.equal(sizeFact(readSizeRecord(escaped)), 'chosen just the task (by the standing policy)');
  });

  test('a ticket whose only size heading is a comment reads as not recorded, in the facts line too', () => {
    const comments = [{ body: `${SIZE_OF_MOVE_HEADING} (the person's call)\n\nErr larger, John's standing answer.`, createdAt: '2026-11-07T22:18:14.300Z' },
      { body: `${SIZE_OF_MOVE_HEADING}\n\n**Size:** rebuild the area\n**Decided by:** a ruling`, createdAt: '2026-11-07T22:19:00.000Z' }];
    const facts = assembleTrailFacts(comments, SEALED);
    assert.equal(facts.size, 'not recorded');
    assert.match(formatTrailFactsBlock(facts, comments.length), /^- Size of the move: not recorded$/m);
    const recorded = assembleTrailFacts(comments, withRecord(PLAIN));
    assert.match(formatTrailFactsBlock(recorded, comments.length), /^- Size of the move: chosen just the task \(by the standing policy\)$/m);
  });
});

describe('the check: what it refuses', () => {
  const refusal = (body) => checkSizeRecord(SEALED, withRecord(body));

  test('a file path, naming its line', () => {
    const r = refusal(`${PLAIN}\nStart in lib/size-of-move.js where the record lives.`);
    assert.equal(r.ok, false);
    assert.equal(r.code, SIZE_RECORD_CODES.how);
    assert.equal(r.kind, 'path');
    assert.equal(r.token, 'lib/size-of-move.js');
    assert.equal(r.line.number, 7);
    assert.equal(r.line.text, 'Start in lib/size-of-move.js where the record lives.');
  });

  test('a backticked helper', () => {
    const r = refusal(`${PLAIN}\nReuse \`outsideAsAsked\` for this.`);
    assert.deepEqual([r.code, r.kind, r.token], [SIZE_RECORD_CODES.how, 'code-span', '`outsideAsAsked`']);
  });

  test('call syntax, dotted or camelCase', () => {
    assert.equal(refusal(`${PLAIN}\nThen call readSizeRecord(description) once.`).kind, 'call');
    assert.equal(refusal(`${PLAIN}\nRoute it through store.getTable(urlKey).`).kind, 'call');
    assert.equal(refusal(`${PLAIN}\nRun init() first.`).kind, 'call');
  });

  test('numbered steps: "1. … 2. …", on their own lines or inline', () => {
    assert.equal(refusal(`${PLAIN}\n1. add the module\n2. wire the guard`).kind, 'numbered-steps');
    assert.equal(refusal(`${PLAIN}\nFirst 1. add the module, then 2. wire the guard.`).kind, 'numbered-steps');
  });

  test('the standing policy deciding "wrong work"', () => {
    const r = refusal(PLAIN.replace(`**Size:** ${SIZES[0]}`, `**Size:** ${WRONG_WORK}`));
    assert.deepEqual(r, { ok: false, code: SIZE_RECORD_CODES.policyCut });
  });

  test('the standing policy deciding "wrong work" in a second section appended to a valid live record', () => {
    const live = withRecord(PLAIN);
    const next = `${live}\n\n${SIZE_OF_MOVE_HEADING}\n\n**Size:** ${WRONG_WORK}\n**Decided by:** ${DECIDED_BY.policy}`;
    assert.deepEqual(checkSizeRecord(live, next), { ok: false, code: SIZE_RECORD_CODES.policyCut });
  });

  test('a write that drops an existing section', () => {
    assert.deepEqual(checkSizeRecord(withRecord(PLAIN), `${SEALED}\n\nA short stub: implemented in PR 1.`), { ok: false, code: SIZE_RECORD_CODES.dropped });
  });

  test('the Finding 9 hand-offs, verbatim, are refused wherever they carried how', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.startsWith('finding-9-'));
    assert.equal(files.length, 3, 'LIN-4178 (wording that invited a copy), LIN-4251 (the operator\'s scope steps), LIN-4252 (a sweep drawn around named suites)');
    for (const file of files) {
      // The hand-off's own heading is replaced by the record's; every other byte is as written on the ticket.
      const body = readFileSync(join(FIXTURES, file), 'utf8').split('\n').slice(1).join('\n').trim();
      const r = refusal(body);
      assert.equal(r.ok, false, `${file} must be refused`);
      assert.equal(r.code, SIZE_RECORD_CODES.how, file);
    }
  });
});

describe('the check: what it permits', () => {
  test('a record of its four lines', () => {
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(PLAIN)), { ok: true });
  });

  test('prose that only looks technical: and/or, size(s), a parenthesis, "e.g."', () => {
    const why = '**Why:** The what and/or the why of the size(s) (as asked), e.g. this one, stays plain.';
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(PLAIN.replace(/^\*\*Why:\*\*.*$/m, why))), { ok: true });
  });

  test('a ruling and a pending record are fine with "wrong work"', () => {
    for (const by of [DECIDED_BY.ruling, DECIDED_BY.pending]) {
      const body = PLAIN.replace(`**Size:** ${SIZES[0]}`, `**Size:** ${WRONG_WORK}`).replace('the standing policy (err larger)', by);
      assert.deepEqual(checkSizeRecord(SEALED, withRecord(body)), { ok: true }, by);
    }
  });

  test('a quoted cut whose quote carries a code span from the ask; the same span not in the ask is refused', () => {
    const quoted = PLAIN.replace('**Cuts:** none.', '**Cuts:**\n- "Write a full guide." and "on main: `docs/plans/survey.md`" are cut, pending a ruling.');
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(quoted)), { ok: true });
    const notInAsk = quoted.replace('docs/plans/survey.md', 'docs/plans/other.md');
    const r = checkSizeRecord(SEALED, withRecord(notInAsk));
    assert.deepEqual([r.ok, r.kind], [false, 'code-span']);
    const unquoted = PLAIN.replace('**Cuts:** none.', '**Cuts:**\n- Keep it on main: `docs/plans/survey.md`.');
    assert.equal(checkSizeRecord(SEALED, withRecord(unquoted)).ok, false, 'the ask\'s words outside a quotation are not exempt');
  });

  test('a > quotation of the ask passes the how check, and is then a line the record does not hold', () => {
    const blockquote = `${PLAIN}\n> Keep the look-first step as advice (on main: \`docs/plans/survey.md\`).`;
    const r = checkSizeRecord(SEALED, withRecord(blockquote));
    assert.deepEqual([r.code, r.kind], [SIZE_RECORD_CODES.shape, 'extra-line']);
  });

  test('an unchanged old section never blocks an unrelated write, even one that breaks the rules', () => {
    const old = withRecord(`${PLAIN}\nStart in lib/size-of-move.js.`, { after: '' });
    assert.deepEqual(checkSizeRecord(old, `${old}\n\n## Notes\n\nAn appended note.`), { ok: true });
    assert.deepEqual(checkSizeRecord(old, old.replace(PLAIN, PLAIN.replace(/\*\*/g, '\\*\\*'))), { ok: true }, 're-escaped by a provider round trip is unchanged');
    assert.deepEqual(checkSizeRecord(SEALED, `${SEALED}\n\n## Notes\n\n1. no record here`), { ok: true }, 'no section at all');
  });

  test('a section added on an unsealed ticket is checked too (nothing to quote from)', () => {
    const r = checkSizeRecord('Old body.', `Old body.\n\n${SIZE_OF_MOVE_HEADING}\n\nTouch lib/x.js.`);
    assert.deepEqual([r.ok, r.kind], [false, 'path']);
  });

  test('a second section is checked as well as the first', () => {
    const r = checkSizeRecord(SEALED, `${withRecord(PLAIN, { after: '' })}\n\n${SIZE_OF_MOVE_HEADING}\n\nThen 1. edit 2. ship`);
    assert.deepEqual([r.ok, r.kind], [false, 'numbered-steps']);
  });
});

describe('the standing policy line', () => {
  test('no policy, ask, and an unknown value read as no standing policy', () => {
    for (const p of [undefined, null, { value: 'ask' }, { value: 'huge' }]) {
      assert.match(formatSizePolicyLine(p), /no standing policy/);
    }
  });

  test('err-larger says what John meant, and when it was set', () => {
    const line = formatSizePolicyLine({ value: 'err-larger', setAt: '2026-11-07T22:18:14.300Z' });
    assert.match(line, /err larger: take the larger move when the look shows it pays, and when in doubt/);
    assert.match(line, /stays just the task/);
    assert.match(line, /\(set 2026-11-07\)/);
  });
});

describe('close-out keeps the record', () => {
  test('the prune step says to keep the size section verbatim, in the prune instruction itself', () => {
    const issue = { identifier: 'ABC-7', title: 'Approved work', description: withRecord(PLAIN), state: { name: 'In Progress', type: 'started' }, labels: [] };
    const { prompt } = generatePrompt('close-out', issue, { comments: [] });
    const prune = prompt.split('\n').find((l) => l.includes('**Prune**'));
    assert.ok(prune, 'close-out has its prune step');
    assert.match(prune, /description\/below/);
    assert.ok(prune.includes(`Keep the \`${SIZE_OF_MOVE_HEADING}\` section verbatim`), prune);
    // LIN-4369 arm 3: a stub straight below the record would sit inside its section and be refused.
    assert.ok(prune.includes(`section verbatim, with your stub under a heading of its own`), prune);
  });
});

// LIN-4369 arm 3 (John's structural ruling, decision lin4346-size-after-arm2): the record is four
// lines and nothing else, so how has no room. Two free-form arms put the how wherever the record
// left space (lists and code spans, then plain-word definitions); code now holds the shape.
describe('the shape: four lines and nothing else (LIN-4369 arm 3)', () => {
  const shape = (body, ask = SEALED) => checkSizeRecord(ask, withRecord(body, { ask, after: '' }));
  const kindOf = (body, ask) => { const r = shape(body, ask); return r.ok ? 'ok' : `${r.code}:${r.kind}`; };
  const S = SIZE_RECORD_CODES.shape;
  const swap = (label, value) => PLAIN.replace(new RegExp(`^\\*\\*${label}:\\*\\*.*$`, 'm'), `**${label}:** ${value}`);

  test('the module names the four lines once, and the prompt shape is rendered from them', () => {
    assert.deepEqual([...RECORD_LINES], ['Size', 'Why', 'Cuts', 'Decided by']);
    assert.deepEqual(recordShape(), RECORD_LINES.map((l) => `**${l}:** ${RECORD_PARTS[l]}`));
    assert.ok(RECORD_PARTS.Size.endsWith(SIZES.join(' / ')));
    assert.ok(RECORD_PARTS['Decided by'] === Object.values(DECIDED_BY).join(' / '));
  });

  test('any other line is refused, naming it: the sizes weighed, open questions, a definition, a heading-less stub', () => {
    for (const extra of [`- ${SIZES[1]}: buys this task nothing.`, 'Open questions: none.', 'The trait means what the preamble gates today.', 'Implemented in PR 1.']) {
      const r = shape(`${PLAIN}\n${extra}`);
      assert.deepEqual([r.code, r.kind, r.line.number, r.line.text], [S, 'extra-line', 7, extra], extra);
    }
  });

  test('a line missing, repeated or out of order', () => {
    const r = shape(PLAIN.replace(/^\*\*Cuts:\*\*.*\n/m, ''));
    assert.deepEqual([r.code, r.kind, r.missing], [S, 'missing-line', CUTS_LABEL]);
    assert.equal(kindOf(PLAIN.split('\n').slice(0, 3).join('\n')), `${S}:missing-line`, 'no decided-by line');
    assert.equal(kindOf(`${PLAIN}\n**${WHY_LABEL}:** Again.`), `${S}:repeated-line`);
    const [size, why, cuts, by] = PLAIN.split('\n');
    assert.equal(kindOf([why, size, cuts, by].join('\n')), `${S}:missing-line`, 'why before size');
  });

  test('the size is one of the list, as written there', () => {
    assert.equal(kindOf(swap(SIZE_LABEL, 'a medium tidy')), `${S}:size`);
    assert.equal(kindOf(swap(SIZE_LABEL, `${SIZES[2]}, the cost read`)), `${S}:size`, 'nothing after the size');
    assert.equal(kindOf(swap(SIZE_LABEL, `${SIZES[2]}.`)), 'ok');
  });

  test('the why is one sentence of at most WHY_MAX_WORDS words', () => {
    assert.equal(kindOf(swap(WHY_LABEL, 'It is fine as asked. The builder decides the rest.')), `${S}:why-sentences`);
    // Arm 4 (John's ruling lin4369-after-arm3): a semicolon joins clauses inside the one sentence.
    assert.equal(kindOf(swap(WHY_LABEL, 'It delivers the ask in full; no finding binds, so nothing rides along.')), 'ok', 'a semicolon-joined sentence');
    assert.equal(kindOf(swap(WHY_LABEL, 'It delivers the ask in full; no finding binds. The builder decides the rest.')), `${S}:why-sentences`, 'a full stop still ends it');
    assert.ok(RECORD_PARTS[WHY_LABEL].includes('a semicolon may join clauses and a full stop ends it'), 'the prompt says so');
    assert.equal(kindOf(swap(WHY_LABEL, Array(WHY_MAX_WORDS + 1).fill('word').join(' '))), `${S}:why-too-long`);
    assert.equal(kindOf(swap(WHY_LABEL, Array(WHY_MAX_WORDS).fill('word').join(' '))), 'ok');
    assert.equal(kindOf(swap(WHY_LABEL, '')), `${S}:why-empty`);
  });

  test('cuts: none, an inline quoted cut, or bullets that each quote the ask with little beside it', () => {
    assert.equal(kindOf(swap(CUTS_LABEL, '"Write a full guide." is cut, pending a ruling.')), 'ok');
    assert.equal(kindOf(swap(CUTS_LABEL, '\n- “Write a full guide.” cut by a ruling (John, 8 Nov)\n- "Keep the look-first step as advice" pending a ruling')), 'ok');
    assert.equal(kindOf(swap(CUTS_LABEL, '')), `${S}:cuts-empty`);
    assert.equal(kindOf(swap(CUTS_LABEL, '\n- the guide is cut')), `${S}:cut-unquoted`);
    assert.equal(kindOf(swap(CUTS_LABEL, '\n- "a guide nobody asked for" is cut')), `${S}:cut-unquoted`, 'a quotation that is not the ask');
    const long = Array(CUT_MAX_OTHER_WORDS + 1).fill('word').join(' ');
    assert.equal(kindOf(swap(CUTS_LABEL, `\n- "Write a full guide." ${long}`)), `${S}:cut-too-long`);
    assert.equal(kindOf(`${PLAIN}\n- "Write a full guide." is cut`), `${S}:extra-line`, 'a bullet is a cut only under the Cuts line');
    assert.equal(kindOf(swap(CUTS_LABEL, `${NO_CUTS}\n- "Write a full guide." is cut`)), `${S}:extra-line`, '"none" takes no bullets under it');
  });

  test('on an unsealed ticket a cut quotes the description outside the record', () => {
    const live = 'Write a full guide to the look-first step.';
    const body = swap(CUTS_LABEL, '"Write a full guide" is cut, pending a ruling.');
    assert.deepEqual(checkSizeRecord(live, `${live}\n\n${SIZE_OF_MOVE_HEADING}\n\n${body}`), { ok: true });
    const r = checkSizeRecord(live, `${live}\n\n${SIZE_OF_MOVE_HEADING}\n\n${swap(CUTS_LABEL, '"a short note" is cut.')}`);
    assert.deepEqual([r.code, r.kind], [S, 'cut-unquoted']);
  });

  test('decided by one of the list, with at most a few words of who and when', () => {
    assert.equal(kindOf(swap(DECIDED_BY_LABEL, 'John')), `${S}:decided-by`);
    assert.equal(kindOf(swap(DECIDED_BY_LABEL, `${DECIDED_BY.ruling} (John, comment of 7 Nov 22:18)`)), 'ok');
    assert.equal(kindOf(swap(DECIDED_BY_LABEL, `${DECIDED_BY.policy} because the Surveys found the cost read prices nothing on these rows`)), `${S}:decided-by-too-long`);
  });

  test('labels read in any of the usual markdown spellings', () => {
    const plainLabels = PLAIN.replace(/\*\*/g, '');
    assert.equal(kindOf(plainLabels), 'ok');
    assert.equal(kindOf(PLAIN.replace(`**${WHY_LABEL}:**`, `**${WHY_LABEL.toLowerCase()}**:`)), 'ok');
    assert.equal(kindOf(PLAIN.replace(/\*\*/g, '\\*\\*')), 'ok', 'Linear-escaped');
  });

  test('the refusals keep their order: how, then the policy cut, then the shape', () => {
    assert.equal(shape(`${PLAIN}\nStart in lib/size-of-move.js.`).code, SIZE_RECORD_CODES.how, 'a path is named as how, not as an extra line');
    assert.equal(shape(`${swap(SIZE_LABEL, WRONG_WORK)}\nAnd more.`).code, SIZE_RECORD_CODES.policyCut);
  });
});
