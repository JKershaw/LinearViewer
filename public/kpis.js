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

    const phasesToggle = document.querySelector('.kpi-range-toggle[data-chart="chart-proxy-phases"]');
    if (phasesToggle) {
      phasesToggle.addEventListener('click', function (event) {
        const button = event.target.closest('button[data-range]');
        const view = button && phaseViews[button.dataset.range];
        if (!view || button.classList.contains('is-active')) return;
        phasesToggle.querySelectorAll('.kpi-range-btn').forEach(function (b) {
          b.classList.toggle('is-active', b === button);
        });
        phasesChart.data.labels = view.labels;
        phasesChart.data.datasets.forEach(function (dataset, i) {
          dataset.data = view.source[PHASE_STYLES[i][0]];
        });
        phasesChart.update();
      });
    }
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

  // --- Dispatched work by kind, weekly stacked bars ---
  const weekly = data.dispatchByWeek;
  const kindPalette = [COLORS.blue, COLORS.green, COLORS.yellow, COLORS.red, COLORS.dim];
  let paletteIndex = 0;
  const weeklyTotal = sum(weekly.kinds.map(function (k) { return sum(k.counts); }));
  if (!emptyUnless('chart-dispatch-weekly', weeklyTotal)) {
    new Chart(document.getElementById('chart-dispatch-weekly'), {
      type: 'bar',
      data: {
        labels: weekly.weeks.map(function (w) { return 'wk ' + shortDay(w); }),
        datasets: weekly.kinds.map(function (k) {
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
  const statusEntries = [
    ['2xx ok', proxyStatus.ok, COLORS.green],
    ['4xx client error', proxyStatus.clientError, COLORS.yellow],
    ['5xx server error', proxyStatus.serverError, COLORS.red]
  ];
  if (!emptyUnless('chart-proxy-status', sum(statusEntries.map(function (e) { return e[1]; })))) {
    new Chart(document.getElementById('chart-proxy-status'), {
      type: 'doughnut',
      data: {
        labels: statusEntries.map(function (e) { return e[0]; }),
        datasets: [{
          data: statusEntries.map(function (e) { return e[1]; }),
          backgroundColor: statusEntries.map(function (e) { return e[2]; }),
          borderWidth: 0
        }]
      },
      options: { cutout: '60%' }
    });
  }

  // --- Top proxy endpoints horizontal bar ---
  const endpoints = data.topEndpoints || [];
  if (!emptyUnless('chart-top-endpoints', endpoints.length)) {
    new Chart(document.getElementById('chart-top-endpoints'), {
      type: 'bar',
      data: {
        // Endpoint labels are parameterized route templates; trim the common
        // prefix so labels fit ('/api/proxy/issues/:id' → 'issues/:id').
        labels: endpoints.map(function (e) { return e.label.replace(/^\/api\/proxy\//, ''); }),
        datasets: [{ data: endpoints.map(function (e) { return e.count; }), backgroundColor: COLORS.blue }]
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
