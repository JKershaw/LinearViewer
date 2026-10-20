/**
 * Workspace KPIs page renderer (LIN-3689) — the in-Harbour, one-workspace
 * sibling of the public /kpis page, sitting next to Settings.
 *
 * Server-rendered from `collectWorkspaceKpis` output (lib/workspace-kpi-stats.js):
 * counts, app-defined labels and this workspace's own API-equivalent cost
 * estimate, nothing instance-wide. Deliberately NOT lib/render-kpis.js (the
 * public page) and not the escalation KPIs page; it borrows only the card
 * styles of public/escalation-kpis.css.
 *
 * LIN-3711: trend charts. The numbers tables are server-rendered inside a
 * closed <details> so the page works without JavaScript; public/workspace-kpis.js
 * draws the canvases and sparklines from the same series, embedded as JSON.
 * Rates only, no rate/total toggle.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageHeader } from './components/page-header.js';

const DASH = '-';

// LIN-3713: under this many merges with forge times the figure is not shown.
export const MIN_MERGE_TIME_N = 3;

/** A count, or '-' when it is not a finite number (never NaN on the page). */
const formatCount = value => (Number.isFinite(value) ? String(value) : DASH);

/** Minutes, one decimal at most; '-' for a null/non-finite median. */
const formatMinutes = value => (Number.isFinite(value) ? `${value} min` : DASH);

// `spark` is the aria-label of the card's 30-day sparkline; feedback notes have
// no per-day series, so no sparkline.
const ACTIVITY_CARDS = [
  { key: 'dispatches', slug: 'dispatches', label: 'Dispatches', spark: 'Dispatches per day, last 30 days' },
  { key: 'autopilotRuns', slug: 'autopilot-runs', label: 'Autopilot runs', spark: 'Autopilot runs per day, last 30 days' },
  { key: 'agentActions', slug: 'agent-actions', label: 'Agent actions', spark: 'Agent actions per day, last 30 days' },
  { key: 'feedbackNotes', slug: 'feedback-notes', label: 'Feedback notes' }
];

/** Dollars for a table or note: a real cost under half a cent never reads as $0.00. */
function formatUsd(value) {
  if (!Number.isFinite(value)) return DASH;
  if (value > 0 && value < 0.005) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

function section(name, title, body) {
  return `<section class="workspace-kpis-section" data-testid="workspace-kpis-section-${name}">
      <h2>${escapeHtml(title)}</h2>
      ${body}
    </section>`;
}

function card(testId, label, valueHtml, sub = '', sparkHtml = '') {
  return `<div class="kpi-card" data-testid="${testId}">
        <div class="kpi-card-label">${escapeHtml(label)}</div>
        <div class="kpi-card-value">${valueHtml}</div>
        ${sub ? `<div class="kpi-card-sub">${escapeHtml(sub)}</div>` : ''}${sparkHtml}
      </div>`;
}

function activitySection(activity) {
  const cards = ACTIVITY_CARDS.map(({ key, slug, label, spark }) => card(
    `workspace-kpis-card-${slug}`,
    label,
    `<span data-testid="workspace-kpis-value-${slug}-7d">${formatCount(activity.last7[key])}</span>`
      + ' <span class="kpi-card-sub">7d</span> '
      + `<span data-testid="workspace-kpis-value-${slug}-30d">${formatCount(activity.last30[key])}</span>`
      + ' <span class="kpi-card-sub">30d</span>',
    '',
    spark ? `<span class="kpi-card-spark" data-testid="workspace-kpis-spark-${slug}" data-label="${escapeHtml(spark)}"></span>` : ''
  )).join('\n      ');
  return section('activity', 'Activity', `<div class="kpi-grid">
      ${cards}
    </div>`);
}

// A trend section: title, one "what it shows" line, the chart canvas for the
// page script, and the numbers (notes + table) in a closed disclosure. The
// canvas id is what HarbourCharts.draw looks up.
function trendSection(name, title, shows, notes, columns, rows, extraHtml = '') {
  const head = columns.map(column => `<th>${escapeHtml(column)}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('\n          ');
  const noteHtml = notes.map(note => `<p class="kpi-numbers-note">${escapeHtml(note)}</p>`).join('');
  return section(name, title, `<p class="kpi-chart-caption">${escapeHtml(shows)}</p>${extraHtml}
      <div class="kpi-chart-canvas"><canvas id="chart-${name}" data-testid="workspace-kpis-chart-${name}" data-empty-class="kpi-chart-empty"></canvas></div>
      <details class="kpi-numbers" data-testid="workspace-kpis-numbers-${name}"><summary>Show the numbers</summary>${noteHtml}
        <div class="kpi-numbers-wrap"><table data-testid="workspace-kpis-table-${name}">
          <thead><tr>${head}</tr></thead>
          <tbody>
          ${body}
          </tbody>
        </table></div>
      </details>`);
}

/** Day labels for a table; the last day is today, which is only part of a day. */
const dayRows = (days, ...series) => days.map((day, i) => [
  i === days.length - 1 ? `${day} · today, so far` : day,
  ...series.map(values => formatCount(values[i]))
]);

function trendSections(daily) {
  const sum = values => values.reduce((total, n) => total + n, 0);
  const noscript = '<noscript><p class="kpi-numbers-note" data-testid="workspace-kpis-noscript">Charts need JavaScript. Open "Show the numbers" under each heading for the same figures.</p></noscript>';

  const done = trendSection('done-per-day', 'Tasks done per day', 'Tasks the agent marked done, by day.', [
    '"Done" is the agent\'s done marker, not a verified merge.',
    'Tasks that started before the 30-day window may be only partly seen.'
  ], ['day', 'done'], dayRows(daily.days, daily.done), noscript);

  const { weeks, kinds } = daily.runsByKind;
  const weekRows = weeks.map((week, i) => [
    week,
    ...kinds.map(({ counts }) => formatCount(counts[i])),
    formatCount(sum(kinds.map(({ counts }) => counts[i])))
  ]);
  const runs = trendSection('runs-by-kind', 'Runs by kind per week', 'Dispatches per 7-day week, for the top kinds.', [
    'Weeks are the last 28 days, each labelled by its first day; the oldest 2 days of the 30 are in no week.',
    'Kinds beyond the top three are grouped as "other".'
  ], ['week starting', ...kinds.map(({ label }) => label), 'total'], weekRows);

  const { cost } = daily;
  const pricedLine = cost.pricedCount > 0
    ? `priced ${cost.pricedCount} of ${cost.lineageCount} tasks`
    : 'no priced tasks yet';
  const costRows = dayRows(daily.days).map((row, i) => [row[0], cost.pricedCount > 0 ? formatUsd(cost.perDay[i]) : DASH]);
  const costSection = trendSection('cost', 'API-equivalent cost', `Estimated from token usage by the day each task started; ${pricedLine}.`, [
    'An estimate of what this usage would cost at API prices, not a bill.',
    'A task is a dispatch and its follow-ups. Tasks without usage figures are left out, never counted as zero cost. Skipped tasks are excluded.'
  ], ['day', 'cost'], costRows);

  return [done, runs, costSection].join('\n    ');
}

/** LIN-3713: median and p90 hours from the forge's own PR times; a note when n is low. */
function mergeTimeCard(mergeTime) {
  const n = mergeTime?.n;
  const count = Number.isFinite(n) ? n : 0;
  const enough = count >= MIN_MERGE_TIME_N && Number.isFinite(mergeTime.medianHours) && Number.isFinite(mergeTime.p90Hours);
  const value = enough
    ? `median ${mergeTime.medianHours}h · p90 ${mergeTime.p90Hours}h`
    : '○ too few merges with forge times';
  return card('workspace-kpis-card-merge-time', 'Time to merge', escapeHtml(value),
    `n = ${count} merges · 30d`);
}

function funnelSection(funnel, mergeTime) {
  const stage = (slug, label, value, sub) => card(`workspace-kpis-funnel-${slug}`, label, formatCount(value), sub);
  return section('funnel', 'Funnel (30 days)', `<div class="kpi-grid">
      ${stage('dispatched', 'Dispatched', funnel.dispatched)}
      ${stage('taken', 'Taken', funnel.taken)}
      ${stage('reported', 'Reported', funnel.reported, 'at least')}
      ${stage('completed', 'Completed', funnel.completed, 'at least')}
      ${card('workspace-kpis-median-wait', 'Median wait to take', formatMinutes(funnel.medianWaitMinutes), 'dispatch to claim, not task duration')}
      ${mergeTimeCard(mergeTime)}
    </div>
    <p class="kpi-numbers-note" data-testid="workspace-kpis-merge-time-note">Time to merge counts only merges Harbour saw on a PR check, so n can be low.</p>`);
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
    : [activitySection(stats.activity), trendSections(stats.daily), funnelSection(stats.funnel, stats.mergeTime), kindsSection(stats.kinds)].join('\n    ');

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
    // The empty page draws no charts, so it embeds nothing.
    embeddedData: stats.empty ? undefined : { globalVar: '__WORKSPACE_KPI_DATA__', value: stats.daily },
    scripts: ['/chart.umd.min.js', '/chart-helpers.js', '/workspace-kpis.js', '/common.js', '/app.js']
  });
}
