/**
 * The flake survey's job-name patterns know the proxy unit arm (LIN-4441).
 *
 * scripts/survey-flakes-sessions.mjs runs its survey on import, so its patterns are read from
 * the source here rather than imported. A red run in the new job must count as a unit failure,
 * and the name must be matched whole in both places the survey reads CI text: flat JSON check
 * objects (JOB_EXACT) and `gh pr checks`-style lines (JOB_G). Without the change, the prefix
 * "Unit tests" would match and the rest of the name would be left as status text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../scripts/survey-flakes-sessions.mjs', import.meta.url), 'utf8');
// The four pattern lines, evaluated as written: UNIT_JOB is the one spelling of the unit-job name.
const block = /^const UNIT_JOB = [\s\S]*?^const UNIT_EXACT = .*$/m.exec(src);
assert.ok(block, 'the UNIT_JOB..UNIT_EXACT block is in survey-flakes-sessions.mjs');
const { JOB_G, JOB_EXACT, UNIT_EXACT: UNIT_FAIL } = new Function(`${block[0]}\nreturn { JOB_G, JOB_EXACT, UNIT_EXACT };`)();
assert.match(src, /if \(UNIT_EXACT\.test\(i\.job\) && i\.status === 'fail'\) g\.unitFail = true;/, 'the unit-failure check reads UNIT_EXACT');

const PROXY = 'Unit tests (proxy, clock +400d)';

test('the exact-name check (flat JSON check-run objects) takes both unit jobs and nothing looser', () => {
  for (const name of ['Unit tests', PROXY, 'CI success', 'E2E shard 2/4', 'Secret scan (source)']) {
    assert.ok(JOB_EXACT.test(name), name);
  }
  for (const name of ['Unit tests (proxy', `${PROXY} extra`, 'Unit tests (keyed)']) {
    assert.ok(!JOB_EXACT.test(name), name);
  }
});

test('the text check (gh pr checks lines) matches the whole proxy name, not its prefix', () => {
  const line = `${PROXY}\tfail\t3m\thttps://github.com/JKershaw/LinearViewer/actions/runs/123/job/456`;
  const hits = [...line.matchAll(JOB_G)].map((m) => m[0]);
  assert.deepEqual(hits, [PROXY]);
  assert.deepEqual([...'Unit tests\tpass'.matchAll(JOB_G)].map((m) => m[0]), ['Unit tests']);
});

test('a red proxy-arm job counts as a unit failure, as the keyed arm always has', () => {
  assert.ok(UNIT_FAIL.test('Unit tests'));
  assert.ok(UNIT_FAIL.test(PROXY));
  assert.ok(!UNIT_FAIL.test('E2E shard 1/4'));
  assert.ok(!UNIT_FAIL.test('CI success'));
});
