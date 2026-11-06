// analyse.test.mjs — LIN-4333. analyse.mjs with pair-baseline passes, and the v1 output staying byte-identical.
//
// Run by hand only:  node --test docs/papers/harbour/cleaner-than-it-started-scripts/analyse.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.
//
// Each test copies the committed v1 evidence folder to a scratch directory (the committed folder is never
// written), and works on that copy. The pair-baseline pass is a synthetic fixture added to the copy's
// blind-codes.json; the real v2 pair readings are the v2 subtask's data, not this test's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = here;
const EVIDENCE = path.join(here, '..', 'cleaner-than-it-started-evidence', '2026-11-06');
const V1_INPUTS = path.join(here, 'inputs-v1.json');

function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function scratchCopy() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lin4333-analyse-'));
  const dir = path.join(root, 'evidence');
  cpSync(EVIDENCE, dir, { recursive: true });
  return { root, dir };
}

// Two synthetic pair-baseline passes on 'baseline pair 1' (both read 'better' only in AW).
function addPairPasses(dir) {
  const blindPath = path.join(dir, 'blind-codes.json');
  const blind = JSON.parse(readFileSync(blindPath, 'utf8'));
  const pass = (id, sign, score) => ({
    id, kind: 'pair-baseline', title: `baseline pair 1 pass ${id}`, subject: 'baseline pair 1',
    comment_id: `synthetic-${id}`, created_at: '2026-11-06T13:00:00.000Z', session: `pass ${id}`, subject_tickets: null,
    rows: [{ row: 1, commit_cell: '0eb4a2d1', shas: [], tickets: null, balance_raw: sign, sign, score, leans: null, quote: { balance: sign, reason: 'synthetic' } }],
  });
  blind.passes.push(pass('AW', 'better', 1), pass('AX', 'neutral', 0));
  writeFileSync(blindPath, JSON.stringify(blind, null, 2) + '\n');
}

function withInputs(extra) {
  const base = JSON.parse(readFileSync(V1_INPUTS, 'utf8'));
  const file = path.join(os.tmpdir(), `lin4333-inputs-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ ...base, ...extra }));
  return file;
}

test('pair-baseline passes with no pair_baseline section named: analyse refuses, naming them', async () => {
  const { root, dir } = scratchCopy();
  try {
    addPairPasses(dir);
    const r = await run(path.join(SCRIPTS, 'analyse.mjs'), [dir, '--inputs', V1_INPUTS]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /2 pair-baseline pass\(es\), but the inputs file does not name a pair_baseline section/);
    assert.doesNotMatch(r.stderr, /TypeError/, 'the failure is the named refusal, not a TypeError');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A synthetic Oct list (LIN-4334): four pairs the rule must pick, in order, plus two that it must not.
// Times mix +01:00 and Z; one pair sits exactly 48 h apart (inside the window); one docs-only pair is not a candidate.
const OCT_ROWS = [
  ['1'.repeat(40), '11111111', '2026-10-20T01:00:00+01:00', 'LIN-3706: a', 'lib/x.js'],
  ['2'.repeat(40), '22222222', '2026-10-20T03:00:00Z', 'LIN-3700: b', 'lib/x.js,docs/y.md'],
  ['3'.repeat(40), '33333333', '2026-10-21T10:00:00Z', 'LIN-3710: c', 'routes/r.js'],
  ['4'.repeat(40), '44444444', '2026-10-23T10:00:00Z', 'LIN-3714: d', 'routes/r.js'],
  ['5'.repeat(40), '55555555', '2026-10-24T00:00:00Z', 'LIN-3717: e', 'public/p.js'],
  ['6'.repeat(40), '66666666', '2026-10-24T23:00:00Z', 'LIN-3722: f', 'public/p.js'],
  ['7'.repeat(40), '77777777', '2026-10-25T00:00:00Z', 'LIN-3711: g', 'server.js'],
  ['8'.repeat(40), '88888888', '2026-10-25T01:00:00Z', 'LIN-3713: h', 'server.js'],
  ['9'.repeat(40), '99999999', '2026-10-20T05:00:00Z', 'LIN-3801: docs', 'docs/a.md'],
  ['a'.repeat(40), 'aaaaaaaa', '2026-10-20T06:00:00Z', 'LIN-3802: docs', 'docs/a.md'],
];
const OCT_LABELS = ['11111111→22222222', '33333333→44444444', '55555555→66666666', '77777777→88888888'];

function addOctFixture(dir) {
  const rows = ['full_sha\tshort\tcommitted\tsubject\tfiles', ...OCT_ROWS.map((r) => r.join('\t'))];
  writeFileSync(path.join(dir, 'git', 'oct-synthetic.tsv'), rows.join('\n') + '\n');
}

function withPairInputs(expectedPairs = OCT_LABELS) {
  const base = JSON.parse(readFileSync(V1_INPUTS, 'utf8'));
  const file = path.join(os.tmpdir(), `lin4334-inputs-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({
    ...base,
    oct_merges: { since: '2026-10-20T00:00:00Z', until: '2026-11-01T23:59:59Z', file: 'git/oct-synthetic.tsv' },
    pair_baseline: {
      expected_pairs: expectedPairs,
      rule_params: { production: ['lib/', 'routes/', 'public/', 'server.js'], window_hours: 48, take: 4 },
      rule_commits: [],
    },
  }));
  return file;
}

test('pair_baseline named: analysis gains exactly the pair_baseline section; every v1 key is unchanged', async () => {
  const { root, dir } = scratchCopy();
  try {
    addPairPasses(dir);
    addOctFixture(dir);
    const inputs = withPairInputs();
    const r = await run(path.join(SCRIPTS, 'analyse.mjs'), [dir, '--inputs', inputs]);
    assert.equal(r.code, 0, r.stderr);
    const v1 = JSON.parse(readFileSync(path.join(EVIDENCE, 'analysis.json'), 'utf8'));
    const got = JSON.parse(readFileSync(path.join(dir, 'analysis.json'), 'utf8'));

    // the rule picked the four expected pairs, from the 10 merges, 8 of them production candidates
    assert.deepEqual(got.pair_baseline.selection.pairs, { n: 4, labels: OCT_LABELS, matches_expected: true });
    assert.deepEqual(got.pair_baseline.selection.merges_in_frozen_list, { n: 10 });
    assert.deepEqual(got.pair_baseline.selection.production_candidates, { n: 8 });
    // the synthetic pass reads 'better' then 'neutral': one subject, not both better
    assert.deepEqual(got.pair_baseline.readings.passes_total, { n: 2 });
    assert.deepEqual(got.pair_baseline.readings.subjects.map((x) => [x.subject, x.selected_pair, x.both_better]), [['baseline pair 1', OCT_LABELS[0], false]]);
    assert.deepEqual(got.pair_baseline.readings.both_better_count, { n: 0 });

    // every other key: v1's, except the two that a changed blind-codes.json moves by construction
    const strip = (o) => { const c = { ...o }; delete c.pair_baseline; delete c.inputs_sha256; return c; };
    assert.deepEqual(strip(got), strip(v1), 'the rest of analysis.json is v1 unchanged');
    assert.deepEqual(Object.keys(got).filter((k) => !(k in v1)), ['pair_baseline'], 'exactly one new key');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a rule that picks other pairs than expected_pairs: analyse throws naming both, and writes no analysis or table', async () => {
  const { root, dir } = scratchCopy();
  try {
    addOctFixture(dir);
    const before = { a: readFileSync(path.join(dir, 'analysis.json'), 'utf8'), t: readFileSync(path.join(dir, 'evidence-table.tsv'), 'utf8') };
    const wrong = [...OCT_LABELS.slice(0, 3), '99999999→aaaaaaaa'];
    const r = await run(path.join(SCRIPTS, 'analyse.mjs'), [dir, '--inputs', withPairInputs(wrong)]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /pair rule selected .*77777777→88888888.*not expected_pairs .*99999999→aaaaaaaa/s);
    assert.equal(readFileSync(path.join(dir, 'analysis.json'), 'utf8'), before.a, 'analysis.json was not rewritten');
    assert.equal(readFileSync(path.join(dir, 'evidence-table.tsv'), 'utf8'), before.t, 'evidence-table.tsv was not rewritten');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('v1 with no pair passes and no pair_baseline named: analysis.json and evidence-table.tsv are byte-identical to the committed v1', async () => {
  const { root, dir } = scratchCopy();
  try {
    const r = await run(path.join(SCRIPTS, 'analyse.mjs'), [dir, '--inputs', V1_INPUTS]);
    assert.equal(r.code, 0, r.stderr);
    for (const f of ['analysis.json', 'evidence-table.tsv']) {
      assert.equal(readFileSync(path.join(dir, f), 'utf8'), readFileSync(path.join(EVIDENCE, f), 'utf8'), `${f} differs from committed v1`);
    }
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'analysis.json'), 'utf8')).pair_baseline, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
