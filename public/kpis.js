/**
 * Public /kpis page script (rebuilt in LIN-3703; chart code moved to the shared
 * public/chart-helpers.js in LIN-3710, which loads before this file).
 *
 * Wires the public view embedded as window.__KPI_DATA__ to the page: trend
 * charts for work landed and resolved weekly, tasks finished daily and proxy
 * calls, the dispatch kinds and milestone funnel charts, a sparkline on three
 * stat cards, and the table inside each "Show the numbers" disclosure. A chart
 * with nothing to draw swaps its canvas for a short note. The tasks-finished
 * chart also switches between the daily rate and a running total (LIN-3732).
 *
 * The small-count floor lives on the server. A hidden count arrives here as an
 * object ({ hidden }) rather than a number, and its text row is already in the
 * page, so this script draws only what is a number: it tells them apart by
 * type, never by reading any text. The words for a hidden leaf in a table come
 * from the page (data-hidden-text on <main>), not from this file.
 */
(function () {
  'use strict';

  const view = window.__KPI_DATA__;
  const charts = window.HarbourCharts;
  if (!view || !charts || typeof Chart === 'undefined') return;

  const total = function (numbers) {
    return numbers.reduce(function (acc, n) { return acc + n; }, 0);
  };
  const isNumber = function (value) {
    return typeof value === 'number';
  };
  const monthDay = function (dayKey) {
    return dayKey.slice(5);
  };
  const percent = function (rate) {
    return rate === null ? null : Math.round(rate * 1000) / 10;
  };

  let hiddenText = {};
  try {
    hiddenText = JSON.parse(document.querySelector('main').dataset.hiddenText || '{}');
  } catch (err) {
    hiddenText = {};
  }

  // The "Show the numbers" table of a chart box. The last row of a daily table
  // is today, which is only part of a day.
  const numbers = function (name, columns, rows, daily) {
    const mount = document.querySelector('[data-testid="kpis-numbers-table-' + name + '"]');
    if (!mount) return;
    if (daily && rows.length) {
      const last = rows[rows.length - 1];
      last[0] = last[0] + ' · today, so far';
    }
    charts.numbersTable(mount, { columns: columns, rows: rows, hiddenText: hiddenText });
  };

  const phases = view.phases;
  const PHASE_NAMES = ['orienting', 'deciding', 'acting', 'watching', 'reporting'];
  const callsPerDay = phases.days.map(function (_, i) {
    return total(PHASE_NAMES.map(function (phase) { return phases[phase][i]; }));
  });

  // Sparklines on the stat cards: 30 daily points each.
  const sparks = { 'agent-actions': callsPerDay, dispatches: view.daily.dispatches, 'autopilot-runs': view.daily.autopilotRuns };
  Object.keys(sparks).forEach(function (name) {
    const el = document.querySelector('[data-testid="kpis-spark-' + name + '"]');
    if (el) charts.sparkline(el, sparks[name], { label: el.dataset.label });
  });

  const horizontal = function (labels, values, colors, ink) {
    return {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: ink.grid }, ticks: { precision: 0 } },
          y: { grid: { display: false } }
        }
      }
    };
  };

  // Work landed, weekly: the evidence behind the headline. weeklyRate is a 0-1
  // ratio (null for a week with nothing resolved, drawn as a gap); the sample
  // size rides in the tooltip so a 100% week off two samples does not read as a
  // triumph.
  const outcomes = view.outcomes;
  const weekLabels = outcomes.weeks.map(function (week) { return 'wk ' + monthDay(week); });
  charts.draw('outcome-trend', total(outcomes.weeklyResolved), '○ nothing resolved yet', function (canvas, tools) {
    return {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: [{
          data: outcomes.weeklyRate.map(percent),
          borderColor: tools.ink.green,
          backgroundColor: tools.ink.green,
          spanGaps: false,
          pointRadius: 3,
          tension: 0
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) { return item.parsed.y + '% landed'; },
              footer: function (items) { return 'n = ' + outcomes.weeklyResolved[items[0].dataIndex] + ' resolved'; }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: tools.ink.grid },
            ticks: { precision: 0, callback: function (v) { return v + '%'; } }
          }
        }
      }
    };
  });
  numbers('outcome-trend', ['week (by start)', 'landed', 'resolved'], outcomes.weeks.map(function (week, i) {
    const rate = percent(outcomes.weeklyRate[i]);
    return [week, rate === null ? null : rate + '%', outcomes.weeklyResolved[i]];
  }));

  // Resolved work per week by outcome, stacked. Done is what is left of the
  // resolved count once failed and aborted are taken out.
  const failed = outcomes.weeklyFailed;
  const aborted = outcomes.weeklyAborted;
  const done = outcomes.weeklyResolved.map(function (resolved, i) { return resolved - failed[i] - aborted[i]; });
  charts.draw('outcome-weekly', total(outcomes.weeklyResolved), '○ nothing resolved yet', function (canvas, tools) {
    return {
      type: 'bar',
      data: {
        labels: weekLabels,
        datasets: [
          { label: 'done', data: done, backgroundColor: tools.ink.green },
          { label: 'failed', data: failed, backgroundColor: tools.ink.yellow },
          { label: 'aborted', data: aborted, backgroundColor: tools.ink.dim }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: tools.ink.grid }, ticks: { precision: 0 } }
        }
      }
    };
  });
  numbers('outcome-weekly', ['week (by start)', 'done', 'failed', 'aborted', 'resolved'], outcomes.weeks.map(function (week, i) {
    return [week, done[i], failed[i], aborted[i], outcomes.weeklyResolved[i]];
  }));

  const dayLabels = phases.days.map(monthDay);
  // Rate view: tasks done per day, counted on the day the agent marked done.
  // Total view: the running total, a cumulative line of `doneTotal.done` from
  // `since` (LIN-3732). Each view is drawn fresh into the emptied view element.
  const doneTotal = view.doneTotal;
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
    canvas.id = 'chart-done-daily';
    canvas.dataset.emptyClass = 'kpi-chart-empty';
    wrap.appendChild(canvas);
    viewEl.appendChild(wrap);
    const chart = charts.draw('done-daily', amount, note, build);
    return function () { if (chart) chart.destroy(); };
  };
  const dayAfter = function (dayKey, n) {
    const at = new Date(dayKey + 'T00:00:00Z');
    at.setUTCDate(at.getUTCDate() + n);
    return at.toISOString().slice(0, 10);
  };
  const toggleMount = byTestId('kpis-toggle-done-daily');
  const toggle = charts.rateTotalToggle(toggleMount, {
    labels: { rate: 'Per day', total: 'Running total' },
    rate: function (viewEl) {
      return drawInto(viewEl, total(view.daily.done), '○ nothing finished yet', function (canvas, tools) {
        return {
          type: 'bar',
          data: { labels: dayLabels, datasets: [{ data: view.daily.done, backgroundColor: tools.ink.green }] },
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
      if (!doneTotal) return showWhile(byTestId('kpis-total-empty'));
      const showCaption = showWhile(byTestId('kpis-total-caption'));
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
  numbers('done-daily', ['day', 'finished'], phases.days.map(function (day, i) { return [day, view.daily.done[i]]; }), true);

  // Proxy calls by phase of the loop, stacked per day, with a 7-day average of
  // the daily total. Today is partial, so the average leaves it out.
  const averaged = function (tools) {
    const mean = tools.trailingMean(callsPerDay, 7);
    mean[mean.length - 1] = null;
    return mean;
  };
  charts.draw('proxy-phases', total(callsPerDay), '○ no agent calls yet', function (canvas, tools) {
    const ink = tools.ink;
    const colors = { orienting: ink.blue, deciding: ink.purple, acting: ink.green, watching: ink.dim, reporting: ink.yellow };
    const bars = PHASE_NAMES.map(function (phase) {
      return { type: 'bar', label: phase, data: phases[phase], backgroundColor: colors[phase], order: 2 };
    });
    const line = {
      type: 'line',
      label: '7-day average',
      data: averaged(tools),
      borderColor: ink.dim,
      backgroundColor: ink.dim,
      borderWidth: 2,
      pointRadius: 0,
      spanGaps: false,
      order: 1
    };
    return {
      type: 'bar',
      data: { labels: dayLabels, datasets: bars.concat([line]) },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { stacked: true, beginAtZero: true, grid: { color: ink.grid }, ticks: { precision: 0 } }
        }
      }
    };
  });
  // The table's average column repeats the line's rule without a Chart in hand.
  const meanOf = function (i) {
    if (i < 6 || i === callsPerDay.length - 1) return null;
    return Math.round((total(callsPerDay.slice(i - 6, i + 1)) / 7) * 10) / 10;
  };
  numbers('proxy-phases', ['day'].concat(PHASE_NAMES, ['total', '7-day avg']), phases.days.map(function (day, i) {
    return [day].concat(PHASE_NAMES.map(function (phase) { return phases[phase][i]; }), [callsPerDay[i], meanOf(i)]);
  }), true);

  // The kind of work dispatched; autopilot kickoffs stand out.
  const kinds = view.dispatchKinds;
  charts.draw('dispatch-kinds', kinds.length, '○ nothing dispatched yet', function (canvas, tools) {
    return horizontal(
      kinds.map(function (k) { return k.label.length > 24 ? k.label.slice(0, 23) + '…' : k.label; }),
      kinds.map(function (k) { return k.count; }),
      kinds.map(function (k) { return k.label === 'autopilot' ? tools.ink.purple : tools.ink.blue; }),
      tools.ink
    );
  });

  // Milestone funnel: one bar per step that has a number. A step with no signal
  // or a hidden count has its text row on the page and no bar here; a reached
  // step with 0 is a bar of zero.
  const STEPS = [['login', 'signed up'], ['connected', 'connected'], ['firstGo', 'first go'], ['prOpened', 'pr opened'], ['mergeClicked', 'merge clicked']];
  const drawn = STEPS.filter(function (s) {
    const step = view.milestoneFunnel.steps[s[0]];
    return step && step.state === 'reached' && isNumber(step.count);
  });
  const counts = drawn.map(function (s) { return view.milestoneFunnel.steps[s[0]].count; });
  charts.draw('milestone-funnel', total(counts), drawn.length === STEPS.length ? '○ nobody has signed up in this window' : '○ no counts to chart', function (canvas, tools) {
    return horizontal(drawn.map(function (s) { return s[1]; }), counts, tools.ink.green, tools.ink);
  });
})();
