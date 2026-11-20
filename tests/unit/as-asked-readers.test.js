/**
 * LIN-4351: below the block wins.
 *
 * A breakdown child is filed with `Session fit:` and `Plan-review due: no — covered
 * by …` inside its `## As asked` block. A revised plan written below the block must
 * win, the block is read only when the text below lacks the fact, and a ticket with
 * no block reads exactly as before. Each reader in the census is checked here:
 * file-pointer (extractPlanSection, extractPlanPaths), plan-review-round-trips (gateDue) and
 * follow-on-ratio (hasPlanMarker). LIN-4504: the selector's readers (assembleTrailFacts,
 * assembleNodeFacts) read plan facts from records, so none of these lines reaches them; the last
 * describe pins that.
 *
 * Run with: node --test tests/unit/as-asked-readers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { quoteAsked, splitQuote } from '../../lib/brief-quote.js';
import { assembleTrailFacts, assembleNodeFacts } from '../../lib/recommendation-facts.js';
import { extractPlanSection, extractPlanPaths } from '../../lib/file-pointer.js';
import { computeIssueRoundTrips } from '../../lib/plan-review-round-trips.js';
import { __internal as followOnRatio } from '../../lib/follow-on-ratio.js';

const ASOF = '2026-08-09T12:00:00.000Z';

/** A breakdown child's block, the way breakdown files it. */
const childBlock = (due, fit = 'fits one session') => quoteAsked(
  `Piece A of the parent's plan.\n\n**Session fit:** ${fit}\n\n**Plan-review due:** ${due} — covered by the parent's plan-review`
);


const planRows = [
  { id: 'p1', kind: 'plan', status: 'done', dispatchedAt: '2026-08-09T09:00:00.000Z', completedAt: '2026-08-09T09:30:00.000Z' }
];
const gateDue = (description) =>
  computeIssueRoundTrips({ id: 'x', identifier: 'LIN-x', description, comments: [], rows: planRows }, { asOf: ASOF }).gateDue;

const OPEN_CHILD = [{ identifier: 'LIN-2', state: { type: 'unstarted' } }];

describe('plan-review due: below the block wins', () => {

  test('round-trips gateDue: block no, below yes reads yes', () => {
    assert.equal(gateDue(`${childBlock('no')}\n\nplan-review due: yes`), true);
  });

  test('round-trips gateDue: nothing below the block reads the block\'s no', () => {
    assert.equal(gateDue(childBlock('no')), false);
    assert.equal(gateDue(quoteAsked('plan-review due: yes')), true);
  });

  test('round-trips gateDue: block yes, below no reads no (the inverse)', () => {
    assert.equal(gateDue(`${quoteAsked('plan-review due: yes')}\n\nplan-review due: no`), false);
    assert.equal(gateDue(`${quoteAsked('plan-review due: yes')}\n\n**plan-review due:** no`), false);
  });
});

describe('plan section: below the block wins', () => {
  const blockPlan = quoteAsked('Please fix it.\n\n## Implementation Plan\n\nTouch `lib/asked.js`.');

  test('a plan below the block wins over a plan heading in the block', () => {
    const desc = `${blockPlan}\n\n## Implementation Plan (revision 1)\n\nTouch \`lib/revised.js\`.`;
    assert.deepEqual(extractPlanPaths(desc), ['lib/revised.js']);
  });

  test('with no plan below, the block\'s plan is read, and it stops at the block\'s end', () => {
    const desc = `${blockPlan}\n\nNotes below mention \`lib/notes.js\`.`;
    assert.equal(extractPlanSection(desc), '\nTouch `lib/asked.js`.');
    assert.deepEqual(extractPlanPaths(desc), ['lib/asked.js']);
  });
});

describe('an unsealed ticket reads as today', () => {

  test('round-trips reads the due line as the selector does: the first line, plain or bold, value on that line', () => {
    assert.equal(gateDue('plan-review due: no\n\nplan-review due: yes'), false, 'due-line case 2: a no line followed by a yes line now counts as not due (the first line wins)');
    assert.equal(gateDue('plan-review due: no'), false);
    assert.equal(gateDue('**plan-review due:** yes'), true, 'due-line case 1: the bold form now counts as due');
    assert.equal(gateDue('no due line at all'), false);
    assert.equal(gateDue('plan-review due:\nyes'), false, 'due-line case 3: yes on the next line no longer counts');
    assert.equal(gateDue('plan-review due: yesterday'), false, 'due-line case 4: `yesterday` no longer counts');
  });

  test('the last plan heading wins, and runs to the next ## heading', () => {
    const desc = '## Implementation Plan\n\n`lib/a.js`\n\n## Implementation Plan (rev)\n\n`lib/b.js`\n\nmore `lib/c.js`';
    assert.deepEqual(extractPlanPaths(desc), ['lib/b.js', 'lib/c.js']);
  });

  test('follow-on-ratio\'s plan marker reads the description as before', () => {
    assert.equal(followOnRatio.hasPlanMarker({ description: 'Session fit: fits one session' }), true);
    assert.equal(followOnRatio.hasPlanMarker({ description: 'no marker here' }), false);
  });
});

describe('follow-on-ratio plan marker on a sealed ticket', () => {
  // A presence marker: "below wins" and "either place" give the same boolean, so
  // routing it through readFact cannot move this measure (stated in the module).
  test('a marker below or in the block counts; none in either does not', () => {
    assert.equal(followOnRatio.hasPlanMarker({ description: `${quoteAsked('The ask.')}\n\n## Implementation Plan` }), true);
    assert.equal(followOnRatio.hasPlanMarker({ description: quoteAsked('This fits one session.') }), true);
    assert.equal(followOnRatio.hasPlanMarker({ description: `${quoteAsked('The ask.')}\n\nnotes` }), false);
  });
});

describe('LIN-4504: the selector reads no plan fact from a sealed or unsealed description', () => {
  test('every shape above leaves assembleTrailFacts and assembleNodeFacts at not measured with no records read', () => {
    const descs = [
      `${childBlock('no')}\n\n## Implementation Plan (revision 2)\n\nplan-review due: yes`,
      childBlock('yes', 'needs multiple sessions'),
      'plan-review due: no\n\n## Implementation Plan\n\nfits one session',
    ];
    for (const d of descs) {
      assert.equal(assembleTrailFacts([], d, { leaf: true }).plan.measured, false, d);
      assert.equal(assembleNodeFacts({ description: d, state: { type: 'started' } }, OPEN_CHILD).frontierFacts.planFacts.measured, false, d);
    }
  });
});
