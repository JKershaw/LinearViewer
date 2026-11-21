/**
 * LIN-4514 (P1 of LIN-4513): re-running the capture reproduces the committed goldens byte for byte.
 *
 * tests/helpers/comment-path-capture.js derives every file under tests/fixtures/walk-8/comment-path/goldens/ and
 * rows.json from the frozen inputs beside them (the three walk-8 tickets, the rows of lin-4438/4458/4460, the five
 * seeds, and the landings the readings read). This test reruns it now, over the code as it is, and compares each file's
 * bytes with the committed ones. On a difference it names the file, the first differing line and column, and both
 * lines. So the goldens can only change with the code that decides them, and only by rerunning the helper:
 *   node tests/helpers/comment-path-capture.js --write
 * The helper uses no clock and no network, so the bytes do not depend on when, where or in which timezone it runs.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4514-comment-path-rerun.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { captureAll, firstDifference, FIXTURE_DIR } from '../helpers/comment-path-capture.js';

let rerun;
before(async () => { rerun = await captureAll(); });

const committed = (path) => readFileSync(new URL(path, FIXTURE_DIR), 'utf8');

describe('the capture reruns to the committed goldens, byte for byte (LIN-4514)', () => {
  test('the derived files are exactly the committed ones: none missing, none stray', () => {
    const onDisk = ['rows.json', ...readdirSync(new URL('goldens/', FIXTURE_DIR)).map((f) => `goldens/${f}`)].sort();
    assert.deepEqual(Object.keys(rerun).sort(), onDisk);
  });

  for (const path of ['goldens/lin-4469.json', 'goldens/lin-4446.json', 'goldens/lin-4450.json', 'rows.json', 'goldens/seeds.json', 'goldens/readings.json']) {
    test(`${path} is byte-identical to its rerun`, () => {
      const want = committed(path);
      const got = rerun[path];
      const diff = firstDifference(want, got);
      if (diff) {
        assert.fail(`${path} differs from its rerun at line ${diff.line}, column ${diff.column} (committed ${diff.committedLines} lines, rerun ${diff.rerunLines}):\n  committed: ${diff.committed}\n  rerun:     ${diff.rerun}\nIf the code's decision changed on purpose, rerun: node tests/helpers/comment-path-capture.js --write`);
      }
      assert.equal(Buffer.byteLength(got), Buffer.byteLength(want));
    });
  }
});
