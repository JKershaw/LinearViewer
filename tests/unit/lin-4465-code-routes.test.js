/**
 * LIN-4465 (piece 1 of LIN-4448): the code routes are one ordered list, CODE_ROUTES
 * (lib/code-routes.js), and codeRouteOf iterates it. Witnesses:
 *   - the contract: the order and the count are pinned, the first entry is the live-stage wait,
 *     and every entry names its trace values (`emits`);
 *   - skipLiveWait drops that first entry and only it: through getRecommendation, a ticket with a
 *     live run and an exhausted review loop skips the wait and still stops at the bound (a skip
 *     of the first two entries fails here);
 *   - each entry's route, given a fixture that makes it fire, records a `codeRoute` its `emits`
 *     declare (a route with no trace name fails here);
 *   - the bound's two reasons, byte for byte as codeRouteOf wrote them before the list;
 *   - the docs say the same order: prompt-system.md, source-map.md, CLAUDE.md, and the
 *     blind-read bullet in public/llms.txt, which said "Sent by hand" when this was written.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODE_ROUTES } from '../../lib/code-routes.js';
import { reviewLoopStep } from '../../lib/recommendation-facts.js';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { sealedDescription } from '../helpers/sealed-description.js';
import { planRound, loopFactsFor } from '../helpers/plan-review-loop.js';

afterEach(() => { setFetchImpl(null); setPromptTraceRecorder(null); });

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** The order, pinned here and in the docs. Changing it is a change to the contract. */
// LIN-4521: `re-review` sits between the bound and the blind read (a stale approval is re-judged before a read is sent).
const ORDER = ['live-wait', 'review-bound', 're-review', 'blind-read', 'look-first'];

const REPO = 'acme/widget';
const PR1 = `https://github.com/${REPO}/pull/41`;
const REVIEWED = 'aaaaaaa1111111';
const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const RCn = (n, blocking) => c(n, `### Plan Review Verdict\n\nFinding.\n\n**Verdict: Request Changes.**\n\nFinding.\n\nBlocking findings: ${blocking}`);
const run = (stage, n, outcome) => ({ stage, at: T(n), outcome, dispatchedAt: T(n), id: `r${n}` });
const STARTED = { name: 'In Progress', type: 'started' };
const OPEN = { name: 'Todo', type: 'unstarted' };
const ASKED = sealedDescription('Make the export button download a CSV.');
// LIN-4518 (finding-527b8237): the loop's facts are records-built: `ROUNDS(3, 2, 1)` is three plan-review verdicts on
// record, each with that many `to: plan` findings in its own run (tests/helpers/plan-review-loop.js).
const ROUNDS = (...counts) => counts.map((n, i) => planRound(T(i + 1), 'request-changes', n));
// LIN-4520: the review and the landing are the records trail (lib/task-standing.js trailForTicket's shape): an approving
// review at `n` of the PR, with no blind read on record yet.
const approvedTrail = (n = 2) => ({
  review: { verdict: 'approve', at: T(n), sha: REVIEWED, heads: { [PR1]: REVIEWED }, commentId: 'review-1', blindRead: null, staleUrls: [] },
  landing: [PR1], workAfterReview: false, closeOutAfterReview: false, closeOutOnTrail: false,
  landingHasNotesPr: false, notesPrs: [], auditAfterCloseOut: false,
});

const entry = (name) => {
  const found = CODE_ROUTES.find(r => r.name === name);
  assert.ok(found, `CODE_ROUTES has no entry named ${name}`);
  return found;
};

describe('CODE_ROUTES: the contract', () => {
  test('one frozen list, in the pinned order, with unique names', () => {
    assert.ok(Object.isFrozen(CODE_ROUTES));
    assert.deepEqual(CODE_ROUTES.map(r => r.name), ORDER);
    assert.equal(new Set(CODE_ROUTES.map(r => r.name)).size, CODE_ROUTES.length);
  });

  test('the first entry is the live-stage wait (the position skipLiveWait drops)', () => {
    assert.equal(CODE_ROUTES[0].name, 'live-wait');
  });

  test('every entry declares its trace values, and a route is a function', () => {
    for (const r of CODE_ROUTES) {
      assert.equal(typeof r.route, 'function', `${r.name} has no route()`);
      assert.ok(Array.isArray(r.emits) && r.emits.length > 0,
        `${r.name} declares no emits: a route with no prompt-trace name cannot be checked`);
      for (const e of r.emits) assert.equal(typeof e, 'string', `${r.name} emits a non-string`);
    }
  });
});

describe('CODE_ROUTES: each route fires on its fixture and records a declared trace value', () => {
  const fixtures = {
    'live-wait': { issue: { identifier: 'T-1', state: STARTED, description: '' }, context: { comments: [], allRuns: [run('implementation', 3, 'running')] } },
    'review-bound': { issue: { identifier: 'T-1', state: STARTED, description: '' }, context: { planReviewLoop: loopFactsFor(ROUNDS(3, 3, 3)), allRuns: [] } },
    // LIN-4501: the person's words are the task's `asked` on the recommendation input, not the description's block.
    'look-first': { issue: { identifier: 'T-1', state: OPEN, description: ASKED }, context: { comments: [], personFindings: [], allRuns: [], asked: 'Make the export button download a CSV.', planFacts: { measured: true, hasPlan: false }, sizeDecisions: [] } },
  };

  for (const name of ['live-wait', 'review-bound', 'look-first']) {
    test(`${name} fires and its codeRoute is in emits`, () => {
      const { issue, context } = fixtures[name];
      const got = entry(name).route(issue, context);
      assert.ok(got, `${name} stood aside on its own fixture`);
      assert.ok(entry(name).emits.includes(got.codeRoute),
        `${name} recorded codeRoute ${got.codeRoute}, which emits ${JSON.stringify(entry(name).emits)} does not declare`);
    });
  }

  test('blind-read fires (send) and blocked (two ended reads, no verdict), both declared', () => {
    const issue = { identifier: 'T-1', state: STARTED, description: '' };
    // LIN-4520: the approving review on the PR, and the landing, are the records trail; no comment is read.
    const trail = approvedTrail();
    const sent = entry('blind-read').route(issue, { trail, allRuns: [] });
    assert.equal(sent?.codeRoute, 'blind-read');
    assert.ok(entry('blind-read').emits.includes('blind-read'));
    const bounded = entry('blind-read').route(issue, {
      trail, allRuns: [run('blind-read', 3, 'done'), run('blind-read', 4, 'failed')]
    });
    assert.equal(bounded?.codeRoute, 'blocked');
    assert.ok(entry('blind-read').emits.includes('blocked'));
  });

  test('review-bound fires with blocked, its declared value', () => {
    const issue = { identifier: 'T-1', state: STARTED, description: '' };
    assert.equal(entry('review-bound').route(issue, { planReviewLoop: loopFactsFor(ROUNDS(3, 3, 3)), allRuns: [] })?.codeRoute, 'blocked');
  });
});

describe('skipLiveWait drops the first entry only', () => {
  // A ticket that meets two routes at once: a live implementation run (the live-stage wait) and
  // three Request Changes verdicts that do not narrow (the review loop bound). No model is asked:
  // the fetch stub fails the test if the selector is reached.
  const issue = { identifier: 'T-1', state: STARTED, description: '', labels: [] };
  const context = {
    parent: null, siblings: [], project: null, children: [], focusedChild: null, attachments: [], runs: [],
    comments: [RCn(1, 3), RCn(2, 3), RCn(3, 3)],
    planReviewLoop: loopFactsFor(ROUNDS(3, 3, 3)),
    allRuns: [run('implementation', 5, 'running')]
  };
  const traced = [];
  const ask = async (options) => {
    traced.length = 0;
    setPromptTraceRecorder((trace) => { traced.push(trace); });
    setFetchImpl(async () => { throw new Error('a code route must settle this without asking the selector'); });
    return getRecommendation(issue, context, { apiKey: 'stub', model: 'x', ...options });
  };

  test('without the skip, the live-stage wait settles it first', async () => {
    const rec = await ask({});
    assert.equal(rec.recommendedAction, null);
    assert.ok(rec.liveWait, 'the live run is named');
    assert.equal(traced[0]?.codeRoute, 'live-wait');
  });

  test('with the skip, the review bound (the second entry) still settles it: blocked, no model call', async () => {
    const rec = await ask({ skipLiveWait: true });
    assert.equal(rec.recommendedAction, 'blocked');
    assert.equal(rec.codeRoute, 'blocked');
    assert.equal(traced[0]?.codeRoute, 'blocked');
  });
});

describe('CODE_ROUTES: the bound keeps its reasons byte for byte', () => {
  const issue = { identifier: 'T-1', state: STARTED, description: '' };

  test('not converging: the bound sentence, then the person-comment tail', () => {
    const r = entry('review-bound').route(issue, { planReviewLoop: loopFactsFor(ROUNDS(3, 3, 3)), allRuns: [] });
    assert.deepEqual(r, {
      action: 'blocked',
      codeRoute: 'blocked',
      why: 'the plan-review loop reached its bound: the plan has been sent back repeatedly since its last Approve and the findings are not narrowing, with no person\'s comment since the latest verdict.'
    });
  });

  test('ceiling: the ceiling sentence, then the person-comment tail', () => {
    const r = entry('review-bound').route(issue, { planReviewLoop: loopFactsFor(ROUNDS(3, 2, 2, 1, 1)), allRuns: [] });
    assert.deepEqual(r, {
      action: 'blocked',
      codeRoute: 'blocked',
      why: 'the plan-review loop reached its ceiling of 5 reviews since the last Approve, whatever the findings count, with no person\'s comment since the latest verdict.'
    });
  });

  test('no loop: the bound stands aside', () => {
    assert.equal(entry('review-bound').route(issue, { planReviewLoop: loopFactsFor(ROUNDS(3)), allRuns: [] }), null);
    // A converging run on record (3, 2, 1 findings, each counted from its own run's `to: plan` findings) stands the bound aside.
    assert.equal(entry('review-bound').route(issue, { planReviewLoop: loopFactsFor(ROUNDS(3, 2, 1)), allRuns: [] }), null, 'the counts come from the records');
    // Comment prose is not the loop's facts: three Request Changes comments with one verdict on record do not stop it.
    assert.equal(entry('review-bound').route(issue, { planReviewLoop: loopFactsFor(ROUNDS(3), [RCn(1, 3), RCn(2, 3), RCn(3, 3)]), allRuns: [] }), null, 'comments alone are not the loop\'s facts');
  });

  test('the entry delegates: its reasons are written once, beside the bound (lib/recommendation-facts.js reviewLoopStep)', () => {
    for (const rounds of [ROUNDS(3, 3, 3), ROUNDS(3, 2, 2, 1, 1)]) {
      // LIN-4518 (finding-55356e66, finding-527b8237): the entry reads the loop's facts, and they come from the records.
      const planReviewLoop = loopFactsFor(rounds);
      const step = reviewLoopStep(issue, planReviewLoop);
      assert.deepEqual(entry('review-bound').route(issue, { planReviewLoop, allRuns: [] }), { action: step.step, codeRoute: step.codeRoute, why: step.why });
    }
    const source = readFileSync(new URL('../../lib/code-routes.js', import.meta.url), 'utf8');
    assert.ok(!source.includes('findings are not narrowing') && !source.includes('whatever the findings count'), 'lib/code-routes.js spells no reason of its own');
  });
});

describe('the docs say the same order as CODE_ROUTES', () => {
  const names = CODE_ROUTES.map(r => r.name);
  const ORDER_LINE = /Code route order \(`CODE_ROUTES`, lib\/code-routes\.js\): ([^.\n]+)/;
  const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map(m => m[1]);

  test('prompt-system.md states the order in its one parseable line', () => {
    const m = read('docs/architecture/prompt-system.md').match(ORDER_LINE);
    assert.ok(m, 'docs/architecture/prompt-system.md has no "Code route order (`CODE_ROUTES`, lib/code-routes.js): ..." line');
    assert.deepEqual(ticks(m[1]), names);
  });

  test('prompt-system.md Restated invariant names every route in CODE_ROUTES', () => {
    const doc = read('docs/architecture/prompt-system.md');
    const para = doc.split('\n').find(l => l.includes('**Restated invariant:'));
    assert.ok(para, 'no Restated invariant paragraph');
    for (const n of names) assert.ok(para.includes(`\`${n}\``), `Restated invariant omits ${n}`);
  });

  test('prompt-system.md keeps no ordinal route prose', () => {
    assert.doesNotMatch(read('docs/architecture/prompt-system.md'), /\b(second|third|fourth) route\b|\bcode settles a (third|fourth)\b/i);
  });

  test('source-map.md gives code-routes.js its row and the same order line', () => {
    const row = read('docs/architecture/source-map.md').split('\n').find(l => /^\s+code-routes\.js\s/.test(l));
    assert.ok(row, 'docs/architecture/source-map.md has no code-routes.js row');
    const m = row.match(ORDER_LINE);
    assert.ok(m, 'the code-routes.js row has no order line');
    assert.deepEqual(ticks(m[1]), names);
  });

  test('source-map.md route module rows give no ordinal', () => {
    assert.doesNotMatch(read('docs/architecture/source-map.md'), /\b(second|third|fourth) route code\b|\bthe (first|second|third|fourth) route\b/i);
  });

  test('CLAUDE.md points at CODE_ROUTES rather than restating the order', () => {
    const doc = read('CLAUDE.md');
    assert.ok(doc.includes('lib/code-routes.js'), 'CLAUDE.md does not point at lib/code-routes.js');
  });

  test('llms.txt blind-read bullet says code sends it, not by hand', () => {
    const bullet = read('public/llms.txt').split('\n').find(l => l.startsWith('- `blind-read`'));
    assert.ok(bullet, 'no blind-read bullet in public/llms.txt');
    assert.match(bullet, /code sends it/i);
    assert.doesNotMatch(bullet, /Sent by hand/);
  });

  test('prompt-trace-store.js points at CODE_ROUTES for its codeRoute values', () => {
    assert.ok(read('lib/prompt-trace-store.js').includes('lib/code-routes.js'),
      'the codeRoute docblock in lib/prompt-trace-store.js does not point at lib/code-routes.js');
  });
});
