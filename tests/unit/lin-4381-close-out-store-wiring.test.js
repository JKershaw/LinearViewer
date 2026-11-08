/**
 * LIN-4381 — the close-out events store reaches GET /api/proxy/periodicals in
 * production (builder note 1 on LIN-4349's plan review b79ff49e).
 *
 * The route reads landings from `closeOutEventsStore`. Every dependency on the
 * way defaults to `null`, and the route tests inject the store directly, so a
 * dropped hop would pass every injected test while production read no landings
 * and no lane ever read `landed`. server.js boots a real app on import, so,
 * like tests/unit/lin-3137-server-wiring-census.test.js, this reads the source
 * text and pins each hop: server.js → createProxyRoutes → createComputeRoutes →
 * the route's read.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const serverSrc = read('server.js');
const proxySrc = read('routes/proxy.js');
const computeSrc = read('routes/proxy-compute.js');

// The text of a call's object literal, from `<name>({` to its closing `}))`.
function mountArgs(src, name) {
  const start = src.indexOf(`${name}({`);
  assert.notEqual(start, -1, `${name}({ ... }) must exist`);
  const end = src.indexOf('}))', start);
  assert.notEqual(end, -1, `${name}({ ... }) must close`);
  return src.slice(start, end);
}

// The text of a factory's destructured parameter list, `export function <name>({ ... })`.
function factoryParams(src, name) {
  const start = src.indexOf(`export function ${name}({`);
  assert.notEqual(start, -1, `export function ${name}({ ... }) must exist`);
  const end = src.indexOf('}) {', start);
  assert.notEqual(end, -1, `${name}'s parameter list must close`);
  return src.slice(start, end);
}

describe('LIN-4381: closeOutEventsStore is threaded to the periodicals route', () => {
  test('server.js constructs the store as `closeOutEventsStore`', () => {
    assert.match(serverSrc, /const\s+closeOutEventsStore\s*=\s*new\s+CloseOutEventsStore\s*\(/);
  });

  test('server.js passes closeOutEventsStore into createProxyRoutes({ ... })', () => {
    assert.match(mountArgs(serverSrc, 'app.use(createProxyRoutes'), /\bcloseOutEventsStore\b/,
      'createProxyRoutes must receive the events store, or GET /api/proxy/periodicals reads no landings in production');
  });

  test('createProxyRoutes takes closeOutEventsStore and forwards it into createComputeRoutes({ ... })', () => {
    assert.match(factoryParams(proxySrc, 'createProxyRoutes'), /\bcloseOutEventsStore\b/);
    assert.match(mountArgs(proxySrc, 'createComputeRoutes'), /\bcloseOutEventsStore\b/,
      'createComputeRoutes must receive the events store from createProxyRoutes');
  });

  test('createComputeRoutes takes closeOutEventsStore and the periodicals route reads landings from it', () => {
    assert.match(factoryParams(computeSrc, 'createComputeRoutes'), /\bcloseOutEventsStore\b/);
    assert.match(computeSrc, /closeOutEventsStore\.listMergedSince\(/,
      'the route must read landings through the bounded store read');
  });
});
