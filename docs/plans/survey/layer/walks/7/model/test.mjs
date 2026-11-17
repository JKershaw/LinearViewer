// The model's own test (§4): each shape check refusing once, each command once, each view, each brief part.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'layer-'));
const env = { ...process.env, LAYER_STORE: join(dir, 'store.json') };
const cli = join(dirname(fileURLToPath(import.meta.url)), 'layer.mjs');
const sh = (...a) => { const r = spawnSync('node', [cli, ...a], { env, encoding: 'utf8' }); let out; try { out = JSON.parse(r.stdout); } catch { out = r.stdout; } return { code: r.status, out }; };
const ok = (...a) => { const r = sh(...a); assert.equal(r.code, 0, `${a.join(' ')} → ${JSON.stringify(r.out)}`); return r.out; };
const no = (code, re, ...a) => { const r = sh(...a); assert.equal(r.code, code, `${a.join(' ')} → ${JSON.stringify(r.out)}`); if (re) assert.match(r.out.error, re); };
const T = (n) => `2026-01-01T00:${String(n).padStart(2, '0')}:00.000Z`;
const add = (n, by, kind, j, ...x) => ok('add', kind, JSON.stringify(j), '--by', by, '--at', T(n), ...x);
const ids = (rs) => rs.map((r) => r.id).sort();
let passed = 0; const it = (name, f) => { f(); passed++; console.log(`ok - ${name}`); };

try {
  it('add (every kind) with --via', () => {
    assert.equal(add(1, 'Harbour', 'area', { name: 'lib', paths: ['lib'] }).id, 'area-1');
    assert.equal(add(2, 'John', 'task', { asked: 'Fix the thing', 'done-when': 'tests pass', paths: ['lib/a'], ref: 'LIN-1' }).state, 'open');
    add(3, 'breakdown', 'task', { in: 'task-2', 'done-when': 'b fixed', paths: ['lib/a/b.js'] });               // task-3
    assert.equal(add(4, 'breakdown', 'plan', { in: 'task-3', says: 'Do X', paths: ['lib/a/b.js'], order: 1 }).state, 'kept'); // plan-4
    add(6, 'implementation', 'run', { in: 'task-3', stage: 'implementation', claims: ['lib/a/b.js'], account: 'I did X.\nThen Y.' }); // run-5
    add(7, 'implementation', 'change', { in: 'task-3', ref: 'PR-1', head: 'abc' });                          // change-6
    add(8, 'review', 'verdict', { in: 'task-3', of: 'review', outcome: 'approve', reasoning: 'ok', links: { on: ['change-6@1'] } }); // verdict-7
    add(9, 'review', 'finding', { in: 'task-3', to: 'implementation', says: 'Fix y' });                       // finding-8
    add(10, 'implementation', 'question', { in: 'task-3', to: 'John', asks: 'Which?', options: ['a', 'b'], recommended: 'a', 'if-unanswered': 'a' }); // question-9
    add(11, 'John', 'decision', { in: 'task-3', answer: 'a', why: 'simpler', links: { answers: 'question-9', on: ['plan-4'] } }, '--via', 'autopilot'); // decision-10
    add(12, 'John', 'decision', { in: 'task-2', answer: 'always test', why: 'policy', scope: 'task-2' });       // decision-11
    add(13, 'survey-place', 'lesson', { in: 'area-1', says: 'lib/a is fragile\nsecond line', paths: ['lib/a'], 'checked-at': 'abc' }); // lesson-12
    add(14, 'scoping', 'run', { in: 'task-2', stage: 'scoping', claims: ['lib/a'] });                         // run-13
    const s = JSON.parse(readFileSync(env.LAYER_STORE, 'utf8'));
    assert.equal(s.records['decision-10'][0].via, 'autopilot');
    assert.deepEqual(s.records['decision-10'][0].links.on, ['plan-4@1']); // bare on pinned to current version
  });

  it('link', () => {
    const r = ok('link', 'task-3', 'piece', 'plan-4', '--by', 'breakdown', '--at', T(5));
    assert.equal(r.v, 2); assert.equal(r.op, 'link'); assert.equal(r.links.piece, 'plan-4');
  });

  it('view overlap (show --task, --as-of)', () => {
    const s = ok('show', '--task', 'task-3', '--by', 'review', '--as-of', T(14));
    assert.deepEqual(s.overlap, [{ runs: ['run-5', 'run-13'], paths: ['lib/a/b.js'] }]);
    assert.ok(ids(s.records).includes('task-3') && ids(s.records).includes('finding-8'));
  });

  it('end, then more writes', () => {
    const r = ok('end', 'run-5', 'done', 'finished', '--by', 'implementation', '--at', T(15));
    assert.deepEqual([r.state, r.ended], ['done', { reason: 'finished' }]);
    add(16, 'review', 'check', { in: 'task-3', to: 'task-3', what: 'run on prod', 'why-person': 'creds', how: 'by hand' }); // check-14
    add(17, 'implementation', 'finding', { in: 'task-3', to: 'review', says: 'look at z' });                   // finding-15
    add(18, 'review', 'finding', { in: 'task-3', to: 'area-1', says: 'area note' });                           // finding-16
  });

  it('revise; view stale (revised content)', () => {
    const r = ok('revise', 'change-6', '{"head":"def"}', '--reason', 'new head', '--by', 'implementation', '--at', T(19));
    assert.deepEqual([r.v, r.reason, r.fields.head], [2, 'new head', 'def']);
    ok('revise', 'change-6', '{"to":"John"}', '--reason', 'route', '--by', 'implementation', '--at', T(19)); // not content
    assert.deepEqual(ok('get', 'verdict-7', '--by', 'review').stale, ['on change-6@1, now @2']);
    assert.equal(ok('get', 'verdict-7', '--by', 'review', '--as-of', T(18)).stale, undefined);
  });

  it('view stale (target ended superseded)', () => {
    add(20, 'breakdown', 'plan', { in: 'task-3', says: 'Do X better' });                                        // plan-17
    ok('end', 'plan-4', 'superseded', 'replaced', '--into', 'plan-17', '--by', 'breakdown', '--at', T(21));
    assert.deepEqual(ok('get', 'decision-10', '--by', 'review').stale, ['on plan-4@1, plan-4 ended superseded into plan-17']);
    add(22, 'blind-read', 'verdict', { in: 'task-3', of: 'blind-read', outcome: 'better', reasoning: 'r', links: { on: ['change-6@2'] } }); // verdict-18
  });

  it('get (full, @v, --as-of)', () => {
    const g = ok('get', 'change-6', '--by', 'review');
    assert.equal(g.versions.length, 3); assert.equal(g.head, undefined); assert.equal(g.fields.head, 'def');
    assert.equal(ok('get', 'change-6@1', '--by', 'review').fields.head, 'abc');
    assert.equal(ok('get', 'change-6', '--by', 'review', '--as-of', T(18)).fields.head, 'abc');
  });

  it('view answered', () => {
    assert.equal(ok('get', 'question-9', '--by', 'review').answeredBy.id, 'decision-10');
    assert.equal(ok('get', 'question-9', '--by', 'review', '--as-of', T(10)).answeredBy, undefined);
  });

  it('find (each filter) and view open-for-reader', () => {
    assert.deepEqual(ids(ok('find', '--to', 'review', '--state', 'open', '--by', 'review')), ['finding-15']);
    assert.deepEqual(ids(ok('find', '--kind', 'finding', '--in', 'task-3', '--by', 'review')), ['finding-15', 'finding-16', 'finding-8']);
    assert.deepEqual(ids(ok('find', '--path', 'lib/a/b.js', '--kind', 'task', '--by', 'review')), ['task-2', 'task-3']);
    assert.deepEqual(ids(ok('find', '--path', 'lib/ab', '--kind', 'task', '--by', 'review')), []); // whole segments only
    assert.ok(ids(ok('find', '--area', 'area-1', '--by', 'review')).includes('lesson-12'));
    assert.deepEqual(ids(ok('find', '--text', 'FRAGILE', '--by', 'review')), ['lesson-12']);
  });

  it('view counts (--count, --as-of)', () => {
    assert.deepEqual(ok('find', '--kind', 'finding', '--count', '--by', 'review'), { count: 3 });
    assert.deepEqual(ok('find', '--kind', 'finding', '--count', '--by', 'review', '--as-of', T(16)), { count: 1 });
  });

  it('blind actor: queries leave out others\' verdicts', () => {
    assert.deepEqual(ids(ok('find', '--kind', 'verdict', '--by', 'blind-read')), ['verdict-18']);
    no(2, /hidden/, 'get', 'verdict-7', '--by', 'blind-read');
  });

  it('brief: each part, carries, size', () => {
    const b = ok('brief', 'review', '--task', 'task-3');
    const p = b.parts;
    assert.deepEqual(p.task, { id: 'task-3', 'done-when': 'b fixed', paths: ['lib/a/b.js'], asked: [{ id: 'task-2', asked: 'Fix the thing' }] }); // 1
    assert.deepEqual(ids(p.plan), ['plan-17']);                                                          // 2: superseded piece followed
    assert.deepEqual(ids(p.addressed), ['check-14', 'finding-15', 'finding-8']);                         // 3: to task, to me, left behind
    assert.deepEqual(ids(p.stands), ['decision-10', 'decision-11', 'verdict-18', 'verdict-7']);          // 4: incl. ancestor scope
    assert.deepEqual(p.stands.find((r) => r.id === 'verdict-7').restsOn, ['change-6@1']);
    assert.ok(p.stands.find((r) => r.id === 'verdict-7').stale);
    assert.deepEqual(p.areas, [{ id: 'area-1', name: 'lib', open: 1 }]);                                 // 5
    assert.deepEqual(ids(p.runs), ['run-13']);                                                           // 6
    assert.deepEqual(p.index.map((x) => x.id).sort(), ['change-6', 'finding-16', 'lesson-12', 'question-9']); // 7
    assert.equal(p.index.find((x) => x.id === 'lesson-12').says, 'lib/a is fragile');
    assert.deepEqual(p.previous, { run: 'run-5', by: 'implementation', account: 'I did X.\nThen Y.' });   // 8
    assert.equal(b.carries.previous, 'run-5');
    const text = sh('brief', 'review', '--task', 'task-3', '--text').out;
    assert.equal(b.bytes, Buffer.byteLength(text)); assert.match(text, /STALE on change-6@1, now @2/);
  });

  it('brief: blind actor, as-of, no piece', () => {
    assert.deepEqual(ids(ok('brief', 'blind-read', '--task', 'task-3').parts.stands), ['decision-10', 'decision-11', 'verdict-18']);
    const early = ok('brief', 'implementation', '--task', 'task-3', '--as-of', T(4)); // before the piece link
    assert.deepEqual(ids(early.parts.plan), ['plan-4']); assert.equal(early.parts.previous, null);
  });

  it('queries are logged', () => {
    const log = JSON.parse(readFileSync(env.LAYER_STORE, 'utf8')).log;
    assert.ok(log.some((e) => e.by === 'blind-read' && e.cmd === 'find'));
    assert.ok(log.some((e) => e.cmd === 'brief' && e.asOf === T(4)));
  });

  it('each shape check refuses once (exit 2)', () => {
    const A = (kind, j, by = 'review') => ['add', kind, JSON.stringify(j), '--by', by];
    no(2, /kind not declared/, ...A('widget', {}));
    no(2, /does not belong/, ...A('task', { color: 'red' }));
    no(2, /must be list/, ...A('task', { paths: 'lib' }));
    no(2, /must be a task or area id/, ...A('decision', { scope: 'finding-8' }));
    no(2, /not in the set/, ...A('verdict', { of: 'blind-read', outcome: 'approve', links: { on: ['change-6@2'] } }));
    no(2, /asked doesn't change/, 'revise', 'task-2', '{"asked":"Other"}', '--reason', 'x', '--by', 'John');
    no(2, /by is not a declared actor/, ...A('area', { name: 'x' }, 'john'));
    no(2, /to must be/, ...A('finding', { to: 'Nobody', says: 'x' }));
    no(2, /must have a to/, ...A('question', { asks: 'x' }));
    no(2, /in must be/, ...A('finding', { in: 'plan-4', to: 'John', says: 'x' }));
    no(2, /does not resolve/, ...A('lesson', { links: { about: ['nope-99'] } }));
    no(2, /does not resolve/, ...A('verdict', { of: 'review', outcome: 'approve', links: { on: ['change-6@9'] } }));
    no(2, /holds a list/, ...A('lesson', { links: { about: 'task-2' } }));
    no(2, /link type not declared/, 'link', 'task-2', 'blocks', 'task-3', '--by', 'John');
    no(2, /must have an on/, ...A('verdict', { of: 'review', outcome: 'approve' }));
    no(2, /answers joins/, ...A('decision', { links: { answers: 'task-2' } }));
    no(2, /piece joins/, 'link', 'task-2', 'piece', 'finding-8', '--by', 'John');
    no(2, /not an end/, 'end', 'finding-8', 'merged', 'x', '--by', 'review');
    no(2, /needs a reason/, 'end', 'finding-8', 'done', ' ', '--by', 'review');
    no(2, /must name the record/, 'end', 'finding-8', 'handed-on', 'moving', '--by', 'review');
    no(2, /--into does not resolve/, 'end', 'finding-8', 'handed-on', 'moving', '--into', 'task-99', '--by', 'review');
    no(2, /already ended/, 'end', 'run-5', 'done', 'again', '--by', 'review');
    no(2, /no record/, 'revise', 'task-99', '{}', '--reason', 'x', '--by', 'John');
  });

  it('usage errors (exit 1)', () => {
    no(1, null); no(1, null, 'frobnicate');
    no(1, /JSON/, 'add', 'task', '{oops', '--by', 'John');
    no(1, /--by/, 'add', 'task', '{}');
    no(1, /--reason/, 'revise', 'task-2', '{}', '--by', 'John');
    no(1, /bad time/, 'find', '--by', 'John', '--as-of', 'yesterday-ish');
    no(1, null, 'end', 'finding-8', 'done', '--by', 'review');
  });
  console.log(`# ${passed} passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
