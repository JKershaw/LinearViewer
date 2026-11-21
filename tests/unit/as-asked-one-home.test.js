/**
 * LIN-4360: each rule around the `## As asked` block lives in one place.
 *
 * - The `plan-review due:` line has no reader any more (LIN-4504: the gate and the selector read records).
 * - The text of a description is read whole (LIN-4527): the size record reads the whole description, and
 *   lib/asked-of.js exports only `askedOf`, the request as filed. No second split of a legacy block exists.
 * - The brief composer (`composeBrief`, `briefQuoteEnd`) and the quote's spellings live in the
 *   pure lib/brief-quote.js (LIN-4501: it quotes the task's `asked`; LIN-4502 retired the
 *   block's own module), so the test-mode mocks do not pull in the live model client
 *   (`streamChat`) through lib/brief.js, and there is one mock brief builder,
 *   lib/workspace-api-mocks.js's `buildMockBrief`, which the proxy routes use too.
 *
 * Run with: node --test tests/unit/as-asked-one-home.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildImportGraph } from './lib/import-graph.js';
import { quoteAsked } from '../../lib/brief-quote.js';
import * as askedOfModule from '../../lib/asked-of.js';
import * as roundTrips from '../../lib/plan-review-round-trips.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
const ASOF = '2026-08-09T12:00:00.000Z';
const planRows = [
  { id: 'p1', kind: 'plan', status: 'done', dispatchedAt: '2026-08-09T09:00:00.000Z', completedAt: '2026-08-09T09:30:00.000Z' }
];
const gateDue = (description) =>
  roundTrips.computeIssueRoundTrips({ id: 'x', identifier: 'LIN-x', description, comments: [], rows: planRows }, { asOf: ASOF }).gateDue;
// LIN-4504: the selector reads no due line at all; its plan facts are records (not measured with none read).
const selectorDue = (description) => assembleTrailFacts([], description, { leaf: true }).plan.measured;

/** Every module under lib/ and routes/, for import-graph questions. */
function sourceGraph() {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []);
  return buildImportGraph([...walk('lib'), ...walk('routes')].map((path) => ({ path, source: readFileSync(path, 'utf8') })));
}

/** Lines that are not comments: a `//` line or a JSDoc line. */
const codeLines = (source) => source.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*(\s|\/|$))/.test(l));

describe('LIN-4504: no reader of the plan-review due line remains', () => {
  test('the round-trip measure and the selector read the gate from records; no module carries a due-line pattern', () => {
    assert.equal(gateDue('**plan-review due:** yes'), null, 'the round-trip gate is not measured without plan records');
    assert.equal(selectorDue('**plan-review due:** yes'), false, 'the selector\'s plan facts are records, not measured with none read');
    assert.equal(roundTrips.planReviewDueOf, undefined, 'planReviewDueOf is retired');
    const graph = sourceGraph();
    assert.deepEqual(graph.paths().filter((p) => codeLines(graph.sourceOf(p)).some((l) => /\/plan-review due:/i.test(l))), []);
  });
});

describe('one definition of the text outside the block', () => {
  test('lib/asked-of.js exports only askedOf: the text outside a block is retired (LIN-4527), the whole description is read', () => {
    assert.deepEqual(Object.keys(askedOfModule).sort(), ['askedOf']);
    const sealed = quoteAsked('The ask.');
    assert.equal(askedOfModule.askedOf(`Above.\n${sealed}\n\nBelow.`), `Above.\n${sealed}\n\nBelow.`);
    assert.equal(askedOfModule.askedOf(null), '');
  });

  test('no module under lib/ or routes/ rebuilds it by hand from a split', () => {
    const graph = sourceGraph();
    const handSplits = graph.paths().filter((p) => p !== 'lib/asked-of.js' &&
      codeLines(graph.sourceOf(p)).some((l) => /\.before\s*\+\s*\w+\.below\b/.test(l)));
    assert.deepEqual(handSplits, []);
  });
});

describe('a pure brief composer and one mock brief', () => {
  test('lib/workspace-api-mocks.js cannot reach the live model client (streamChat)', () => {
    assert.equal(sourceGraph().reaches('lib/workspace-api-mocks.js', 'streamChat'), false);
  });

  test('composeBrief, briefQuoteEnd and the quote\'s spellings live in lib/brief-quote.js, which imports only description-edit.js', () => {
    const graph = sourceGraph();
    for (const name of ['composeBrief', 'briefQuoteEnd', 'quoteAsked', 'splitQuote', 'ASKED_HEADING', 'ASKED_END', 'BRIEF_HINT']) {
      assert.ok(graph.exportedNamesOf('lib/brief-quote.js').includes(name), name);
    }
    assert.deepEqual(graph.dependenciesOf('lib/brief-quote.js'), ['lib/description-edit.js']);
    const briefSource = codeLines(readFileSync('lib/brief.js', 'utf8')).join('\n');
    assert.doesNotMatch(briefSource, /function (composeBrief|briefQuoteEnd)\b/, 'lib/brief.js no longer defines them');
  });

  test('the mocks and the task page take the composer from lib/brief-quote.js, not lib/brief.js', () => {
    const graph = sourceGraph();
    for (const path of ['lib/workspace-api-mocks.js', 'lib/task-page-loader.js']) {
      assert.ok(!graph.dependenciesOf(path).includes('lib/brief.js'), `${path} must not import lib/brief.js`);
      assert.ok(graph.dependenciesOf(path).includes('lib/brief-quote.js'), `${path} takes the composer from lib/brief-quote.js`);
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
