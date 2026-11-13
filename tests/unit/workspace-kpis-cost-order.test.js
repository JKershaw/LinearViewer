/**
 * LIN-4446: the workspace KPI cost chart reads window.CostFormat inside Chart.js's tick callback, and Chart.js calls
 * that callback synchronously in its constructor. The page's shim (public/cost-format-global.js) is a module, so it
 * runs after this classic script has parsed. The chart therefore has to wait for DOMContentLoaded, and this test is
 * the witness: loading must not throw without the global, nothing is drawn at load, and after the global is installed
 * and DOMContentLoaded fires, the tick labels are the formatter's words.
 *
 * Run with: node --test tests/unit/workspace-kpis-cost-order.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorld, fireDOMContentLoaded } from './helpers/client-world.js';
import { loadCostFormat } from '../fixtures/browser-cost-format.js';

const KPI_SRC = readFileSync(new URL('../../public/workspace-kpis.js', import.meta.url), 'utf8');

const TICK_VALUES = [0, 0.004, 0.5, 1.25];

/** The per-day series lib/workspace-kpi-stats.js emits, complete, so the IIFE walks every key it reads. */
function dailyFixture() {
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
    cost: { perDay: [0.004, 0.5, 1.25] },
  };
}

/**
 * A Chart stub whose constructor calls each y-axis tick callback synchronously, as Chart.js does while it lays out a
 * chart. Each built chart records the labels the callback produced.
 */
function chartStub(built) {
  function Chart(canvas, config) {
    const callback = config.options && config.options.scales && config.options.scales.y && config.options.scales.y.ticks.callback;
    const ticks = callback ? TICK_VALUES.map((v) => callback(v)) : null;
    built.push({ type: config.type, ticks, canvas });
    this.destroy = () => {};
  }
  Chart.defaults = { font: {}, color: '', maintainAspectRatio: false, plugins: { legend: { labels: {} } } };
  return Chart;
}

/**
 * The page as the server renders it: the cost canvas is in the markup before the page scripts run, so it is in place
 * when workspace-kpis.js first executes. Only the page script's own execution is the thing under test.
 */
function loadKpis(built) {
  const world = loadWorld({
    window: { __WORKSPACE_KPI_DATA__: dailyFixture(), Chart: chartStub(built) },
    scripts: ['chart-helpers.js'],
    globals: { getComputedStyle: () => ({ getPropertyValue: () => '' }) },
  });
  const canvas = world.document.createElement('canvas');
  canvas.id = 'chart-cost';
  world.document.body.appendChild(canvas);
  world.run(KPI_SRC);
  return world;
}

test('loads without window.CostFormat and draws nothing at load (the build waits for DOMContentLoaded)', () => {
  const built = [];
  assert.doesNotThrow(() => loadKpis(built));
  assert.equal(built.length, 0);
});

test('after the global is installed and DOMContentLoaded fires, the cost ticks are formatted', async () => {
  const built = [];
  const world = loadKpis(built);

  loadCostFormat(world.sandbox);
  await fireDOMContentLoaded(world.document);

  const cost = built.find((c) => c.ticks);
  assert.ok(cost, 'the cost chart was constructed');
  assert.deepEqual(cost.ticks, ['$0.00', '<$0.01', '$0.50', '$1.25']);
});
