/**
 * Workspace KPIs page script (LIN-3711). The shared public/chart-helpers.js
 * loads before this file.
 *
 * Draws the trend charts and card sparklines from the per-day series embedded
 * as window.__WORKSPACE_KPI_DATA__ (lib/workspace-kpi-stats.js `daily`). Rates
 * only. It builds no tables: the "Show the numbers" tables are in the server
 * HTML so the page works without JavaScript. A chart with nothing to draw
 * swaps its canvas for a short note.
 */
(function () {
  'use strict';

  const daily = window.__WORKSPACE_KPI_DATA__;
  const charts = window.HarbourCharts;
  if (!daily || !charts || typeof Chart === 'undefined') return;

  const total = function (numbers) {
    return numbers.reduce(function (acc, n) { return acc + n; }, 0);
  };
  const monthDay = function (dayKey) {
    return dayKey.slice(5);
  };

  // Sparklines on the activity cards: 30 daily points each.
  const sparks = { dispatches: daily.dispatches, 'autopilot-runs': daily.autopilotRuns, 'agent-actions': daily.agentActions };
  Object.keys(sparks).forEach(function (name) {
    const el = document.querySelector('[data-testid="workspace-kpis-spark-' + name + '"]');
    if (el) charts.sparkline(el, sparks[name], { label: el.dataset.label });
  });

  const dayLabels = daily.days.map(monthDay);

  // Tasks done per day, counted on the day the agent marked the task done.
  charts.draw('done-per-day', total(daily.done), '○ nothing done yet', function (canvas, tools) {
    return {
      type: 'bar',
      data: { labels: dayLabels, datasets: [{ data: daily.done, backgroundColor: tools.ink.green }] },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: tools.ink.grid }, ticks: { precision: 0 } }
        }
      }
    };
  });

  // Runs by kind per 7-day week, stacked: the top kinds, then 'other'.
  const kinds = daily.runsByKind.kinds;
  charts.draw('runs-by-kind', total(kinds.map(function (k) { return total(k.counts); })), '○ nothing dispatched yet', function (canvas, tools) {
    const ink = tools.ink;
    const colors = [ink.blue, ink.purple, ink.green, ink.yellow];
    return {
      type: 'bar',
      data: {
        labels: daily.runsByKind.weeks.map(function (week) { return 'wk ' + monthDay(week); }),
        datasets: kinds.map(function (kind, i) {
          return { label: kind.label, data: kind.counts, backgroundColor: kind.label === 'other' ? ink.dim : colors[i % colors.length] };
        })
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: ink.grid }, ticks: { precision: 0 } }
        }
      }
    };
  });

  // API-equivalent cost per day, by the day the task started.
  charts.draw('cost', total(daily.cost.perDay), '○ no priced tasks yet', function (canvas, tools) {
    return {
      type: 'bar',
      data: { labels: dayLabels, datasets: [{ data: daily.cost.perDay, backgroundColor: tools.ink.blue }] },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (item) { return '$' + item.parsed.y.toFixed(2); } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: tools.ink.grid }, ticks: { callback: function (v) { return '$' + v; } } }
        }
      }
    };
  });
})();
