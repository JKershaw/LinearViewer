/**
 * LIN-4360: each rule around the `## As asked` block lives in one place.
 *
 * - The `plan-review due:` line has one reader, `planReviewDueOf` in
 *   lib/plan-review-round-trips.js. The round-trip measure's `gateDue` and the
 *   selector's `planReviewDue` read through it, so the bold form
 *   (`**plan-review due:** yes`) is due to both. The four cases where the measure's
 *   old reader disagreed with the selector's are pinned in as-asked-readers.test.js.
 * - "The text outside the block" (a legacy block, filed before LIN-4502) has one definition,
 *   `outsideAsked` in lib/asked-of.js, which readFact and assembleTrailFacts both use.
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
import { outsideAsked } from '../../lib/asked-of.js';
import * as roundTrips from '../../lib/plan-review-round-trips.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
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
    const desc = `${quoteAsked('Piece A.\n\n**Plan-review due:** no — covered by the parent')}\n\n## Implementation Plan (revision 2)\n\n**plan-review due:** yes`;
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
  test('outsideAsked: above plus below a legacy block, the whole text when none, empty for null', () => {
    assert.equal(typeof outsideAsked, 'function', 'lib/asked-of.js exports outsideAsked');
    const sealed = quoteAsked('The ask.');
    assert.equal(outsideAsked(`Above.\n${sealed}\n\nBelow.`), 'Above.\n\n\nBelow.');
    assert.equal(outsideAsked(sealed), '');
    assert.equal(outsideAsked('No block here.'), 'No block here.');
    assert.equal(outsideAsked(null), '');
    assert.equal(outsideAsked(undefined), '');
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
