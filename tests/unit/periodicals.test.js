/**
 * Unit tests for lib/periodicals.js (LIN-341)
 *
 * Run with: node --test tests/unit/periodicals.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PERIODICALS, getPeriodicals, buildPeriodicalNodes } from '../../lib/periodicals.js';
import { PERIODICALS_PROJECT_ID } from '../../lib/tree.js';

describe('periodicals registry', () => {
  test('seeds exactly one template in v1', () => {
    assert.strictEqual(PERIODICALS.length, 1);
    assert.strictEqual(getPeriodicals(), PERIODICALS);
  });

  test('the single entry is Documentation Review (corrective)', () => {
    const doc = PERIODICALS[0];
    assert.strictEqual(doc.id, 'documentation-review');
    assert.strictEqual(doc.title, 'Documentation Review');
    assert.strictEqual(doc.mode, 'corrective');
    assert.strictEqual(typeof doc.generatePrompt, 'function');
  });

  test('every template carries the full shape, incl. mode/cadence/lastRunAt', () => {
    for (const t of PERIODICALS) {
      assert.ok(typeof t.id === 'string' && t.id.length > 0);
      assert.ok(typeof t.title === 'string' && t.title.length > 0);
      assert.ok(['corrective', 'advisory'].includes(t.mode));
      // Carried even though nothing consumes them yet (v1).
      assert.ok('cadence' in t);
      assert.ok('lastRunAt' in t);
      assert.strictEqual(typeof t.generatePrompt, 'function');
    }
  });
});

describe('Documentation Review generatePrompt()', () => {
  const prompt = PERIODICALS[0].generatePrompt();

  test('returns a non-trivial string', () => {
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 200);
  });

  test('is a task-generation prompt: create a task, then stop (does not do the review)', () => {
    // Names the periodical and its domain.
    assert.match(prompt, /Documentation Review/);
    assert.match(prompt, /documentation/i);
    // Instructs to create a Linear task and hand off rather than do the work here.
    assert.match(prompt, /Linear task/i);
    assert.match(prompt, /then stop|do not do the review/i);
  });

  test('stays general: no hard-coded proxy mechanics or doc-surface specifics', () => {
    // Proxy mechanics live in the appended +proxy guide, not the template.
    assert.doesNotMatch(prompt, /POST \/api\/proxy/);
    assert.doesNotMatch(prompt, /projectId/);
    assert.doesNotMatch(prompt, /GET \/api\/proxy/);
    // Doc surfaces are discovered by grounding at run time, not baked in here.
    assert.doesNotMatch(prompt, /formatStalenessCheck/);
    assert.doesNotMatch(prompt, /llms\.txt/);
    assert.doesNotMatch(prompt, /CLAUDE\.md/);
  });
});

describe('buildPeriodicalNodes()', () => {
  const nodes = buildPeriodicalNodes();

  test('produces one forest node per template', () => {
    assert.strictEqual(nodes.length, PERIODICALS.length);
  });

  test('each node is render-shaped (issue + children + depth + periodical)', () => {
    for (const node of nodes) {
      assert.ok(node.issue, 'has issue');
      assert.strictEqual(node.depth, 0);
      assert.deepStrictEqual(node.children, []);
      // Synthetic, app-only row: no Linear url/identifier.
      assert.strictEqual(node.issue.url, undefined);
      assert.strictEqual(node.issue.identifier, null);
      assert.ok(node.periodical, 'carries periodical metadata');
      assert.ok(node.periodical.prompt.length > 0, 'carries rendered prompt');
      assert.ok(['corrective', 'advisory'].includes(node.periodical.mode));
    }
  });

  test('node ids are not real-project shaped (stay under the synthetic group)', () => {
    // The group id itself is synthetic; node ids are template ids (no slashes/UUIDs).
    assert.strictEqual(PERIODICALS_PROJECT_ID, '__periodicals__');
    assert.strictEqual(nodes[0].issue.id, 'documentation-review');
  });
});
