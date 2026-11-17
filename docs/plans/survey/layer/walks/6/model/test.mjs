// node test.mjs — each shape check refusing once, each command once, each view, each brief part.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
const store = path.join(dir, 'store.json');
const layer = new URL('layer.mjs', import.meta.url).pathname;
let tick = 0, n = 0;
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
const run = (...a) => {
  const r = spawnSync(process.execPath, [layer, '--store', store, ...a], { encoding: 'utf8' });
  let out; try { out = JSON.parse(r.stdout); } catch { out = r.stdout; }
  return { code: r.status, out, err: r.stderr };
};
const ok = (...a) => { const r = run(...a); assert.equal(r.code, 0, `${a.join(' ')} → ${JSON.stringify(r.out)} ${r.err}`); n++; return r.out; };
const w = (by, ...a) => ok(...a, '--by', by, '--at', at()).id;
const refused = (re, ...a) => {
  const r = run(...a, ...(a.includes('--by') ? [] : ['--by', 'John']));
  assert.equal(r.code, 2, `${a.join(' ')} should refuse: ${JSON.stringify(r.out)} ${r.err}`);
  assert.match(r.out.refused, re); n++;
};
const J = JSON.stringify;

try {
  // usage
  assert.equal(run().code, 1); assert.equal(run('add', 'task', '{bad').code, 1); assert.equal(run('frob').code, 1);
  assert.equal(run('revise', 'x', '{}', '--by', 'John').code, 1); // no --reason

  // writes; flags anywhere (--by before the command)
  const area = w('John', 'add', 'area', J({ name: 'lib', paths: ['lib'] }));
  assert.equal(area, 'area-1');
  const parent = w('John', 'add', 'task', J({ asked: 'Fix the parser.\nKeep it small.', 'done-when': 'tests pass', paths: ['lib/a'], ref: 'LIN-1' }));
  const child = ok('--by', 'breakdown', 'add', 'task', J({ in: parent, 'done-when': 'b fixed', paths: ['lib/a/b.js'] }), '--at', at()).id;
  assert.equal(child, 'task-3');
  const piece = w('breakdown', 'add', 'plan', J({ in: parent, says: 'Fix b first', paths: ['lib/a/b.js'], order: 1 }));
  const kept = w('breakdown', 'add', 'plan', J({ in: parent, says: 'Then c', order: 2 }));

  // §3.3 each shape check refusing once
  refused(/unknown kind/, 'add', 'widget', '{}');
  refused(/has no field/, 'add', 'task', J({ colour: 'red' }));
  refused(/paths must be list/, 'add', 'task', J({ paths: 'lib' }));
  refused(/outcome/, 'add', 'verdict', J({ of: 'review', outcome: 'better', links: { on: piece } }));
  refused(/fixed once written/, 'revise', parent, J({ asked: 'something else' }), '--reason', 'x');
  refused(/not a declared actor/, 'add', 'task', '{}', '--by', 'nobody');
  refused(/to: nobody/, 'add', 'finding', J({ says: 'x', to: 'nobody' }));
  refused(/needs a to/, 'add', 'finding', J({ says: 'x' }));
  refused(/not a task or area/, 'add', 'finding', J({ says: 'x', to: 'John', in: piece }));
  refused(/does not resolve/, 'add', 'finding', J({ says: 'x', to: 'John', links: { about: 'task-99' } }));
  refused(/does not resolve/, 'add', 'finding', J({ says: 'x', to: 'John', links: { about: `${piece}@7` } }));
  refused(/needs an on link/, 'add', 'verdict', J({ of: 'review', outcome: 'approve' }));
  refused(/answers joins/, 'add', 'decision', J({ answer: 'y', links: { answers: parent } }));
  refused(/piece joins/, 'link', child, 'piece', parent);
  refused(/unknown link type/, 'link', child, 'nearby', parent);
  refused(/not an end/, 'end', parent, 'merged', 'why');
  refused(/needs a reason/, 'end', parent, 'done', '');
  refused(/must name the record/, 'end', kept, 'superseded', 'replaced');
  refused(/task-or-area/, 'add', 'decision', J({ answer: 'y', scope: piece }));

  // link: single type replaces, list type adds; JSON links may be single or list
  w('breakdown', 'link', child, 'piece', kept);
  w('breakdown', 'link', child, 'piece', piece);
  assert.equal(ok('get', child).links.piece, piece);
  const verdict = w('plan-review', 'add', 'verdict', J({ in: parent, of: 'plan-review', outcome: 'approve', reasoning: 'fine', links: { on: piece, about: [parent] } }));
  assert.deepEqual(ok('get', verdict).links.on, [`${piece}@1`]); // pinned to the current version
  w('plan-review', 'link', verdict, 'about', child);
  assert.deepEqual(ok('get', verdict).links.about, [parent, child]);
  const tBeforeRevise = at();

  // revise → stale; get with versions, get @v, --as-of
  w('breakdown', 'revise', piece, J({ says: 'Fix b first, with a test' }), '--reason', 'clarified');
  let g = ok('get', verdict);
  assert.deepEqual(g.stale, [`on ${piece}@1, now @2`]);
  g = ok('get', piece); assert.equal(g.versions.length, 2); assert.equal(g.versions[1].reason, 'clarified');
  assert.equal(ok('get', `${piece}@1`).fields.says, 'Fix b first');
  assert.equal(ok('get', piece, '--as-of', tBeforeRevise).fields.says, 'Fix b first');
  assert.equal(ok('get', verdict, '--as-of', tBeforeRevise).stale, undefined);
  w('breakdown', 'revise', piece, J({ to: 'implementation' }), '--reason', 'route it'); // not content: still @2-stale only
  assert.deepEqual(ok('get', verdict).stale, [`on ${piece}@1, now @3`]);
  const v2 = w('review', 'add', 'verdict', J({ in: child, of: 'review', outcome: 'approve-with-notes', links: { on: `${piece}@3` } }));
  assert.equal(ok('get', v2).stale, undefined);

  // records for the brief of implementation on the child task
  const runRev = w('review', 'add', 'run', J({ in: child, stage: 'review', claims: ['lib/a/b.js'] }));
  const fMine = w('review', 'add', 'finding', J({ in: child, says: 'b.js leaks\nmore detail', to: 'implementation' }));
  const fLeft = w('implementation', 'add', 'finding', J({ in: child, says: 'review: look again', to: 'review' }));
  const fTask = w('John', 'add', 'finding', J({ in: parent, says: 'for the child task', to: child }));
  const chk = w('implementation', 'add', 'check', J({ in: child, what: 'run on prod', 'why-person': 'needs creds', to: 'John' }));
  const q = w('implementation', 'add', 'question', J({ in: child, asks: 'Keep the old API?', options: ['yes', 'no'], to: 'John' }));
  const dec = w('John', 'add', 'decision', J({ in: child, answer: 'yes', why: 'callers', links: { answers: [q] } }));
  const decScope = w('John', 'add', 'decision', J({ in: parent, answer: 'no new deps', scope: parent }));
  const decArea = w('John', 'add', 'decision', J({ in: area, answer: 'lib stays pure', scope: area }));
  const decOther = w('John', 'add', 'decision', J({ in: parent, answer: 'unrelated' }));
  const lesson = w('survey-place', 'add', 'lesson', J({ in: area, says: 'b.js is hot', paths: ['lib/a'], 'checked-at': 'abc123' }));
  w('survey-place', 'add', 'lesson', J({ in: area, says: 'not here', paths: ['lib/ab'] }));
  const fArea = w('John', 'add', 'finding', J({ says: 'area note', to: area }));
  w('review', 'end', runRev, 'done', 'reviewed');
  w('review', 'revise', runRev, J({ account: 'Reviewed b.js.\nOne finding left.' }), '--reason', 'account');
  const runImp = w('implementation', 'add', 'run', J({ in: child, stage: 'implementation', claims: ['lib/a/b.js'] }));
  const runOther = w('leftover', 'add', 'run', J({ in: parent, stage: 'leftover', claims: ['lib/a'] }));
  w('leftover', 'add', 'run', J({ in: parent, claims: ['docs'] }));
  const fGone = w('review', 'add', 'finding', J({ in: child, says: 'gone', to: 'implementation' }));
  w('implementation', 'end', fGone, 'handed-on', 'moved', '--into', fMine, '--via', 'autopilot');
  assert.equal(ok('get', fGone).ended.into, fMine);
  assert.equal(ok('get', fGone).versions.at(-1).via, 'autopilot');

  // views
  assert.deepEqual(ok('get', q).answered.map((a) => a.id), [dec]);
  assert.deepEqual(ok('get', runImp).overlaps, [runOther]);
  assert.deepEqual(ok('find', '--to', 'John', '--state', 'open').map((r) => r.id).sort(), [chk, q].sort()); // open for a reader
  assert.equal(ok('find', '--kind', 'task', '--count').count, 2);
  assert.equal(ok('find', '--kind', 'task', '--count', '--as-of', '2026-01-01T00:00:01Z').count, 1);
  assert.deepEqual(ok('find', '--in', child, '--kind', 'question').map((r) => r.id), [q]);
  assert.equal(ok('find', '--path', 'lib/ab', '--kind', 'task', '--count').count, 0); // whole segments
  assert.equal(ok('find', '--path', 'lib', '--kind', 'task', '--count').count, 2);
  assert.ok(ok('find', '--area', area).some((r) => r.id === lesson));
  assert.deepEqual(ok('--text', 'LEAKS', 'find').map((r) => r.id), [fMine]); // --text before the command
  const sh = ok('show', '--task', child);
  assert.equal(sh.task.id, child); assert.ok(sh.records.some((r) => r.id === fGone && r.state === 'handed-on'));

  // brief: every part
  const b = ok('brief', 'implementation', '--task', child);
  assert.deepEqual(b.task, { id: child, ref: null, 'done-when': 'b fixed', paths: ['lib/a/b.js'] });
  assert.deepEqual(b.asked, [{ id: parent, asked: 'Fix the parser.\nKeep it small.' }]); // 1
  assert.deepEqual(b.plan.map((r) => r.id), [piece]); // 2
  assert.deepEqual(b.addressed.map((r) => r.id).sort(), [fMine, fLeft, fTask].sort()); // 3 (fGone ended: left out)
  const st = b.stands.map((r) => r.id);
  for (const id of [verdict, v2, dec, decScope, decArea]) assert.ok(st.includes(id), `stands has ${id}`); // 4
  assert.ok(!st.includes(decOther));
  assert.ok(b.stands.find((r) => r.id === verdict).stale);
  assert.deepEqual(b.areas, [{ id: area, name: 'lib', open: 1 }]); // 5
  assert.deepEqual(b.runs.map((r) => r.id), [runOther]); // 6
  assert.deepEqual(b.index.map((i) => i.id).sort(), [chk, q, lesson, runImp].sort()); // 7 (its own open run is an open record in the task)
  assert.equal(b.index.find((i) => i.id === lesson).says, 'b.js is hot');
  assert.deepEqual(b.account, { run: runRev, by: 'review', account: 'Reviewed b.js.\nOne finding left.' }); // 8
  assert.equal(b.carries.addressed, 3); assert.ok(b.bytes > 0);
  // blind: leaves out verdicts other than its own, in the brief and in queries
  const bb = ok('brief', 'blind-read', '--task', child);
  assert.ok(!bb.stands.some((r) => r.kind === 'verdict'));
  assert.equal(ok('find', '--kind', 'verdict', '--count', '--by', 'blind-read').count, 0);
  assert.equal(run('get', verdict, '--by', 'blind-read').code, 2);
  // superseded piece: the brief follows the record that took over
  const piece2 = w('breakdown', 'add', 'plan', J({ in: parent, says: 'Fix b, new approach' }));
  w('breakdown', 'end', piece, 'superseded', 'new approach', '--into', piece2);
  const b2 = ok('brief', 'implementation', '--task', child);
  assert.deepEqual(b2.plan.map((r) => r.id), [piece2]);
  assert.deepEqual(b2.stands.find((r) => r.id === verdict).stale, [`on ${piece}@1, now superseded`]);
  // the parent's brief, with no piece: every kept plan in it
  assert.deepEqual(ok('brief', 'design', '--task', parent).plan.map((r) => r.id).sort(), [kept, piece2].sort());
  // --as-of brief and --text
  assert.equal(ok('brief', 'implementation', '--task', child, '--as-of', tBeforeRevise).account, null);
  const txt = run('brief', '--text', 'implementation', '--task', child);
  assert.equal(txt.code, 0); assert.match(txt.out, /## 8\. The previous stage's account\nrun-\d+ by review:\nReviewed b\.js\./);
  assert.match(txt.out, /carries: asked 1, .*; \d+ bytes\n$/);
  n += 8;

  // store format and the query log
  const S = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.deepEqual(Object.keys(S), ['next', 'records', 'log']);
  const v1 = S.records[piece][0];
  assert.deepEqual(Object.keys(v1), ['id', 'kind', 'v', 'op', 'at', 'by', 'in', 'state', 'links', 'fields']);
  assert.ok(S.log.some((l) => l.cmd === 'brief' && l.by === 'blind-read'));
  assert.ok(S.log.some((l) => l.cmd === 'find' && l.asOf === '2026-01-01T00:00:01.000Z'));
  assert.ok(S.log.every((l) => ['get', 'find', 'show', 'brief'].includes(l.cmd)));
  console.log(`ok — ${n} checks passed`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
