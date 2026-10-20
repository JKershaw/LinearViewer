/**
 * Unit tests for public/chart-helpers.js (LIN-3710), the shared chart script.
 *
 * It is a classic browser script, so the REAL source runs in a node:vm sandbox
 * against a hand-rolled DOM and Chart fake (the chat-append-options pattern).
 * The pure parts are private to the script; they are reached through the three
 * exported functions: the trailing mean via the `tools` that `draw` passes its
 * `build` callback, sparkline points via the SVG a fake element records, table
 * rows via a fake mount.
 *
 * Run with: node --test tests/unit/chart-helpers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, '../../public/chart-helpers.js'), 'utf8');

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.dataset = {};
    this.children = [];
    this.className = '';
    this.textContent = '';
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...kids) { this.children = kids; }
  replaceWith(other) { this.replacedBy = other; }
  addEventListener(type, fn) { (this.listeners ||= []).push({ type, fn }); }
  removeEventListener(type, fn) { this.listeners = (this.listeners || []).filter(l => l.type !== type || l.fn !== fn); }
  click() { for (const l of [...(this.listeners || [])]) if (l.type === 'click') l.fn(); }
}

function load({ canvases = {}, withChart = true } = {}) {
  const charts = [];
  const document = {
    documentElement: {},
    createElement: tag => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: id => canvases[id] || null
  };
  const defaults = { font: {}, plugins: { legend: { labels: {} } } };
  function Chart(canvas, config) { charts.push({ canvas, config }); }
  Chart.defaults = defaults;
  const sandbox = {
    document,
    getComputedStyle: () => ({ getPropertyValue: name => (name === '--blue' ? ' #0000ff ' : '') }),
    ...(withChart ? { Chart } : {})
  };
  sandbox.window = sandbox;
  vm.runInNewContext(SOURCE, sandbox);
  return { api: sandbox.HarbourCharts, charts, defaults, document };
}

const cells = row => row.children.map(td => td.textContent);

describe('chart-helpers.js: the surface', () => {
  test('exposes exactly draw, sparkline, numbersTable and rateTotalToggle', () => {
    const { api } = load();
    assert.deepStrictEqual(Object.keys(api).sort(), ['draw', 'numbersTable', 'rateTotalToggle', 'sparkline']);
    for (const fn of Object.values(api)) assert.strictEqual(typeof fn, 'function');
  });

  test('is a classic script with no module syntax', () => {
    assert.ok(!/^\s*(import|export)\s/m.test(SOURCE));
  });

  test('names no page, payload global or route', () => {
    assert.ok(!/kpi/i.test(SOURCE), 'no "kpi" anywhere, comments included');
    assert.ok(!SOURCE.includes('__KPI_DATA__'));
    assert.ok(!SOURCE.includes('/kpis'));
  });

  test('applies the Chart.js defaults and tolerates a page without Chart', () => {
    const { defaults } = load();
    assert.strictEqual(defaults.font.size, 11);
    assert.strictEqual(defaults.maintainAspectRatio, false);
    assert.strictEqual(defaults.plugins.legend.labels.boxWidth, 12);
    assert.doesNotThrow(() => load({ withChart: false }));
  });
});

describe('chart-helpers.js: draw', () => {
  test('builds a chart on the named canvas and passes build the canvas and tools', () => {
    const canvas = new FakeElement('canvas');
    const { api, charts } = load({ canvases: { 'chart-x': canvas } });
    let seen;
    api.draw('x', 3, 'nothing', (c, tools) => { seen = { c, tools }; return { type: 'bar' }; });
    assert.strictEqual(charts.length, 1);
    assert.strictEqual(charts[0].canvas, canvas);
    assert.strictEqual(seen.c, canvas);
    assert.strictEqual(seen.tools.ink.blue, '#0000ff', 'tokens come from the document');
  });

  test('swaps the canvas for the note, in the class the canvas names, when there is nothing to draw', () => {
    const canvas = new FakeElement('canvas');
    canvas.dataset.emptyClass = 'empty-note';
    const { api, charts } = load({ canvases: { 'chart-x': canvas } });
    api.draw('x', 0, '○ nothing yet', () => assert.fail('build must not run'));
    assert.strictEqual(charts.length, 0);
    assert.strictEqual(canvas.replacedBy.textContent, '○ nothing yet');
    assert.strictEqual(canvas.replacedBy.className, 'empty-note');
  });

  test('does nothing when the canvas is absent', () => {
    const { api, charts } = load();
    api.draw('missing', 5, 'n', () => ({}));
    assert.strictEqual(charts.length, 0);
  });

  test('the 7-day mean reaches build as tools.trailingMean: first six null, then the run mean', () => {
    const canvas = new FakeElement('canvas');
    const { api } = load({ canvases: { 'chart-x': canvas } });
    let mean;
    api.draw('x', 1, '', (_c, tools) => { mean = tools.trailingMean; return {}; });
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    assert.deepStrictEqual(mean(values), [null, null, null, null, null, null, 4, 5, 6]);
    assert.deepStrictEqual(mean(new Array(30).fill(2)).filter(v => v !== null).length, 24);
    assert.deepStrictEqual(mean([1, 2, 3, 4, 5, 6, null, 8]), [null, null, null, null, null, null, null, null], 'a gap in the run gives no mean');
    assert.deepStrictEqual(mean([0, 0, 0, 0, 0, 0, 1]), [null, null, null, null, null, null, 0.1], 'rounds to one decimal');
    assert.deepStrictEqual(mean([]), []);
  });
});

describe('chart-helpers.js: sparkline', () => {
  function spark(values, options = { label: 'calls per day' }) {
    const { api } = load();
    const el = new FakeElement('span');
    api.sparkline(el, values, options);
    assert.strictEqual(el.children.length, 1);
    return el.children[0];
  }
  const pointsOf = line => line.attrs.points.split(' ').map(p => p.split(',').map(Number));

  test('is an img svg with an aria-label and the count of numbers drawn', () => {
    const svg = spark([1, 2, 3]);
    assert.strictEqual(svg.tag, 'svg');
    assert.strictEqual(svg.attrs.role, 'img');
    assert.strictEqual(svg.attrs['aria-label'], 'calls per day');
    assert.strictEqual(svg.attrs['data-points'], '3');
  });

  test('draws one point per value, rising values rising on screen', () => {
    const svg = spark([0, 5, 10]);
    const [line] = svg.children;
    assert.strictEqual(line.tag, 'polyline');
    const points = pointsOf(line);
    assert.strictEqual(points.length, 3);
    assert.ok(points[0][1] > points[1][1] && points[1][1] > points[2][1], 'y falls as the value rises');
    assert.ok(points[0][0] < points[1][0] && points[1][0] < points[2][0]);
  });

  test('a non-number breaks the line into two', () => {
    const svg = spark([1, 2, null, 4, 5]);
    assert.strictEqual(svg.children.length, 2);
    assert.deepStrictEqual(svg.children.map(c => pointsOf(c).length), [2, 2]);
    assert.strictEqual(svg.attrs['data-points'], '4');
  });

  test('a flat series is a level line mid-height', () => {
    const [line] = spark([3, 3, 3, 3]).children;
    const ys = new Set(pointsOf(line).map(p => p[1]));
    assert.strictEqual(ys.size, 1);
    assert.strictEqual([...ys][0], 14);
  });

  test('a single point is a dot, and a lone number between gaps too', () => {
    const one = spark([7]);
    assert.strictEqual(one.children.length, 1);
    assert.strictEqual(one.children[0].tag, 'circle');
    const between = spark([null, 4, null]);
    assert.deepStrictEqual(between.children.map(c => c.tag), ['circle']);
  });

  test('all non-numbers draws no mark but is still labelled', () => {
    const svg = spark([null, undefined, NaN]);
    assert.strictEqual(svg.children.length, 0);
    assert.strictEqual(svg.attrs['data-points'], '0');
    assert.strictEqual(svg.attrs['aria-label'], 'calls per day');
  });

  test('colours come from the tokens', () => {
    assert.strictEqual(spark([1, 2]).children[0].attrs.stroke, '#0000ff');
  });

  test('a label is optional', () => {
    assert.strictEqual(spark([1, 2], {}).attrs['aria-label'], '');
  });
});

describe('chart-helpers.js: numbersTable', () => {
  const HIDDEN = { 'below-floor': 'fewer than 5', withheld: 'not shown' };
  function table(options) {
    const { api } = load();
    const mount = new FakeElement('div');
    api.numbersTable(mount, options);
    assert.strictEqual(mount.children.length, 1);
    return mount.children[0];
  }

  test('builds a header row and one row per data row, as text', () => {
    const t = table({ columns: ['day', 'done'], rows: [['06-09', 4], ['06-10 · today, so far', 12345]], hiddenText: HIDDEN });
    assert.strictEqual(t.tag, 'table');
    const [thead, tbody] = t.children;
    assert.deepStrictEqual(thead.children[0].children.map(th => th.textContent), ['day', 'done']);
    const body = tbody.children;
    assert.strictEqual(body.length, 2);
    assert.deepStrictEqual(cells(body[0]), ['06-09', '4']);
    assert.deepStrictEqual(cells(body[1]), ['06-10 · today, so far', '12,345']);
  });

  test('hidden leaves read from hiddenText, never from the helper', () => {
    const t = table({ columns: ['a', 'b'], rows: [[{ hidden: 'below-floor' }, { hidden: 'withheld' }]], hiddenText: HIDDEN });
    assert.deepStrictEqual(cells(t.children[1].children[0]), ['fewer than 5', 'not shown']);
    const none = table({ columns: ['a'], rows: [[{ hidden: 'withheld' }]] });
    assert.deepStrictEqual(cells(none.children[1].children[0]), ['']);
  });

  test('a missing value is a dash and zero is a zero', () => {
    const t = table({ columns: ['a', 'b', 'c'], rows: [[null, 0, undefined]], hiddenText: HIDDEN });
    assert.deepStrictEqual(cells(t.children[1].children[0]), ['–', '0', '–']);
  });

  test('cells are text, not markup', () => {
    const t = table({ columns: ['x'], rows: [['<b>hi</b>']], hiddenText: HIDDEN });
    assert.strictEqual(t.children[1].children[0].children[0].textContent, '<b>hi</b>');
  });

  test('replaces what the mount held and handles no rows', () => {
    const { api } = load();
    const mount = new FakeElement('div');
    mount.children = [new FakeElement('stale')];
    api.numbersTable(mount, { columns: ['a'], rows: [], hiddenText: HIDDEN });
    assert.strictEqual(mount.children.length, 1);
    assert.strictEqual(mount.children[0].children[0].children.length, 1, 'a header row');
    assert.strictEqual(mount.children[0].children[1].children.length, 0, 'and no body rows');
  });
});

describe('chart-helpers.js: draw returns the chart', () => {
  test('the Chart when drawn, null for an empty or missing canvas', () => {
    const canvas = new FakeElement('canvas');
    const empty = new FakeElement('canvas');
    const { api, charts } = load({ canvases: { 'chart-x': canvas, 'chart-e': empty } });
    assert.ok(api.draw('x', 3, 'n', () => ({ type: 'bar' })));
    assert.strictEqual(charts.length, 1);
    assert.strictEqual(api.draw('e', 0, 'n', () => ({})), null);
    assert.strictEqual(api.draw('missing', 3, 'n', () => ({})), null);
  });
});

describe('chart-helpers.js: rateTotalToggle (LIN-3732)', () => {
  const buttonsOf = mount => mount.children[0].children;
  function setup(makeOptions = () => ({})) {
    const mount = new FakeElement('div');
    const log = [];
    const { api } = load();
    const handle = api.rateTotalToggle(mount, {
      labels: { rate: 'Rate', total: 'Total' },
      rate: view => { log.push('rate'); view.drawn = 'rate'; return () => log.push('end-rate'); },
      total: view => { log.push('total'); view.drawn = 'total'; return () => log.push('end-total'); },
      ...makeOptions(log)
    });
    return { mount, log, handle };
  }

  test('draws rate first, with two labelled buttons carrying data-mode and aria-pressed', () => {
    const { mount, log } = setup();
    assert.deepStrictEqual(log, ['rate']);
    const [rate, total] = buttonsOf(mount);
    assert.deepStrictEqual([rate.textContent, total.textContent], ['Rate', 'Total']);
    assert.deepStrictEqual([rate.attrs['data-mode'], total.attrs['data-mode']], ['rate', 'total']);
    assert.deepStrictEqual([rate.attrs['aria-pressed'], total.attrs['aria-pressed']], ['true', 'false']);
  });

  test('total draws only when chosen; a switch runs the old cleanup once and empties the view', () => {
    const { mount, log } = setup();
    const view = mount.children[1];
    view.children = [{ stale: true }];
    buttonsOf(mount)[1].click();
    assert.deepStrictEqual(log, ['rate', 'end-rate', 'total']);
    assert.deepStrictEqual(view.children, [], 'emptied before the page function ran');
    assert.strictEqual(buttonsOf(mount)[1].attrs['aria-pressed'], 'true');
    buttonsOf(mount)[0].click();
    assert.deepStrictEqual(log, ['rate', 'end-rate', 'total', 'end-total', 'rate']);
  });

  test('rate, total, rate works when rate drew only a note (no cleanup returned)', () => {
    const { mount, log } = setup(log => ({ rate: () => { log.push('rate'); } }));
    buttonsOf(mount)[1].click();
    buttonsOf(mount)[0].click();
    assert.deepStrictEqual(log, ['rate', 'total', 'end-total', 'rate']);
  });

  test('destroy() runs the last cleanup and leaves no listeners, buttons or view', () => {
    const { mount, log, handle } = setup();
    const buttons = [...buttonsOf(mount)];
    handle.destroy();
    assert.deepStrictEqual(log, ['rate', 'end-rate']);
    assert.deepStrictEqual(mount.children, []);
    for (const button of buttons) assert.deepStrictEqual(button.listeners, []);
  });

  test('set(mode) switches without a click; an unknown mode is ignored', () => {
    const { log, handle } = setup();
    handle.set('total');
    handle.set('nonsense');
    assert.deepStrictEqual(log, ['rate', 'end-rate', 'total']);
  });

  test('without a total function nothing is rendered and the handle is inert', () => {
    const mount = new FakeElement('div');
    const { api } = load();
    const handle = api.rateTotalToggle(mount, { rate: () => assert.fail('must not run'), labels: {} });
    assert.deepStrictEqual(mount.children, []);
    assert.doesNotThrow(() => { handle.set('total'); handle.destroy(); });
  });
});
