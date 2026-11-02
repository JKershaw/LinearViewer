/**
 * LIN-4119 (S3a-2, beat 1): the `/workspace/:urlKey/backlog` page mode and its navbar page name.
 *
 * `renderPage` takes a page mode: `home` (the default, byte-identical to before this change) or `backlog`.
 * The backlog page renders only the project sections, under a "<workspace> - Backlog" title, with no Home
 * onboarding, halt banner or In Progress summary. The navbar gives `'backlog'` the same team, assignee and
 * search controls as `'projects'`, and no view-bar tab is marked current there.
 *
 * The route itself lives in server.js, which is not import-safe in a unit test (it connects to Mongo and calls
 * app.listen() at load). Its wiring is therefore pinned as source text, the same precedent as
 * tests/unit/lin-2521-resolve-team-selection-wiring.test.js.
 *
 * Run with: node --test tests/unit/lin-4119-backlog-page.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPage } from '../../lib/render.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { buildInProgressForest } from '../../lib/tree.js';
import '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function mk(overrides) {
  return {
    id: 'issue-x',
    identifier: 'T-1',
    title: 'A task',
    description: '',
    state: { name: 'Todo', type: 'unstarted' },
    labels: { nodes: [] },
    url: 'https://linear.app/test',
    ...overrides,
  };
}

// A project with one Todo task (Up next) and one In Progress task, so both regions have content to lose.
const projectTree = {
  project: { id: 'proj-1', name: 'Test Project', content: null, url: null },
  incomplete: [{ issue: mk({ id: 'todo-1', identifier: 'T-2', title: 'Backlog item' }), children: [], depth: 0 }],
  completed: [],
  completedCount: 0,
};
const inProgressTrees = buildInProgressForest(
  [mk({ id: 'wip-1', identifier: 'T-9', title: 'Working', project: { id: 'proj-1' }, state: { name: 'In Progress', type: 'started' } })],
  [{ id: 'proj-1', name: 'Test Project', sortOrder: 1 }],
);
const workspace = { id: 'ws-1', urlKey: 'acme', name: 'Acme', provider: 'local' };
const baseOptions = { workspace, urlKey: 'acme', featureFlags: {} };

describe('LIN-4119 — renderPage page mode', () => {
  test('home is the default page mode: the title is "- Projects" and the Running region renders', () => {
    const html = renderPage([projectTree], inProgressTrees, [], 'Acme', baseOptions);
    assert.match(html, /<title>[^<]*- Projects<\/title>/);
    assert.ok(html.includes('<div class="running-section" role="region" aria-label="Running and recently moved" data-testid="running-section">'));
  });

  test('an explicit home page mode renders byte-identically to the default', () => {
    const implicit = renderPage([projectTree], inProgressTrees, [], 'Acme', baseOptions);
    const explicit = renderPage([projectTree], inProgressTrees, [], 'Acme', { ...baseOptions, pageMode: 'home' });
    assert.equal(explicit, implicit);
  });

  test('backlog: the title is "<workspace> - Backlog", never "- Projects"', () => {
    const html = renderPage([projectTree], inProgressTrees, [], 'Acme', { ...baseOptions, pageMode: 'backlog' });
    assert.match(html, /<title>[^<]*Acme - Backlog<\/title>/);
    assert.doesNotMatch(html, /<title>[^<]*- Projects<\/title>/);
  });

  test('backlog renders only the project sections: no Running and no recent block', () => {
    const recent = [{ projectName: 'Test Project', roots: [
      { issue: mk({ id: 'r1', identifier: 'T-3', title: 'Shipped', state: { name: 'Done', type: 'completed' }, completedAt: '2020-02-01T00:00:00.000Z' }), children: [], depth: 0, projectName: 'Test Project' },
    ] }];
    const html = renderPage([projectTree], inProgressTrees, recent, 'Acme', { ...baseOptions, pageMode: 'backlog' });
    assert.ok(!html.includes('running-section'), 'no Running region on the backlog page');
    assert.ok(!html.includes('running-recent'), 'no recent block on the backlog page');
    assert.ok(html.includes('role="region" aria-label="Projects"'), 'the Projects region renders');
    assert.ok(html.includes('Backlog item'), 'the project\'s own task renders in its section');
  });

  test('backlog carries no Home-only onboarding: no halt banner, even with a pause in force', () => {
    const html = renderPage([projectTree], [], [], 'Acme', { ...baseOptions, pageMode: 'backlog', halt: { mode: 'pause' } });
    assert.ok(!html.includes('home-halt-banner'), 'the halt banner is Home\'s, not the backlog page\'s');
  });

  test('backlog keeps the search panel and the page-scoped prompt options', () => {
    const html = renderPage([projectTree], [], [], 'Acme', { ...baseOptions, pageMode: 'backlog' });
    assert.ok(html.includes('home-search-results'), 'the search results container renders on the backlog page');
    assert.ok(html.includes('__HOME_PROMPT_OPTS__'), 'the page-scoped prompt options are embedded');
  });

  test('backlog marks the navbar page as "backlog", so no view-bar tab is current there', () => {
    const html = renderPage([projectTree], [], [], 'Acme', { ...baseOptions, pageMode: 'backlog' });
    assert.ok(!html.includes('aria-current="page"'), 'no tab is marked current on /backlog');
    assert.ok(html.includes('data-testid="nav-view-projects"'), 'the Home tab stays a link, not a non-link');
  });
});

describe('LIN-4119 — navbar page name "backlog"', () => {
  const navOptions = {
    urlKey: 'acme',
    teams: [{ id: 't1', name: 'One', key: 'ONE' }],
    selectedTeamId: null,
    assignees: ['Ann'],
    selectedAssignee: 'all',
    canFilterByMe: true,
    featureFlags: {},
  };

  test('backlog gets the team selector, the assignee selector and the search toggle, as projects does', () => {
    const projects = renderNavBar({ ...navOptions, currentPage: 'projects' });
    const backlog = renderNavBar({ ...navOptions, currentPage: 'backlog' });
    assert.ok(backlog.includes('search-toggle'), 'search toggle on /backlog');
    assert.ok(backlog.includes('id="assignee-toggle"'), 'assignee selector on /backlog');
    assert.ok(backlog.includes('Ann'), 'assignee options on /backlog');
    assert.ok(backlog.includes('One'), 'team options on /backlog');
    assert.equal(
      backlog.match(/<div class="nav-options-panel hidden" id="assignee-options"[\s\S]*?<\/div>\s*<\/div>/)?.[0],
      projects.match(/<div class="nav-options-panel hidden" id="assignee-options"[\s\S]*?<\/div>\s*<\/div>/)?.[0],
      'the assignee panel is the same markup on both pages',
    );
  });

  test('swipe keeps no assignee selector (the LIN-2527 reach is unchanged)', () => {
    const swipe = renderNavBar({ ...navOptions, currentPage: 'swipe' });
    assert.ok(!swipe.includes('id="assignee-toggle"'));
  });

  test('a backlog workspace switch keeps the page: the switcher links to /backlog', () => {
    const nav = renderNavBar({
      ...navOptions,
      currentPage: 'backlog',
      workspaces: [{ urlKey: 'acme', name: 'Acme', provider: 'local' }],
    });
    assert.ok(nav.includes('/workspace/acme/backlog'), 'switching workspace on /backlog stays on /backlog');
  });
});

describe('LIN-4119 — server wiring for GET /workspace/:urlKey/backlog (source pin)', () => {
  const routeStart = SERVER_SRC.indexOf("app.get('/workspace/:urlKey/backlog', workspaceFromUrl, async (req, res) => {");
  const routeEnd = SERVER_SRC.indexOf('\n// ====', routeStart);
  const body = SERVER_SRC.slice(routeStart, routeEnd === -1 ? routeStart + 6000 : routeEnd);

  test('the route is registered behind workspaceFromUrl', () => {
    assert.notEqual(routeStart, -1, 'expected the backlog route to be registered');
  });

  test('it resolves team and assignee with the shared helpers, and owns its own 401 call', () => {
    assert.match(body, /const \{ teamId \} = await resolveTeamSelection\(req, workspace\);/);
    assert.match(body, /const assigneeState = await resolveAssigneeSelection\(req, provider, getWorkspaceCallScope\(workspace\)\);/);
    assert.match(body, /return handleUnauthorizedError\(workspace, req\.session, teamId, assigneeState, openRouterSource, res, error\);/);
  });

  test('it renders through renderPage in backlog mode, on the shared gather', () => {
    assert.match(body, /gatherHomePage\(homePipelineDeps\(\)/);
    assert.match(body, /pageMode: 'backlog'/);
  });

  test('its generic error page retries to /backlog, not to Home', () => {
    assert.match(body, /actionUrl: `\/workspace\/\$\{encodeURIComponent\(workspace\.urlKey\)\}\/backlog`/);
  });
});
