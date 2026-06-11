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
    dispatchByWeek: {
      weeks: ['2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27', '2026-06-03'],
      kinds: [
        { label: 'autopilot', counts: [0, 1, 1, 2, 3] },
        { label: 'research', counts: [1, 0, 2, 1, 1] }
      ]
    },
    funnel: { dispatched: 20, taken: 15, reported: 12, completed: 9 },
    dispatchKinds: [{ label: 'autopilot', count: 4 }, { label: 'research', count: 3 }],
    stepOutcomes: { completed: 5, failed: 1, blocked: 0, other: 2 },
    proxyStatus: { ok: 30, clientError: 2, serverError: 1 },
    topEndpoints: [{ label: '/api/proxy/me', count: 9 }],
    hourOfDay: Array.from({ length: 24 }, (_, h) => h),
    freeTier: { days: ['2026-06-09', '2026-06-10'], counts: [4, 6] },
    vanity: {
      busiestDay: { day: '2026-06-10', count: 26 },
      readsPerWrite: 12.4,
      medianMinutesToResolve: 11,
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

  test('renders all chart canvases and loads Chart.js + page script', () => {
    const html = renderKpisPage(buildStats());

    for (const id of [
      'chart-proxy-phases', 'chart-dispatch-weekly', 'chart-dispatch-kinds',
      'chart-funnel', 'chart-step-outcomes', 'chart-proxy-status',
      'chart-top-endpoints', 'chart-hour-of-day', 'chart-free-tier'
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
    // Only the hero chart gets a toggle
    assert.strictEqual(html.match(/kpi-range-toggle/g).length, 1);
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
    assert.ok(html.includes('median dispatch→done: <strong>11m</strong>'));
    assert.ok(html.includes('mangodb'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
  });

  test('formats long median resolution times in hours', () => {
    const html = renderKpisPage(buildStats({
      vanity: { busiestDay: null, readsPerWrite: null, medianMinutesToResolve: 150, dbBackend: null }
    }));
    assert.ok(html.includes('median dispatch→done: <strong>2.5h</strong>'));
  });

  test('omits empty vanity stats when there is no activity', () => {
    const html = renderKpisPage(buildStats({
      vanity: { busiestDay: null, readsPerWrite: null, medianMinutesToResolve: null, dbBackend: null }
    }));
    assert.ok(!html.includes('busiest day'));
    assert.ok(!html.includes('reads per write'));
    assert.ok(!html.includes('median dispatch→done'));
    assert.ok(html.includes('generated:'));
  });
});
