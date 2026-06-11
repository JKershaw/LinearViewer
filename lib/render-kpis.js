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

import { FAVICON_BASE64, escapeHtml } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatMinutes(minutes) {
  if (minutes < 1) return '<1m';
  if (minutes < 90) return `${Math.round(minutes)}m`;
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function renderStatCard(value, label) {
  return `      <div class="kpi-card">
        <span class="kpi-card-value">${formatNumber(value)}</span>
        <span class="kpi-card-label">${escapeHtml(label)}</span>
      </div>`;
}

function renderChartBox(id, title, { wide = false, ranges = null } = {}) {
  const toggleHtml = ranges
    ? `<span class="kpi-range-toggle" data-chart="${escapeHtml(id)}">${ranges.map((range, i) =>
      `<button type="button" class="kpi-range-btn${i === 0 ? ' is-active' : ''}" data-range="${escapeHtml(range)}">${escapeHtml(range)}</button>`
    ).join('')}</span>`
    : '';
  return `      <section class="kpi-chart-box${wide ? ' kpi-chart-wide' : ''}">
        <h3><span><span class="kpi-tree-glyph">├─</span> ${escapeHtml(title)}</span>${toggleHtml}</h3>
        <div class="kpi-chart-canvas"><canvas id="${escapeHtml(id)}"></canvas></div>
      </section>`;
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
  if (vanity.medianMinutesToResolve !== null && vanity.medianMinutesToResolve !== undefined) {
    vanityParts.push(`median dispatch→done: <strong>${escapeHtml(formatMinutes(vanity.medianMinutesToResolve))}</strong>`);
  }
  if (vanity.dbBackend) {
    vanityParts.push(`db: <strong>${escapeHtml(vanity.dbBackend)}</strong>`);
  }
  vanityParts.push(`generated: <span class="kpi-generated" data-timestamp="${escapeHtml(stats.generatedAt)}">${escapeHtml(stats.generatedAt)}</span>`);
  const vanityHtml = vanityParts.join(' · ');

  // Embed the stats payload for client-side chart rendering. Escape '<' so a
  // (hypothetical) string in the payload can't close the script tag.
  const statsJson = JSON.stringify(stats).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KPIs - Linear Projects Viewer</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/kpis.css">
</head>
<body class="is-landing kpis-page">
  <header>
    <h1><a href="/" class="header-link">Linear Projects Viewer</a></h1>
  </header>
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
  ${footerHtml}
  <script>window.__KPI_DATA__ = ${statsJson};</script>
  <script src="/chart.umd.min.js"></script>
  <script src="/kpis.js"></script>
</body>
</html>`;
}
