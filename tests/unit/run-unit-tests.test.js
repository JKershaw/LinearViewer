/**
 * scripts/run-unit-tests.mjs (LIN-3605): local concurrency cap, CI unchanged.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unitTestConcurrency, nodeTestArgs } from '../../scripts/run-unit-tests.mjs';

const script = fileURLToPath(new URL('../../scripts/run-unit-tests.mjs', import.meta.url));

describe('unitTestConcurrency', () => {
  test('override wins, even with CI set', () => {
    assert.equal(unitTestConcurrency({ env: { UNIT_TEST_CONCURRENCY: '3', CI: 'true' }, cpus: 8 }), 3);
  });
  for (const bad of ['0', '-1', 'abc', '2.5', ' 2']) {
    test(`invalid override "${bad}" is refused`, () => {
      assert.throws(() => unitTestConcurrency({ env: { UNIT_TEST_CONCURRENCY: bad }, cpus: 8 }), /positive integer/);
    });
  }
  test('empty override counts as unset', () => {
    assert.equal(unitTestConcurrency({ env: { UNIT_TEST_CONCURRENCY: '' }, cpus: 8 }), 4);
  });
  for (const ci of ['true', 'false', '1']) {
    test(`non-empty CI=${ci} gives no flag`, () => {
      assert.equal(unitTestConcurrency({ env: { CI: ci }, cpus: 8 }), undefined);
    });
  }
  test('unset or empty CI is local', () => {
    assert.equal(unitTestConcurrency({ env: {}, cpus: 8 }), 4);
    assert.equal(unitTestConcurrency({ env: { CI: '' }, cpus: 8 }), 4);
  });
  test('half the CPUs, floor of 1', () => {
    for (const [cpus, want] of [[1, 1], [2, 1], [3, 1], [8, 4], [16, 8]]) {
      assert.equal(unitTestConcurrency({ env: {}, cpus }), want, `cpus=${cpus}`);
    }
  });
});

describe('nodeTestArgs', () => {
  test('flag only when n is given; file order kept', () => {
    assert.deepEqual(nodeTestArgs(['b', 'a'], 4), ['--test', '--test-concurrency=4', 'b', 'a']);
    assert.deepEqual(nodeTestArgs(['b', 'a']), ['--test', 'b', 'a']);
  });
  test('throws on an empty file list', () => {
    assert.throws(() => nodeTestArgs([], 2), /no test files/);
  });
});

describe('wrapper spawned (dry run)', () => {
  const run = (extra) => {
    const env = { ...process.env, UNIT_TEST_DRY_RUN: '1', ...extra };
    delete env.UNIT_TEST_CONCURRENCY;
    if (extra.UNIT_TEST_CONCURRENCY) env.UNIT_TEST_CONCURRENCY = extra.UNIT_TEST_CONCURRENCY;
    return spawnSync(process.execPath, [script, 'x/a.test.js', 'x/b.test.js', 'x/c.test.mjs'], { env, encoding: 'utf8' });
  };
  test('CI=true: argv is exactly --test plus the files', () => {
    const r = run({ CI: 'true' });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), ['--test', 'x/a.test.js', 'x/b.test.js', 'x/c.test.mjs']);
    assert.equal(r.stderr, '');
  });
  test('local override adds the flag and logs it', () => {
    const r = run({ CI: '', UNIT_TEST_CONCURRENCY: '2' });
    assert.deepEqual(JSON.parse(r.stdout).slice(0, 2), ['--test', '--test-concurrency=2']);
    assert.match(r.stderr, /--test-concurrency=2/);
  });
  test('invalid override exits non-zero', () => {
    assert.notEqual(run({ UNIT_TEST_CONCURRENCY: 'abc' }).status, 0);
  });
});
