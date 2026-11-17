// Own test (§4): each shape check refusing once, each command once, each view, each part of the brief.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const layer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'layer.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
const store = path.join(dir, 'store.json');
let n = 0;
const at = () => new Date(Date.UTC(2026, 0, 1, 0, n++)).toISOString();
const L = (args) => {
  const r = spawnSync(process.execPath, [layer, ...args, '--store', store], { encoding: 'utf8' });
  let out; try { out = JSON.parse(r.stdout); } catch { out = r.stdout; }
  return { code: r.status, out };
};
const ok = (...a) => { const r = L(a); assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const add = (kind, obj, by = 'Harbour') => ok('add', kind, JSON.stringify(obj), '--by', by, '--at', at()).id;
const refused = (re, ...a) => { const r = L([...a, '--by', 'Harbour']); assert.equal(r.code, 2, JSON.stringify(r.out)); assert.match(r.out.refused, re); };
const ids = (rs) => rs.map((r) => r.id).sort();

try {
  // ---- setup: one task tree exercising every brief part
  const area = add('area', { name: 'lib', paths: ['lib/a'] });
  const parent = add('task', { asked: 'Fix the thing', 'done-when': 'all green', paths: ['lib'], ref: 'LIN-1' }, 'John');
  const plan = add('plan', { says: 'piece one\nmore', paths: ['lib/a'], in: parent }, 'breakdown');
  const task = add('task', { 'done-when': 'child done', paths: ['lib/a/b.js'], in: parent, links: { piece: plan } }, 'breakdown');
  assert.equal(area, 'area-1'); assert.equal(task, 'task-4'); // one counter for the whole store
  const f5 = add('finding', { says: 'fix x', in: task, to: 'implementation' }, 'review');
  const f6 = add('finding', { says: 'about the task', in: area, to: task }, 'survey-place');
  const q = add('question', { asks: 'ok?', options: ['yes', 'no'], in: task, to: 'John' }, 'scoping');
  const d8 = add('decision', { answer: 'yes', in: task, links: { answers: q } }, 'John');
  const ch = add('change', { ref: 'PR-1', head: 'abc', in: task }, 'implementation');
  const v10 = add('verdict', { of: 'review', outcome: 'approve', in: task, links: { on: ch } }, 'review');
  const v11 = add('verdict', { of: 'blind-read', outcome: 'better', in: task, links: { on: `${ch}@1` } }, 'blind-read');
  const d12 = add('decision', { answer: 'use X', scope: parent, in: parent }, 'John');
  const l13 = add('lesson', { says: 'b.js is old', paths: ['lib/a/b.js'], in: area }, 'survey-place');
  const l14 = add('lesson', { says: 'ab', paths: ['lib/ab'], in: area }, 'survey-place');
  const r15 = add('run', { stage: 'implementation', claims: ['lib/a/b.js'], in: task }, 'implementation');
  const r16 = add('run', { stage: 'review', claims: ['lib/a'], in: parent }, 'review');
  const r17 = add('run', { stage: 'review', claims: ['lib/ab'], in: parent }, 'review');
  const c18 = add('check', { what: 'run on staging', 'why-person': 'needs creds', how: 'npm run x', to: area }, 'review');
  const f19 = add('finding', { says: 'for review', in: task, to: 'review' }, 'implementation');
  const afterSetup = at();

  // ---- shape checks, each refusing once
  refused(/unknown kind/, 'add', 'widget', '{}');
  refused(/not a field/, 'add', 'finding', JSON.stringify({ says: 'x', to: 'John', colour: 1 }));
  refused(/must be strings/, 'add', 'area', JSON.stringify({ paths: 'lib' }));
  refused(/must be task/, 'add', 'decision', JSON.stringify({ answer: 'x', scope: area }));
  refused(/not in the set/, 'add', 'verdict', JSON.stringify({ of: 'blind-read', outcome: 'approve', links: { on: ch } }));
  refused(/must be verdict-of/, 'add', 'verdict', JSON.stringify({ of: 'vibes', links: { on: ch } }));
  refused(/asked is fixed/, 'revise', parent, JSON.stringify({ asked: 'something else' }), '--reason', 'r');
  assert.equal(L(['add', 'area', '{}', '--by', 'Nobody']).out.refused, 'unknown actor Nobody');
  refused(/needs a to/, 'add', 'check', JSON.stringify({ what: 'x' }));
  refused(/takes no to/, 'add', 'lesson', JSON.stringify({ says: 'x', to: 'John' }));
  refused(/not an actor, task or area/, 'add', 'question', JSON.stringify({ asks: 'x', to: ch }));
  refused(/not a task or area/, 'add', 'lesson', JSON.stringify({ says: 'x', in: ch }));
  refused(/does not resolve/, 'add', 'lesson', JSON.stringify({ says: 'x', links: { about: 'task-999' } }));
  refused(/does not resolve/, 'link', l13, 'on', `${ch}@9`);
  refused(/unknown link/, 'link', l13, 'likes', ch);
  refused(/holds one/, 'add', 'task', JSON.stringify({ links: { piece: [plan] } }));
  refused(/verdict needs an on/, 'add', 'verdict', JSON.stringify({ of: 'review' }));
  refused(/answers joins a decision to a question/, 'add', 'decision', JSON.stringify({ links: { answers: f5 } }));
  refused(/piece joins a task to a plan/, 'link', l13, 'piece', plan);
  refused(/not an end of finding/, 'end', f5, 'merged', 'r');
  refused(/not an end of finding/, 'end', f5, 'open', 'r');
  refused(/needs a reason/, 'end', f5, 'done', '');
  refused(/must name the record that takes over/, 'end', f5, 'handed-on', 'r');
  refused(/--into task-999 does not resolve/, 'end', f5, 'handed-on', 'r', '--into', 'task-999');
  refused(/no record/, 'revise', 'task-999', '{}', '--reason', 'r');
  // usage: exit 1
  assert.equal(L(['add', 'area', '{}']).code, 1); // no --by
  assert.equal(L(['add', 'area', '{bad', '--by', 'John']).code, 1);
  assert.equal(L(['revise', area, '{}', '--by', 'John']).code, 1); // no --reason
  assert.equal(L(['frobnicate']).code, 1);
  assert.equal(L(['get', area, '--bogus']).code, 1);
  assert.equal(L(['get', area]).code, 1); // queries need --by

  // ---- each command once (writes)
  const rev = ok('revise', area, '{"name":"lib-a"}', '--reason', 'rename', '--by', 'survey-place', '--via', 'autopilot', '--at', at());
  assert.deepEqual([rev.v, rev.op, rev.reason, rev.via, rev.fields.name], [2, 'revise', 'rename', 'autopilot', 'lib-a']);
  assert.equal(ok('revise', parent, '{"asked":"Fix the thing","ref":"LIN-1"}', '--reason', 'same asked', '--by', 'John', '--at', at()).v, 2);
  const lk = ok('link', l13, 'about', area, '--by', 'survey-place', '--at', at());
  ok('link', l13, 'about', task, '--by', 'survey-place', '--at', at());
  assert.deepEqual(ok('get', l13, '--by', 'John').links.about, [area, task]); // list type adds
  assert.equal(lk.op, 'link');

  // ---- views: answered, counts, open-for-reader, overlap
  const qv = ok('get', q, '--by', 'scoping');
  assert.deepEqual(qv.answered, { id: d8, v: 1, answer: 'yes' });
  assert.equal(qv.versions.length, 1);
  assert.equal(ok('find', '--to', 'implementation', '--state', 'open', '--by', 'implementation')[0].id, f5);
  assert.deepEqual(ok('find', '--kind', 'finding', '--count', '--by', 'John'), { count: 3 });
  assert.deepEqual(ok('find', '--kind', 'finding', '--count', '--as-of', new Date(Date.UTC(2026, 0, 1, 0, 4)).toISOString(), '--by', 'John'), { count: 1 });
  assert.deepEqual(ids(ok('find', '--kind', 'run', '--state', 'open', '--path', 'lib/a/b.js', '--by', 'John')), [r15, r16]); // overlap
  assert.deepEqual(ids(ok('find', '--in', task, '--kind', 'finding', '--by', 'John')), [f5, f19].sort());
  assert.deepEqual(ids(ok('find', '--area', area, '--kind', 'lesson', '--by', 'John')), [l13, l14]); // in the area
  assert.deepEqual(ids(ok('find', '--text', 'STAGING', '--by', 'John')), [c18]);
  assert.deepEqual(ids(ok('--by', 'John', '--text', 'yes', 'find', '--kind', 'decision')), [d8]); // flags anywhere

  // ---- stale: linking and ending targets make nothing stale; revising, superseding and transitive do
  const dOnF = add('decision', { answer: 'about f5', in: task, links: { on: f5 } }, 'John');
  const vPlan = add('verdict', { of: 'plan-review', outcome: 'approve', in: parent, links: { on: plan } }, 'plan-review');
  const dT = add('decision', { answer: 'rests on v10', in: task, links: { on: `${v10}@1` } }, 'John');
  ok('link', plan, 'about', area, '--by', 'breakdown', '--at', at());
  ok('end', f5, 'done', 'fixed', '--by', 'implementation', '--at', at());
  for (const id of [dOnF, vPlan, dT, v10]) assert.equal(ok('get', id, '--by', 'John').stale, undefined, id);
  const beforeRevise = at();
  ok('revise', ch, '{"head":"def"}', '--reason', 'new head', '--by', 'implementation', '--at', at());
  assert.deepEqual(ok('get', v10, '--by', 'John').stale, [`on ${ch}@1, now @2`]);
  assert.deepEqual(ok('get', dT, '--by', 'John').stale, [`on ${v10}@1, which is stale`]);
  assert.equal(ok('get', v10, '--as-of', beforeRevise, '--by', 'John').stale, undefined); // as of a time
  assert.equal(ok('get', `${ch}@1`, '--by', 'John').fields.head, 'abc'); // one version
  assert.equal(ok('get', ch, '--as-of', beforeRevise, '--by', 'John').fields.head, 'abc');
  assert.equal(L(['get', ch, '--as-of', '2025-01-01', '--by', 'John']).code, 2);
  const plan2 = add('plan', { says: 'piece one, redone', paths: ['lib/a'], in: parent }, 'breakdown');
  ok('end', plan, 'superseded', 'redone', '--into', plan2, '--by', 'breakdown', '--at', at());
  assert.deepEqual(ok('get', vPlan, '--by', 'John').stale, [`on ${plan}@1, now superseded`]);
  const sh = ok('show', '--task', task, '--by', 'John');
  assert.equal(sh.task.id, task);
  assert.equal(sh.records.find((r) => r.id === f5).state, 'done');
  assert.deepEqual(sh.records.find((r) => r.id === v10).stale, [`on ${ch}@1, now @2`]);
  assert.equal(sh.records.find((r) => r.id === q).answered.id, d8);

  // ---- brief: each part
  const b = ok('brief', 'implementation', '--task', task);
  assert.deepEqual(b.task, { id: task, 'done-when': 'child done', paths: ['lib/a/b.js'] });          // 1
  assert.deepEqual(b.asked, [{ id: parent, asked: 'Fix the thing' }]);                              // 1 (ancestors verbatim)
  assert.equal(b.piece.id, plan2); assert.deepEqual(b.replaced, [plan]);                             // 2
  assert.deepEqual(ids(b.addressed), [f6]);                                                          // 3 (f5 ended)
  assert.deepEqual(ids(b.stands), [d12, d8, dOnF, dT, v10, v11, vPlan].sort());                           // 4
  assert.deepEqual(b.stands.find((r) => r.id === v10).links.on, [`${ch}@1`]);
  assert.deepEqual(b.stands.find((r) => r.id === vPlan).stale, [`on ${plan}@1, now superseded`]); // on the replaced piece
  assert.deepEqual(b.areas, [{ id: area, name: 'lib-a', open: 1 }]);                                 // 5
  assert.deepEqual(ids(b.runs), [r16]);                                                              // 6
  assert.deepEqual(ids(b.index), [ch, f19, l13, q, r15].sort());                                     // 7
  assert.equal(b.index.find((r) => r.id === f19).line, 'for review');
  assert.deepEqual(b.carries, { asked: 1, piece: 1, addressed: 1, stands: 7, areas: 1, runs: 1, index: 5 });
  assert.ok(b.bytes > 100);
  assert.ok(!JSON.stringify(b).includes(l14) && !JSON.stringify(b).includes(r17) && !JSON.stringify(b).includes(c18));
  const blind = ok('brief', 'blind-read', '--task', task);
  assert.ok(!ids(blind.stands).includes(v10) && ids(blind.stands).includes(v11));                    // blind actor
  assert.deepEqual(ids(blind.runs), [r15, r16]);                                                     // other actor's run on this task shows
  const old = ok('brief', 'implementation', '--task', task, '--as-of', afterSetup);
  assert.equal(old.piece.id, plan); assert.deepEqual(ids(old.addressed), [f5, f6]);
  const txt = L(['--text', 'brief', 'implementation', '--task', task]);
  assert.equal(txt.code, 0);
  assert.match(txt.out, /^brief for implementation on task-4\n/);
  assert.match(txt.out, /asked \(task-2\):\nFix the thing/);
  assert.match(txt.out, /STALE: on change-9@1, now @2/);
  assert.match(txt.out, new RegExp(`-- carries .*; ${b.bytes} bytes\\n$`));
  assert.equal(L(['brief', 'implementation', '--task', ch]).code, 2);

  // ---- query log
  const S = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.ok(S.log.some((e) => e.by === 'scoping' && e.cmd === 'get'));
  assert.ok(S.log.some((e) => e.by === 'blind-read' && e.cmd === 'brief'));
  assert.equal(S.records[area].length, 2);
  console.log('ok: all checks passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
