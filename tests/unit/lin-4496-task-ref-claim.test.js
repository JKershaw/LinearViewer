/**
 * LIN-4496 (piece 5 of LIN-4491): a task written with a ticket `ref` is the ticket's one task. Before this piece a task
 * write with a `ref` was stored without its ticket claim (lib/records-store.js ensureTask makes the claim, the write path
 * did not), so a later `in` or `to` naming the ticket made a second task for it, and the walk-8 replay's ask to a parent
 * landed on that second task. The write now claims the ticket as ensureTask does (lib/records/writes.js).
 *
 * Witnesses, through the proxy routes on a real store:
 *   - a task written with a ticket ref claims that ticket, and a later `in` naming the ticket lands in that task;
 *   - a second task write for the same ticket is refused, naming the task that already has it;
 *   - a ticket that already has its task (made by a reference first) is refused the same way;
 *   - a `to` naming the ticket finds the task the ticket claimed, and makes no second one.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';

const URL_KEY = 'lin-4496-task-ref';
const harness = createMangoTmpdir('lin-4496-task-ref-');
const tickets = new Map([
  ['LIN-7001', { identifier: 'LIN-7001', title: 'Claimed by a task write', description: 'A ticket.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  ['LIN-7002', { identifier: 'LIN-7002', title: 'Claimed by a reference', description: 'A ticket.', state: { name: 'In Progress', type: 'started' }, parent: null }]
]);
let rh;
let run;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets, people: [] });
  await rh.store.openRun(URL_KEY, { id: 'run-breakdown', stage: 'breakdown', lineage: 'lineage-breakdown' });
  run = { token: await rh.mintRunToken('run-breakdown'), runId: 'run-breakdown' };
});
afterEach(async () => { await rh.close(); });

const taskBody = (ref) => ({ kind: 'task', ref, asked: 'The person\'s words.', 'done-when': 'It is done.', run: run.runId });
const tasksWithRef = async (ref) => (await rh.store.find(URL_KEY, { kind: 'task' })).filter((t) => t.fields?.ref === ref);

describe('a task written with a ticket ref is the ticket\'s one task (LIN-4496)', () => {
  test('the task write claims its ticket: a later `in` naming the ticket lands in that task, and no second task is made', async () => {
    const made = await rh.post('/api/proxy/records', run.token, taskBody('LIN-7001'));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const finding = await rh.post('/api/proxy/records', run.token, { kind: 'finding', in: 'LIN-7001', to: 'project', says: 'A finding under the ticket.', how: 'read it', run: run.runId });
    assert.equal(finding.status, 201, JSON.stringify(finding.body));
    assert.equal(finding.body.in, made.body.id, 'the finding is in the task the write made');
    assert.equal((await tasksWithRef('LIN-7001')).length, 1, 'one task for the ticket');
  });

  test('a second task write for a ticket that already has its task is refused, naming the task', async () => {
    const first = await rh.post('/api/proxy/records', run.token, taskBody('LIN-7001'));
    assert.equal(first.status, 201);
    const second = await rh.post('/api/proxy/records', run.token, taskBody('LIN-7001'));
    assert.equal(second.status, 422, JSON.stringify(second.body));
    assert.equal(second.body.problems[0].field, 'ref');
    assert.deepEqual(second.body.problems[0].works, [first.body.id], 'the refusal names the task that holds the ticket');
    assert.equal((await tasksWithRef('LIN-7001')).length, 1, 'the refused write made no task');
  });

  test('a ticket that already has its task, made by a reference first, is refused the same way', async () => {
    const finding = await rh.post('/api/proxy/records', run.token, { kind: 'finding', in: 'LIN-7002', to: 'project', says: 'Made by a reference.', how: 'read it', run: run.runId });
    assert.equal(finding.status, 201, JSON.stringify(finding.body));
    const [task] = await tasksWithRef('LIN-7002');
    assert.ok(task, 'the reference made the task');
    const write = await rh.post('/api/proxy/records', run.token, taskBody('LIN-7002'));
    assert.equal(write.status, 422, JSON.stringify(write.body));
    assert.deepEqual(write.body.problems[0].works, [task.id]);
    assert.equal((await tasksWithRef('LIN-7002')).length, 1);
  });

  test('a `to` naming a claimed ticket finds its task: the hand-off is addressed to that task and no second task appears', async () => {
    const made = await rh.post('/api/proxy/records', run.token, taskBody('LIN-7001'));
    assert.equal(made.status, 201);
    const ask = await rh.post('/api/proxy/records', run.token, { kind: 'question', to: 'LIN-7001', asks: 'Which way?', options: ['a', 'b'], recommended: 'a', 'if-unanswered': 'a', run: run.runId });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    assert.equal(ask.body.to, made.body.id, 'addressed to the task the ticket claimed');
    assert.equal((await tasksWithRef('LIN-7001')).length, 1);
  });
});

describe('a task revised to a ticket ref claims it too (LIN-4496, finding 869357bd)', () => {
  test('revise-to-ref then `in` naming the ticket lands in the revised task, and one task carries the ref', async () => {
    const made = await rh.post('/api/proxy/records', run.token, { kind: 'task', asked: 'The person\'s words.', 'done-when': 'It is done.', run: run.runId });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const rev = await rh.post(`/api/proxy/records/${made.body.id}/revise`, run.token, { ref: 'LIN-7001', reason: 'the ticket is known now', run: run.runId });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));
    const finding = await rh.post('/api/proxy/records', run.token, { kind: 'finding', in: 'LIN-7001', to: 'project', says: 'A finding under the revised task.', how: 'read it', run: run.runId });
    assert.equal(finding.status, 201, JSON.stringify(finding.body));
    assert.equal(finding.body.in, made.body.id, 'the finding is in the task that was revised');
    assert.equal((await tasksWithRef('LIN-7001')).length, 1, 'one task for the ticket');
  });

  test('revising a task to a ticket another task already holds is refused, naming that task, and changes nothing', async () => {
    const holder = await rh.post('/api/proxy/records', run.token, taskBody('LIN-7002'));
    assert.equal(holder.status, 201, JSON.stringify(holder.body));
    const other = await rh.post('/api/proxy/records', run.token, { kind: 'task', asked: 'Another task.', 'done-when': 'It is done.', run: run.runId });
    assert.equal(other.status, 201);
    const rev = await rh.post(`/api/proxy/records/${other.body.id}/revise`, run.token, { ref: 'LIN-7002', reason: 'wrong guess', run: run.runId });
    assert.equal(rev.status, 422, JSON.stringify(rev.body));
    assert.deepEqual(rev.body.problems[0].works, [holder.body.id], 'the refusal names the task that holds the ticket');
    assert.equal((await tasksWithRef('LIN-7002')).length, 1, 'the refused revise left the other task without the ref');
  });
});
