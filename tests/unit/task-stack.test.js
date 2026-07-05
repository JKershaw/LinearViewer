// Characterization + unit tests for the extracted task-stack pipeline (LIN-1026).
//
// Run with: node --test tests/unit/task-stack.test.js
//
// `buildTaskStack` was extracted verbatim from the inlined `/api/proxy/stack`
// route handler so the route and the read-only `get_stack` chat tool share one
// projection. These tests pin the wire contract (digest + full shapes, ordering
// determinism, limit slicing, the deterministic headline, the limit clamp) so
// the extraction is provably behavior-preserving. The fixture is exactly what
// the route feeds in test mode (`getTestMockData()` → raw Linear-shaped issues),
// so this exercises the same input path as the route.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildTaskStack,
  clampStackLimit,
  toStackHeadline,
  STACK_HEADLINE_MAX,
} from '../../lib/task-stack.js';
import { testMockData } from '../fixtures/mock-data.js';

// buildTaskStack MUTATES its inputs (pushes a synthetic "No Project", stamps
// parent/children + graph features onto issues), exactly as the route did. Give
// every call a fresh deep clone so tests don't leak state into each other.
function freshInput() {
  return {
    projects: structuredClone(testMockData.projects),
    issues: structuredClone(testMockData.issues),
  };
}

describe('clampStackLimit', () => {
  test('defaults to 5 for absent/invalid input', () => {
    assert.strictEqual(clampStackLimit(undefined), 5);
    assert.strictEqual(clampStackLimit(null), 5);
    assert.strictEqual(clampStackLimit(NaN), 5);
    assert.strictEqual(clampStackLimit('not-a-number'), 5);
  });

  test('clamps to the 1-50 window', () => {
    assert.strictEqual(clampStackLimit(0), 1);
    assert.strictEqual(clampStackLimit(-3), 1);
    assert.strictEqual(clampStackLimit(999), 50);
    assert.strictEqual(clampStackLimit(50), 50);
    assert.strictEqual(clampStackLimit(1), 1);
  });

  test('parses and truncates numeric strings', () => {
    assert.strictEqual(clampStackLimit('7'), 7);
    assert.strictEqual(clampStackLimit(3.9), 3);
  });
});

describe('toStackHeadline', () => {
  test('takes the first non-empty line', () => {
    assert.strictEqual(toStackHeadline('\n\n  Hello world  \nsecond line'), 'Hello world');
  });

  test('returns empty string for empty/non-string input', () => {
    assert.strictEqual(toStackHeadline(''), '');
    assert.strictEqual(toStackHeadline(null), '');
    assert.strictEqual(toStackHeadline(undefined), '');
    assert.strictEqual(toStackHeadline(42), '');
  });

  test('truncates a long first line with an ellipsis at the bound', () => {
    const long = 'x'.repeat(STACK_HEADLINE_MAX + 50);
    const out = toStackHeadline(long);
    assert.strictEqual(out.length, STACK_HEADLINE_MAX);
    assert.ok(out.endsWith('…'));
  });
});

describe('buildTaskStack — projection contract', () => {
  test('full view carries descriptions and array fields; digest drops them for counts', () => {
    const full = buildTaskStack({ ...freshInput(), limit: 10, view: 'full' });
    const digest = buildTaskStack({ ...freshInput(), limit: 10, view: 'digest' });

    assert.strictEqual(full.view, 'full');
    assert.strictEqual(digest.view, 'digest');

    for (const t of full.tasks) {
      assert.ok('description' in t, 'full row keeps description');
      assert.ok(Array.isArray(t.children), 'full children is an array');
      assert.ok(Array.isArray(t.blocksIds), 'full blocksIds is an array');
      assert.strictEqual(t.headline, undefined, 'full row has no headline');
    }
    for (const t of digest.tasks) {
      assert.strictEqual(t.description, undefined, 'digest drops description');
      assert.strictEqual(typeof t.headline, 'string', 'digest has a headline string');
      assert.strictEqual(typeof t.children, 'number', 'digest children is a count');
      assert.strictEqual(typeof t.blocks, 'number', 'digest blocks is a count');
      assert.ok('why' in t, 'digest carries the explainability why');
    }
  });

  test('full and digest agree on ordering and shared scalar features', () => {
    const full = buildTaskStack({ ...freshInput(), limit: 10, view: 'full' });
    const digest = buildTaskStack({ ...freshInput(), limit: 10, view: 'digest' });

    // Same sort pipeline → same identifiers in the same order.
    assert.deepStrictEqual(
      full.tasks.map(t => t.identifier),
      digest.tasks.map(t => t.identifier),
    );

    const digestById = new Map(digest.tasks.map(t => [t.id, t]));
    for (const f of full.tasks) {
      const d = digestById.get(f.id);
      assert.ok(d, `digest has ${f.identifier}`);
      assert.strictEqual(f.downstreamUnblocks, d.downstreamUnblocks);
      assert.strictEqual(f.criticalPathLen, d.criticalPathLen);
      assert.strictEqual(f.priority, d.priority);
      assert.deepStrictEqual(f.state, d.state);
    }
  });

  test('digest headline is the first non-empty description line', () => {
    const digest = buildTaskStack({ ...freshInput(), limit: 50, view: 'digest' });
    const byId = new Map(digest.tasks.map(t => [t.identifier, t]));
    // TEST-1's description is 'This is a parent task' (single line).
    const t1 = byId.get('TEST-1');
    if (t1) assert.strictEqual(t1.headline, 'This is a parent task');
  });

  test('is deterministic — repeated calls yield identical ordering', () => {
    const a = buildTaskStack({ ...freshInput(), limit: 50, view: 'digest' });
    const b = buildTaskStack({ ...freshInput(), limit: 50, view: 'digest' });
    assert.deepStrictEqual(a.tasks.map(t => t.identifier), b.tasks.map(t => t.identifier));
    assert.strictEqual(a.total, b.total);
  });

  test('total reflects the full sorted stack; tasks are sliced to the limit', () => {
    const all = buildTaskStack({ ...freshInput(), limit: 50, view: 'digest' });
    assert.ok(all.total > 0);
    assert.strictEqual(all.tasks.length, Math.min(all.total, 50));

    const limited = buildTaskStack({ ...freshInput(), limit: 2, view: 'digest' });
    assert.strictEqual(limited.total, all.total, 'total is independent of the slice');
    assert.strictEqual(limited.tasks.length, Math.min(2, all.total));
    // The slice is a prefix of the full ordering.
    assert.deepStrictEqual(
      limited.tasks.map(t => t.identifier),
      all.tasks.slice(0, limited.tasks.length).map(t => t.identifier),
    );
  });

  test('view defaults to full and limit defaults to 5', () => {
    const out = buildTaskStack(freshInput());
    assert.strictEqual(out.view, 'full');
    assert.ok(out.tasks.length <= 5);
    assert.ok('description' in (out.tasks[0] || { description: null }));
  });

  test('terminal (completed) tasks are excluded from the stack', () => {
    const out = buildTaskStack({ ...freshInput(), limit: 50, view: 'digest' });
    const ids = new Set(out.tasks.map(t => t.identifier));
    // TEST-3 is Done/completed with no open children — never a stack candidate.
    assert.ok(!ids.has('TEST-3'), 'completed TEST-3 is not in the stack');
  });
});
