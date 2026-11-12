// analyse.test.mjs — LIN-4426. analyse.mjs with its inputs and dispatch attribution, and v1's output staying byte-identical.
//
// Run by hand only:  node --test docs/papers/harbour/task-size-and-cost-scripts/analyse.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.
//
// Each test works on a scratch copy: the committed v1 evidence folder is never written. The dispatch tests build a
// synthetic folder (no network): three tickets that between them exercise each dispatch rule and each refusal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYSE = path.join(here, 'analyse.mjs');
const V1_INPUTS = path.join(here, 'inputs-v1.json');
const V1_EVIDENCE = path.join(here, '..', 'task-size-and-cost-evidence', '2026-11-05');
const WINDOW = '2026-11-04T05:00:00Z';

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ANALYSE, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'lin4426-analyse-'));

// ---- v1: the committed folder, re-analysed, must reproduce its analysis.json byte for byte ----

test('v1 with the default inputs reproduces the committed analysis.json byte for byte', async () => {
  const dir = scratch();
  try {
    const ev = path.join(dir, 'ev');
    cpSync(V1_EVIDENCE, ev, { recursive: true });
    const r = await run([ev]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readFileSync(path.join(ev, 'analysis.json'), 'utf8'), readFileSync(path.join(V1_EVIDENCE, 'analysis.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('v1 with the inputs named explicitly also reproduces it, and every self-check passes', async () => {
  const dir = scratch();
  try {
    const ev = path.join(dir, 'ev');
    cpSync(V1_EVIDENCE, ev, { recursive: true });
    const r = await run([ev, '--inputs', V1_INPUTS]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readFileSync(path.join(ev, 'analysis.json'), 'utf8'), readFileSync(path.join(V1_EVIDENCE, 'analysis.json'), 'utf8'));
    assert.ok(!/^FAIL/m.test(r.stdout), r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the default is refused where the folder holds its own inputs.json; the named inputs then run', async () => {
  const dir = scratch();
  try {
    const ev = path.join(dir, 'ev');
    cpSync(V1_EVIDENCE, ev, { recursive: true });
    const own = path.join(ev, 'inputs.json');
    cpSync(V1_INPUTS, own);
    const refused = await run([ev]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /refusing the implicit default inputs/);
    const named = await run([ev, '--inputs', own]);
    assert.equal(named.code, 0, named.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inputs whose window_start is not the manifest\'s are refused', async () => {
  const dir = scratch();
  try {
    const ev = path.join(dir, 'ev');
    cpSync(V1_EVIDENCE, ev, { recursive: true });
    const inputs = JSON.parse(readFileSync(V1_INPUTS, 'utf8'));
    inputs.window_start = '2026-11-05T00:00:00Z';
    const bad = path.join(dir, 'bad-window.json');
    writeFileSync(bad, JSON.stringify(inputs));
    const r = await run([ev, '--inputs', bad]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /is not the manifest's/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inputs that name another freeze (freeze_finished_at) are refused', async () => {
  const dir = scratch();
  try {
    const ev = path.join(dir, 'ev');
    cpSync(V1_EVIDENCE, ev, { recursive: true });
    const inputs = JSON.parse(readFileSync(V1_INPUTS, 'utf8'));
    inputs.freeze_finished_at = '2026-11-06T00:00:00.000Z';
    const bad = path.join(dir, 'other-freeze.json');
    writeFileSync(bad, JSON.stringify(inputs));
    const r = await run([ev, '--inputs', bad]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /written for another freeze/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- dispatch attribution: a synthetic folder ----

const cost = (over) => ({ totalUsd: null, workerSessions: [], appCalls: { costUsd: 0 }, unpriced: [], noLineage: false, ...over });
const row = (id, kind, at, usd, model = 'claude-haiku-5-5') => ({ itemId: id, kind, dispatchedAt: at, followUpTo: null,
  byModel: usd === null ? null : [{ model, requests: 1, costUsd: usd }], requests: usd === null ? 0 : 1, tokens: null, costUsd: usd });
const lineage = (rootItemId, kind, at, costUsd, dispatches) => ({ rootItemId, kind, dispatchedAt: at, harness: 'claude-code', model: 'claude-haiku-5-5', effort: 'high', costUsd, durationMs: 1, dispatches });
const AFTER = 'A short, read-only follow-up for research (the Survey; see docs/plans/survey.md) on branch x.';

// LIN-9001: priced, code shape. Every dispatch rule once: an after-answer (Survey), a leftover (floor), a wake (keep-alive),
// a build follow-up custom (work), a custom-founded lineage coded `work` (work).
const A = {
  cost: cost({ totalUsd: 3.75 + 0.75 + 0.3, workerSessions: [
    lineage('r1', 'implementation', '2026-11-05T10:00:00Z', 3.75, [
      row('r1', 'implementation', '2026-11-05T10:00:00Z', 2.0),
      row('af1', 'custom', '2026-11-05T11:00:00Z', 1.0),
      row('lo1', 'leftover', '2026-11-05T12:00:00Z', 0.5),
      row('fu1', 'custom', '2026-11-05T13:00:00Z', 0.25),
    ]),
    lineage('w1', 'wake', '2026-11-05T14:00:00Z', 0.75, [row('w1', 'wake', '2026-11-05T14:00:00Z', 0.75)]),
    lineage('cr', 'custom', '2026-11-05T15:00:00Z', 0.3, [row('cr', 'custom', '2026-11-05T15:00:00Z', 0.3)]),
  ]}),
  dispatch: [
    { id: 'r1', kind: 'implementation', dispatchedAt: '2026-11-05T10:00:00Z' }, { id: 'af1', kind: 'custom', dispatchedAt: '2026-11-05T11:00:00Z' },
    { id: 'lo1', kind: 'leftover', dispatchedAt: '2026-11-05T12:00:00Z' }, { id: 'fu1', kind: 'custom', dispatchedAt: '2026-11-05T13:00:00Z' },
    { id: 'w1', kind: 'wake', dispatchedAt: '2026-11-05T14:00:00Z' }, { id: 'cr', kind: 'custom', dispatchedAt: '2026-11-05T15:00:00Z' },
  ],
  prompts: { af1: AFTER, fu1: 'Please fix the lint in lib/x.js', cr: 'A custom-founded task' },
  lv: { prodAdded: 10 },
};
// LIN-9002: the one dispatch with no cost is unpriced: the ticket's totalUsd is null, so no leg may hold a partial sum.
const B = {
  cost: cost({ totalUsd: null, workerSessions: [lineage('r2', 'implementation', '2026-11-05T10:00:00Z', null, [
    row('r2', 'implementation', '2026-11-05T10:00:00Z', 1.0), row('r2b', 'implementation', '2026-11-05T11:00:00Z', null),
  ])] }),
  dispatch: [{ id: 'r2', kind: 'implementation', dispatchedAt: '2026-11-05T10:00:00Z' }, { id: 'r2b', kind: 'implementation', dispatchedAt: '2026-11-05T11:00:00Z' }],
  prompts: {},
  lv: { prodAdded: 5 },
};
// LIN-9003: a lineage with no split (dispatches: null): approximate, so it is not exact, though it is priced.
const C = {
  cost: cost({ totalUsd: 2.0, workerSessions: [lineage('r3', 'implementation', '2026-11-05T10:00:00Z', 2.0, null)] }),
  dispatch: [{ id: 'r3', kind: 'implementation', dispatchedAt: '2026-11-05T10:00:00Z' }],
  prompts: {},
  lv: { prodAdded: 7 },
};

const SYNTH_INPUTS = { version: 'synthetic', ticket: 'LIN-9999', attribution: 'dispatch', window_start: WINDOW, excluded: [],
  pair_sets: [], custom_founded_legs: { cr: 'work' } };

// Writes one synthetic evidence folder. `over` lets a test change one ticket's cost or add a dispatch kind.
function syntheticEvidence(dir, over = {}) {
  const tickets = { 'LIN-9001': { ...A, ...over['LIN-9001'] }, 'LIN-9002': { ...B, ...over['LIN-9002'] }, 'LIN-9003': { ...C, ...over['LIN-9003'] } };
  const ev = path.join(dir, 'ev');
  for (const d of ['cost', 'dispatch', 'prompts', 'size']) mkdirSync(path.join(ev, d), { recursive: true });
  const population = Object.keys(tickets);
  writeFileSync(path.join(ev, 'manifest.json'), JSON.stringify({ window_start: WINDOW, population, population_count: population.length,
    files: [], states_at_freeze: {}, freeze_finished_at: '2026-11-12T00:00:00.000Z' }));
  writeFileSync(path.join(ev, 'size/lv-prs.json'), JSON.stringify(population.map((t) => ({ ticket: t, prs: 1, prodAdded: tickets[t].lv?.prodAdded ?? 0, prodDeleted: 0,
    testAdded: 0, testDeleted: 0, prodFiles: ['lib/x.js'] }))));
  writeFileSync(path.join(ev, 'size/sd-prs.json'), '[]');
  writeFileSync(path.join(ev, 'size/lv-place-change.json'), '[]');
  writeFileSync(path.join(ev, 'size/survey-balance.json'), JSON.stringify({ rows: [] }));
  writeFileSync(path.join(ev, 'size/survey-costmix-tokens.json'), '{}');
  for (const [t, x] of Object.entries(tickets)) {
    writeFileSync(path.join(ev, `cost/${t}.json`), JSON.stringify(x.cost));
    writeFileSync(path.join(ev, `dispatch/${t}.json`), JSON.stringify({ items: x.dispatch }));
    for (const [id, prompt] of Object.entries(x.prompts)) writeFileSync(path.join(ev, `prompts/${id}.json`), JSON.stringify({ id, kind: 'custom', prompt }));
  }
  return ev;
}

function inputsFile(dir, obj = SYNTH_INPUTS) {
  const p = path.join(dir, 'synth-inputs.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('dispatch attribution: each dispatch lands in its leg, and an after-answer is Survey, not floor', async () => {
  const dir = scratch();
  try {
    const ev = syntheticEvidence(dir);
    const r = await run([ev, '--inputs', inputsFile(dir)]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const a = JSON.parse(readFileSync(path.join(ev, 'analysis.json'), 'utf8'));
    assert.equal(a.attribution, 'dispatch');
    assert.equal(a.ticket, 'LIN-9999');
    const legs = a.perTicket['LIN-9001'].legs;
    assert.equal(legs.survey, 1.0, 'after-answer → survey');
    assert.equal(legs.floor, 0.5, 'leftover → floor (after)');
    assert.equal(legs.keepAlive, 0.75, 'wake → keep-alive');
    assert.equal(legs.work, 2.55, 'implementation + build follow-up custom + coded custom-founded lineage → work');
    assert.equal(a.perTicket['LIN-9001'].afterAnswers, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatch attribution: a null dispatch cost stays null, and an unpriced ticket is never exact nor partly summed', async () => {
  const dir = scratch();
  try {
    const ev = syntheticEvidence(dir);
    const r = await run([ev, '--inputs', inputsFile(dir)]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const a = JSON.parse(readFileSync(path.join(ev, 'analysis.json'), 'utf8'));
    const b = a.perTicket['LIN-9002'];
    assert.equal(b.totalUsd, null);
    assert.equal(b.legs.work, null, 'a null dispatch makes its leg null');
    assert.equal(b.legs.floor, null, 'the unpriced ticket gives no leg a partial value');
    assert.ok(!a.counts.exact.includes('LIN-9002'));
    assert.deepEqual(a.counts.unpricedNull, ['LIN-9002']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatch attribution: a null-dispatches lineage makes its ticket approximate, so it is not exact', async () => {
  const dir = scratch();
  try {
    const ev = syntheticEvidence(dir);
    const r = await run([ev, '--inputs', inputsFile(dir)]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const a = JSON.parse(readFileSync(path.join(ev, 'analysis.json'), 'utf8'));
    assert.equal(a.perTicket['LIN-9003'].approximate, true);
    assert.equal(a.perTicket['LIN-9003'].legs.work, 2, 'its lineage cost sits whole at lineage level');
    assert.deepEqual(a.counts.approximate, ['LIN-9003']);
    assert.deepEqual(a.counts.exact, ['LIN-9001'], 'only the fully split, priced ticket is exact');
    assert.ok(a.checks.every((c) => c.ok), JSON.stringify(a.checks));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatch attribution: a kind missing from BUCKET_OF_KIND stops the analysis, naming the kind', async () => {
  const dir = scratch();
  try {
    const ev = syntheticEvidence(dir, { 'LIN-9001': { cost: cost({ totalUsd: 2.0, workerSessions: [
      lineage('r1', 'implementation', '2026-11-05T10:00:00Z', 2.0, [row('r1', 'implementation', '2026-11-05T10:00:00Z', 1.0), row('x1', 'frobnicate', '2026-11-05T11:00:00Z', 1.0)]),
    ] }), dispatch: [], prompts: {} } });
    const r = await run([ev, '--inputs', inputsFile(dir)]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /kind "frobnicate" is missing from BUCKET_OF_KIND/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dispatch attribution: a split that does not sum to its lineage fails self-check d2 (exit 1)', async () => {
  const dir = scratch();
  try {
    const bad = { cost: cost({ totalUsd: 9.0, workerSessions: [
      lineage('r1', 'implementation', '2026-11-05T10:00:00Z', 9.0, [row('r1', 'implementation', '2026-11-05T10:00:00Z', 2.0)]),
    ] }), dispatch: [{ id: 'r1', kind: 'implementation', dispatchedAt: '2026-11-05T10:00:00Z' }], prompts: {}, lv: { prodAdded: 1 } };
    const ev = syntheticEvidence(dir, { 'LIN-9001': bad, 'LIN-9002': { cost: cost({ totalUsd: null }), dispatch: [], prompts: {} }, 'LIN-9003': { cost: cost({ totalUsd: null }), dispatch: [], prompts: {} } });
    const r = await run([ev, '--inputs', inputsFile(dir)]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /each lineage dispatch split sums to its lineage cost/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
