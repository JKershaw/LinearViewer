// The layer's own test (§4): each shape check refusing once, each command once, each view, each part of the brief.
// Runs against a temporary store through LAYER_STORE; store.json is never touched.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LAYER = new URL('layer.mjs', import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
const store = path.join(dir, 'store.json');
fs.writeFileSync(store, '{"next":1,"records":{},"log":[]}');

function run(...args) {
  const r = spawnSync(process.execPath, [LAYER, ...args], { env: { ...process.env, LAYER_STORE: store }, encoding: 'utf8' });
  let out; try { out = JSON.parse(r.stdout); } catch { out = r.stdout; }
  return { code: r.status, out, stderr: r.stderr };
}
const ok = (...a) => { const r = run(...a); assert.equal(r.code, 0, JSON.stringify(r.out) + r.stderr); return r.out; };
const refused = (re, ...a) => { const r = run(...a); assert.equal(r.code, 2, JSON.stringify(r.out) + r.stderr); assert.match(r.out.error, re); };
let minute = 0;
const T = (m) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString();
const w = (...a) => ok(...a, '--at', T(++minute)); // writes in their own order
const add = (kind, obj, by) => w('add', kind, JSON.stringify(obj), '--by', by).id;

let failed = 0, passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`); }
}

// ---- a small project, written in its own order ----
const task1 = add('task', { asked: 'Make the footer show runs left.', 'done-when': 'footer shows N runs', ref: 'LIN-1' }, 'John');
const plan2 = add('plan', { in: task1, says: 'Old plan.', order: 1 }, 'design');
const task3 = add('task', { in: task1, 'done-when': 'child done', links: { piece: plan2 } }, 'breakdown');
const change4 = add('change', { in: task3, ref: 'PR 9', head: 'abc' }, 'implementation');
const verdict5 = add('verdict', { in: task3, judgement: 'review', outcome: 'approve', reasoning: 'fine', links: { on: [`${change4}@1`] } }, 'review');
const beforeRevise = T(minute);
w('revise', change4, '{"head":"def"}', '--reason', 'new head', '--by', 'implementation');
const verdict6 = add('verdict', { in: task1, judgement: 'plan-review', outcome: 'approve', reasoning: 'ok', links: { on: [`${plan2}@1`] } }, 'plan-review');
const plan7 = add('plan', { in: task1, says: 'Para one.\n\nPara two.', order: 1, to: 'implementation' }, 'design');
w('end', plan2, 'superseded', 'rewritten', '--into', plan7, '--by', 'design');
const question8 = add('question', { in: task3, to: 'John', asks: 'Which footer?', options: ['a', 'b'], recommended: 'a' }, 'implementation');
const decision9 = add('decision', { in: task3, answer: 'a', why: 'simpler' }, 'John');
w('link', decision9, 'answers', question8, '--by', 'John');
const decision10 = add('decision', { answer: 'Always ask before deleting.', why: 'standing direction', scope: 'project' }, 'John');
const finding11 = add('finding', { in: task3, to: 'implementation', says: 'Fix the count.' }, 'review');
const finding12 = add('finding', { in: task1, to: task3, says: 'Addressed to the task.' }, 'leftover');
const run13 = add('run', { in: task3, stage: 'survey-task', account: 'Found the footer.\nDetails follow.' }, 'survey-task');
const finding14 = add('finding', { in: task3, to: 'survey-task', says: 'Left behind.' }, 'scoping');
w('end', run13, 'done', 'finished', '--by', 'survey-task');
const run15 = add('run', { in: task1, stage: 'review' }, 'review');
const run16 = add('run', { in: task3, stage: 'implementation' }, 'implementation');
const finding17 = add('finding', { in: task3, to: 'review', says: 'Index me.\nSecond line.', how: 'read it' }, 'implementation');
const lesson18 = add('lesson', { says: 'The footer lives in lib/components.' }, 'close-out');
const finding19 = add('finding', { to: 'project', says: 'Project-wide note.' }, 'autopilot');
const task20 = add('task', { in: task3, asked: 'A child a person wrote.' }, 'John');
const finding21 = add('finding', { in: task20, to: 'leftover', says: 'Under an ended task.' }, 'implementation');
w('end', task20, 'done', 'finished', 'early', '--by', 'John');
const NOW = T(minute);

// ---- shape checks, each refusing once ----
t('refuse: undeclared kind', () => refused(/kind 'widget' is not declared/, 'add', 'widget', '{}', '--by', 'John'));
t('refuse: link given as a field, says where it belongs', () => refused(/'about' does not belong to finding; it is a link: put it under links/, 'add', 'finding', `{"to":"review","says":"x","about":["${change4}"]}`, '--by', 'review'));
t('refuse: another kind\'s field, says which kind', () => refused(/'asks' does not belong to finding; it belongs to question/, 'add', 'finding', '{"to":"review","asks":"x"}', '--by', 'review'));
t('refuse: to under links, says top level', () => refused(/'to' is not a link type; put it at the top level/, 'add', 'finding', '{"says":"x","links":{"to":"review"}}', '--by', 'review'));
t('refuse: by in the JSON, says use --by', () => refused(/use --by/, 'add', 'lesson', '{"says":"x","by":"John"}', '--by', 'John'));
t('refuse: field type', () => refused(/'order' of plan must be a number/, 'add', 'plan', '{"says":"x","order":"1"}', '--by', 'design'));
t('refuse: verdict judgement not declared', () => refused(/judgement must be one of/, 'add', 'verdict', `{"judgement":"vibes","outcome":"approve","links":{"on":["${change4}@1"]}}`, '--by', 'review'));
t('refuse: verdict outcome not in its set', () => refused(/'better' is not in review's set/, 'add', 'verdict', `{"judgement":"review","outcome":"better","links":{"on":["${change4}@1"]}}`, '--by', 'review'));
t('refuse: a task\'s asked changes', () => refused(/asked is fixed/, 'revise', task1, '{"asked":"other words"}', '--reason', 'x', '--by', 'John'));
t('refuse: by not a declared actor', () => refused(/by 'nobody' is not a declared actor/, 'add', 'lesson', '{"says":"x"}', '--by', 'nobody'));
t('refuse: to not an actor, task or project', () => refused(/to 'nobody' must be/, 'add', 'finding', '{"to":"nobody","says":"x"}', '--by', 'review'));
t('refuse: hand-off kind without to', () => refused(/a question must have a to/, 'add', 'question', '{"asks":"x"}', '--by', 'review'));
t('refuse: in not a task', () => refused(/in 'change-4' is not a task/, 'add', 'lesson', `{"in":"${change4}","says":"x"}`, '--by', 'review'));
t('refuse: link does not resolve', () => refused(/'task-99' does not resolve/, 'add', 'lesson', '{"says":"x","links":{"about":["task-99"]}}', '--by', 'review'));
t('refuse: link version does not exist', () => refused(/has no such version/, 'link', verdict5, 'on', `${change4}@9`, '--by', 'review'));
t('refuse: on without a version', () => refused(/names exact versions/, 'link', verdict5, 'on', change4, '--by', 'review'));
t('refuse: verdict without on', () => refused(/must have links.on/, 'add', 'verdict', '{"judgement":"review","outcome":"approve"}', '--by', 'review'));
t('refuse: answers on a non-decision', () => refused(/a finding cannot carry it/, 'link', finding11, 'answers', question8, '--by', 'review'));
t('refuse: answers to a non-question', () => refused(/must point to a question/, 'link', decision10, 'answers', task1, '--by', 'John'));
t('refuse: piece to a non-plan', () => refused(/must point to a plan/, 'link', task3, 'piece', change4, '--by', 'John'));
t('refuse: state not one of the kind\'s ends', () => refused(/'merged' is not an end of task/, 'end', task1, 'merged', 'x', '--by', 'John'));
t('refuse: end without a reason', () => refused(/needs a reason/, 'end', finding11, 'done', '', '--by', 'John'));
t('refuse: handed-on without the record that takes over', () => refused(/handed-on names the record that takes over/, 'end', finding11, 'handed-on', 'moving', '--by', 'review'));
t('refuse: ending an ended record', () => refused(/already ended/, 'end', task20, 'declined', 'x', '--by', 'John'));
t('usage: missing --by, unknown flag, bad JSON exit 1', () => {
  assert.equal(run('add', 'lesson', '{"says":"x"}').code, 1);
  assert.equal(run('find', '--store', 'x', '--by', 'John').code, 1);
  assert.equal(run('add', 'lesson', '{nope', '--by', 'John').code, 1);
  assert.match(run('frob').out.error, /commands:/);
});
t('refuse: query by an undeclared actor', () => refused(/not a declared actor/, 'find', '--by', 'nobody'));

// ---- each command once ----
t('add: allocates id, starting state, via, at, links, to', () => {
  const r = run('get', finding17, '--by', 'review').out;
  assert.equal(r.state, 'open'); assert.equal(r.to, 'review'); assert.equal(r.in, task3);
  const s = ok('add', 'finding', JSON.stringify({ in: task3, to: 'review', says: 'x', links: { about: [change4] } }), '--by', 'review', '--via', 'Harbour', '--at', T(500));
  assert.equal(s.via, 'Harbour'); assert.deepEqual(s.links, { about: [change4] }); assert.equal(s.v, 1); assert.equal(s.op, 'add');
  ok('end', s.id, 'declined', 'test only', '--by', 'review', '--at', T(501));
});
t('revise: new version with reason, earlier kept', () => {
  const g = ok('get', change4, '--by', 'review');
  assert.equal(g.v, 2); assert.equal(g.versions.length, 2); assert.equal(g.versions[1].reason, 'new head'); assert.equal(g.versions[0].fields.head, 'abc');
});
t('end: state, reason, into', () => {
  const p = ok('get', plan2, '--by', 'design');
  assert.equal(p.state, 'superseded'); assert.deepEqual(p.ended, { reason: 'rewritten', into: plan7 });
});
t('link: adds a link as a new version', () => {
  const d = ok('get', decision9, '--by', 'John');
  assert.equal(d.links.answers, question8); assert.equal(d.op, 'link'); assert.equal(d.v, 2);
});
t('get id@v and --as-of', () => {
  assert.equal(ok('get', `${change4}@1`, '--by', 'review').fields.head, 'abc');
  assert.equal(ok('get', change4, '--as-of', beforeRevise, '--by', 'review').fields.head, 'abc');
});
t('find: by kind, in, to, state, text', () => {
  const ids = (o) => o.records.map((r) => r.id);
  assert.deepEqual(ids(ok('find', '--kind', 'lesson', '--by', 'review')), [lesson18]);
  assert.ok(ids(ok('find', '--in', task3, '--kind', 'finding', '--state', 'open', '--by', 'review')).includes(finding11));
  assert.deepEqual(ids(ok('find', '--text', 'second LINE', '--by', 'review')), [finding17]);
  assert.deepEqual(ids(ok('find', '--in', 'project', '--kind', 'finding', '--by', 'review')), [finding19]);
});
t('show --task: everything in the task with states and flags', () => {
  const s = ok('show', '--task', task3, '--by', 'review');
  assert.equal(s.task.id, task3);
  const byId = Object.fromEntries(s.records.map((r) => [r.id, r]));
  assert.equal(byId[run13].state, 'done'); assert.ok(byId[verdict5].flags.stale); assert.ok(byId[task20]);
});
t('queries are logged with who asked', () => {
  const log = JSON.parse(fs.readFileSync(store, 'utf8')).log;
  assert.ok(log.some((l) => l.by === 'review' && l.cmd === 'show' && Array.isArray(l.args)));
  assert.ok(log.some((l) => l.cmd === 'get' && l.asOf === beforeRevise));
});

// ---- views ----
t('view: open for a reader', () => {
  const r = ok('find', '--to', 'implementation', '--state', 'open', '--by', 'implementation').records.map((x) => x.id);
  assert.deepEqual(r, [finding11]);
  assert.deepEqual(ok('find', '--to', task3, '--state', 'open', '--by', 'review').records.map((x) => x.id), [finding12]);
});
t('view: answered shows the decision beside the open question', () => {
  const q = ok('get', question8, '--by', 'John');
  assert.equal(q.state, 'open'); assert.deepEqual(q.flags.answered, { by: decision9, answer: 'a' });
});
t('view: stale on content revised', () => assert.deepEqual(ok('get', verdict5, '--by', 'review').flags.stale, [`on ${change4}@1, now @2`]));
t('view: stale on target superseded', () => assert.match(ok('get', verdict6, '--by', 'review').flags.stale[0], /on plan-2@1: target superseded into plan-7/));
t('view: not stale as of before the revise', () => assert.equal(ok('get', verdict5, '--as-of', beforeRevise, '--by', 'review').flags, undefined));
t('view: counts as of any time', () => {
  assert.equal(ok('find', '--kind', 'finding', '--count', '--as-of', T(1), '--by', 'review').count, 0);
  assert.ok(ok('find', '--kind', 'finding', '--count', '--by', 'review').count >= 7);
});
t('view: under an ended task (find shows it)', () => {
  assert.equal(ok('find', '--to', 'leftover', '--state', 'open', '--by', 'leftover').records[0].flags['under-ended-task'], task20);
});

// ---- the brief, each part ----
const B = ok('brief', 'implementation', '--task', task3, '--as-of', NOW);
const P = B.parts;
t('brief: envelope {actor, task, asOf, carries, bytes, parts}', () => {
  assert.deepEqual(Object.keys(B), ['actor', 'task', 'asOf', 'carries', 'bytes', 'parts']);
  assert.equal(B.asOf, NOW); assert.ok(B.carries.includes(finding11));
  const text = run('brief', 'implementation', '--task', task3, '--as-of', NOW, '--text').out;
  assert.equal(B.bytes, Buffer.byteLength(text.replace(/\n$/, '')));
  assert.match(text, /^# Brief for implementation on task-3/); assert.match(text, /## 8 The previous stage/);
});
t('brief 1: task, ref, done-when and asked of task and ancestors verbatim', () => {
  assert.equal(P.task['done-when'], 'child done');
  assert.deepEqual(P.task.asked, [{ task: task1, asked: 'Make the footer show runs left.' }]);
  const child = ok('brief', 'implementation', '--task', task20, '--as-of', NOW).parts.task.asked.map((a) => a.task);
  assert.deepEqual(child, [task20, task1]);
});
t('brief 2: the piece, followed to its takeover; full to its addressee, first paragraph to others', () => {
  assert.equal(P.plan[0].id, plan7); assert.equal(P.plan[0].fields.says, 'Para one.\n\nPara two.');
  assert.deepEqual(ok('brief', 'review', '--task', task3, '--as-of', NOW).parts.plan, [{ id: plan7, first: 'Para one.' }]);
});
t('brief 3: addressed to it, to the task, left behind, under an ended child', () => {
  assert.deepEqual(P.addressed.map((r) => r.id).sort(), [finding11, finding12, finding14, finding21].sort());
});
t('brief 4: what stands, with versions and stale flags, and project-scoped decisions', () => {
  const ids = P.stands.map((r) => r.id);
  for (const id of [verdict5, verdict6, decision9, decision10]) assert.ok(ids.includes(id), id);
  assert.ok(P.stands.find((r) => r.id === verdict5).flags.stale);
});
t('brief 5: project counts and how to look them up', () => {
  assert.equal(P.project['open-to-project'], 1); assert.equal(P.project['lessons-holding'], 1);
  assert.match(P.project.lookup.join(' '), /find --to project.*find --kind lesson/);
});
t('brief 6: other open runs, not its own', () => {
  assert.deepEqual(P.runs, [{ id: run15, task: task1, stage: 'review' }]);
});
t('brief 7: index of other open records in the task', () => {
  const idx = P.index.find((r) => r.id === finding17);
  assert.deepEqual(idx, { id: finding17, kind: 'finding', to: 'review', first: 'Index me.' });
  assert.ok(P.index.some((r) => r.id === change4)); assert.ok(!P.index.some((r) => r.id === finding11 || r.id === run16));
});
t('brief 8: the previous stage', () => assert.deepEqual(P.previous, { id: run13, stage: 'survey-task', first: 'Found the footer.' }));
t('brief: ended records left out', () => {
  const all = JSON.stringify(P);
  assert.ok(!all.includes(`"id":"${plan2}"`)); assert.ok(!B.carries.includes(task20));
});
t('brief: as of an earlier time', () => {
  const early = ok('brief', 'implementation', '--task', task3, '--as-of', T(4)).parts;
  assert.equal(early.plan[0].id, plan2); assert.equal(early.addressed.length, 0); assert.equal(early.previous, null);
});

fs.rmSync(dir, { recursive: true, force: true });
assert.equal(fs.readFileSync(new URL('store.json', import.meta.url), 'utf8').trim(), '{"next":1,"records":{},"log":[]}');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
