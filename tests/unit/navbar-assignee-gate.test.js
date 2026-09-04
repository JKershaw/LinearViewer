import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderNavBar } from '../../lib/components/navbar.js';

// LIN-2527: the assignee selector is dashboard-only — gated on
// `currentPage === 'projects'` DIRECTLY, never FILTERABLE_PAGES (the team
// gate's set, which now also reaches swipe/swim/ship/roadmap per LIN-2519).
// Reusing FILTERABLE_PAGES here would be actively wrong: /swipe, /swim,
// /ship, /roadmap keep the team selector but must stay assignee-free
// (LIN-2518 tracks that as a deliberate scope shrink, not an oversight).

const ASSIGNEES = ['Alice', 'Bob'];

function renderFor(currentPage, opts = {}) {
  return renderNavBar({
    workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }],
    urlKey: 'acme',
    currentPage,
    assignees: ASSIGNEES,
    selectedAssignee: null,
    canFilterByMe: false,
    ...opts
  });
}

test('assignee selector renders on the dashboard (projects) page only', () => {
  const html = renderFor('projects');
  assert.match(html, /id="assignee-toggle"/);
  assert.match(html, /id="assignee-options"/);
});

test('assignee selector is absent on every non-dashboard page — even the four team-filterable ones, EVEN with a populated assignees array (proves the gate, not just the data-absence guard)', () => {
  for (const page of ['swipe', 'swim', 'ship', 'roadmap', 'settings', 'audit', 'prompts', 'dispatch', 'proxy', 'observation']) {
    const html = renderFor(page);
    assert.doesNotMatch(html, /id="assignee-toggle"/, `expected NO assignee selector on ${page}`);
    assert.doesNotMatch(html, /id="assignee-options"/, `expected NO assignee options panel on ${page}`);
  }
});

test('assignee selector is absent when assignees is empty or absent, even on the dashboard (task-create/task-edit protection)', () => {
  const emptyAssignees = renderFor('projects', { assignees: [] });
  assert.doesNotMatch(emptyAssignees, /id="assignee-toggle"/);
  assert.doesNotMatch(emptyAssignees, /id="assignee-options"/);

  const html = renderNavBar({
    workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }],
    urlKey: 'acme',
    currentPage: 'projects'
    // assignees omitted entirely
  });
  assert.doesNotMatch(html, /id="assignee-toggle"/);
  assert.doesNotMatch(html, /id="assignee-options"/);
});

test('single-select, `all` default: the all row is marked selected when selectedAssignee is null/absent/"all"', () => {
  for (const selectedAssignee of [null, undefined, 'all']) {
    const html = renderFor('projects', { selectedAssignee });
    assert.match(html, /data-assignee="all"[\s\S]*?<span class="option-marker">●<\/span> all/);
    assert.match(html, /id="assignee-toggle"[^>]*>all</);
  }
});

test('a literal name selection marks that row selected and the toggle shows it', () => {
  const html = renderFor('projects', { selectedAssignee: 'Alice' });
  assert.match(html, /nav-option selected" role="option" aria-selected="true" data-assignee="Alice"/);
  assert.match(html, /id="assignee-toggle"[^>]*>Alice</);
  // The unselected 'all' row and the unselected 'Bob' row both show the empty marker.
  assert.match(html, /data-assignee="all">\s*<span class="option-marker">○<\/span> all/);
});

test('the `me` row sits directly under `all` and is present only when canFilterByMe', () => {
  const withMe = renderFor('projects', { canFilterByMe: true });
  assert.match(withMe, /data-assignee="all"[\s\S]*?<\/div>\s*<div class="nav-options-row">\s*<span class="option-prefix">├─<\/span>\s*<button class="nav-option" role="option" aria-selected="false" data-assignee="me">/);

  const withoutMe = renderFor('projects', { canFilterByMe: false });
  assert.doesNotMatch(withoutMe, /data-assignee="me"/);
});

test('selecting `me` marks the me row selected, and the toggle shows "me"', () => {
  const html = renderFor('projects', { canFilterByMe: true, selectedAssignee: 'me' });
  assert.match(html, /nav-option selected" role="option" aria-selected="true" data-assignee="me"/);
  assert.match(html, /id="assignee-toggle"[^>]*>me</);
});

test('team selector is unaffected — still renders on the dashboard alongside the new assignee selector', () => {
  const html = renderNavBar({
    workspaces: [{ id: 'w1', urlKey: 'acme', name: 'Acme' }],
    urlKey: 'acme',
    currentPage: 'projects',
    teams: [{ id: 't1', name: 'Engineering', key: 'ENG' }],
    selectedTeamId: null,
    assignees: ASSIGNEES,
    selectedAssignee: null
  });
  assert.match(html, /id="team-toggle"/);
  assert.match(html, /id="assignee-toggle"/);
});

test('workspace switcher stays unconditional, unaffected by the assignee gate', () => {
  for (const page of ['projects', 'swipe', 'settings']) {
    const html = renderFor(page);
    assert.match(html, /id="workspace-toggle"/, `expected workspace switcher present on ${page}`);
  }
});
