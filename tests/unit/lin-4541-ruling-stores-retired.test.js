/**
 * LIN-4541 (LIN-4529 P7b-2): the ruling predicate, the old ruling stores, answers as comments and the DECISION: feedback
 * path are gone, and no code reads the old ruling collections. A question is a question record and its answer a decision
 * record (POST /api/proxy/records; lib/question-answers.js).
 *
 * The three old ruling collections stay as history (the standing answer: recorded history stays as it is). Each is still
 * listed in the erasure inventory (lib/account-erasure.js INVENTORY, with a reason that says history) and in the dry run's
 * URLKEY_SOURCES, so an erasure still reaches a workspace's old rows. Nothing else opens or names them: no module, no
 * index, no route. Dropping them is a later decision for a person, recorded as a finding to the project.
 *
 * The four decision feedback kinds stay in FEEDBACK_KINDS as read-only history (no runner may post them, nothing writes
 * them), so the display readers keep recognising old rows. The retired words themselves are pinned by the slice's census,
 * tests/unit/lin-4529-retirement-census.test.js; this file pins what a word list cannot.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionNames } from '../helpers/collection-names.js';
import { INVENTORY } from '../../lib/account-erasure.js';
import { URLKEY_SOURCES } from '../../scripts/dry-run-urlkey-duplicates.mjs';
import { FEEDBACK_KINDS, FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-feedback-kinds.js';
import * as dispatchStore from '../../lib/dispatch-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The old ruling collections, now history: the task-bound rulings, the proposed dismissals, the shelves (LIN-4540). */
const HISTORY_COLLECTIONS = Object.freeze(['task-decisions', 'dismissal-suggestions', 'shelved-rulings']);

/** The files that may name them, each with its reason: the history tables an erasure and the dry run read. */
const NAMED_BY = Object.freeze({
  'lib/account-erasure.js': 'INVENTORY: a Full wipe still takes a workspace\'s old rulings',
  'scripts/dry-run-urlkey-duplicates.mjs': 'URLKEY_SOURCES: the no-holder count still reads the old rows\' urlKey',
});

/** The modules this piece deleted. */
const DELETED = Object.freeze([
  'lib/unanswered-decisions.js',
  'lib/task-decisions-store.js',
  'lib/dismissal-suggestions-store.js',
  'routes/proxy-rulings.js',
]);

/** Live code: what runs. Tests, docs and recorded fixtures are not code that reads a collection. */
const LIVE_ROOTS = ['lib', 'routes', 'public', 'scripts'];

function liveFiles() {
  const out = [join(ROOT, 'server.js')];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'node_modules' && name !== 'fixtures') walk(full); }
      else if (/\.(m?js|html)$/.test(name)) out.push(full);
    }
  };
  for (const root of LIVE_ROOTS) walk(join(ROOT, root));
  return out.map((full) => ({ file: relative(ROOT, full), text: readFileSync(full, 'utf8') }));
}

/** The files whose text names `collection` as a quoted string: `'name'`, `"name"` or `` `name` ``. Pure over the text. */
export function namersOf(files, collection) {
  const quoted = new RegExp(`['"\`]${collection.replace(/[-]/g, '\\-')}['"\`]`);
  return files.filter(({ text }) => quoted.test(text)).map(({ file }) => file).sort();
}

describe('LIN-4541: no code reads the old ruling collections; they stay as history', () => {
  const files = liveFiles();

  for (const collection of HISTORY_COLLECTIONS) {
    test(`${collection}: no module opens it (the collection universe derived from code does not hold it)`, () => {
      assert.equal(collectionNames().names.has(collection), false, `a collection('${collection}') opening came back`);
    });

    test(`${collection}: only the history tables name it, each with its reason`, () => {
      assert.deepEqual(namersOf(files, collection), Object.keys(NAMED_BY).sort());
    });

    test(`${collection}: still in INVENTORY with a history reason, and in URLKEY_SOURCES, so an erasure still reaches it`, () => {
      const row = INVENTORY.find((r) => r.collection === collection);
      assert.ok(row, 'INVENTORY lists it');
      assert.match(row.reason || '', /history/);
      assert.ok(URLKEY_SOURCES.some((s) => s.collection === collection), 'URLKEY_SOURCES lists it');
    });
  }

  test('the matcher sees each quoting, and only the exact name', () => {
    const sample = [
      { file: 'a.js', text: "db.collection('task-decisions')" },
      { file: 'b.js', text: 'const c = "dismissal-suggestions";' },
      { file: 'c.js', text: 'x(`task-decisions`)' },
      { file: 'd.js', text: '// the task-decisions collection is history' },
      { file: 'e.js', text: "'task-decisions-v2'" },
    ];
    assert.deepEqual(namersOf(sample, 'task-decisions'), ['a.js', 'c.js']);
    assert.deepEqual(namersOf(sample, 'dismissal-suggestions'), ['b.js']);
  });
});

describe('LIN-4541: the predicate, the stores, the rulings route and the decision writers are gone', () => {
  test('the deleted modules are not on disk', () => {
    assert.deepEqual(DELETED.filter((f) => existsSync(join(ROOT, f))), []);
  });

  test('the dispatch store has no decision writer and no settled-ruling check', () => {
    for (const name of ['markDecisionAnswered', 'markDecisionWithdrawn', 'markDecisionWithdrawalReversed', 'isDecisionSettled']) {
      assert.equal(typeof DispatchQueueStore.prototype[name], 'undefined', `${name} is gone`);
    }
    assert.equal('FEEDBACK_ENTRY_KINDS' in dispatchStore, false);
  });

  test('the four decision kinds stay as read-only history: rows on the table, none runner-postable', () => {
    const decisionRows = FEEDBACK_KINDS.filter((r) => r.kind.startsWith('decision'));
    assert.deepEqual(decisionRows.map((r) => r.kind).sort(), ['decision', 'decision-answer', 'decision-withdrawal-reversed', 'decision-withdrawn']);
    assert.ok(decisionRows.every((r) => r.runnerPostable === false));
    assert.deepEqual(FEEDBACK_ENTRY_KINDS.filter((k) => k.startsWith('decision')), []);
  });
});
