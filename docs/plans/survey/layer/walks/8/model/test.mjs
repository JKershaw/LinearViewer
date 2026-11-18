// The model's own test (§4): each shape check refusing once, each command once, each view, each part of the brief.
// Runs against a temporary store via LAYER_STORE; the checked-in store.json is left untouched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'layer-')), 'store.json');
const before = fs.readFileSync(path.join(dir, 'store.json'), 'utf8');
after(() => fs.rmSync(path.dirname(STORE), { recursive: true, force: true }));

function run(...args) {
  const r = spawnSync(process.execPath, [path.join(dir, 'layer.mjs'), ...args], { env: { ...process.env, LAYER_STORE: STORE }, encoding: 'utf8' });
  let out; try { out = JSON.parse(r.stdout); } catch { out = r.stdout; }
  return { code: r.status, out };
}
let minute = 0;
const T = (m) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString();
const ok = (...args) => { const r = run(...args, '--at', T(++minute)); assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const add = (kind, body, by) => ok('add', kind, JSON.stringify(body), '--by', by).id;
const refused = (...args) => { const r = run(...args); assert.equal(r.code, 2, JSON.stringify(r.out)); assert.ok(r.out.error); };
const q = (...args) => { const r = run(...args); assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const ids = (rs) => rs.map((r) => r.id).sort();

let parent, plan, child, change, vReview, vBlind, vPlan, dScope, dProject, question, dAnswer, runReview, fLeft, fImpl, check, runImpl, grand, fOrphan, lesson, runDesign, fDesign, plan2, solo, fSolo;

test('add: build a task tree', () => {
  parent = add('task', { asked: 'Build X', 'done-when': 'X works', ref: 'LIN-1' }, 'John');
  plan = add('plan', { in: parent, says: 'Piece A\nmore detail', order: 1 }, 'breakdown');
  child = add('task', { in: parent, 'done-when': 'A done', links: { piece: plan } }, 'breakdown');
  change = add('change', { in: child, ref: 'PR 9', head: 'abc' }, 'implementation');
  vReview = add('verdict', { in: child, judgement: 'review', outcome: 'approve', links: { on: [change] } }, 'review');
  vBlind = add('verdict', { in: child, judgement: 'blind-read', outcome: 'better', links: { on: [`${change}@1`] } }, 'blind-read');
  vPlan = add('verdict', { in: child, judgement: 'plan-review', outcome: 'approve-with-notes', links: { on: [plan] } }, 'plan-review');
  dScope = add('decision', { in: parent, answer: 'Use Y', why: 'speed', scope: parent }, 'John');
  dProject = add('decision', { answer: 'Always test', scope: 'project' }, 'John');
  question = add('question', { in: child, to: 'John', asks: 'Which?', options: ['a', 'b'] }, 'implementation');
  dAnswer = add('decision', { in: child, answer: 'a' }, 'John');
  runReview = add('run', { in: child, stage: 'review', account: 'Reviewed.\nAll good' }, 'review');
  fLeft = add('finding', { in: child, to: 'review', says: 'Fix the lint' }, 'implementation');
  fImpl = add('finding', { in: child, to: 'implementation', says: 'Handle nulls' }, 'review');
  check = add('check', { to: child, what: 'Run on host', 'why-person': 'needs prod', how: 'ssh' }, 'review');
  runImpl = add('run', { in: child, stage: 'implementation' }, 'implementation');
  grand = add('task', { in: child, asked: 'A grandchild John wrote' }, 'John');
  fOrphan = add('finding', { in: grand, to: 'project', says: 'Orphaned' }, 'design');
  lesson = add('lesson', { says: 'Tests are slow' }, 'close-out');
  runDesign = add('run', { in: parent, stage: 'design' }, 'design');
  fDesign = add('finding', { in: child, to: 'design', says: 'Note for design\nsecond line' }, 'review');
  plan2 = add('plan', { in: parent, says: 'Piece A v2' }, 'design');
  solo = add('task', { asked: 'Solo' }, 'John');
  fSolo = add('finding', { in: solo, to: 'John', says: 'Left over' }, 'design');
  assert.equal(vReview.split('-')[0], 'verdict');
  assert.deepEqual(q('get', vReview, '--by', 'John').links.on, [`${change}@1`]); // bare on is pinned
});

test('end and link', () => {
  assert.equal(ok('end', runReview, 'done', 'finished', '--by', 'review').state, 'done');
  ok('end', grand, 'done', 'ok', '--by', 'John');
  ok('end', solo, 'declined', 'not needed', '--by', 'John');
  const e = ok('end', plan, 'superseded', 'rewritten', '--into', plan2, '--by', 'design');
  assert.deepEqual(e.ended, { reason: 'rewritten', into: plan2 });
  const l = ok('link', dAnswer, 'answers', question, '--by', 'John', '--via', 'Harbour');
  assert.equal(l.links.answers, question); assert.equal(l.via, 'Harbour'); assert.equal(l.op, 'link');
});

test('revise keeps versions; get, get@v, as-of', () => {
  const r = ok('revise', change, '{"head":"def"}', '--reason', 'new head', '--by', 'implementation');
  assert.equal(r.v, 2); assert.equal(r.reason, 'new head');
  const g = q('get', change, '--by', 'review');
  assert.equal(g.versions.length, 2); assert.equal(g.fields.head, 'def');
  assert.equal(q('get', `${change}@1`, '--by', 'review').fields.head, 'abc');
  assert.equal(q('get', change, '--by', 'review', '--as-of', T(10)).fields.head, 'abc');
});

test('each shape check refuses once', () => {
  refused('add', 'memo', '{}', '--by', 'John');                                                     // undeclared kind
  refused('add', 'finding', '{"to":"John","colour":"red"}', '--by', 'John');                         // field not of the kind
  refused('add', 'plan', '{"order":"first"}', '--by', 'John');                                       // field type
  refused('add', 'verdict', JSON.stringify({ judgement: 'blind-read', outcome: 'approve', links: { on: [change] } }), '--by', 'review'); // outcome set
  refused('revise', parent, '{"asked":"Something else"}', '--reason', 'x', '--by', 'John');          // asked fixed
  refused('add', 'lesson', '{}', '--by', 'Nobody');                                                  // by declared
  refused('add', 'finding', '{"to":"Nobody"}', '--by', 'John');                                      // to declared
  refused('add', 'check', '{"what":"x"}', '--by', 'John');                                           // hand-off needs to
  refused('add', 'lesson', JSON.stringify({ in: lesson }), '--by', 'John');                         // in is a task
  refused('add', 'lesson', '{"links":{"about":["lesson-999"]}}', '--by', 'John');                    // link resolves
  refused('add', 'verdict', '{"judgement":"review","outcome":"approve"}', '--by', 'review');         // verdict has on
  refused('add', 'finding', JSON.stringify({ to: 'John', links: { answers: question } }), '--by', 'John'); // answers joins decision->question
  refused('end', fImpl, 'merged', 'x', '--by', 'John');                                              // end is one of the kind's ends
  refused('end', fImpl, 'done', '', '--by', 'John');                                                 // end has a reason
  refused('end', fImpl, 'handed-on', 'x', '--by', 'John');                                           // handed-on names its taker
  assert.equal(run('find', '--kind', 'task').code, 1);                                               // usage: query without --by
  assert.equal(run('nonsense').code, 1);
});

test('views: open for a reader, counts, answered, stale, under an ended task', () => {
  assert.deepEqual(ids(q('find', '--to', 'implementation', '--state', 'open', '--by', 'implementation')), [fImpl]);
  assert.deepEqual(ids(q('find', '--to', child, '--state', 'open', '--by', 'implementation')), [check]);
  assert.deepEqual(q('find', '--kind', 'finding', '--count', '--by', 'John'), { count: 5 });
  assert.deepEqual(q('find', '--kind', 'finding', '--count', '--by', 'John', '--as-of', T(13)), { count: 1 });
  assert.equal(q('find', '--text', 'NULLS', '--by', 'John')[0].id, fImpl);
  assert.equal(q('get', question, '--by', 'John').answered.id, dAnswer);
  assert.deepEqual(q('get', vReview, '--by', 'John').stale, [`on ${change}@1, now @2`]);
  assert.deepEqual(q('get', vPlan, '--by', 'John').stale, [`on ${plan}@1, now superseded`]);
  assert.equal(q('get', dScope, '--by', 'John').stale, undefined);
  assert.equal(q('find', '--in', solo, '--by', 'John')[0].underEnded, solo);
  const shown = q('show', '--task', child, '--by', 'John');
  assert.equal(shown.task.id, child);
  assert.ok(shown.records.find((r) => r.id === vReview).stale);
  assert.ok(shown.records.find((r) => r.id === runReview).state === 'done');
});

test('brief: each of the eight parts', () => {
  const b = q('brief', 'implementation', '--task', child);
  const p = b.parts;
  assert.deepEqual(p.task, { id: child, 'done-when': 'A done', asked: [{ task: parent, asked: 'Build X' }] });  // 1
  assert.deepEqual(ids(p.plan), [plan2]);                                                                  // 2 (superseded -> taker)
  assert.deepEqual(ids(p.addressed), [check, fImpl, fLeft, fOrphan].sort());                               // 3
  assert.deepEqual(ids(p.stands), [dAnswer, dProject, dScope, vBlind, vPlan, vReview].sort());             // 4
  assert.ok(p.stands.find((r) => r.id === vReview).stale);
  assert.equal(p.project.open, 1); assert.equal(p.project.lessons, 1);                                     // 5
  assert.deepEqual(p.runs, [{ id: runDesign, task: parent, stage: 'design' }]);                            // 6
  assert.deepEqual(ids(p.index), [change, fDesign, question, runImpl].sort());                             // 7
  assert.deepEqual(p.index.find((r) => r.id === fDesign), { id: fDesign, kind: 'finding', to: 'design', says: 'Note for design' });
  assert.deepEqual(p.previous, { id: runReview, stage: 'review', account: 'Reviewed.' });                  // 8
  assert.equal(b.carries.addressed, 4); assert.equal(b.carries.previous, 1);
  const text = run('brief', 'implementation', '--task', child, '--text').out;
  assert.equal(b.bytes, Buffer.byteLength(text));
  assert.match(text, /## 8\. The previous stage\nrun-\d+ review: Reviewed\./);
});

test('brief and queries for a blind actor; brief as of a time', () => {
  const b = q('brief', 'blind-read', '--task', child).parts;
  assert.deepEqual(ids(b.stands.filter((r) => r.kind === 'verdict')), [vBlind]);
  assert.equal(b.previous.account, undefined);
  assert.equal(run('get', vReview, '--by', 'blind-read').code, 2);
  assert.equal(q('get', runReview, '--by', 'blind-read').fields.account, undefined);
  const early = q('brief', 'implementation', '--task', child, '--as-of', T(5));
  assert.deepEqual(ids(early.parts.plan), [plan]);
  assert.equal(early.parts.previous, null);
});

test('queries are logged; checked-in store untouched', () => {
  const s = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  assert.ok(s.log.some((e) => e.by === 'blind-read' && e.cmd === 'get'));
  assert.ok(s.log.some((e) => e.asOf === T(10)));
  assert.equal(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'), before);
  assert.deepEqual(JSON.parse(before), { next: 1, records: {}, log: [] });
});
