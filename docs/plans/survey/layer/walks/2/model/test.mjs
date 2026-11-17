// The model's own test (SPEC §4): each rule once in each mode, each command, the stale flag,
// each of the brief's eight parts, and walk 1's breaks (W1.x, traces 3a/3b) as cases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './layer.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
let minute = 0;
const at = () => new Date(Date.UTC(2026, 0, 1, 0, ++minute)).toISOString();
const J = JSON.stringify;
const cli = (store) => (...args) =>
  run([...args, '--store', store, ...(['add', 'revise', 'end', 'link'].includes(args[0]) ? ['--at', at()] : [])]);
const ok = (r) => { assert.equal(r.code, 0, J(r.out)); return r.out; };
const refused = (r, why) => { assert.equal(r.code, 1, J(r.out)); assert.ok(r.out.problems.some((p) => p.includes(why)), J(r.out)); };
const ids = (xs) => (xs ?? []).map((x) => x.id);

// Every rule once, refusing (live) or logging a hit and writing through (retro).
function rules(retro) {
  const L = cli(path.join(dir, retro ? 'retro.json' : 'live.json'));
  const expect = (r, rule) => {
    if (!retro) return refused(r, rule);
    assert.equal(r.code, 0, J(r.out));
    assert.ok(r.out.hits.some((h) => h.startsWith(rule)), J(r.out));
  };
  const area = ok(L('add', 'area', '--by', 'John', '--json', J({ name: 'lib', paths: ['lib/'] }), ...(retro ? ['--retro'] : []))).id;
  const parent = ok(L('add', 'task', '--by', 'John', '--in', area, '--json', J({ asked: 'Make X faster', paths: ['lib/x/'] }))).id;
  const plan = ok(L('add', 'plan', '--by', 'design', '--in', parent, '--json', J({ says: 'piece A', paths: ['lib/x/a.js'], order: 1 }))).id;
  const child = ok(L('add', 'task', '--by', 'breakdown', '--in', parent, '--link', `piece=${plan}`,
    '--json', J({ asked: '', 'done-when': 'A is fast', paths: ['lib/x/a.js'] }))).id;
  // Rule 1: a task can't close while records addressed to it are open.
  const f1 = ok(L('add', 'finding', '--by', 'survey-task', '--in', child, '--to', child, '--json', J({ says: 'A has no test' }))).id;
  expect(L('end', child, 'done', 'finished', '--by', 'close-out'), 'rule 1');
  // Rule 2 (trace 3a): a finding about a piece ends done only after the piece has a newer version.
  const f2 = ok(L('add', 'finding', '--by', 'plan-review', '--in', parent, '--to', 'design', '--link', `about=${plan}`,
    '--json', J({ says: 'piece A misses the cache' }))).id;
  expect(L('end', f2, 'done', 'fixed', '--by', 'design'), 'rule 2');
  // Rule 3 (trace 3b): a question takes one decision.
  const q = ok(L('add', 'question', '--by', 'survey-task', '--in', child, '--to', 'John',
    '--json', J({ asks: 'A or B?', options: ['A', 'B'], recommended: 'A', 'if-unanswered': 'A' }))).id;
  ok(L('add', 'decision', '--by', 'John', '--in', child, '--link', `answers=${q}`, '--json', J({ answer: 'A', why: 'simpler' })));
  expect(L('add', 'decision', '--by', 'scoping', '--in', child, '--link', `answers=${q}`, '--json', J({ answer: 'B' })), 'rule 3');
  // Rule 4: a hand-off kind needs `to`; handed-on needs the record that takes over.
  expect(L('add', 'check', '--by', 'review', '--in', child, '--json', J({ what: 'run on the device' })), 'rule 4');
  expect(L('end', q, 'handed-on', 'moved', '--by', 'John'), 'rule 4');
  // Rule 5: links resolve; a stage writes only its kinds.
  expect(L('add', 'finding', '--by', 'survey-task', '--in', child, '--to', 'John', '--link', 'about=plan-99'), 'rule 5');
  expect(L('add', 'lesson', '--by', 'survey-task', '--in', area, '--json', J({ says: 'x' })), 'rule 5');
  return { L, area, parent, plan, child, f1, f2, q };
}

try {
  // ---- retro mode: hits logged, writes go through, the store remembers it ----
  const R = rules(true);
  const hits = ok(R.L('hits'));
  assert.equal(hits.retro, true);
  assert.deepEqual(hits.hits.map((h) => h.hits[0].slice(0, 6)), ['rule 1', 'rule 2', 'rule 3', 'rule 4', 'rule 4', 'rule 5', 'rule 5']);
  const rc = ok(R.L('check'));
  assert.equal(rc.ok, false);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(rc.problems.some((p) => p.problem.startsWith(`rule ${n}`)), `check sees rule ${n}`);

  // ---- live mode: the same writes are refused ----
  const { L, area, parent, plan, child, f1, f2 } = rules(false);
  assert.equal(L('check', '--retro').code, 2, '--retro only at creation');
  assert.deepEqual(ok(L('hits')).hits, []);
  refused(L('add', 'task', '--by', 'design', '--in', parent, '--json', J({ asked: 'mine' })), 'asked');
  refused(L('add', 'task', '--by', 'design', '--json', J({ asked: 'top' })), 'only child tasks');
  refused(L('revise', parent, '--by', 'John', '--reason', 'reword', '--json', J({ asked: 'other words' })), 'fixed');
  assert.equal(L('end', f1, 'closed', 'x', '--by', 'John').code, 2, 'undeclared end');
  ok(L('add', 'run', '--by', 'implementation', '--in', child, '--json', J({ stage: 'implementation', claims: ['lib/x/a.js'], account: 'began' })));
  refused(L('add', 'run', '--by', 'review', '--in', child, '--json', J({ stage: 'implementation' })), 'own run');

  // W1.1: a verdict judges one exact version, from its judgement's outcome set.
  const v = ok(L('add', 'verdict', '--by', 'plan-review', '--in', parent, '--link', `on=${plan}`,
    '--json', J({ of: 'plan-review', outcome: 'approve-with-notes', reasoning: 'ok' })));
  assert.deepEqual(v.links, [{ type: 'on', to: plan, v: 1 }]);
  refused(L('add', 'verdict', '--by', 'plan-review', '--in', parent, '--link', `on=${plan}`, '--json', J({ of: 'plan-review', outcome: 'better' })), 'outcome');
  refused(L('end', v.id, 'withdrawn', 'x', '--by', 'survey-task'), 'rule 5');
  const t1 = at();

  // Trace 3a fixed path: the correction reaches the piece, then the finding can end done.
  const p2 = ok(L('revise', plan, '--by', 'implementation', '--reason', 'apply the cache finding', '--json', J({ says: 'piece A, cached' })));
  assert.equal(p2.v, 2);
  ok(L('end', f2, 'done', 'piece corrected', '--by', 'design'));
  const other = ok(L('add', 'plan', '--by', 'design', '--in', parent, '--json', J({ says: 'piece B' }))).id;
  refused(L('revise', other, '--by', 'implementation', '--reason', 'x', '--json', J({ says: 'y' })), 'plan piece');

  // Stale (W1.3/W1.4/W1.7): the verdict rests on plan v1, now v2. Re-affirming clears it.
  assert.deepEqual(ok(L('check')).stale.map((s) => s.id), [v.id]);
  let b = ok(L('brief', 'implementation', '--task', child));
  assert.equal(b.parts['4 standing judgements and decisions'].find((r) => r.id === v.id).stale, `${plan}@1 now at v2`);
  ok(L('link', v.id, 'on', plan, '--by', 'plan-review'));
  assert.deepEqual(ok(L('check')).stale, []);
  // W1.3: each new head of a change is a new version; its review now rests on a moved version.
  const ch = ok(L('add', 'change', '--by', 'implementation', '--in', child, '--json', J({ ref: 'PR 1', head: 'aaa' }))).id;
  const rv = ok(L('add', 'verdict', '--by', 'review', '--in', child, '--link', `on=${ch}`, '--json', J({ of: 'review', outcome: 'approve' }))).id;
  ok(L('revise', ch, '--by', 'implementation', '--reason', 'new head', '--json', J({ head: 'bbb' })));

  // W1.6: an area's finding reaches only the place stage, until it re-addresses it to the task.
  const af = ok(L('add', 'finding', '--by', 'survey-place', '--in', area, '--to', area, '--json', J({ says: 'lib/x leaks handles' }))).id;
  assert.deepEqual(ids(ok(L('brief', 'survey-place', '--task', child)).parts['7 findings in its areas (place role)']), [af]);
  b = ok(L('brief', 'implementation', '--task', child));
  assert.equal(b.parts['7 findings in its areas (place role)'], null);
  assert.ok(!b.text.includes(af));
  refused(L('revise', af, '--by', 'survey-task', '--reason', 'mine', '--to', child), 're-address');
  ok(L('revise', af, '--by', 'survey-place', '--reason', 'falls in this task', '--to', child));

  // Settings by scope, lessons by paths.
  const elsewhere = ok(L('add', 'task', '--by', 'John', '--in', area, '--json', J({ asked: 'Other', paths: ['docs/'] }))).id;
  const s1 = ok(L('add', 'setting', '--by', 'John', '--in', parent, '--json', J({ key: 'tone', value: 'terse', scope: parent }))).id;
  const s2 = ok(L('add', 'setting', '--by', 'John', '--json', J({ key: 'lang', value: 'en', scope: 'harbour' }))).id;
  ok(L('add', 'setting', '--by', 'John', '--in', elsewhere, '--json', J({ key: 'x', value: 1, scope: elsewhere })));
  const le = ok(L('add', 'lesson', '--by', 'survey-place', '--in', area, '--json', J({ says: 'x uses a pool', paths: ['lib/x/'], 'checked-at': 'abc' }))).id;
  ok(L('add', 'lesson', '--by', 'survey-place', '--in', area, '--json', J({ says: 'docs are generated', paths: ['docs/'] })));

  // W1.2: a check hands on to the record that takes over.
  const ck = ok(L('add', 'check', '--by', 'review', '--in', child, '--to', 'John', '--json', J({ what: 'try it', 'why-person': 'device', how: 'tap' }))).id;
  const ck2 = ok(L('add', 'check', '--by', 'close-out', '--in', child, '--to', 'John', '--json', J({ what: 'try it again' }))).id;
  ok(L('end', ck, 'handed-on', 'replaced by a sharper check', '--to', ck2, '--by', 'close-out'));

  // The brief's eight parts.
  b = ok(L('brief', 'implementation', '--task', child));
  const P = b.parts;
  assert.deepEqual(P['1 the person\'s words'], [{ task: child, asked: '' }, { task: parent, asked: 'Make X faster' }]); // W1.5
  assert.equal(P['2 plan piece'].v, 2);
  assert.deepEqual(ids(P['3 addressed to it']).sort(), [af, f1].sort());
  assert.deepEqual(ids(P['4 standing judgements and decisions']).sort(), ['decision-1', v.id, rv].sort());
  assert.equal(P['4 standing judgements and decisions'].find((r) => r.id === rv).stale, `${ch}@1 now at v2`);
  assert.deepEqual(ids(P['5 settings']).sort(), [s1, s2].sort());
  assert.deepEqual(ids(P['6 lessons (knowledge, not instructions)']), [le]);
  const raised = P['8 raised in this task, still open'];
  assert.ok(raised.open.some((r) => r.id === ck2) && !raised.open.some((r) => r.id === ck) && !raised.open[0].fields);
  assert.ok(ok(L('brief', 'close-out', '--task', child)).parts['8 raised in this task, still open'].open[0].fields, 'in full for closes');
  assert.equal(b.carries.addressed, 2);
  assert.equal(b.carries.stale, 1);
  assert.ok(b.carries.open > 5 && b.size.textChars > 0 && b.size.jsonBytes > 0);
  const text = ok(L('brief', 'implementation', '--task', child, '--text'));
  assert.ok(typeof text === 'string' && text.includes('STALE') && text.includes('carries:') && text.includes('size:'));

  // --as-of: versions as they stood.
  const old = ok(L('brief', 'implementation', '--task', child, '--as-of', t1));
  assert.equal(old.parts['2 plan piece'].v, 1);
  assert.equal(old.parts['4 standing judgements and decisions'].find((r) => r.id === v.id).stale, false);
  const sh = ok(L('show', '--task', child, '--as-of', t1));
  assert.ok(!ids(sh.records).includes(ch) && sh.carries.records === sh.records.length);
  const now = ok(L('show', '--task', child));
  assert.equal(now.records.find((r) => r.id === rv).stale, `${ch}@1 now at v2`);
  assert.equal(now.records.find((r) => r.id === ck).state, 'handed-on');
  assert.ok(now.size.jsonBytes > sh.size.jsonBytes);

  // Rule 1 cleared: end what's addressed to the task, then close it.
  ok(L('end', f1, 'done', 'test added', '--by', 'close-out'));
  ok(L('end', af, 'done', 'leak fixed', '--by', 'implementation'));
  ok(L('end', child, 'done', 'A is fast', '--by', 'close-out'));
  const live = ok(L('check'));
  assert.equal(live.ok, true, J(live.problems));
  assert.deepEqual(live.stale.map((s) => s.id), [rv]);

  // One real process, as someone driving the CLI would.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = JSON.parse(execFileSync(process.execPath, [path.join(here, 'layer.mjs'), 'check', '--store', path.join(dir, 'live.json')], { encoding: 'utf8' }));
  assert.equal(out.ok, true);
  console.log('ok: all layer tests passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
