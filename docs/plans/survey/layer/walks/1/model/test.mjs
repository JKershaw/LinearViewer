// The layer's own test: each §3.3 rule once in each mode, each command once. Run: node test.mjs
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const layer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'layer.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
let store, clock = 0;
const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
const run = (...args) => {
  const r = spawnSync(process.execPath, [layer, ...args, '--store', store, '--at', at(++clock)], { encoding: 'utf8' });
  return { code: r.status, out: JSON.parse(r.stdout) };
};
const ok = (...args) => { const r = run(...args); assert.equal(r.code, 0, JSON.stringify(r.out)); return r.out; };
const json = (o) => JSON.stringify(o);

// motion: the write is refused naming the rule; retro: it goes through and the hit is logged
function violate(retro, rule, ...args) {
  const r = run(...args);
  if (retro) {
    assert.equal(r.code, 0, JSON.stringify(r.out));
    assert.ok(r.out.hits.some((h) => h.rule === rule), `rule ${rule} hit expected: ${JSON.stringify(r.out)}`);
  } else {
    assert.equal(r.code, 1, JSON.stringify(r.out));
    assert.ok(r.out.refused.some((f) => f.rule === rule), `rule ${rule} refusal expected: ${JSON.stringify(r.out)}`);
  }
}

function scenario(retro) {
  store = path.join(dir, retro ? 'retro.json' : 'motion.json');
  clock = 0;
  // add (the first command alone carries --retro; the store remembers it)
  ok('add', 'area', json({ name: 'lib', paths: ['lib/'] }), '--by', 'John', ...(retro ? ['--retro'] : []));
  assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).retro, retro);
  ok('add', 'task', json({ asked: 'make X', 'done-when': 'tests pass', in: 'area-1' }), '--by', 'John');
  ok('add', 'plan', json({ pieces: { a: 'build A', b: 'build B' }, in: 'task-1' }), '--by', 'plan-stage');
  ok('link', 'task-1', 'about', 'plan-1#a', '--by', 'Harbour');
  ok('add', 'finding', json({ says: 'A will not work', about: 'plan-1#a', to: 'task-1', in: 'task-1' }), '--by', 'review');
  ok('add', 'question', json({ asks: 'x or y?', options: ['x', 'y'], recommended: 'x', to: 'John', in: 'task-1' }), '--by', 'review');
  ok('add', 'check', json({ what: 'login works', how: 'sign in on prod', to: 'John', in: 'task-1' }), '--by', 'review');
  ok('add', 'lesson', json({ says: 'lib/ has no clock', about: ['lib/x.js'], to: 'area-1' }), '--by', 'review');
  ok('add', 'verdict', json({ outcome: 'pass', on: 'plan-1@1' }), '--by', 'review');

  // field checks refuse in both modes
  assert.equal(run('add', 'task', json({ 'done-when': 'x', colour: 'red' }), '--by', 'John').out.refused[0].field, 'colour');
  assert.equal(run('revise', 'task-1', json({ asked: 'other' }), 'edit', '--by', 'John').out.refused[0].field, 'asked');

  // brief
  const b = ok('brief', 'build', '--task', 'task-1');
  assert.equal(b.asked, 'make X');
  assert.equal(b.pieces[0].text, 'build A');
  assert.deepEqual(b.addressed.map((r) => r.id), ['finding-1']);
  assert.deepEqual(b.lessons.map((r) => r.id), ['lesson-1']);
  assert.deepEqual(b.checks, [{ id: 'check-1', state: 'open' }]);
  assert.equal(b.size.chars > 0 && b.size.records.task, 1);
  assert.equal(b.carries.instructions, 1);
  assert.match(b.text, /size \d+ chars/);
  const beforeRevise = at(clock);

  violate(retro, 1, 'end', 'task-1', 'done', 'finished', '--by', 'Harbour');
  violate(retro, 2, 'end', 'finding-1', 'done', 'built differently', '--by', 'build');
  // revise (and rule 4's staling of verdicts on the old version)
  ok('revise', 'plan-1', json({ pieces: { a: 'build A2', b: 'build B' } }), 'A built differently', '--by', 'plan-stage');
  const s = JSON.parse(fs.readFileSync(store, 'utf8'));
  assert.equal(s.records['verdict-1'].versions.at(-1).state, 'stale');
  violate(retro, 4, 'add', 'verdict', json({ outcome: 'pass', on: 'plan-1@1' }), '--by', 'review');
  ok('add', 'decision', json({ answer: 'x', basis: 'question-1', in: 'task-1' }), '--by', 'John');
  violate(retro, 3, 'add', 'decision', json({ answer: 'y', basis: 'question-1', in: 'task-1' }), '--by', 'Harbour');
  violate(retro, 5, 'add', 'finding', json({ says: 'nobody to tell' }), '--by', 'review');
  violate(retro, 6, 'link', 'finding-1', 'about', 'task-99', '--by', 'review');

  // end: with everything addressed to it closed, the task closes
  ok('end', 'finding-1', 'done', 'plan revised', '--by', 'build');
  ok('end', 'question-1', 'answered', 'decision-1', '--by', 'John');
  ok('end', 'task-1', 'done', 'tests pass', '--by', 'Harbour');

  // brief as of a time reads versions as they stood
  const old = ok('brief', 'build', '--task', 'task-1', '--as-of', beforeRevise);
  assert.equal(old.pieces[0].text, 'build A');
  assert.equal(old.addressed[0].id, 'finding-1');
  const now = ok('brief', 'build', '--task', 'task-1');
  assert.equal(now.pieces[0].text, 'build A2');
  assert.equal(now.addressed.length, 0);
  assert.equal(now.decisions[0].id, 'decision-1');

  // check and hits
  const c = run('check');
  const h = ok('hits');
  if (retro) {
    assert.equal(c.code, 1);
    for (const rule of [3, 4, 5, 6]) assert.ok(c.out.failures.some((f) => f.rule === rule), `check lists rule ${rule}`);
    for (const rule of [1, 2, 3, 4, 5, 6]) assert.ok(h.hits.some((x) => x.rule === rule), `hits list rule ${rule}`);
  } else {
    assert.equal(c.code, 0, JSON.stringify(c.out));
    assert.deepEqual(h.hits, []);
  }
}

try {
  scenario(false);
  scenario(true);
  console.log('ok: every rule in both modes, every command');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
