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
import { PERIODICALS_PROJECT_ID, NO_PROJECT_ID, buildInProgressForest } from '../../lib/tree.js';
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
// Tree-row status routed through the shared status primitive (LIN-850)
//
// The project-tree row status glyph moved off a hand-rolled `.state` span onto
// the shared `renderStatusPill` bare variant. It must render box-less (no pill
// chrome — the LIN-782 lock) while preserving the data-status / aria-label
// contract and the backlog ◌ glyph.
// =============================================================================

describe('tree-row status primitive (LIN-850)', () => {
  function tree(issue) {
    return {
      project: { id: 'project-1', name: 'Test Project', content: null, url: null },
      incomplete: [{ issue, children: [], depth: 0 }],
      completed: [],
      completedCount: 0
    };
  }

  test('status glyph is the bare status-pill, preserving data-status + aria-label', () => {
    const issue = { id: 'i-started', title: 'A started task', state: { type: 'started' }, labels: { nodes: [] } };
    const result = renderPage([tree(issue)], [], [], 'Test', { isLanding: true });
    // Routed through the shared primitive as the box-less bare variant…
    assert.match(result, /<span class="status-pill status-pill--in-progress status-pill--bare"[^>]*>/);
    // …carrying the llms.txt selector contract + a11y label…
    assert.match(result, /status-pill--bare" data-status="in-progress" aria-label="Status: In Progress"/);
    // …and the state glyph in the char slot.
    assert.match(result, /status-pill__char">◐<\/span>/);
    // The legacy hand-rolled `.state` span is gone from tree rows.
    assert.ok(!result.includes('<span class="state in-progress"'), 'no legacy .state span on tree rows');
  });

  test('backlog rows keep the ◌ glyph (not the pill default ○)', () => {
    const issue = { id: 'i-backlog', title: 'A backlog task', state: { type: 'backlog' }, labels: { nodes: [] } };
    const result = renderPage([tree(issue)], [], [], 'Test', { isLanding: true });
    assert.match(result, /status-pill--backlog status-pill--bare" data-status="backlog" aria-label="Status: Backlog"/);
    assert.match(result, /status-pill--bare"[^>]*><span class="status-pill__char">◌<\/span>/);
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

  // LIN-1279: the "Mint + Autopilot" action is a SECOND dispatch container on each
  // periodical row, gated behind the per-user `proxy` flag (load-bearing — its tail
  // calls the workspace-API kickoff endpoint). The plain Mint container is always
  // present; the variant appears only when proxy is on.
  test('proxy flag OFF: only the plain Mint container renders, no autopilot variant', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace',
      featureFlags: {}
    });
    // Plain periodical dispatch container is present (kind=periodical).
    assert.ok(result.includes('data-kind="periodical"'), 'plain Mint container renders');
    // No Mint + Autopilot variant when proxy is off.
    assert.ok(!result.includes('periodical-autopilot-options-'), 'no autopilot options panel when proxy off');
    assert.ok(!result.includes('+ Autopilot'), 'no "+ Autopilot" affordance when proxy off');
    assert.ok(!result.includes('data-proxy-force'), 'no proxy-force container when proxy off');
  });

  test('proxy flag ON: a gated Mint + Autopilot container renders alongside plain Mint', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace',
      featureFlags: { proxy: true }
    });
    // The plain container is still there (non-regression).
    assert.ok(result.includes('periodical-options-'), 'plain Mint options panel still renders');
    // The variant: its own disclosure id, a proxy-force container, and the "+ Autopilot" label.
    assert.ok(result.includes('periodical-autopilot-options-'), 'autopilot options panel renders when proxy on');
    assert.ok(result.includes('data-proxy-force="true"'), 'the variant forces proxy context on');
    assert.ok(result.includes('+ Autopilot'), 'the "+ Autopilot" affordance is labelled');
    // The variant carries the kickoff-endpoint tail (HTML-escaped in the container).
    assert.ok(result.includes('/api/proxy/autopilot/kickoff'), 'the variant prompt names the kickoff endpoint');
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
    // LIN-1553: Linear now derives ui.inlineCreate (session-auth createIssue),
    // so a real project renders the in-app create form instead of the external
    // deep-link. Assert the create affordance via its stable container testid.
    assert.ok(result.includes('data-testid="create-task"'), 'real project should have create-task affordance');
    assert.ok(result.includes('data-testid="create-task-form"'), 'real project renders the in-app create form');
  });

  test('__no_project__ suppresses the add-task link (latent bug fixed)', () => {
    const result = renderPage([projectTreeWithId(NO_PROJECT_ID, 'No Project')], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(!result.includes('data-testid="create-task"'), 'no-project should NOT have create-task affordance');
  });

  test('__periodicals__ suppresses the add-task link', () => {
    const result = renderPage([testMockPeriodicalsTree], [], [], 'Test', {
      isLanding: false,
      urlKey: 'test-workspace'
    });
    assert.ok(!result.includes('data-testid="create-task"'), 'periodicals should NOT have create-task affordance');
  });
});

// =============================================================================
// In-Progress subtask project tag (LIN-903)
// =============================================================================
// A parented in-progress subtask with its own, DIFFERENT project stays nested
// under its parent in the feed and shows that project as an inline tag ("project
// acts as a tag, not a group"). End-to-end through buildInProgressForest → renderPage.

describe('in-progress subtask project tag (LIN-903)', () => {
  const projects = [
    { id: 'proj-1', name: 'Project One', sortOrder: 1 },
    { id: 'proj-2', name: 'Project Two', sortOrder: 2 }
  ];
  const mk = (o) => ({ createdAt: '2020-01-01T00:00:00.000Z', labels: { nodes: [] }, ...o });

  test('nested subtask with a differing project renders its own project as a tag', () => {
    const parent = mk({ id: 'parent', title: 'Parent', project: { id: 'proj-1' }, state: { name: 'In Progress', type: 'started' } });
    const child = mk({ id: 'child', title: 'Child', project: { id: 'proj-2' }, parent: { id: 'parent' }, state: { name: 'In Progress', type: 'started' } });

    const trees = buildInProgressForest([parent, child], projects);
    const result = renderPage([], trees, [], 'Test', { isLanding: true });

    // The child row (depth 1) carries the differing project as an inline tag.
    const childLine = result.match(/<div class="line[^"]*"[^>]*data-id="child"[^>]*>[\s\S]*?<\/div>/);
    assert.ok(childLine, 'child row is present');
    assert.ok(childLine[0].includes('<span class="in-progress-project">(Project Two)</span>'),
      'nested subtask shows its own project as a tag');
    assert.strictEqual(childLine[0].includes('data-depth="1"'), true, 'child renders nested at depth 1');
  });

  test('a subtask sharing the parent project renders no tag', () => {
    const parent = mk({ id: 'parent', title: 'Parent', project: { id: 'proj-1' }, state: { name: 'In Progress', type: 'started' } });
    const child = mk({ id: 'child', title: 'Child', project: { id: 'proj-1' }, parent: { id: 'parent' }, state: { name: 'In Progress', type: 'started' } });

    const trees = buildInProgressForest([parent, child], projects);
    const result = renderPage([], trees, [], 'Test', { isLanding: true });

    const childLine = result.match(/<div class="line[^"]*"[^>]*data-id="child"[^>]*>[\s\S]*?<\/div>/);
    assert.ok(childLine, 'child row is present');
    assert.ok(!childLine[0].includes('in-progress-project'), 'same-project subtask has no tag');
  });
});

// =============================================================================
// Projects-page section-primitive adoption (LIN-979)
// =============================================================================
// Characterization pins for the container/section-primitive adoption pass.
//
// ADOPTED: the top-level Projects region is now composed via `renderSection`
// (was a hand-rolled bare `<section role="region">`). The INTENDED, documented
// diff is that it now carries the shared `.section` class; the load-bearing
// contract — the `role="region"` + `aria-label="Projects"` selector that
// `/llms.txt` (line 32) and consumers depend on — is preserved byte-for-byte.
//
// DELIBERATELY NOT ADOPTED: the in-progress and recent-activity regions are
// bespoke-for-reason — their `.in-progress-header` / `.recent-activity-header`
// are click-to-collapse controls (app.js), not section headings, and their
// `.tree` bodies are the collapse targets. `renderSection` models a heading +
// body, not a collapse control, so a swap would break the collapse wiring and
// the CSS/JS class hooks. These pins prove they were left intact.
describe('projects-page section-primitive adoption (LIN-979)', () => {
  const mk = (o) => ({ createdAt: '2020-01-01T00:00:00.000Z', labels: { nodes: [] }, ...o });
  const projectTree = {
    project: { id: 'proj-1', name: 'Test Project', content: null, url: null },
    incomplete: [{ issue: mk({ id: 'i1', identifier: 'T-1', title: 'One', state: { type: 'started' } }), children: [], depth: 0 }],
    completed: [],
    completedCount: 0
  };

  test('Projects region composes renderSection while preserving the role/aria-label selector contract', () => {
    const result = renderPage([projectTree], [], [], 'Test', { isLanding: true });
    // Adopted primitive: the shared `.section` chrome now wraps the region...
    assert.match(result, /<section class="section" role="region" aria-label="Projects">/,
      'Projects region is composed via renderSection (carries .section)');
    // ...and the /llms.txt selector contract is intact (role + aria-label).
    assert.ok(result.includes('role="region" aria-label="Projects"'),
      'role="region" aria-label="Projects" preserved for /llms.txt + consumers');
    // No hand-rolled classless `<section role="region"` remains for Projects.
    assert.ok(!/<section role="region" aria-label="Projects">/.test(result),
      'the old hand-rolled bare <section> is gone');
  });

  test('in-progress and recent-activity regions are left bespoke (collapse controls, not renderSection)', () => {
    const trees = buildInProgressForest(
      [mk({ id: 'p', title: 'P', project: { id: 'proj-1' }, state: { name: 'In Progress', type: 'started' } })],
      [{ id: 'proj-1', name: 'Test Project', sortOrder: 1 }]
    );
    const recent = [{ projectName: 'Test Project', roots: [
      { issue: mk({ id: 'r1', identifier: 'T-2', title: 'Shipped', state: { name: 'Done', type: 'completed' }, completedAt: '2020-02-01T00:00:00.000Z' }), children: [], depth: 0, projectName: 'Test Project' }
    ] }];
    const result = renderPage([projectTree], trees, recent, 'Test', { isLanding: true });

    // Deliberately untouched: still hand-rolled <div> regions with collapse
    // controls + .tree bodies — NOT wrapped in .section.
    assert.ok(result.includes('<div class="in-progress-section" role="region" aria-label="In Progress Tasks">'),
      'in-progress region kept as a bespoke collapsible <div>');
    assert.ok(result.includes('<div class="in-progress-header">'),
      'in-progress collapse control (header) intact');
    assert.ok(result.includes('<div class="recent-activity-section" role="region" aria-label="Recent activity">'),
      'recent-activity region kept as a bespoke collapsible <div>');
    assert.ok(!/<section class="section"[^>]*aria-label="In Progress Tasks"/.test(result),
      'in-progress region was NOT force-fitted onto renderSection');
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
    // LIN-1137: the server now renders a placeholder div instead of the dispatch
    // buttons directly; initDispatchDisclosures() replaces it client-side.
    assert.ok(result.includes('dispatch-disclosure-placeholder'), 'has a dispatch disclosure placeholder');
    // Synthetic rows are not Linear issues: no \"View in Linear\" link.
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

  // ---------------------------------------------------------------------------
  // Attachments gallery (LIN-652) — capability-gated, /api/image-relayed.
  // ---------------------------------------------------------------------------
  // An issue carrying a formal image attachment + a markdown image in the
  // description + a markdown image in a comment, so the gallery aggregates all
  // three sources.
  function issueWithImages() {
    return {
      id: 'i1',
      identifier: 'STB-1',
      title: 'A task',
      state: { type: 'started' },
      url: 'https://stub.example/issue/STB-1',
      description: 'See ![desc shot](https://uploads.linear.app/desc.png)',
      attachments: { nodes: [{ id: 'a1', title: 'Formal', url: 'https://cdn.linear.app/formal.jpg' }] },
      comments: { nodes: [{ id: 'c1', body: '![from comment](https://uploads.linear.app/c.gif)' }] },
      labels: { nodes: [] },
    };
  }
  function detailWithImages(ui) {
    const provider = makeStubProvider(ui);
    return renderDetailsContent(issueWithImages(), { isLanding: false, urlKey: 'ws', provider });
  }

  test('attachments=true shows the gallery; attachments=false hides it', () => {
    const on = detailWithImages({ attachments: true });
    assert.ok(on.includes('data-toggle="attachments"'), 'attachments toggle shown when capable');
    assert.ok(on.includes('Attachments (3)'), 'toggle counts every image (formal + desc + comment)');

    const off = detailWithImages({ attachments: false });
    assert.ok(!off.includes('data-toggle="attachments"'), 'attachments toggle hidden when capability is off');
  });

  test('gallery routes Linear-hosted images through the /api/image relay', () => {
    const html = detailWithImages({ attachments: true });
    assert.ok(
      html.includes('/workspace/ws/api/image?url=' + encodeURIComponent('https://uploads.linear.app/desc.png')),
      'description image rewritten to the session-auth relay'
    );
    assert.ok(
      html.includes('/workspace/ws/api/image?url=' + encodeURIComponent('https://cdn.linear.app/formal.jpg')),
      'formal attachment rewritten to the relay'
    );
    assert.ok(html.includes('loading="lazy"'), 'images lazy-load so bytes stay off the wire until expand');
    assert.ok(html.includes('data-original-src='), 'original URL retained for the client error fallback');
  });

  test('no attachments section when the issue has no images (byte-parity preserved)', () => {
    const provider = makeStubProvider({ attachments: true });
    const bare = renderDetailsContent(stubTree().incomplete[0].issue, { isLanding: false, urlKey: 'ws', provider });
    assert.ok(!bare.includes('data-toggle="attachments"'), 'no gallery toggle for an image-free issue');
  });

  test('landing page never renders the gallery', () => {
    const provider = makeStubProvider({ attachments: true });
    const landing = renderDetailsContent(issueWithImages(), { isLanding: true, urlKey: 'ws', provider });
    assert.ok(!landing.includes('data-toggle="attachments"'), 'gallery suppressed on the landing page');
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
    // LIN-1553: Linear's ui.inlineCreate is now true, so the project renders the
    // in-app create form (the external linear.app deep-link is replaced for it).
    assert.ok(result.includes('data-testid="create-task-form"'), 'in-app create form present for Linear');

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

// =============================================================================
// Recent activity section (LIN-490)
// =============================================================================

describe('Recent activity section', () => {
  function activityNode(id, kind, at, overrides = {}) {
    return {
      issue: {
        id, identifier: id, title: `Issue ${id}`,
        state: { name: 'Done', type: 'completed' },
        ...overrides
      },
      children: [],
      depth: 0,
      projectName: 'Product',
      activityKind: kind,
      activityAt: at
    };
  }

  const forest = (roots) => [{ projectId: null, projectName: null, roots }];

  test('uses the "Recent activity" label, not "Recently Completed"', () => {
    const trees = forest([activityNode('a', 'completed', new Date(Date.now() - 3600 * 1000).toISOString())]);
    const html = renderPage([], [], trees, 'Test', { isLanding: true });
    assert.ok(html.includes('▶ Recent activity'), 'header renamed');
    assert.ok(html.includes('aria-label="Recent activity"'), 'aria-label renamed');
    assert.ok(!html.includes('Recently Completed'), 'old label gone');
  });

  test('time badge carries the activity kind word and keys on activityAt', () => {
    const createdAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const trees = forest([
      activityNode('c', 'created', createdAt, { state: { name: 'Backlog', type: 'backlog' }, completedAt: null })
    ]);
    const html = renderPage([], [], trees, 'Test', { isLanding: true });
    assert.ok(html.includes('created'), 'shows the "created" activity word');
    // A created (non-completed) row still gets a time badge even with no completedAt.
    assert.ok(html.includes('class="completed-time"'), 'activity time badge present for created row');
  });
});

// =============================================================================
// Per-render-instance dispatch panel ids (LIN-732)
// =============================================================================
//
// The same issue can be rendered in two sections at once (In Progress + its
// project tree). The dispatch disclosure resolves its panel via aria-controls →
// getElementById, which only matches the FIRST element with that id — so a panel
// id keyed on issue id alone makes the second appearance's "Dispatch ▾" target
// the first's panel and look broken. The fix folds `section` into the panel ids.
//
// LIN-1137: the server now renders placeholder divs (data-disclosure-prefix)
// instead of the actual panels; initDispatchDisclosures() in common.js replaces
// them client-side. The prefix values (not the final panel ids) are what assert
// uniqueness.
describe('Per-render-instance dispatch panel ids (LIN-732)', () => {
  const issue = {
    id: 'i1', identifier: 'STB-1', title: 'A task',
    state: { type: 'started' }, labels: { nodes: [] }
  };
  const flags = { dispatch: true, proxy: true };
  const opts = (section) => ({ isLanding: false, urlKey: 'ws', featureFlags: flags, section });

  test('no section ⇒ prefix keyed on issue id (byte-identical to pre-LIN-732)', () => {
    const html = renderDetailsContent(issue, opts(''));
    assert.ok(html.includes('data-disclosure-prefix="prompt-options-i1"'), 'prompt placeholder keyed on issue id');
    assert.ok(html.includes('data-disclosure-prefix="recommend-options-i1"'), 'recommend placeholder keyed on issue id');
    assert.ok(html.includes('data-disclosure-prefix="autopilot-options-i1"'), 'autopilot placeholder keyed on issue id');
  });

  test('section is folded into every dispatch placeholder prefix', () => {
    const html = renderDetailsContent(issue, opts('in-progress'));
    assert.ok(html.includes('data-disclosure-prefix="prompt-options-in-progress-i1"'), 'prompt placeholder namespaced by section');
    assert.ok(html.includes('data-disclosure-prefix="recommend-options-in-progress-i1"'), 'recommend placeholder namespaced by section');
    assert.ok(html.includes('data-disclosure-prefix="autopilot-options-in-progress-i1"'), 'autopilot placeholder namespaced by section');
    assert.ok(!html.includes('data-disclosure-prefix="prompt-options-i1"'), 'no bare issue-id placeholder prefix remains');
  });

  test('two sections yield disjoint placeholder prefixes for the same issue (no DOM collision)', () => {
    const ids = (section) => {
      const html = renderDetailsContent(issue, opts(section));
      return [...html.matchAll(/data-disclosure-prefix="((?:prompt|recommend|autopilot)-options-[^"]+)"/g)].map(m => m[1]);
    };
    const inProgress = ids('in-progress');
    const project = ids('project');
    assert.equal(inProgress.length, 3, 'three dispatch placeholders per render instance');
    const overlap = inProgress.filter(id => project.includes(id));
    assert.deepEqual(overlap, [], 'In Progress and project appearances share no placeholder prefix');
  });

  test('every placeholder prefix in the render output is unique', () => {
    const html = renderDetailsContent(issue, opts('in-progress'));
    const prefixes = [...html.matchAll(/data-disclosure-prefix="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(prefixes).size, prefixes.length, 'all placeholder prefixes are unique');
  });
});

// =============================================================================
// Stepper Autopilot sibling button (LIN-836)
// =============================================================================
//
// The proxy-gated Autopilot affordance grew a SECOND button for the stepper
// variant (LIN-791). The classic anchor stays untouched (implicit `standard`);
// the sibling carries data-variant="stepper", which app.js reads and forwards
// as `?variant=stepper` on the kickoff fetch.
describe('Stepper Autopilot sibling button (LIN-836)', () => {
  const issue = {
    id: 'i1', identifier: 'STB-1', title: 'A task',
    state: { type: 'started' }, labels: { nodes: [] }
  };
  const render = (proxy) => renderDetailsContent(issue, {
    isLanding: false, urlKey: 'ws', featureFlags: { proxy }
  });

  test('proxy on ⇒ both the classic and the stepper anchor render', () => {
    const html = render(true);
    // Classic button unchanged (no data-variant marker).
    assert.ok(html.includes('class="label-prompt autopilot-btn" data-issue-id="i1" title='),
      'classic autopilot anchor still present, carries no variant');
    // Stepper sibling: same class + gate, data-variant="stepper", visible label.
    assert.ok(html.includes('data-variant="stepper"'), 'stepper sibling carries the variant marker');
    assert.ok(html.includes('>Autopilot · stepped</a>'), 'stepper sibling shows the stepped label');
    // Exactly two autopilot launch anchors, not more.
    assert.equal((html.match(/class="label-prompt autopilot-btn"/g) || []).length, 2);
  });

  test('proxy off ⇒ neither autopilot anchor renders (same gate as the classic button)', () => {
    const html = render(false);
    assert.ok(!html.includes('autopilot-btn'), 'no autopilot launch anchors without the proxy flag');
    assert.ok(!html.includes('data-variant="stepper"'), 'no stepper sibling without the proxy flag');
  });
});

// =============================================================================
// Per-task Chat deep-link (LIN-1007)
// =============================================================================
//
// A flag-gated navigation affordance in the expanded issue-row detail that deep
// links to the experimental task-chat page with THIS task preselected via the
// existing `?task=<identifier>` contract. Strictly gated on
// `featureFlags.taskChat === true`; off/absent ⇒ nothing renders (the first-class
// page stays byte-identical for non-flag-holders).
describe('Per-task Chat deep-link (LIN-1007)', () => {
  const issue = {
    id: 'i1', identifier: 'CHT-1', title: 'A task',
    state: { type: 'started' }, labels: { nodes: [] }
  };
  const render = (taskChat, urlKey = 'ws') => renderDetailsContent(issue, {
    isLanding: false, urlKey, featureFlags: { taskChat }
  });

  test('taskChat on ⇒ chat link renders with the correct deep-link href', () => {
    const html = render(true);
    assert.ok(html.includes('data-testid="issue-chat-link"'), 'chat link present when flag on');
    assert.ok(html.includes('href="/workspace/ws/task-chat?task=CHT-1"'),
      'href deep-links to task-chat with the identifier on the ?task= param');
  });

  test('taskChat off ⇒ nothing renders', () => {
    assert.ok(!render(false).includes('issue-chat-link'), 'no chat link when flag is false');
  });

  test('taskChat absent ⇒ nothing renders', () => {
    const html = renderDetailsContent(issue, { isLanding: false, urlKey: 'ws', featureFlags: {} });
    assert.ok(!html.includes('issue-chat-link'), 'no chat link when flag is absent');
  });

  test('both urlKey and identifier are URL-encoded in the href', () => {
    const spicy = {
      id: 'i2', identifier: 'A B/1', title: 'Spicy',
      state: { type: 'started' }, labels: { nodes: [] }
    };
    const html = renderDetailsContent(spicy, {
      isLanding: false, urlKey: 'w s/k', featureFlags: { taskChat: true }
    });
    assert.ok(html.includes('href="/workspace/w%20s%2Fk/task-chat?task=A%20B%2F1"'),
      'urlKey and identifier are percent-encoded, no raw spaces or slashes');
  });

  test('link falls back to issue.id when no identifier', () => {
    const noIdent = { id: 'raw-id', title: 'No identifier', state: { type: 'started' }, labels: { nodes: [] } };
    const html = renderDetailsContent(noIdent, {
      isLanding: false, urlKey: 'ws', featureFlags: { taskChat: true }
    });
    assert.ok(html.includes('href="/workspace/ws/task-chat?task=raw-id"'),
      'identifier falls back to issue.id (matches the sibling sections)');
  });
});

// =============================================================================
// Task-edit link gate (LIN-1565)
// =============================================================================
//
// The edit affordance in a task's Details panel used to be an inline form; it is
// now a link to the dedicated task-edit page. The GATE did not change — it is
// still `provider.ui.inlineEdit`, read off `ui.*` exclusively per the LIN-177
// convention — but nothing pinned it before, so a regression in either the gate
// or the href would have been silent. The page's route reads the SAME flag
// (tests/unit/task-edit-route.test.js), so these two suites together assert the
// link and its destination can never disagree about who may edit.

describe('task-edit link (LIN-1565)', () => {
  let seq = 0;
  function providerWith(inlineEdit) {
    const name = `edit-gate-stub-${++seq}`;
    registerProvider({
      name,
      ui: { write: true, comments: true, inlineEdit, displayName: 'Stub Tracker' },
    });
    return { name, ui: { write: true, comments: true, inlineEdit, displayName: 'Stub Tracker' } };
  }
  const issue = {
    id: 'issue-uuid-1',
    identifier: 'STB-7',
    title: 'A task',
    state: { type: 'started' },
    labels: { nodes: [] },
  };
  function render(inlineEdit, opts = {}) {
    return renderDetailsContent(issue, {
      isLanding: false, urlKey: 'ws', provider: providerWith(inlineEdit), ...opts
    });
  }

  test('inlineEdit true ⇒ the link renders with the right href', () => {
    // LIN-1904: the href now carries `?source=<resolved provider>` so the
    // task-edit page (and its PATCH submit) resolve THIS issue's own binding —
    // capture the provider passed in rather than the `render()` wrapper's
    // hidden one, so the expected href can name it.
    const provider = providerWith(true);
    const html = renderDetailsContent(issue, { isLanding: false, urlKey: 'ws', provider });
    assert.ok(html.includes('data-testid="issue-edit-link"'), 'edit link present');
    assert.ok(html.includes(`href="/workspace/ws/task/issue-uuid-1/edit?source=${encodeURIComponent(provider.name)}"`),
      'href points at the task-edit page for this issue, carrying the resolved provider as ?source=');
  });

  test('inlineEdit false ⇒ no link at all', () => {
    const html = render(false);
    assert.ok(!html.includes('issue-edit-link'), 'no edit affordance for a read-only provider');
    assert.ok(!html.includes('/edit"'), 'no edit href leaks through');
  });

  test('the landing page never renders the link', () => {
    const html = renderDetailsContent(issue, {
      isLanding: true, urlKey: 'ws', provider: providerWith(true)
    });
    assert.ok(!html.includes('issue-edit-link'));
  });

  test('no urlKey ⇒ no link (there is no page to link to)', () => {
    const html = renderDetailsContent(issue, {
      isLanding: false, urlKey: null, provider: providerWith(true)
    });
    assert.ok(!html.includes('issue-edit-link'));
  });

  test('urlKey and issue id are URL-encoded in the href', () => {
    const spicy = { id: 'a b/1', identifier: 'A B/1', title: 'Spicy', state: { type: 'started' }, labels: { nodes: [] } };
    const provider = providerWith(true);
    const html = renderDetailsContent(spicy, {
      isLanding: false, urlKey: 'w s/k', provider
    });
    assert.ok(html.includes(`href="/workspace/w%20s%2Fk/task/a%20b%2F1/edit?source=${encodeURIComponent(provider.name)}"`),
      'urlKey and issue id are percent-encoded, no raw spaces or slashes');
  });

  test('the inline edit FORM is gone — only the link remains', () => {
    const html = render(true);
    assert.ok(!html.includes('data-inline-edit'), 'no inline edit form markup');
    assert.ok(!html.includes('edit-issue-trigger'), 'no inline edit toggle');
    assert.ok(!html.includes('edit-issue-form'), 'no inline edit form');
  });
});
