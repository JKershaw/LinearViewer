/**
 * KPIs page renderer for the public /kpis route.
 *
 * Renders instance-wide aggregate stats as a CLI-aesthetic dashboard:
 * server-rendered stat cards (readable without JS) plus Chart.js canvases
 * hydrated client-side from an embedded data payload.
 *
 * Public route — no authentication required, and intentionally not linked
 * from any navigation. The stats object comes from lib/kpi-stats.js, which
 * guarantees it contains only aggregates safe for public display.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderPageHeader } from './components/page-header.js';
import { renderCard } from './components/card.js';
import { renderSection } from './components/section.js';

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatMinutes(minutes) {
  if (minutes < 1) return '<1m';
  if (minutes < 90) return `${Math.round(minutes)}m`;
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function renderStatCard(value, label) {
  // Card chrome (border/fill/radius/padding) comes from the shared `.card`
  // primitive; the `kpi-card` class + value/label spans ride alongside as
  // no-style semantic/E2E hooks.
  return renderCard({
    className: 'kpi-card',
    body: `<span class="kpi-card-value">${formatNumber(value)}</span><span class="kpi-card-label">${escapeHtml(label)}</span>`
  });
}

function renderChartBox(id, title, { wide = false, ranges = null } = {}) {
  const toggleHtml = ranges
    ? `<span class="kpi-range-toggle" data-chart="${escapeHtml(id)}">${ranges.map((range, i) =>
      `<button type="button" class="kpi-range-btn${i === 0 ? ' is-active' : ''}" data-range="${escapeHtml(range)}">${escapeHtml(range)}</button>`
    ).join('')}</span>`
    : '';
  // Box chrome (inset fill/radius/padding) comes from the shared boxed
  // `.section` primitive; `kpi-chart-box`/`kpi-chart-wide` ride alongside as
  // layout/E2E hooks. `titleClass: ''` leaves the h3 unclassed so the existing
  // `.kpi-chart-box h3` rule styles it and the primitive's `.section-header`
  // rule does not hijack the tree-glyph + toggle markup.
  return renderSection({
    boxed: true,
    className: `kpi-chart-box${wide ? ' kpi-chart-wide' : ''}`,
    titleTag: 'h3',
    titleClass: '',
    title: `<span><span class="kpi-tree-glyph">├─</span> ${escapeHtml(title)}</span>${toggleHtml}`,
    body: `<div class="kpi-chart-canvas"><canvas id="${escapeHtml(id)}"></canvas></div>`
  });
}

/**
 * Render the full KPIs page.
 *
 * @param {Object} stats - Output of collectKpiStats()
 * @param {Object} [options]
 * @param {Object} [options.deployInfo] - Heroku deploy information
 * @returns {string} Full HTML document
 */
export function renderKpisPage(stats, { deployInfo } = {}) {
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/kpis' });
  const { totals, vanity } = stats;

  const cards = [
    renderStatCard(totals.workspaces, 'workspaces'),
    renderStatCard(totals.users, 'users'),
    renderStatCard(totals.activeSessions, 'active sessions'),
    renderStatCard(totals.agentActions, 'agent actions · 30d'),
    renderStatCard(totals.autopilotRuns, 'autopilot runs · 30d'),
    renderStatCard(totals.dispatches, 'prompts dispatched · 30d'),
    renderStatCard(totals.feedbackNotes, 'feedback notes · 30d'),
    renderStatCard(totals.aiSummaries, 'ai summaries cached'),
    renderStatCard(totals.roadmapReports, 'roadmap reports'),
    renderStatCard(totals.customPrompts, 'custom prompts'),
    renderStatCard(totals.activeTokens, 'agent tokens')
  ].join('\n');

  const vanityParts = [];
  if (vanity.busiestDay) {
    vanityParts.push(`busiest day: <strong>${escapeHtml(vanity.busiestDay.day)}</strong> (${formatNumber(vanity.busiestDay.count)} actions)`);
  }
  if (vanity.readsPerWrite !== null && vanity.readsPerWrite !== undefined) {
    vanityParts.push(`reads per write: <strong>${escapeHtml(String(vanity.readsPerWrite))}:1</strong>`);
  }
  if (vanity.medianQueueToTakeMinutes !== null && vanity.medianQueueToTakeMinutes !== undefined) {
    vanityParts.push(`median queue→take latency: <strong>${escapeHtml(formatMinutes(vanity.medianQueueToTakeMinutes))}</strong>`);
  }
  if (vanity.dbBackend) {
    vanityParts.push(`db: <strong>${escapeHtml(vanity.dbBackend)}</strong>`);
  }
  vanityParts.push(`generated: <span class="kpi-generated" data-timestamp="${escapeHtml(stats.generatedAt)}">${escapeHtml(stats.generatedAt)}</span>`);
  const vanityHtml = vanityParts.join(' · ');

  return renderPage({
    title: 'KPIs - Harbour',
    stylesheets: ['/style.css', '/kpis.css'],
    bodyClass: 'is-landing kpis-page',
    headExtra: '<meta name="robots" content="noindex">',
    embeddedData: { globalVar: '__KPI_DATA__', value: stats },
    scripts: ['/chart.umd.min.js', '/kpis.js'],
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="kpis-content">
    <h2>instance kpis</h2>
    <p class="kpi-subtitle">aggregate activity on this instance · cached for 60s</p>

    <div class="kpi-cards" data-section="kpi-cards">
${cards}
    </div>

${renderChartBox('chart-proxy-phases', 'proxy calls by phase', { wide: true, ranges: ['30d', '24h'] })}

    <div class="kpi-chart-grid">
${renderChartBox('chart-dispatch-weekly', 'dispatched work by kind · weekly')}
${renderChartBox('chart-dispatch-kinds', 'dispatch kinds · 30d')}
${renderChartBox('chart-funnel', 'work funnel · 30d')}
${renderChartBox('chart-step-outcomes', 'step outcomes · 30d')}
${renderChartBox('chart-proxy-status', 'proxy responses')}
${renderChartBox('chart-top-endpoints', 'top proxy endpoints · 30d')}
${renderChartBox('chart-hour-of-day', 'work by hour · utc · 30d')}
${renderChartBox('chart-free-tier', 'free tier prompts · 7d')}
    </div>

    <p class="kpi-vanity"><span class="kpi-tree-glyph">└─</span> ${vanityHtml}</p>
  </main>
  ${footerHtml}`
  });
}
