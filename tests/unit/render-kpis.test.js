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
    activity: {
      days: ['2026-06-09', '2026-06-10'],
      proxy: [10, 20],
      steps: [1, 2],
      dispatch: [3, 4]
    },
    dispatchOutcomes: { queued: 1, taken: 2, expired: 3, cancelled: 0 },
    dispatchKinds: [{ label: 'autopilot', count: 4 }, { label: 'research', count: 3 }],
    stepOutcomes: { completed: 5, failed: 1, blocked: 0, other: 2 },
    proxyStatus: { ok: 30, clientError: 2, serverError: 1 },
    topEndpoints: [{ label: '/api/proxy/me', count: 9 }],
    freeTier: { days: ['2026-06-09', '2026-06-10'], counts: [4, 6] },
    vanity: { busiestDay: { day: '2026-06-10', count: 26 }, dbBackend: 'mangodb' },
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
      'chart-activity', 'chart-dispatch-kinds', 'chart-step-outcomes',
      'chart-dispatch-outcomes', 'chart-proxy-status',
      'chart-top-endpoints', 'chart-free-tier'
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing canvas ${id}`);
    }
    assert.ok(html.includes('src="/chart.umd.min.js"'));
    assert.ok(html.includes('src="/kpis.js"'));
    assert.ok(html.includes('href="/kpis.css"'));
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
    assert.ok(html.includes('mangodb'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
  });

  test('omits busiest day when there is no activity', () => {
    const html = renderKpisPage(buildStats({ vanity: { busiestDay: null, dbBackend: null } }));
    assert.ok(!html.includes('busiest day'));
    assert.ok(html.includes('generated:'));
  });
});
