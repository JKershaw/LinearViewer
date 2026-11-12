// fit.test.mjs — LIN-4427. The statistics in fit.mjs, as pure functions on known data.
//
// Run by hand only:  node --test docs/papers/harbour/task-size-and-cost-scripts/fit.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, olsSimple, olsMulti, bootstrapSlope, bootstrapCoefs, readingOf, fitSeries } from './fit.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('OLS recovers an exact line and its standard error is zero on noiseless data', () => {
  const xs = [0, 1, 2, 3, 4, 5], ys = xs.map((x) => 1 + 0.5 * x);
  const f = olsSimple(xs, ys);
  close(f.slope, 0.5); close(f.intercept, 1); close(f.se, 0);
});

test('OLS has no slope when x has no spread', () => {
  assert.equal(olsSimple([2, 2, 2, 2], [1, 2, 3, 4]), null);
});

test('multi-regressor OLS recovers a quadratic in its design columns', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6];
  const b = olsMulti(xs.map((x) => [1, x, x * x]), xs.map((x) => 1 + 2 * x + 3 * x * x));
  close(b[0], 1, 1e-6); close(b[1], 2, 1e-6); close(b[2], 3, 1e-6);
});

test('mulberry32 is deterministic for a seed and yields values in [0, 1)', () => {
  const a = mulberry32(20261112), b = mulberry32(20261112);
  const seqA = Array.from({ length: 5 }, () => a()), seqB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, mulberry32(1)));
});

test('the bootstrap is reproducible for a seed, and on noiseless data its interval collapses onto the slope', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6, 7], ys = xs.map((x) => 0.7 * x - 2);
  const one = bootstrapSlope(xs, ys, { seed: 3, resamples: 200 });
  const two = bootstrapSlope(xs, ys, { seed: 3, resamples: 200 });
  assert.deepEqual(one, two);
  close(one.lo, 0.7, 1e-9); close(one.hi, 0.7, 1e-9);
});

test('bootstrapCoefs returns one interval per coefficient', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6, 7];
  const r = bootstrapCoefs(xs.map((x) => [1, x]), xs.map((x) => 2 + 0.5 * x), { seed: 9, resamples: 100 });
  assert.equal(r.ci.length, 2);
  close(r.ci[1][0], 0.5, 1e-6);
});

test('the reading: an interval holding 1 is a straight line; entirely below flattens; entirely above bends up', () => {
  assert.match(readingOf(1.02, 0.9, 1.15), /straight line/);
  assert.match(readingOf(0.3, 0.1, 0.5), /0\.30: flattens/);
  assert.match(readingOf(1.4, 1.2, 1.6), /bends up/);
  assert.equal(readingOf(null, null, null), 'no reading');
});

test('fitSeries drops and counts zero or null size and cost, and reports no slope below the minimum n', () => {
  const pts = [
    { ticket: 'a', marker: 'LinearViewer', size: 10, usd: 1 }, { ticket: 'b', marker: 'LinearViewer', size: 0, usd: 1 },
    { ticket: 'c', marker: 'simple-dispatcher', size: 100, usd: 0 }, { ticket: 'd', marker: 'LinearViewer', size: 100, usd: null },
    { ticket: 'e', marker: 'LinearViewer', size: 1000, usd: 10 },
  ];
  const f = fitSeries(pts, { seed: 1, resamples: 50, minN: 8 });
  assert.equal(f.n, 2);
  assert.deepEqual(f.dropped, { zeroOrNullSize: 1, zeroOrNullCost: 2 });
  assert.equal(f.slope, null);
  assert.match(f.reading, /n=2 < 8/);
  assert.equal(f.points.length, 2, 'points are still shown below the minimum n');
});

test('fitSeries reports the slope with its interval once n reaches the minimum', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ ticket: `t${i}`, marker: 'LinearViewer', size: 10 ** (i / 4 + 1), usd: 10 ** (0.5 * (i / 4 + 1) + 0.2) }));
  const f = fitSeries(pts, { seed: 4, resamples: 100, minN: 8 });
  close(f.slope, 0.5, 1e-9);
  assert.equal(f.n, 10);
  assert.equal(f.reading, '0.50: flattens');
});
