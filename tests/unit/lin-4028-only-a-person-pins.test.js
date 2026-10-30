/**
 * LIN-4028: only a person's press pins a routing ruling. A routing option's `routing` takes effect when
 * the answer stamp names its `option_id`, and that stamp is written by a person's own answer. A proxy
 * token can only suggest an answer (`suggest-answer`), so no proxy route may write the stamp.
 *
 * This pins the writers, not just today's behaviour: the set of files that call `markDecisionAnswered`
 * is exactly the two person-session routes. A new caller, in a proxy route or anywhere else, fails here
 * and has to be added to the list on purpose.
 *
 * Run with: node --test tests/unit/lin-4028-only-a-person-pins.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

function jsFilesIn(dir) {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return jsFilesIn(rel);
    return /\.m?js$/.test(entry.name) ? [rel] : [];
  });
}

// The dispatch store defines the method; it is not a caller of it.
const STORE = 'lib/dispatch-store.js';

// The person-session writers of an answer stamp: a dashboard press (dismiss) and the issue comment that
// carries a ruling's answer. Both sit behind the person's session, never a proxy token.
const PERSON_WRITERS = ['routes/dashboard-rulings.js', 'routes/workspace-api-issue-write.js'];

const callers = () => [...jsFilesIn('routes'), ...jsFilesIn('lib')]
  .filter((file) => file !== STORE)
  .filter((file) => readFileSync(join(REPO, file), 'utf8').includes('.markDecisionAnswered('))
  .sort();

describe('only a person\'s press writes an answer stamp (LIN-4028)', () => {
  test('the answer-stamp writers are exactly the person-session routes', () => {
    assert.deepEqual(callers(), [...PERSON_WRITERS].sort());
  });

  test('no proxy route, and no dispatch-entrance code, writes an answer stamp', () => {
    const proxyish = callers().filter((file) => /proxy|dispatch-entrance/.test(file));
    assert.deepEqual(proxyish, [], 'a proxy token must suggest an answer (suggest-answer), never stamp one');
  });
});
