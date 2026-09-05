/**
 * Effort self-assessment read-out — operator-facing page renderer (LIN-2641).
 *
 * Mirrors `lib/render-escalation-kpis.js`'s conventions: `kpi-grid` of
 * per-kind `kpi-card`s, no `<table>` anywhere (there is zero `<table` markup
 * in `lib/*.js` today — S1 sweep). Zero I/O, per `lib/render-session.js`'s
 * convention — the route does every read and hands this a plain data object.
 *
 * URL-only operator page (LIN-2566 research's recommended placement): ships
 * unflagged and unlinked, absent from `lib/components/navbar.js` and
 * `public/llms.txt`, sidestepping the feature-flag tier entirely.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';

function formatUsd(value) {
  return value == null ? '—' : `$${value.toFixed(2)}`;
}

function formatDuration(ms) {
  if (ms == null) return '—';
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function formatPercent(rate) {
  return rate == null ? '—' : `${Math.round(rate * 1000) / 10}%`;
}

function formatEffort(distribution) {
  if (!distribution) return null;
  return Object.entries(distribution)
    .map(([level, count]) => `${escapeHtml(level)}: ${count}`)
    .join(', ');
}

/**
 * Survival copy for one card, per Step 6's four states (D8). Distinct
 * wording for each so a reader never conflates "nobody instruments this
 * yet" (ii), "excluded by construction — orchestration overhead" (iii), and
 * "this kind simply has no next-gate concept" (iv).
 */
function renderSurvival(card) {
  const s = card.survival;
  if (s.state === 'unavailable_provider') {
    return `<div class="effort-card-value">—</div><div class="effort-card-sub">survival unavailable for this provider</div>`;
  }
  if (s.state === 'computed' && card.kind === 'plan') {
    // Omitted, not zeroed, when no description was read (J1 second half).
    const gateNote = s.gateFieldsUnavailable
      ? `<div class="effort-card-sub">plan-review due/honoured: not read (no issue description available)</div>`
      : s.gateDue > 0
        ? `<div class="effort-card-sub">plan-review due: ${s.gateDue} · honoured: ${s.gateHonoured} (${formatPercent(s.gateHonouredRate)})</div>`
        : '';
    return `<div class="effort-card-value">${formatPercent(s.rate)}</div>
      <div class="effort-card-sub">${s.numerator} of ${s.denominator} first-pass approved</div>
      ${gateNote}`;
  }
  if (s.state === 'computed' && card.kind === 'implementation') {
    return `<div class="effort-card-value">${formatPercent(s.rate)}</div>
      <div class="effort-card-sub">${s.numerator} of ${s.denominator} approved (tier a/b only) · ${s.tierCCount} tier-c re-pass${s.tierCCount === 1 ? '' : 'es'} shown separately</div>`;
  }
  if (s.state === 'not_instrumented') {
    return `<div class="effort-card-value">—</div><div class="effort-card-sub">not instrumented</div>`;
  }
  if (s.state === 'not_applicable_orchestration') {
    return `<div class="effort-card-value">—</div><div class="effort-card-sub">not applicable — orchestration step</div>`;
  }
  return `<div class="effort-card-value">—</div><div class="effort-card-sub">not applicable — no next-gate pair defined for this kind</div>`;
}

function renderExclusions(card) {
  const excludedTotal = Object.values(card.excluded).reduce((a, b) => a + b, 0);
  const inFlightTotal = Object.values(card.inFlight).reduce((a, b) => a + b, 0);
  if (!excludedTotal && !inFlightTotal) return '';
  const parts = [];
  if (excludedTotal) parts.push(`${excludedTotal} never ran`);
  if (inFlightTotal) parts.push(`${inFlightTotal} in flight`);
  return `<div class="effort-card-footnote">${escapeHtml(parts.join(' · '))}</div>`;
}

/**
 * R2 (implementation review `62e30986`): cost and duration cover different
 * denominators of the same session set (only the priced lineages sum into
 * cost; only the terminally-timed lineages mean into duration) — a partly
 * covered figure is disclosed rather than presented as if it summarised
 * every session.
 */
function renderCoverage(card) {
  const parts = [];
  if (card.costUnpricedCount > 0) {
    parts.push(`${card.costPricedCount} of ${card.sessionCount} lineage${card.sessionCount === 1 ? '' : 's'} priced (cost)`);
  }
  if (card.durationMissingCount > 0) {
    parts.push(`${card.durationCoveredCount} of ${card.sessionCount} lineage${card.sessionCount === 1 ? '' : 's'} timed (duration)`);
  }
  if (!parts.length) return '';
  return `<div class="effort-card-footnote effort-card-coverage" data-testid="effort-card-coverage-${escapeHtml(card.kind)}">${escapeHtml(parts.join(' · '))}</div>`;
}

function renderKindCard(card) {
  const effortText = formatEffort(card.effort);
  return `<div class="kpi-card effort-card" data-testid="effort-card-${escapeHtml(card.kind)}">
    <div class="kpi-card-label">${escapeHtml(card.kind)}</div>
    <div class="effort-card-row">
      <div class="effort-card-metric-group">
        <span class="effort-card-metric-label">cost (total)</span>
        <span class="effort-card-metric">${formatUsd(card.costUsd)}</span>
      </div>
      <div class="effort-card-metric-group">
        <span class="effort-card-metric-label">duration (mean)</span>
        <span class="effort-card-metric">${formatDuration(card.durationMs)}</span>
      </div>
      <div class="effort-card-metric-group">
        <span class="effort-card-metric-label">effort (count)</span>
        <span class="effort-card-metric" data-testid="effort-card-effort-${escapeHtml(card.kind)}">${effortText || 'not reported'}</span>
      </div>
    </div>
    <div class="effort-card-sub">${card.sessionCount} lineage session${card.sessionCount === 1 ? '' : 's'}</div>
    ${renderSurvival(card)}
    ${renderCoverage(card)}
    ${renderExclusions(card)}
  </div>`;
}

/**
 * @param {string} workspaceName
 * @param {Object} options
 * @param {string} options.urlKey
 * @param {Array<Object>} [options.workspaces]
 * @param {Object} [options.featureFlags]
 * @param {ReturnType<import('./effort-readout.js').computeEffortReadout>} options.readout
 * @param {string} options.generatedAt
 * @returns {string}
 */
export function renderEffortReadoutPage(workspaceName = 'Workspace', options = {}) {
  const { urlKey = null, workspaces = [], featureFlags = {}, readout, generatedAt = null } = options;
  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'effort-readout', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo: {}, currentPage: '/effort-readout', urlKey, featureFlags });

  const cards = readout.perKind.map(renderKindCard).join('\n');

  const population = readout.population;
  const populationCaption = `Live queue: ${population.liveCount} row${population.liveCount === 1 ? '' : 's'} (TTL-scoped, not row-limited) · History: showing ${population.historyCount} of ${population.historyTotal} most-recently-resolved rows${population.historyTruncated ? ' (truncated to the 200-row bound)' : ''}.`;

  const completenessHtml = readout.completeness.skipped > 0
    ? `<p class="effort-completeness effort-completeness--incomplete" data-testid="effort-completeness">${readout.completeness.skipped} issue read(s) skipped (retryable upstream error) — figures below are computed over the remaining ${readout.completeness.issuesInCorpus} issue(s).</p>`
    : `<p class="effort-completeness" data-testid="effort-completeness">${readout.completeness.issuesInCorpus} issue(s) read, complete.</p>`;

  const notesHtml = `<div class="effort-notes" data-testid="effort-notes">
    <p class="effort-caption" data-testid="effort-caption-ship-empty">${escapeHtml(readout.notes.effortShipEmpty)}</p>
    <details class="effort-notes-details">
      <summary>What this does not measure</summary>
      <ul>
        <li>${escapeHtml(readout.notes.reviewGateDueHonoured)}</li>
        <li>${escapeHtml(readout.notes.orchestrationKinds)}</li>
        <li>${escapeHtml(readout.notes.noGatePairKinds)}</li>
        <li>${escapeHtml(readout.notes.denominatorsNotComparable)}</li>
        <li>${escapeHtml(readout.notes.siblingCompleteness)}</li>
        <li>${escapeHtml(readout.notes.costUnit)}</li>
        <li>${escapeHtml(readout.notes.walkKindBlindness)}</li>
        ${readout.notes.survivalUnavailable ? `<li>${escapeHtml(readout.notes.survivalUnavailable)}</li>` : ''}
        ${readout.notes.gateFieldsUnavailable ? `<li>${escapeHtml(readout.notes.gateFieldsUnavailable)}</li>` : ''}
      </ul>
    </details>
  </div>`;

  const content = `${renderPageHeader({
      title: 'Effort Self-Assessment',
      subtitle: 'Per-kind effort × cost × duration × survived-the-next-gate — LIN-2566 §5',
    })}
  <main class="container">
    <p class="effort-population" data-testid="effort-population">${escapeHtml(populationCaption)}</p>
    ${completenessHtml}
    <div class="kpi-grid effort-grid" data-testid="effort-grid">
      ${cards}
    </div>
    ${notesHtml}
    <p class="kpi-generated-at">${generatedAt ? `Generated ${escapeHtml(generatedAt)}` : ''}</p>
  </main>
  ${footerHtml}`;

  return renderPage({
    title: `${escapeHtml(workspaceName)} - Effort Self-Assessment`,
    stylesheets: ['/style.css', '/common-actions.css', '/escalation-kpis.css', '/effort-readout.css'],
    nav: navBarHtml,
    content,
    scripts: ['/common.js', '/app.js'],
  });
}
