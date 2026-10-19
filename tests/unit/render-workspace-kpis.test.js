/**
 * LIN-3689 — the workspace KPIs page renderer.
 * Run with: node --test tests/unit/render-workspace-kpis.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorkspaceKpisPage } from '../../lib/render-workspace-kpis.js';

const totals = { agentActions: 5, dispatches: 4, autopilotRuns: 1, feedbackNotes: 2 };

const stats = (overrides = {}) => ({
  generatedAt: '2026-06-10T12:00:00.000Z',
  activity: { last7: { ...totals, dispatches: 3 }, last30: totals },
  funnel: { dispatched: 4, taken: 2, reported: 2, completed: 1, medianWaitMinutes: 10 },
  kinds: [{ label: 'implementation', count: 3 }, { label: 'autopilot', count: 1 }],
  stored: { customPrompts: 2, roadmapReports: 1, roadmapReportsCap: 20 },
  empty: false,
  ...overrides
});

const render = s => renderWorkspaceKpisPage('Acme', { urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }], stats: s });
const has = (html, id) => html.includes(`data-testid="${id}"`);
const valueOf = (html, id) => new RegExp(`data-testid="${id}">([^<]*)<`).exec(html)?.[1];

test('renders every section, card and value test id', () => {
  const html = render(stats());
  for (const name of ['activity', 'funnel', 'kinds', 'stored']) assert.ok(has(html, `workspace-kpis-section-${name}`), name);
  for (const card of ['dispatches', 'autopilot-runs', 'agent-actions', 'feedback-notes']) {
    assert.ok(has(html, `workspace-kpis-card-${card}`), card);
    assert.ok(has(html, `workspace-kpis-value-${card}-7d`), `${card} 7d`);
    assert.ok(has(html, `workspace-kpis-value-${card}-30d`), `${card} 30d`);
  }
  for (const stage of ['dispatched', 'taken', 'reported', 'completed']) assert.ok(has(html, `workspace-kpis-funnel-${stage}`), stage);
  assert.ok(has(html, 'workspace-kpis-median-wait'));
  assert.ok(has(html, 'workspace-kpis-card-custom-prompts'));
  assert.ok(has(html, 'workspace-kpis-card-roadmap-reports'));
  assert.equal(html.match(/data-testid="workspace-kpis-kind-row"/g).length, 2);
  assert.equal(has(html, 'workspace-kpis-empty'), false);
  assert.equal(valueOf(html, 'workspace-kpis-value-dispatches-7d'), '3');
  assert.equal(valueOf(html, 'workspace-kpis-value-dispatches-30d'), '4');
  assert.match(html, /newest 20/);
  assert.match(html, /10 min/);
});

test('escapes kind labels', () => {
  const html = render(stats({ kinds: [{ label: '<img src=x onerror=alert(1)>', count: 1 }] }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a null median or a non-finite count shows "-", never NaN', () => {
  const html = render(stats({ funnel: { dispatched: NaN, taken: undefined, reported: 0, completed: 0, medianWaitMinutes: null } }));
  assert.doesNotMatch(html, /NaN|undefined|null/);
  assert.match(html, /data-testid="workspace-kpis-median-wait">\s*<div class="kpi-card-label">[^<]*<\/div>\s*<div class="kpi-card-value">-</);
});

test('the empty state replaces activity, funnel and kinds; stored stays', () => {
  const html = render(stats({ empty: true }));
  assert.ok(has(html, 'workspace-kpis-empty'));
  for (const name of ['activity', 'funnel', 'kinds']) assert.equal(has(html, `workspace-kpis-section-${name}`), false, name);
  assert.ok(has(html, 'workspace-kpis-section-stored'));
});

test('the nav marks kpis as the current view (bold, not a link)', () => {
  const html = render(stats());
  assert.match(html, /nav-view-current" data-testid="nav-view-kpis"/);
  assert.doesNotMatch(html, /<a [^>]*data-testid="nav-view-kpis"/);
  assert.match(html, /<a [^>]*data-testid="nav-view-settings"/);
});

test('names the workspace in the title and carries no cross-workspace content', () => {
  const html = render(stats());
  assert.match(html, /<title>Acme - KPIs<\/title>/);
  assert.match(html, /This workspace, last 7 and 30 days/);
});
