/**
 * LIN-4524 (piece A): the one shared RETAINED table the retirement censuses read (tests/unit/helpers/retirement-census.js).
 * This file pins its schema: the closed set of kinds, the SELF list, and every rejection the validator makes. Each
 * rejection is proved against a planted bad row, so a validator that stops rejecting fails here, not in a census.
 *
 * The validator is pure: it takes the rows, the SELF list and an environment (what exists, what a file holds, what a
 * rule names, which words are known). The planted environments below stand in for the tree; the last test runs the
 * real module against the real tree.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { KINDS, SELF, RETAINED, WHOLE_ROOTS, CENSUS_ROOTS, retainedProblems, fsEnv } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORD = 'PLANTED_WORD';
const REASON = 'a reason long enough to say why the row stays';

/** A planted environment: the files that exist (path → text), the rules that exist (path → text), the known words. */
function planted({ files = {}, rules = {}, words = [WORD], roots = WHOLE_ROOTS } = {}) {
  const underPrefix = (rel) => rel.endsWith('/') && Object.keys(files).some((f) => f.startsWith(rel));
  return {
    roots,
    exists: (rel) => Object.hasOwn(files, rel) || underPrefix(rel),
    holds: (rel, label) => Object.entries(files).some(
      ([f, text]) => (f === rel || (rel.endsWith('/') && f.startsWith(rel))) && text.includes(label),
    ),
    ruleHas: (path, symbol) => Boolean(rules[path]?.includes(symbol)),
    knownWord: (label) => words.includes(label),
  };
}

const FILES = {
  'lib/a.js': `const x = '${WORD}';\n`,
  'lib/b.js': 'export const y = 1;\n',
  'lib/e.js': `// ${WORD}\n`,
  'lib/rule.js': 'export function ruleFn() {}\n',
  'tests/unit/c.test.js': `// ${WORD}\n`,
  'docs/dir/d.md': `${WORD}\n`,
};
const RULES = { 'lib/rule.js': 'export function ruleFn() {}\n' };
const env = (over = {}) => planted({ files: FILES, rules: RULES, ...over });

const temporary = (over = {}) => ({
  kind: 'temporary', file: 'lib/a.js', words: [WORD], reason: REASON, owner: 'LIN-4520', exit: 'P7 deletes the caller', ...over,
});
const live = (over = {}) => ({
  kind: 'live', file: 'lib/a.js', words: [WORD], reason: REASON, rule: { path: 'lib/rule.js', symbol: 'ruleFn' }, ...over,
});
const record = (over = {}) => ({ kind: 'record', file: 'lib/a.js', words: [WORD], reason: REASON, ...over });

const PROBLEMS = (rows, { self = {}, e = env() } = {}) => retainedProblems(rows, self, e);

describe('LIN-4524 shared RETAINED table: the schema and its validation', () => {
  test('the kinds are the closed set temporary, live, record, and frozen', () => {
    assert.deepEqual([...KINDS], ['temporary', 'live', 'record']);
    assert.ok(Object.isFrozen(KINDS));
  });

  test('the whole tests root is in scope, and every census root still is', () => {
    assert.ok(WHOLE_ROOTS.includes('tests'), 'the whole tests root, not a subset');
    for (const root of CENSUS_ROOTS) assert.ok(WHOLE_ROOTS.includes(root), `${root} is still a census root`);
  });

  test('happy path: one valid row of each kind, a row in the whole tests root, and a directory row, all pass', () => {
    const rows = [
      temporary(),
      live({ file: 'lib/e.js' }),
      record({ file: 'docs/dir/' }),
      record({ file: 'tests/unit/c.test.js' }),
    ];
    assert.deepEqual(PROBLEMS(rows), []);
  });

  test('a row of an unknown kind is rejected', () => {
    const problems = PROBLEMS([temporary({ kind: 'permanent' })]);
    assert.ok(problems.some((p) => /kind/.test(p) && /permanent/.test(p)), JSON.stringify(problems));
  });

  test('a temporary row with no owner is rejected, and so is one whose owner is blank', () => {
    assert.ok(PROBLEMS([temporary({ owner: undefined })]).some((p) => /owner/.test(p)));
    assert.ok(PROBLEMS([temporary({ owner: '   ' })]).some((p) => /owner/.test(p)));
  });

  test('a temporary row with no exit is rejected: the plan requires an exit as well as an owner', () => {
    assert.ok(PROBLEMS([temporary({ exit: undefined })]).some((p) => /exit/.test(p)));
  });

  test('a row with no reason is rejected, and so is one whose reason is blank', () => {
    assert.ok(PROBLEMS([record({ reason: undefined })]).some((p) => /reason/.test(p)));
    assert.ok(PROBLEMS([record({ reason: '  ' })]).some((p) => /reason/.test(p)));
  });

  test('a duplicate row, the same file and word twice, is rejected', () => {
    const problems = PROBLEMS([record(), record({ reason: 'another reason for the same word' })]);
    assert.ok(problems.some((p) => /duplicate/.test(p)), JSON.stringify(problems));
  });

  test('a row naming a file that no longer exists is rejected', () => {
    const problems = PROBLEMS([record({ file: 'lib/gone.js' })]);
    assert.ok(problems.some((p) => /lib\/gone\.js/.test(p) && /exist/.test(p)), JSON.stringify(problems));
  });

  test('a SELF entry that is also a row is rejected', () => {
    const self = { 'lib/a.js': 'the census file itself names the word' };
    const problems = PROBLEMS([record()], { self });
    assert.ok(problems.some((p) => /SELF/.test(p) && /lib\/a\.js/.test(p)), JSON.stringify(problems));
  });

  test('a stale row, a file that no longer holds its word, is rejected', () => {
    const problems = PROBLEMS([record({ file: 'lib/b.js' })]);
    assert.ok(problems.some((p) => /lib\/b\.js/.test(p) && /hold/.test(p)), JSON.stringify(problems));
  });

  test('a row naming a word the census does not know is rejected', () => {
    const problems = PROBLEMS([record({ words: ['NOT_A_CENSUS_WORD'] })]);
    assert.ok(problems.some((p) => /NOT_A_CENSUS_WORD/.test(p)), JSON.stringify(problems));
  });

  test('a live row with no rule, or whose named rule symbol is gone, is rejected', () => {
    assert.ok(PROBLEMS([live({ rule: undefined })]).some((p) => /rule/.test(p)));
    const problems = PROBLEMS([live({ rule: { path: 'lib/rule.js', symbol: 'goneFn' } })]);
    assert.ok(problems.some((p) => /goneFn/.test(p)), JSON.stringify(problems));
  });

  test('a row outside the scanned roots is rejected, because a census would never read it', () => {
    const problems = PROBLEMS([record({ file: 'experiments/x.js' })], { e: planted({ files: { 'experiments/x.js': `${WORD}\n` }, words: [WORD] }) });
    assert.ok(problems.some((p) => /experiments\/x\.js/.test(p) && /scanned|root/.test(p)), JSON.stringify(problems));
  });

  test('a SELF entry with no reason is rejected', () => {
    const problems = retainedProblems([], { 'lib/a.js': '' }, env());
    assert.ok(problems.some((p) => /SELF/.test(p) && /reason/.test(p)), JSON.stringify(problems));
  });

  test('the real module validates against the real tree: SELF names real files with reasons, RETAINED is valid', () => {
    for (const [path, reason] of Object.entries(SELF)) {
      assert.equal(typeof reason, 'string', `${path} has a reason`);
      assert.ok(reason.trim().length > 20, `${path} has a reason long enough to say why`);
    }
    assert.deepEqual(retainedProblems(RETAINED, SELF, fsEnv(ROOT, new Map(), WHOLE_ROOTS)), []);
  });
});
