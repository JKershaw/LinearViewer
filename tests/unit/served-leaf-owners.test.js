/**
 * LIN-4471: every file the server serves to the browser through SHARED_MODULES (lib/vendor-assets.js) has a front-end
 * owner in the area registry, so the leaf is in an area that reads its notes and not the `^lib/` catch-all. A served file
 * with no owner is invisible to the area notes. The synthetic cases show the check fails on a missing or non-front-end
 * owner. Run with: node --test tests/unit/served-leaf-owners.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_MODULES } from '../../lib/vendor-assets.js';
import { areaOf, loadAreas } from './helpers/area-registry.js';

const FRONT_END = new Set(['front-end-browser', 'front-end-pages']);

/** Problems for `leaves` (served URL -> repo path) under `areas`: each leaf's first area must be a front-end one. */
function ownerProblems(leaves, areas) {
  const problems = [];
  for (const [url, path] of Object.entries(leaves)) {
    const area = areaOf(path, areas);
    if (!area) problems.push(`${url} (${path}) has no area: add a pattern to docs/areas/areas.json.`);
    else if (!FRONT_END.has(area.slug)) problems.push(`${url} (${path}) belongs to ${area.slug}, not a front-end area.`);
  }
  return problems;
}

describe('the served leaves have a front-end owner (LIN-4471)', () => {
  test('every SHARED_MODULES value maps to front-end-browser or front-end-pages', () => {
    assert.deepEqual(ownerProblems(SHARED_MODULES, loadAreas()), []);
  });

  test('a leaf with no owner is named (synthetic: the leaf is only in the catch-all)', () => {
    const areas = loadAreas().map((a) => (a.slug === 'front-end-pages' ? { ...a, match: [] } : a));
    const problems = ownerProblems({ '/lib/cost-format.js': 'lib/cost-format.js' }, areas);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /belongs to other-features|has no area/);
  });

  test('a leaf owned by a back-end area is named (synthetic)', () => {
    const problems = ownerProblems({ '/lib/vendor-assets.js': 'lib/vendor-assets.js' }, loadAreas());
    assert.match(problems[0], /belongs to platform-and-plumbing, not a front-end area/);
  });
});
