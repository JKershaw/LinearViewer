/**
 * LIN-2386 — env-check accepts Playwright browsers in the cache Playwright
 * installs to on macOS (`$HOME/Library/Caches/ms-playwright`), and holds every
 * candidate cache to one standard: it counts only when it holds a `chromium*`
 * entry. An empty or firefox-only directory is still a blocker.
 *
 * Exit status is NOT under test here beyond "still 0": making it non-zero is a
 * separate decision (setup runs env-check at every session start, dispatched
 * workers included). The status test below pins the current behaviour.
 *
 * Negative cases skip when the absolute `/ms-playwright` exists (the Playwright
 * container image). The harness cannot hide an absolute path, so there the
 * blocker cannot be produced and only the positive cases run, which pass
 * without exercising the fix. The unit job on bare ubuntu-latest is where the
 * negative witnesses bite.
 *
 * Run with: node --test tests/unit/env-check-playwright-browsers.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { runEnvCheck } from '../fixtures/env-check-harness.js';

const BLOCKER = 'Install Playwright browsers';
const INSTALLED = 'Playwright browsers installed';
const INSTALL_CMD = '→ npx playwright install chromium --with-deps';

const absoluteCachePresent = existsSync('/ms-playwright');
const negative = absoluteCachePresent
  ? { skip: 'host has /ms-playwright (Playwright container image); cannot isolate a negative case' }
  : {};

// Each candidate location, as the harness options that place a cache there.
// `entries` are created inside it; an empty list leaves a bare directory.
const under = (root, entries) => [root, ...entries.map((e) => `${root}/${e}`)];
const LOCATIONS = [
  ['HOME/.cache/ms-playwright', (e) => ({ home: under('.cache/ms-playwright', e) })],
  ['XDG_CACHE_HOME/ms-playwright', (e) => ({ xdgCache: e })],
  ['HOME/Library/Caches/ms-playwright', (e) => ({ home: under('Library/Caches/ms-playwright', e) })],
  ['cwd node_modules/playwright-core/.local-browsers', (e) => ({ cwd: under('node_modules/playwright-core/.local-browsers', e) })],
  ['PLAYWRIGHT_BROWSERS_PATH', (e) => ({ playwrightBrowsers: e })],
];

test('macOS cache with an installed chromium is accepted (the Done-when)', () => {
  const r = runEnvCheck({ home: ['Library/Caches/ms-playwright/chromium-1200'] });
  assert.match(r.out, new RegExp(INSTALLED));
  assert.doesNotMatch(r.out, new RegExp(BLOCKER));
});

test('chromium_headless_shell alone counts as installed', () => {
  const r = runEnvCheck({ home: ['Library/Caches/ms-playwright/chromium_headless_shell-1200'] });
  assert.match(r.out, new RegExp(INSTALLED));
});

for (const [location, opts] of LOCATIONS) {
  test(`${location}: an empty directory is a blocker`, negative, () => {
    const r = runEnvCheck(opts([]));
    assert.match(r.out, new RegExp(BLOCKER));
  });

  test(`${location}: a firefox-only cache is a blocker`, negative, () => {
    const r = runEnvCheck(opts(['firefox-1000']));
    assert.match(r.out, new RegExp(BLOCKER));
    assert.doesNotMatch(r.out, new RegExp(INSTALLED));
  });

  test(`${location}: a chromium-containing cache is accepted`, () => {
    const r = runEnvCheck(opts(['firefox-1000', 'chromium-1200']));
    assert.match(r.out, new RegExp(INSTALLED));
    assert.doesNotMatch(r.out, new RegExp(BLOCKER));
  });
}

test('no cache anywhere: blocker with the install command', negative, () => {
  const r = runEnvCheck({});
  assert.match(r.out, new RegExp(BLOCKER));
  assert.ok(r.out.includes(INSTALL_CMD), r.out);
});

// Pinned by LIN-2386: exit status stays 0 with a blocker printed, until the
// separate exit-status decision is made.
test('no cache anywhere: exit status stays 0 (pinned by LIN-2386)', negative, () => {
  const r = runEnvCheck({});
  assert.match(r.out, new RegExp(BLOCKER));
  assert.equal(r.status, 0);
});
