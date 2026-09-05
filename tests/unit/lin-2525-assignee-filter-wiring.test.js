/**
 * LIN-2525: fetchAndPrepareProjects gains an `assigneeName` option, applied
 * ONCE — via lib/tree.js's expandToTreeContext (LIN-2524) — between the
 * isHiddenState filter and the three forest builders (buildForest,
 * buildInProgressForest, buildRecentActivityForest), so a matched issue keeps
 * its ancestor chain and descendants instead of being torn out of its tree
 * context. `availableAssignees` is computed off the pre-filter, team-scoped
 * `issues` array so the dropdown never shrinks once a filter is applied.
 *
 * server.js is not import-safe in a unit test (connects to Mongo, calls
 * app.listen() at module load — see lin-2521-resolve-team-selection-wiring's
 * header for the established precedent). This is a source-text pin proving
 * the WIRING and seam ordering; the actual filtering behavior (ancestor/
 * descendant preservation over real data) is exercised end-to-end once the
 * route wiring lands (LIN-2526) and the E2E fixture lands (LIN-2529).
 *
 * Run with: node --test tests/unit/lin-2525-assignee-filter-wiring.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function sliceFunction(name, signatureLine) {
  const startIdx = SERVER_SRC.indexOf(signatureLine);
  assert.notEqual(startIdx, -1, `expected to find ${name} in server.js`);
  const afterStart = startIdx + signatureLine.length;
  const nextDoc = SERVER_SRC.indexOf('\n/**', afterStart);
  const nextApp = SERVER_SRC.indexOf('\napp.', afterStart);
  const candidates = [nextDoc, nextApp].filter(i => i !== -1);
  assert.ok(candidates.length > 0, `expected to find the end of ${name}`);
  const endIdx = Math.min(...candidates);
  return SERVER_SRC.slice(startIdx, endIdx);
}

describe('LIN-2525 — fetchAndPrepareProjects assignee filtering wiring', () => {
  const body = sliceFunction(
    'fetchAndPrepareProjects',
    'async function fetchAndPrepareProjects(workspace, teamId = null, mockOverride = null, urlKey = null, { slim = false, assigneeName = null } = {}) {'
  );

  test('nodeKey and expandToTreeContext are imported from lib/tree.js, never reimplemented', () => {
    assert.match(SERVER_SRC, /import \{[^}]*\bexpandToTreeContext\b[^}]*\bnodeKey\b[^}]*\} from '\.\/lib\/tree\.js'/,
      'server.js must import expandToTreeContext and nodeKey from lib/tree.js');
  });

  test('availableAssignees is computed off the pre-filter issues array, before the assignee filter narrows it', () => {
    const availableIdx = body.indexOf('const availableAssignees =');
    const filterIdx = body.indexOf('if (assigneeName) {');
    assert.notEqual(availableIdx, -1, 'expected an availableAssignees computation');
    assert.notEqual(filterIdx, -1, 'expected an `if (assigneeName)` filter block');
    assert.ok(availableIdx < filterIdx, 'availableAssignees must be computed BEFORE the assignee filter runs');
  });

  test('the assignee filter runs once, after isHiddenState and before buildForest', () => {
    const hiddenStateIdx = body.indexOf('mergedIssues.filter(issue => !isHiddenState(issue))');
    const filterBlockIdx = body.indexOf('if (assigneeName) {');
    const buildForestIdx = body.indexOf('buildForest(issues)');
    assert.notEqual(hiddenStateIdx, -1);
    assert.notEqual(filterBlockIdx, -1);
    assert.notEqual(buildForestIdx, -1);
    assert.ok(hiddenStateIdx < filterBlockIdx && filterBlockIdx < buildForestIdx,
      'expected order: isHiddenState filter -> assignee filter -> buildForest, so all three forest builders see the same filtered `issues`');
  });

  test('matched ids are computed via nodeKey (never a raw issue.id) and expanded via expandToTreeContext', () => {
    assert.match(body, /new Set\(\s*issues\.filter\(issue => issue\.assignee\?\.name === assigneeName\)\.map\(nodeKey\)\s*\)/,
      'expected matchedIds built from issue.assignee?.name, keyed by nodeKey');
    assert.match(body, /expandToTreeContext\(issues, matchedIds\)/,
      'expected the matched set to be expanded via expandToTreeContext before the filter is applied');
    assert.doesNotMatch(body, /matchedIds = new Set\(\s*issues\.filter\([^)]*\)\.map\(i => i\.id\)/,
      'must not fall back to a raw issue.id walk (LIN-544)');
  });

  test('the assignee filter narrows `issues` exactly once, reassigning the same binding all three builders read', () => {
    const matches = [...body.matchAll(/issues = issues\.filter\(issue => relevantIds\.has\(nodeKey\(issue\)\)\)/g)];
    assert.equal(matches.length, 1, `expected exactly one assignee-narrowing filter, found ${matches.length}`);
  });

  test('availableAssignees is returned alongside the existing fields', () => {
    // LIN-2550 appended `appliedAssigneeName` — the filter this call actually
    // applied (null when an unmatched name degraded to unfiltered), which the
    // dashboard routes label the selector off.
    assert.match(body, /return \{ trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId: resolvedTeamId, periodicalsEnabled, showSource, truncated, availableAssignees, appliedAssigneeName \};/);
  });
});
