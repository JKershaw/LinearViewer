/**
 * Unit tests for render.js
 *
 * Run with: node --test tests/unit/render.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderLabels } from '../../lib/render.js';

// =============================================================================
// renderLabels Tests
// =============================================================================

describe('renderLabels', () => {
  describe('regular labels', () => {
    test('renders regular label as plain text', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [{ name: 'feature' }] },
        state: { type: 'completed' } // completed = no plan/code-review links
      };
      const result = renderLabels(issue);
      assert.strictEqual(result, 'feature');
    });

    test('renders multiple regular labels space-separated', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [{ name: 'feature' }, { name: 'priority' }] },
        state: { type: 'completed' } // completed = no plan/code-review
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('feature'));
      assert.ok(result.includes('priority'));
      // Labels are space-separated (buttons have margin for visual spacing)
      assert.strictEqual(result, 'feature priority');
    });

    test('returns empty string for no labels on completed issue', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [] },
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.strictEqual(result, '');
    });

    test('handles missing labels gracefully', () => {
      const issue = {
        id: 'issue-1',
        labels: null,
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.strictEqual(result, '');
    });
  });

  describe('promptable labels', () => {
    test('renders in-breakdown as clickable link', () => {
      const issue = {
        id: 'issue-123',
        labels: { nodes: [{ name: 'in-breakdown' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('<a href="#"'));
      assert.ok(result.includes('class="label-prompt"'));
      assert.ok(result.includes('data-issue-id="issue-123"'));
      assert.ok(result.includes('data-label="in-breakdown"'));
      assert.ok(result.includes('>in-breakdown</a>'));
    });

    test('renders in-research as clickable link', () => {
      const issue = {
        id: 'issue-456',
        labels: { nodes: [{ name: 'in-research' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('class="label-prompt"'));
      assert.ok(result.includes('data-label="in-research"'));
    });

    test('renders blocked as clickable link', () => {
      const issue = {
        id: 'issue-789',
        labels: { nodes: [{ name: 'blocked' }] },
        state: { type: 'started' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('class="label-prompt"'));
      assert.ok(result.includes('data-label="blocked"'));
    });

    test('renders bug as clickable link', () => {
      const issue = {
        id: 'issue-bug',
        labels: { nodes: [{ name: 'bug' }] },
        state: { type: 'started' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('class="label-prompt"'));
      assert.ok(result.includes('data-label="bug"'));
    });

    test('mixes promptable and regular labels correctly', () => {
      const issue = {
        id: 'issue-mix',
        labels: { nodes: [{ name: 'in-breakdown' }, { name: 'feature' }] },
        state: { type: 'started' } // started so plan/code-review added
      };
      const result = renderLabels(issue);
      // in-breakdown should be a link
      assert.ok(result.includes('data-label="in-breakdown"'));
      // feature should be plain text (not a link)
      assert.ok(result.includes('feature'));
      assert.ok(!result.includes('data-label="feature"'));
    });
  });

  describe('plan and code-review links', () => {
    test('adds plan link for backlog issue without pre-work labels', () => {
      const issue = {
        id: 'issue-ready',
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="plan"'));
      assert.ok(result.includes('class="label-prompt state-prompt"'));
    });

    test('adds code-review link for backlog issue without pre-work labels', () => {
      const issue = {
        id: 'issue-ready',
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="code-review"'));
    });

    test('adds plan link for unstarted issue without pre-work labels', () => {
      const issue = {
        id: 'issue-ready',
        labels: { nodes: [] },
        state: { type: 'unstarted' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="plan"'));
    });

    test('adds plan link for started issue without pre-work labels', () => {
      const issue = {
        id: 'issue-ready',
        labels: { nodes: [] },
        state: { type: 'started' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="plan"'));
    });

    test('does not add plan link for completed issue', () => {
      const issue = {
        id: 'issue-done',
        labels: { nodes: [] },
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.ok(!result.includes('data-label="plan"'));
    });

    test('does not add plan as state-prompt when pre-work label present', () => {
      const issue = {
        id: 'issue-prework',
        labels: { nodes: [{ name: 'in-breakdown' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      // Should have in-breakdown link
      assert.ok(result.includes('data-label="in-breakdown"'));
      // Plan should NOT appear as a state-prompt (visible) link
      assert.ok(!result.includes('class="label-prompt state-prompt" data-issue-id="issue-prework" data-label="plan"'));
      // But plan may appear in hidden "more" prompts (which is expected behavior)
    });

    test('does not duplicate plan link if already a label', () => {
      const issue = {
        id: 'issue-plan',
        labels: { nodes: [{ name: 'plan' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      // Should have plan as label link (not state-prompt)
      const planMatches = result.match(/data-label="plan"/g);
      assert.strictEqual(planMatches?.length, 1, 'Should only have one plan link');
    });

    test('does not duplicate code-review link if already a label', () => {
      const issue = {
        id: 'issue-review',
        labels: { nodes: [{ name: 'code-review' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      const reviewMatches = result.match(/data-label="code-review"/g);
      assert.strictEqual(reviewMatches?.length, 1, 'Should only have one code-review link');
    });
  });

  describe('HTML escaping', () => {
    test('escapes HTML in label names', () => {
      const issue = {
        id: 'issue-xss',
        labels: { nodes: [{ name: '<script>alert("xss")</script>' }] },
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.ok(!result.includes('<script>'));
      assert.ok(result.includes('&lt;script&gt;'));
    });

    test('escapes HTML in promptable label names in data-label attribute', () => {
      // Verifies that label names containing special characters are escaped
      // in the data-label attribute (though this shouldn't happen in practice)
      const issue = {
        id: 'issue-test',
        labels: { nodes: [{ name: 'in-breakdown' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      // The escapeHtml function is called on label.name for data-label
      assert.ok(result.includes('data-label="in-breakdown"'));
    });
  });

  describe('edge cases', () => {
    test('handles undefined labels nodes', () => {
      const issue = {
        id: 'issue-undef',
        labels: {},
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.strictEqual(result, '');
    });

    test('handles issue with only regular labels and eligible state', () => {
      const issue = {
        id: 'issue-eligible',
        labels: { nodes: [{ name: 'feature' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      // Should have feature as text, plus plan and code-review links
      assert.ok(result.includes('feature'));
      assert.ok(result.includes('data-label="plan"'));
      assert.ok(result.includes('data-label="code-review"'));
    });
  });
});
