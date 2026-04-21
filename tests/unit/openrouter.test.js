/**
 * Unit tests for openrouter.js
 *
 * Run with: node --test tests/unit/openrouter.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { stripCodeBlockMarkers, formatSubtaskOverview } from '../../lib/openrouter.js';

// =============================================================================
// stripCodeBlockMarkers Tests
// =============================================================================

describe('stripCodeBlockMarkers', () => {
  test('returns null for null input', () => {
    assert.strictEqual(stripCodeBlockMarkers(null), null);
  });

  test('returns undefined for undefined input', () => {
    assert.strictEqual(stripCodeBlockMarkers(undefined), undefined);
  });

  test('returns empty string for empty input', () => {
    assert.strictEqual(stripCodeBlockMarkers(''), '');
  });

  test('returns text unchanged when no code blocks present', () => {
    const input = '# Implement LIN-64\n\n## Goal\n\nFix the bug.';
    assert.strictEqual(stripCodeBlockMarkers(input), input);
  });

  test('strips opening and closing triple backticks', () => {
    const input = '```\n# Implement LIN-64\n\n## Goal\n\nFix the bug.\n```';
    const expected = '# Implement LIN-64\n\n## Goal\n\nFix the bug.';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('strips backticks with language specifier', () => {
    const input = '```markdown\n# Implement LIN-64\n\n## Goal\n\nFix the bug.\n```';
    const expected = '# Implement LIN-64\n\n## Goal\n\nFix the bug.';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('strips backticks with various language specifiers', () => {
    const variations = ['```md\n', '```text\n', '```txt\n', '```plaintext\n'];
    const content = '# Implement LIN-64';

    for (const prefix of variations) {
      const input = `${prefix}${content}\n\`\`\``;
      assert.strictEqual(stripCodeBlockMarkers(input), content);
    }
  });

  test('handles backticks without newline after opening', () => {
    const input = '```# Implement LIN-64\n```';
    const expected = '# Implement LIN-64';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('handles backticks without newline before closing', () => {
    const input = '```\n# Implement LIN-64```';
    const expected = '# Implement LIN-64';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });

  test('does not strip backticks in the middle of text', () => {
    const input = '# Implement\n\n```javascript\nconst x = 1;\n```\n\n## Goal';
    // Only opening backticks at start should be stripped, not internal ones
    assert.strictEqual(stripCodeBlockMarkers(input), input);
  });

  test('only strips one pair of markers', () => {
    const input = '```\n```\n# Implement\n```\n```';
    // Strips outer pair, leaves inner backticks
    const expected = '```\n# Implement\n```';
    assert.strictEqual(stripCodeBlockMarkers(input), expected);
  });
});

// =============================================================================
// formatSubtaskOverview Tests
// =============================================================================

describe('formatSubtaskOverview', () => {
  test('returns empty string for empty array', () => {
    assert.strictEqual(formatSubtaskOverview([], 'focus-id'), '');
  });

  test('shows done subtasks with checkmark', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'canceled' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('✓ Done: LIN-1, LIN-2'));
  });

  test('shows remaining subtasks with circle', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'backlog' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('○ Remaining: LIN-1, LIN-2'));
  });

  test('marks focused subtask with arrow', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } }
    ];
    const result = formatSubtaskOverview(children, '2');
    assert.ok(result.includes('→ LIN-2'));
    assert.ok(!result.includes('→ LIN-1'));
  });

  test('shows in-progress status for started subtasks', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'started' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('LIN-1 (in progress)'));
  });

  test('groups completed and remaining separately', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'completed' } },
      { id: '2', identifier: 'LIN-2', state: { type: 'unstarted' } },
      { id: '3', identifier: 'LIN-3', state: { type: 'started' } }
    ];
    const result = formatSubtaskOverview(children, '2');
    const lines = result.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0].includes('✓ Done: LIN-1'));
    assert.ok(lines[1].includes('○ Remaining:'));
    assert.ok(lines[1].includes('→ LIN-2'));
    assert.ok(lines[1].includes('LIN-3 (in progress)'));
  });

  test('handles only completed subtasks', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'completed' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(result.includes('✓ Done: LIN-1'));
    assert.ok(!result.includes('○ Remaining'));
  });

  test('handles only remaining subtasks', () => {
    const children = [
      { id: '1', identifier: 'LIN-1', state: { type: 'unstarted' } }
    ];
    const result = formatSubtaskOverview(children, null);
    assert.ok(!result.includes('✓ Done'));
    assert.ok(result.includes('○ Remaining: LIN-1'));
  });
});
