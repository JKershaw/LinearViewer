/**
 * LIN-4493 (piece 2): the records contract, ported from the round 9 model's test (layer/walks/9/model/test.mjs,
 * 52 cases, a reference and not the source). Its shape refusals, commands, views and brief parts are re-written
 * against the Harbour modules: lib/records/check.js (shape), views.js (views), brief.js (brief parts), with
 * lib/records-store.js (versions) on a real MangoDB engine, so every snapshot is a stored one.
 *
 * What changed from round 9, by decision: `by` is never a body field (it comes from the credential); a link may
 * sit beside the fields or under `links`; `on` takes a bare id, pinned to the current version; `to` names a
 * reader Harbour can brief (no actor list), with the names that would work in each refusal; `into` may name the
 * record that took over on any end.
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { checkAdd, checkRevise, checkEnd, checkLink, refusalOf, resolveTo, KINDS } from '../../lib/records/check.js';
import { index as buildIndex, viewOf } from '../../lib/records/views.js';
import { buildBrief } from '../../lib/records/brief.js';

const URL_KEY = 'contract-workspace';
const STAGES = ['design', 'plan-review', 'breakdown', 'survey-task', 'survey-place', 'scoping', 'implementation', 'leftover', 'review', 'blind-read', 'close-out', 'autopilot'];
const PEOPLE = [{ accountId: 'acc-john', name: 'John' }];
const at = (m) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString();

const harness = createMangoTmpdir('lin-4493-contract-');
let db;
let store;
let minute = 0;
let idx;

before(() => harness.connect());
after(() => harness.close());

async function refresh() {
  idx = buildIndex(await store.snapshots(URL_KEY));
}
function ctx(now = idx) {
  return {
    addressees: { stages: STAGES, people: PEOPLE },
    resolve(ref) {
      const s = now.at(ref);
      return s ? { kind: s.kind, id: ref } : null;
    },
    currentVersion: (id) => now.currentVersion(id),
    versionExists: (id, v) => Boolean(now.versionOf(id, v)),
  };
}

/** A write as the proxy makes it: check, then store. Returns the stored version or the 422 problems. */
async function write(kind, body, by = 'implementation') {
  const { problems, record } = checkAdd(kind, body, ctx());
  if (problems.length) return { problems };
  const snap = await store.add(URL_KEY, record, { by, at: at(++minute) });
  await refresh();
  return snap;
}
const add = async (kind, body, by) => {
  const r = await write(kind, body, by);
  assert.ok(!r.problems, JSON.stringify(r.problems));
  return r.id;
};
async function revise(id, body, by = 'implementation') {
  const prev = idx.at(id);
  const { problems, changes } = checkRevise(prev, body, ctx());
  if (problems.length) return { problems };
  const snap = await store.revise(URL_KEY, id, changes, { by, at: at(++minute), reason: body.reason });
  await refresh();
  return snap;
}
async function end(id, body, by = 'implementation') {
  const prev = idx.at(id);
  if (prev.ended) return { record: prev, changed: false };
  const { problems } = checkEnd(prev, body, ctx());
  if (problems.length) return { problems };
  const out = await store.end(URL_KEY, id, body, { by, at: at(++minute) });
  await refresh();
  return out;
}
const refused = (problems, field) => {
  assert.ok(problems && problems.length, 'expected a refusal');
  if (field) assert.ok(problems.some((p) => p.field === field), `a problem on ${field}: ${JSON.stringify(problems)}`);
  return problems;
};

beforeEach(async () => {
  minute = 0;
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION), now: () => new Date(at(0)) });
  await refresh();
});

describe('shape: what a write may hold (check.js)', () => {
  test('refuses an undeclared kind, and the run kind (Harbour opens runs)', () => {
    const { problems } = checkAdd('widget', {}, ctx());
    assert.match(problems[0].message, /kind 'widget' is not a kind a write may add/);
    assert.ok(checkAdd('run', { stage: 'x' }, ctx()).problems.length > 0);
  });

  test('a field of another kind names the kind it belongs to', () => {
    const { problems } = checkAdd('finding', { to: 'review', asks: 'x' }, ctx());
    refused(problems, 'asks');
    assert.match(problems[0].message, /belongs to question/);
  });

  test('a field of the wrong type names the type', async () => {
    const { problems } = checkAdd('plan', { says: 'x', order: '1' }, ctx());
    assert.match(problems[0].message, /'order' of plan must be a number/);
  });

  test('links beside the fields are accepted, as are links under links', async () => {
    const t = await add('task', { asked: 'Make the footer show runs left.', 'done-when': 'shows N' }, 'John');
    const c = await add('change', { in: t, ref: 'https://github.com/acme/widget/pull/9', head: 'abc' });
    const flat = checkAdd('finding', { in: t, to: 'review', says: 'x', about: [c] }, ctx());
    assert.deepEqual(flat.problems, []);
    assert.deepEqual(flat.record.links, { about: [c] });
    const nested = checkAdd('finding', { in: t, to: 'review', says: 'x', links: { about: c } }, ctx());
    assert.deepEqual(nested.problems, []);
    assert.deepEqual(nested.record.links, { about: [c] });
  });

  test("'to' under links is refused, and says it belongs at the top level", () => {
    const { problems } = checkAdd('finding', { says: 'x', links: { to: 'review' } }, ctx());
    assert.ok(problems.some((p) => /'to' is not a link type/.test(p.message)), JSON.stringify(problems));
  });

  test('a hand-off without a to is refused, naming the readers that would work', () => {
    const { problems } = checkAdd('finding', { says: 'x' }, ctx());
    const p = refused(problems, 'to');
    assert.ok(p[0].works.includes('project') && p[0].works.includes('review'));
  });

  test('a to Harbour cannot brief is refused naming the names that work', () => {
    const { problems } = checkAdd('finding', { says: 'x', to: 'nobody' }, ctx());
    const p = refused(problems, 'to');
    assert.match(p[0].message, /'nobody' is not a reader Harbour can brief/);
    assert.ok(p[0].works.includes('John') && p[0].works.includes('leftover'));
  });

  test('a named person resolves to person:<accountId>; a person id not in the workspace is refused', () => {
    assert.deepEqual(resolveTo('John', ctx()), { value: 'person:acc-john' });
    assert.deepEqual(resolveTo('person:acc-john', ctx()), { value: 'person:acc-john' });
    assert.match(resolveTo('person:acc-x', ctx()).problem.message, /not a person in this workspace/);
  });

  test('a stage, leftover and project are readers; an unknown stage is not', () => {
    for (const to of ['review', 'leftover', 'project']) assert.deepEqual(resolveTo(to, ctx()), { value: to });
    assert.ok(resolveTo('survey-tsk', ctx()).problem);
  });

  test('`in` must name a task, and an unresolved link names what is wrong', async () => {
    const c = await add('change', { ref: 'https://github.com/acme/widget/pull/9', head: 'abc' });
    refused(checkAdd('lesson', { says: 'x', in: c }, ctx()).problems, 'in');
    refused(checkAdd('lesson', { says: 'x', about: ['task-99'] }, ctx()).problems, 'about');
  });

  test("answers joins a decision to a question, and a finding cannot carry it", async () => {
    const q = await add('question', { asks: 'Which?', to: 'John' }, 'implementation');
    refused(checkAdd('finding', { says: 'x', to: 'review', answers: q }, ctx()).problems, 'answers');
    const d = checkAdd('decision', { answer: 'a', why: 'simpler', answers: q }, ctx());
    assert.deepEqual(d.problems, []);
  });

  test('a verdict needs an on, and its outcome must be in its judgement\'s set', async () => {
    const c = await add('change', { ref: 'https://github.com/acme/widget/pull/9', head: 'abc' });
    refused(checkAdd('verdict', { judgement: 'review', outcome: 'approve' }, ctx()).problems, 'on');
    refused(checkAdd('verdict', { judgement: 'review', outcome: 'better', on: [c] }, ctx()).problems, 'outcome');
    refused(checkAdd('verdict', { judgement: 'vibes', outcome: 'approve', on: [c] }, ctx()).problems, 'judgement');
    assert.deepEqual(checkAdd('verdict', { judgement: 'blind-read', outcome: 'better', on: [c] }, ctx()).problems, []);
  });

  test('a bare on id is pinned to the change\'s current version; an unknown version is refused', async () => {
    const c = await add('change', { ref: 'https://github.com/acme/widget/pull/9', head: 'abc' });
    const pinned = checkAdd('verdict', { judgement: 'review', outcome: 'approve', on: c }, ctx());
    assert.deepEqual(pinned.record.links.on, [`${c}@1`]);
    await revise(c, { head: 'def', reason: 'new head' }, 'implementation');
    const again = checkAdd('verdict', { judgement: 'review', outcome: 'approve', on: c }, ctx());
    assert.deepEqual(again.record.links.on, [`${c}@2`]);
    refused(checkAdd('verdict', { judgement: 'review', outcome: 'approve', on: `${c}@9` }, ctx()).problems, 'on');
  });

  test('a plan link must point to a plan; a piece joins a task to a plan', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    refused(checkAdd('task', { asked: 'y', piece: t }, ctx()).problems, 'piece');
  });

  test('a refusal names every problem at once', () => {
    const { problems } = checkAdd('finding', { says: 1, asks: 'x', to: 'nobody', links: { nope: 'x' } }, ctx());
    assert.ok(problems.length >= 4, JSON.stringify(problems));
    const body = refusalOf(problems);
    assert.equal(body.problems.length, problems.length);
    assert.match(body.error, /problems:/);
  });

  test('a task\'s asked does not change once written; a revise needs a reason', async () => {
    const t = await add('task', { asked: 'The person\'s words.' }, 'John');
    refused((await revise(t, { asked: 'other', reason: 'x' })).problems, 'asked');
    assert.equal((await revise(t, { asked: 'The person\'s words.', reason: 'same words' })).v, 2);
    refused((await revise(t, { 'done-when': 'x' })).problems, 'reason');
  });

  test('a revise removes a field on null, and a version keeps the reason', async () => {
    const f = await add('finding', { says: 'x', how: 'run it', to: 'review' }, 'review');
    const snap = await revise(f, { how: null, reason: 'nothing to run' }, 'review');
    assert.equal('how' in snap.fields, false);
    assert.equal(snap.reason, 'nothing to run');
  });

  test('a link call adds to a list and only checks, never removes', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    const c = await add('change', { ref: 'https://github.com/acme/widget/pull/9', head: 'abc' });
    assert.deepEqual(checkLink(idx.at(t), { about: c }, ctx()).links, { about: [c] });
  });
});

describe('ends (check.js and the store)', () => {
  test('an end is one of the kind\'s ends, with a reason; a takeover needs into', async () => {
    const f = await add('finding', { says: 'x', to: 'review' }, 'review');
    refused((await end(f, { state: 'merged', reason: 'x' })).problems, 'state');
    refused((await end(f, { state: 'done', reason: '' })).problems, 'reason');
    refused((await end(f, { state: 'handed-on', reason: 'moved' })).problems, 'into');
  });

  test('into may name the record that took over on any end; it must resolve', async () => {
    const f = await add('finding', { says: 'x', to: 'project' }, 'review');
    const g = await add('finding', { says: 'y', to: 'project' }, 'review');
    refused((await end(f, { state: 'done', reason: 'x', into: 'finding-nope' })).problems, 'into');
    const out = await end(f, { state: 'done', reason: 'settled', into: g }, 'close-out');
    assert.equal(out.record.ended.into, g);
  });

  test('ending a record already in an end returns it unchanged, with who ended it', async () => {
    const f = await add('finding', { says: 'x', to: 'project' }, 'review');
    await end(f, { state: 'done', reason: 'settled' }, 'close-out');
    const again = await end(f, { state: 'declined', reason: 'later' }, 'John');
    assert.equal(again.changed, false);
    assert.equal(again.record.state, 'done');
  });

  test('a run ends on its terminal, and its account is kept', async () => {
    const run = await store.openRun(URL_KEY, { id: 'row-1', stage: 'implementation', lineage: 'row-1', taskId: null, at: at(1) });
    assert.equal(run.state, 'open');
    const done = await store.endRun(URL_KEY, 'row-1', { state: 'done', account: 'Built it.' });
    assert.equal(done.fields.account, 'Built it.');
  });
});

describe('views (views.js)', () => {
  test('a question with a standing decision that answers it shows the decision beside it', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    const q = await add('question', { in: t, to: 'John', asks: 'Which footer?', options: ['a', 'b'], recommended: 'a' }, 'implementation');
    const d = await add('decision', { in: t, answer: 'a', why: 'simpler', answers: q }, 'John');
    const view = viewOf(idx.at(q), idx);
    assert.deepEqual(view.flags.answered, { by: d, answer: 'a' });
  });

  test('a verdict is stale when its change was revised after the verdict read it', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    const c = await add('change', { in: t, ref: 'https://github.com/acme/widget/pull/9', head: 'abc' }, 'implementation');
    const v = await add('verdict', { in: t, judgement: 'review', outcome: 'approve', reasoning: 'fine', on: `${c}@1` }, 'review');
    await revise(c, { head: 'def', reason: 'new head' }, 'implementation');
    assert.deepEqual(viewOf(idx.at(v), idx).flags.stale, [`on ${c}@1, now @2`]);
  });

  test('a verdict on a plan that was superseded is stale, naming the record that took over', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    const p1 = await add('plan', { in: t, says: 'Old.', order: 1 }, 'design');
    const v = await add('verdict', { in: t, judgement: 'plan-review', outcome: 'approve', reasoning: 'ok', on: p1 }, 'plan-review');
    const p2 = await add('plan', { in: t, says: 'New.', order: 1, to: 'implementation' }, 'design');
    await end(p1, { state: 'superseded', reason: 'rewritten', into: p2 }, 'design');
    assert.match(viewOf(idx.at(v), idx).flags.stale[0], /on plan-\w+@1: target superseded into plan-\w+/);
  });

  test('not stale as of a time before the revise', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    const c = await add('change', { in: t, ref: 'https://github.com/acme/widget/pull/9', head: 'abc' }, 'implementation');
    const v = await add('verdict', { in: t, judgement: 'review', outcome: 'approve', reasoning: 'fine', on: c }, 'review');
    const earlier = at(minute - 0);
    await revise(c, { head: 'def', reason: 'new head' }, 'implementation');
    const asOfEarlier = buildIndex(await store.snapshots(URL_KEY));
    assert.equal(viewOf(asOfEarlier.at(v, earlier), asOfEarlier, earlier).flags, undefined);
  });

  test('an open record under an ended task carries the flag', async () => {
    const t = await add('task', { asked: 'x' }, 'John');
    const child = await add('task', { in: t, asked: 'child' }, 'John');
    const f = await add('finding', { in: child, to: 'leftover', says: 'under an ended task' }, 'implementation');
    await end(child, { state: 'done', reason: 'finished' }, 'John');
    assert.equal(viewOf(idx.at(f), idx).flags['under-ended-task'], child);
  });
});

describe('the brief (brief.js, parts 1–8)', () => {
  async function scenario() {
    const t1 = await add('task', { asked: 'Make the footer show runs left.', 'done-when': 'footer shows N runs', ref: 'LIN-1' }, 'John');
    const plan2 = await add('plan', { in: t1, says: 'Old plan.', order: 1 }, 'design');
    const t3 = await add('task', { in: t1, 'done-when': 'child done', piece: plan2 }, 'breakdown');
    const c4 = await add('change', { in: t3, ref: 'https://github.com/acme/widget/pull/9', head: 'abc' }, 'implementation');
    const v5 = await add('verdict', { in: t3, judgement: 'review', outcome: 'approve', reasoning: 'fine', on: `${c4}@1` }, 'review');
    await revise(c4, { head: 'def', reason: 'new head' }, 'implementation');
    const plan7 = await add('plan', { in: t1, says: 'Para one.\n\nPara two.', order: 2, to: 'implementation' }, 'design');
    await end(plan2, { state: 'superseded', reason: 'rewritten', into: plan7 }, 'design');
    const q8 = await add('question', { in: t3, to: 'John', asks: 'Which footer?', options: ['a', 'b'], recommended: 'a' }, 'implementation');
    const d9 = await add('decision', { in: t3, answer: 'a', why: 'simpler', answers: q8 }, 'John');
    const d10 = await add('decision', { answer: 'Always ask before deleting.', why: 'standing direction', scope: 'project' }, 'John');
    const f11 = await add('finding', { in: t3, to: 'implementation', says: 'Fix the count.' }, 'review');
    const f12 = await add('finding', { in: t1, to: t3, says: 'Addressed to the task.' }, 'leftover');
    const r13 = await store.openRun(URL_KEY, { id: 'row-survey', stage: 'survey-task', taskId: t3, lineage: 'row-survey', at: at(++minute) });
    await store.endRun(URL_KEY, r13.id, { state: 'done', account: 'Found the footer.\nDetails follow.', at: at(++minute) });
    await refresh();
    const f14 = await add('finding', { in: t3, to: 'survey-task', says: 'Left behind.' }, 'scoping');
    const r15 = await store.openRun(URL_KEY, { id: 'row-review', stage: 'review', taskId: t1, lineage: 'row-review', at: at(++minute) });
    const r16 = await store.openRun(URL_KEY, { id: 'row-impl', stage: 'implementation', taskId: t3, lineage: 'row-impl', at: at(++minute) });
    await refresh();
    const f17 = await add('finding', { in: t3, to: 'review', says: 'Index me.\nSecond line.', how: 'read it' }, 'implementation');
    const l18 = await add('lesson', { says: 'The footer lives in lib/components.' }, 'close-out');
    const f19 = await add('finding', { to: 'project', says: 'Project-wide note.' }, 'autopilot');
    const t20 = await add('task', { in: t3, asked: 'A child a person wrote.' }, 'John');
    const f21 = await add('finding', { in: t20, to: 'leftover', says: 'Under an ended task.' }, 'implementation');
    await end(t20, { state: 'done', reason: 'finished' }, 'John');
    await refresh();
    return { t1, plan2, t3, c4, v5, plan7, q8, d9, d10, f11, f12, r13: r13.id, f14, r15: r15.id, r16: r16.id, f17, l18, f19, t20, f21 };
  }

  test('part 1: the task, its ref and done-when, and the asked of the task and each ancestor, verbatim', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    assert.equal(b.parts.task.id, s.t3);
    assert.deepEqual(b.parts.task.asked, [{ task: s.t1, asked: 'Make the footer show runs left.' }]);
  });

  test('part 2: the piece followed to its takeover; full to its addressee, first paragraph to others', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    const plan = b.parts.plan.find((p) => p.id === s.plan7);
    assert.ok(plan, 'the plan that took over is shown');
    assert.equal(plan.fields.says, 'Para one.\n\nPara two.', 'in full: it is addressed to implementation');
    const other = buildBrief({ actor: 'review', taskId: s.t1, idx });
    const first = other.parts.plan.find((p) => p.id === s.plan7);
    assert.equal(first.first, 'Para one.', 'first paragraph to others');
  });

  test('part 3: addressed to the actor, to the task, left behind, and under an ended child', async () => {
    const s = await scenario();
    const impl = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    const ids = impl.parts.addressed.map((r) => r.id);
    assert.ok(ids.includes(s.f11), 'to implementation in this task');
    assert.ok(ids.includes(s.f12), 'to the task');
    assert.ok(ids.includes(s.f21), 'an open record under an ended child task reaches the parent task\'s brief');
    const t1brief = buildBrief({ actor: 'review', taskId: s.t1, idx });
    assert.equal(t1brief.parts.addressed.some((r) => r.id === s.f21), false, 'only a direct child\'s records reach the brief of the parent');
    assert.ok(ids.includes(s.f14), 'to a stage whose run here has ended: left behind, so it is addressed to the task');
  });

  test('part 4: what stands about this task, with versions and stale flags, and project-scoped decisions', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    const ids = b.parts.stands.map((r) => r.id);
    assert.ok(ids.includes(s.v5), 'the verdict on the change');
    assert.ok(ids.includes(s.d10), 'a project-scoped decision covers every task');
    const v = b.parts.stands.find((r) => r.id === s.v5);
    assert.match(v.flags.stale[0], new RegExp(`on ${s.c4}@1, now @2`));
  });

  test('part 5: the count of open records to project, the lessons holding, and how to look them up', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    assert.equal(b.parts.project['open-to-project'], 1);
    assert.equal(b.parts.project['lessons-holding'], 1);
    assert.match(b.parts.project.lookup.join(' '), /find --to project.*find --kind lesson/);
  });

  test('part 6: other open runs in the project, not the actor\'s own on this task', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    assert.deepEqual(b.parts.runs.map((r) => r.id), [s.r15]);
  });

  test('part 7: the index of other open records in the task, one line each', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    const line = b.parts.index.find((r) => r.id === s.f17);
    assert.deepEqual(line, { id: s.f17, kind: 'finding', to: 'review', first: 'Index me.' });
  });

  test('part 8: the previous stage, the latest ended run in this task by another actor', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    assert.deepEqual(b.parts.previous, { id: s.r13, stage: 'survey-task', first: 'Found the footer.' });
  });

  test('part 8 and left-behind skip the coordinator: an ended autopilot run in the task is no stage (LIN-4531)', async () => {
    const s = await scenario();
    // A fresh autopilot kickoff opens a run in its ticket's task. It ends after the survey run, so by time alone it would be the previous stage.
    const coordinator = await store.openRun(URL_KEY, { id: 'row-coordinator', stage: 'autopilot', taskId: s.t3, lineage: 'row-coordinator', at: at(++minute) });
    await store.endRun(URL_KEY, coordinator.id, { state: 'done', account: 'Coordinated the work.', at: at(++minute) });
    // A finding addressed to the coordinator in this task: its run ended, but it is no stage, so the finding is not "left behind" for any reader.
    await add('finding', { in: s.t3, to: 'autopilot', says: 'For the coordinator.' }, 'review');
    await refresh();
    const b = buildBrief({ actor: 'close-out', taskId: s.t3, idx });
    assert.deepEqual(b.parts.previous, { id: s.r13, stage: 'survey-task', first: 'Found the footer.' }, 'the previous stage is the survey run, not the coordinator');
    assert.equal(JSON.stringify(b.parts.addressed).includes('For the coordinator.'), false, 'a finding to the coordinator is not left behind for the stage reading it');
  });

  test('ended records are left out; and the brief as of an earlier time is the earlier brief', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    assert.equal(JSON.stringify(b.parts).includes(`"id":"${s.plan2}"`), false, 'a superseded plan is not a part');
    assert.equal(b.carries.includes(s.t20), false);
    const early = buildBrief({ actor: 'implementation', taskId: s.t3, idx, asOf: at(3) });
    assert.equal(early.parts.previous, null);
    assert.equal(early.parts.addressed.length, 0);
  });

  test('the text names all eight parts, and reports its bytes', async () => {
    const s = await scenario();
    const b = buildBrief({ actor: 'implementation', taskId: s.t3, idx });
    for (const n of ['1 The task', '2 Its plan', '3 Addressed', '4 What stands', '5 The project', '6 Other open runs', '7 Index', '8 The previous']) {
      assert.match(b.text, new RegExp(`## ${n}`));
    }
    assert.equal(b.bytes, Buffer.byteLength(b.text));
  });

  test('a brief for something that is not a task is refused', async () => {
    const s = await scenario();
    assert.match(buildBrief({ actor: 'implementation', taskId: s.f11, idx }).problem, /is not a task/);
  });
});

describe('the reference model is the layer\'s own', () => {
  test('the kinds carry the full layer kind set and its outcome sets', () => {
    assert.deepEqual(Object.keys(KINDS.kinds).sort(), ['change', 'decision', 'finding', 'lesson', 'plan', 'question', 'run', 'task', 'verdict']);
    assert.deepEqual(KINDS.outcomes.review, ['approve', 'request-changes', 'needs-discussion']);
    assert.deepEqual(KINDS.outcomes['blind-read'], ['better', 'same', 'worse']);
  });
});
