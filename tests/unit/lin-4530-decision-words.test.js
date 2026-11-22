/**
 * LIN-4530 (P1 of LIN-4529; plan D1): a `decision` holds the person's own words, `words`, beside the chosen option,
 * `answer`. These are the contract tests the plan's witness names: a decision with option only, words only, and both,
 * each stored verbatim (markup and a long sentence included); neither is refused; a value over the limit is refused
 * naming the limit, never truncated; an `answers` link makes the question read `answered` with both; the brief shows
 * the question, the option and the words together.
 *
 * It runs the real store (lib/records-store.js on a MangoDB engine, as the LIN-4493 contract does), so what is read back
 * is what was stored, not what was passed in.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { checkAdd, checkRevise, KINDS } from '../../lib/records/check.js';
import { index as buildIndex, viewOf } from '../../lib/records/views.js';
import { buildBrief } from '../../lib/records/brief.js';

const URL_KEY = 'lin-4530-workspace';
const STAGES = ['implementation', 'review', 'close-out'];
const PEOPLE = [{ accountId: 'acc-john', name: 'John' }];
const JOHN = 'person:acc-john';
const at = (m) => new Date(Date.UTC(2026, 10, 22, 0, m)).toISOString();
const LIMIT = KINDS.limits.decision.words;

/** Markup, a newline, a long sentence and leading and trailing spaces: every character must survive the store. */
const VERBATIM = '  Use **bold** and `code` & <b>tags</b>;\nthen a long sentence that runs on so the record is not short: '
  + 'the footer shows the count of runs left for the day, and it is never shown as zero while any remain.  ';

const harness = createMangoTmpdir('lin-4530-decision-words-');
let db;
let store;
let minute = 0;
let idx;

before(() => harness.connect());
after(() => harness.close());

async function refresh() {
  idx = buildIndex(await store.snapshots(URL_KEY));
}
function ctx(now = idx) {
  return {
    addressees: { stages: STAGES, people: PEOPLE },
    resolve(ref) {
      const s = now.at(ref);
      return s ? { kind: s.kind, id: ref } : null;
    },
    currentVersion: (id) => now.currentVersion(id),
    versionExists: (id, v) => Boolean(now.versionOf(id, v)),
  };
}

/** A write as the proxy makes it: check, then store. Returns the stored version, or the refusal's problems. */
async function write(kind, body, by = 'implementation') {
  const { problems, record } = checkAdd(kind, body, ctx());
  if (problems.length) return { problems };
  const snap = await store.add(URL_KEY, record, { by, at: at(++minute) });
  await refresh();
  return snap;
}
async function add(kind, body, by) {
  const r = await write(kind, body, by);
  assert.ok(!r.problems, JSON.stringify(r.problems));
  return r.id;
}
async function revise(id, body, by = 'implementation') {
  const prev = idx.at(id);
  const { problems, changes } = checkRevise(prev, body, ctx());
  if (problems.length) return { problems };
  const snap = await store.revise(URL_KEY, id, changes, { by, at: at(++minute), reason: body.reason });
  await refresh();
  return snap;
}
const refused = (problems, field) => {
  assert.ok(problems && problems.length, 'expected a refusal');
  if (field) assert.ok(problems.some((p) => p.field === field), `a problem on ${field}: ${JSON.stringify(problems)}`);
  return problems;
};
const storedDecisions = async () => (await store.snapshots(URL_KEY)).filter((s) => s.kind === 'decision');

beforeEach(async () => {
  minute = 0;
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION), now: () => new Date(at(0)) });
  await refresh();
});

describe('a decision holds the option, the words, or both (LIN-4530 plan D1)', () => {
  test('the limit is in the kind data, and words is a string field of decision', () => {
    assert.equal(KINDS.kinds.decision.fields.words, 'string');
    assert.equal(KINDS.limits.decision.answer, 10000);
    assert.equal(KINDS.limits.decision.words, 10000);
  });

  test('option only, words only, and both are each accepted and stored verbatim', async () => {
    const t = await add('task', { asked: 'Make the footer show runs left.', 'done-when': 'shows N' }, JOHN);
    const q = await add('question', { in: t, to: JOHN, asks: 'Which footer?', options: ['count', 'bar'], recommended: 'count', 'if-unanswered': 'count' }, 'implementation');
    const cases = [
      { label: 'option only', body: { answer: 'count' } },
      { label: 'words only', body: { words: VERBATIM } },
      { label: 'both', body: { answer: 'count', words: VERBATIM } },
    ];
    for (const { label, body } of cases) {
      const checked = checkAdd('decision', { in: t, ...body, answers: q, why: 'a test' }, ctx());
      assert.deepEqual(checked.problems, [], `${label}: ${JSON.stringify(checked.problems)}`);
      const stored = await write('decision', { in: t, ...body, answers: q }, JOHN);
      assert.ok(!stored.problems, label);
      const back = (await storedDecisions()).find((s) => s.id === stored.id);
      assert.ok(back, `${label}: stored`);
      for (const [key, value] of Object.entries(body)) {
        assert.strictEqual(back.fields[key], value, `${label}: ${key} comes back exactly as written`);
      }
      assert.equal(back.links.answers, q, `${label}: the answers link is kept`);
    }
  });

  test('neither an option nor words is refused on words, naming both fields that would work', () => {
    const problems = refused(checkAdd('decision', { why: 'scoped', scope: 'project' }, ctx()).problems, 'words');
    assert.deepEqual(problems[0].works, ['answer', 'words']);
  });

  test('blank text is neither: whitespace in both fields is refused, and a blank words does not stand in for an option', () => {
    refused(checkAdd('decision', { answer: '   ', words: '\n\t ' }, ctx()).problems, 'words');
    refused(checkAdd('decision', { answer: '', words: '  ' }, ctx()).problems, 'words');
  });

  test('a word over the limit is refused naming the limit, and nothing is stored', async () => {
    const q = await add('question', { to: JOHN, asks: 'Which?', options: ['a'], recommended: 'a' }, 'implementation');
    const before = (await store.snapshots(URL_KEY)).length;
    const r = await write('decision', { words: 'x'.repeat(LIMIT + 1), answers: q }, JOHN);
    assert.match(r.problems[0].message, new RegExp(`limit is ${LIMIT}`));
    assert.equal(r.problems[0].field, 'words');
    assert.equal((await store.snapshots(URL_KEY)).length, before, 'a refused write stores nothing');
  });

  test('an option over the limit is refused the same way', () => {
    refused(checkAdd('decision', { answer: 'x'.repeat(10001) }, ctx()).problems, 'answer');
  });

  test('exactly at the limit is accepted, and stored whole, never cut', async () => {
    const words = 'w'.repeat(LIMIT);
    const id = await add('decision', { words, scope: 'project' }, JOHN);
    assert.equal(idx.at(id).fields.words.length, LIMIT);
    assert.equal(idx.at(id).fields.words, words);
  });

  test('a revise cannot clear both: clearing words keeps the option, and clearing the option too is refused', async () => {
    const id = await add('decision', { answer: 'count', words: VERBATIM, scope: 'project' }, JOHN);
    assert.ok(!(await revise(id, { words: null, reason: 'the person withdrew their wording' }, JOHN)).problems);
    assert.equal(idx.at(id).fields.answer, 'count');
    assert.equal(idx.at(id).fields.words, undefined);
    refused((await revise(id, { answer: null, reason: 'no option either' }, JOHN)).problems, 'words');
  });
});

describe('the answers link joins a decision to a question', () => {
  test('a decision answering a question is stored with the link, and a finding cannot carry it', async () => {
    const q = await add('question', { to: JOHN, asks: 'Which?', options: ['a', 'b'], recommended: 'a' }, 'implementation');
    refused(checkAdd('finding', { to: 'review', says: 'x', answers: q }, ctx()).problems, 'answers');
    const d = await write('decision', { answer: 'b', words: VERBATIM, answers: q }, JOHN);
    assert.equal(idx.at(d.id).links.answers, q);
  });

  test('an answers link that names a record which is not a question is refused', async () => {
    const f = await add('finding', { to: 'review', says: 'not a question' }, 'implementation');
    refused(checkAdd('decision', { answer: 'a', answers: f }, ctx()).problems, 'answers');
  });

  test('an answers link that names nothing is refused', () => {
    refused(checkAdd('decision', { answer: 'a', answers: 'no-such-question' }, ctx()).problems, 'answers');
  });
});

describe('a question with a standing answer reads answered, with the option and the words', () => {
  test('both fields are shown beside the question, as stored', async () => {
    const t = await add('task', { asked: 'x' }, JOHN);
    const q = await add('question', { in: t, to: JOHN, asks: 'Which footer?', options: ['a', 'b'], recommended: 'a' }, 'implementation');
    const d = await add('decision', { in: t, answer: 'a', words: VERBATIM, answers: q }, JOHN);
    assert.deepEqual(viewOf(idx.at(q), idx).flags.answered, { by: d, answer: 'a', words: VERBATIM });
  });

  test('words alone: the answered flag carries the words and no option', async () => {
    const t = await add('task', { asked: 'x' }, JOHN);
    const q = await add('question', { in: t, to: JOHN, asks: 'Which footer?', options: ['a', 'b'], recommended: 'a' }, 'implementation');
    const d = await add('decision', { in: t, words: 'Neither of those: show it on Home.', answers: q }, JOHN);
    assert.deepEqual(viewOf(idx.at(q), idx).flags.answered, { by: d, words: 'Neither of those: show it on Home.' });
  });
});

describe('the brief shows the question, the option and the words together', () => {
  test('part 4 carries the decision with its option and words, and the question reads answered with both', async () => {
    const t = await add('task', { asked: 'Make the footer show runs left.', 'done-when': 'shows N' }, JOHN);
    const q = await add('question', { in: t, to: JOHN, asks: 'Which footer, and where?', options: ['count', 'bar'], recommended: 'count', 'if-unanswered': 'count' }, 'implementation');
    await add('decision', { in: t, answer: 'count', words: VERBATIM, answers: q }, JOHN);
    const brief = buildBrief({ actor: 'implementation', taskId: t, idx });
    assert.ok(!brief.problem, brief.problem);
    assert.ok(brief.text.includes('Which footer, and where?'), 'the question is in the brief');
    assert.ok(brief.text.includes('answered by'), 'the question reads answered');
    assert.ok(brief.text.includes('    option: count'), 'the option is shown');
    assert.ok(brief.text.includes(VERBATIM.split('\n')[0]), 'the first line of the words is shown');
    const part4 = brief.parts.stands.find((r) => r.kind === 'decision');
    assert.equal(part4.fields.words, VERBATIM, 'the record the brief carries holds the words exactly');
    assert.equal(part4.fields.answer, 'count');
  });

  test('a words-only decision is shown with its words and no option line', async () => {
    const t = await add('task', { asked: 'x' }, JOHN);
    await add('decision', { in: t, words: 'Keep it as it is.' }, JOHN);
    const brief = buildBrief({ actor: 'implementation', taskId: t, idx });
    assert.ok(brief.text.includes('words: Keep it as it is.'));
    assert.ok(!brief.text.includes('    option:'));
  });
});
