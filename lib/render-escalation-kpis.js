/**
 * Escalation KPIs — operator-facing audit page renderer (LIN-1736).
 *
 * Per docs/escalation-philosophy.md §7: escalation rate, time-to-response,
 * false-escalation rate, unanswered age — the tuning loop that keeps the
 * whole system honest. Server-rendered, load-once (the numbers are computed
 * fresh on every page load — no client polling; this is an operator's
 * periodic review, not a live feed).
 *
 * Deliberately NOT the public /kpis page (lib/render-kpis.js) — this is
 * session-authed, cross-workspace, and reads private per-workspace decision
 * data; lib/kpi-stats.js's public privacy boundary is untouched.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';

function formatDuration(ms) {
  if (ms == null) return '—';
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function formatRate(perDay) {
  return perDay < 10 ? (Math.round(perDay * 10) / 10).toString() : Math.round(perDay).toString();
}

function formatPercent(rate) {
  return rate == null ? '—' : `${Math.round(rate * 1000) / 10}%`;
}

function statCard({ label, value, sub, testId, warn }) {
  return `<div class="kpi-card${warn ? ' kpi-card--warn' : ''}" data-testid="${escapeHtml(testId)}">
    <div class="kpi-card-label">${escapeHtml(label)}</div>
    <div class="kpi-card-value">${value}</div>
    ${sub ? `<div class="kpi-card-sub">${sub}</div>` : ''}
  </div>`;
}

/**
 * @param {string} workspaceName
 * @param {Object} options
 * @param {string} options.urlKey
 * @param {Array<Object>} [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @param {ReturnType<import('./escalation-kpis.js').computeEscalationKpis>} options.kpis
 * @param {number} options.windowDays
 * @param {string} options.generatedAt
 * @returns {string}
 */
export function renderEscalationKpisPage(workspaceName = 'Workspace', options = {}) {
  const { urlKey = null, workspaces = [], featureFlags = {}, kpis, windowDays = 30, generatedAt = null } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'escalation-kpis', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo: {}, currentPage: '/escalation-kpis', urlKey, featureFlags });

  const { escalationRate, timeToResponse, falseEscalation, unansweredAge } = kpis;

  const cards = [
    statCard({
      label: 'Escalation rate',
      value: `${formatRate(escalationRate.perDay)} / day`,
      sub: escalationRate.targetPerDay == null
        ? `${escalationRate.raisedInWindow} raised in the last ${windowDays}d · no target set`
        : `${escalationRate.raisedInWindow} raised in the last ${windowDays}d · target ${formatRate(escalationRate.targetPerDay)}/day`,
      testId: 'kpi-escalation-rate',
      warn: escalationRate.overTarget === true,
    }),
    statCard({
      label: 'Time to response',
      value: formatDuration(timeToResponse.medianMs),
      sub: timeToResponse.count
        ? `median over ${timeToResponse.count} resolved · longest ${formatDuration(timeToResponse.maxMs)}`
        : 'no rulings resolved in this window',
      testId: 'kpi-time-to-response',
    }),
    statCard({
      label: 'False-escalation rate',
      value: formatPercent(falseEscalation.rate),
      sub: falseEscalation.total
        ? `${falseEscalation.dismissed} dismissed of ${falseEscalation.total} resolved — "why was I asked this?"`
        : 'no rulings resolved in this window',
      testId: 'kpi-false-escalation',
      warn: falseEscalation.rate != null && falseEscalation.rate > 0.2,
    }),
    statCard({
      label: 'Unanswered age',
      value: `${unansweredAge.staleCount} stale`,
      sub: unansweredAge.count
        ? `${unansweredAge.count} waiting · oldest ${formatDuration(unansweredAge.maxAgeMs)} (stale past ${formatDuration(unansweredAge.staleThresholdMs)})`
        : 'nothing currently unanswered',
      testId: 'kpi-unanswered-age',
      warn: unansweredAge.staleCount > 0,
    }),
  ].join('\n');

  const windowOptions = [7, 30, 90].map(d =>
    `<option value="${d}"${d === windowDays ? ' selected' : ''}>${d} days</option>`
  ).join('');

  const content = `${renderPageHeader({
      title: 'Escalation KPIs',
      subtitle: 'The tuning loop for the operator decision queue — docs/escalation-philosophy.md §7',
    })}
  <main class="container">
    <form method="get" class="kpi-window-form" data-testid="kpi-window-form">
      <label for="kpi-window-days">Window</label>
      <select id="kpi-window-days" name="windowDays" onchange="this.form.submit()">
        ${windowOptions}
      </select>
    </form>
    <div class="kpi-grid" data-testid="kpi-grid">
      ${cards}
    </div>
    <p class="kpi-generated-at">${generatedAt ? `Generated ${escapeHtml(generatedAt)}` : ''}</p>
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Escalation KPIs`,
    stylesheets: ['/style.css', '/common-actions.css', '/escalation-kpis.css'],
    nav: navBarHtml,
    content,
    scripts: ['/common.js', '/app.js'],
  });
}
