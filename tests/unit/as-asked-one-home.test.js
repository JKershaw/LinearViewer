/**
 * LIN-4360: each rule around the `## As asked` block lives in one place.
 *
 * - The `plan-review due:` line has one reader, `planReviewDueOf` in
 *   lib/plan-review-round-trips.js. The round-trip measure's `gateDue` and the
 *   selector's `planReviewDue` read through it, so the bold form
 *   (`**plan-review due:** yes`) is due to both. The four cases where the measure's
 *   old reader disagreed with the selector's are pinned in as-asked-readers.test.js.
 * - "The text outside the block" has one definition, `outsideAsAsked` in
 *   lib/as-asked.js, which readFact and assembleTrailFacts both use.
 * - The brief composer (`composeBrief`, `briefQuoteEnd`) lives in the pure
 *   lib/as-asked.js, so the test-mode mocks no longer pull in the live model client
 *   (`streamChat`) through lib/brief.js, and there is one mock brief builder,
 *   lib/workspace-api-mocks.js's `buildMockBrief`, which the proxy routes use too.
 *
 * Run with: node --test tests/unit/as-asked-one-home.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import express from 'express';
import { buildImportGraph } from './lib/import-graph.js';
import * as asAsked from '../../lib/as-asked.js';
import * as roundTrips from '../../lib/plan-review-round-trips.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';

const { sealAsAsked } = asAsked;
const ASOF = '2026-08-09T12:00:00.000Z';
const planRows = [
  { id: 'p1', kind: 'plan', status: 'done', dispatchedAt: '2026-08-09T09:00:00.000Z', completedAt: '2026-08-09T09:30:00.000Z' }
];
const gateDue = (description) =>
  roundTrips.computeIssueRoundTrips({ id: 'x', identifier: 'LIN-x', description, comments: [], rows: planRows }, { asOf: ASOF }).gateDue;
const selectorDue = (description) => assembleTrailFacts([], description, { leaf: true }).plan.planReviewDue;

/** Every module under lib/ and routes/, for import-graph questions. */
function sourceGraph() {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []);
  return buildImportGraph([...walk('lib'), ...walk('routes')].map((path) => ({ path, source: readFileSync(path, 'utf8') })));
}

/** Lines that are not comments: a `//` line or a JSDoc line. */
const codeLines = (source) => source.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*(\s|\/|$))/.test(l));

describe('one reader for the plan-review due line', () => {
  test('the bold form is due through computeIssueRoundTrips, and the selector still reads it as yes', () => {
    assert.equal(gateDue('**plan-review due:** yes'), true, 'the round-trip measure reads the bold form as due');
    assert.equal(selectorDue('**plan-review due:** yes'), 'yes', 'the selector\'s reading is unchanged');
  });

  test('the bold form below a block that says no is due to both readers', () => {
    const desc = `${sealAsAsked('Piece A.\n\n**Plan-review due:** no — covered by the parent')}\n\n## Implementation Plan (revision 2)\n\n**plan-review due:** yes`;
    assert.equal(gateDue(desc), true);
    assert.equal(selectorDue(desc), 'yes');
  });

  test('planReviewDueOf: the first due line, plain or bold, value on the same line, word boundary after it', () => {
    const { planReviewDueOf } = roundTrips;
    assert.equal(typeof planReviewDueOf, 'function', 'lib/plan-review-round-trips.js exports planReviewDueOf');
    assert.equal(planReviewDueOf('plan-review due: yes'), 'yes');
    assert.equal(planReviewDueOf('Plan-review due: No — covered'), 'no');
    assert.equal(planReviewDueOf('**plan-review due:** yes'), 'yes');
    assert.equal(planReviewDueOf('plan-review due: no\n\nplan-review due: yes'), 'no');
    assert.equal(planReviewDueOf('plan-review due:\nyes'), null);
    assert.equal(planReviewDueOf('plan-review due: yesterday'), null);
    assert.equal(planReviewDueOf('no due line'), null);
    assert.equal(planReviewDueOf(''), null);
  });

  test('no other module under lib/ or routes/ carries its own due-line pattern', () => {
    const graph = sourceGraph();
    const holders = graph.paths().filter((p) => codeLines(graph.sourceOf(p)).some((l) => /\/plan-review due:/i.test(l)));
    assert.deepEqual(holders, ['lib/plan-review-round-trips.js']);
    const source = readFileSync('lib/plan-review-round-trips.js', 'utf8');
    assert.equal(codeLines(source).filter((l) => /\/plan-review due:/i.test(l)).length, 1, 'one pattern in that module');
    assert.equal(roundTrips.__internal.GATE_DUE_MARKER, undefined, 'GATE_DUE_MARKER has left __internal');
  });
});

describe('one definition of the text outside the block', () => {
  test('outsideAsAsked: above plus below when sealed, the whole text when not, empty for null', () => {
    const { outsideAsAsked } = asAsked;
    assert.equal(typeof outsideAsAsked, 'function', 'lib/as-asked.js exports outsideAsAsked');
    const sealed = sealAsAsked('The ask.');
    assert.equal(outsideAsAsked(`Above.\n${sealed}\n\nBelow.`), 'Above.\n\n\nBelow.');
    assert.equal(outsideAsAsked(sealed), '');
    assert.equal(outsideAsAsked('No block here.'), 'No block here.');
    assert.equal(outsideAsAsked(null), '');
    assert.equal(outsideAsAsked(undefined), '');
  });

  test('no module under lib/ or routes/ rebuilds it by hand from splitAsAsked', () => {
    const graph = sourceGraph();
    const handSplits = graph.paths().filter((p) => p !== 'lib/as-asked.js' &&
      codeLines(graph.sourceOf(p)).some((l) => /\.before\s*\+\s*\w+\.below\b/.test(l)));
    assert.deepEqual(handSplits, []);
  });
});

describe('a pure brief composer and one mock brief', () => {
  test('lib/workspace-api-mocks.js cannot reach the live model client (streamChat)', () => {
    assert.equal(sourceGraph().reaches('lib/workspace-api-mocks.js', 'streamChat'), false);
  });

  test('composeBrief and briefQuoteEnd live in lib/as-asked.js, which imports only description-edit.js', () => {
    const graph = sourceGraph();
    assert.ok(graph.exportedNamesOf('lib/as-asked.js').includes('composeBrief'));
    assert.ok(graph.exportedNamesOf('lib/as-asked.js').includes('briefQuoteEnd'));
    assert.deepEqual(graph.dependenciesOf('lib/as-asked.js'), ['lib/description-edit.js']);
    const briefSource = codeLines(readFileSync('lib/brief.js', 'utf8')).join('\n');
    assert.doesNotMatch(briefSource, /function (composeBrief|briefQuoteEnd)\b/, 'lib/brief.js no longer defines them');
  });

  test('the mocks and the task page take the composer from lib/as-asked.js, not lib/brief.js', () => {
    const graph = sourceGraph();
    for (const path of ['lib/workspace-api-mocks.js', 'lib/task-page-loader.js']) {
      assert.ok(!graph.dependenciesOf(path).includes('lib/brief.js'), `${path} must not import lib/brief.js`);
    }
  });

  test('routes/proxy-compute.js uses the shared buildMockBrief and has no brief builder of its own', () => {
    const graph = sourceGraph();
    const fromMocks = graph.importsOf('routes/proxy-compute.js')
      .filter((i) => i.resolved === 'lib/workspace-api-mocks.js')
      .flatMap((i) => i.bindings.map((b) => b.imported));
    assert.ok(fromMocks.includes('buildMockBrief'), 'proxy-compute imports buildMockBrief from lib/workspace-api-mocks.js');
    const source = readFileSync('routes/proxy-compute.js', 'utf8');
    assert.doesNotMatch(source, /buildMockBriefFromContext/);
    const composerImports = graph.importsOf('routes/proxy-compute.js')
      .flatMap((i) => i.bindings.map((b) => b.imported))
      .filter((name) => name === 'composeBrief' || name === 'askedText');
    assert.deepEqual(composerImports, [], 'proxy-compute no longer imports composeBrief or askedText');
  });
});

// Characterization of the proxy guard's "removed" message, pinned before its
// `firstLine` moves from splitAsAsked to askedText: it quotes line 1 of the block's
// words as stored, Linear escapes and all.
describe('the guard\'s removed message quotes the block\'s first line', () => {
  const LOCAL_URL_KEY = 'local-workspace';
  const WORDS = 'Please write a **full** guide.\nCover both modes.';
  const linearEscape = (text) => text.replace(/([#*_[\]])/g, '\\$1');

  function proxyApp() {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
      getWorkspaceAccessToken: async () => null,
      agentStatusStore: {},
      recapCacheStore: {},
      briefCacheStore: {},
      dispatchQueueStore: {},
      workspaceFromUrl: (req, res, next) => next(),
      getWorkspaceOpenRouterKey: async () => null,
      workspacePreferencesStore: {},
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
    }));
    return app;
  }

  async function patch(app, path, body) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  for (const [name, store] of [['plain', (t) => t], ['Linear-escaped', linearEscape]]) {
    describe(name, () => {
      const description = store(`${sealAsAsked(WORDS)}\n\n## Notes\n\nbelow`);
      beforeEach(async () => {
        const { store: localStore } = createLocalStore();
        await localStore.seed(LOCAL_URL_KEY, {
          projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
          issues: [{ id: 'i1', identifier: 'LOCAL-1', title: 'Sealed', description, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
        });
        localProvider.configure({ store: localStore });
      });

      test('a PATCH that drops the block names its line 1, as stored', async () => {
        const res = await patch(proxyApp(), '/api/proxy/issues/i1', { description: 'A tidy summary.' });
        assert.equal(res.status, 422);
        assert.equal(res.body.kind, 'removed');
        const firstLine = store(WORDS).split('\n')[0];
        assert.match(res.body.error, new RegExp(`starting at its line 1, ${JSON.stringify(firstLine).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      });
    });
  }
});
