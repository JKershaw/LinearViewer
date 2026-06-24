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
import { renderLabels, renderDisplayLabels, renderPage, renderDetailsContent } from '../../lib/render.js';
import { PERIODICALS_PROJECT_ID, NO_PROJECT_ID } from '../../lib/tree.js';
import { testMockPeriodicalsTree } from '../fixtures/mock-data.js';
// Side-effect import: the Linear provider self-registers on load, so getProvider
// ('linear') (used by the add-task link) resolves in this unit-test context.
import '../../lib/providers/linear/index.js';
import { linearProvider } from '../../lib/providers/linear/index.js';
import { registerProvider } from '../../lib/providers/registry.js';

// =============================================================================
// renderLabels Tests
// =============================================================================

describe('renderLabels', () => {
  describe('regular labels', () => {
    // These exercise the display-label text in isolation. Prompt buttons now
    // render for every issue (including completed), so they use
    // renderDisplayLabels() rather than renderLabels() to avoid the prompt HTML.
    test('renders regular label as plain text', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [{ name: 'feature' }] },
        state: { type: 'completed' }
      };
      const result = renderDisplayLabels(issue);
      assert.strictEqual(result, 'feature');
    });

    test('renders multiple regular labels comma-separated', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [{ name: 'feature' }, { name: 'priority' }] },
        state: { type: 'completed' }
      };
      const result = renderDisplayLabels(issue);
      assert.ok(result.includes('feature'));
      assert.ok(result.includes('priority'));
      // Labels are comma-separated in renderDisplayLabels
      assert.strictEqual(result, 'feature, priority');
    });

    test('returns empty string for no labels', () => {
      const issue = {
        id: 'issue-1',
        labels: { nodes: [] },
        state: { type: 'completed' }
      };
      const result = renderDisplayLabels(issue);
      assert.strictEqual(result, '');
    });

    test('handles missing labels gracefully', () => {
      const issue = {
        id: 'issue-1',
        labels: null,
        state: { type: 'completed' }
      };
      const result = renderDisplayLabels(issue);
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

    test('shows prompts for completed issue (e.g. for a retro look-back)', () => {
      const issue = {
        id: 'issue-done',
        labels: { nodes: [] },
        state: { type: 'completed' }
      };
      const result = renderLabels(issue);
      assert.ok(result.includes('data-label="plan"'));
      assert.ok(result.includes('data-label="look-into"'));
      // retro lives behind "more" and should be reachable on a finished task
      assert.ok(result.includes('data-label="retro"'));
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
      // No display labels to show; prompt buttons still render regardless of state
      assert.strictEqual(renderDisplayLabels(issue), '');
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
      // LIN-442: the authenticated dashboard defers the detail block to a lazy
      // per-issue fetch, so the description renders via renderDetailsContent (the
      // /api/detail payload), not inline in renderPage.
      const detail = renderDetailsContent(issueWithDashBlock, { isLanding: false, urlKey: 'test' });

      // Should NOT have the "Setup Prompt" container that comes from --- blocks
      // (There may be other prompt-containers for the interactive prompt UI)
      assert.ok(!detail.includes('Setup Prompt'), 'Authenticated view should NOT render "Setup Prompt"');

      // The description text should be rendered as plain text
      assert.ok(detail.includes('Some intro'), 'Description intro should be visible');
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

// =============================================================================
// Lazy detail rendering (LIN-442)
//
// The authenticated dashboard ships collapsed lines only: renderNode emits an
// empty, lazy `.details` wrapper and the client fetches the rendered block from
// /api/detail on first expand. The landing page (no fetch route) stays inline.
// =============================================================================

describe('lazy detail rendering (LIN-442)', () => {
  const heavyIssue = {
    id: 'issue-heavy',
    identifier: 'TEST-9',
    title: 'Heavy issue',
    description: 'A long description that used to be serialized inline on every load',
    state: { type: 'started' },
    estimate: 5,
    labels: { nodes: [] },
    url: 'https://linear.app/test/issue/TEST-9'
  };
  function tree(issue) {
    return {
      project: { id: 'project-1', name: 'Test Project', content: null, url: null },
      incomplete: [{ issue, children: [], depth: 0 }],
      completed: [],
      completedCount: 0
    };
  }

  test('authenticated dashboard emits an empty lazy wrapper, not inline detail', () => {
    const result = renderPage([tree(heavyIssue)], [], [], 'Test', { isLanding: false, urlKey: 'ws' });

    // The wrapper is present and flagged lazy, carrying the keys the client fetch needs.
    assert.ok(result.includes('data-lazy="1"'), 'emits a lazy details wrapper');
    assert.ok(result.includes('data-details-for="issue-heavy"'), 'wrapper keyed by issue id');
    assert.ok(result.includes('data-url-key="ws"'), 'wrapper carries urlKey for the fetch');

    // The heavy inline content must NOT be in the page payload anymore.
    assert.ok(!result.includes('A long description'), 'description is deferred, not inline');
    assert.ok(!result.includes('data-toggle="comments"'), 'comments shell is deferred');
    assert.ok(!result.includes('data-toggle="details"'), 'Details sub-toggle is deferred');
  });

  test('landing page still renders detail inline (no lazy wrapper, no fetch route)', () => {
    const result = renderPage([tree(heavyIssue)], [], [], 'Test', { isLanding: true });

    assert.ok(!result.includes('data-lazy'), 'no lazy wrapper on landing');
    assert.ok(result.includes('A long description'), 'description rendered inline for landing');
  });

  test('renderDetailsContent returns the inner block the route serves', () => {
    const detail = renderDetailsContent(heavyIssue, { isLanding: false, urlKey: 'ws' });
    assert.ok(detail.includes('A long description'), 'description present in detail content');
    assert.ok(detail.includes('data-toggle="comments"'), 'comments shell present in detail content');
    assert.ok(!detail.startsWith('<div class="details'), 'returns inner content, not the wrapper');
  });
});

// =============================================================================
// Keyboard-operable expandable rows (LIN-566)
//
// The shared `.line.expandable` primitive must be a real control: role=button,
// tabindex=0, and aria-expanded so keyboard/SR users can expand it. This is the
// markup half of the fix (the toggleItem aria sync + keydown handler is client
// behaviour, covered by the e2e landing focus-order probe).
// =============================================================================

describe('expandable row accessibility markup (LIN-566)', () => {
  const expandableIssue = {
    id: 'issue-a11y',
    identifier: 'TEST-566',
    title: 'A row with details to expand',
    description: 'Some description so the row is expandable',
    state: { type: 'started' },
    labels: { nodes: [] },
    url: 'https://linear.app/test/issue/TEST-566'
  };
  function tree(issue) {
    return {
      project: { id: 'project-1', name: 'Test Project', content: null, url: null },
      incomplete: [{ issue, children: [], depth: 0 }],
      completed: [],
      completedCount: 0
    };
  }

  test('expandable rows are keyboard-operable controls (role/tabindex/aria-expanded)', () => {
    const result = renderPage([tree(expandableIssue)], [], [], 'Test', { isLanding: true });
    const lineMatch = result.match(/<div class="line[^"]*expandable[^"]*"[^>]*>/);
    assert.ok(lineMatch, 'an expandable line row is present');
    const line = lineMatch[0];
    assert.ok(line.includes('role="button"'), 'expandable row has role=button');
    assert.ok(line.includes('tabindex="0"'), 'expandable row is focusable');
    assert.ok(line.includes('aria-expanded="false"'), 'expandable row starts not-expanded');
  });

  test('non-expandable rows are not made focusable controls', () => {
    const bareIssue = {
      id: 'issue-bare',
      title: 'Nothing to expand',
      state: { type: 'started' },
      labels: { nodes: [] }
    };
    const result = renderPage([tree(bareIssue)], [], [], 'Test', { isLanding: true });
    const lineMatch = result.match(/<div class="line(?![^"]*expandable)[^"]*"[^>]*>/);
    assert.ok(lineMatch, 'a non-expandable line row is present');
    assert.ok(!lineMatch[0].includes('role="button"'), 'non-expandable row is not a button control');
    assert.ok(!lineMatch[0].includes('tabindex'), 'non-expandable row is not focusable');
  });

  test('periodical rows are keyboard-operable controls', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    const lineMatch = result.match(/<div class="line expandable"[^>]*data-status="periodical"?[^>]*>|<div class="line expandable"[^>]*>/);
    assert.ok(lineMatch, 'a periodical expandable row is present');
    assert.ok(lineMatch[0].includes('role="button"'), 'periodical row has role=button');
    assert.ok(lineMatch[0].includes('tabindex="0"'), 'periodical row is focusable');
    assert.ok(lineMatch[0].includes('aria-expanded="false"'), 'periodical row starts not-expanded');
  });
});

// =============================================================================
// Add-task link guard for synthetic project ids (LIN-341)
// =============================================================================

describe('add-task link guard (LIN-341)', () => {
  function projectTreeWithId(id, name) {
    return {
      project: { id, name, content: null, url: null },
      incomplete: [{
        issue: { id: `${id}-issue`, title: 'A task', state: { type: 'started' }, labels: { nodes: [] } },
        children: [],
        depth: 0
      }],
      completed: [],
      completedCount: 0
    };
  }

  test('real project id renders the "+ Add task" link', () => {
    const result = renderPage([projectTreeWithId('real-project', 'Real')], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(result.includes('data-action="create-task"'), 'real project should have add-task link');
  });

  test('__no_project__ suppresses the add-task link (latent bug fixed)', () => {
    const result = renderPage([projectTreeWithId(NO_PROJECT_ID, 'No Project')], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(!result.includes('data-action="create-task"'), 'no-project should NOT have add-task link');
  });

  test('__periodicals__ suppresses the add-task link', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(!result.includes('data-action="create-task"'), 'periodicals should NOT have add-task link');
  });
});

// =============================================================================
// Periodicals group rendering (LIN-341)
// =============================================================================

describe('Periodicals group rendering (LIN-341)', () => {
  test('renders the synthetic group with the periodicals colour hook', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(result.includes('data-project-type="periodicals"'), 'has data-project-type hook');
    assert.ok(result.includes(`data-id="${PERIODICALS_PROJECT_ID}"`), 'has synthetic project id');
    assert.ok(result.includes('Documentation Review'), 'shows the Documentation Review row');
  });

  test('the row is dispatchable with kind=periodical and no Linear link', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(result.includes('data-kind="periodical"'), 'dispatch container tagged kind=periodical');
    assert.ok(result.includes('prompt-dispatch'), 'has a dispatch button');
    // Synthetic rows are not Linear issues: no "View in Linear" link.
    assert.ok(!result.includes('View in Linear'), 'no View in Linear link for periodicals');
  });

  test('flag-off parity: omitting the group yields no periodicals markup', () => {
    const result = renderPage([], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(!result.includes('data-project-type="periodicals"'), 'no periodicals hook when group absent');
    assert.ok(!result.includes('data-kind="periodical"'), 'no periodical dispatch when group absent');
  });
});

// =============================================================================
// Capability-aware rendering (LIN-177 S3)
//
// Rendering reads the active workspace's provider `ui` capability surface
// (write/comments/estimates/displayName) instead of hard-coding Linear. These
// permutations register a stub provider and assert each gate independently.
// =============================================================================

describe('capability-aware rendering (LIN-177 S3)', () => {
  // A project + one issue carrying every detail the gates touch: a url (View-in
  // link), an estimate (estimates gate), state (so it renders details).
  function stubTree() {
    return {
      project: { id: 'p1', name: 'Proj', content: null, url: 'https://stub.example/projects/p1' },
      incomplete: [{
        issue: {
          id: 'i1',
          identifier: 'STB-1',
          title: 'A task',
          state: { type: 'started' },
          url: 'https://stub.example/issue/STB-1',
          estimate: 3,
          labels: { nodes: [] }
        },
        children: [],
        depth: 0
      }],
      completed: [],
      completedCount: 0
    };
  }

  // Register a stub provider with a fully controllable `ui` surface. Each call
  // uses a fresh name so permutations don't clobber one another (the registry
  // is module-global and last-write-wins).
  let stubSeq = 0;
  function makeStubProvider(ui) {
    const name = `stub-${stubSeq++}`;
    const provider = {
      name,
      ui: { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Stub Tracker', ...ui },
      getCreateTaskUrl: (urlKey, projectId) => `https://stub.example/${urlKey}/new?project=${projectId}`
    };
    registerProvider(provider);
    return provider;
  }
  function renderWithProviderUi(ui) {
    const provider = makeStubProvider(ui);
    return renderPage([stubTree()], [], [], 'Test', {
      isLanding: false,
      urlKey: 'ws',
      workspaces: [{ id: 'w1', name: 'WS', urlKey: 'ws', provider: provider.name }]
    });
  }
  // LIN-442: detail content (comments toggle, estimate, View-in link) is now
  // served by the lazy /api/detail surface, i.e. renderDetailsContent — so the
  // detail-scoped capability gates are asserted there rather than in renderPage.
  function detailContentWithProviderUi(ui) {
    const provider = makeStubProvider(ui);
    return renderDetailsContent(stubTree().incomplete[0].issue, {
      isLanding: false,
      urlKey: 'ws',
      provider
    });
  }

  test('displayName drives "View in {provider}" links, never hard-codes Linear', () => {
    const result = renderWithProviderUi({ displayName: 'Stub Tracker' });
    assert.ok(result.includes('View in Stub Tracker →'), 'uses provider displayName');
    assert.ok(!result.includes('View in Linear'), 'no hard-coded Linear text');
  });

  test('write=true shows "+ Add task" with the provider-resolved create URL', () => {
    const result = renderWithProviderUi({ write: true });
    assert.ok(result.includes('data-action="create-task"'), 'add-task link present');
    assert.ok(result.includes('https://stub.example/ws/new?project=p1'), 'create URL comes from the active provider, not a pinned Linear lookup');
    assert.ok(!result.includes('linear.app/'), 'does not fall back to a Linear URL');
  });

  test('write=false hides "+ Add task"', () => {
    const result = renderWithProviderUi({ write: false });
    assert.ok(!result.includes('data-action="create-task"'), 'add-task link suppressed when write is unavailable');
  });

  test('comments=true shows the Comments toggle; comments=false hides it', () => {
    assert.ok(detailContentWithProviderUi({ comments: true }).includes('data-toggle="comments"'), 'comments toggle shown');
    assert.ok(!detailContentWithProviderUi({ comments: false }).includes('data-toggle="comments"'), 'comments toggle hidden');
  });

  test('estimates=true shows "N pts"; estimates=false hides it', () => {
    assert.ok(detailContentWithProviderUi({ estimates: true }).includes('3 pts'), 'estimate shown');
    assert.ok(!detailContentWithProviderUi({ estimates: false }).includes('3 pts'), 'estimate hidden');
  });

  test('source badge appears per-task only when showSource is on (LIN-544)', () => {
    const githubTree = {
      project: { id: 'p1', name: 'Proj', content: null, url: null },
      incomplete: [{
        issue: { id: '42', identifier: '#42', title: 'A GitHub task', source: 'github', state: { type: 'started' }, labels: { nodes: [] } },
        children: [],
        depth: 0
      }],
      completed: [],
      completedCount: 0
    };
    const opts = { isLanding: false, urlKey: 'ws', workspaces: [{ id: 'w1', name: 'WS', urlKey: 'ws' }] };

    const withBadge = renderPage([githubTree], [], [], 'Test', { ...opts, showSource: true });
    assert.ok(withBadge.includes('data-testid="issue-source"'), 'source badge present when showSource on');
    assert.ok(withBadge.includes('data-source="github"'), 'badge reflects the issue source');

    const withoutBadge = renderPage([githubTree], [], [], 'Test', { ...opts, showSource: false });
    assert.ok(!withoutBadge.includes('data-testid="issue-source"'), 'badge suppressed when showSource off (single-provider parity)');
  });

  test('legacy/Linear workspace renders byte-identically (back-compat)', () => {
    // No `provider` field on the workspace → resolves the Linear provider, whose
    // ui keeps all affordances on and displayName 'Linear'. Page-level affordances
    // stay in renderPage; detail-level ones (LIN-442) live in the lazy detail
    // content — assert each on its own surface.
    const result = renderPage([stubTree()], [], [], 'Test', {
      isLanding: false,
      urlKey: 'ws',
      workspaces: [{ id: 'w1', name: 'WS', urlKey: 'ws' }]
    });
    assert.ok(result.includes('data-action="create-task"'), 'add-task present for Linear');
    assert.ok(result.includes('linear.app/'), 'Linear create URL preserved');

    const detail = renderDetailsContent(stubTree().incomplete[0].issue, {
      isLanding: false,
      urlKey: 'ws',
      provider: linearProvider
    });
    assert.ok(detail.includes('View in Linear →'), 'Linear display name preserved');
    assert.ok(detail.includes('data-toggle="comments"'), 'comments toggle present for Linear');
    assert.ok(detail.includes('3 pts'), 'estimate present for Linear');
  });
});
