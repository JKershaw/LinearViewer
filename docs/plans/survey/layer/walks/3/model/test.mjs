// The model's own test (SPEC §4): each rule in each mode, each command, the stale flag,
// the brief's seven parts, and each query. Uses a temporary store and removes it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const LAYER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'layer.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
let store, minute = 0, passed = 0;
const T = n => new Date(Date.UTC(2026, 10, 1, 10, n)).toISOString();

function run(args) {
  try {
    const o = execFileSync('node', [LAYER, ...args, '--store', store], { encoding: 'utf8' });
    try { return { code: 0, out: JSON.parse(o) }; } catch { return { code: 0, out: o }; }
  } catch (e) { return { code: e.status, out: JSON.parse(e.stdout) }; }
}
const ok = (...a) => { const r = run(a); assert.equal(r.code, 0, `${a.join(' ')} -> ${JSON.stringify(r.out)}`); passed++; return r.out; };
const W = (...a) => ok(...a, '--at', T(++minute)); // writes, one minute apart
const refused = (rule, ...a) => { const r = run([...a, '--at', T(++minute)]); assert.equal(r.code, 2, `${a.join(' ')} should be refused`); assert.ok(r.out.refused.some(p => p.rule === rule), JSON.stringify(r.out)); passed++; };
const hit = (rule, ...a) => { const before = ok('hits').hits.length; const rec = W(...a); const h = ok('hits').hits.slice(before); assert.ok(h.some(p => p.rule === rule), `${a.join(' ')} should log rule ${rule}: ${JSON.stringify(h)}`); return rec; };
const j = JSON.stringify;
const id = r => r.id;

// A store's skeleton: an area, a task, a child task and its piece.
function seed() {
  const area = id(W('add', 'area', j({ name: 'lib', paths: ['lib/'] }), '--by', 'Harbour'));
  const task = id(W('add', 'task', j({ asked: 'Make X fast', paths: ['lib/x.js'], in: area }), '--by', 'John'));
  const child = id(W('add', 'task', j({ 'done-when': 'tests pass', paths: ['lib/x.js'], in: task }), '--by', 'breakdown'));
  const piece = id(W('add', 'plan', j({ says: 'Cache X\nthen measure', paths: ['lib/x.js'], in: task }), '--by', 'breakdown'));
  W('link', child, 'piece', piece, '--by', 'breakdown');
  return { area, task, child, piece };
}

try {
  // ================= strict mode =================
  store = path.join(dir, 'strict.json');
  const { area, task, child, piece } = seed();
  assert.equal(ok('hits').retro, false);

  // §3.2 field checks: a child's asked is empty; asked is fixed; outcome from its set.
  refused('3.2', 'add', 'task', j({ asked: 'no', in: task }), '--by', 'breakdown');
  refused('3.2', 'revise', task, j({ asked: 'other words' }), '--reason', 'r', '--by', 'John');
  refused('3.2', 'add', 'verdict', j({ of: 'plan-review', outcome: 'better', in: child }), '--by', 'plan-review');

  // Rule 5: by must be declared, a stage adds only its kinds, links must resolve.
  refused('5', 'add', 'finding', j({ says: 'x', to: 'John', in: child }), '--by', 'Nobody');
  refused('5', 'add', 'lesson', j({ says: 'x', in: area }), '--by', 'review');
  refused('5', 'add', 'decision', j({ answer: 'x', links: { about: 'nothing-99' } }), '--by', 'scoping');

  // Rule 4: hand-off kinds need a valid to; handed-on/superseded need the record that takes over.
  refused('4', 'add', 'finding', j({ says: 'x', in: child }), '--by', 'review');
  refused('4', 'add', 'check', j({ what: 'x', to: 'nowhere', in: child }), '--by', 'review');

  // A verdict on the piece, a decision resting on the verdict.
  const verdict = id(W('add', 'verdict', j({ of: 'plan-review', outcome: 'approve', reasoning: 'sound', in: child, links: { on: piece } }), '--by', 'plan-review'));
  const decision = id(W('add', 'decision', j({ answer: 'go', why: 'approved', in: child, links: { on: verdict } }), '--by', 'scoping'));
  assert.equal(ok('get', verdict, '--by', 'John').links.on, `${piece}@1`);
  const beforeRevise = T(minute);

  // Rule 2: a finding about the piece can't end done until the piece is revised after it.
  const fnd = id(W('add', 'finding', j({ says: 'measure first', to: 'implementation', in: child, links: { about: piece } }), '--by', 'review'));
  refused('2', 'end', fnd, 'done', 'fixed', '--by', 'implementation', '--task', child);

  // Rule 6: implementation revises only its task's piece; a stranger may not end a verdict.
  refused('6', 'revise', piece, j({ says: 'x' }), '--reason', 'r', '--by', 'implementation', '--task', task);
  refused('6', 'end', verdict, 'withdrawn', 'no', '--by', 'leftover');
  W('revise', piece, j({ says: 'Measure X\nthen cache' }), '--reason', 'measure first', '--by', 'implementation', '--task', child);
  W('end', fnd, 'done', 'piece revised', '--by', 'implementation', '--task', child);

  // Stale: verdict rests on a revised version; decision is stale through it.
  let sh = ok('show', '--task', child, '--by', 'John');
  const flag = (s, i) => s.records.find(r => r.id === i).stale;
  assert.equal(flag(sh, verdict), true);
  assert.equal(flag(sh, decision), true);
  assert.deepEqual(ok('check').stale.sort(), [decision, verdict].sort());
  // --as-of reads versions as they stood: before the revise nothing was stale.
  sh = ok('show', '--task', child, '--as-of', beforeRevise, '--by', 'John');
  assert.equal(flag(sh, verdict), false);
  assert.ok(!sh.records.some(r => r.id === fnd));
  assert.equal(ok('get', piece, '--as-of', beforeRevise, '--by', 'John').fields.says, 'Cache X\nthen measure');
  // Re-affirming (re-linking on the current version) clears it.
  W('link', verdict, 'on', piece, '--by', 'plan-review');
  assert.equal(ok('get', decision, '--by', 'John').stale, false);

  // Ending well doesn't make anything stale; superseded/abandoned do.
  const change = id(W('add', 'change', j({ ref: 'PR 1', head: 'aaa', in: child }), '--by', 'implementation'));
  const rv = id(W('add', 'verdict', j({ of: 'review', outcome: 'approve', in: child, links: { on: change } }), '--by', 'review'));
  W('end', change, 'merged', 'shipped', '--by', 'close-out', '--task', child);
  assert.equal(ok('get', rv, '--by', 'John').stale, false);
  const d2 = id(W('add', 'decision', j({ answer: 'keep cache', in: child, links: { on: decision } }), '--by', 'scoping'));
  refused('4', 'end', decision, 'superseded', 'replaced', '--by', 'scoping');
  const d3 = id(W('add', 'decision', j({ answer: 'go, measured', in: child }), '--by', 'scoping'));
  W('end', decision, 'superseded', 'replaced', '--to', d3, '--by', 'scoping');
  assert.equal(ok('get', d2, '--by', 'John').stale, true);

  // Rules 3 and 7: answering ends the question by the layer; a second decision is refused.
  const q = id(W('add', 'question', j({ asks: 'A or B?', options: ['A', 'B'], recommended: 'A', to: 'John', in: child }), '--by', 'survey-task'));
  W('add', 'decision', j({ answer: 'A', in: child, links: { answers: q } }), '--by', 'John');
  const qr = ok('get', q, '--by', 'John');
  assert.equal(qr.state, 'answered');
  assert.equal(qr.by, 'layer');
  refused('3', 'add', 'decision', j({ answer: 'B', in: child, links: { answers: q } }), '--by', 'John');

  // Area finding, lesson, and the place role.
  const af = id(W('add', 'finding', j({ says: 'lib has no benchmarks', to: area }), '--by', 'leftover'));
  const af2 = id(W('add', 'finding', j({ says: 'lib logging is noisy', to: area }), '--by', 'leftover'));
  const lesson = id(W('add', 'lesson', j({ says: 'x.js is hot\nmeasure before caching', paths: ['lib/'], in: area }), '--by', 'survey-place'));
  const run1 = id(W('add', 'run', j({ stage: 'implementation', claims: ['lib/x.js'], account: 'cached X', in: child }), '--by', 'implementation'));
  const forDesign = id(W('add', 'finding', j({ says: 'consider a design note', to: 'design', in: child }), '--by', 'review'));
  const toTask = id(W('add', 'finding', j({ says: 'add a test', to: child, in: task }), '--by', 'review'));
  const chk = id(W('add', 'check', j({ what: 'run on prod data', to: 'John', in: child }), '--by', 'review'));

  // Brief for implementation: all seven parts (6 absent for a non-place stage).
  let b = ok('brief', 'implementation', '--task', child);
  assert.deepEqual(b.words, [{ task: child, asked: '' }, { task, asked: 'Make X fast' }]);   // 1
  assert.equal(b.piece.id, piece); assert.equal(b.piece.v, 2);                                  // 2
  assert.deepEqual(b.addressed.map(id), [toTask]);                                             // 3 (to the task)
  assert.ok(b.stands.some(r => r.id === d2 && r.stale) && b.stands.some(r => r.id === rv));     // 4 with flag
  assert.ok(!b.stands.some(r => r.id === decision));                                           // superseded left out
  assert.deepEqual(b.areas, [{ id: area, name: 'lib' }]);                                      // 5
  assert.equal(b.areaFindings, undefined);                                                     // 6 only for place
  const idx = b.index.map(id);                                                                 // 7
  assert.ok(idx.includes(run1) && idx.includes(lesson) && idx.includes(forDesign) && idx.includes(chk));
  assert.ok(!idx.includes(af) && !idx.includes(verdict) && !idx.includes(fnd));                // rule 0 / area findings out
  assert.equal(b.index.find(l => l.id === lesson).says, 'x.js is hot');
  assert.ok(b.size.jsonBytes > 0 && b.carries.index === b.index.length);
  b = ok('brief', 'design', '--task', child);
  assert.ok(b.addressed.some(r => r.id === forDesign));                                        // 3 (to the stage)
  b = ok('brief', 'survey-place', '--task', child);
  assert.deepEqual(b.areaFindings.map(id).sort(), [af, af2].sort());                           // 6
  const text = ok('brief', 'survey-place', '--task', child, '--text');
  assert.match(text, /6\. Its areas' open findings/); assert.match(text, /STALE/); assert.match(text, /Size: \d+ bytes/);
  // Part 5 with no matching area says so.
  const lone = id(W('add', 'task', j({ asked: 'Docs', paths: ['docs/'] }), '--by', 'John'));
  b = ok('brief', 'design', '--task', lone);
  assert.equal(b.areas.length, 0); assert.match(b.areasNote, /no area/);

  // Rule 6, the area rules: re-addressing to the task is for the place stage; a stage of a task
  // in the area may end that area's findings its work settled.
  refused('6', 'revise', af, j({ to: child }), '--reason', 'r', '--by', 'implementation', '--task', child);
  W('revise', af, j({ to: child }), '--reason', 'belongs to this task', '--by', 'survey-place', '--task', child);
  assert.ok(ok('brief', 'review', '--task', child).addressed.some(r => r.id === af));
  refused('6', 'end', af2, 'done', 'settled', '--by', 'review', '--task', lone);
  W('end', af2, 'done', 'settled by the logging change', '--by', 'review', '--task', child);

  // Rule 1: a task can't close while records addressed to it are open.
  refused('1', 'end', child, 'done', 'complete', '--by', 'close-out', '--task', child);
  for (const r of [toTask, af]) W('end', r, 'done', 'handled', '--by', 'John');
  W('end', child, 'done', 'complete', '--by', 'close-out', '--task', child);

  // Queries: find by each filter, get, show; each logged with who asked.
  assert.deepEqual(ok('find', '--kind', 'lesson', '--by', 'implementation').map(id), [lesson]);
  assert.ok(ok('find', '--area', area, '--by', 'survey-place').some(r => r.id === lesson));
  assert.ok(ok('find', '--path', 'lib/x.js', '--by', 'review').some(r => r.id === run1));
  assert.deepEqual(ok('find', '--to', 'John', '--state', 'open', '--by', 'John').map(id), [chk]);
  assert.deepEqual(ok('find', '--text', 'BENCHMARKS', '--by', 'John').map(id), [af]);
  assert.ok(ok('get', piece, '--by', 'review').versions.length >= 2);
  const log = JSON.parse(fs.readFileSync(store, 'utf8')).queries;
  assert.ok(log.length >= 10 && log.every(x => x.by && x.query));
  assert.ok(log.some(x => x.query === 'find' && x.by === 'survey-place' && x.args.area === area));
  assert.equal(run(['get', piece]).code, 1); // a query without --by is refused
  assert.deepEqual(ok('check').problems, []);

  // ================= retro mode =================
  store = path.join(dir, 'retro.json');
  ok('hits', '--retro');
  const s = seed();
  assert.equal(ok('hits').retro, true);
  hit('5', 'add', 'lesson', j({ says: 'x', in: s.area }), '--by', 'review');
  hit('4', 'add', 'finding', j({ says: 'no addressee', in: s.child }), '--by', 'review');
  const rf = id(W('add', 'finding', j({ says: 'measure', to: 'implementation', in: s.child, links: { about: s.piece } }), '--by', 'review'));
  hit('2', 'end', rf, 'done', 'early', '--by', 'implementation', '--task', s.child);
  hit('6', 'revise', rf, j({ says: 'x' }), '--reason', 'r', '--by', 'leftover'); // neither writer nor addressee
  const rq = id(W('add', 'question', j({ asks: '?', to: 'John', in: s.child }), '--by', 'survey-task'));
  W('add', 'decision', j({ answer: 'yes', links: { answers: rq } }), '--by', 'John');
  assert.equal(ok('get', rq, '--by', 'John').state, 'answered');                              // rule 7
  hit('3', 'add', 'decision', j({ answer: 'no', links: { answers: rq } }), '--by', 'John');
  W('add', 'check', j({ what: 'x', to: s.child, in: s.child }), '--by', 'review');
  hit('1', 'end', s.child, 'done', 'early', '--by', 'close-out', '--task', s.child);
  assert.equal(ok('get', s.child, '--by', 'John').state, 'done');                            // went through
  const probs = ok('check').problems.map(p => p.rule);
  for (const r of ['1', '2', '3', '4', '5']) assert.ok(probs.includes(r), `check finds rule ${r}`);

  console.log(`ok: ${passed} commands checked`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
