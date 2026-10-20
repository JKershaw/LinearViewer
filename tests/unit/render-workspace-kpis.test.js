/**
 * LIN-3689 — the workspace KPIs page renderer.
 * Run with: node --test tests/unit/render-workspace-kpis.test.js
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorkspaceKpisPage } from '../../lib/render-workspace-kpis.js';

const totals = { agentActions: 5, dispatches: 4, autopilotRuns: 1, feedbackNotes: 2 };

const DAYS = Array.from({ length: 30 }, (_, i) => `2026-05-${String(12 + i).padStart(2, '0')}`).map(d => (d > '2026-05-31' ? `2026-06-${String(Number(d.slice(8)) - 31).padStart(2, '0')}` : d));
const series = (...nonZero) => DAYS.map((_, i) => nonZero[i] ?? 0);
const daily = (overrides = {}) => ({
  days: DAYS,
  dispatches: series(1, 2),
  autopilotRuns: series(0, 1),
  agentActions: series(3),
  done: series(0, 1),
  runsByKind: {
    weeks: ['2026-05-14', '2026-05-21', '2026-05-28', '2026-06-04'],
    kinds: [{ label: 'implementation', counts: [1, 0, 2, 0] }, { label: 'other', counts: [0, 1, 0, 0] }]
  },
  cost: { perDay: series(0, 0.5), pricedCount: 1, lineageCount: 3 },
  ...overrides
});

const stats = (overrides = {}) => ({
  generatedAt: '2026-06-10T12:00:00.000Z',
  activity: { last7: { ...totals, dispatches: 3 }, last30: totals },
  funnel: { dispatched: 4, taken: 2, reported: 2, completed: 1, medianWaitMinutes: 10 },
  kinds: [{ label: 'implementation', count: 3 }, { label: 'autopilot', count: 1 }],
  daily: daily(),
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

// LIN-3711: trend charts.
const SECTIONS = ['done-per-day', 'runs-by-kind', 'cost'];

test('renders the three trend sections with canvas, disclosure and table each', () => {
  const html = render(stats());
  for (const name of SECTIONS) {
    assert.ok(has(html, `workspace-kpis-section-${name}`), `section ${name}`);
    assert.ok(has(html, `workspace-kpis-chart-${name}`), `canvas ${name}`);
    assert.ok(html.includes(`id="chart-${name}"`), `canvas id ${name}`);
    assert.match(html, new RegExp(`<details class="kpi-numbers" data-testid="workspace-kpis-numbers-${name}"><summary>Show the numbers</summary>`));
    assert.match(html, new RegExp(`<table data-testid="workspace-kpis-table-${name}">`));
  }
  assert.match(html, /Tasks the agent marked done, by day\./);
  assert.match(html, /not a verified merge/);
});

test('the three activity cards get a sparkline and feedback notes does not', () => {
  const html = render(stats());
  for (const card of ['dispatches', 'autopilot-runs', 'agent-actions']) assert.ok(has(html, `workspace-kpis-spark-${card}`), card);
  assert.equal(has(html, 'workspace-kpis-spark-feedback-notes'), false);
});

test('the tables hold the series: today is marked, weeks are labelled, a total column sums the kinds', () => {
  const html = render(stats());
  const table = name => new RegExp(`data-testid="workspace-kpis-table-${name}">([\\s\\S]*?)</table>`).exec(html)[1];
  assert.match(table('done-per-day'), /2026-06-10 · today, so far<\/td><td>0<\/td>/);
  assert.match(table('done-per-day'), /<td>2026-05-13<\/td><td>1<\/td>/);
  assert.match(table('runs-by-kind'), /<th>week starting<\/th><th>implementation<\/th><th>other<\/th><th>total<\/th>/);
  assert.match(table('runs-by-kind'), /<td>2026-05-21<\/td><td>0<\/td><td>1<\/td><td>1<\/td>/);
  assert.match(table('cost'), /<td>2026-05-13<\/td><td>\$0\.50<\/td>/);
});

test('cost: API-equivalent wording, priced N of M tasks, no priced tasks is never $0', () => {
  const html = render(stats());
  assert.match(html, /<h2>API-equivalent cost<\/h2>/);
  assert.match(html, /priced 1 of 3 tasks/);
  assert.match(html, /not a bill/);

  const none = render(stats({ daily: daily({ cost: { perDay: series(), pricedCount: 0, lineageCount: 2 } }) }));
  assert.match(none, /no priced tasks yet/);
  assert.doesNotMatch(none, /\$0\.00/);

  const tiny = render(stats({ daily: daily({ cost: { perDay: series(0.001), pricedCount: 1, lineageCount: 1 } }) }));
  assert.match(tiny, /<td>&lt;\$0\.01<\/td>/);
});

test('a noscript line says charts need JavaScript', () => {
  const html = render(stats());
  assert.match(html, /<noscript><p[^>]*data-testid="workspace-kpis-noscript">Charts need JavaScript/);
});

test('scripts load Chart.js, the shared helper and the page script before common and app', () => {
  const html = render(stats());
  const order = ['/chart.umd.min.js', '/chart-helpers.js', '/workspace-kpis.js', '/common.js', '/app.js'].map(src => html.indexOf(`src="${src}"`));
  assert.ok(order.every(i => i > -1), 'all five present');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(html.includes('/kpis.css'), false, 'the public stylesheet is not loaded');
  assert.match(html, /<script type="application\/json" data-global="__WORKSPACE_KPI_DATA__">/);
});

test('a hostile kind is escaped in the table and cannot break out of the embedded JSON', () => {
  const evil = '</script><b>x</b>';
  const html = render(stats({ daily: daily({ runsByKind: { weeks: ['2026-05-14'], kinds: [{ label: evil, counts: [1] }] } }) }));
  assert.equal(html.includes(evil), false);
  assert.match(html, /&lt;\/script&gt;&lt;b&gt;x&lt;\/b&gt;/);
  const embedded = /data-global="__WORKSPACE_KPI_DATA__">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(embedded).runsByKind.kinds[0].label, evil);
});

test('the empty state hides the trend sections and embeds no data', () => {
  const html = render(stats({ empty: true }));
  for (const name of SECTIONS) assert.equal(has(html, `workspace-kpis-section-${name}`), false, name);
  assert.equal(html.includes('__WORKSPACE_KPI_DATA__'), false);
});

test('escalation-kpis.css carries the chart height, empty-note, sparkline and numbers rules', () => {
  const css = readFileSync(new URL('../../public/escalation-kpis.css', import.meta.url), 'utf8');
  assert.match(css, /\.kpi-chart-canvas\s*\{[^}]*height:\s*200px/);
  assert.match(css, /@media \(min-width: 641px\)\s*\{\s*\.kpi-chart-canvas\s*\{\s*height:\s*240px/);
  for (const rule of ['.kpi-chart-empty', '.kpi-card-spark', '.kpi-numbers-wrap']) assert.ok(css.includes(rule), rule);
  assert.match(css, /\.kpi-numbers-wrap\s*\{[^}]*overflow-x:\s*auto/);
});

// LIN-3713: time to merge, from the forge's own PR times
const withMerge = mergeTime => render(stats({ mergeTime }));

test('merge-time card: median and p90 with the n line from 3 merges', () => {
  const html = withMerge({ n: 5, medianHours: 3, p90Hours: 10.5 });
  assert.ok(has(html, 'workspace-kpis-card-merge-time'));
  assert.match(html, /median 3h · p90 10\.5h/);
  assert.match(html, /n = 5 merges · 30d/);
  assert.equal(html.includes('too few merges'), false);
});

test('merge-time card: under 3 reads too few merges, with the n line, at n = 2 and n = 0', () => {
  for (const mergeTime of [{ n: 2, medianHours: 1, p90Hours: 2 }, { n: 0, medianHours: null, p90Hours: null }]) {
    const html = withMerge(mergeTime);
    assert.match(html, /○ too few merges with forge times/);
    assert.match(html, new RegExp(`n = ${mergeTime.n} merges · 30d`));
    assert.equal(/median \d/.test(html), false);
  }
});

test('merge-time card: the "Harbour saw" note is always there and no NaN or null text appears', () => {
  for (const mergeTime of [{ n: 4, medianHours: 1, p90Hours: 2 }, { n: 0, medianHours: null, p90Hours: null }, undefined]) {
    const html = withMerge(mergeTime);
    assert.ok(has(html, 'workspace-kpis-merge-time-note'));
    assert.match(html, /only merges Harbour saw on a PR check/);
    assert.equal(/NaN|undefined|>null</.test(html), false);
  }
});
