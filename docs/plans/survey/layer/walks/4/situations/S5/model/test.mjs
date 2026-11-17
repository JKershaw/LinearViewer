// Own test (§4): each shape check refusing once, each command once, each view, each part of the brief.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LAYER = new URL('layer.mjs', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'layer-test-'));
const store = join(dir, 'store.json');
const run = (...args) => {
  const r = spawnSync(process.execPath, [LAYER, ...args, '--store', store], { encoding: 'utf8' });
  return { code: r.status, out: args.includes('--text') && args.includes('brief') && r.status === 0 ? r.stdout : JSON.parse(r.stdout) };
};
const ok = (...a) => { const r = run(...a); assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const no = (re, ...a) => { const r = run(...a); assert.equal(r.code, 2, `expected refusal ${re}: ${JSON.stringify(r.out)}`); assert.match(r.out.refused, re); };
const add = (kind, j, ...rest) => ok('add', kind, JSON.stringify(j), '--by', 'Harbour', ...rest).id;
const ids = (xs) => xs.map((x) => x.id).sort();
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

try {
  let area, parent, child, plan, change, verdict, f1, f2, q, dec, anc, sib, sibDec, runSib, runOwn, lesson, chk;
  t('add (each kind, --at, --via, --store first)', () => {
    const r = spawnSync(process.execPath, [LAYER, '--store', store, 'add', 'area', '{"name":"lib","paths":["lib/"]}', '--by', 'Harbour', '--via', 'relay', '--at', '2026-01-01T00:00:00Z'], { encoding: 'utf8' });
    const a = JSON.parse(r.stdout);
    assert.equal(a.id, 'area-1'); assert.equal(a.via, 'relay'); assert.equal(a.at, '2026-01-01T00:00:00.000Z'); assert.equal(a.state, 'kept');
    area = a.id;
    parent = add('task', { asked: 'Make it fast', paths: ['lib/'] }, '--at', '2026-01-02T00:00:00Z');
    child = add('task', { in: parent, 'done-when': 'bench < 1s', paths: ['lib/a.js'] }, '--at', '2026-01-03T00:00:00Z');
    plan = add('plan', { in: parent, says: 'Speed up a.js', paths: ['lib/a.js'], order: 1 }, '--at', '2026-01-03T00:00:00Z');
    assert.equal(child, 'task-3'); assert.equal(plan, 'plan-4');
  });
  t('link', () => { const r = ok('link', child, 'piece', plan, '--by', 'breakdown', '--at', '2026-01-04T00:00:00Z'); assert.equal(r.v, 2); assert.equal(r.links.piece, plan); });
  change = add('change', { in: child, ref: 'PR 1', head: 'abc' }, '--at', '2026-01-05T00:00:00Z');
  verdict = add('verdict', { in: child, of: 'review', outcome: 'approve', reasoning: 'ok', links: { on: `${change}@1` } });
  f1 = add('finding', { in: child, to: 'implementation', says: 'Fix the loop\nsecond line' });
  f2 = add('finding', { in: parent, to: child, says: 'From the parent' });
  q = add('question', { in: child, to: 'John', asks: 'Which cache?', options: ['a', 'b'] });
  dec = add('decision', { in: child, answer: 'a', why: 'simpler', links: { answers: q } });
  anc = add('decision', { in: parent, answer: 'no new deps', why: 'policy', scope: parent });
  sib = add('task', { in: parent, paths: ['lib/b'] });
  sibDec = add('decision', { in: sib, answer: 'sibling call', why: 'x' });
  runSib = add('run', { in: sib, stage: 'implementation', claims: ['lib/a.js'] });
  runOwn = add('run', { in: child, stage: 'implementation', claims: ['lib/'] });
  lesson = add('lesson', { in: area, says: 'a.js is hot', paths: ['lib/a.js'], 'checked-at': 'abc' });
  chk = add('check', { in: child, to: area, what: 'run bench', 'why-person': 'needs prod', how: 'npm run bench' });

  t('shape checks refuse', () => {
    no(/kind widget is not declared/, 'add', 'widget', '{}', '--by', 'John');
    no(/says is not a field of task/, 'add', 'task', '{"says":"x"}', '--by', 'John');
    no(/paths must be strings/, 'add', 'task', '{"paths":"lib"}', '--by', 'John');
    no(/outcome approve is not in the set of blind-read/, 'add', 'verdict', JSON.stringify({ of: 'blind-read', outcome: 'approve', links: { on: `${change}@1` } }), '--by', 'John');
    no(/asked is fixed/, 'revise', parent, '{"asked":"Other words"}', '--reason', 'r', '--by', 'John');
    no(/by Nobody is not a declared actor/, 'add', 'task', '{}', '--by', 'Nobody');
    no(/finding needs a to/, 'add', 'finding', '{"says":"x"}', '--by', 'John');
    no(/finding needs a to/, 'add', 'finding', JSON.stringify({ says: 'x', to: plan }), '--by', 'John');
    no(/plan takes no to/, 'add', 'plan', '{"to":"John"}', '--by', 'John');
    no(/in must be a task or an area/, 'add', 'plan', JSON.stringify({ in: plan }), '--by', 'John');
    no(/does not resolve/, 'add', 'plan', '{"links":{"about":"task-99"}}', '--by', 'John');
    no(/does not resolve/, 'add', 'plan', JSON.stringify({ links: { about: `${plan}@9` } }), '--by', 'John');
    no(/not a link type/, 'link', plan, 'cites', parent, '--by', 'John');
    no(/needs an on link/, 'add', 'verdict', '{"of":"review","outcome":"approve"}', '--by', 'John');
    no(/on must name a version/, 'add', 'verdict', JSON.stringify({ of: 'review', outcome: 'approve', links: { on: change } }), '--by', 'John');
    no(/answers joins a decision to a question/, 'add', 'decision', JSON.stringify({ links: { answers: parent } }), '--by', 'John');
    no(/piece joins a task to a plan/, 'link', child, 'piece', change, '--by', 'John');
    no(/merged is not an end of task/, 'end', child, 'merged', 'r', '--by', 'John');
    no(/handed-on must name the record that takes over/, 'end', chk, 'handed-on', 'r', '--by', 'John');
    no(/state is set by the store/, 'add', 'task', '{"state":"done"}', '--by', 'John');
    assert.equal(run('add', 'task', '{}').code, 1); // no --by: usage
    assert.equal(run('frobnicate').code, 1);
  });

  t('brief, each part', () => {
    const b = ok('brief', 'implementation', '--task', child);
    assert.deepEqual(b.words, [{ id: parent, asked: 'Make it fast' }]); // 1: ancestors' words; a child task has none
    assert.deepEqual(ids(b.piece), [plan]); // 2
    assert.deepEqual(ids(b.addressed), [f1, f2].sort()); // 3: in task to actor + anywhere to task
    assert.deepEqual(ids(b.stands), [anc, dec, verdict].sort()); // 4: no sibling decision
    assert.ok(!ids(b.stands).includes(sibDec));
    assert.deepEqual(b.areas, [{ id: area, name: 'lib', open: 1 }]); // 5
    assert.deepEqual(b.runs.map((r) => r.id), [runSib]); // 6: other tasks only
    assert.deepEqual(b.index.map((s) => s.split(' ')[0]).sort(), [change, chk, lesson, q, runOwn].sort()); // 7
    assert.ok(b.index.includes(`${chk} check ${area} run bench`));
    assert.deepEqual(b.carries, { words: 1, piece: 1, addressed: 2, stands: 3, areas: 1, runs: 1, index: 5 });
    assert.ok(b.bytes > 0);
    const txt = ok('--text', 'brief', 'implementation', '--task', child);
    assert.match(txt, /Make it fast/); assert.match(txt, /## 7\. Index/); assert.match(txt, new RegExp(`${b.bytes} bytes`));
  });

  t('views: answered, open-for-reader, counts, overlap', () => {
    assert.equal(ok('get', q, '--by', 'John').answered.id, dec);
    assert.deepEqual(ids(ok('find', '--to', 'implementation', '--state', 'open', '--by', 'John')), [f1]);
    assert.deepEqual(ok('find', '--kind', 'finding', '--count', '--by', 'John'), { count: 2 });
    const s = ok('show', '--task', child, '--by', 'review');
    assert.ok(ids(s.records).includes(verdict)); assert.deepEqual(s.overlap, [[runSib, runOwn]]);
  });

  t('revise, stale (revised, recursive, bad end, ended well)', () => {
    const d2 = add('decision', { in: child, answer: 'ship', why: 'approved', links: { on: `${verdict}@1` } });
    const r = ok('revise', change, '{"head":"def"}', '--reason', 'new head', '--by', 'implementation');
    assert.equal(r.v, 2); assert.equal(r.reason, 'new head'); assert.equal(r.ref, 'PR 1');
    assert.equal(ok('get', verdict, '--by', 'John').stale, true);
    assert.equal(ok('get', d2, '--by', 'John').stale, true); // rests on a stale record
    assert.equal(ok('brief', 'implementation', '--task', child).stands.find((x) => x.id === verdict).stale, true);
    const v2 = add('verdict', { in: child, of: 'review', outcome: 'approve', links: { on: `${change}@2` } });
    const onPlan = add('verdict', { of: 'plan-review', outcome: 'approve', links: { on: `${plan}@1` } });
    ok('end', change, 'merged', 'landed', '--by', 'close-out');
    assert.equal(ok('get', v2, '--by', 'John').stale, undefined); // ending well makes nothing stale
    const plan2 = add('plan', { in: parent, says: 'v2' });
    ok('end', plan, 'superseded', 'replaced', '--into', plan2, '--by', 'breakdown');
    assert.equal(ok('get', onPlan, '--by', 'John').stale, true);
  });

  t('end, get @v, as-of, find filters, query log', () => {
    const e = ok('end', f1, 'handed-on', 'moved', '--into', f2, '--by', 'implementation');
    assert.equal(e.state, 'handed-on'); assert.equal(e.into, f2); assert.equal(e.stateReason, 'moved');
    assert.ok(!ids(ok('brief', 'implementation', '--task', child).addressed).includes(f1)); // ended left out
    assert.equal(ok('get', `${child}@1`, '--by', 'John').links.piece, undefined);
    assert.equal(ok('get', child, '--by', 'John').versions.length, 2);
    assert.equal(ok('get', child, '--as-of', '2026-01-03T12:00:00Z', '--by', 'John').versions.length, 1);
    assert.equal(run('get', plan, '--as-of', '2026-01-02T12:00:00Z', '--by', 'John').code, 2);
    assert.deepEqual(ok('find', '--kind', 'task', '--count', '--as-of', '2026-01-02T12:00:00Z', '--by', 'John'), { count: 1 });
    assert.deepEqual(ok('brief', 'implementation', '--task', child, '--as-of', '2026-01-03T12:00:00Z').piece, []);
    assert.deepEqual(ids(ok('find', '--in', sib, '--by', 'John')), [runSib, sibDec].sort());
    assert.ok(ids(ok('find', '--path', 'lib/b/x.js', '--by', 'John')).includes(sib));
    assert.ok(ids(ok('find', '--area', area, '--kind', 'lesson', '--by', 'John')).includes(lesson));
    assert.deepEqual(ids(ok('find', '--text', 'CACHE', '--by', 'John')), [q]);
    assert.equal(run('find').code, 1); // queries need --by
    const log = JSON.parse(readFileSync(store, 'utf8')).log;
    assert.ok(log.length > 10 && log.some((l) => l.by === 'review' && l.q[0] === 'show'));
    assert.ok(!log.some((l) => l.q.includes('--store')));
  });
  console.log(`\n${n} groups passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
