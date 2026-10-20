/**
 * Public /kpis page renderer (rebuilt design-first in LIN-3703; the design is
 * docs/plans/kpis-public-design.md).
 *
 * The page tells one story in three sections: does the work land, what the
 * agents do, how people get started. It renders the PUBLIC VIEW of the stats
 * (`toPublicKpis`, lib/kpi-stats.js) and nothing else — no raw stats object
 * reaches this file, the embedded `__KPI_DATA__` or the script. A count below
 * the small-count floor arrives as a `{ hidden }` leaf and renders here as a
 * server-side text row with a `data-` hook; the chart script skips those rows
 * by type (a number draws, an object does not), never by matching text.
 *
 * Public route — no authentication, intentionally not linked from any
 * navigation, noindex.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageFooter } from './components/footer.js';
import { renderPageHeader } from './components/page-header.js';
import { renderCard } from './components/card.js';
import { renderSection } from './components/section.js';
import { formatDayKey, formatRelativeTime } from './render.js';
import { PUBLIC_COUNT_FLOOR } from './kpi-stats.js';

const STORY = 'Harbour hands tickets to AI agents. Here is how much of that work lands, what the agents do, and how new people get from signing up to a merged pull request.';

// The id the headline's evidence link points at. It sits on the chart box's
// SECTION WRAPPER, never on the canvas: the script replaces an empty canvas
// with a note, which would take a canvas-borne id with it exactly when the
// link still renders.
const EVIDENCE_ANCHOR = 'kpi-outcome-evidence';

// Milestone steps in funnel order, with the words the page uses for them.
const STEP_LABELS = Object.freeze([
  ['login', 'signed up'],
  ['connected', 'connected'],
  ['firstGo', 'first go'],
  ['prOpened', 'pr opened'],
  ['mergeClicked', 'merge clicked']
]);

const HIDDEN_TEXT = Object.freeze({
  'below-floor': `fewer than ${PUBLIC_COUNT_FLOOR}`,
  withheld: 'not shown'
});

// Derivation notes for the chart disclosures (LIN-3710). Plain text, rendered
// on the server so they read without the script.
const NOTES = Object.freeze({
  'outcome-trend': [
    'Landed rate is done ÷ (done + failed + aborted) for work that started in each rolling 7-day week. The headline counts by start the same way.',
    'A week with nothing resolved has no rate, so the line has a gap. Skipped tasks are left out.'
  ],
  'outcome-weekly': [
    'Each task counts once, in the week it started, with the outcome its last marker gave it. Done is resolved minus failed minus aborted.',
    'Tasks still running are not shown. The four weeks are rolling 7-day spans, so they add up to less than the 30-day headline.'
  ],
  'done-daily': [
    'A task counts on the day the agent marked it [done], not on a verified merge, and not on the day it started, so this differs from the headline.',
    'A done task with no marker time has no day and is not counted. Skipped tasks are not counted. The last day is today, so far.'
  ],
  'proxy-phases': [
    'Calls to the Harbour proxy per day, split by the phase of the agent loop. The line is the mean of the daily total over the 7 days up to each day.',
    'The line starts on the seventh day and leaves out today, which is only part of a day.'
  ]
});

// LIN-3714: the fold's seven shares, each with a plain label naming its base.
// Coverage reads against all runs; bias against the finished tasks averaged.
const COST_FOLD = Object.freeze([
  { heading: 'Coverage, of all runs', rows: [
    ['attributableLineageShare', 'runs tied to a task'],
    ['captureRateShare', 'runs that reported usage'],
    ['pricedLineageShare', 'priced, of runs that reported usage']
  ] },
  { heading: 'Bias, of finished tasks', rows: [
    ['closeOutLineageShare', 'had a close-out run'],
    ['evidenceLinkedShare', 'linked to evidence'],
    ['opencodeSummedShare', 'on the summing runner, known runner only'],
    ['unknownHarnessShare', 'with an unknown runner']
  ] }
]);

const isHidden = leaf => leaf !== null && typeof leaf === 'object' && 'hidden' in leaf;

const num = value => Number(value || 0).toLocaleString('en-US');

// The text and the hook of a hidden leaf; a number is its own text.
const hiddenAttrs = leaf => `data-testid="kpis-hidden" data-hidden="${escapeHtml(leaf.hidden)}"`;
const countText = leaf => (isHidden(leaf) ? HIDDEN_TEXT[leaf.hidden] : num(leaf));

// LIN-3710: `spark` is the aria-label of a 30-day sparkline the page script
// draws into the empty span; no label, no span (workspaces gets none).
function statCard(name, label, value, basis, spark = '') {
  const valueHtml = isHidden(value)
    ? `<span class="kpi-card-value" ${hiddenAttrs(value)}>${escapeHtml(countText(value))}</span>`
    : `<span class="kpi-card-value">${num(value)}</span>`;
  const basisHtml = basis ? `<span class="kpi-card-basis">${escapeHtml(basis)}</span>` : '';
  const sparkHtml = spark ? `<span class="kpi-card-spark" data-testid="kpis-spark-${name}" data-label="${escapeHtml(spark)}"></span>` : '';
  return renderCard({
    className: 'kpi-card',
    attrs: `data-testid="kpis-card-${name}"`,
    body: `${valueHtml}<span class="kpi-card-label">${escapeHtml(label)}</span>${basisHtml}${sparkHtml}`
  });
}

/**
 * The headline: the share of resolved dispatches that landed, with its slices
 * and how many dispatches the rate is computed over, so it cannot be read as
 * covering all work. No rate (nothing resolved yet) is a dash and no anchor:
 * a link to an empty chart is a dead end.
 */
function headline(outcomes) {
  const { rate, done, failed, aborted, resolved, total, windowDays } = outcomes;
  const window = `${num(windowDays)}d`;
  const value = rate === null
    ? '<span class="kpi-headline-value">—</span>'
    : `<a class="kpi-headline-value" href="#${EVIDENCE_ANCHOR}">${Math.round(rate * 100)}%</a>`;
  return renderCard({
    className: 'kpi-headline',
    attrs: 'data-testid="kpis-headline"',
    body: [
      value,
      `<span class="kpi-headline-label">of dispatched work landed · ${window}</span>`,
      `<span class="kpi-headline-slices">done ${num(done)} · failed ${num(failed)} · aborted ${num(aborted)}</span>`,
      `<span class="kpi-headline-coverage">${num(resolved)} of ${num(total)} dispatches resolved · ${window}</span>`
    ].join('')
  });
}

const formatUsd = value => (typeof value === 'number' ? `$${value.toFixed(2)}` : '—');

// `—` for no value, never `0%`; a real share that rounds to 0 reads `<1%`.
function formatShare(value) {
  if (typeof value !== 'number') return '—';
  if (value === 0) return '0%';
  const rounded = Math.round(value * 100);
  return rounded === 0 ? '<1%' : `${rounded}%`;
}

/**
 * LIN-3714: one figure, the average cost of a finished task (API-equivalent),
 * and nothing beside it. What qualifies it (how many tasks, coverage, bias)
 * sits in a closed "Show the numbers" fold. `cost` null (fewer than the floor
 * of tasks, or nothing priced) is a dash, never $0, and the fold is left out:
 * there is no average for it to qualify.
 */
function costCard(cost, windowDays) {
  const fold = cost ? `<details class="kpi-numbers" data-testid="kpis-cost-numbers"><summary>Show the numbers</summary>
        <p class="kpi-numbers-note">Averaged over ${num(cost.tasks)} finished tasks.</p>
${COST_FOLD.map(({ heading, rows }) => `        <p class="kpi-numbers-note">${escapeHtml(heading)}</p>
        <ul class="kpi-cost-shares">
${rows.map(([key, label]) => `          <li data-share="${key}">${escapeHtml(label)}: ${escapeHtml(formatShare(cost.shares[key]))}</li>`).join('\n')}
        </ul>`).join('\n')}
      </details>` : '';
  return renderCard({
    className: 'kpi-headline kpi-cost',
    attrs: 'data-testid="kpis-cost"',
    body: [
      `<span class="kpi-headline-value" data-testid="kpis-cost-value">${escapeHtml(formatUsd(cost?.perTaskUsd))}</span>`,
      '<span class="kpi-headline-label">Cost per finished task</span>',
      `<span class="kpi-headline-slices">API-equivalent · last ${num(windowDays)} days</span>`,
      '<span class="kpi-headline-coverage">A task counts as finished when its agent marked it done.</span>',
      fold
    ].join('')
  });
}

// The disclosure under a chart (LIN-3710): derivation notes as server-rendered
// text, then a mount the page script fills with the table. Closed by default.
function numbersDisclosure(name, notes) {
  const paragraphs = notes.map(note => `<p class="kpi-numbers-note">${escapeHtml(note)}</p>`).join('');
  return `<details class="kpi-numbers" data-testid="kpis-numbers-${name}"><summary>Show the numbers</summary>${paragraphs}<div class="kpi-numbers-wrap" data-testid="kpis-numbers-table-${name}"></div></details>`;
}

// The lookback the caption names. Written here, not imported, so this page takes no
// new dependency on the rollup module; tests/unit/render-kpis.test.js pins it to
// ROLLUP_LOOKBACK_DAYS (lib/kpi-daily-rollup.js).
const LOOKBACK_DAYS = 7;

// LIN-3732: the tasks-finished box's running total. The toggle mount is filled
// by public/kpis.js (rate by default); the caption and the empty note stay
// hidden until the total view shows them. `doneTotal` is null until the rollup
// has a finished day, in which case there is no since line and no caption.
function doneTotalHtml(doneTotal) {
  const since = doneTotal
    ? `<p class="kpi-done-since" data-testid="kpis-done-since">Tasks finished since ${formatDayKey(doneTotal.since)}: ${num(doneTotal.total)}</p>`
    : '';
  const caption = doneTotal
    ? `<p class="kpi-numbers-note" hidden data-testid="kpis-total-caption">Running total of tasks finished across every workspace, through ${formatDayKey(doneTotal.through)}; the axis starts at ${formatDayKey(doneTotal.since)}. Approximate: a task whose last run was dispatched more than ${LOOKBACK_DAYS} days before it finished can be missed.</p>`
    : '';
  return `${since}<div data-testid="kpis-toggle-done-daily"></div>${caption}<p class="kpi-chart-empty" hidden data-testid="kpis-total-empty">○ no running total yet</p>`;
}

function chartBox(name, title, { caption = '', anchor = '', rowsHtml = '', notes = null, canvasHtml = null } = {}) {
  const captionHtml = caption ? `<span class="kpi-chart-caption">${escapeHtml(caption)}</span>` : '';
  const idAttr = anchor ? ` id="${anchor}"` : '';
  return renderSection({
    boxed: true,
    className: 'kpi-chart-box',
    attrs: `data-testid="kpis-chart-${name}"${idAttr}`,
    titleTag: 'h3',
    titleClass: '',
    title: `<span>${escapeHtml(title)}</span>${captionHtml}`,
    // Rows sit beside the canvas wrapper, not inside it: the script replaces
    // only the canvas when there is nothing to draw, and the rows must stay.
    body: `${canvasHtml ?? `<div class="kpi-chart-canvas"><canvas id="chart-${name}" data-empty-class="kpi-chart-empty"></canvas></div>`}${rowsHtml}${notes ? numbersDisclosure(name, notes) : ''}`
  });
}

// One text row per step the chart cannot draw: no signal (could not read) or a
// hidden count. A reached step with a count — zero included — is a bar.
function stepRows(steps) {
  return STEP_LABELS.flatMap(([key, label]) => {
    const step = steps[key];
    if (!step) return [];
    if (step.state === 'no-signal') {
      return [`<p class="kpi-chart-empty" data-milestone-step="${key}">${escapeHtml(`${label}: no signal, ${step.coverage}`)}</p>`];
    }
    if (isHidden(step.count)) {
      return [`<p class="kpi-chart-empty" ${hiddenAttrs(step.count)} data-milestone-step="${key}">${escapeHtml(`${label}: ${countText(step.count)}`)}</p>`];
    }
    return [];
  }).join('\n');
}

function modeValue(field, leaf) {
  return isHidden(leaf)
    ? `<span data-field="${field}" ${hiddenAttrs(leaf)}>${escapeHtml(countText(leaf))}</span>`
    : `<span data-field="${field}">${num(leaf)}</span>`;
}

// How the first runs start (copy, run-step, run-task): exact counts, or the
// hidden text with its hook. Absent mode instrument renders nothing.
function modeRows(mode) {
  if (!mode) return '';
  const rungs = mode.byRung.map(({ rung, entries, notReady }) =>
    `<li data-mode-rung="${escapeHtml(rung)}">${escapeHtml(rung)}: ${modeValue('entries', entries)} entries · ${modeValue('notReady', notReady)} not ready</li>`
  ).join('\n');
  return `<div class="kpi-mode" data-testid="kpis-mode">
      <p class="kpi-mode-total">task entries in the window: ${modeValue('total', mode.total)}</p>
      <ul class="kpi-mode-rungs">
${rungs}
      </ul>
    </div>`;
}

/**
 * Render the full KPIs page.
 *
 * @param {Object} view - Output of toPublicKpis()
 * @param {Object} [options]
 * @param {Object} [options.deployInfo] - Deploy information (see lib/deploy-info.js)
 * @returns {string} Full HTML document
 */
export function renderKpisPage(view, { deployInfo } = {}) {
  const { outcomes, totals, milestoneFunnel, cost } = view;
  const footerHtml = renderPageFooter({ isLanding: true, deployInfo, currentPage: '/kpis' });

  const outcomeSection = `<section class="kpi-section" data-testid="kpis-section-outcome">
      <h2 class="kpi-section-title">Does the work land?</h2>
${headline(outcomes)}
${costCard(cost, outcomes.windowDays)}
${chartBox('outcome-trend', 'work landed · weekly', { anchor: EVIDENCE_ANCHOR, caption: 'share of resolved work that landed, by start week', notes: NOTES['outcome-trend'] })}
${chartBox('outcome-weekly', 'work resolved · weekly', { caption: 'done, failed and aborted, by start week', notes: NOTES['outcome-weekly'] })}
${chartBox('done-daily', 'tasks finished · daily', { caption: 'tasks marked done each day, last 30 days', notes: NOTES['done-daily'], canvasHtml: doneTotalHtml(view.doneTotal) })}
    </section>`;

  const activitySection = `<section class="kpi-section" data-testid="kpis-section-activity">
      <h2 class="kpi-section-title">What the agents do</h2>
      <div class="kpi-cards">
${statCard('workspaces', 'workspaces', totals.workspaces, totals.workspacesBasis)}
${statCard('agent-actions', 'agent actions · 30d', totals.agentActions, 'line: proxy calls per day', 'proxy calls per day')}
${statCard('dispatches', 'prompts dispatched · 30d', totals.dispatches, '', 'prompts dispatched per day')}
${statCard('autopilot-runs', 'autopilot runs · 30d', totals.autopilotRuns, '', 'autopilot runs per day')}
      </div>
${chartBox('proxy-phases', 'proxy calls', { caption: 'per day by phase, with a 7-day average', notes: NOTES['proxy-phases'] })}
${chartBox('dispatch-kinds', 'dispatch kinds · 30d')}
    </section>`;

  const peopleSection = `<section class="kpi-section" data-testid="kpis-section-people">
      <h2 class="kpi-section-title">How people get started</h2>
${chartBox('milestone-funnel', 'from sign-up to merge · 30d', {
    caption: 'people who signed up in the last 30 days, and how many have reached each step so far',
    rowsHtml: stepRows(milestoneFunnel.steps)
  })}
${modeRows(milestoneFunnel.mode)}
    </section>`;

  const privacy = `<p class="kpi-privacy" data-testid="kpis-privacy">Counts below ${PUBLIC_COUNT_FLOOR} show as &ldquo;fewer than ${PUBLIC_COUNT_FLOOR}&rdquo;. This page shows totals and counts only, and never shows names, workspace keys or content. See the <a href="/privacy">privacy policy</a>.</p>`;

  return renderPage({
    title: 'KPIs - Harbour',
    stylesheets: ['/style.css', '/kpis.css'],
    bodyClass: 'is-landing kpis-page',
    headExtra: '<meta name="robots" content="noindex">',
    embeddedData: { globalVar: '__KPI_DATA__', value: view },
    scripts: ['/chart.umd.min.js', '/chart-helpers.js', '/kpis.js'],
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="kpis-content" data-hidden-text="${escapeHtml(JSON.stringify(HIDDEN_TEXT))}">
    <h2>Harbour in numbers</h2>
    <p class="kpi-story">${escapeHtml(STORY)}</p>
    <p class="kpi-subtitle" data-testid="kpis-generated" data-timestamp="${escapeHtml(view.generatedAt)}">collected ${escapeHtml(formatRelativeTime(view.generatedAt))}</p>

    ${outcomeSection}

    ${activitySection}

    ${peopleSection}

    ${privacy}
  </main>
  ${footerHtml}`
  });
}
