/**
 * Public /kpis page script (rebuilt in LIN-3703).
 *
 * Draws four charts from the public view embedded as window.__KPI_DATA__:
 * work landed weekly, agent calls by phase, dispatch kinds, and the milestone
 * funnel. A chart with nothing to draw swaps its canvas for a short note.
 *
 * The small-count floor lives on the server. A hidden count arrives here as an
 * object ({ hidden }) rather than a number, and its text row is already in the
 * page, so this script draws only what is a number: it tells them apart by
 * type, never by reading any text.
 */
(function () {
  'use strict';

  const view = window.__KPI_DATA__;
  if (!view || typeof Chart === 'undefined') return;

  const root = getComputedStyle(document.documentElement);
  const token = function (name, fallback) {
    return root.getPropertyValue(name).trim() || fallback;
  };
  const INK = {
    green: token('--green', '#16a34a'),
    yellow: token('--yellow', '#d4a600'),
    blue: token('--blue', '#2563eb'),
    purple: token('--purple', '#7c3aed'),
    dim: token('--fg-dim', '#666666'),
    grid: token('--fg-vdim', '#eeeeee')
  };

  Chart.defaults.font.family = token('--font-structural', "'SF Mono', 'Fira Code', 'Consolas', monospace");
  Chart.defaults.font.size = 11;
  Chart.defaults.color = INK.dim;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;

  const total = function (numbers) {
    return numbers.reduce(function (acc, n) { return acc + n; }, 0);
  };
  const isNumber = function (value) {
    return typeof value === 'number';
  };
  const monthDay = function (dayKey) {
    return dayKey.slice(5);
  };

  // Draws `build(canvas)` unless there is nothing to show, in which case the
  // canvas is replaced by `note`. Server-rendered rows beside the canvas stay.
  function draw(name, amount, note, build) {
    const canvas = document.getElementById('chart-' + name);
    if (!canvas) return;
    if (!(amount > 0)) {
      const empty = document.createElement('div');
      empty.className = 'kpi-chart-empty';
      empty.textContent = note;
      canvas.replaceWith(empty);
      return;
    }
    new Chart(canvas, build());
  }

  const horizontal = function (labels, values, colors) {
    return {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: INK.grid }, ticks: { precision: 0 } },
          y: { grid: { display: false } }
        }
      }
    };
  };

  // Work landed, weekly: the evidence behind the headline. weeklyRate is a 0-1
  // ratio (null for a week with nothing resolved); the sample size rides in the
  // tooltip so a 100% week off two samples does not read as a triumph.
  const outcomes = view.outcomes;
  draw('outcome-trend', total(outcomes.weeklyResolved), '○ nothing resolved yet', function () {
    return {
      type: 'bar',
      data: {
        labels: outcomes.weeks.map(function (week) { return 'wk ' + monthDay(week); }),
        datasets: [{
          data: outcomes.weeklyRate.map(function (rate) { return rate === null ? null : Math.round(rate * 1000) / 10; }),
          backgroundColor: INK.green
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
            grid: { color: INK.grid },
            ticks: { precision: 0, callback: function (v) { return v + '%'; } }
          }
        }
      }
    };
  });

  // Agent calls by phase of the loop, stacked per day: composition over volume.
  const PHASES = [
    ['orienting', INK.blue],
    ['deciding', INK.purple],
    ['acting', INK.green],
    ['watching', INK.dim],
    ['reporting', INK.yellow]
  ];
  const phases = view.phases;
  draw('proxy-phases', total(PHASES.map(function (p) { return total(phases[p[0]]); })), '○ no agent calls yet', function () {
    return {
      type: 'bar',
      data: {
        labels: phases.days.map(monthDay),
        datasets: PHASES.map(function (p) { return { label: p[0], data: phases[p[0]], backgroundColor: p[1] }; })
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { stacked: true, beginAtZero: true, grid: { color: INK.grid }, ticks: { precision: 0 } }
        }
      }
    };
  });

  // The kind of work dispatched; autopilot kickoffs stand out.
  const kinds = view.dispatchKinds;
  draw('dispatch-kinds', kinds.length, '○ nothing dispatched yet', function () {
    return horizontal(
      kinds.map(function (k) { return k.label.length > 24 ? k.label.slice(0, 23) + '…' : k.label; }),
      kinds.map(function (k) { return k.count; }),
      kinds.map(function (k) { return k.label === 'autopilot' ? INK.purple : INK.blue; })
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
  draw('milestone-funnel', total(counts), drawn.length === STEPS.length ? '○ nobody has signed up in this window' : '○ no counts to chart', function () {
    return horizontal(drawn.map(function (s) { return s[1]; }), counts, INK.green);
  });
})();
