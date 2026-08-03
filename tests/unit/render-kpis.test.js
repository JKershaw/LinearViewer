/**
 * Unit tests for lib/render-kpis.js
 *
 * Run with: node --test tests/unit/render-kpis.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderKpisPage } from '../../lib/render-kpis.js';

function buildStats(overrides = {}) {
  return {
    generatedAt: '2026-06-10T12:00:00.000Z',
    totals: {
      workspaces: 4,
      users: 12,
      activeSessions: 3,
      agentActions: 1234,
      dispatches: 56,
      autopilotRuns: 8,
      feedbackNotes: 7,
      aiSummaries: 89,
      roadmapReports: 10,
      customPrompts: 2,
      localIssues: 5,
      localProjects: 1,
      activeTokens: 6
    },
    proxyCategories: {
      days: ['2026-06-09', '2026-06-10'],
      orienting: [10, 20],
      deciding: [2, 3],
      acting: [1, 1],
      watching: [4, 5],
      reporting: [2, 2]
    },
    proxyCategoriesHourly: {
      hours: ['2026-06-10T11', '2026-06-10T12'],
      orienting: [3, 7],
      deciding: [1, 1],
      acting: [0, 1],
      watching: [2, 2],
      reporting: [1, 0]
    },
    dispatchByDay: {
      days: ['2026-06-09', '2026-06-10'],
      kinds: [
        { label: 'autopilot', counts: [1, 2] },
        { label: 'research', counts: [0, 1] }
      ]
    },
    dispatchOutcomes: {
      windowDays: 30,
      total: 63,
      resolved: 47,
      done: 41,
      failed: 4,
      aborted: 2,
      rate: 0.872,
      weeks: ['2026-05-13', '2026-05-20', '2026-05-27', '2026-06-03'],
      weeklyRate: [0.5, null, 1, 0.875],
      weeklyResolved: [2, 0, 3, 8]
    },
    funnel: { dispatched: 20, taken: 15, reported: 12, completed: 9 },
    dispatchKinds: [{ label: 'autopilot', count: 4 }, { label: 'research', count: 3 }],
    stepOutcomes: { completed: 5, failed: 1, blocked: 0, other: 2 },
    proxyStatus: { ok: 30, clientError: 2, serverError: 1 },
    proxyStatusHourly: { ok: 5, clientError: 0, serverError: 1 },
    topEndpoints: [{ label: '/api/proxy/me', count: 9 }],
    topEndpointsHourly: [{ label: '/api/proxy/me', count: 2 }],
    hourOfDay: Array.from({ length: 24 }, (_, h) => h),
    freeTier: { days: ['2026-06-09', '2026-06-10'], counts: [4, 6] },
    vanity: {
      busiestDay: { day: '2026-06-10', count: 26 },
      readsPerWrite: 12.4,
      medianQueueToTakeMinutes: 11,
      dbBackend: 'mangodb'
    },
    ...overrides
  };
}

describe('renderKpisPage', () => {
  test('renders stat cards with formatted values', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('instance kpis'));
    assert.ok(html.includes('1,234'), 'agent actions formatted with separator');
    assert.ok(html.includes('workspaces'));
    assert.ok(html.includes('autopilot runs · 30d'));
    assert.ok(html.includes('prompts dispatched · 30d'));
    assert.ok(html.includes('data-section="kpi-cards"'));
  });

  test('stat cards ride on the shared .card primitive alongside kpi-* hooks', () => {
    const html = renderKpisPage(buildStats());

    // Shared primitive class + KPI hook + value/label spans preserved.
    assert.ok(html.includes('class="card kpi-card"'), 'stat blocks use the .card primitive');
    assert.ok(html.includes('<span class="kpi-card-value">'), 'value span hook preserved');
    assert.ok(html.includes('<span class="kpi-card-label">'), 'label span hook preserved');
  });

  test('chart boxes ride on the shared boxed .section primitive alongside kpi-* hooks', () => {
    const html = renderKpisPage(buildStats());

    // Shared primitive classes + KPI hook + tree glyph + unclassed h3 preserved.
    assert.ok(
      html.includes('class="section section--boxed kpi-chart-box"'),
      'chart boxes use the boxed .section primitive'
    );
    assert.ok(
      html.includes('class="section section--boxed kpi-chart-box kpi-chart-wide"'),
      'the wide hero chart keeps its kpi-chart-wide hook alongside the primitive'
    );
    assert.ok(html.includes('<span class="kpi-tree-glyph">├─</span>'), 'tree glyph preserved');
    // titleClass:'' leaves the h3 unclassed so `.kpi-chart-box h3` still styles it.
    assert.ok(html.includes('<h3><span><span class="kpi-tree-glyph">'), 'chart h3 stays unclassed');
  });

  test('renders all chart canvases and loads Chart.js + page script', () => {
    const html = renderKpisPage(buildStats());

    for (const id of [
      'chart-proxy-phases', 'chart-outcome-trend', 'chart-dispatch-weekly',
      'chart-dispatch-kinds', 'chart-funnel', 'chart-step-outcomes',
      'chart-proxy-status', 'chart-top-endpoints', 'chart-hour-of-day',
      'chart-free-tier'
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing canvas ${id}`);
    }
    assert.ok(html.includes('src="/chart.umd.min.js"'));
    assert.ok(html.includes('src="/kpis.js"'));
    assert.ok(html.includes('href="/kpis.css"'));
  });

  test('renders a 30d/24h range toggle on the proxy-phases chart, defaulting to 30d', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('class="kpi-range-toggle" data-chart="chart-proxy-phases"'));
    assert.ok(html.includes('class="kpi-range-btn is-active" data-range="30d"'));
    assert.ok(html.includes('class="kpi-range-btn" data-range="24h"'));
  });

  test('renders a 30d/24h range toggle on proxy responses and top proxy endpoints too (LIN-1846)', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('class="kpi-range-toggle" data-chart="chart-proxy-status"'));
    assert.ok(html.includes('class="kpi-range-toggle" data-chart="chart-top-endpoints"'));
    // Hero chart + proxy responses + top endpoints: exactly these three, and
    // no other chart (the volume-led scope decision — LIN-1846).
    assert.strictEqual(html.match(/kpi-range-toggle/g).length, 3);
  });

  test('titles the newly-windowed charts honestly (LIN-1846)', () => {
    const html = renderKpisPage(buildStats());

    // The 35-day weekly span exceeded 30-day retention; it is now a genuine
    // 30-day daily-bucketed window, so the title drops "weekly".
    assert.ok(html.includes('dispatched work by kind · 30d'));
    assert.ok(!html.includes('dispatched work by kind · weekly'));
    // proxy responses previously carried no window label at all
    assert.ok(html.includes('proxy responses · 30d'));
  });

  test('renders the headline outcome number with its slices and coverage label', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('class="card kpi-headline"'), 'headline rides the shared .card primitive');
    assert.ok(html.includes('>87%</a>'), '0.872 renders as a rounded percentage, not a raw ratio');
    assert.ok(html.includes('of dispatched work landed · 30d'));
    assert.ok(html.includes('done 41 · failed 4 · aborted 2'), 'the three slices stay legible');
    assert.ok(
      html.includes('47 of 63 dispatches resolved · 30d'),
      'the coverage sub-label is mandatory: the rate must not read as covering all dispatched work'
    );
  });

  test('the headline links to the chart box that substantiates it', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('<a class="kpi-headline-value" href="#kpi-outcome-evidence">'), 'headline value is the link');
    // The anchor must sit on the SECTION WRAPPER: emptyUnless() replaces the
    // canvas with a note, which would destroy a canvas-borne id.
    assert.ok(
      html.includes('class="section section--boxed kpi-chart-box" id="kpi-outcome-evidence"'),
      'anchor id belongs on the chart box wrapper'
    );
    assert.ok(
      !html.includes('<canvas id="kpi-outcome-evidence"'),
      'anchor id must NOT be on the canvas'
    );
    // Exactly one anchor target, and only the outcome box carries one.
    assert.strictEqual(html.match(/id="kpi-outcome-evidence"/g).length, 1);
  });

  test('renders an em dash with no anchor when the rate is unavailable', () => {
    const html = renderKpisPage(buildStats({
      dispatchOutcomes: {
        windowDays: 30, total: 4, resolved: 0, done: 0, failed: 0, aborted: 0,
        rate: null, weeks: ['2026-05-13', '2026-05-20', '2026-05-27', '2026-06-03'],
        weeklyRate: [null, null, null, null], weeklyResolved: [0, 0, 0, 0]
      }
    }));

    assert.ok(html.includes('<span class="kpi-headline-value">—</span>'), 'empty state renders a dash');
    // A link to an empty chart is a dead end.
    assert.ok(!html.includes('href="#kpi-outcome-evidence"'), 'no anchor when there is no rate');
    assert.ok(html.includes('of dispatched work landed · 30d'), 'the label stays intact');
    assert.ok(html.includes('0 of 4 dispatches resolved · 30d'), 'coverage still tells the truth');
  });

  test('the headline sits above the volume cards and is not one of them', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(
      html.indexOf('kpi-headline') < html.indexOf('data-section="kpi-cards"'),
      'headline renders above the stat card grid'
    );
    // It is a ratio, not a count — it must not join the .kpi-cards grid (the
    // e2e count of 11 volume cards depends on this).
    const cardsBlock = html.slice(html.indexOf('data-section="kpi-cards"'));
    assert.ok(!cardsBlock.slice(0, cardsBlock.indexOf('</div>')).includes('kpi-headline'));
  });

  test('embeds the stats payload for the client script', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('window.__KPI_DATA__ = {'));
    assert.ok(html.includes('"agentActions":1234'));
  });

  test('escapes < in the embedded payload so it cannot close the script tag', () => {
    const stats = buildStats({
      dispatchKinds: [{ label: '</script><script>alert(1)', count: 1 }]
    });
    const html = renderKpisPage(stats);
    assert.ok(!html.includes('</script><script>alert(1)'));
    assert.ok(html.includes('\\u003c/script>'));
  });

  test('renders vanity strip and noindex meta', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('busiest day'));
    assert.ok(html.includes('reads per write: <strong>12.4:1</strong>'));
    assert.ok(html.includes('median queue→take latency: <strong>11m</strong>'));
    assert.ok(html.includes('mangodb'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
  });

  test('formats long median queue→take latency in hours', () => {
    const html = renderKpisPage(buildStats({
      vanity: { busiestDay: null, readsPerWrite: null, medianQueueToTakeMinutes: 150, dbBackend: null }
    }));
    assert.ok(html.includes('median queue→take latency: <strong>2.5h</strong>'));
  });

  test('omits empty vanity stats when there is no activity', () => {
    const html = renderKpisPage(buildStats({
      vanity: { busiestDay: null, readsPerWrite: null, medianQueueToTakeMinutes: null, dbBackend: null }
    }));
    assert.ok(!html.includes('busiest day'));
    assert.ok(!html.includes('reads per write'));
    assert.ok(!html.includes('median queue→take latency'));
    assert.ok(html.includes('generated:'));
  });
});
