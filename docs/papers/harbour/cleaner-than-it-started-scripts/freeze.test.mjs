// freeze.test.mjs — LIN-4333. The freeze hardening, tested against a stubbed API and throwaway git repos.
//
// Run by hand only:  node --test docs/papers/harbour/cleaner-than-it-started-scripts/freeze.test.mjs
// Not wired into CI: the unit runner takes only the globs in package.json, and this folder is none of them.
//
// Each test builds a fixture LinearViewer repo (with a copy of these scripts at the real relative path, so
// freeze's REPO_ROOT resolves to the fixture) and a fixture simple-dispatcher repo, then runs freeze as a child
// process against a stub HTTP API on 127.0.0.1. The live API is never called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInstructions, assertNotTruncated, INSTRUCTIONS_CONTRACT } from './freeze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_UNDER_TEST = ['freeze.mjs', 'code-blind.mjs', 'inputs.mjs'];
const REL_SCRIPTS = path.join('docs', 'papers', 'harbour', 'cleaner-than-it-started-scripts');
// code-blind.mjs takes its Balance-to-sign rule from the Stability Review's blind module (LIN-4422), which imports the
// stability core; both go into the fixture at their real paths, or code-blind cannot load there.
const SHARED_FROM_REPO = ['scripts/stability-measures-blind.mjs', 'scripts/stability-measures-core.mjs'];
const REPO_ROOT_HERE = path.resolve(here, '..', '..', '..', '..');
const GOOD_INSTRUCTIONS = ['# Workspace API Proxy', ...INSTRUCTIONS_CONTRACT, 'more prose'].join('\n');

// ---- pure checks ----

test('the instructions check accepts the contract and names what is missing', () => {
  assert.doesNotThrow(() => checkInstructions(GOOD_INSTRUCTIONS));
  assert.throws(() => checkInstructions('hello'), /does not have the expected shape: missing "GET https:\/\/harbour\.cat\/api\/proxy\/issues\/\{issueId\}"/);
  assert.throws(() => checkInstructions('   '), /empty body/);
  const dropped = INSTRUCTIONS_CONTRACT[1];
  assert.throws(() => checkInstructions(GOOD_INSTRUCTIONS.replace(dropped, '')), (e) => e.message.includes(JSON.stringify(dropped)));
});

test('a response flagged truncated.comments === true is refused; an absent or false flag is not', () => {
  assert.throws(() => assertNotTruncated({ comments: [], truncated: { comments: true } }, '/issues/LIN-4150'), /truncated\.comments === true/);
  assert.doesNotThrow(() => assertNotTruncated({ comments: [] }, '/issues/LIN-1'));
  assert.doesNotThrow(() => assertNotTruncated({ items: [], truncated: false }, '/dispatch'));
});

// ---- fixture ----

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env },
  }).trim();
}

function commitAt(repo, subject, date, file) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), subject + '\n');
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', subject], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(repo, ['rev-parse', 'HEAD']);
}

// Blind comments on the fixture blind ticket. The cutoff below falls between the second and third blind pass.
const BLIND_COMMENTS = [
  { id: 'c1', createdAt: '2026-11-05T10:30:00.000Z', body: '## Blind place scoring, batch A\n\n| # | Commit | Balance | Reason |\n|---|---|---|---|\n| 1 | none | better | ok |' },
  { id: 'c2', createdAt: '2026-11-05T11:00:00.000Z', body: '## Blind place scoring, LIN-4248 pass E\n\n| # | Commit | Balance | Reason |\n|---|---|---|---|\n| 1 | none | neutral | ok |' },
  { id: 'c3', createdAt: '2026-11-06T09:00:00.000Z', body: '## Blind place scoring, LIN-4253 pass F\n\n| # | Commit | Balance | Reason |\n|---|---|---|---|\n| 1 | none | worse | ok |' },
  { id: 'c4', createdAt: '2026-11-06T09:30:00.000Z', body: '## Survey open-1 LIN-4253\n\nposted after the cutoff' },
];
const CUTOFF = '2026-11-06T08:00:00Z';

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lin4333-freeze-'));
  const lv = path.join(root, 'LinearViewer');
  const sd = path.join(root, 'simple-dispatcher');
  mkdirSync(lv, { recursive: true });
  mkdirSync(sd, { recursive: true });
  git(lv, ['init', '-q']);
  git(sd, ['init', '-q']);
  // scripts at the real relative path, so REPO_ROOT resolves to this fixture
  const scriptDir = path.join(lv, REL_SCRIPTS);
  mkdirSync(scriptDir, { recursive: true });
  for (const f of SCRIPTS_UNDER_TEST) copyFileSync(path.join(here, f), path.join(scriptDir, f));
  mkdirSync(path.join(lv, 'scripts'), { recursive: true });
  for (const f of SHARED_FROM_REPO) copyFileSync(path.join(REPO_ROOT_HERE, f), path.join(lv, f));
  // the place ledger at the pin: no LIN ids, so the ledger check has nothing to explain
  mkdirSync(path.join(lv, 'docs', 'plans', 'survey'), { recursive: true });
  writeFileSync(path.join(lv, 'docs', 'plans', 'survey', 'place-ledger.md'), '# ledger\n\nno tickets here\n');
  commitAt(lv, 'LIN-0000: base (#1)', '2026-10-01T09:00:00Z', 'README.md');            // before every window
  const octSha = commitAt(lv, 'LIN-4190: pair one (#10)', '2026-10-25T10:00:00Z', 'lib/a.js');   // in the Oct window only
  commitAt(lv, 'LIN-4248: first thing (#11)', '2026-11-05T10:00:00Z', 'lib/b.js');
  const lvPin = commitAt(lv, 'LIN-4253: second thing (#12)', '2026-11-05T12:00:00Z', 'lib/c.js');
  const sdPin = commitAt(sd, 'LIN-9001: sd thing (#3)', '2026-11-05T09:00:00Z', 'src/x.js');
  return { root, lv, sd, lvPin, sdPin, octSha, scriptDir };
}

function inputsFor(fx, over = {}) {
  return {
    ticket: 'LIN-4315',
    window_start: '2026-11-04T00:00:00Z',
    lv_pin: fx.lvPin,
    sd_pin: fx.sdPin,
    parents: [],
    blind: {
      ticket: 'LIN-4150', expected_passes: 3, expected_batches: ['A'],
      sessions: [{ name: 'pass-1 (batches A+B)', batches: ['A', 'B'] }], baseline_note: 'x',
    },
    baseline_3nov_ids: [], baseline_3nov_window: { since: '2026-11-02T00:00Z', until: '2026-11-04T00:00Z' },
    baseline_3nov_file: 'git/merges-LinearViewer-2026-11-02-03.tsv',
    ui_four: [], folded: [], context: [],
    pace_ms: 0,
    ...over,
  };
}

function startStub({ instructions = GOOD_INSTRUCTIONS, blindComments = BLIND_COMMENTS, truncatedBlind = false } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    hits.push(u.pathname + u.search);
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/api/proxy/instructions') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(instructions); }
    let m = u.pathname.match(/^\/api\/proxy\/issues\/([^/]+)$/);
    if (m) {
      if (m[1] === 'LIN-4150') {
        const body = { identifier: 'LIN-4150', state: { name: 'In Progress' }, comments: blindComments };
        if (truncatedBlind) body.truncated = { comments: true };
        return json(200, body);
      }
      return json(200, { identifier: m[1], state: { name: 'Done' }, comments: [] });
    }
    if (/^\/api\/proxy\/issues\/[^/]+\/cost$/.test(u.pathname)) return json(200, { totalUsd: 1.5 });
    if (u.pathname === '/api/proxy/dispatch') return json(200, { items: [] });
    return json(404, { error: `not stubbed: ${u.pathname}` });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((r) => server.close(r)),
  })));
}

// Runs a script as a child process. Async, so the in-process stub keeps serving while it runs.
function run(script, args, { cwd, base }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, HARBOUR_LOCAL_BASE: base ?? '' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function withFixture(fn) {
  const fx = makeFixture();
  try { return await fn(fx); } finally { rmSync(fx.root, { recursive: true, force: true }); }
}

const freezeScript = (fx) => path.join(fx.scriptDir, 'freeze.mjs');
const codeBlindScript = (fx) => path.join(fx.scriptDir, 'code-blind.mjs');

// ---- the freeze, end to end ----

test('bad GET /instructions shape: freeze stops before writing anything', async () => {
  await withFixture(async (fx) => {
    const stub = await startStub({ instructions: 'a page that is not the contract' });
    try {
      const inp = path.join(fx.root, 'inputs.json');
      writeFileSync(inp, JSON.stringify(inputsFor(fx)));
      const out = path.join(fx.root, 'out');
      const r = await run(freezeScript(fx), [out, '--inputs', inp, '--sd', fx.sd], { cwd: fx.lv, base: stub.base });
      assert.notEqual(r.code, 0, 'freeze should exit non-zero');
      assert.match(r.stderr, /GET \/instructions does not have the expected shape/);
      assert.equal(existsSync(out), false, 'no output folder is created before the shape check passes');
      assert.deepEqual(stub.hits, ['/api/proxy/instructions'], 'no data route is read after a bad shape');
    } finally { await stub.close(); }
  });
});

test('a blind-ticket response flagged truncated.comments === true: freeze fails, naming the ticket', async () => {
  await withFixture(async (fx) => {
    const stub = await startStub({ truncatedBlind: true });
    try {
      const inp = path.join(fx.root, 'inputs.json');
      writeFileSync(inp, JSON.stringify(inputsFor(fx)));
      const out = path.join(fx.root, 'out');
      const r = await run(freezeScript(fx), [out, '--inputs', inp, '--sd', fx.sd], { cwd: fx.lv, base: stub.base });
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /\/issues\/LIN-4150 is flagged truncated\.comments === true/);
    } finally { await stub.close(); }
  });
});

test('without a cutoff: the freeze counts every blind pass, writes no cutoff key and no Oct list', async () => {
  await withFixture(async (fx) => {
    const stub = await startStub();
    try {
      const inp = path.join(fx.root, 'inputs.json');
      writeFileSync(inp, JSON.stringify(inputsFor(fx)));
      const out = path.join(fx.root, 'out');
      const r = await run(freezeScript(fx), [out, '--inputs', inp, '--sd', fx.sd], { cwd: fx.lv, base: stub.base });
      assert.equal(r.code, 0, r.stderr);
      assert.ok(stub.hits.includes('/api/proxy/instructions'), 'the instructions shape is checked');
      const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.linear_150_comments, { count: 4, blind_passes: 3, batch_a_to_d_present: true });
      assert.equal(existsSync(path.join(out, 'git', 'merges-LinearViewer-2026-10-20-11-01.tsv')), false);
      assert.deepEqual(manifest.population, ['LIN-4248', 'LIN-4253', 'LIN-9001']);
    } finally { await stub.close(); }
  });
});

test('cutoff: comments after it stay in the raw file, are counted, and the blind count is cutoff-filtered', async () => {
  await withFixture(async (fx) => {
    const stub = await startStub();
    try {
      const inp = path.join(fx.root, 'inputs.json');
      const cut = inputsFor(fx, { blind: { ...inputsFor(fx).blind, expected_passes: 2, comment_cutoff: CUTOFF } });
      writeFileSync(inp, JSON.stringify(cut));
      const out = path.join(fx.root, 'out');
      const r = await run(freezeScript(fx), [out, '--inputs', inp, '--sd', fx.sd], { cwd: fx.lv, base: stub.base });
      assert.equal(r.code, 0, r.stderr);
      const raw = JSON.parse(readFileSync(path.join(out, 'comments', 'LIN-4150.json'), 'utf8'));
      assert.equal(raw.comments.length, 4, 'the raw file keeps every comment, including those after the cutoff');
      const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.linear_150_comments.after_cutoff, { cutoff: CUTOFF, comments: 2, blind_passes: 1 });
    } finally { await stub.close(); }
  });
});

test('cutoff: code-blind codes only the passes up to the cutoff; without it, all three', async () => {
  await withFixture(async (fx) => {
    const stub = await startStub();
    try {
      const inpCut = path.join(fx.root, 'cut.json');
      const inpAll = path.join(fx.root, 'all.json');
      writeFileSync(inpCut, JSON.stringify(inputsFor(fx, { blind: { ...inputsFor(fx).blind, expected_passes: 2, comment_cutoff: CUTOFF } })));
      writeFileSync(inpAll, JSON.stringify(inputsFor(fx)));
      const out = path.join(fx.root, 'out');
      assert.equal((await run(freezeScript(fx), [out, '--inputs', inpCut, '--sd', fx.sd], { cwd: fx.lv, base: stub.base })).code, 0);
      const cut = await run(codeBlindScript(fx), [out, '--inputs', inpCut], { cwd: fx.lv });
      assert.equal(cut.code, 0, cut.stderr);
      assert.equal(JSON.parse(readFileSync(path.join(out, 'blind-codes.json'), 'utf8')).passes_count, 2);
      const all = await run(codeBlindScript(fx), [out, '--inputs', inpAll], { cwd: fx.lv });
      assert.equal(all.code, 0, all.stderr);
      assert.equal(JSON.parse(readFileSync(path.join(out, 'blind-codes.json'), 'utf8')).passes_count, 3);
    } finally { await stub.close(); }
  });
});

test('oct_merges named: freeze writes the Oct list with the files each merge touches; code-blind resolves its labels only then', async () => {
  await withFixture(async (fx) => {
    // a fourth blind pass: a pair-baseline title whose commit label is the Oct merge
    const pairComment = { id: 'c5', createdAt: '2026-11-05T13:00:00.000Z', body: `## Blind place scoring, baseline pair 1 pass AW\n\n| # | Commit | Balance | Reason |\n|---|---|---|---|\n| 1 | ${fx.octSha.slice(0, 8)} | better | ok |` };
    const stub = await startStub({ blindComments: [...BLIND_COMMENTS, pairComment] });
    try {
      const oct = { since: '2026-10-20T00:00Z', until: '2026-11-02T00:00Z', file: 'git/merges-LinearViewer-2026-10-20-11-01.tsv' };
      const withOct = path.join(fx.root, 'with-oct.json');
      const withoutOct = path.join(fx.root, 'without-oct.json');
      writeFileSync(withOct, JSON.stringify(inputsFor(fx, { oct_merges: oct, blind: { ...inputsFor(fx).blind, expected_passes: 4 } })));
      writeFileSync(withoutOct, JSON.stringify(inputsFor(fx, { blind: { ...inputsFor(fx).blind, expected_passes: 4 } })));
      const out = path.join(fx.root, 'out');
      const r = await run(freezeScript(fx), [out, '--inputs', withOct, '--sd', fx.sd], { cwd: fx.lv, base: stub.base });
      assert.equal(r.code, 0, r.stderr);

      const lines = readFileSync(path.join(out, oct.file), 'utf8').trim().split('\n');
      assert.equal(lines[0], 'full_sha\tshort\tcommitted\tsubject\tfiles');
      assert.equal(lines.length, 2, 'one Oct merge in the fixture');
      const cols = lines[1].split('\t');
      assert.equal(cols[3], 'LIN-4190: pair one (#10)');
      assert.equal(cols[4], 'lib/a.js');

      // code-blind without the Oct list named: the pair label cannot resolve
      const blindOff = await run(codeBlindScript(fx), [out, '--inputs', withoutOct], { cwd: fx.lv });
      assert.equal(blindOff.code, 0, blindOff.stderr);
      const off = JSON.parse(readFileSync(path.join(out, 'blind-codes.json'), 'utf8'));
      assert.equal(off.unresolved_labels.length, 1);

      // with the Oct list named: it resolves, and the pass is a pair-baseline with no ticket
      const blindOn = await run(codeBlindScript(fx), [out, '--inputs', withOct], { cwd: fx.lv });
      assert.equal(blindOn.code, 0, blindOn.stderr);
      const on = JSON.parse(readFileSync(path.join(out, 'blind-codes.json'), 'utf8'));
      assert.equal(on.unresolved_labels.length, 0);
      const pair = on.passes.find((p) => p.kind === 'pair-baseline');
      assert.equal(pair.subject, 'baseline pair 1');
      assert.equal(pair.subject_tickets, null);
      assert.equal(pair.rows[0].shas[0].subject, 'LIN-4190: pair one (#10)');
    } finally { await stub.close(); }
  });
});
