/**
 * LIN-4503 (P3, the outward half of LIN-4499): Harbour makes child tickets from task records and posts marked plan summaries.
 *
 * The writes run through the real checked pipeline (lib/records/writes.js) on a real store (MangoDB, tests/helpers/
 * records-route-harness.js), with the tracker stood in by tests/helpers/fake-records-tracker.js, except where a test says it
 * uses the real local provider. Witnesses (the ask's testing list, then the survey's additions):
 *   1. a child task gets exactly one ticket, and the task takes it as its ref;
 *   2. a retry after a failed ref write (a fault between the ticket claim and the store's revise) finds the ticket by its
 *      mark and makes no second one;
 *   3. a capped, unknown or failed children read creates nothing (provider-independent: the fake's knobs);
 *   4. a tracker that cannot parent-link, and a parent with no ticket, create nothing and say why;
 *   5. an import makes no ticket and posts no summary;
 *   6. a plan posts one marked summary per version, with its reason;
 *   7. a failed summary post is named in the answer and is never retried into a duplicate;
 *   8. the retry on a parent dispatch makes the ticket a failed create did not;
 *   9. a summary is not a person's comment nor a plan comment, even when it carries an Implementation Plan heading;
 *   10. the route refuses a stage's plan addressed elsewhere (naming both addressees), and answers a child's ticket;
 *   11. the importer only adds plans, because revise takes no `via`;
 *   12. a child ticket is filed under its parent on the real local provider, and reads back as the parent's child;
 *   13. a ticket mark names its task exactly (a prefix of another task id is not a match).
 */
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { ticketTaskIdOf } from '../../lib/records/refs.js';
import { taskMarkOf, markedTaskOf, childTicketDescriptionOf } from '../../lib/records/ticket-stub.js';
import { summaryOpeningOf, isHarbourSummary } from '../../lib/records/summary.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { isPersonComment, isPlanComment, commentKindOf, withoutHarbourSummaries } from '../../lib/run-trail.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
import { trackerPortOf } from '../../lib/records-tracker.js';
import { LocalStore } from '../../lib/local-store.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';

const URL_KEY = 'lin-4503-outward';
const BY = 'person:acc-john';
const PEOPLE = [{ accountId: 'acc-john', name: 'John' }];
const STAGES = Object.keys(STAGE_KINDS);
const PARENT = { identifier: 'LIN-1', title: 'Parent', description: 'The parent ticket words.', state: { name: 'In Progress', type: 'started' }, parent: null };

const harness = createMangoTmpdir('lin-4503-');
before(() => harness.connect());
after(() => harness.close());

let rh = null;
let fake = null;
let writes = null;

/** A fresh store, a fresh tracker holding the parent ticket, and the pipeline wired to both. */
async function fresh({ tickets = [PARENT] } = {}) {
  fake = createFakeTracker({ tickets });
  rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets: new Map(), people: PEOPLE, readTicket: fake.readTicket, tracker: fake.tracker });
  writes = createRecordWrites({ recordsStore: rh.store, isTerminalState, readTicket: fake.readTicket, askedText: () => '', stageKinds: STAGES, listPeople: async () => PEOPLE, tracker: fake.tracker });
  return rh;
}

afterEach(async () => {
  await rh?.close();
  rh = null;
});

/** The parent ticket's task, made the way a ticket's first reference makes it. */
async function parentTask() {
  const made = await writes.add({ urlKey: URL_KEY, kind: 'task', input: { ref: 'LIN-1', 'done-when': 'the parent is done' }, by: BY });
  assert.ok(!made.problems, JSON.stringify(made.problems));
  return made.record.id;
}

/** A child task under `parent`, through the pipeline (what a person's task-page add and an agent's proxy write both call). */
async function childTask(parent, doneWhen = 'write the migration', extra = {}) {
  const made = await writes.add({ urlKey: URL_KEY, kind: 'task', input: { in: parent, 'done-when': doneWhen }, by: BY, ...extra });
  assert.ok(!made.problems, JSON.stringify(made.problems));
  return made;
}

const refOf = async (id) => (await rh.store.current(URL_KEY, id))?.fields?.ref ?? null;

describe('LIN-4503: child tickets and plan summaries', () => {
  test('1. a child task gets exactly one ticket, and the task takes it as its ref', async () => {
    await fresh();
    const parent = await parentTask();
    const { record, ticket } = await childTask(parent, 'write the migration');
    assert.equal(ticket.identifier, 'LIN-101');
    assert.equal(fake.created.length, 1);
    assert.equal(await refOf(record.id), 'LIN-101');
    assert.equal(await rh.store.claimOf(URL_KEY, 'LIN-101'), record.id, 'the ticket is claimed by the child task');
    const stub = fake.created[0];
    assert.equal(stub.parentRef, 'LIN-1');
    assert.equal(markedTaskOf(stub.description), record.id, 'the stub carries the task mark');
    assert.match(stub.description, /\*\*Done when:\*\* write the migration/);
    const retry = await writes.retryChildTickets({ urlKey: URL_KEY, parentRef: 'LIN-1' });
    assert.deepEqual(retry, [], 'a child with its ticket is not retried');
    assert.equal(fake.created.length, 1, 'the retry makes no second ticket');
  });

  test('2. a retry after a failed ref write finds the ticket by its mark and makes no second one', async () => {
    await fresh();
    const parent = await parentTask();
    // A fault after the claim: the ticket is claimed for the child, then the store's revise is lost.
    let loseNextRevise = true;
    const realRevise = rh.store.revise.bind(rh.store);
    rh.store.revise = async (...args) => {
      if (loseNextRevise) { loseNextRevise = false; throw new Error('the write was lost'); }
      return realRevise(...args);
    };
    const { record, ticket } = await childTask(parent, 'write the migration');
    assert.equal(ticket.identifier, 'LIN-101', 'the ticket was made');
    assert.match(ticket.error, /ref did not write/);
    assert.equal(ticket.retryable, true);
    assert.equal(await refOf(record.id), null, 'the child has no ref yet');
    assert.equal(await rh.store.claimOf(URL_KEY, 'LIN-101'), record.id, 'the failed write left the claim on this child');

    const retry = await writes.retryChildTickets({ urlKey: URL_KEY, parentRef: 'LIN-1' });
    assert.deepEqual(retry, [{ task: record.id, identifier: 'LIN-101' }], 'the retry takes the ticket it finds by its mark');
    assert.equal(fake.created.length, 1, 'no second ticket was made');
    assert.equal(await refOf(record.id), 'LIN-101');
  });

  test('3. a child ticket another task holds is refused and named, never taken', async () => {
    await fresh();
    const parent = await parentTask();
    fake.knobs.createFails = 'the tracker is down';
    const { record, ticket } = await childTask(parent, 'write the migration');
    assert.match(ticket.error, /the tracker is down/);
    assert.equal(await refOf(record.id), null);

    // A ticket carries this child's mark, and another task already holds it.
    fake.issues.set('LIN-50', { identifier: 'LIN-50', title: 'Other', description: taskMarkOf(record.id), parent: { identifier: 'LIN-1' }, state: { name: 'Todo', type: 'unstarted' } });
    const other = await writes.add({ urlKey: URL_KEY, kind: 'task', input: { ref: 'LIN-50', 'done-when': 'another task' }, by: BY });
    assert.ok(!other.problems);
    fake.knobs.createFails = null;

    const retry = await writes.retryChildTickets({ urlKey: URL_KEY, parentRef: 'LIN-1' });
    assert.equal(retry.length, 1);
    assert.match(retry[0].error, new RegExp(`LIN-50 carries this task's mark but belongs to ${other.record.id}`));
    assert.equal(await refOf(record.id), null, 'the child did not take the other task\'s ticket');
    assert.equal(await rh.store.claimOf(URL_KEY, 'LIN-50'), other.record.id, 'ownership of LIN-50 is unchanged');
    assert.equal(fake.created.length, 0);
  });

  test('4. a capped, unknown or failed children read creates nothing', async () => {
    await fresh();
    const parent = await parentTask();
    for (const [setup, reason] of [
      [() => { fake.knobs.childrenCapped = true; }, /capped/],
      [() => { fake.knobs.childrenCapped = null; }, /capped, or the tracker does not say/],
      [() => { fake.knobs.childrenRead = 'throws'; }, /could not be read/]
    ]) {
      fake.knobs.childrenCapped = false;
      fake.knobs.childrenRead = 'ok';
      setup();
      const { record, ticket } = await childTask(parent, 'a child under a read that is not whole');
      assert.match(ticket.error, reason);
      assert.equal(await refOf(record.id), null);
    }
    assert.equal(fake.created.length, 0, 'no ticket was made on any of the three reads');
  });

  test('5. a tracker that cannot parent-link, and a parent with no ticket, create nothing and say why', async () => {
    await fresh();
    const parent = await parentTask();
    fake.knobs.canParentLink = false;
    const unlinked = await childTask(parent, 'on a tracker that cannot link');
    assert.match(unlinked.ticket.error, /cannot link a child ticket to LIN-1; none made/);
    fake.knobs.canParentLink = true;

    const root = await writes.add({ urlKey: URL_KEY, kind: 'task', input: { 'done-when': 'a task with no ticket' }, by: BY });
    const orphan = await childTask(root.record.id, 'under a task with no ticket');
    assert.match(orphan.ticket.error, /has no ticket, so a child ticket has nothing to link to/);
    assert.equal(fake.created.length, 0);
  });

  test('6. an import makes no ticket and posts no summary', async () => {
    await fresh();
    const parent = await parentTask();
    const imported = await writes.add({ urlKey: URL_KEY, kind: 'task', input: { in: parent, 'done-when': 'imported child' }, by: 'import', via: 'import' });
    assert.ok(!imported.problems);
    assert.equal('ticket' in imported, false, 'an import answers with no ticket step');
    const plan = await writes.add({ urlKey: URL_KEY, kind: 'plan', input: { in: parent, says: 'An imported plan.', to: 'implementation' }, by: 'import', via: 'import' });
    assert.ok(!plan.problems);
    assert.equal('summary' in plan, false, 'an import posts no summary');
    assert.equal(fake.created.length, 0);
    assert.equal(fake.comments.length, 0);
    assert.equal(fake.attempts.comment, 0);
    assert.equal(fake.attempts.createChild, 0);
  });

  test('7. a plan posts one marked summary per version, with its reason', async () => {
    await fresh();
    const parent = await parentTask();
    const added = await writes.add({ urlKey: URL_KEY, kind: 'plan', input: { in: parent, says: 'Build the thing in two steps.', to: 'implementation' }, by: 'design' });
    assert.equal(added.summary.posted, true);
    assert.equal(added.summary.v, 1);
    assert.equal(fake.comments.length, 1);
    assert.equal(fake.comments[0].ref, 'LIN-1');
    assert.ok(fake.comments[0].body.startsWith(summaryOpeningOf(added.record.id, 1) + '\n'), fake.comments[0].body);
    assert.match(fake.comments[0].body, /First version\.[\s\S]*Build the thing in two steps\./);

    const revised = await writes.revise({ urlKey: URL_KEY, id: added.record.id, input: { says: 'Build it in three steps.', reason: 'review asked for a third step' }, by: 'design' });
    assert.equal(revised.summary.posted, true);
    assert.equal(fake.comments.length, 2, 'one summary for v1, one for v2');
    assert.ok(fake.comments[1].body.startsWith(summaryOpeningOf(added.record.id, 2) + '\n'));
    assert.match(fake.comments[1].body, /Revised: review asked for a third step/);
    assert.match(fake.comments[1].body, /Build it in three steps\./);
  });

  test('8. a failed summary post is named in the answer and is never retried into a duplicate', async () => {
    await fresh();
    const parent = await parentTask();
    fake.knobs.commentFails = true;
    const added = await writes.add({ urlKey: URL_KEY, kind: 'plan', input: { in: parent, says: 'A plan the tracker refuses to show.', to: 'implementation' }, by: 'design' });
    assert.ok(!added.problems, 'the plan is written even though its summary is not');
    assert.equal(added.record.kind, 'plan');
    assert.match(added.summary.error, /was not posted .* it is not retried/);
    assert.equal(fake.attempts.comment, 1);
    // Later writes on the same parent do not post the summary again.
    fake.knobs.commentFails = false;
    await childTask(parent, 'a later child');
    await writes.retryChildTickets({ urlKey: URL_KEY, parentRef: 'LIN-1' });
    assert.equal(fake.attempts.comment, 1, 'nothing re-posts the summary');
    assert.equal(fake.comments.length, 0);
  });

  test('9. the retry on a parent dispatch makes the ticket a failed create did not', async () => {
    await fresh();
    const parent = await parentTask();
    fake.knobs.createFails = 'the tracker is busy';
    const { record, ticket } = await childTask(parent, 'created while the tracker was busy');
    assert.match(ticket.error, /busy/);
    assert.equal(fake.created.length, 0);
    fake.knobs.createFails = null;
    const retry = await writes.retryChildTickets({ urlKey: URL_KEY, parentRef: 'LIN-1' });
    assert.deepEqual(retry, [{ task: record.id, identifier: 'LIN-101' }]);
    assert.equal(await refOf(record.id), 'LIN-101');
    assert.equal(fake.created.length, 1);
  });

  test('10. a summary is not a person\'s comment nor a plan comment, even with an Implementation Plan heading', async () => {
    const summary = `${summaryOpeningOf('plan-1a2b3c4d', 1)}\n\nFirst version.\n\n## Implementation Plan\n\n**Session fit:** needs multiple sessions.\n\nplan-review due: yes`;
    assert.equal(isHarbourSummary(summary), true);
    assert.equal(commentKindOf(summary), 'harbour-summary');
    assert.equal(isPersonComment(summary), false);
    assert.equal(isPlanComment(summary), false);
    assert.deepEqual(withoutHarbourSummaries([{ body: summary }, { body: 'A person\'s reply.' }]).map((c) => c.body), ['A person\'s reply.']);

    const comments = [{ body: summary, createdAt: '2026-11-20T10:00:00Z', user: { name: 'Harbour' } }];
    const facts = assembleTrailFacts(comments, 'A description with no plan in it.', { leaf: true });
    assert.equal(facts.latestPerson, null, 'a summary is not the latest person comment');
    assert.equal(facts.plan.where, null, 'a summary is not the selected plan');
    assert.equal(facts.plan.sessionFit, null);
    assert.equal(facts.plan.planReviewDue, null);

    // A near miss is not a summary: the mark must open the comment, and be the whole first line.
    assert.equal(isHarbourSummary(`A note that quotes ${summaryOpeningOf('plan-1a2b3c4d', 1)}`), false);
    assert.equal(isHarbourSummary(`Intro\n${summaryOpeningOf('plan-1a2b3c4d', 1)}`), false);
  });

  test('11. the route refuses a plan addressed elsewhere, naming both, and answers a child\'s ticket', async () => {
    await fresh();
    const parent = await parentTask();
    const runId = 'row-impl-4503';
    await rh.store.openRun(URL_KEY, { id: runId, stage: 'design', lineage: runId, at: '2026-11-20T11:00:00.000Z' });
    const token = await rh.mintRunToken(runId);
    const elsewhere = await rh.post('/api/proxy/records', token, { kind: 'plan', in: parent, says: 'A plan for the review.', to: 'plan-review', run: runId });
    assert.equal(elsewhere.status, 422);
    assert.match(elsewhere.body.error, /implementation \(it fits one session\) or breakdown/);
    assert.match(elsewhere.body.error, /'plan-review' is neither/);
    const none = await rh.post('/api/proxy/records', token, { kind: 'plan', in: parent, says: 'A plan with no addressee.', run: runId });
    assert.equal(none.status, 422);

    const planned = await rh.post('/api/proxy/records', token, { kind: 'plan', in: parent, says: 'A one-session plan.', to: 'implementation', run: runId });
    assert.equal(planned.status, 201);
    assert.equal(planned.body.summary.posted, true);
    const planId = planned.body.id;

    const revisedElsewhere = await rh.post(`/api/proxy/records/${planId}/revise`, token, { to: 'project', reason: 'moved', says: 'x', run: runId });
    assert.equal(revisedElsewhere.status, 422);

    const child = await rh.post('/api/proxy/records', token, { kind: 'task', in: parent, 'done-when': 'a child the agent made', run: runId });
    assert.equal(child.status, 201);
    assert.equal(child.body.ticket.identifier, 'LIN-101', 'the answer names the ticket Harbour made');
    assert.equal(fake.created.length, 1);
  });

  test('12. the importer only adds plans: revise takes no via, and the importer never revises', async () => {
    const applyWrites = readFileSync(new URL('../../lib/records/import-apply.js', import.meta.url), 'utf8');
    assert.doesNotMatch(applyWrites, /writes\.revise\(/, 'the import applies adds only');
    assert.match(applyWrites, /writes\.add\(\{[^}]*via: 'import'/);
    const pipeline = readFileSync(new URL('../../lib/records/writes.js', import.meta.url), 'utf8');
    const reviseSignature = /async revise\(\{([^}]*)\}\)/.exec(pipeline);
    assert.ok(reviseSignature, 'revise is one method with one argument object');
    assert.doesNotMatch(reviseSignature[1], /\bvia\b/, 'a revise has no via, so a plan revision always posts its summary');
  });

  test('13. a child ticket is filed under its parent on the real local provider, and reads back as the parent\'s child', async () => {
    const db = harness.freshDb();
    localProvider.configure({ store: new LocalStore({ collection: db.collection('local-issues') }) });
    const parentIssue = await localProvider.createIssue(URL_KEY, { title: 'Local parent', description: 'Local parent words.' });
    const local = trackerPortOf({ provider: localProvider, scope: URL_KEY });
    assert.equal(local.canParentLink(), true, 'the local provider writes parentId');
    const listed = await local.childrenOf(parentIssue.identifier);
    assert.deepEqual(listed, { children: [], capped: false }, 'the local children read is whole');

    fake = createFakeTracker({ tickets: [] });
    rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets: new Map(), people: PEOPLE, readTicket: async (_c, ref) => localProvider.issueDetail(URL_KEY, ref), tracker: () => local });
    writes = createRecordWrites({ recordsStore: rh.store, isTerminalState, readTicket: async (_c, ref) => localProvider.issueDetail(URL_KEY, ref), askedText: () => '', stageKinds: STAGES, listPeople: async () => PEOPLE, tracker: () => local });

    const parent = (await writes.add({ urlKey: URL_KEY, kind: 'task', input: { ref: parentIssue.identifier, 'done-when': 'local parent done' }, by: BY })).record.id;
    const child = await writes.add({ urlKey: URL_KEY, kind: 'task', input: { in: parent, 'done-when': 'a local child' }, by: BY });
    assert.ok(!child.problems, JSON.stringify(child.problems));
    assert.match(child.ticket.identifier, /^LOCAL-\d+$/);
    const readBack = await localProvider.issueDetail(URL_KEY, child.ticket.identifier);
    assert.equal(readBack.parent.identifier, parentIssue.identifier, 'the ticket is filed under the parent');
    assert.equal(markedTaskOf(readBack.description), child.record.id, 'its description carries the task mark');
    const whole = await local.childrenOf(parentIssue.identifier);
    assert.deepEqual(whole.children, [child.ticket.identifier]);

    const plan = await writes.add({ urlKey: URL_KEY, kind: 'plan', input: { in: parent, says: 'The local plan.', to: 'implementation' }, by: 'design' });
    assert.equal(plan.summary.posted, true);
    const comments = await localProvider.fetchIssueComments(URL_KEY, parentIssue.id);
    assert.ok(comments.some((c) => c.body.startsWith(summaryOpeningOf(plan.record.id, 1) + '\n')), 'the summary is a comment on the parent ticket');
  });

  test('15. a fresh dispatch of a ticket retries its children through the dispatch\'s own access, and a failing retry never refuses the dispatch', async () => {
    // The seat: after the refusal guards, the dispatch's access (its provider and token) is the tracker the retry runs under.
    const added = [];
    const store = { addItem: async (urlKey, item) => { added.push({ urlKey, item }); return { _id: 'item-1', ...item }; } };
    // A provider that reads issues (the seat's own test for an access): its description is empty, so the seal does nothing.
    const access = { provider: { name: 'fake', issueDescription: async () => '' }, token: 'tok-dispatch' };
    const calls = [];
    const childTickets = async (urlKey, parent, given) => { calls.push({ urlKey, parent, given }); return [{ task: 'task-x', identifier: 'LIN-9' }]; };
    await createDispatchItem({ store, urlKey: URL_KEY, kind: 'implementation', prompt: 'x', fields: { issueIdentifier: 'LIN-1' }, issueAccess: async () => access, childTickets });
    assert.equal(added.length, 1, 'the dispatch is enqueued');
    assert.deepEqual(calls.map((c) => [c.urlKey, c.parent, c.given]), [[URL_KEY, 'LIN-1', access]]);

    // A follow-up beat is not a fresh dispatch: no retry.
    await createDispatchItem({ store, urlKey: URL_KEY, kind: 'implementation', prompt: 'x', fields: { issueIdentifier: 'LIN-1', followUpTo: 'item-1' }, issueAccess: async () => access, childTickets });
    assert.equal(calls.length, 1);

    // No access: no tracker call at all.
    await createDispatchItem({ store, urlKey: URL_KEY, kind: 'implementation', prompt: 'x', fields: { issueIdentifier: 'LIN-2' }, childTickets });
    assert.equal(calls.length, 1);

    // A retry that throws is logged, and the dispatch is still enqueued.
    const throwing = async () => { throw new Error('the tracker is gone'); };
    const logged = [];
    const realLog = console.log;
    console.log = (...args) => { logged.push(args.join(' ')); };
    try {
      const item = await createDispatchItem({ store, urlKey: URL_KEY, kind: 'implementation', prompt: 'x', fields: { issueIdentifier: 'LIN-3' }, issueAccess: async () => access, childTickets: throwing });
      assert.equal(item.kind, 'implementation');
    } finally {
      console.log = realLog;
    }
    assert.ok(logged.some((l) => /child-ticket retry failed: the tracker is gone \(URL_KEY LIN-3\)|child-ticket retry failed: the tracker is gone/.test(l)), logged.join('\n'));
    assert.equal(added.length, 4, 'all four dispatches above were enqueued; the failing retry refused none');
  });

  test('14. a ticket mark names its task exactly', async () => {
    assert.equal(markedTaskOf(taskMarkOf('task-12')), 'task-12');
    assert.equal(markedTaskOf(childTicketDescriptionOf({ parentRef: 'LIN-1', taskId: 'task-12', doneWhen: 'x' })), 'task-12');
    assert.notEqual(markedTaskOf(taskMarkOf('task-1')), 'task-12', 'task-1 is not task-12');
    assert.equal(markedTaskOf('No mark here, only a task-12 mention.'), null);
    assert.equal(markedTaskOf(`text\n  ${taskMarkOf('task-7')}  `), 'task-7', 'a mark is found on its own line, whitespace aside');
    const stub = childTicketDescriptionOf({ parentRef: 'LIN-1', taskId: ticketTaskIdOf('LIN-9'), piece: 'plan-abcd1234', doneWhen: 'the done words' });
    assert.match(stub, /\*\*Piece:\*\* plan-abcd1234/);
    assert.match(stub, /\*\*Done when:\*\* the done words/);
    assert.doesNotMatch(stub, /## Implementation Plan/, 'a stub copies no plan text');
  });
});
