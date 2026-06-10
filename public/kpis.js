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
    green: css.getPropertyValue('--green').trim() || '#16a085',
    yellow: css.getPropertyValue('--yellow').trim() || '#d4a600',
    blue: css.getPropertyValue('--blue').trim() || '#2563eb',
    purple: css.getPropertyValue('--purple').trim() || '#7c3aed',
    red: css.getPropertyValue('--red').trim() || '#cc0000',
    dim: css.getPropertyValue('--fg-dim').trim() || '#666666',
    grid: css.getPropertyValue('--fg-vdim').trim() || '#eeeeee'
  };

  Chart.defaults.font.family = "'SF Mono', 'Fira Code', 'Consolas', monospace";
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

  // --- Activity line chart (hero) ---
  const activity = data.activity;
  const activityTotal = sum(activity.proxy) + sum(activity.foreman) + sum(activity.dispatch);
  if (!emptyUnless('chart-activity', activityTotal)) {
    new Chart(document.getElementById('chart-activity'), {
      type: 'line',
      data: {
        labels: activity.days.map(shortDay),
        datasets: [
          { label: 'proxy api calls', data: activity.proxy, borderColor: COLORS.blue, backgroundColor: COLORS.blue, tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'foreman updates', data: activity.foreman, borderColor: COLORS.green, backgroundColor: COLORS.green, tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'dispatches', data: activity.dispatch, borderColor: COLORS.yellow, backgroundColor: COLORS.yellow, tension: 0.3, pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } }
        }
      }
    });
  }

  // --- Dispatch outcomes doughnut ---
  const outcomes = data.dispatchOutcomes;
  const outcomeEntries = [
    ['queued', outcomes.queued, COLORS.yellow],
    ['taken', outcomes.taken, COLORS.green],
    ['expired', outcomes.expired, COLORS.dim],
    ['cancelled', outcomes.cancelled, COLORS.red]
  ];
  if (!emptyUnless('chart-dispatch-outcomes', sum(outcomeEntries.map(function (e) { return e[1]; })))) {
    new Chart(document.getElementById('chart-dispatch-outcomes'), {
      type: 'doughnut',
      data: {
        labels: outcomeEntries.map(function (e) { return e[0]; }),
        datasets: [{
          data: outcomeEntries.map(function (e) { return e[1]; }),
          backgroundColor: outcomeEntries.map(function (e) { return e[2]; }),
          borderWidth: 0
        }]
      },
      options: { cutout: '60%' }
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

  // --- Foreman actions horizontal bar ---
  const actions = data.foremanActions || [];
  if (!emptyUnless('chart-foreman-actions', actions.length)) {
    new Chart(document.getElementById('chart-foreman-actions'), {
      type: 'bar',
      data: {
        // Labels are agent-supplied strings; Chart.js renders them as canvas
        // text (no HTML injection surface), but truncate for layout.
        labels: actions.map(function (e) { return e.label.length > 24 ? e.label.slice(0, 23) + '…' : e.label; }),
        datasets: [{ data: actions.map(function (e) { return e.count; }), backgroundColor: COLORS.green }]
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
