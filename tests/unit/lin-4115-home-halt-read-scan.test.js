/**
 * LIN-4115 (UI round 3 · S3d): source scan for the two Home producers.
 *
 * Home's HTML is built in exactly two places: the route in server.js and the post-401 re-render in
 * lib/dashboard-refresh.js. Each must (a) read the halt through the poll path, readHaltForPoll(...), and
 * (b) pass the result to renderPage as `halt`. A third Home producer, or a path that skips the read, would
 * show a banner on one page and none on another, and a unit test on renderPage alone would not notice.
 *
 * Modelled on lin-3774-fetch-and-prepare-projects-secondary-binding.test.js, which scans the same two files.
 * Witnesses: each fails on the unimplemented path.
 *
 * Run: node --test tests/unit/lin-4115-home-halt-read-scan.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const REFRESH_SRC = readFileSync(join(__dirname, '../../lib/dashboard-refresh.js'), 'utf8');

// The Home call site: `const html = renderPage(homeView.trees, ...)` up to the `res.send(html)` that follows it.
// LIN-4119: the backlog page renders the same trees in page mode `backlog`, which draws no halt banner, so its call is
// not a Home producer and is not in this scan (its own pin below checks it reads no halt).
function homeRenderBlocks(src) {
  const starts = [...src.matchAll(/renderPage\(homeView\.trees/g)].map(m => m.index);
  return starts
    .map(start => src.slice(start, src.indexOf('res.send(html)', start)))
    .filter(block => !/pageMode:\s*'backlog'/.test(block));
}

// A `halt` key in the renderPage options that carries the value read by readHaltForPoll:
// the shorthand `halt,` or `halt: halt`. A `halt: null` / `halt: undefined` line must not match.
const PASSES_HALT = /^\s+halt(?:,|\s*:\s*halt\b)/m;

describe('LIN-4115 — both Home producers read the halt through readHaltForPoll', () => {
  test('server.js (the Home route) reads it with the poll path\'s exact call form', () => {
    assert.match(SERVER_SRC, /readHaltForPoll\(workspaceHaltStore,\s*workspace\.urlKey,\s*POLL_HALT_READ_TIMEOUT_MS\)/);
  });

  test('lib/dashboard-refresh.js (the post-401 re-render) reads it through its injected deps', () => {
    assert.match(REFRESH_SRC, /readHaltForPoll\(workspaceHaltStore,\s*workspace\.urlKey,\s*haltReadTimeoutMs\)/);
  });

  test('the refresh path takes workspaceHaltStore and haltReadTimeoutMs as deps (defaulted like routes/dispatch.js)', () => {
    assert.match(REFRESH_SRC, /workspaceHaltStore\s*=\s*null/);
    assert.match(REFRESH_SRC, /haltReadTimeoutMs\s*=\s*POLL_HALT_READ_TIMEOUT_MS/);
  });

  test('server.js\'s refresh wrapper hands workspaceHaltStore to lib/dashboard-refresh.js', () => {
    const wrapper = SERVER_SRC.slice(SERVER_SRC.indexOf('renderRefreshedDashboard({'), SERVER_SRC.indexOf('}, { workspace, session'));
    assert.match(wrapper, /\bworkspaceHaltStore\b/, 'the wrapper must pass the store, or the refresh read has nothing to read');
  });
});

describe('LIN-4115 — every Home renderPage call passes halt', () => {
  test('exactly two Home renderPage(homeView.trees, …) calls exist: the route and the refresh tail', () => {
    const total = homeRenderBlocks(SERVER_SRC).length + homeRenderBlocks(REFRESH_SRC).length;
    assert.equal(total, 2, `expected 2 Home producers, found ${total}; a new producer must read halt too`);
  });

  test('the server.js Home route passes halt to renderPage', () => {
    const blocks = homeRenderBlocks(SERVER_SRC);
    assert.equal(blocks.length, 1, 'one Home render call in server.js');
    assert.match(blocks[0], PASSES_HALT, 'server.js Home renderPage call lacks halt');
  });

  test('the backlog page renders in page mode backlog and its route reads no halt (it draws no halt banner)', () => {
    const blocks = [...SERVER_SRC.matchAll(/renderPage\(homeView\.trees/g)].map(m => SERVER_SRC.slice(m.index, SERVER_SRC.indexOf('res.send(html)', m.index)));
    const backlog = blocks.filter(b => /pageMode:\s*'backlog'/.test(b));
    assert.equal(backlog.length, 1, 'one backlog render call in server.js');
    const route = SERVER_SRC.slice(SERVER_SRC.indexOf("app.get('/workspace/:urlKey/backlog'"), SERVER_SRC.indexOf('res.send(html)', SERVER_SRC.indexOf("app.get('/workspace/:urlKey/backlog'")));
    assert.doesNotMatch(route, /readHaltForPoll\(/, 'the backlog route must not read the halt: its page shows no banner');
  });

  test('the refresh tail passes halt to renderPage (a route-only fix would drop the banner after a token refresh)', () => {
    const blocks = homeRenderBlocks(REFRESH_SRC);
    assert.equal(blocks.length, 1, 'one Home render call in lib/dashboard-refresh.js');
    assert.match(blocks[0], PASSES_HALT, 'lib/dashboard-refresh.js Home renderPage call lacks halt');
  });
});
