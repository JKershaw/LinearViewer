/**
 * LIN-3949 — the clock-shift preload (tests/fixtures/clock-shift.js) keeps the
 * three properties the sweep depends on, and does nothing unless asked.
 *
 * Each property runs in a child process started with `--import`, the way
 * `npm run test:clock-shift` and `scripts/assert-unit-suite-hermetic.mjs` load
 * it. The self-check at the bottom runs in THIS process: when CLOCK_SHIFT_DAYS
 * is set, this process must be shifted by it, so a CI run that drops the
 * `--import` fails here rather than reading as a clean unshifted pass.
 *
 * Run with: node --test tests/unit/clock-shift.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIM = join(ROOT, 'tests', 'fixtures', 'clock-shift.js');
const DAY = 864e5;
// Child start-up plus a scheduling tick; a shift is whole days, so this is loose.
const SLACK = 60e3;
// performance.* is not shifted by the shim, so this is the real wall clock.
const REAL = 'performance.timeOrigin + performance.now()';

// Runs `code` in a child with the shim loaded. NODE_OPTIONS and CLOCK_SHIFT_DAYS
// are stripped first, so an outer run's own shim or watcher cannot leak in and
// double-shift the child.
function run(code, { days } = {}) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.CLOCK_SHIFT_DAYS;
  if (days !== undefined) env.CLOCK_SHIFT_DAYS = String(days);
  const res = spawnSync(process.execPath, ['--import', SHIM, '-e', code], { env, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

describe('LIN-3949: the clock-shift preload', () => {
  test('Date.now() runs CLOCK_SHIFT_DAYS ahead of the real clock', () => {
    const offset = Number(run(`console.log(Date.now() - (${REAL}))`, { days: 400 }));
    assert.ok(Math.abs(offset - 400 * DAY) < SLACK, `offset ${offset} ms`);
  });

  test('argless new Date() is a real Date (same prototype, deepStrictEqual holds) at the shifted time', () => {
    const offset = Number(run(`
      const assert = require('node:assert/strict');
      const a = new Date();
      assert.ok(a instanceof Date);
      assert.equal(Object.getPrototypeOf(a), Date.prototype);
      assert.deepStrictEqual(a, new Date(a.getTime()));
      console.log(a.getTime() - (${REAL}));
    `, { days: 400 }));
    assert.ok(Math.abs(offset - 400 * DAY) < SLACK, `offset ${offset} ms`);
  });

  test('a Date.now stub is honoured, and argless new Date() follows it', () => {
    const out = run(`
      Date.now = () => 1234;
      console.log(JSON.stringify([Date.now(), new Date().getTime()]));
    `, { days: 400 });
    assert.deepEqual(JSON.parse(out), [1234, 1234]);
  });

  test('a vm context reads the shifted clock, from runInNewContext and from createContext', () => {
    const out = run(`
      const vm = require('node:vm');
      const real = ${REAL};
      const fromNew = vm.runInNewContext('Date.now()');
      const ctx = vm.createContext({});
      const fromCreate = vm.runInContext('new Date().getTime()', ctx);
      console.log(JSON.stringify([fromNew - real, fromCreate - real]));
    `, { days: 400 });
    for (const offset of JSON.parse(out)) {
      assert.ok(Math.abs(offset - 400 * DAY) < SLACK, `offset ${offset} ms`);
    }
  });

  test('with CLOCK_SHIFT_DAYS unset or 0 the shim changes nothing', () => {
    for (const days of [undefined, 0]) {
      const offset = Number(run(`console.log(Date.now() - (${REAL}))`, { days }));
      assert.ok(Math.abs(offset) < SLACK, `days=${days}: offset ${offset} ms`);
    }
  });
});

describe('LIN-3949: this process is shifted when CLOCK_SHIFT_DAYS says so', () => {
  test('the --import reached this process', () => {
    const days = Number(process.env.CLOCK_SHIFT_DAYS || 0);
    const offset = Date.now() - (performance.timeOrigin + performance.now());
    assert.ok(
      Math.abs(offset - days * DAY) < SLACK,
      `CLOCK_SHIFT_DAYS=${days} but this process is offset ${offset} ms: the --import did not reach it`
    );
  });
});
