/**
 * LIN-3210 (sub-task (c), beat 3): the LIN-3190 alarm-codes JSON is updated to
 * carry the new D5x count vocabulary (`doneLoggedAnyway`, `donePostFailed`,
 * `unresolved`) and the D7 buckets (`alarmed`, `unalarmed`, `parkedOnly`,
 * `alreadyEnded`), without rewriting the historical LIN-3190 hand calls.
 *
 * This test (a) pins the additive change — every original code keeps its
 * original fields (no deletion/rewrite), (b) cross-checks the documented
 * taxonomy against the implemented libs so the paper cannot drift from the
 * detector, and (c) requires every D5x/D7 code to carry a valid new label.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { classifyDonePosts } from '../../scripts/survey-hides-d5x-lib.mjs';
import { bucketCounts } from '../../scripts/survey-hides-d7-lib.mjs';

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..');
const J = JSON.parse(readFileSync(join(REPO, 'docs', 'papers', 'harbour', 'survey-check-10-alarm-codes.json'), 'utf8'));

const ORIGINAL_KEYS = ['id', 'det', 'at', 'code', 'why', 'sample'];
const D5X_COUNTS = ['doneLoggedAnyway', 'donePostFailed', 'unresolved'];
const D7_BUCKETS = ['alarmed', 'unalarmed', 'parkedOnly', 'alreadyEnded'];
const D5X_NEW = new Set([...D5X_COUNTS, 'healed', 'none']);

describe('survey-check-10-alarm-codes taxonomy (LIN-3210)', () => {
  test('every original code keeps its original fields (additive only)', () => {
    assert.ok(Array.isArray(J.codes));
    for (const c of J.codes) {
      for (const k of ORIGINAL_KEYS) assert.ok(k in c, `${c.id} keeps ${k}`);
    }
  });

  test('taxonomy.d7Buckets matches the implemented D7 buckets', () => {
    assert.deepEqual([...J.taxonomy.d7Buckets].sort(), Object.keys(bucketCounts([])).sort());
  });

  test('taxonomy.d5xCounts matches the implemented D5x counts', () => {
    assert.deepEqual([...J.taxonomy.d5xCounts].sort(), [...D5X_COUNTS].sort());
    const implemented = new Set(Object.keys(classifyDonePosts([], [])));
    for (const k of J.taxonomy.d5xCounts) assert.ok(implemented.has(k), `classifyDonePosts exposes ${k}`);
  });

  test('every D5x code carries a valid newCount', () => {
    const d5x = J.codes.filter((c) => c.det === 'D5x');
    assert.ok(d5x.length > 0);
    for (const c of d5x) assert.ok(D5X_NEW.has(c.newCount), `${c.id} newCount=${c.newCount}`);
    assert.equal(d5x.filter((c) => c.newCount === 'doneLoggedAnyway').length, 6, 'the old unconditional marker made each failed [done] a false done_posted');
    assert.equal(d5x.filter((c) => c.newCount === 'healed').length, 1, 'D5x-07 was re-posted later');
  });

  test('every D7 code is bucketed unalarmed (the before-state had no launch.duplicate channel)', () => {
    const d7 = J.codes.filter((c) => c.det === 'D7');
    assert.ok(d7.length > 0);
    for (const c of d7) {
      assert.ok(J.taxonomy.d7Buckets.includes(c.bucket), `${c.id} bucket=${c.bucket}`);
      assert.equal(c.bucket, 'unalarmed', `${c.id} predates the alarm`);
    }
  });
});
