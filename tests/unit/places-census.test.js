/**
 * LIN-4562 (LIN-4342 piece 1): the places census. lib/places.js is the one list of places, so it must name every page
 * the app renders, and every place it names must have a page. Code not yet written cannot be searched for, so this is
 * what catches a new orphan:
 *  1. every `currentPage: '<key>'` a renderer passes the old bar, and every `place: '<key>'` a renderer passes the
 *     frame, resolves to a place or a drilled-in page (by its key or an alias);
 *  2. every place and every drilled-in page with a path has a route that serves it.
 *
 * Witness: a renderer passing `currentPage: 'nowhere'` fails test 1; a place whose path no route serves fails test 2.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/places-census.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACES, DRILLED, placeFor } from '../../lib/places.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every .js file under `dir`, recursively. */
function jsFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return jsFiles(rel);
    return name.endsWith('.js') ? [rel] : [];
  });
}

const SOURCES = [...jsFiles('lib'), ...jsFiles('routes'), 'server.js'];
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The keys renderers pass: `currentPage: '<k>'` (the old bar) and `place: '<k>'` (the frame). */
export function renderedKeys(files = SOURCES) {
  const keys = [];
  for (const rel of files) {
    const src = read(rel);
    for (const m of src.matchAll(/\bcurrentPage:\s*'([a-z][a-z-]*)'/g)) keys.push({ key: m[1], rel, via: 'currentPage' });
    for (const m of src.matchAll(/\bplace:\s*'([a-z][a-z-]*)'/g)) keys.push({ key: m[1], rel, via: 'place' });
  }
  return keys;
}

/** The workspace page routes the server registers, as their path after `/workspace/:urlKey`. */
function workspaceRoutes() {
  const routes = new Set();
  for (const rel of ['server.js', ...jsFiles('routes')]) {
    for (const m of read(rel).matchAll(/\.(?:get|all)\(\s*'\/workspace\/:urlKey(\/[^']*)'/g)) routes.add(m[1]);
  }
  return routes;
}

/** True when a route serves `path` (a route may add an optional segment, as `/swipe/:identifier?` does). */
function served(routes, path) {
  for (const route of routes) {
    if (route === path) return true;
    if (route.startsWith(`${path === '/' ? '' : path}/:`) && route.endsWith('?')) return true;
  }
  return false;
}

describe('every key a renderer uses is a registered place', () => {
  const keys = renderedKeys();

  test('the census finds the renderers (it is not vacuous)', () => {
    assert.ok(keys.filter(k => k.via === 'currentPage').length >= 20, `found ${keys.length}`);
    assert.ok(keys.some(k => k.via === 'place' && k.key === 'connect'), 'the Connect an agent page is on the frame');
    assert.ok(keys.some(k => k.via === 'place' && k.key === 'search'), 'the search page is on the frame');
  });

  for (const { key, rel, via } of keys) {
    test(`${rel}: ${via} '${key}' is in lib/places.js`, () => {
      assert.ok(placeFor(key), `${rel} passes ${via} '${key}', which lib/places.js does not register (a place, a drilled-in page or an alias)`);
    });
  }
});

describe('every registered place has a page', () => {
  const routes = workspaceRoutes();

  test('the route scan finds the workspace pages (it is not vacuous)', () => {
    assert.ok(routes.has('/') && routes.has('/proxy') && routes.has('/search'), [...routes].join(' '));
  });

  for (const entry of [...PLACES, ...DRILLED].filter(e => e.path)) {
    test(`${entry.key} (${entry.path}) is served`, () => {
      assert.ok(served(routes, entry.path), `no route serves /workspace/:urlKey${entry.path} for ${entry.key}`);
    });
  }

  test('the fixture self-check: an unserved path is reported', () => {
    assert.equal(served(routes, '/no-such-place'), false);
  });
});

