/**
 * KPIs page client script.
 *
 * Hydrates the Chart.js canvases from the server-embedded payload in
 * window.__KPI_DATA__. Charts with no data are replaced by a dim
 * "no data yet" message so an empty instance still renders cleanly.
 */
(function () {
  'use strict';

  const data = window.__KPI_DATA__;
  if (!data || typeof Chart === 'undefined') return;

  // Match the app's light theme + terminal aesthetic
  const css = getComputedStyle(document.documentElement);
  const COLORS = {
    green: css.getPropertyValue('--green').trim() || '#16a34a',
    yellow: css.getPropertyValue('--yellow').trim() || '#d4a600',
    blue: css.getPropertyValue('--blue').trim() || '#2563eb',
    purple: css.getPropertyValue('--purple').trim() || '#7c3aed',
    red: css.getPropertyValue('--red').trim() || '#cc0000',
    dim: css.getPropertyValue('--fg-dim').trim() || '#666666',
    grid: css.getPropertyValue('--fg-vdim').trim() || '#eeeeee'
  };
  // Chart labels are machine facts → mono. Read the structural-font token from
  // the same runtime block as the colors so theming stays token-driven; keep
  // the literal mono stack as the empty-token fallback.
  const FONT_MONO = css.getPropertyValue('--font-structural').trim()
    || "'SF Mono', 'Fira Code', 'Consolas', monospace";

  Chart.defaults.font.family = FONT_MONO;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = COLORS.dim;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;

  function sum(values) {
    return values.reduce(function (acc, v) { return acc + v; }, 0);
  }

  // Replace a canvas with a "no data yet" note; returns true if replaced.
  function emptyUnless(canvasId, total) {
    if (total > 0) return false;
    const canvas = document.getElementById(canvasId);
    if (canvas) {
      const note = document.createElement('div');
      note.className = 'kpi-chart-empty';
      note.textContent = '○ no data yet';
      canvas.replaceWith(note);
    }
    return true;
  }

  function shortDay(dayKey) {
    return dayKey.slice(5); // 'YYYY-MM-DD' → 'MM-DD'
  }

  // Wire a chart's 30d/24h range toggle. `views` is a map of range name →
  // arbitrary view data; `applyView(chart, view)` mutates the chart's data to
  // match. Shared by every toggled chart so there is exactly one toggle
  // system, not one per chart. Must only be called for a chart whose canvas
  // still exists — emptyUnless() may have already replaced it with a
  // "no data yet" note, which would leave the toggle's query target gone.
  function wireRangeToggle(chartId, chart, views, applyView) {
    const toggle = document.querySelector('.kpi-range-toggle[data-chart="' + chartId + '"]');
    if (!toggle) return;
    toggle.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-range]');
      const view = button && views[button.dataset.range];
      if (!view || button.classList.contains('is-active')) return;
      toggle.querySelectorAll('.kpi-range-btn').forEach(function (b) {
        b.classList.toggle('is-active', b === button);
      });
      applyView(chart, view);
      chart.update();
    });
  }

  // --- Proxy calls by phase (hero): stacked bars per day or per hour ---
  // Composition over volume: what agents do, not how much. Phases are the
  // agent loop — orient, decide, act, watch, report. A 30d/24h toggle
  // switches between the daily and hourly buckets.
  const PHASE_STYLES = [
    ['orienting', COLORS.blue],
    ['deciding', COLORS.purple],
    ['acting', COLORS.green],
    ['watching', COLORS.dim],
    ['reporting', COLORS.yellow]
  ];
  const phaseViews = {
    '30d': {
      source: data.proxyCategories,
      labels: data.proxyCategories.days.map(shortDay)
    }
  };
  if (data.proxyCategoriesHourly) {
    phaseViews['24h'] = {
      source: data.proxyCategoriesHourly,
      labels: data.proxyCategoriesHourly.hours.map(function (h) {
        return h.slice(11) + ':00'; // 'YYYY-MM-DDTHH' → 'HH:00'
      })
    };
  }
  function phaseDatasets(source) {
    return PHASE_STYLES.map(function (s) {
      return { label: s[0], data: source[s[0]], backgroundColor: s[1] };
    });
  }
  const phasesTotal = sum(PHASE_STYLES.map(function (s) { return sum(data.proxyCategories[s[0]]); }));
  if (!emptyUnless('chart-proxy-phases', phasesTotal)) {
    const phasesChart = new Chart(document.getElementById('chart-proxy-phases'), {
      type: 'bar',
      data: {
        labels: phaseViews['30d'].labels,
        datasets: phaseDatasets(phaseViews['30d'].source)
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { stacked: true, beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } }
        }
      }
    });

    wireRangeToggle('chart-proxy-phases', phasesChart, phaseViews, function (chart, view) {
      chart.data.labels = view.labels;
      chart.data.datasets.forEach(function (dataset, i) {
        dataset.data = view.source[PHASE_STYLES[i][0]];
      });
    });
  }

  // --- Work landed, weekly (the headline number's evidence) ---
  // The share of resolved dispatch lineages that ended [done], per week inside
  // the 30-day window. `weeklyRate` is a 0–1 ratio (null for an empty bucket);
  // the sample size rides in the tooltip footer so a 100% week off two samples
  // reads honestly rather than as a triumph.
  const outcomes = data.dispatchOutcomes;
  if (outcomes && !emptyUnless('chart-outcome-trend', sum(outcomes.weeklyResolved || []))) {
    new Chart(document.getElementById('chart-outcome-trend'), {
      type: 'bar',
      data: {
        labels: outcomes.weeks.map(function (w) { return 'wk ' + shortDay(w); }),
        datasets: [{
          label: 'landed',
          data: outcomes.weeklyRate.map(function (r) {
            return r === null ? null : Math.round(r * 1000) / 10;
          }),
          backgroundColor: COLORS.green
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.parsed.y + '% landed'; },
              footer: function (items) {
                return 'n = ' + (outcomes.weeklyResolved[items[0].dataIndex] || 0) + ' resolved';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: COLORS.grid },
            ticks: { precision: 0, callback: function (v) { return v + '%'; } }
          }
        }
      }
    });
  }

  // --- Dispatched work by kind, daily stacked bars ---
  const daily = data.dispatchByDay;
  const kindPalette = [COLORS.blue, COLORS.green, COLORS.yellow, COLORS.red, COLORS.dim];
  let paletteIndex = 0;
  const dailyTotal = sum(daily.kinds.map(function (k) { return sum(k.counts); }));
  if (!emptyUnless('chart-dispatch-weekly', dailyTotal)) {
    new Chart(document.getElementById('chart-dispatch-weekly'), {
      type: 'bar',
      data: {
        labels: daily.days.map(shortDay),
        datasets: daily.kinds.map(function (k) {
          const color = k.label === 'autopilot'
            ? COLORS.purple
            : kindPalette[paletteIndex++ % kindPalette.length];
          return { label: k.label, data: k.counts, backgroundColor: color };
        })
      },
      options: {
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } }
        }
      }
    });
  }

  // --- Work funnel: dispatched → taken → reported → completed ---
  const funnel = data.funnel;
  const funnelEntries = [
    ['dispatched', funnel.dispatched],
    ['taken', funnel.taken],
    ['reported', funnel.reported],
    ['completed', funnel.completed]
  ];
  if (!emptyUnless('chart-funnel', funnel.dispatched)) {
    // Same hue fading toward completion; hex alpha suffixes on the 6-digit
    // theme color (falls back gracefully if the var isn't a hex color).
    const funnelColors = ['FF', 'C0', '90', '60'].map(function (alpha) {
      return COLORS.blue.length === 7 ? COLORS.blue + alpha : COLORS.blue;
    });
    new Chart(document.getElementById('chart-funnel'), {
      type: 'bar',
      data: {
        labels: funnelEntries.map(function (e) { return e[0]; }),
        datasets: [{
          data: funnelEntries.map(function (e) { return e[1]; }),
          backgroundColor: funnelColors
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // --- Proxy response classes doughnut ---
  const proxyStatus = data.proxyStatus;
  const statusLabels = ['2xx ok', '4xx client error', '5xx server error'];
  const statusColors = [COLORS.green, COLORS.yellow, COLORS.red];
  const statusViews = {
    '30d': { data: [proxyStatus.ok, proxyStatus.clientError, proxyStatus.serverError] }
  };
  if (data.proxyStatusHourly) {
    const hourly = data.proxyStatusHourly;
    statusViews['24h'] = { data: [hourly.ok, hourly.clientError, hourly.serverError] };
  }
  if (!emptyUnless('chart-proxy-status', sum(statusViews['30d'].data))) {
    const proxyStatusChart = new Chart(document.getElementById('chart-proxy-status'), {
      type: 'doughnut',
      data: {
        labels: statusLabels,
        datasets: [{
          data: statusViews['30d'].data,
          backgroundColor: statusColors,
          borderWidth: 0
        }]
      },
      options: { cutout: '60%' }
    });
    wireRangeToggle('chart-proxy-status', proxyStatusChart, statusViews, function (chart, view) {
      chart.data.datasets[0].data = view.data;
    });
  }

  // --- Top proxy endpoints horizontal bar ---
  // Endpoint labels are parameterized route templates; trim the common prefix
  // so labels fit ('/api/proxy/issues/:id' → 'issues/:id').
  function endpointView(entries) {
    return {
      labels: entries.map(function (e) { return e.label.replace(/^\/api\/proxy\//, ''); }),
      data: entries.map(function (e) { return e.count; })
    };
  }
  const endpoints = data.topEndpoints || [];
  const endpointViews = { '30d': endpointView(endpoints) };
  if (data.topEndpointsHourly) endpointViews['24h'] = endpointView(data.topEndpointsHourly);
  if (!emptyUnless('chart-top-endpoints', endpoints.length)) {
    const topEndpointsChart = new Chart(document.getElementById('chart-top-endpoints'), {
      type: 'bar',
      data: {
        labels: endpointViews['30d'].labels,
        datasets: [{ data: endpointViews['30d'].data, backgroundColor: COLORS.blue }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } },
          y: { grid: { display: false } }
        }
      }
    });
    wireRangeToggle('chart-top-endpoints', topEndpointsChart, endpointViews, function (chart, view) {
      chart.data.labels = view.labels;
      chart.data.datasets[0].data = view.data;
    });
  }

  // --- Dispatch kinds horizontal bar ---
  // The work mix flowing through dispatch: autopilot kickoffs (highlighted)
  // plus the worker step kinds an orchestrator or user dispatches.
  const kinds = data.dispatchKinds || [];
  if (!emptyUnless('chart-dispatch-kinds', kinds.length)) {
    new Chart(document.getElementById('chart-dispatch-kinds'), {
      type: 'bar',
      data: {
        labels: kinds.map(function (e) { return e.label.length > 24 ? e.label.slice(0, 23) + '…' : e.label; }),
        datasets: [{
          data: kinds.map(function (e) { return e.count; }),
          backgroundColor: kinds.map(function (e) { return e.label === 'autopilot' ? COLORS.purple : COLORS.blue; })
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // --- Step outcomes doughnut ---
  // Per-step results agents report to the agent-status log.
  const stepOutcomes = data.stepOutcomes;
  const stepEntries = [
    ['completed', stepOutcomes.completed, COLORS.green],
    ['failed', stepOutcomes.failed, COLORS.red],
    ['blocked', stepOutcomes.blocked, COLORS.yellow],
    ['other', stepOutcomes.other, COLORS.dim]
  ];
  if (!emptyUnless('chart-step-outcomes', sum(stepEntries.map(function (e) { return e[1]; })))) {
    new Chart(document.getElementById('chart-step-outcomes'), {
      type: 'doughnut',
      data: {
        labels: stepEntries.map(function (e) { return e[0]; }),
        datasets: [{
          data: stepEntries.map(function (e) { return e[1]; }),
          backgroundColor: stepEntries.map(function (e) { return e[2]; }),
          borderWidth: 0
        }]
      },
      options: { cutout: '60%' }
    });
  }

  // --- Work by hour of day (UTC) ---
  const hours = data.hourOfDay || [];
  if (!emptyUnless('chart-hour-of-day', sum(hours))) {
    new Chart(document.getElementById('chart-hour-of-day'), {
      type: 'bar',
      data: {
        labels: hours.map(function (_, h) { return (h < 10 ? '0' : '') + h; }),
        datasets: [{ data: hours, backgroundColor: COLORS.green }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } }
        }
      }
    });
  }

  // --- Weekly budget burn: $ spend per day, current subscription window ---
  const weeklyBudget = (data.weeklyBudgetGauge && data.weeklyBudgetGauge.dayBars) || { days: [], costUsd: [] };
  if (!emptyUnless('chart-weekly-budget', sum(weeklyBudget.costUsd))) {
    new Chart(document.getElementById('chart-weekly-budget'), {
      type: 'bar',
      data: {
        labels: weeklyBudget.days.map(shortDay),
        datasets: [{ label: 'API-rate-equivalent $', data: weeklyBudget.costUsd, backgroundColor: COLORS.yellow }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return '$' + ctx.parsed.y.toFixed(2); } } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { callback: function (v) { return '$' + v; } } }
        }
      }
    });
  }

  // --- Free tier prompts bar (7 days) ---
  const freeTier = data.freeTier;
  if (!emptyUnless('chart-free-tier', sum(freeTier.counts))) {
    new Chart(document.getElementById('chart-free-tier'), {
      type: 'bar',
      data: {
        labels: freeTier.days.map(shortDay),
        datasets: [{ label: 'free tier prompts', data: freeTier.counts, backgroundColor: COLORS.purple }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } }
        }
      }
    });
  }

  // Render the generated-at timestamp in the viewer's local timezone.
  const generated = document.querySelector('.kpi-generated');
  if (generated && generated.dataset.timestamp) {
    const date = new Date(generated.dataset.timestamp);
    if (!Number.isNaN(date.getTime())) {
      generated.textContent = date.toLocaleString();
    }
  }
})();
