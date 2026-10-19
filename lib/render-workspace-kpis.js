/**
 * Workspace KPIs page renderer (LIN-3689) — the in-Harbour, one-workspace
 * sibling of the public /kpis page, sitting next to Settings.
 *
 * Server-rendered from `collectWorkspaceKpis` output (lib/workspace-kpi-stats.js):
 * counts and app-defined labels only, nothing instance-wide. Deliberately NOT
 * lib/render-kpis.js (the public page) and not the escalation KPIs page; it
 * borrows only the card styles of public/escalation-kpis.css.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';

const DASH = '-';

/** A count, or '-' when it is not a finite number (never NaN on the page). */
const formatCount = value => (Number.isFinite(value) ? String(value) : DASH);

/** Minutes, one decimal at most; '-' for a null/non-finite median. */
const formatMinutes = value => (Number.isFinite(value) ? `${value} min` : DASH);

const ACTIVITY_CARDS = [
  { key: 'dispatches', slug: 'dispatches', label: 'Dispatches' },
  { key: 'autopilotRuns', slug: 'autopilot-runs', label: 'Autopilot runs' },
  { key: 'agentActions', slug: 'agent-actions', label: 'Agent actions' },
  { key: 'feedbackNotes', slug: 'feedback-notes', label: 'Feedback notes' }
];

function section(name, title, body) {
  return `<section class="workspace-kpis-section" data-testid="workspace-kpis-section-${name}">
      <h2>${escapeHtml(title)}</h2>
      ${body}
    </section>`;
}

function card(testId, label, valueHtml, sub = '') {
  return `<div class="kpi-card" data-testid="${testId}">
        <div class="kpi-card-label">${escapeHtml(label)}</div>
        <div class="kpi-card-value">${valueHtml}</div>
        ${sub ? `<div class="kpi-card-sub">${escapeHtml(sub)}</div>` : ''}
      </div>`;
}

function activitySection(activity) {
  const cards = ACTIVITY_CARDS.map(({ key, slug, label }) => card(
    `workspace-kpis-card-${slug}`,
    label,
    `<span data-testid="workspace-kpis-value-${slug}-7d">${formatCount(activity.last7[key])}</span>`
      + ' <span class="kpi-card-sub">7d</span> '
      + `<span data-testid="workspace-kpis-value-${slug}-30d">${formatCount(activity.last30[key])}</span>`
      + ' <span class="kpi-card-sub">30d</span>'
  )).join('\n      ');
  return section('activity', 'Activity', `<div class="kpi-grid">
      ${cards}
    </div>`);
}

function funnelSection(funnel) {
  const stage = (slug, label, value, sub) => card(`workspace-kpis-funnel-${slug}`, label, formatCount(value), sub);
  return section('funnel', 'Funnel (30 days)', `<div class="kpi-grid">
      ${stage('dispatched', 'Dispatched', funnel.dispatched)}
      ${stage('taken', 'Taken', funnel.taken)}
      ${stage('reported', 'Reported', funnel.reported, 'at least')}
      ${stage('completed', 'Completed', funnel.completed, 'at least')}
      ${card('workspace-kpis-median-wait', 'Median wait to take', formatMinutes(funnel.medianWaitMinutes), 'dispatch to claim, not task duration')}
    </div>`);
}

function kindsSection(kinds) {
  const rows = kinds.map(({ label, count }) =>
    `<li data-testid="workspace-kpis-kind-row">${escapeHtml(label)} <span class="kpi-card-sub">${formatCount(count)}</span></li>`
  ).join('\n        ');
  return section('kinds', 'Dispatch kinds (30 days)', `<ul>
        ${rows}
      </ul>`);
}

function storedSection(stored) {
  return section('stored', 'Stored', `<div class="kpi-grid">
      ${card('workspace-kpis-card-custom-prompts', 'Custom prompts', formatCount(stored.customPrompts))}
      ${card('workspace-kpis-card-roadmap-reports', 'Roadmap reports', formatCount(stored.roadmapReports), `newest ${stored.roadmapReportsCap}`)}
    </div>`);
}

/**
 * @param {string} workspaceName
 * @param {Object} options
 * @param {string} options.urlKey
 * @param {Array<Object>} [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @param {Object} options.stats - `collectWorkspaceKpis` output
 * @returns {string}
 */
export function renderWorkspaceKpisPage(workspaceName = 'Workspace', options = {}) {
  const { urlKey = null, workspaces = [], featureFlags = {}, stats } = options;

  const body = stats.empty
    ? '<p data-testid="workspace-kpis-empty">No dispatches or agent actions in the last 30 days.</p>'
    : [activitySection(stats.activity), funnelSection(stats.funnel), kindsSection(stats.kinds)].join('\n    ');

  const content = `${renderPageHeader({ title: 'KPIs', subtitle: 'This workspace, last 7 and 30 days' })}
  <main class="container" data-testid="workspace-kpis">
    ${body}
    ${storedSection(stats.stored)}
    <p class="kpi-generated-at">Generated ${escapeHtml(stats.generatedAt)}</p>
  </main>
  ${renderPageFooter({ deployInfo: {}, currentPage: '/kpis', urlKey, featureFlags })}`;

  return renderPage({
    title: `${escapeHtml(workspaceName)} - KPIs`,
    stylesheets: ['/style.css', '/common-actions.css', '/escalation-kpis.css'],
    nav: renderNavBar({ workspaces, urlKey, currentPage: 'kpis', featureFlags }),
    content,
    scripts: ['/common.js', '/app.js']
  });
}
