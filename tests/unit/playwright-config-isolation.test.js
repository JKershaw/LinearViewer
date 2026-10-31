// LIN-3583: a local `npx playwright test` must never write to a developer's
// MongoDB or their own ./data store. Hermetic: imports the config only (it
// defines webServer entries, it does not start them) and binds no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../../playwright.config.js';
import visualConfig from '../../playwright.visual.config.js';
import perfConfig from '../../playwright.perf.config.js';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../playwright.config.js', import.meta.url), 'utf8');

test('UNCONFIGURED_ENV pins MONGODB_URI empty so a developer URI cannot reach the servers', () => {
  const m = source.match(/const UNCONFIGURED_ENV = '([^']*)'/);
  assert.ok(m, 'UNCONFIGURED_ENV literal found');
  assert.match(m[1], /(^| )MONGODB_URI=( |$)/);
});

test('every webServer command sets an isolated HARBOUR_DATA_DIR under ./test-results/', () => {
  assert.ok(config.webServer.length >= 3);
  for (const ws of config.webServer) {
    assert.match(ws.command, /(^| )HARBOUR_DATA_DIR=\.\/test-results\/[\w.-]+( |$)/, ws.url);
    assert.match(ws.command, /(^| )MONGODB_URI=( |$)/, `${ws.url} inherits UNCONFIGURED_ENV`);
  }
  const dirs = config.webServer.map((ws) => ws.command.match(/HARBOUR_DATA_DIR=(\S+)/)[1]);
  assert.equal(new Set(dirs).size, dirs.length, 'each server has its own dir');
});

test('the visual-screenshot config webServer is isolated the same way', () => {
  const servers = [].concat(visualConfig.webServer);
  assert.ok(servers.length >= 1);
  for (const ws of servers) {
    assert.match(ws.command, /(^| )HARBOUR_DATA_DIR=\.\/test-results\/[\w.-]+( |$)/, ws.url);
    assert.match(ws.command, /(^| )MONGODB_URI=( |$)/, `${ws.url} pins MONGODB_URI empty`);
  }
});

// LIN-1484: a developer's LINEAR_ACCESS_TOKEN in .env must not PAT-sign the e2e
// servers in. dotenv never overrides a variable already set, so an empty
// assignment on each command line wins over .env. Every webServer in every
// Playwright config is pinned, including the perf config (it spreads the main
// config, so it inherits the 3001/3002/3003 servers).
test('every webServer in every Playwright config blanks LINEAR_ACCESS_TOKEN', () => {
  const servers = [
    ...config.webServer,
    ...[].concat(visualConfig.webServer),
    ...[].concat(perfConfig.webServer),
  ];
  assert.ok(servers.length >= 4);
  for (const ws of servers) {
    assert.match(ws.command, /(^| )LINEAR_ACCESS_TOKEN=( |$)/, `${ws.url} pins LINEAR_ACCESS_TOKEN empty`);
  }
});
