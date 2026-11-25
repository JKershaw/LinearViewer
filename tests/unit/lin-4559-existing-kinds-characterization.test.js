/**
 * LIN-4559 behaviour preservation: every reader LIN-4559 taught the `speaksForRun` role answers exactly as it did, for
 * every kind that existed before `agent-text` (and for kind-less entries).
 *
 * The golden (tests/fixtures/lin-4559-existing-kinds-golden.json) was recorded by running `readSurfaces`
 * (tests/fixtures/lin-4559-existing-kinds-corpus.js) against the readers as they were on main before the change
 * (re-recorded at 69b5c1bbd, after LIN-4558 changed parseParkedWait): 210 feedback arrays (each existing kind x each marker, report line and park message, plus the
 * orderings the readers turn on: run words then `[done]`, a `[done]` inside assistant-text, blocked then resume,
 * done then blocked, a report line then `[done]` with a url, a decision case, a ticket walk). Here the same corpus is
 * read through the changed readers and must match it case by case. The two predicates whose argument changed from a
 * message to an entry (`isLineageClosingTerminal`, `isWakeEvent`) are called with the entry.
 *
 * The store-side pieces the corpus cannot reach are pinned below: a run-speaking post keeps its `rootItemId` tag and
 * still drives the lineage closers, the bulk closers' filter still sees a run's own terminal, and the chunk-seam
 * masking of the run's words is unchanged.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as terminal from '../../lib/dispatch-terminal.js';
import * as telemetry from '../../lib/session-telemetry.js';
import * as digest from '../../lib/digest-feedback.js';
import * as wake from '../../lib/dispatch-wake.js';
import * as churn from '../../lib/pipeline-churn.js';
import * as closure from '../../lib/lineage-closure.js';
import * as runView from '../../lib/run-view.js';
import * as efficacy from '../../lib/observer-efficacy-signal.js';
import { isContinuationChunk, previousChunkBodyOf } from '../../lib/dispatch-feedback-masking.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { corpus, readSurfaces, asJson, EXISTING_KINDS } from '../fixtures/lin-4559-existing-kinds-corpus.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(HERE, '../fixtures/lin-4559-existing-kinds-golden.json'), 'utf8')).cases;
const modules = { terminal, telemetry, digest, wake, churn, closure, runView, efficacy };

describe('LIN-4559: every touched reader answers as before for the kinds that already existed (golden from main)', () => {
  const cases = corpus();

  test('the corpus is the one the golden was recorded over', () => {
    assert.deepEqual(cases.map((c) => c.name), Object.keys(golden));
    assert.ok(!EXISTING_KINDS.includes('agent-text'), 'the corpus holds only kinds that existed before LIN-4559');
  });

  for (const c of cases) {
    test(c.name, () => {
      assert.deepStrictEqual(asJson(readSurfaces(c.feedback, modules, (e) => e)), golden[c.name]);
    });
  }
});

describe('LIN-4559: the store, for a run-speaking post, is unchanged (real MangoDB)', () => {
  const URL_KEY = 'lin-4559-preserve';
  const harness = createMangoTmpdir('lin-4559-preserve-');
  let history;
  let store;

  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => {
    const db = harness.freshDb();
    history = db.collection('dispatch-history');
    store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    store._notifyWriteForDoc = () => {};
  });

  const seed = (id, o = {}) => history.insertOne({
    _id: id, urlKey: URL_KEY, issueIdentifier: 'LIN-1', rootItemId: 'root-1', kind: 'wake', dispatchedAt: new Date('2026-08-01T00:01:00Z'),
    resolvedAt: new Date('2026-08-01T00:02:00Z'), status: 'taken', feedback: [], bookkeeping: null, takenByTokenLabel: 'tok', takenByTokenId: null, ...o
  });
  const stamp = async (id) => (await history.findOne({ _id: id })).bookkeeping ?? null;

  for (const kind of ['assistant-text', 'status', undefined]) {
    test(`a ${kind ?? 'kind-less'} [done] keeps its rootItemId tag and closes the earlier rows of its lineage`, async () => {
      await seed('poster', { kind: 'implementation' });
      await seed('earlier');
      await store.addFeedback('poster', URL_KEY, { message: '[done] shipped', rootItemId: 'root-1', ...(kind ? { kind } : {}) }, 'tok');
      const [entry] = (await history.findOne({ _id: 'poster' })).feedback;
      assert.equal(entry.rootItemId, 'root-1');
      assert.ok(!('agent' in entry));
      assert.equal((await stamp('earlier')).reason, 'lineage-terminal');
    });
  }

  test('the first tagged run post still fires the handed-on closer', async () => {
    await seed('old-wake', { dispatchedAt: new Date('2026-08-01T00:01:00Z') });
    await seed('newer-wake', { dispatchedAt: new Date('2026-08-01T00:10:00Z'), resolvedAt: new Date('2026-08-01T00:11:00Z') });
    await store.addFeedback('newer-wake', URL_KEY, { message: 'Picked up the follow-up.', kind: 'assistant-text', rootItemId: 'root-1' }, 'tok');
    assert.equal((await stamp('old-wake')).reason, 'handed-on');
  });

  test('noOwnTerminalMarkerFilter still excludes a row with its own terminal, kind-less or kinded, and keeps a row with none', async () => {
    await seed('kindless', { feedback: [{ message: '[done] x', timestamp: new Date() }] });
    await seed('kinded', { feedback: [{ message: '[skipped] human-continued', kind: 'status', timestamp: new Date() }] });
    await seed('assistant', { feedback: [{ message: '[failed] said in its words', kind: 'assistant-text', timestamp: new Date() }] });
    await seed('open', { feedback: [{ message: '[blocked] need input', kind: 'status', timestamp: new Date() }] });
    const ids = (await history.find({ urlKey: URL_KEY, ...terminal.noOwnTerminalMarkerFilter() }).toArray()).map((d) => d._id).sort();
    assert.deepEqual(ids, ['open']);
  });
});

describe('LIN-4559: the chunk-seam masking of the run\'s own words is unchanged', () => {
  const chunk = (i, n, body, label = 'Turn 3') => `${label}\n(assistant-text ${i}/${n})\n${body}`;

  test('an assistant-text continuation chunk is still a continuation; chunk 1 and other kinds are not', () => {
    assert.equal(isContinuationChunk({ message: chunk(2, 3, 'b'), kind: 'assistant-text' }), true);
    assert.equal(isContinuationChunk({ message: '(recap 2/2)\nb', kind: 'assistant-text' }), true);
    assert.equal(isContinuationChunk({ message: chunk(1, 3, 'a'), kind: 'assistant-text' }), false);
    assert.equal(isContinuationChunk({ message: chunk(2, 3, 'b'), kind: 'status' }), false);
    assert.equal(isContinuationChunk({ message: chunk(2, 3, 'b') }), false);
  });

  test('previousChunkBodyOf still finds chunk i-1 of the run\'s words with no kind argument', () => {
    const feedback = [{ kind: 'assistant-text', message: chunk(1, 2, 'first body') }, { kind: 'status', message: chunk(1, 2, 'not this') }];
    assert.equal(previousChunkBodyOf(feedback, chunk(2, 2, 'second')), 'first body');
  });
});
