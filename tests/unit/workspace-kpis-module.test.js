/**
 * LIN-4471: public/workspace-kpis.js is a native ES module that imports the shared formatter from '../lib/cost-format.js'.
 * This suite is its witness, by plain import() over the fake DOM (tests/unit/helpers/import-world.js): the two charts,
 * the sparklines, and the cost axis's tick and tooltip labels come out as the formatter's words, with no window.CostFormat
 * and no readyState setup. It replaces the vm-and-readyState suite (workspace-kpis-cost-order.test.js), which tested a
 * bridge that this page no longer uses.
 *
 * Run with: node --test tests/unit/workspace-kpis-module.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

const TICK_VALUES = [0, 0.004, 0.5, 1.25];

/** The per-day series lib/workspace-kpi-stats.js emits, complete, so the page walks every key it reads. */
function dailyFixture({ cost = [0.004, 0.5, 1.25] } = {}) {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'];
  const thirty = Array.from({ length: 30 }, () => 1);
  return {
    days,
    dispatches: thirty,
    autopilotRuns: thirty,
    agentActions: thirty,
    done: [1, 0, 2],
    doneTotal: { since: '2026-11-01', done: [1, 0, 2] },
    runsByKind: { weeks: ['2026-11-01'], kinds: [{ label: 'other', counts: [3] }] },
    cost: { perDay: cost, pricedCount: cost.some((n) => n > 0) ? 1 : 0, lineageCount: 1 },
  };
}

/**
 * A Chart stub. Its constructor calls each y-axis tick callback synchronously, as Chart.js does while it lays out a chart,
 * and records what the tooltip callback returns for a point. Each built chart is recorded.
 */
function chartStub(built) {
  function Chart(canvas, config) {
    const scales = (config.options && config.options.scales) || {};
    const tick = scales.y && scales.y.ticks && scales.y.ticks.callback;
    const tooltip = config.options && config.options.plugins && config.options.plugins.tooltip
      && config.options.plugins.tooltip.callbacks.label;
    built.push({
      type: config.type,
      labels: config.data.labels,
      ticks: tick ? TICK_VALUES.map((v) => tick(v)) : null,
      tooltip: tooltip ? tooltip({ parsed: { y: 0.004 } }) : null,
      canvas,
    });
    this.destroy = () => {};
  }
  Chart.defaults = { font: {}, color: '', maintainAspectRatio: false, plugins: { legend: { labels: {} } } };
  return Chart;
}

/**
 * The page as the server renders it: the canvases and sparkline mounts are in the markup before the module runs, and
 * chart-helpers.js has run as a classic script before it.
 */
async function loadKpis(t, { data = dailyFixture(), built = [] } = {}) {
  const world = importWorld({
    window: { __WORKSPACE_KPI_DATA__: data, Chart: chartStub(built) },
    globals: { getComputedStyle: () => ({ getPropertyValue: () => '' }) },
  });
  t.after(() => world.restore());
  const { document } = world;
  for (const id of ['chart-cost', 'chart-runs-by-kind']) {
    const canvas = document.createElement('canvas');
    canvas.id = id;
    document.body.appendChild(canvas);
  }
  for (const name of ['dispatches', 'autopilot-runs', 'agent-actions']) {
    const mount = document.createElement('span');
    mount.setAttribute('data-testid', `workspace-kpis-spark-${name}`);
    mount.setAttribute('data-label', `${name} per day`);
    document.body.appendChild(mount);
  }
  world.runClassic('chart-helpers.js');
  await world.importPage('workspace-kpis.js');
  return world;
}

test('the page module imports the formatter: no window.CostFormat is set or read, and the cost axis uses the shared words', async (t) => {
  const built = [];
  const world = await loadKpis(t, { built });
  assert.equal(world.window.CostFormat, undefined, 'the page takes no bridge global');
  const cost = built.find((c) => c.canvas.id === 'chart-cost');
  assert.ok(cost, 'the cost chart was constructed');
  assert.deepEqual(cost.ticks, ['$0.00', '<$0.01', '$0.50', '$1.25']);
  assert.equal(cost.tooltip, '<$0.01', 'the tooltip uses the same formatter');
});

test('the runs-by-kind chart is drawn with its weekly labels', async (t) => {
  const built = [];
  await loadKpis(t, { built });
  const runs = built.find((c) => c.canvas.id === 'chart-runs-by-kind');
  assert.ok(runs, 'drawn');
  assert.equal(runs.type, 'bar');
  assert.deepEqual(runs.labels, ['wk 11-01']);
});

test('each activity card gets a 30-point sparkline', async (t) => {
  const world = await loadKpis(t);
  for (const name of ['dispatches', 'autopilot-runs', 'agent-actions']) {
    const svg = world.document.querySelector(`[data-testid="workspace-kpis-spark-${name}"] svg`);
    assert.ok(svg, `${name} has an svg`);
    assert.equal(svg.getAttribute('data-points'), '30');
  }
});

test('with no priced usage the cost canvas is replaced by its note, and no cost chart is built', async (t) => {
  const built = [];
  const world = await loadKpis(t, { built, data: dailyFixture({ cost: [0, 0, 0] }) });
  assert.equal(built.some((c) => c.canvas.id === 'chart-cost'), false);
  assert.equal(world.document.getElementById('chart-cost'), null, 'the canvas was swapped out');
  assert.match(world.document.body.textContent, /no priced tasks yet/);
});
