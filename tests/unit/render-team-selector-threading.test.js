/**
 * LIN-2523: teams/selectedTeamId threaded into the four non-dashboard page
 * renderers' renderNavBar calls (render-swipe.js, render-swim.js,
 * render-ship.js, render-roadmap.js) — the reach LIN-2519's widened navbar
 * gate needed data for. lib/render.js (the dashboard/projects renderer) was
 * already wired before this whole ticket sequence started.
 *
 * AC1: all five in-scope pages render a populated team selector with the
 * current selection marked, when given team data.
 * AC2: render-task-create.js / render-task-edit.js stay selector-free —
 * proved here by test, not a page-identity check, and proved RIGOROUSLY:
 * render-task-create.js's own top-level `teams` option (for its create-form
 * team dropdown, unrelated to the navbar) is populated in these tests, so a
 * false "no team selector" reading from simply never having team data nearby
 * is ruled out — the navbar call itself must be the thing omitting it.
 *
 * Run with: node --test tests/unit/render-team-selector-threading.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderSwipePage } from '../../lib/render-swipe.js';
import { renderSwimPage } from '../../lib/render-swim.js';
import { renderShipPage } from '../../lib/render-ship.js';
import { renderRoadmapPage } from '../../lib/render-roadmap.js';
import { renderTaskCreatePage } from '../../lib/render-task-create.js';
import { renderTaskEditPage } from '../../lib/render-task-edit.js';

const TEAMS = [
  { id: 'eng-id', name: 'Engineering', key: 'ENG' },
  { id: 'design-id', name: 'Design', key: 'DES' }
];
const EMPTY_TREES = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'Acme' };

const RENDERERS = [
  { name: 'swipe', render: (opts) => renderSwipePage(EMPTY_TREES, { urlKey: 'acme', ...opts }) },
  { name: 'swim', render: (opts) => renderSwimPage(EMPTY_TREES, { urlKey: 'acme', ...opts }) },
  { name: 'ship', render: (opts) => renderShipPage(EMPTY_TREES, { urlKey: 'acme', ...opts }) },
  { name: 'roadmap', render: (opts) => renderRoadmapPage({ roadmapModel: {}, organizationName: 'Acme' }, { urlKey: 'acme', ...opts }) }
];

describe('LIN-2523 AC1 — the four non-dashboard renderers thread teams/selectedTeamId into the navbar', () => {
  for (const { name, render } of RENDERERS) {
    test(`${name}: renders a populated team selector when given team data`, () => {
      const html = render({ teams: TEAMS, selectedTeamId: 'design-id' });
      assert.match(html, /id="team-toggle"/, `expected team selector on ${name}`);
      assert.match(html, /id="team-options"/, `expected team options panel on ${name}`);
      assert.match(html, /Engineering/);
      assert.match(html, /Design/);
    });

    test(`${name}: the current selection is marked selected`, () => {
      const html = render({ teams: TEAMS, selectedTeamId: 'design-id' });
      // The toggle button shows the selected team's name as its visible value.
      assert.match(html, /id="team-toggle"[^>]*>Design</);
      // The matching option in the panel carries the selected marker/state.
      const designOptionMatch = html.match(/<button class="nav-option selected" role="option" aria-selected="true" data-team="design-id">/);
      assert.notEqual(designOptionMatch, null, 'expected the Design option to carry the selected class/aria-selected/marker');
    });

    test(`${name}: with no team data (default), stays selector-free — the navbar's own data-absence guard`, () => {
      const html = render({});
      assert.doesNotMatch(html, /id="team-toggle"/, `expected NO team selector on ${name} with no teams`);
      assert.doesNotMatch(html, /id="team-options"/);
    });
  }
});

describe('LIN-2523 AC2 — render-task-create.js and render-task-edit.js stay selector-free (proved by test, not a page check)', () => {
  test('renderTaskCreatePage never renders a team selector, even though its OWN top-level `teams` (the create-form dropdown) is non-empty', () => {
    const html = renderTaskCreatePage(
      { urlKey: 'acme', fields: ['teamId'], teams: TEAMS, projects: [], states: [], teamId: '', projectId: '' },
      { workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }] }
    );
    // The create-form's OWN team dropdown legitimately renders team names —
    // this proves team data reached the page at all, ruling out "there was
    // simply no data nearby" as the reason the NAVBAR selector is absent.
    assert.match(html, /Engineering/);
    // The navbar's team selector must still be absent — the omission is at
    // the renderNavBar call site (no teams/selectedTeamId threaded there),
    // never a currentPage identity check.
    assert.doesNotMatch(html, /id="team-toggle"/);
    assert.doesNotMatch(html, /id="team-options"/);
  });

  test('renderTaskEditPage never renders a team selector', () => {
    const html = renderTaskEditPage(
      { issue: { id: 'i1', title: 'Task', description: '', priority: 0 }, states: [], urlKey: 'acme', issueId: 'i1' },
      { workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }] }
    );
    assert.doesNotMatch(html, /id="team-toggle"/);
    assert.doesNotMatch(html, /id="team-options"/);
  });

  test('renderTaskEditPage (not-found body) never renders a team selector either', () => {
    const html = renderTaskEditPage(
      { issue: null, states: [], urlKey: 'acme', issueId: 'missing-id' },
      { workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }] }
    );
    assert.doesNotMatch(html, /id="team-toggle"/);
    assert.doesNotMatch(html, /id="team-options"/);
  });
});
