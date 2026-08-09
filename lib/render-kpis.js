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

/** `—` for null/undefined — never `$0` — otherwise a 2dp USD figure. */
function formatUsd(value) {
  return value === null || value === undefined ? '—' : `$${value.toFixed(2)}`;
}

/** `—` for null/undefined — never `0%` — otherwise a whole-percent share. */
function formatShare(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
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

// The id the headline's evidence link points at. It goes on the chart box's
// SECTION WRAPPER, never on the canvas: `emptyUnless()` (public/kpis.js)
// replaces the canvas with a "no data yet" note, which would destroy a
// canvas-borne id on exactly the empty instance where the link still renders.
const OUTCOME_EVIDENCE_ANCHOR = 'kpi-outcome-evidence';

/**
 * The page's headline number (LIN-1596): the fraction of dispatched work that
 * landed, with its done/failed/aborted slices and a coverage sub-label naming
 * how many dispatches the rate is actually computed over — so it cannot be
 * misread as covering all dispatched work.
 *
 * `renderStatCard` is not reusable here: it hard-codes `formatNumber`, which is
 * wrong for a ratio. `renderCard`'s `body` slot is raw HTML by contract, so the
 * value wraps in an anchor with no change to the shared card primitive.
 *
 * When the rate is unavailable (nothing resolved yet) the value renders as `—`
 * with the label intact and NO anchor — a link to an empty chart is a dead end.
 */
function renderHeadlineCard(outcomes = {}) {
  const { rate = null, done = 0, failed = 0, aborted = 0, resolved = 0, total = 0, windowDays = 30 } = outcomes || {};
  const windowLabel = `${formatNumber(windowDays)}d`;
  const valueHtml = rate === null
    ? '<span class="kpi-headline-value">—</span>'
    : `<a class="kpi-headline-value" href="#${OUTCOME_EVIDENCE_ANCHOR}">${Math.round(rate * 100)}%</a>`;

  return renderCard({
    className: 'kpi-headline',
    body: [
      valueHtml,
      `<span class="kpi-headline-label">of dispatched work landed · ${escapeHtml(windowLabel)}</span>`,
      `<span class="kpi-headline-slices">done ${formatNumber(done)} · failed ${formatNumber(failed)} · aborted ${formatNumber(aborted)}</span>`,
      `<span class="kpi-headline-coverage">${formatNumber(resolved)} of ${formatNumber(total)} dispatches resolved · ${escapeHtml(windowLabel)}</span>`
    ].join('')
  });
}

/**
 * The cash headline for the terminal-marked-task-cost card. Reads the
 * plan-fee seam (lib/plan-fee-config.js) rather than hardcoding the dash,
 * but currently renders "—" whether or not an operator has configured
 * `monthlyUsd`: turning a raw configured amount into a per-task cash figure
 * needs an amortisation rule (over what period, across which workspaces,
 * what a zero-terminal-marked-task period publishes) that LIN-1958 leaves
 * as an explicit open item — inventing one here would be exactly the
 * invented value the ticket forbids. This is the seam a later session wires
 * a real formula into once that rule is decided.
 */
function resolveCashHeadline(planFeeConfig = {}) {
  const { monthlyUsd = null } = planFeeConfig || {};
  if (monthlyUsd === null) return '—'; // nothing configured to amortise
  return '—'; // configured, but no amortisation rule exists yet — do not invent one
}

/**
 * The sub-label explaining WHY the cash headline above is "—". Must name the
 * actual blocker in each state, not a fixed phrase: an unset `monthlyUsd` is
 * blocked on operator configuration, but a configured one is blocked on the
 * still-missing amortisation rule (period, workspace scope) — reusing
 * "pending plan-fee configuration" for the configured case would be false
 * once an operator has, in fact, configured it.
 */
function resolveCashSubLabel(planFeeConfig = {}) {
  const { monthlyUsd = null } = planFeeConfig || {};
  return monthlyUsd === null
    ? 'pending plan-fee configuration'
    : 'plan fee configured · pending amortisation rule';
}

/**
 * The cost-per-terminal-marked-task card (LIN-1958, Session 2 of LIN-1625):
 * a bespoke headline-style card — same above-the-grid placement as
 * `renderHeadlineCard`, no 24h toggle — for the API-equivalent dollar cost of
 * dispatched work that reached a `[done]` terminal marker in the outcome
 * window, sourced from `stats.terminalMarkedTaskCost`
 * (lib/terminal-marked-task-cost.js) as emitted, never re-derived.
 *
 * Label is pinned verbatim by the 2026-08-03 ruling: "cost per
 * terminal-marked task" — never "verified" or a reserved-word synonym, since
 * a `[done]` marker is a strictly weaker claim than true verified-done
 * (LIN-1878). The four bias/coverage shares plus the two declared-coverage
 * ratios are published beside the number, not hidden — the ruling's
 * condition for publishing the number at all.
 *
 * `inFlightUsd` is labelled "unresolved" (never "in-flight"): the source
 * field is ALL non-`done` lineage spend, including failed/aborted, not just
 * running work. `overheadUsd` is `done` AND issue-less spend only. Neither
 * line, nor the primary per-task figure, is presented as a complete
 * decomposition of windowed spend — partial pricing can leave real spend
 * outside all three (LIN-1957 close-out handoff comment on LIN-1958).
 * `pricedLineageShare` is deliberately NOT labelled "capture coverage" — it
 * is blind to lineages that posted no usage at all.
 */
function renderTerminalMarkedTaskCostCard(cost = {}, planFeeConfig = {}) {
  const {
    issueCount = 0,
    unpriced = 0,
    costUsd = null,
    inFlightUsd = null,
    overheadUsd = null,
    closeOutLineageShare = null,
    evidenceLinkedShare = null,
    opencodeSummedShare = null,
    unknownHarnessShare = null,
    pricedLineageShare = null,
    attributableLineageShare = null
  } = cost || {};

  // costUsd is a TOTAL over the fully-priced issues only — the per-task rate
  // divides by that fully-priced subset (issueCount - unpriced), not by
  // issueCount itself, which would silently understate the figure by
  // counting excluded issues in the denominator
  // (lib/terminal-marked-task-cost.js:246-259).
  const pricedIssueCount = issueCount - unpriced;
  const perTaskUsd = (costUsd !== null && pricedIssueCount > 0)
    ? costUsd / pricedIssueCount
    : null;

  return renderCard({
    className: 'kpi-cost-card',
    body: [
      `<span class="kpi-cost-value">${escapeHtml(formatUsd(perTaskUsd))}</span>`,
      '<span class="kpi-cost-label">cost per terminal-marked task</span>',
      `<span class="kpi-cost-cash">cash: ${escapeHtml(resolveCashHeadline(planFeeConfig))} · ${escapeHtml(resolveCashSubLabel(planFeeConfig))}</span>`,
      '<span class="kpi-cost-shares">',
      `close-out linked ${escapeHtml(formatShare(closeOutLineageShare))} · `,
      `evidence linked ${escapeHtml(formatShare(evidenceLinkedShare))} · `,
      `opencode summed ${escapeHtml(formatShare(opencodeSummedShare))} · `,
      `unknown harness ${escapeHtml(formatShare(unknownHarnessShare))}`,
      '</span>',
      '<span class="kpi-cost-coverage">',
      `priced lineages ${escapeHtml(formatShare(pricedLineageShare))} · `,
      `attributable lineages ${escapeHtml(formatShare(attributableLineageShare))}`,
      '</span>',
      '<span class="kpi-cost-usd-lines">',
      `unresolved ${escapeHtml(formatUsd(inFlightUsd))} · `,
      `overhead ${escapeHtml(formatUsd(overheadUsd))}`,
      '</span>'
    ].join('')
  });
}

function renderChartBox(id, title, { wide = false, ranges = null, anchorId = null } = {}) {
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
    attrs: anchorId ? `id="${escapeHtml(anchorId)}"` : undefined,
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
 * @param {Object} [options.deployInfo] - Deploy information (see lib/deploy-info.js)
 * @param {Object} [options.planFeeConfig] - Plan-fee config (see lib/plan-fee-config.js)
 * @returns {string} Full HTML document
 */
export function renderKpisPage(stats, { deployInfo, planFeeConfig } = {}) {
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

${renderHeadlineCard(stats.dispatchOutcomes)}

${renderTerminalMarkedTaskCostCard(stats.terminalMarkedTaskCost, planFeeConfig)}

    <div class="kpi-cards" data-section="kpi-cards">
${cards}
    </div>

${renderChartBox('chart-proxy-phases', 'proxy calls by phase', { wide: true, ranges: ['30d', '24h'] })}

    <div class="kpi-chart-grid">
${renderChartBox('chart-outcome-trend', 'work landed · weekly', { anchorId: OUTCOME_EVIDENCE_ANCHOR })}
${renderChartBox('chart-dispatch-weekly', 'dispatched work by kind · 30d')}
${renderChartBox('chart-dispatch-kinds', 'dispatch kinds · 30d')}
${renderChartBox('chart-funnel', 'work funnel · 30d')}
${renderChartBox('chart-step-outcomes', 'step outcomes · 30d')}
${renderChartBox('chart-proxy-status', 'proxy responses · 30d', { ranges: ['30d', '24h'] })}
${renderChartBox('chart-top-endpoints', 'top proxy endpoints · 30d', { ranges: ['30d', '24h'] })}
${renderChartBox('chart-hour-of-day', 'work by hour · utc · 30d')}
${renderChartBox('chart-free-tier', 'free tier prompts · 7d')}
    </div>

    <p class="kpi-vanity"><span class="kpi-tree-glyph">└─</span> ${vanityHtml}</p>
  </main>
  ${footerHtml}`
  });
}
