/**
 * LIN-4368 (size of the move, piece 2 of 4): the record, its check and its vocabulary.
 *
 * lib/size-of-move.js owns the `## Size of the move` record. These are the pure-function
 * witnesses; tests/unit/size-of-move-guard.test.js drives the same check through the real
 * proxy write routes.
 *
 *   - Refused: a path, a code span (a backticked helper), call syntax, numbered steps; the
 *     standing policy deciding "wrong work"; a write that drops the section.
 *   - Permitted: plain what-and-why prose; bullet options; a quoted cut whose quote carries a
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
  readSizeRecord, sizeFact, checkSizeRecord, formatSizePolicyLine
} from '../../lib/size-of-move.js';
import { sealAsAsked } from '../../lib/as-asked.js';
import { assembleTrailFacts, formatTrailFactsBlock } from '../../lib/recommendation-facts.js';
import { generatePrompt } from '../../lib/prompt-templates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'size-of-move');

const ASK = 'Keep the look-first step as advice (on main: `docs/plans/survey.md`). Write a full guide.';
const SEALED = sealAsAsked(ASK);

/** A record body in the shape scoping will write. */
const PLAIN = [
  `**Size:** ${SIZES[0]}`,
  `**Decided by:** ${DECIDED_BY.policy} (err larger)`,
  '',
  'We are doing the task as asked, because nothing near it binds on this change and a larger move buys this task nothing.',
  '',
  '**Sizes weighed:**',
  `- ${SIZES[0]}: delivers what was asked and nothing more.`,
  `- ${SIZES[1]}: would tidy the neighbouring wording, which this task does not need.`,
  `- ${SIZES[3]}: would settle the whole area, but this task does not depend on it.`,
  '',
  '**Cuts:** none.'
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
    assert.equal(r.line.number, 14);
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
  test('plain what-and-why prose, with the sizes weighed as bullets', () => {
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(PLAIN)), { ok: true });
  });

  test('prose that only looks technical: and/or, size(s), a parenthesis, "e.g."', () => {
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(`${PLAIN}\nThe what and/or the why of the size(s) (as asked), e.g. this one, stays plain.`)), { ok: true });
  });

  test('a ruling and a pending record are fine with "wrong work"', () => {
    for (const by of [DECIDED_BY.ruling, DECIDED_BY.pending]) {
      const body = PLAIN.replace(`**Size:** ${SIZES[0]}`, `**Size:** ${WRONG_WORK}`).replace('the standing policy (err larger)', by);
      assert.deepEqual(checkSizeRecord(SEALED, withRecord(body)), { ok: true }, by);
    }
  });

  test('a quoted cut whose quote carries a code span from the ask; the same span not in the ask is refused', () => {
    const quoted = `${PLAIN.replace('**Cuts:** none.', '')}**Cuts:**\n- "Write a full guide." and "on main: \`docs/plans/survey.md\`" stay; ruled by John.`;
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(quoted)), { ok: true });
    const blockquote = `${PLAIN}\n> Keep the look-first step as advice (on main: \`docs/plans/survey.md\`).`;
    assert.deepEqual(checkSizeRecord(SEALED, withRecord(blockquote)), { ok: true }, 'a > quotation of the ask');
    const notInAsk = quoted.replace('docs/plans/survey.md', 'docs/plans/other.md');
    const r = checkSizeRecord(SEALED, withRecord(notInAsk));
    assert.deepEqual([r.ok, r.kind], [false, 'code-span']);
    const unquoted = `${PLAIN}\nKeep it on main: \`docs/plans/survey.md\`.`;
    assert.equal(checkSizeRecord(SEALED, withRecord(unquoted)).ok, false, 'the ask\'s words outside a quotation are not exempt');
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
  });
});
