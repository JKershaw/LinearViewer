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
import { formatRelativeTime } from './render.js';

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

/**
 * `—` for null/undefined — never `0%`. A genuine `0` renders `0%`, but a
 * real non-zero share below the whole-percent rounding threshold (LIN-1958
 * review F5: `Math.round(value * 100)` was collapsing anything under 0.005
 * to a flat `0%`, asserting an absence the data does not support — the same
 * family of false-zero the card is otherwise careful to avoid) renders
 * `<1%` instead of being rounded away.
 */
function formatShare(value) {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0%';
  const rounded = Math.round(value * 100);
  return rounded === 0 ? '<1%' : `${rounded}%`;
}

/**
 * `—` for null/undefined, else a 1dp ratio (e.g. `3.3`) — LIN-2253
 * `ticketsPerPricedLane`, published beside the per-task rate so a
 * discontinuity from the old anchor-denominated headline is self-explaining
 * (`oldAnchorRate ≈ newRate × ticketsPerPricedLane`) rather than read as an
 * efficiency win on faith. Not a percentage — can read above 1.
 */
function formatFactor(value) {
  return value === null || value === undefined ? '—' : (Math.round(value * 10) / 10).toFixed(1);
}

function renderStatCard(value, label, basis) {
  // Card chrome (border/fill/radius/padding) comes from the shared `.card`
  // primitive; the `kpi-card` class + value/label spans ride alongside as
  // no-style semantic/E2E hooks. `basis` is an optional third span naming
  // what population the count actually covers — a falsy basis renders the
  // original two-span body byte-identically, so every caller that doesn't
  // need a disclosure is unaffected (LIN-2325).
  const basisHtml = basis ? `<span class="kpi-card-basis">${escapeHtml(basis)}</span>` : '';
  return renderCard({
    className: 'kpi-card',
    body: `<span class="kpi-card-value">${formatNumber(value)}</span><span class="kpi-card-label">${escapeHtml(label)}</span>${basisHtml}`
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
 * running work. `overheadUsd` is labelled "resolved overhead" (never a bare
 * "overhead"), per the same handoff row: it is `done` AND issue-less spend
 * ONLY — unresolved issue-less spend routes to `inFlightUsd`/"unresolved"
 * instead, so a bare "overhead" would overstate it to a public reader as
 * covering all non-task spend (LIN-1958 review F2). Neither line, nor the
 * primary per-task figure, is presented as a complete decomposition of
 * windowed spend — partial pricing can leave real spend outside all three
 * (LIN-1957 close-out handoff comment on LIN-1958). `pricedLineageShare` is
 * deliberately NOT labelled "capture coverage" — it is blind to lineages
 * that posted no usage at all; the issue-level `unpriced`/`issueCount` pair
 * the handoff named as the metric that DOES cover that blind spot is
 * published alongside the shares (LIN-1958 review F4), and the window the
 * figure covers is published as its own span rather than folded into the
 * pinned label (LIN-1958 review F3).
 *
 * `captureRateShare` (LIN-1959) sits directly beside `pricedLineageShare`
 * in the coverage line: `pricedLineageShare`'s own denominator already excludes
 * every lineage that posted no usage at all, so read alone it cannot disclose
 * that exclusion — a public reader could see "priced lineages 100%" next to a
 * headline that in fact covers a small fraction of everything that ran. This
 * new share is the true capture rate (`usageBearingLineages ÷ ranLineages`,
 * the same `ranLineages` denominator `attributableLineageShare` uses) that
 * makes that gap visible rather than removing the true-but-narrower
 * `pricedLineageShare` field.
 */
function renderTerminalMarkedTaskCostCard(cost = {}, planFeeConfig = {}) {
  const {
    windowDays = 30,
    issueCount = 0,
    unpriced = 0,
    noLineageCount = 0,
    pricedTicketCount = 0,
    ticketsPerPricedLane = null,
    costUsd = null,
    inFlightUsd = null,
    overheadUsd = null,
    closeOutLineageShare = null,
    evidenceLinkedShare = null,
    opencodeSummedShare = null,
    unknownHarnessShare = null,
    pricedLineageShare = null,
    attributableLineageShare = null,
    captureRateShare = null
  } = cost || {};

  // LIN-2253 (narrowed headline-denominator follow-up): the per-task rate
  // divides by `pricedTicketCount` — the component-fold ticket denominator
  // `lib/terminal-marked-task-cost.js` emits — not `issueCount - unpriced`.
  // The old anchor-only denominator silently cancelled to the same
  // fully-priced-issue count a lane-landed ticket is never a member of (it
  // is never `fullyPriced` under the per-issue fold, so it always landed in
  // `unpriced` too), which is exactly why the headline never moved when a
  // lane delivered extra tickets. `pricedTicketCount` counts every ticket a
  // fully-priced lane actually delivered instead.
  const perTaskUsd = (costUsd !== null && pricedTicketCount > 0)
    ? costUsd / pricedTicketCount
    : null;

  // LIN-2418: the single `.kpi-cost-shares` span used to bundle four ratios
  // under one undisclosed denominator, but only two of them (close-out
  // linked, evidence linked) are actually over `issueCount` — the other two
  // (opencode summed, unknown harness) are defined only over issues WITH a
  // lineage (lib/terminal-marked-task-cost.js:300-301) and are computed over
  // `lineageBearingCount` there. Splitting into a goodness group (still
  // implicitly over issueCount, already named by the sample line above) and
  // an ignorance group with its OWN basis span naming the excluded
  // population is what makes that denominator visible rather than assumed —
  // a disclosure whose basis is unstated is the bug this ticket fixes.
  // `lineageBearingCount` is derived locally from the two fields already on
  // the wire (issueCount, noLineageCount) — no new field, mirroring the
  // compute layer's own derivation.
  const lineageBearingCount = issueCount - noLineageCount;

  return renderCard({
    className: 'kpi-cost-card',
    body: [
      `<span class="kpi-cost-value">${escapeHtml(formatUsd(perTaskUsd))}</span>`,
      '<span class="kpi-cost-label">cost per terminal-marked task</span>',
      `<span class="kpi-cost-window">${escapeHtml(formatNumber(windowDays))}d window</span>`,
      `<span class="kpi-cost-cash">cash: ${escapeHtml(resolveCashHeadline(planFeeConfig))} · ${escapeHtml(resolveCashSubLabel(planFeeConfig))}</span>`,
      `<span class="kpi-cost-sample">${escapeHtml(formatNumber(issueCount))} terminal-marked issues · ${escapeHtml(formatNumber(unpriced))} unpriced (excluded), of which ${escapeHtml(formatNumber(noLineageCount))} never observed (no lineage)</span>`,
      `<span class="kpi-cost-tickets-per-lane">${escapeHtml(formatFactor(ticketsPerPricedLane))} tickets per priced lane</span>`,
      '<span class="kpi-cost-shares-goodness">',
      `close-out linked ${escapeHtml(formatShare(closeOutLineageShare))} · `,
      `evidence linked ${escapeHtml(formatShare(evidenceLinkedShare))}`,
      '</span>',
      '<span class="kpi-cost-shares-ignorance">',
      `opencode summed ${escapeHtml(formatShare(opencodeSummedShare))} · `,
      `unknown harness ${escapeHtml(formatShare(unknownHarnessShare))}`,
      '</span>',
      `<span class="kpi-cost-shares-ignorance-basis">of ${escapeHtml(formatNumber(lineageBearingCount))} with a lineage (${escapeHtml(formatNumber(noLineageCount))} no-lineage excluded)</span>`,
      '<span class="kpi-cost-coverage">',
      `priced lineages ${escapeHtml(formatShare(pricedLineageShare))} · `,
      `capture rate ${escapeHtml(formatShare(captureRateShare))} · `,
      `attributable lineages ${escapeHtml(formatShare(attributableLineageShare))}`,
      '</span>',
      '<span class="kpi-cost-usd-lines">',
      `unresolved ${escapeHtml(formatUsd(inFlightUsd))} · `,
      `resolved overhead ${escapeHtml(formatUsd(overheadUsd))}`,
      '</span>'
    ].join('')
  });
}

/** `—` for null/undefined, else a 1dp percent value (no `%` suffix — callers append it). */
function formatPercentValue(value) {
  return value === null || value === undefined ? '—' : String(value);
}

/** `YYYY-MM-DD HH:mm UTC` for an ISO string; `—` for null/undefined/invalid. */
function formatDateTimeUtc(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The weekly-budget burn gauge card (LIN-2118): an ESTIMATE of the current
 * subscription window's consumption — Harbour cannot read Anthropic's own
 * meter directly, so every figure here is labelled as derived, never as a
 * direct reading. Sourced from `stats.weeklyBudgetGauge`
 * (lib/weekly-budget.js) as emitted, never re-derived.
 *
 * `percentSource`/`windowPricedLineageShare` are the provenance disclosures
 * this card is conditioned on publishing (mission constraint: "if a figure
 * is derived from telemetry with known capture gaps, say so ON the
 * surface") — the same disclosure discipline the cost-per-terminal-marked-
 * task card already established for its own shares.
 */
function renderWeeklyBudgetGaugeCard(gauge = {}) {
  const {
    percentConsumed = null,
    percentSource = 'none',
    burnRatePerHour = null,
    projectedExhaustionAt = null,
    resetAt = null,
    nextResetAt = null,
    windowLineageCount = 0,
    windowPricedLineageShare = null,
    checkpoint = null
  } = gauge || {};

  const percentLabel = percentConsumed === null ? '—' : `${escapeHtml(formatPercentValue(percentConsumed))}%`;
  const sourceLabel = percentSource === 'operator-reading'
    ? `estimate anchored to an operator reading at ${escapeHtml(formatDateTimeUtc(checkpoint && checkpoint.at))}`
    : percentSource === 'telemetry-estimate'
      ? 'estimate from telemetry alone — no operator reading yet this window'
      : 'no data yet this window';

  const burnRateLabel = burnRatePerHour === null ? '—' : `${escapeHtml(formatPercentValue(burnRatePerHour))} pts/hr`;
  const clipLabel = projectedExhaustionAt === null
    ? 'not projected to exhaust at the current rate'
    : `at this rate the window exhausts ${escapeHtml(formatDateTimeUtc(projectedExhaustionAt))}`;

  return renderCard({
    className: 'kpi-budget-card',
    body: [
      `<span class="kpi-budget-value">${percentLabel}</span>`,
      '<span class="kpi-budget-label">of weekly subscription window consumed (estimate)</span>',
      `<span class="kpi-budget-source">${sourceLabel} · never a direct meter read</span>`,
      `<span class="kpi-budget-rate">burn rate ${burnRateLabel} (last 24h) · ${clipLabel}</span>`,
      `<span class="kpi-budget-window">window ${escapeHtml(formatDateTimeUtc(resetAt))} → ${escapeHtml(formatDateTimeUtc(nextResetAt))}</span>`,
      `<span class="kpi-budget-coverage">${escapeHtml(formatNumber(windowLineageCount))} lineages this window · ${escapeHtml(formatShare(windowPricedLineageShare))} priced</span>`
    ].join('')
  });
}

// Exported for the unit test at the guard boundary below (LIN-2325 close-out
// ledger item 3) — module-private otherwise; renderKpisPage (same file)
// remains the one production caller.
export function renderChartBox(id, title, { wide = false, ranges = null, anchorId = null, caption = null, dynamicCaption = false } = {}) {
  // A static `caption` on a range-toggled chart is only true of the range it
  // was computed for (the exact F1 class this ticket exists to close) — the
  // one honest fixes are to wire a `dynamicCaption` updater or drop the
  // caption; auto-upgrading to `dynamicCaption` here would leave the slot
  // rendered with no client updater wired, so the stale-claim risk survives,
  // just moved.  (LIN-2325 close-out ledger item 3.)
  if (ranges && caption && !dynamicCaption) {
    throw new Error(`renderChartBox("${id}"): a static caption on a range-toggled chart would go stale on toggle — pass dynamicCaption:true and wire a client updater, or drop the caption`);
  }
  const toggleHtml = ranges
    ? `<span class="kpi-range-toggle" data-chart="${escapeHtml(id)}">${ranges.map((range, i) =>
      `<button type="button" class="kpi-range-btn${i === 0 ? ' is-active' : ''}" data-range="${escapeHtml(range)}">${escapeHtml(range)}</button>`
    ).join('')}</span>`
    : '';
  // A coverage/truncation disclosure, e.g. "+N more" or "lower bound". Lives
  // in the TITLE area, never `body` — `body` is what `emptyUnless()`
  // (public/kpis.js) replaces wholesale with a "no data yet" note on an
  // empty instance, the same trap OUTCOME_EVIDENCE_ANCHOR above avoids
  // (LIN-2325).
  //
  // `dynamicCaption` (LIN-2325 F1 review fix): a range-toggled chart's "+N
  // more" is only true of the range it was computed for — a fixed 30d
  // caption can keep claiming a truncation that the 24h view doesn't have.
  // Such a chart always renders a stable `#<id>-caption` span (hidden via
  // inline style when the initial count is 0, never omitted) so the client
  // range toggle can rewrite its text/visibility in place per view instead
  // of leaving a stale claim on screen.
  const showCaption = caption || dynamicCaption;
  const captionHtml = showCaption
    ? `<span class="kpi-chart-caption"${dynamicCaption ? ` id="${escapeHtml(id)}-caption"` : ''}${caption ? '' : ' style="display:none"'}>${escapeHtml(caption || '')}</span>`
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
    title: `<span><span class="kpi-tree-glyph">├─</span> ${escapeHtml(title)}</span>${captionHtml}${toggleHtml}`,
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
    renderStatCard(totals.workspaces, 'workspaces', totals.workspacesBasis),
    renderStatCard(totals.users, 'users'),
    renderStatCard(totals.activeSessions, 'active sessions'),
    renderStatCard(totals.agentActions, 'agent actions · 30d'),
    renderStatCard(totals.autopilotRuns, 'autopilot runs · 30d'),
    renderStatCard(totals.dispatches, 'prompts dispatched · 30d'),
    renderStatCard(totals.feedbackNotes, 'feedback notes · 30d'),
    renderStatCard(totals.aiSummaries, 'ai summaries cached'),
    renderStatCard(totals.roadmapReports, 'roadmap reports', totals.roadmapReportsBasis),
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
    <p class="kpi-subtitle">aggregate activity on this instance · collected ${escapeHtml(formatRelativeTime(stats.generatedAt))}</p>

${renderHeadlineCard(stats.dispatchOutcomes)}

${renderTerminalMarkedTaskCostCard(stats.terminalMarkedTaskCost, planFeeConfig)}

${renderWeeklyBudgetGaugeCard(stats.weeklyBudgetGauge)}

    <div class="kpi-cards" data-section="kpi-cards">
${cards}
    </div>

${renderChartBox('chart-proxy-phases', 'proxy calls by phase', { wide: true, ranges: ['30d', '24h'] })}

    <div class="kpi-chart-grid">
${renderChartBox('chart-weekly-budget', 'weekly budget burn · current window')}
${renderChartBox('chart-outcome-trend', 'work landed · weekly', { anchorId: OUTCOME_EVIDENCE_ANCHOR })}
${renderChartBox('chart-dispatch-weekly', 'dispatched work by kind · 30d')}
${renderChartBox('chart-dispatch-kinds', 'dispatch kinds · 30d', { caption: stats.dispatchKindsOtherCount ? `+${formatNumber(stats.dispatchKindsOtherCount)} more` : null })}
${renderChartBox('chart-funnel', 'work funnel · 30d', { caption: 'reported/completed are lower bounds' })}
${renderChartBox('chart-step-outcomes', 'step outcomes · 30d')}
${renderChartBox('chart-proxy-status', 'proxy responses · 30d', { ranges: ['30d', '24h'] })}
${renderChartBox('chart-top-endpoints', 'top proxy endpoints · 30d', { ranges: ['30d', '24h'], caption: stats.topEndpointsOtherCount ? `+${formatNumber(stats.topEndpointsOtherCount)} more` : null, dynamicCaption: true })}
${renderChartBox('chart-hour-of-day', 'work by hour · utc · 30d')}
${renderChartBox('chart-free-tier', 'free tier prompts · 7d')}
    </div>

    <p class="kpi-vanity"><span class="kpi-tree-glyph">└─</span> ${vanityHtml}</p>
  </main>
  ${footerHtml}`
  });
}
