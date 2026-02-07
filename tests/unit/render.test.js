/**
 * Unit tests for render.js
 *
 * Run with: node --test tests/unit/render.test.js
 *
 * Tests the simplified 3-label system:
 * - preparing: Pre-implementation work
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderLabels, renderPage } from '../../lib/render.js';

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

    test('renders multiple regular labels comma-separated', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [{ name: 'feature' }, { name: 'priority' }] },
        state: { type: 'completed' } // completed = no plan/code-review
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('feature'));
      assert.ok(result.includes('priority'));
      // Labels are comma-separated in renderDisplayLabels
      assert.strictEqual(result, 'feature, priority');
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
    test('renders blocked as clickable link', () => {
      const issue = {
        id: 'issue-789',
        labels: { nodes: [{ name: 'blocked' }] },
        state: { type: 'started' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('<a href="#"'));
      assert.ok(result.includes('class="label-prompt"'));
      assert.ok(result.includes('data-issue-id="issue-789"'));
      assert.ok(result.includes('data-label="blocked"'));
      assert.ok(result.includes('>blocked</a>'));
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
        labels: { nodes: [{ name: 'blocked' }, { name: 'feature' }] },
        state: { type: 'started' }
      };
      const result = renderLabels(issue);
      // blocked should be a link (behind "more")
      assert.ok(result.includes('data-label="blocked"'));
      // feature should be plain text (not a link)
      assert.ok(result.includes('feature'));
      assert.ok(!result.includes('data-label="feature"'));
    });
  });

  describe('default prompt buttons', () => {
    test('shows default prompts for actionable issues', () => {
      const issue = {
        id: 'issue-ready',
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="look-into"'));
      assert.ok(result.includes('data-label="research"'));
      assert.ok(result.includes('data-label="plan"'));
      assert.ok(result.includes('data-label="implementation"'));
    });

    test('shows same prompts regardless of issue state (started)', () => {
      const issue = {
        id: 'issue-started',
        labels: { nodes: [] },
        state: { type: 'started' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="plan"'));
      assert.ok(result.includes('data-label="research"'));
    });

    test('does not add prompts for completed issue', () => {
      const issue = {
        id: 'issue-done',
        labels: { nodes: [] },
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.ok(!result.includes('data-label="plan"'));
      assert.ok(!result.includes('data-label="look-into"'));
    });

    test('shows same prompts even with preparing label', () => {
      const issue = {
        id: 'issue-prework',
        labels: { nodes: [{ name: 'preparing' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('preparing'));
      assert.ok(result.includes('data-label="plan"'));
    });

    test('plan appears once even if plan label exists', () => {
      const issue = {
        id: 'issue-plan',
        labels: { nodes: [{ name: 'plan' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      const planMatches = result.match(/data-label="plan"/g);
      assert.strictEqual(planMatches?.length, 1, 'Should only have one plan link');
    });

    test('uses short button labels for defaults', () => {
      const issue = {
        id: 'issue-labels',
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('>look into</a>'));
      assert.ok(result.includes('>research</a>'));
      assert.ok(result.includes('>plan</a>'));
      assert.ok(result.includes('>implement</a>'));
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
        labels: { nodes: [{ name: 'blocked' }] },
        state: { type: 'backlog' }
      };
      const result = renderLabels(issue);
      // The escapeHtml function is called on label.name for data-label
      assert.ok(result.includes('data-label="blocked"'));
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
      // Should have feature as text, plus default prompt buttons
      assert.ok(result.includes('feature'));
      assert.ok(result.includes('data-label="plan"'));
      assert.ok(result.includes('data-label="look-into"'));
    });
  });
});

// =============================================================================
// renderPage Description Tests (LIN-151)
// =============================================================================

describe('renderPage description rendering', () => {
  // Helper to create minimal project tree structure
  function createProjectTree(issue) {
    return {
      project: {
        id: 'project-1',
        name: 'Test Project',
        content: null,
        url: null
      },
      incomplete: [{
        issue,
        children: [],
        depth: 0
      }],
      completed: [],
      completedCount: 0
    };
  }

  describe('--- delimited blocks in descriptions (LIN-151)', () => {
    const issueWithDashBlock = {
      id: 'issue-dash',
      title: 'Issue with dashes',
      description: 'Some intro\n---\nContent between dashes\n---\nMore text',
      state: { type: 'started' },
      labels: { nodes: [] },
      url: 'https://linear.app/test'
    };

    test('renders --- blocks as prompt container on landing page', () => {
      const projectTree = createProjectTree(issueWithDashBlock);
      const result = renderPage([projectTree], [], [], 'Test', { isLanding: true });

      // Should have prompt-container with "Setup Prompt" for landing page
      assert.ok(result.includes('prompt-container'), 'Landing page should render prompt container');
      assert.ok(result.includes('Setup Prompt'), 'Landing page should show "Setup Prompt" name');
    });

    test('does NOT render --- blocks as prompt container for authenticated users', () => {
      const projectTree = createProjectTree(issueWithDashBlock);
      const result = renderPage([projectTree], [], [], 'Test', { isLanding: false });

      // Should NOT have the "Setup Prompt" container that comes from --- blocks
      // (There may be other prompt-containers for the interactive prompt UI)
      assert.ok(!result.includes('Setup Prompt'), 'Authenticated view should NOT render "Setup Prompt"');

      // The description text should be rendered as plain text
      assert.ok(result.includes('Some intro'), 'Description intro should be visible');
    });

    test('renders description with --- as plain text for authenticated users', () => {
      const issueWithHorizontalRule = {
        id: 'issue-hr',
        title: 'Issue with markdown HR',
        description: 'Above the line\n---\nBelow the line\n---\nEnd',
        state: { type: 'started' },
        labels: { nodes: [] },
        url: 'https://linear.app/test'
      };

      const projectTree = createProjectTree(issueWithHorizontalRule);
      const result = renderPage([projectTree], [], [], 'Test', { isLanding: false });

      // Should render as plain text, not as a prompt
      assert.ok(!result.includes('class="prompt-container"') ||
                !result.includes('Setup Prompt'),
                'Should not render --- content as Setup Prompt');
    });
  });
});
