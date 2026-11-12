// freeze.test.mjs — LIN-4426. freeze.mjs in dispatch attribution, against a stub API on 127.0.0.1 and throwaway git repos.
// The live API is never called.
//
// Run by hand only:  node --test docs/papers/harbour/task-size-and-cost-scripts/freeze.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.
//
// Each test builds a fixture LinearViewer repo (the scripts copied to their real relative paths, lib/ symlinked to the real
// one, so the imports resolve) and a fixture simple-dispatcher repo, then runs freeze as a child process. The population is a
// single ticket, LIN-9001, named by a commit; lin_range_floor sits above it, so no other candidate is read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO = path.resolve(here, '..', '..', '..', '..');
const REL_TASK = path.join('docs', 'papers', 'harbour', 'task-size-and-cost-scripts');
const REL_SIB = path.join('docs', 'papers', 'harbour', 'cleaner-than-it-started-scripts');
const WINDOW = '2026-11-04T05:00:00Z';
const AFTER = 'A short, read-only follow-up for research (the Survey; see docs/plans/survey.md) on branch x.';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

function commitAt(repo, subject, date, file) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), subject + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject]);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lin4426-freeze-'));
  const lv = path.join(root, 'LinearViewer');
  const sd = path.join(root, 'simple-dispatcher');
  mkdirSync(lv, { recursive: true });
  mkdirSync(sd, { recursive: true });
  git(lv, ['init', '-q']);
  git(sd, ['init', '-q']);
  commitAt(lv, 'LIN-9001: the thing (#1)', '2026-11-05T10:00:00Z', 'src/a.js');
  commitAt(sd, 'other repo, no ticket (#1)', '2026-11-05T10:00:00Z', 'src/b.js');
  for (const repo of [lv, sd]) git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  // the scripts at their real relative paths, so REPO_ROOT resolves to this fixture
  for (const f of ['freeze.mjs', 'dispatch-legs.mjs', 'inputs-v1.json']) {
    mkdirSync(path.join(lv, REL_TASK), { recursive: true });
    copyFileSync(path.join(here, f), path.join(lv, REL_TASK, f));
  }
  for (const f of ['freeze.mjs', 'inputs.mjs']) {
    mkdirSync(path.join(lv, REL_SIB), { recursive: true });
    copyFileSync(path.join(REAL_REPO, REL_SIB, f), path.join(lv, REL_SIB, f));
  }
  // lib/ is the real one: wall-clock-summary.js and what it imports resolve through the symlink
  symlinkSync(path.join(REAL_REPO, 'lib'), path.join(lv, 'lib'), 'dir');
  return { root, lv, sd };
}

// Inputs for a fixture run. lin_range_floor sits above LIN-9001, so the only candidate is that ticket.
function inputsFor(over = {}) {
  return {
    ticket: 'LIN-9000',
    attribution: 'dispatch',
    window_start: WINDOW,
    lin_range_floor: 9100,
    excluded: [],
    pair_sets: [],
    custom_founded_legs: { cr: 'work' },
    pace_ms: 0,
    ...over,
  };
}

// The default /cost for LIN-9001: an implementation lineage with an after-answer and a build follow-up, and a custom-founded
// lineage (coded `work`). Field names are the proxy's; freeze reads only kind, itemId and dispatches.
const COST = {
  totalUsd: 3.3,
  workerSessions: [
    { rootItemId: 'r1', kind: 'implementation', costUsd: 3.0, dispatches: [
      { itemId: 'r1', kind: 'implementation', dispatchedAt: '2026-11-05T10:00:00.000Z', costUsd: 2.0 },
      { itemId: 'af1', kind: 'custom', dispatchedAt: '2026-11-05T11:00:00.000Z', costUsd: 1.0 },
    ] },
    { rootItemId: 'cr', kind: 'custom', costUsd: 0.3, dispatches: [
      { itemId: 'cr', kind: 'custom', dispatchedAt: '2026-11-05T15:00:00.000Z', costUsd: 0.3 },
    ] },
  ],
};
const ROWS = [
  { id: 'r1', kind: 'implementation', issueIdentifier: 'LIN-9001', dispatchedAt: '2026-11-05T10:00:00.000Z' },
  { id: 'af1', kind: 'custom', issueIdentifier: 'LIN-9001', dispatchedAt: '2026-11-05T11:00:00.000Z' },
  { id: 'cr', kind: 'custom', issueIdentifier: 'LIN-9001', dispatchedAt: '2026-11-05T15:00:00.000Z' },
];
const PROMPTS = {
  af1: { kind: 'custom', prompt: `${AFTER}\nmore` },
  cr: { kind: 'custom', prompt: 'A custom-founded task\nmore' },
};

// A stub of the proxy, serving one scenario. Unstubbed paths answer 404 (freeze would retry those, so the tests stub what they read).
function startStub(s) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/api/proxy/dispatch' && !u.search) return json(200, { items: [], total: 0, truncated: false });
    if (u.pathname === '/api/proxy/dispatch' && u.searchParams.get('issueIdentifier') === 'LIN-9001') {
      return json(200, { items: s.rows, total: s.rows.length, truncated: s.listTruncated === true });
    }
    if (u.pathname === '/api/proxy/issues/LIN-9001') {
      return json(200, { identifier: 'LIN-9001', state: { name: 'Done' }, comments: [], ...(s.issueTruncated ? { truncated: { comments: true } } : {}) });
    }
    if (u.pathname === '/api/proxy/issues/LIN-9001/cost') return json(200, s.cost);
    const m = u.pathname.match(/^\/api\/proxy\/dispatch\/([^/]+)\/prompt$/);
    if (m && s.prompts[m[1]]) return json(200, { id: m[1], ...s.prompts[m[1]] });
    return json(404, { error: `not stubbed: ${u.pathname}` });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

function run(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// One scenario: a fixture, a stub with the scenario's answers, and one freeze run. `inputs` overrides the inputs file;
// `noInputsFlag` runs without --inputs (the default guard).
async function freezeScenario(s = {}) {
  const fx = makeFixture();
  const stub = await startStub({ rows: ROWS, cost: COST, prompts: PROMPTS, ...s.stub });
  try {
    const inputsPath = path.join(fx.root, 'inputs.json');
    writeFileSync(inputsPath, JSON.stringify(inputsFor(s.inputs)));
    const out = path.join(fx.root, 'out');
    const args = [out];
    if (!s.noInputsFlag) args.push('--inputs', inputsPath);
    const script = path.join(fx.lv, REL_TASK, 'freeze.mjs');
    const r = await run(script, args, { HARBOUR_LOCAL_BASE: stub.base });
    return { ...r, out, fx, inputsPath };
  } finally {
    await stub.close();
  }
}

const cleanup = (fx) => rmSync(fx.root, { recursive: true, force: true });

test('dispatch attribution freezes the prompt of every custom dispatch, with the inputs it was run on', async () => {
  const r = await freezeScenario();
  try {
    assert.equal(r.code, 0, r.stderr);
    const manifest = JSON.parse(readFileSync(path.join(r.out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.attribution, 'dispatch');
    assert.equal(manifest.ticket, 'LIN-9000');
    assert.deepEqual(manifest.population, ['LIN-9001']);
    assert.equal(manifest.inputs.path, path.relative(r.fx.lv, r.inputsPath));
    assert.ok(manifest.inputs.sha256.length === 64);
    assert.ok(existsSync(path.join(r.out, 'prompts/af1.json')));
    assert.ok(existsSync(path.join(r.out, 'prompts/cr.json')));
    assert.ok(!existsSync(path.join(r.out, 'prompts/r1.json')), 'only custom dispatches have prompts');
    assert.ok(manifest.files.some((f) => f.path === 'prompts/af1.json'));
  } finally {
    cleanup(r.fx);
  }
});

test('a truncated /dispatch list stops the freeze and writes no manifest', async () => {
  const r = await freezeScenario({ stub: { listTruncated: true } });
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /is flagged truncated/);
    assert.ok(!existsSync(path.join(r.out, 'manifest.json')));
  } finally {
    cleanup(r.fx);
  }
});

test('a truncated issue comment list (the sibling check) stops the freeze', async () => {
  const r = await freezeScenario({ stub: { issueTruncated: true } });
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /truncated\.comments === true/);
  } finally {
    cleanup(r.fx);
  }
});

test('an uncoded custom-founded lineage stops the freeze', async () => {
  const r = await freezeScenario({ inputs: { custom_founded_legs: {} } });
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /custom-founded lineage cr has no leg in the inputs/);
  } finally {
    cleanup(r.fx);
  }
});

test('drifted after-answer wording stops the freeze', async () => {
  const r = await freezeScenario({ stub: { prompts: { ...PROMPTS, af1: { kind: 'custom', prompt: 'A short, read-only follow-up for the Survey, reworded' } } } });
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /misses AFTER_RE/);
  } finally {
    cleanup(r.fx);
  }
});

test('a prompt read whose kind is not the /cost kind (a kindless dispatch defaulted to custom) stops the freeze', async () => {
  const r = await freezeScenario({ stub: { prompts: { ...PROMPTS, af1: { prompt: AFTER } } } });
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /the prompt read says null/);
  } finally {
    cleanup(r.fx);
  }
});

test('a kind missing from BUCKET_OF_KIND stops the freeze, naming the kind', async () => {
  const cost = { ...COST, workerSessions: [{ rootItemId: 'r1', kind: 'implementation', costUsd: 2.0, dispatches: [
    { itemId: 'r1', kind: 'implementation', dispatchedAt: '2026-11-05T10:00:00.000Z', costUsd: 1.0 },
    { itemId: 'x1', kind: 'frobnicate', dispatchedAt: '2026-11-05T11:00:00.000Z', costUsd: 1.0 },
  ] }] };
  const r = await freezeScenario({ stub: { cost } });
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /kind "frobnicate" is missing from BUCKET_OF_KIND/);
  } finally {
    cleanup(r.fx);
  }
});

test('the default inputs are refused where the out-dir holds its own inputs.json; nothing is read from the proxy', async () => {
  const fx = makeFixture();
  try {
    const out = path.join(fx.root, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'inputs.json'), JSON.stringify(inputsFor()));
    const r = await run(path.join(fx.lv, REL_TASK, 'freeze.mjs'), [out], { HARBOUR_LOCAL_BASE: 'http://127.0.0.1:9' });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /refusing the implicit default inputs/);
  } finally {
    cleanup(fx);
  }
});
