/**
 * The one local-testing rule for implementation work (LIN-4441).
 *
 * Before LIN-4441 two implementation instructions told a worker to run the whole suite
 * ("Run tests to verify" in the workflow, "Verify all tests pass" in guideline 5). Now both
 * point at one section, "Test Before Pushing", rendered beside the CI gate. These tests read
 * fresh and fix-round renders and check that the targeted command appears once, that no
 * competing full-run instruction survives, that the no-CI substitute is still named, and that
 * review and close-out do not render the rule (their re-runs are a different job).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrompt } from '../../lib/prompt-templates.js';

const issue = { identifier: 'LIN-4441', title: 'Cut waiting on tests', description: 'd', state: { name: 'In Progress', type: 'started' } };
const ctx = (comments) => ({ parent: null, siblings: [], project: { name: 'P' }, children: [], comments, focusedChild: null });
const REQUEST_CHANGES = { createdAt: '2026-01-01T00:00:00Z', body: '## Review: LIN-4441 PR (#1)\n\nCI: green\n\n### Verdict\nRequest Changes — one finding' };

const FRESH = generatePrompt('implementation', issue, ctx([])).prompt;
const FIX_ROUND = generatePrompt('implementation', issue, ctx([REQUEST_CHANGES])).prompt;
const COMMAND = 'node scripts/run-unit-tests.mjs tests/unit/<files>';

describe('the implementation brief states the local-testing rule once (LIN-4441)', () => {
  for (const [label, prompt] of [['fresh start', FRESH], ['fix round', FIX_ROUND]]) {
    test(`${label}: the targeted command appears exactly once`, () => {
      assert.equal(prompt.split(COMMAND).length - 1, 1);
      assert.match(prompt, /never a bare `node --test` glob/);
    });

    test(`${label}: no competing full-run instruction survives`, () => {
      assert.doesNotMatch(prompt, /Run tests to verify/);
      assert.doesNotMatch(prompt, /Verify all tests pass/);
    });

    test(`${label}: the rule says CI is the full proof, and the no-CI substitute is still the full run`, () => {
      assert.match(prompt, /### Test Before Pushing/);
      assert.match(prompt, /Where CI exists it is the full proof: do not run the full suite locally before pushing/);
      assert.match(prompt, /### Establish CI \(or Its Substitute\)/);
      assert.match(prompt, /\*\*CI is genuinely absent:\*\* say so explicitly, then run the substitute/);
    });

    test(`${label}: workflow step 5 and guideline 5 both point at the one section`, () => {
      assert.match(prompt, /5\. \*\*Test\*\*: Run the tests that bear on .*, as set out under "Test Before Pushing" below/);
      assert.match(prompt, /5\. Test as set out under "Test Before Pushing" below/);
    });
  }

  test('the fix round keeps its own step 5 wording for the fixes', () => {
    assert.match(FIX_ROUND, /5\. \*\*Test\*\*: Run the tests that bear on the fixes, as set out under "Test Before Pushing" below/);
  });

  test('review and close-out do not render the rule, and keep their CI gate', () => {
    for (const kind of ['review', 'close-out']) {
      const prompt = generatePrompt(kind, issue, ctx([])).prompt;
      assert.doesNotMatch(prompt, /### Test Before Pushing/, kind);
      assert.doesNotMatch(prompt, /node scripts\/run-unit-tests\.mjs tests\/unit\/<files>/, kind);
      assert.match(prompt, /### Establish CI \(or Its Substitute\)/, kind);
    }
  });
});
