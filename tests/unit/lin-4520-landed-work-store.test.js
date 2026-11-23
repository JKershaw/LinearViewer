/**
 * LIN-4520 (finding-5d5723b6, finding-5d38c050): the store path of landed work, on a real records store.
 *
 * RecordsStore.planReviewRunForTicket hands the task's change records to planReviewRunOf, and dates the landed work by
 * every change version that wrote a head: the first write, and each later revision whose head moved. Every other
 * landed-work test hands planReviewRunOf its changes directly, so these are the ones that fail if the store stops
 * passing the changes, or goes back to dating by the first write (or by the record's current version).
 *
 * Mutations (recorded in the commit): planReviewRunOf({ verdicts, findings }) without changes; dating by the first
 * write only; dating by the current version's `at`. Each turns the exact `landed` assertions red.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4520-landed-work-store.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { recordsStoreFor, seedTicketRecords, scenarioAt, ev } from '../helpers/records-scenario.js';
import { canonicalChangeRef } from '../../lib/records/change-ref.js';
import { loopFactsOf } from '../../lib/recommendation-facts.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';

const harness = createMangoTmpdir('lin-4520-landed-work-store-');
before(() => harness.connect());
after(() => harness.close());

const URL_KEY = 'acme';
const TICKET = 'LIN-1';
const PR = 'https://github.com/acme/widget/pull/12';
const PR_REF = canonicalChangeRef(PR);
const planReview = (n, outcome = 'request-changes') => ({ kind: 'planReview', at: scenarioAt(n), outcome, findings: 1 });
const merged = (n) => ({ kind: 'merged', at: scenarioAt(n), pr: PR });

async function runOf(events) {
  const store = await recordsStoreFor(harness);
  await seedTicketRecords(store, URL_KEY, TICKET, events);
  return store.planReviewRunForTicket(URL_KEY, TICKET);
}

describe('RecordsStore.planReviewRunForTicket: landed work from the task\'s change records', () => {
  test('a change recorded before the verdict and revised to a new head after it is landed work since the verdict', async () => {
    const run = await runOf([ev.pr(1, PR, 'aaa1111'), planReview(2), ev.head(3, PR, 'bbb2222')]);
    assert.deepEqual(run.landed, [{ url: PR_REF, at: scenarioAt(1) }, { url: PR_REF, at: scenarioAt(3) }]);
    assert.equal(loopFactsOf(run, []).landed, PR_REF);
  });

  test('a change recorded before the verdict and never pushed again is not landed work since it', async () => {
    const run = await runOf([ev.pr(1, PR, 'aaa1111'), planReview(2)]);
    assert.deepEqual(run.landed, [{ url: PR_REF, at: scenarioAt(1) }]);
    assert.equal(loopFactsOf(run, []).landed, null);
  });

  test('a version that did not write a head (the merge end) adds no landed work and does not re-date the change', async () => {
    const run = await runOf([ev.pr(1, PR, 'aaa1111'), ev.head(2, PR, 'bbb2222'), planReview(3), merged(4)]);
    assert.deepEqual(run.landed, [{ url: PR_REF, at: scenarioAt(1) }, { url: PR_REF, at: scenarioAt(2) }]);
    assert.equal(loopFactsOf(run, []).landed, null, 'the merge is not a push; both pushes came before the verdict');
  });

  test('a ticket with no change records has no landed work', async () => {
    const run = await runOf([planReview(2)]);
    assert.deepEqual(run.landed, []);
  });
});

describe('a revision pushed after a person\'s comment is an agent acting after it (finding-5d38c050)', () => {
  test('actedAfter is true when the change was first recorded before the comment and revised after it', async () => {
    const run = await runOf([ev.pr(1, PR, 'aaa1111'), planReview(2), ev.head(12, PR, 'bbb2222')]);
    // LIN-4535: the person's words are their finding (a person finding, never the comment's text).
    const person = { createdAt: scenarioAt(10), body: 'Addendum: two more items for this round.' };
    const personFinding = { id: 'finding-addendum', at: scenarioAt(10), accountId: 'john', says: person.body, ruling: false };
    const report = { createdAt: scenarioAt(12), body: `Fixes pushed: ${PR} at bbb2222` };
    assert.equal(assembleTrailFacts([person, report], '', { planReviewRun: run, personFindings: [personFinding] }).latestPerson.actedAfter, true);
    const noPush = await runOf([ev.pr(1, PR, 'aaa1111'), planReview(2)]);
    assert.equal(assembleTrailFacts([person, report], '', { planReviewRun: noPush, personFindings: [personFinding] }).latestPerson.actedAfter, false, 'the comment citing the PR alone is not work');
  });
});
