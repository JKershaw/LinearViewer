/**
 * LIN-4226 (piece 4b of LIN-4195): the cost read loads its request records through the source it is given.
 *
 * These are the acceptance witnesses for the new shape `{ requestSource, urlKey }` (or `instanceWide: true`), written
 * before the change. At HEAD (2ee4e600) the read takes a preloaded `requestRows` array, so each witness below fails
 * with the message named in its own comment. The census at the end holds production code to one load per entry.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCost, lineageRecords } from '../../lib/cost-read.js';
import { buildRunView } from '../../lib/run-view.js';
import { renderSessionPage } from '../../lib/render-session.js';
import { readModelsHistory } from '../../lib/model-routing-history.js';
import { collectKpiStats } from '../../lib/kpi-stats.js';
import { requestUsageLoader } from '../../lib/request-usage-loader.js';
import { loaderOver } from '../fixtures/request-usage-loader.js';
import { buildApp, call, ACME as FAKE_ACME } from './lib/proxy-fake-deps.js';
import express from 'express';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { registerProvider } from '../../lib/providers/registry.js';

const ACME = 'acme-lin-4226';
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 4, 12);
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
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

describe('W1: the read is pure over the source it receives, and loads once', () => {
  // Fails at HEAD: readCost throws "requestRows is required" (no requestSource is read).
  test('readCost loads its records through the source, one call, and the figure is the records figure', async () => {
    const source = loaderOver(RECORDS);
    const out = await readCost({ fetchedRows: [snapshotRow()], identityRows: [], requestSource: source, urlKey: ACME });
    close(out.totalUsd, 0.3);
    assert.deepEqual(source.calls, [{ urlKey: ACME, anchors: ['root-1'] }]);
  });

  test('readCost over the same fake source gives the same figure on a second call', async () => {
    const source = loaderOver(RECORDS);
    const first = await readCost({ fetchedRows: [snapshotRow()], identityRows: [], requestSource: source, urlKey: ACME });
    const second = await readCost({ fetchedRows: [snapshotRow()], identityRows: [], requestSource: source, urlKey: ACME });
    assert.deepEqual(second, first);
  });

  // Fails at HEAD: lineageRecords throws "requestRows is required".
  test('lineageRecords loads through the source once, and its record carries the records, not the snapshot', async () => {
    const source = loaderOver(RECORDS);
    const records = await lineageRecords({ fetchedRows: [snapshotRow()], identityRows: [], requestSource: source, urlKey: ACME });
    assert.equal(records.length, 1);
    assert.equal(records[0].requests.length, 2);
    assert.equal(source.calls.length, 1);
  });

  // Fails at HEAD: buildRunView throws "buildRunView: requestRows is required".
  test('buildRunView loads once for all the session\'s lineages, and each step gets its own lineage\'s records', async () => {
    const loop = (loopId, hoursAgo) => ({
      loopId, lineageId: loopId, kind: 'implementation', dispatchedAt: at(hoursAgo), feedback: [], terminalStatus: 'done',
    });
    const session = { sessionId: 's', seedIssue: 'LIN-1', loops: [loop('L1', 5), loop('L2', 2)] };
    const source = loaderOver([
      { rootItemId: 'L1', itemId: 'L1', requestId: 'a1', at: at(5), harness: 'claude-code', model: 'claude-opus-5-5', inputTokens: 1, costUsd: 0.1 },
      { rootItemId: 'L2', itemId: 'L2', requestId: 'b1', at: at(2), harness: 'claude-code', model: 'claude-opus-5-5', inputTokens: 1, costUsd: 0.5 },
    ]);
    const view = await buildRunView(session, { now: NOW, requestSource: source, urlKey: ACME });
    assert.equal(source.calls.length, 1);
    assert.deepEqual([...source.calls[0].anchors].sort(), ['L1', 'L2']);
    close(view.steps[0].cost.usd, 0.1);
    close(view.steps[1].cost.usd, 0.5);
  });
});

describe('W2: the guards: a missing source, the old shape, and a missing urlKey all throw by name', () => {
  // Fails at HEAD: the message is "readCost: requestRows is required", not one naming requestSource.
  test('readCost without a requestSource throws a TypeError that names it', async () => {
    await assert.rejects(
      async () => readCost({ fetchedRows: [], identityRows: [], urlKey: ACME }),
      { name: 'TypeError', message: /readCost: requestSource is required/ }
    );
  });

  // Fails at HEAD: readCost accepts requestRows and returns the figure.
  test('readCost given the old requestRows shape throws: a half-migrated caller fails loudly', async () => {
    await assert.rejects(
      async () => readCost({ fetchedRows: [snapshotRow()], identityRows: [], requestRows: RECORDS, urlKey: ACME }),
      { name: 'TypeError', message: /requestRows/ }
    );
  });

  // Fails at HEAD: the message is "requestRows is required", with no urlKey rule.
  test('a read with a source but neither urlKey nor instanceWide throws (the rule depends on the call, not the data)', async () => {
    await assert.rejects(
      async () => readCost({ fetchedRows: [snapshotRow()], identityRows: [], requestSource: loaderOver(RECORDS) }),
      { name: 'TypeError', message: /urlKey or instanceWide/ }
    );
  });

  // Fails at HEAD: readCost throws "requestRows is required" before any read.
  test('instanceWide: true needs no urlKey; a row with no urlKey is skipped, and its lineage reads its snapshot as today', async () => {
    const source = loaderOver(RECORDS);
    const out = await readCost({ fetchedRows: [snapshotRow({ urlKey: undefined })], identityRows: [], requestSource: source, instanceWide: true });
    assert.deepEqual(source.calls, []);
    close(out.totalUsd, 4.9);
  });

  // Fails at HEAD: the message is "buildRunView: requestRows is required".
  test('buildRunView without a requestSource throws a TypeError that names it', async () => {
    await assert.rejects(
      async () => buildRunView({ sessionId: 's', loops: [] }, { now: NOW }),
      { name: 'TypeError', message: /buildRunView: requestSource is required/ }
    );
  });

  // Fails at HEAD: renderSessionPage builds the view itself and throws "buildRunView: requestRows is required".
  test('renderSessionPage requires runView for a live session; it does not build the view itself', () => {
    const session = { sessionId: 's1', seedIssue: 'LIN-1', loops: [] };
    assert.throws(
      () => renderSessionPage({ session, sessionId: 's1' }, {}),
      { name: 'TypeError', message: /renderSessionPage: runView is required/ }
    );
  });
});

describe('W3: identity may be a promise, and both queries start before either resolves', () => {
  // Fails at HEAD: readCost throws "requestRows is required" synchronously. Post-change, an implementation that awaits
  // identity before starting the records load never resolves, and the timeout turns that into a failure.
  test('readCost accepts identityRows as a promise, and both queries start in parallel', { timeout: 2000 }, async () => {
    let release;
    const identityRows = new Promise(resolve => { release = resolve; });
    const source = {
      forAnchors: async () => [],
      forRows: async () => { release([]); return RECORDS; },
    };
    const out = await readCost({ fetchedRows: [snapshotRow()], identityRows, requestSource: source, urlKey: ACME });
    close(out.totalUsd, 0.3);
  });
});

describe('W5: /kpis makes one batched, instance-wide load', () => {
  const NOW_KPI = new Date('2026-11-03T12:00:00.000Z');
  const dispatchRow = (urlKey, n) => ({
    _id: `${urlKey}-${n}`, id: `${urlKey}-${n}`, rootItemId: `${urlKey}-${n}`, urlKey, status: 'taken', abort: false,
    kind: 'implementation', issueIdentifier: `LIN-${n}`, dispatchedAt: new Date(NOW_KPI.getTime() - DAY).toISOString(), feedback: [],
  });
  const collection = (docs) => ({
    find: () => ({ toArray: async () => docs }),
    countDocuments: async () => docs.length,
    findOne: async () => null,
  });
  // Every collection empty but the two dispatch ones, as the server hands collectKpiStats (cost-read-kpi-path.test.js).
  const bag = (history) => {
    const empty = () => collection([]);
    return {
      sessions: empty(), userPreferences: empty(), workspacePreferences: empty(), customPrompts: empty(),
      localIssues: empty(), dispatchTokens: empty(), proxyTokens: empty(), proxyEvents: empty(), agentStatus: empty(),
      freeTier: empty(), recapCache: empty(), briefCache: empty(), reportHistory: empty(), kpiDailyRollup: empty(),
      dispatchHistory: collection(history), dispatchQueue: collection([]),
    };
  };

  // Fails at HEAD: collectKpiStats rejects "collectKpiStats: requestRows is required" (it takes a records function).
  test('501 anchors in one workspace and 3 in another make three store reads, from one instance-wide load', { timeout: 10000 }, async () => {
    const history = [
      ...Array.from({ length: 501 }, (_, n) => dispatchRow('acme', n)),
      ...Array.from({ length: 3 }, (_, n) => dispatchRow('other', n)),
    ];
    const storeCalls = [];
    const loader = requestUsageLoader({
      listForAnchors: async (urlKey, anchors) => { storeCalls.push({ urlKey, n: anchors.length }); return []; },
    });
    let forRowsCalls = 0;
    const requestSource = {
      forAnchors: loader.forAnchors,
      forRows: (rows, options) => { forRowsCalls += 1; return loader.forRows(rows, options); },
    };
    await collectKpiStats(bag(history), { lineageIdentity: async () => [], now: NOW_KPI, milestoneFunnelDeps: {}, requestSource });
    assert.equal(forRowsCalls, 1, 'one instance-wide forRows over every dispatch row');
    assert.deepEqual(storeCalls.map(call => call.n).sort((a, b) => a - b), [1, 3, 500], '500 + 1 for acme (the batch size), 3 for other');
  });
});

describe('W6: a caller makes exactly one request-records load (witness 4, per caller)', () => {
  // Mutation-checked at beat 3: a route that preloads and also passes the source makes two loads, and this turns red.
  const storeFor = (rows) => ({
    listItems: async () => [],
    listHistory: async () => ({ items: rows, total: rows.length }),
    lineageIdentityRows: async () => rows.map(r => ({ _id: r._id, rootItemId: r.rootItemId, status: r.status, kind: r.kind, issueIdentifier: r.issueIdentifier, dispatchedAt: r.dispatchedAt })),
  });

  // The route reads its 30-day horizon from the wall clock, so this witness's fixtures are stamped from Date.now(): the
  // fixed-date fixtures above would fall out of that horizon under the clock-shift arm (LIN-3949), and the figure would
  // be withheld for the wrong reason.
  const liveAt = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
  const liveSnapshotRow = () => ({
    _id: 'root-1', id: 'root-1', rootItemId: 'root-1', urlKey: FAKE_ACME, status: 'taken', kind: 'implementation',
    issueIdentifier: 'LIN-42', issueId: 'issue-42', dispatchedAt: liveAt(2),
    feedback: [
      { kind: 'usage', timestamp: liveAt(2), message: `[usage] ${JSON.stringify({ harness: 'claude-code', model: 'claude-opus-5-5', inputTokens: 10, costUsd: 4.9 })}` },
      { message: '[done] landed', timestamp: liveAt(1.9) },
    ],
  });
  const liveRecords = [
    { rootItemId: 'root-1', itemId: 'root-1', requestId: 'm1', at: liveAt(2), harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', inputTokens: 10, costUsd: 0.1 },
    { rootItemId: 'root-1', itemId: 'root-1', requestId: 'm2', at: liveAt(1.95), harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', inputTokens: 10, costUsd: 0.2 },
  ];

  test('GET /api/proxy/cost makes exactly one records load and shows the records figure', async () => {
    const loader = loaderOver(liveRecords);
    const app = buildApp({ dispatchQueueStore: storeFor([liveSnapshotRow()]), requestUsageLoader: loader });
    const res = await call(app, 'GET', '/api/proxy/cost/LIN-42');
    assert.equal(res.status, 200);
    close(res.body.totalUsd, 0.3);
    assert.equal(loader.calls.length, 1, `one load: ${JSON.stringify(loader.calls)}`);
  });
});

describe('W7: the effort route runs the founder lookup and the records load in parallel (witness 3, at the route)', () => {
  // HEAD ran the lookup and the records load together. A route that awaits the lookup before the records load starts
  // never resolves the lookup (it resolves only when the records are asked for), so the request hangs and the abort
  // timeout turns that into a failure.
  let providerSeq = 0;
  test('GET /workspace/:urlKey/api/effort-readout answers while the lookup is pending until the records are asked for', { timeout: 10000 }, async () => {
    const name = `fake-effort-lin4226-${++providerSeq}`;
    registerProvider({ name, ui: {}, supports: () => true, fetchIssueComments: async () => [], fetchIssueFields: async () => ({}) });
    const workspace = { urlKey: 'ws-1', name: 'Workspace One', provider: name, accessToken: 'tok' };
    let release;
    const identity = new Promise(resolve => { release = resolve; });
    let recordsAsked = 0;
    const requestUsageLoader = {
      forAnchors: async () => [],
      forRows: async () => { recordsAsked += 1; release([]); return []; },
    };
    const store = {
      listItems: async () => [],
      listHistory: async () => ({ items: [], total: 0 }),
      lineageIdentityRows: () => identity,
    };
    const app = express();
    app.use(createDashboardRoutes({
      workspaceFromUrl: (req, _res, next) => {
        req.workspace = workspace;
        req.session = { workspaces: [{ urlKey: 'ws-1', name: 'Workspace One' }], features: {} };
        next();
      },
      dispatchQueueStore: store,
      agentStatusStore: {},
      runSummaryCacheStore: {},
      sessionSummaryCacheStore: {},
      freeTierStore: {},
      requestUsageLoader,
      getWorkspaceAccessToken: () => 'tok',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/workspace/ws-1/api/effort-readout`, { signal: AbortSignal.timeout(3000) });
      assert.equal(res.status, 200);
      assert.equal(recordsAsked, 1, 'one records load, asked for by the read');
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

describe('W4: the Models page reads once and carries the workerSessions the spend reads', () => {
  // Fails at HEAD: the page returns requestRows and identityRows, and no workerSessions.
  test('readModelsHistory returns workerSessions from one load, and no requestRows', async () => {
    const dispatchStore = {
      listHistoryWithBodies: async () => ({ items: [snapshotRow()], total: 1 }),
      lineageIdentityRows: async () => [],
    };
    const loader = loaderOver(RECORDS);
    const history = await readModelsHistory(dispatchStore, ACME, loader);
    assert.ok(Array.isArray(history.workerSessions), 'the page carries workerSessions');
    assert.equal(history.requestRows, undefined, 'the page no longer carries a records array');
    assert.equal(loader.calls.length, 1);
    close(history.workerSessions[0].costUsd, 0.3);
  });
});

// ─── Census: production code loads records only at the read's own entries ───

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The only files that may call the loader's forAnchors/forRows: the loader, the read, and the run view's one load. */
const LOAD_ALLOW = ['lib/request-usage-loader.js', 'lib/cost-read.js', 'lib/run-view.js'];
const HARNESS = 'tests/fixtures/cost-replay/harness.js';
const isCommentLine = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

/** Every production source file, plus the replay harness (the replay is a caller too). */
function scannedFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== 'eval') walk(full); } else if (/\.(m?js)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of ['lib', 'routes', 'scripts']) walk(path.join(REPO, dir));
  out.push(path.join(REPO, 'server.js'));
  out.push(path.join(REPO, 'tests/fixtures/cost-replay/harness.js'));
  return out.map(full => ({ path: path.relative(REPO, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') }));
}

/** `file:line` for each non-comment line matching `pattern`, in the given files. */
function hitsOf(files, pattern) {
  const hits = [];
  for (const { path: file, text } of files) {
    text.split('\n').forEach((line, index) => {
      if (!isCommentLine(line) && pattern.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('census (LIN-4226): one load per read entry, and no preloaded records', () => {
  // Production code: no caller loads records for itself (LIN-4226 beat 3). Fails at HEAD on the 11 caller sites.
  test('production code: forAnchors and forRows are called only in the loader, the read and the run view\'s one load', () => {
    const files = scannedFiles().filter(({ path: file }) => !LOAD_ALLOW.includes(file) && file !== HARNESS);
    assert.deepEqual(hitsOf(files, /\.(forAnchors|forRows)\s*\(/), []);
  });

  // The replay harness is a caller too; it stays red until beat 4 migrates it (its S10/S11/S13 loads).
  test('the replay harness: no direct forAnchors or forRows call (beat 4)', () => {
    const files = scannedFiles().filter(({ path: file }) => file === HARNESS);
    assert.deepEqual(hitsOf(files, /\.(forAnchors|forRows)\s*\(/), []);
  });

  // Fails at HEAD: requestRows is the preloaded-array shape the change removes. Counts identifiers only: the guard
  // that rejects the old key names it inside a string literal, which is not a caller passing rows.
  test('no production code passes requestRows (identifiers; a string literal in a guard is not one)', () => {
    const stripStrings = (text) => text.split('\n')
      .map(line => line.replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, '``'))
      .join('\n');
    const files = scannedFiles()
      .filter(({ path: file }) => !file.startsWith('tests/'))
      .map(({ path: file, text }) => ({ path: file, text: stripStrings(text) }));
    assert.deepEqual(hitsOf(files, /\brequestRows\b/), []);
  });

  // Passes at HEAD, and says nothing yet: the pure cores do not exist until the change adds them. Kept so the rule is
  // live once they do: no production module may import a *OverRecords core.
  test('no production module imports a pure *OverRecords core', () => {
    const files = scannedFiles();
    assert.deepEqual(hitsOf(files, /import\s*\{[^}]*\b\w+OverRecords\b[^}]*\}/), []);
  });
});
