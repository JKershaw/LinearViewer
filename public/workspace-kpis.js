/**
 * Workspace KPIs page script (LIN-3711). The shared public/chart-helpers.js
 * loads before this file.
 *
 * Draws the trend charts and card sparklines from the per-day series embedded
 * as window.__WORKSPACE_KPI_DATA__ (lib/workspace-kpi-stats.js `daily`). Rates,
 * and a running total behind a toggle on the tasks-done chart (LIN-3732). It builds no tables: the "Show the numbers" tables are in the server
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

  // Rate view: tasks done per day, counted on the day the agent marked done.
  // Total view: the running total, a cumulative line of `doneTotal.done` from
  // `since` (LIN-3732). Each view is drawn fresh into the emptied view element.
  const doneTotal = daily.doneTotal;
  const byTestId = function (id) {
    return document.querySelector('[data-testid="' + id + '"]');
  };
  const showWhile = function (el) {
    if (el) el.hidden = false;
    return function () { if (el) el.hidden = true; };
  };
  const drawInto = function (viewEl, amount, note, build) {
    const wrap = document.createElement('div');
    wrap.className = 'kpi-chart-canvas';
    const canvas = document.createElement('canvas');
    canvas.id = 'chart-done-per-day';
    canvas.dataset.testid = 'workspace-kpis-chart-done-per-day';
    canvas.dataset.emptyClass = 'kpi-chart-empty';
    wrap.appendChild(canvas);
    viewEl.appendChild(wrap);
    const chart = charts.draw('done-per-day', amount, note, build);
    return function () { if (chart) chart.destroy(); };
  };
  const dayAfter = function (dayKey, n) {
    const at = new Date(dayKey + 'T00:00:00Z');
    at.setUTCDate(at.getUTCDate() + n);
    return at.toISOString().slice(0, 10);
  };
  const toggleMount = byTestId('workspace-kpis-toggle-done-per-day');
  const toggle = charts.rateTotalToggle(toggleMount, {
    labels: { rate: 'Per day', total: 'Running total' },
    rate: function (viewEl) {
      return drawInto(viewEl, total(daily.done), '○ nothing done yet', function (canvas, tools) {
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
    },
    total: function (viewEl) {
      if (!doneTotal) return showWhile(byTestId('workspace-kpis-total-empty'));
      const showCaption = showWhile(byTestId('workspace-kpis-total-caption'));
      let sum = 0;
      const running = doneTotal.done.map(function (n) { sum += n; return sum; });
      const days = doneTotal.done.map(function (n, i) { return dayAfter(doneTotal.since, i); });
      const destroyChart = drawInto(viewEl, running.length, '○ no running total yet', function (canvas, tools) {
        return {
          type: 'line',
          data: { labels: days, datasets: [{ data: running, borderColor: tools.ink.green, backgroundColor: tools.ink.green, borderWidth: 2, pointRadius: 0, tension: 0 }] },
          options: {
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
              y: { beginAtZero: true, grid: { color: tools.ink.grid }, ticks: { precision: 0 } }
            }
          }
        };
      });
      return function () { destroyChart(); showCaption(); };
    }
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
          tooltip: { callbacks: { label: function (item) { return item.parsed.y > 0 && item.parsed.y < 0.005 ? '<$0.01' : '$' + item.parsed.y.toFixed(2); } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: tools.ink.grid }, ticks: { callback: function (v) { return '$' + Number(v).toFixed(2); } } }
        }
      }
    };
  });
})();
