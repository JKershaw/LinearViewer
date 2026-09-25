/**
 * scripts/lin3014/lib/exemptions.mjs (LIN-3014)
 *
 * `stripPaths` removes exactly the loop-output paths exemptions 1-5 name
 * (research beat 2 L-D, proved complete on real mongod in beat 3), without
 * disturbing anything else — over-stripping would hide a real regression,
 * under-stripping would fail on a difference the plan already accepts.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { LOOP_EXEMPTIONS, SESSION_LOOP_EXEMPTIONS, stripPaths } from '../../scripts/lin3014/lib/exemptions.mjs';

test('LIN-3014 stripPaths: removes each of the 5 loop exemptions and leaves everything else intact', () => {
  const loop = {
    loopId: 'l1',
    terminalStatus: 'completed',
    promptText: 'the full prompt',
    feedback: [{ kind: 'status', message: 'x' }],
    toolPeak: 4,
    telemetry: { metrics: [{ ts: 1 }], runtime: { model: 'x' } },
    lineageMetrics: [{ ts: 1 }]
  };
  const stripped = stripPaths(loop, LOOP_EXEMPTIONS);
  assert.strictEqual(stripped.loopId, 'l1');
  assert.strictEqual(stripped.terminalStatus, 'completed');
  assert.strictEqual('promptText' in stripped, false);
  assert.strictEqual('feedback' in stripped, false);
  assert.strictEqual('toolPeak' in stripped, false);
  assert.strictEqual('lineageMetrics' in stripped, false);
  assert.strictEqual('metrics' in stripped.telemetry, false, 'only telemetry.metrics is exempt, not all of telemetry');
  assert.deepStrictEqual(stripped.telemetry.runtime, { model: 'x' }, 'telemetry.runtime must survive — not part of any exemption');
});

test('LIN-3014 stripPaths: does not mutate the original object', () => {
  const loop = { toolPeak: 4, telemetry: { metrics: [1] } };
  stripPaths(loop, LOOP_EXEMPTIONS);
  assert.strictEqual(loop.toolPeak, 4, 'the input object must be untouched');
  assert.deepStrictEqual(loop.telemetry.metrics, [1]);
});

test('LIN-3014 stripPaths: a missing field along the path is a no-op, not a throw', () => {
  const loop = { loopId: 'l2' }; // no telemetry at all
  assert.doesNotThrow(() => stripPaths(loop, LOOP_EXEMPTIONS));
  const stripped = stripPaths(loop, LOOP_EXEMPTIONS);
  assert.deepStrictEqual(stripped, { loopId: 'l2' });
});

test('LIN-3014 stripPaths: array-segment paths (SESSION_LOOP_EXEMPTIONS) strip the exemptions inside every loops[] entry', () => {
  const session = {
    sessionId: 's1',
    loops: [
      { loopId: 'a', toolPeak: 1, telemetry: { metrics: [1], runtime: {} } },
      { loopId: 'b', toolPeak: 2, telemetry: { metrics: [2], runtime: {} } }
    ],
    telemetry: { runtime: { model: 'y' } } // session-level telemetry — NOT under loops[], must survive untouched
  };
  const stripped = stripPaths(session, SESSION_LOOP_EXEMPTIONS);
  assert.strictEqual('toolPeak' in stripped.loops[0], false);
  assert.strictEqual('toolPeak' in stripped.loops[1], false);
  assert.strictEqual('metrics' in stripped.loops[0].telemetry, false);
  assert.deepStrictEqual(stripped.telemetry, { runtime: { model: 'y' } }, 'session-level telemetry is a sibling of loops[], not inside it — must be untouched');
});
