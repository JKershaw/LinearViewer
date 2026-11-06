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

test('pair_baseline named: analysis gains exactly the pair_baseline section; every v1 key is unchanged', async () => {
  const { root, dir } = scratchCopy();
  try {
    addPairPasses(dir);
    const inputs = withInputs({ pair_baseline: {} });
    const r = await run(path.join(SCRIPTS, 'analyse.mjs'), [dir, '--inputs', inputs]);
    assert.equal(r.code, 0, r.stderr);
    const v1 = JSON.parse(readFileSync(path.join(EVIDENCE, 'analysis.json'), 'utf8'));
    const got = JSON.parse(readFileSync(path.join(dir, 'analysis.json'), 'utf8'));

    // the pair section, with its n
    assert.deepEqual(got.pair_baseline, {
      passes_total: 2,
      subjects_count: 1,
      subjects: [{
        subject: 'baseline pair 1',
        passes: [
          { id: 'AW', sign: 'better', score: 1, rows: 1 },
          { id: 'AX', sign: 'neutral', score: 0, rows: 1 },
        ],
        both_better: false,
      }],
      both_better_count: 0,
    });

    // every other key: v1's, except the two that a changed blind-codes.json moves by construction
    const strip = (o) => { const c = { ...o }; delete c.pair_baseline; delete c.inputs_sha256; return c; };
    assert.deepEqual(strip(got), strip(v1), 'the rest of analysis.json is v1 unchanged');
    assert.deepEqual(Object.keys(got).filter((k) => !(k in v1)), ['pair_baseline'], 'exactly one new key');
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
