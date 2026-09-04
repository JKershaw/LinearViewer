import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderNavBar } from '../../lib/components/navbar.js';

// LIN-2519: the team selector gate widens from `currentPage === 'projects'`
// to membership in FILTERABLE_PAGES = {projects, swipe, swim, ship, roadmap}.
// The workspace switcher is unconditional and must not be affected by this
// widening (verified separately below).

const TEAMS = [{ id: 't1', name: 'Engineering', key: 'ENG' }];

function renderFor(currentPage, teams = TEAMS) {
  return renderNavBar({
    workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }],
    urlKey: 'acme',
    currentPage,
    teams,
    selectedTeamId: null
  });
}

test('team selector renders on every FILTERABLE_PAGES page', () => {
  for (const page of ['projects', 'swipe', 'swim', 'ship', 'roadmap']) {
    const html = renderFor(page);
    assert.match(html, /id="team-toggle"/, `expected team selector on ${page}`);
    assert.match(html, /id="team-options"/, `expected team options panel on ${page}`);
  }
});

test('team selector does not render on non-filterable pages', () => {
  for (const page of ['settings', 'audit', 'prompts', 'dispatch', 'proxy', 'observation', 'live-console', 'task-create', 'task-edit']) {
    const html = renderFor(page);
    assert.doesNotMatch(html, /id="team-toggle"/, `expected NO team selector on ${page}`);
    assert.doesNotMatch(html, /id="team-options"/, `expected NO team options panel on ${page}`);
  }
});

test('team selector is absent when teams is empty or absent, even on a filterable page (data-driven guard, not page-identity)', () => {
  const emptyTeams = renderFor('swim', []);
  assert.doesNotMatch(emptyTeams, /id="team-toggle"/);
  assert.doesNotMatch(emptyTeams, /id="team-options"/);

  const html = renderNavBar({
    workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }],
    urlKey: 'acme',
    currentPage: 'roadmap'
    // teams omitted entirely
  });
  assert.doesNotMatch(html, /id="team-toggle"/);
  assert.doesNotMatch(html, /id="team-options"/);
});

test('workspace switcher stays unconditional across the same page sweep (unaffected by the team gate widening)', () => {
  for (const page of ['projects', 'swipe', 'swim', 'ship', 'roadmap', 'settings', 'dispatch']) {
    const html = renderFor(page);
    assert.match(html, /id="workspace-toggle"/, `expected workspace switcher present on ${page}`);
  }
});
