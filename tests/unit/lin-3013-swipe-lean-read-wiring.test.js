/**
 * LIN-3013: the Swipe route's session-count read — `getLoopsForWorkspace` at
 * server.js:2748 — must pass `lean: true`. Its result feeds only
 * `buildSessionCounts(allLoops)`, which reads exactly one field
 * (`issueIdentifier`) per loop, so once Phase 3 (LIN-3011) landed a
 * digest-backed lean read, there is no longer any reason for this read to
 * carry `feedback`/`promptText`.
 *
 * This is a source-text pin, not a behavioral test — server.js is not
 * import-safe in a unit test (it connects to Mongo and calls app.listen() at
 * module load), the same constraint documented in
 * tests/unit/lin-2521-resolve-team-selection-wiring.test.js and
 * tests/unit/lin-1503-github-family-401-remint.test.js. This file follows
 * that same established pattern: read server.js, slice out the swipe route's
 * own body between its `app.get(...)` registration and the next one, and
 * assert against that slice — so the pin can only be satisfied by THIS
 * route's own call gaining `lean: true`, never by some other
 * `getLoopsForWorkspace` call site in the file (of which there are several;
 * see lib/pipeline-loops.js's callers) picking it up instead.
 *
 * The runtime behavioral witness — that `buildSessionCounts` produces
 * identical output whether the underlying read was lean or not, across
 * aborted/harvested/parked/decision rows — lives in
 * tests/unit/pipeline-loops.test.js (the "LIN-3013" describe block).
 *
 * Run with: node --test tests/unit/lin-3013-swipe-lean-read-wiring.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const SWIPE_ROUTE_MARKER = "app.get('/workspace/:urlKey/swipe/:identifier?', workspaceFromUrl, async (req, res) => {";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function swipeRouteBody() {
  const routeIdx = SERVER_SRC.indexOf(SWIPE_ROUTE_MARKER);
  assert.notEqual(routeIdx, -1, 'expected to find the swipe route registration in server.js');
  const nextRouteIdx = SERVER_SRC.indexOf('\napp.get(', routeIdx + SWIPE_ROUTE_MARKER.length);
  assert.notEqual(nextRouteIdx, -1, 'expected to find the next route registration after the swipe route');
  return SERVER_SRC.slice(routeIdx, nextRouteIdx);
}

describe('LIN-3013 — the swipe route session-count read passes lean: true', () => {
  test('the swipe route registers exactly once (sanity for the slice below)', () => {
    const matches = [...SERVER_SRC.matchAll(new RegExp(escapeRegExp(SWIPE_ROUTE_MARKER), 'g'))];
    assert.equal(matches.length, 1, `expected exactly one swipe route registration, found ${matches.length}`);
  });

  test('getLoopsForWorkspace appears exactly once inside the swipe route body', () => {
    const body = swipeRouteBody();
    const calls = [...body.matchAll(/getLoopsForWorkspace\(/g)];
    assert.equal(calls.length, 1, `expected exactly one getLoopsForWorkspace( call inside the swipe route, found ${calls.length}`);
  });

  test("the swipe route's own getLoopsForWorkspace call includes lean: true", () => {
    const body = swipeRouteBody();
    assert.match(
      body,
      /getLoopsForWorkspace\(workspace\.urlKey,\s*\{[^)]*\blean:\s*true\b[^)]*\}\)/,
      "expected the swipe route's getLoopsForWorkspace call to include `lean: true` in its options object"
    );
  });
});
