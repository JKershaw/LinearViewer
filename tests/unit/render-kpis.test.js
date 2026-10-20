/**
 * Unit tests for lib/render-kpis.js: the public /kpis page, rebuilt in LIN-3703
 * (docs/plans/kpis-public-design.md). The page renders the public view
 * (`toPublicKpis`), never raw stats.
 *
 * Run with: node --test tests/unit/render-kpis.test.js
 */
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { renderKpisPage } from '../../lib/render-kpis.js';
import { toPublicKpis, PUBLIC_COUNT_FLOOR } from '../../lib/kpi-stats.js';
import { extractScriptsFromHtml } from '../../lib/scan-public-pages.js';
import { scanText } from '../../lib/secret-scan.js';
import { extractEmbeddedData, embeddedDataText } from '../helpers/embedded-data.js';
import { buildStats, buildFunnel, buildMode, buildCost } from '../helpers/public-kpis-fixture.js';

const F = PUBLIC_COUNT_FLOOR;

function render(statsOverrides = {}, viewOverrides = {}) {
  return renderKpisPage({ ...toPublicKpis(buildStats(statsOverrides)), ...viewOverrides });
}

const testid = (html, id) => [...html.matchAll(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`, 'g'))].map(m => m[0]);
const cardValue = (html, name) => new RegExp(`data-testid="kpis-card-${name}"[^>]*>.*?kpi-card-value[^>]*>([^<]*)<`, 's').exec(html)?.[1];

describe('renderKpisPage: frame', () => {
  const html = render();

  test('is noindex, titled, and loads Chart.js and the page script', () => {
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<title>KPIs - Harbour<\/title>/);
    assert.match(html, /chart\.umd\.min\.js/);
    assert.match(html, /\/kpis\.js/);
  });

  test('loads the shared chart helper before the page script, as plain scripts', () => {
    const order = ['chart.umd.min.js', 'chart-helpers.js', '/kpis.js'].map(name => html.indexOf(`src="/${name.replace(/^\//, '')}"`));
    assert.ok(order.every(i => i > 0), String(order));
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
    assert.ok(!/<script[^>]*type="module"/.test(html));
  });

  test('carries the hidden-leaf wording on <main>, once, from the server constant', () => {
    const attr = /<main[^>]*data-hidden-text="([^"]*)"/.exec(html)?.[1];
    assert.ok(attr);
    const text = JSON.parse(attr.replaceAll('&quot;', '"'));
    assert.deepStrictEqual(text, { 'below-floor': `fewer than ${F}`, withheld: 'not shown' });
    assert.ok(!readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../public/kpis.js'), 'utf8').includes('fewer than'), 'the script has no second copy');
  });

  test('is not linked to anything: no nav link points at /kpis', () => {
    assert.ok(!/href="\/kpis"/.test(html));
  });

  test('states the story and the three sections in order', () => {
    const order = ['kpis-section-outcome', 'kpis-section-activity', 'kpis-section-people'].map(id => html.indexOf(`data-testid="${id}"`));
    assert.ok(order.every(i => i > 0), String(order));
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
    assert.match(html, /Does the work land\?/);
    assert.match(html, /What the agents do/);
    assert.match(html, /How people get started/);
  });

  test('the subtitle discloses the real age of generatedAt', () => {
    const view = toPublicKpis(buildStats());
    const old = renderKpisPage({ ...view, generatedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() });
    assert.match(old, /collected 3h ago/);
    assert.ok(!/just now/.test(old));
    assert.match(old, /data-testid="kpis-generated"[^>]*data-timestamp=/);
  });

  test('embeds the public view only: none of the dropped fields reach the page', () => {
    const data = extractEmbeddedData(html, '__KPI_DATA__');
    assert.deepStrictEqual(Object.keys(data).sort(), ['cost', 'daily', 'dispatchKinds', 'generatedAt', 'milestoneFunnel', 'outcomes', 'phases', 'totals']);
    for (const dropped of ['terminalMarkedTaskCost', 'weeklyBudgetGauge', 'topEndpoints', 'hourOfDay', 'vanity', 'activeTokens', 'dbBackend', 'mangodb', 'cash:']) {
      assert.ok(!html.includes(dropped), dropped);
    }
  });

  test('escapes < in the embedded payload so it cannot close the script tag', () => {
    const hostile = renderKpisPage({ ...toPublicKpis(buildStats()), dispatchKinds: [{ label: '</script><script>alert(1)</script>', count: 1 }] });
    const text = embeddedDataText(hostile, '__KPI_DATA__');
    assert.ok(!text.includes('</script>'));
    assert.strictEqual(extractEmbeddedData(hostile, '__KPI_DATA__').dispatchKinds[0].label, '</script><script>alert(1)</script>');
  });
});

describe('renderKpisPage: does the work land?', () => {
  test('headlines the rate with its slices and a coverage label', () => {
    const html = render();
    assert.match(html, /data-testid="kpis-headline"/);
    assert.match(html, /kpi-headline-value[^>]*>87%</);
    assert.match(html, /of dispatched work landed · 30d/);
    assert.match(html, /done 41 · failed 4 · aborted 2/);
    assert.match(html, /47 of 63 dispatches resolved · 30d/);
  });

  test('the headline links to the chart box that substantiates it', () => {
    const html = render();
    assert.match(html, /<a class="kpi-headline-value" href="#kpi-outcome-evidence">/);
    // The anchor target is the section wrapper, not the canvas the script may replace.
    assert.match(html, /<section[^>]*id="kpi-outcome-evidence"/);
    assert.ok(!/<canvas[^>]*id="kpi-outcome-evidence"/.test(html));
  });

  test('renders an em dash with no anchor when the rate is unavailable', () => {
    const view = toPublicKpis(buildStats());
    const html = renderKpisPage({ ...view, outcomes: { ...view.outcomes, rate: null, resolved: 0, done: 0, failed: 0, aborted: 0 } });
    assert.match(html, /<span class="kpi-headline-value">—<\/span>/);
    assert.ok(!/class="kpi-headline-value" href/.test(html));
    assert.ok(!/>0%</.test(html));
  });
});

describe('renderKpisPage: what the agents do', () => {
  test('renders the event cards with formatted values on the shared .card primitive', () => {
    const html = render();
    assert.strictEqual(cardValue(html, 'agent-actions'), '1,234');
    assert.strictEqual(cardValue(html, 'dispatches'), '56');
    assert.strictEqual(cardValue(html, 'autopilot-runs'), '8');
    assert.match(html, /<div class="card kpi-card"[^>]*data-testid="kpis-card-agent-actions"/);
  });

  test('the workspaces card discloses its basis; a hidden count renders as text with a data hook', () => {
    const shown = render();
    assert.strictEqual(cardValue(shown, 'workspaces'), '40');
    assert.match(shown, /kpi-card-basis[^>]*>workspaces with activity in the 30-day read window/);

    const low = render({ workspaces: F - 1 });
    assert.strictEqual(cardValue(low, 'workspaces'), `fewer than ${F}`);
    assert.match(low, /data-testid="kpis-hidden" data-hidden="below-floor"/);
  });

  test('draws the phases and dispatch-kinds charts', () => {
    const html = render();
    for (const id of ['chart-proxy-phases', 'chart-dispatch-kinds', 'chart-outcome-trend', 'chart-outcome-weekly', 'chart-done-daily']) {
      assert.match(html, new RegExp(`<canvas id="${id}"[^>]*></canvas>`), id);
    }
  });
});

describe('renderKpisPage: how people get started', () => {
  test('every no-signal step is a text row naming the step and its coverage', () => {
    const html = render();
    assert.match(html, /<p class="kpi-chart-empty" data-milestone-step="mergeClicked">merge clicked: no signal, mergeClicked: app-defined coverage label<\/p>/);
  });

  test('a reached step with a zero count is a bar, never a hidden or no-signal row', () => {
    const html = render({ funnel: buildFunnel({ login: 3 * F, connected: 2 * F, firstGo: 0, prOpened: 0, mergeClicked: 0 }) });
    assert.ok(!/data-milestone-step="firstGo"/.test(html));
    assert.ok(!/data-testid="kpis-hidden"/.test(html));
    const steps = extractEmbeddedData(html, '__KPI_DATA__').milestoneFunnel.steps;
    assert.deepStrictEqual([steps.firstGo.state, steps.firstGo.count], ['reached', 0]);
  });

  test('a below-floor step is a server-side text row: "fewer than N" from the constant, with data hooks', () => {
    const html = render({ funnel: buildFunnel({ login: 9137, connected: F - 1, firstGo: 0, prOpened: 0, mergeClicked: 0 }) });
    assert.match(html, new RegExp(`<p class="kpi-chart-empty" data-testid="kpis-hidden" data-hidden="below-floor" data-milestone-step="connected">connected: fewer than ${F}</p>`));
    // And the withheld one says so, without its number.
    assert.match(html, /data-hidden="withheld" data-milestone-step="login">signed up: not shown</);
    assert.ok(!html.includes('9137'), 'the withheld count is nowhere in the page');
  });

  test('the rows sit outside the canvas wrapper the script replaces on an empty chart', () => {
    const html = render({ funnel: buildFunnel({ login: F - 1 }) });
    const wrapperEnd = html.indexOf('</div>', html.indexOf('<canvas id="chart-milestone-funnel">'));
    assert.ok(html.indexOf('data-milestone-step="login"') > wrapperEnd);
  });

  test('the rows still sit outside the canvas wrapper when every step is hidden and the chart is empty', () => {
    const html = render({ funnel: buildFunnel({ login: F - 1, connected: F - 2, firstGo: F - 3, prOpened: 1, mergeClicked: F - 1 }) });
    const wrapperEnd = html.indexOf('</div>', html.indexOf('<canvas id="chart-milestone-funnel">'));
    const rows = [...html.matchAll(/data-milestone-step="(\w+)"/g)];
    assert.deepStrictEqual(rows.map(m => m[1]), ['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked']);
    for (const row of rows) assert.ok(row.index > wrapperEnd, row[1]);
  });

  test('the funnel caption says who is counted (LIN-3501)', () => {
    assert.match(render(), /people who signed up in the last 30 days/);
  });

  test('the entry-mode rows show exact counts, or hidden text with hooks', () => {
    const exact = render({ funnel: buildFunnel({ login: 3 * F }, buildMode(10 * F, [[6 * F, 2 * F], [4 * F, 0], [0, 0]])) });
    assert.match(exact, new RegExp(`data-mode-rung="copy"[^>]*>.*?data-field="entries">${6 * F}<.*?data-field="notReady">${2 * F}<`, 's'));
    assert.match(exact, /data-mode-rung="run-task"[^>]*>.*?data-field="entries">0</s);

    const low = render({ funnel: buildFunnel({ login: 3 * F }, buildMode(10 * F, [[6 * F, F - 1], [4 * F, 0], [0, 0]])) });
    assert.match(low, /data-mode-rung="copy"[^>]*>.*?data-field="entries"[^>]*data-hidden="withheld"[^>]*>not shown</s);
    assert.match(low, new RegExp(`data-field="notReady"[^>]*data-hidden="below-floor"[^>]*>fewer than ${F}<`));
    assert.match(low, /data-field="total" data-testid="kpis-hidden" data-hidden="withheld"/);
  });

  test('no mode block renders no mode rows', () => {
    assert.ok(!/data-mode-rung/.test(render({ funnel: buildFunnel({ login: 3 * F }, null) })));
  });
});

describe('renderKpisPage: the small-count floor in the page source', () => {
  // A fixture sparse enough that every floored count is below the floor.
  const sparse = { workspaces: 2, funnel: buildFunnel({ login: 4, connected: 3, firstGo: 2, prOpened: 1, mergeClicked: 0 }, buildMode(4, [[2, 1], [1, 0], [1, 1]])) };
  const html = render(sparse);
  const data = extractEmbeddedData(html, '__KPI_DATA__');

  test('__KPI_DATA__ holds no floored leaf in 1..floor-1', () => {
    const floored = [
      data.totals.workspaces,
      ...Object.values(data.milestoneFunnel.steps).map(s => s.count),
      data.milestoneFunnel.mode.total,
      ...data.milestoneFunnel.mode.byRung.flatMap(r => [r.entries, r.notReady])
    ];
    for (const leaf of floored) {
      assert.ok(leaf === null || leaf === 0 || typeof leaf === 'object', JSON.stringify(leaf));
    }
    assert.deepStrictEqual(data.totals.workspaces, { hidden: 'below-floor' });
  });

  test('the visible text shows no raw count for them either', () => {
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    assert.match(text, new RegExp(`signed up: fewer than ${F}`));
    assert.match(text, new RegExp(`workspaces`));
    assert.ok(!new RegExp(`(?:signed up|connected|first go|pr opened):\\s*[1-${F - 1}]\\b`).test(text));
  });

  test('states the floor on the page, built from the constant', () => {
    assert.match(html, new RegExp(`data-testid="kpis-privacy"[^>]*>[^<]*fewer than ${F}[^<]*never[^<]*names, workspace keys or content`));
    assert.match(html, /data-testid="kpis-privacy"[^>]*>[^]*?<a href="\/privacy">/);
  });

  test('offline scan witness: the rendered page and its scripts pass the secret scan', () => {
    const scripts = extractScriptsFromHtml(html, 'http://127.0.0.1:3000/kpis');
    assert.ok(scripts.length >= 1);
    const findings = [
      ...scripts.filter(s => s.type === 'inline').flatMap(s => scanText(s.content, { filePath: 'kpis-inline' })),
      ...scanText(html, { filePath: 'kpis.html' })
    ];
    assert.deepStrictEqual(findings, []);
  });
});

// LIN-3710: the trend charts, sparklines and "Show the numbers" disclosures.
describe('renderKpisPage: trend charts and disclosures (LIN-3710)', () => {
  const html = render();
  const BOXES = ['outcome-trend', 'outcome-weekly', 'done-daily', 'proxy-phases'];
  const boxOf = name => {
    const start = html.indexOf(`data-testid="kpis-chart-${name}"`);
    return html.slice(start, html.indexOf('</section>', start));
  };

  test('there are six chart boxes: four changed or new, two untouched', () => {
    assert.strictEqual(testid(html, 'kpis-chart-[a-z-]+').length, 6);
    for (const name of [...BOXES, 'dispatch-kinds', 'milestone-funnel']) assert.ok(boxOf(name), name);
  });

  test('every new or changed box has a closed "Show the numbers" disclosure with notes and a table mount', () => {
    for (const name of BOXES) {
      const box = boxOf(name);
      assert.match(box, new RegExp(`<details class="kpi-numbers" data-testid="kpis-numbers-${name}"><summary>Show the numbers</summary>`), name);
      assert.ok(!/<details[^>]*\bopen\b/.test(box), `${name} is closed by default`);
      assert.match(box, /<p class="kpi-numbers-note">/, name);
      assert.match(box, new RegExp(`data-testid="kpis-numbers-table-${name}"`), name);
    }
    assert.ok(!/kpis-numbers-dispatch-kinds|kpis-numbers-milestone-funnel/.test(html), 'untouched boxes get none');
  });

  test('outside the disclosure a box shows its title and at most one line of text', () => {
    for (const name of BOXES) {
      const visible = boxOf(name).replace(/<details[\s\S]*?<\/details>/, '');
      const texts = [...visible.matchAll(/<span class="(kpi-chart-caption)?"?[^>]*>([^<]+)<\/span>/g)];
      assert.ok(texts.length >= 1 && texts.length <= 2, `${name}: ${texts.length} spans`);
      assert.ok(!/<p[ >]/.test(visible), `${name} has no paragraph outside the disclosure`);
    }
  });

  test('the weekly chart says "by start week", and the daily one says what a finish is', () => {
    assert.match(boxOf('outcome-weekly'), /by start week/);
    assert.match(boxOf('done-daily'), /Show the numbers[\s\S]*marked it \[done\][\s\S]*not on a verified merge/);
    assert.match(boxOf('done-daily'), /no marker time[\s\S]*not counted/);
  });

  test('the headline anchor stays on the section wrapper of the line chart', () => {
    const tag = /<section[^>]*data-testid="kpis-chart-outcome-trend"[^>]*>/.exec(html)?.[0] || '';
    assert.match(tag, /id="kpi-outcome-evidence"/);
  });

  test('proxy-phases is titled "proxy calls"', () => {
    assert.match(boxOf('proxy-phases'), /<span>proxy calls<\/span>/);
  });

  test('sparklines mount on the three named cards and not on workspaces', () => {
    for (const name of ['agent-actions', 'dispatches', 'autopilot-runs']) {
      assert.strictEqual(testid(html, `kpis-spark-${name}`).length, 1, name);
    }
    assert.match(html, /data-testid="kpis-spark-agent-actions" data-label="proxy calls per day"/);
    assert.ok(!/kpis-spark-workspaces/.test(html));
    assert.ok(!/kpis-spark-headline|kpis-headline[^>]*>[\s\S]{0,400}kpi-card-spark/.test(html));
  });

  test('no running total and no rate/total toggle on the page', () => {
    assert.ok(!/running total|cumulative|toggle/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
    assert.ok(!/<button|role="switch"|type="radio"/.test(html.replace(/<footer[\s\S]*<\/footer>/, '')));
  });
});

// LIN-3714: one cost-per-finished-task figure, with its caveats in the fold.
describe('renderKpisPage: cost per finished task (LIN-3714)', () => {
  const renderCost = (overrides = {}) => render({ terminalMarkedTaskCost: buildCost(overrides) });
  const SHARES = {
    attributableLineageShare: ['runs tied to a task', '60%'],
    captureRateShare: ['runs that reported usage', '40%'],
    pricedLineageShare: ['priced, of runs that reported usage', '80%'],
    closeOutLineageShare: ['had a close-out run', '90%'],
    evidenceLinkedShare: ['linked to evidence', '50%'],
    opencodeSummedShare: ['known runner only', '25%'],
    unknownHarnessShare: ['with an unknown runner', '10%']
  };

  test('shows $X.XX with the label, the sub-line and the one caption, under the rate headline', () => {
    const html = renderCost({ pricedTicketCostUsd: 100, pricedTicketCount: 8 });
    assert.match(html, /data-testid="kpis-cost-value">\$12\.50</);
    assert.match(html, />Cost per finished task</);
    assert.match(html, />API-equivalent · last 30 days</);
    assert.match(html, />A task counts as finished when its agent marked it done\.</);
    assert.ok(html.indexOf('data-testid="kpis-headline"') < html.indexOf('data-testid="kpis-cost"'));
    assert.ok(html.indexOf('data-testid="kpis-cost"') < html.indexOf('data-testid="kpis-chart-outcome-trend"'));
  });

  test('a null figure is a dash, never $0; under the floor there is no average, so no fold', () => {
    const noUsd = renderCost({ pricedTicketCostUsd: null });
    const noTasks = renderCost({ pricedTicketCount: 0 });
    const fewTasks = renderCost({ pricedTicketCount: F - 1 });
    for (const html of [noUsd, noTasks, fewTasks]) {
      assert.match(html, /data-testid="kpis-cost-value">—</);
      assert.ok(!html.includes('$0'));
    }
    for (const html of [noTasks, fewTasks]) assert.ok(!html.includes('kpis-cost-numbers'));
  });

  test('a closed <details> "Show the numbers" holds the task count and all seven shares with their labels', () => {
    const html = renderCost();
    const fold = /<details[^>]*data-testid="kpis-cost-numbers"[^>]*>[\s\S]*?<\/details>/.exec(html)?.[0];
    assert.ok(fold);
    assert.ok(!/<details[^>]* open/.test(fold));
    assert.match(fold, /<summary>Show the numbers<\/summary>/);
    assert.match(fold, /Averaged over 8 finished tasks/);
    assert.match(fold, /Coverage, of all runs/);
    assert.match(fold, /Bias, of finished tasks/);
    for (const [key, [label, value]] of Object.entries(SHARES)) {
      assert.match(fold, new RegExp(`data-share="${key}">[^<]*${label}: ${value}<`), key);
    }
  });

  test('none of the values or labels appear with the fold cut out', () => {
    const html = renderCost().replace(/<details[^>]*data-testid="kpis-cost-numbers"[\s\S]*?<\/details>/, '');
    assert.ok(!html.includes('data-share='));
    assert.ok(!/finished tasks\./.test(html.replace('A task counts as finished when its agent marked it done.', '')));
    for (const [, [label]] of Object.entries(SHARES)) assert.ok(!html.includes(label), label);
    for (const text of ['Coverage, of all runs', 'Bias, of finished tasks', 'Averaged over']) assert.ok(!html.includes(text), text);
    // The figure and its caption stay without the fold.
    assert.match(html, /data-testid="kpis-cost-value">\$12\.50</);
  });

  test('a nonzero share that rounds to 0 reads <1%, a null share —, a real 0 reads 0%', () => {
    const fold = /<details[^>]*kpis-cost-numbers[\s\S]*?<\/details>/.exec(renderCost({ captureRateShare: 0.004, evidenceLinkedShare: null, closeOutLineageShare: 0 }))[0];
    assert.match(fold, /data-share="captureRateShare">[^<]*: &lt;1%</);
    assert.match(fold, /data-share="evidenceLinkedShare">[^<]*: —</);
    assert.match(fold, /data-share="closeOutLineageShare">[^<]*: 0%</);
  });

  test('"terminal-marked" and "cash:" appear nowhere, and no spend line is drawn', () => {
    const html = renderCost();
    for (const text of ['terminal-marked', 'cash:', 'unresolved', 'overhead', 'tickets per', 'marker channel', 'unpriced', '4.56', '7.89', '99.99', '3.21']) {
      assert.ok(!html.includes(text), text);
    }
    assert.ok(!extractEmbeddedData(html, '__KPI_DATA__').cost.cashUsd);
  });

  test('the shares appear only inside the fold', () => {
    const html = renderCost();
    const outside = html.replace(/<details[^>]*data-testid="kpis-cost-numbers"[\s\S]*?<\/details>/, '').replace(/<script[\s\S]*?<\/script>/g, '');
    for (const [, [label, value]] of Object.entries(SHARES)) assert.ok(!outside.includes(`${label}: ${value}`), label);
    for (const [, [, value]] of Object.entries(SHARES)) assert.ok(!outside.includes(value), value);
    assert.ok(!outside.includes('data-share='));
  });
});
