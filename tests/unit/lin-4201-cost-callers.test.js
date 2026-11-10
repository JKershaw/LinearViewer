/**
 * LIN-4201: every caller of the cost read loads request records through the one loader and passes them on.
 *
 * Each witness gives a lineage a snapshot figure and a different records figure, and checks the caller's output is
 * the records figure, and that the caller asked the loader for the lineage's anchor. A caller that forgot to load
 * or pass records shows the snapshot figure, or throws (the read requires `requestRows`). The wiring the unit tests
 * cannot reach (server.js, the dashboard route's run page) is held by the census at the end of this file.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, call, ACME } from './lib/proxy-fake-deps.js';
import { loaderOver } from '../fixtures/request-usage-loader.js';
import { readModelsHistory } from '../../lib/model-routing-history.js';
import { agentSpendByJob, typicalByModel } from '../../lib/model-routing-spend.js';
import { computeEffortReadout } from '../../lib/effort-readout.js';
import { computeTerminalMarkedTaskCost } from '../../lib/terminal-marked-task-cost.js';
import { terminalMarkedTaskCostOf } from '../fixtures/cost-read-cores.js';
import { buildRunView } from '../../lib/run-view.js';
import { collectKpiStats } from '../../lib/kpi-stats.js';
import { collectWorkspaceKpis } from '../../lib/workspace-kpi-stats.js';
import { createRunParagraphPrecompute } from '../../lib/run-paragraph-hook.js';

const DAY = 24 * 3600 * 1000;
const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

/** A taken, done row of lineage `root-1` whose snapshot says $4.90. */
const snapshotRow = (overrides = {}) => ({
  _id: 'root-1', id: 'root-1', rootItemId: 'root-1', urlKey: ACME, status: 'taken', kind: 'implementation',
  issueIdentifier: 'LIN-42', issueId: 'issue-42', dispatchedAt: at(2),
  feedback: [
    { kind: 'usage', timestamp: at(2), message: `[usage] ${JSON.stringify({ harness: 'claude-code', model: 'claude-opus-5-5', inputTokens: 10, costUsd: 4.9 })}` },
    { message: '[done] landed', timestamp: at(1.9) },
  ],
  ...overrides,
});
/** The same lineage's request records: $0.30 in all. */
const RECORDS = [
  { rootItemId: 'root-1', itemId: 'root-1', requestId: 'm1', at: at(2), harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', inputTokens: 10, costUsd: 0.1 },
  { rootItemId: 'root-1', itemId: 'root-1', requestId: 'm2', at: at(1.95), harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', inputTokens: 10, costUsd: 0.2 },
];
const askedFor = (loader, anchor) => loader.calls.some(c => c.urlKey === ACME && c.anchors.includes(anchor));

describe('GET /api/proxy/cost/:identifier (S1)', () => {
  const store = (rows) => ({
    listItems: async () => [],
    listHistory: async (urlKey, opts = {}) => ({ items: rows, total: rows.length }),
    lineageIdentityRows: async () => rows.map(r => ({ _id: r._id, rootItemId: r.rootItemId, status: r.status, kind: r.kind, issueIdentifier: r.issueIdentifier, dispatchedAt: r.dispatchedAt })),
  });

  test('the route reads the lineage\'s records through the loader', async () => {
    const loader = loaderOver(RECORDS);
    const app = buildApp({ dispatchQueueStore: store([snapshotRow()]), requestUsageLoader: loader });
    const res = await call(app, 'GET', '/api/proxy/cost/LIN-42');
    assert.equal(res.status, 200);
    close(res.body.totalUsd, 0.3);
    assert.ok(askedFor(loader, 'root-1'), JSON.stringify(loader.calls));
  });

  test('a route wired without the loader fails the request; it never reads snapshots instead', async () => {
    const app = buildApp({ dispatchQueueStore: store([snapshotRow()]), requestUsageLoader: undefined });
    const res = await call(app, 'GET', '/api/proxy/cost/LIN-42');
    assert.equal(res.status, 500);
  });
});

describe('Models spend (S5, S6, S8, S9): readModelsHistory then the spend readers', () => {
  const dispatchStore = (rows) => ({
    listHistoryWithBodies: async () => ({ items: rows, total: rows.length }),
    lineageIdentityRows: async () => [],
  });

  test('readModelsHistory loads the page\'s lineages\' records and the spend readers price from them', async () => {
    // LIN-4226: the page carries the read's workerSessions (the read loads the records once); the spend readers take those.
    const loader = loaderOver(RECORDS);
    const history = await readModelsHistory(dispatchStore([snapshotRow()]), ACME, loader);
    assert.equal(loader.calls.length, 1, 'one records load for the page');
    assert.ok(askedFor(loader, 'root-1'));
    close(history.workerSessions[0].costUsd, 0.3);
    const [spend] = agentSpendByJob(history.workerSessions, { jobs: ['implementation'] });
    close(spend.spendUsd, 0.3);
    const [typical] = typicalByModel(history.workerSessions, { job: 'implementation' });
    close(typical.typicalUsd, 0.3);
  });

  test('readModelsHistory without the loader throws (the routes catch it and say the read failed)', async () => {
    await assert.rejects(readModelsHistory(dispatchStore([snapshotRow()]), ACME), /readModelsHistory: the request-usage loader is required/);
  });

  test('the spend readers take the read\'s workerSessions: an empty read is no runs, not an error', () => {
    // LIN-4226: the readers no longer take rows, so the old "throws without requestRows" pin is replaced by this one.
    assert.equal(agentSpendByJob([], { jobs: ['implementation'] })[0].runs, 0);
    assert.deepEqual(typicalByModel([], { job: 'implementation' }), []);
  });
});

describe('the effort read-out (S10)', () => {
  test('its cost column is the records figure', async () => {
    const readout = await computeEffortReadout({ liveRows: [], historyRows: [snapshotRow()], asOf: new Date().toISOString(), survivalAvailable: false, requestSource: loaderOver(RECORDS), urlKey: ACME });
    const card = readout.perKind.find(k => k.kind === 'implementation');
    close(card.costUsd, 0.3);
  });

  test('it throws without a requestSource', async () => {
    await assert.rejects(computeEffortReadout({ liveRows: [], historyRows: [snapshotRow()], asOf: new Date().toISOString(), survivalAvailable: false, urlKey: ACME }), /requestSource is required/);
  });
});

describe('the /kpis cost per finished ticket (S11)', () => {
  test('computeTerminalMarkedTaskCost prices the lineage from its records', () => {
    // LIN-4226: the helper takes the lineage records (costLineages) its caller loaded; the adapter builds them from the records held here.
    const figures = terminalMarkedTaskCostOf([snapshotRow()], new Date(), { identityRows: [], requestRows: RECORDS });
    close(figures.pricedTicketCostUsd, 0.3);
  });

  test('it throws without costLineages (the helper loads nothing itself)', () => {
    assert.throws(() => computeTerminalMarkedTaskCost([snapshotRow()], new Date(), { identityRows: [] }), /costLineages is required/);
  });

  test('collectKpiStats refuses to start without the request source (before any read)', async () => {
    let reads = 0;
    const collection = new Proxy({}, { get: () => () => { reads += 1; return { toArray: async () => [] }; } });
    await assert.rejects(
      collectKpiStats({ kpiDailyRollup: collection }, { lineageIdentity: async () => [], milestoneFunnelDeps: {} }),
      /collectKpiStats: requestSource is required/
    );
    assert.equal(reads, 0);
  });
});

describe('the workspace KPIs (S12)', () => {
  test('collectWorkspaceKpis refuses to start without the loader', async () => {
    await assert.rejects(
      collectWorkspaceKpis({ collections: { closeOutEvents: {}, kpiDailyRollup: {} }, urlKey: ACME }),
      /collectWorkspaceKpis: the request-usage loader is required/
    );
  });
});

describe('the run paragraph precompute (S13\'s third entry path)', () => {
  const session = { sessionId: 's1', loops: [{ loopId: 'root-1', lineageId: 'root-1' }, { loopId: 'f-1', lineageId: 'root-1' }, { loopId: 'other', lineageId: null }] };

  test('builds the run view from the session lineages\' records', async () => {
    // LIN-4226: the hook hands the view the source and the urlKey; the view loads the lineages' records through it.
    const loader = loaderOver(RECORDS);
    let handed;
    const precompute = createRunParagraphPrecompute({
      runParagraphStore: { get: async () => null, put: async () => {} },
      requestUsageLoader: loader,
      // The REAL view: it does the load, so `loader.calls` below checks the hook's contract, not a fake's own load.
      buildView: async (s, opts) => {
        handed = { source: opts.requestSource, urlKey: opts.urlKey };
        return buildRunView(s, opts);
      },
      generateParagraph: async () => ({ paragraph: 'p', model: 'm' }),
      logger: { error: () => {} },
    });
    await precompute(ACME, session, { apiKey: 'k' });
    assert.equal(handed.source, loader);
    assert.equal(handed.urlKey, ACME);
    assert.deepEqual(loader.calls, [{ urlKey: ACME, anchors: ['root-1', 'other'] }]);
  });

  test('without the loader it logs and writes nothing (no paragraph from a snapshot-only view)', async () => {
    const errors = [];
    let puts = 0;
    const precompute = createRunParagraphPrecompute({
      runParagraphStore: { get: async () => null, put: async () => { puts += 1; } },
      generateParagraph: async () => ({ paragraph: 'p', model: 'm' }),
      logger: { error: (...args) => errors.push(args.join(' ')) },
    });
    await precompute(ACME, session, { apiKey: 'k' });
    assert.equal(puts, 0);
    assert.match(errors.join('\n'), /run-paragraph precompute: the request-usage loader is required/);
  });
});

// ─── Census: the wiring no unit above reaches ────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every call of a reader that now requires records, and the argument name each call must carry. */
export const REQUIRED_ARG = {
  // LIN-4226: the read entries take the source they load from (`requestSource`); the terminal-cost helpers take the
  // lineage records their caller loaded (`costLineages`). Injected loaders keep their dependency name.
  readCost: 'requestSource', lineageRecords: 'requestSource', buildRunView: 'requestSource', buildView: 'requestSource',
  computeEffortReadout: 'requestSource', collectKpiStats: 'requestSource',
  computeTerminalMarkedTaskCost: 'costLineages', terminalMarkedTaskCostDetail: 'costLineages',
  collectWorkspaceKpis: 'requestUsageLoader', readModelsHistory: 'requestUsageLoader',
  // LIN-4404: the task's own read (lib/task-cost-read.js), lifted out of the /cost route; its callers hand it the loader.
  readTaskCost: 'requestUsageLoader',
};
// `lineageFigureOf` is the synchronous per-lineage figure over records its caller passes (LIN-4226, plan-review note 1):
// it loads nothing, so it is not a required-source entry and is not in this table.
/**
 * Route factories whose routes reach the read, the dep each must be given where it is mounted, and the module the
 * factory comes from (a same-named factory from another module, e.g. routes/proxy-dispatch.js's
 * `createDispatchRoutes`, does not reach the read and is not held).
 */
export const REQUIRED_DEP = {
  createProxyRoutes: { dep: 'requestUsageLoader', module: 'routes/proxy.js' },
  createComputeRoutes: { dep: 'requestUsageLoader', module: 'routes/proxy-compute.js' },
  createDispatchRoutes: { dep: 'requestUsageLoader', module: 'routes/dispatch.js' },
  createDashboardRoutes: { dep: 'requestUsageLoader', module: 'routes/dashboard.js' },
  createSettingsRouter: { dep: 'requestUsageLoader', module: 'routes/settings.js' },
  createWorkspaceKpisRoutes: { dep: 'requestUsageLoader', module: 'routes/workspace-kpis.js' },
  createRunParagraphPrecompute: { dep: 'requestUsageLoader', module: 'lib/run-paragraph-hook.js' },
};

/** Whether `file` imports `name` from `module` (repo-relative), by its relative import specifier. */
function importsFrom(file, text, name, module) {
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = match[1].split(',').map(part => part.trim().split(/\s+as\s+/).pop().trim());
    if (!names.includes(name)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2]));
    return resolved === module;
  }
  return false;
}
/**
 * The only files that call the store's `listForAnchors`: the one loader, and the two LIN-4200 measurement scripts. The
 * store's own definition (`async listForAnchors(`) is not a call and needs no entry.
 */
export const LIST_FOR_ANCHORS_ALLOW = ['lib/request-usage-loader.js', 'scripts/lin-4200-measure-records-vs-snapshots.mjs', 'scripts/lin-4200-d13-volume-timing.mjs'];

const isCommentLine = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

/** The text of the call's parentheses, starting at the `(` at `open`. */
function callText(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** Every problem in the given `{path, text}` files. Pure. */
export function wiringProblems(files) {
  const problems = [];
  for (const { path: file, text } of files) {
    const lines = text.split('\n');
    let offset = 0;
    for (const [index, line] of lines.entries()) {
      if (!isCommentLine(line)) {
        const deps = Object.fromEntries(Object.entries(REQUIRED_DEP)
          .filter(([name, { module }]) => importsFrom(file, text, name, module))
          .map(([name, { dep }]) => [name, dep]));
        // lib/cost-read.js is the read's own module: its entries delegate their parameters (`lineageRecords(params)`),
        // so the argument rule applies to callers, and the read's own pass-through is held by its witnesses instead.
        const argumentTable = file === 'lib/cost-read.js' ? {} : REQUIRED_ARG;
        for (const [table, kind] of [[argumentTable, 'argument'], [deps, 'dependency']]) {
          for (const [name, required] of Object.entries(table)) {
            for (const match of line.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g'))) {
              if (/(function|async function)\s*$/.test(line.slice(0, match.index))) continue; // the definition
              const args = callText(text, offset + match.index + match[0].length - 1);
              if (!args.includes(required)) problems.push(`${file}:${index + 1} calls ${name} without the required ${kind} ${required} (LIN-4201)`);
            }
          }
        }
        if (/\.listForAnchors\s*\(/.test(line) && !LIST_FOR_ANCHORS_ALLOW.includes(file)) {
          problems.push(`${file}:${index + 1} calls listForAnchors: request records are read through lib/request-usage-loader.js`);
        }
      }
      offset += line.length + 1;
    }
  }
  return problems;
}

function repoFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); } else if (/\.(m?js)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of ['lib', 'routes', 'scripts']) walk(path.join(REPO, dir));
  out.push(path.join(REPO, 'server.js'));
  return out.map(full => ({ path: path.relative(REPO, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') }));
}

describe('census: every production call passes the records (LIN-4201)', () => {
  test('no production call of a records-requiring reader or route factory leaves them out', () => {
    const files = repoFiles();
    assert.ok(files.length > 300, `the census must scan the source tree (scanned ${files.length})`);
    assert.deepEqual(wiringProblems(files), []);
  });

  test('the census finds each production call site it is meant to hold', () => {
    const hits = new Set();
    for (const { path: file, text } of repoFiles()) {
      for (const name of [...Object.keys(REQUIRED_ARG), ...Object.keys(REQUIRED_DEP)]) {
        if (new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(text.split('\n').filter(l => !isCommentLine(l)).join('\n'))) hits.add(`${file}#${name}`);
      }
    }
    for (const site of [
      'lib/task-cost-read.js#readCost', 'routes/proxy-compute.js#readTaskCost', 'lib/model-routing-history.js#readCost', 'lib/effort-readout.js#readCost',
      'lib/kpi-stats.js#lineageRecords', 'lib/workspace-kpi-stats.js#lineageRecords',
      'routes/dashboard.js#buildRunView', 'lib/run-paragraph-hook.js#buildView',
      'routes/settings.js#readModelsHistory', 'routes/dispatch.js#readModelsHistory', 'routes/dashboard-effort.js#computeEffortReadout',
      'lib/kpi-stats.js#computeTerminalMarkedTaskCost', 'routes/workspace-kpis.js#collectWorkspaceKpis', 'server.js#collectKpiStats',
      'server.js#createProxyRoutes', 'server.js#createDispatchRoutes', 'server.js#createDashboardRoutes', 'server.js#createSettingsRouter',
      'server.js#createWorkspaceKpisRoutes', 'server.js#createRunParagraphPrecompute', 'routes/proxy.js#createComputeRoutes',
    ]) {
      const [file, name] = site.split('#');
      assert.ok(hits.has(site), `expected a call of ${name} in ${file}`);
    }
  });


  // Synthetic witnesses: the check names each violation, so a green run means something.
  test('a call without the records is named', () => {
    const problems = wiringProblems([{ path: 'lib/new-surface.js', text: 'const x = readCost({ fetchedRows: rows, identityRows });\n' }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /lib\/new-surface\.js:1 calls readCost without the required argument requestSource/);
  });

  test('a multi-line call is read to its closing parenthesis', () => {
    const ok = 'const x = readCost({\n  fetchedRows,\n  requestSource,\n});\n';
    const bad = 'const x = readCost({\n  fetchedRows,\n});\nconst requestSource = [];\n';
    assert.deepEqual(wiringProblems([{ path: 'lib/a.js', text: ok }]), []);
    assert.equal(wiringProblems([{ path: 'lib/b.js', text: bad }]).length, 1);
  });

  test('a route factory mounted without the loader is named; a same-named factory from another module is not', () => {
    const imports = "import { createDashboardRoutes } from './routes/dashboard.js'\n";
    const problems = wiringProblems([{ path: 'server.js', text: `${imports}app.use(createDashboardRoutes({ workspaceFromUrl, dispatchQueueStore }))\n` }]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /createDashboardRoutes without the required dependency requestUsageLoader/);
    const other = "import { createDispatchRoutes } from './proxy-dispatch.js';\nrouter.use(createDispatchRoutes({ logEvent }));\n";
    assert.deepEqual(wiringProblems([{ path: 'routes/proxy.js', text: other }]), []);
  });

  test('a direct listForAnchors outside the loader is named; a definition and a comment are not', () => {
    assert.equal(wiringProblems([{ path: 'routes/x.js', text: 'const r = await store.listForAnchors(urlKey, anchors);\n' }]).length, 1);
    assert.deepEqual(wiringProblems([{ path: 'lib/x.js', text: 'export function readCost({ requestRows }) {}\n// readCost({ fetchedRows })\n' }]), []);
  });
});
