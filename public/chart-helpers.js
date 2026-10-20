/**
 * Shared chart helpers (LIN-3710): a classic browser script, loaded before the
 * page script that uses it, exposing one global with three functions.
 *
 *   HarbourCharts.draw(name, amount, note, build)
 *   HarbourCharts.sparkline(el, values, { label })
 *   HarbourCharts.numbersTable(mount, { columns, rows, hiddenText })
 *
 * It holds the colour tokens and Chart.js defaults, and nothing about any one
 * page: ids, classes and wording come in through arguments or data attributes.
 * The pure parts (the trailing mean, the sparkline point maths, the table
 * rows) are private functions below; `draw` hands the mean to its `build`
 * callback as `tools`, so the exported surface stays at three.
 */
(function () {
  'use strict';

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

  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = token('--font-structural', "'SF Mono', 'Fira Code', 'Consolas', monospace");
    Chart.defaults.font.size = 11;
    Chart.defaults.color = INK.dim;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
  }

  const isNumber = function (value) {
    return typeof value === 'number' && isFinite(value);
  };

  // Mean of each `size`-long trailing run, to one decimal. Null until a full
  // run exists, and for any run holding a non-number.
  function trailingMean(values, size) {
    const span = size || 7;
    return values.map(function (_, i) {
      if (i < span - 1) return null;
      const run = values.slice(i - span + 1, i + 1);
      if (!run.every(isNumber)) return null;
      const sum = run.reduce(function (acc, n) { return acc + n; }, 0);
      return Math.round((sum / span) * 10) / 10;
    });
  }

  // Sparkline geometry in a WIDTH x HEIGHT box. Returns the runs of consecutive
  // numbers as arrays of [x, y]; a non-number ends a run, so it shows as a gap.
  // A flat series sits mid-height; x spreads over the whole series length.
  const SPARK_WIDTH = 120;
  const SPARK_HEIGHT = 28;
  const SPARK_PAD = 2;
  function sparkRuns(values) {
    const numbers = values.filter(isNumber);
    if (!numbers.length) return [];
    const low = Math.min.apply(null, numbers);
    const high = Math.max.apply(null, numbers);
    const step = values.length > 1 ? (SPARK_WIDTH - 2 * SPARK_PAD) / (values.length - 1) : 0;
    const runs = [];
    let run = null;
    values.forEach(function (value, i) {
      if (!isNumber(value)) { run = null; return; }
      const y = high === low
        ? SPARK_HEIGHT / 2
        : SPARK_HEIGHT - SPARK_PAD - ((value - low) / (high - low)) * (SPARK_HEIGHT - 2 * SPARK_PAD);
      const point = [Math.round((SPARK_PAD + i * step) * 10) / 10, Math.round(y * 10) / 10];
      if (!run) { run = []; runs.push(run); }
      run.push(point);
    });
    return runs;
  }

  // Table cells as display text: a number is grouped, a hidden leaf reads as
  // `hiddenText[reason]`, a missing value is a dash, a string is itself.
  function cellText(cell, hiddenText) {
    if (isNumber(cell)) return cell.toLocaleString('en-US');
    if (cell !== null && typeof cell === 'object' && 'hidden' in cell) {
      return (hiddenText && hiddenText[cell.hidden]) || '';
    }
    if (cell === null || cell === undefined) return '–';
    return String(cell);
  }
  function tableRows(rows, hiddenText) {
    return rows.map(function (row) {
      return row.map(function (cell) { return cellText(cell, hiddenText); });
    });
  }

  // Draws `build(canvas, tools)` unless there is nothing to show, in which case
  // the canvas is replaced by `note`, in the class the canvas names in
  // data-empty-class. Server-rendered rows beside the canvas stay. Returns the
  // Chart, or null when nothing was drawn (a page that switches views destroys it).
  function draw(name, amount, note, build) {
    const canvas = document.getElementById('chart-' + name);
    if (!canvas) return null;
    if (!(amount > 0)) {
      const empty = document.createElement('div');
      empty.className = (canvas.dataset && canvas.dataset.emptyClass) || '';
      empty.textContent = note;
      canvas.replaceWith(empty);
      return null;
    }
    return new Chart(canvas, build(canvas, { ink: INK, trailingMean: trailingMean }));
  }

  // Two buttons that swap one view for another in `mount`. `rate` and `total`
  // are page functions: each gets the emptied view element, draws into it and
  // may return a cleanup. Rate is the default; total runs only when chosen. The
  // mode is not kept: a switch runs the old cleanup, empties the view and draws
  // the new one, so rate, total, rate works even when rate drew only a note.
  // Without a `total` function nothing is rendered and the handle is inert.
  function rateTotalToggle(mount, options) {
    if (!mount || !options || typeof options.total !== 'function') {
      return { set: function () {}, destroy: function () {} };
    }
    const labels = options.labels || {};
    const bar = document.createElement('div');
    bar.className = 'rate-total-toggle';
    bar.setAttribute('role', 'group');
    const view = document.createElement('div');
    const buttons = {};
    const handlers = {};
    let cleanup = null;

    function endView() {
      const run = cleanup;
      cleanup = null;
      if (run) run();
    }
    function set(mode) {
      if (mode !== 'rate' && mode !== 'total') return;
      endView();
      view.replaceChildren();
      Object.keys(buttons).forEach(function (key) {
        buttons[key].setAttribute('aria-pressed', String(key === mode));
      });
      const result = (mode === 'total' ? options.total : options.rate)(view);
      cleanup = typeof result === 'function' ? result : null;
    }

    ['rate', 'total'].forEach(function (mode) {
      const button = document.createElement('button');
      button.setAttribute('type', 'button');
      button.setAttribute('data-mode', mode);
      button.setAttribute('aria-pressed', 'false');
      button.textContent = labels[mode] || mode;
      handlers[mode] = function () { set(mode); };
      button.addEventListener('click', handlers[mode]);
      buttons[mode] = button;
      bar.appendChild(button);
    });
    mount.replaceChildren(bar, view);
    set(options.initial === 'total' ? 'total' : 'rate');

    return {
      set: set,
      destroy: function () {
        endView();
        Object.keys(buttons).forEach(function (mode) {
          buttons[mode].removeEventListener('click', handlers[mode]);
        });
        view.replaceChildren();
        mount.replaceChildren();
      }
    };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgElement(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) { el.setAttribute(key, String(attrs[key])); });
    return el;
  }

  // An inline SVG line in `el`: one polyline per run of numbers, a dot for a
  // run of one. `data-points` counts the numbers drawn.
  function sparkline(el, values, options) {
    const label = (options && options.label) || '';
    const runs = sparkRuns(values);
    const svg = svgElement('svg', {
      viewBox: '0 0 ' + SPARK_WIDTH + ' ' + SPARK_HEIGHT,
      width: SPARK_WIDTH,
      height: SPARK_HEIGHT,
      role: 'img',
      'aria-label': label,
      'data-points': values.filter(isNumber).length
    });
    runs.forEach(function (run) {
      if (run.length === 1) {
        svg.appendChild(svgElement('circle', { cx: run[0][0], cy: run[0][1], r: 1.5, fill: INK.blue }));
        return;
      }
      svg.appendChild(svgElement('polyline', {
        points: run.map(function (point) { return point.join(','); }).join(' '),
        fill: 'none',
        stroke: INK.blue,
        'stroke-width': 1.5,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round'
      }));
    });
    el.replaceChildren(svg);
  }

  // A plain table in `mount`: `columns` are header labels, `rows` arrays of
  // cells (see cellText).
  function numbersTable(mount, options) {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const head = document.createElement('tr');
    options.columns.forEach(function (column) {
      const th = document.createElement('th');
      th.textContent = column;
      head.appendChild(th);
    });
    thead.appendChild(head);
    table.appendChild(thead);
    table.appendChild(tbody);
    tableRows(options.rows, options.hiddenText).forEach(function (cells) {
      const tr = document.createElement('tr');
      cells.forEach(function (text) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    mount.replaceChildren(table);
  }

  window.HarbourCharts = { draw: draw, sparkline: sparkline, numbersTable: numbersTable, rateTotalToggle: rateTotalToggle };
})();
