/**
 * LIN-2802 — the workspace switcher's add rows, built from the provider
 * registry rather than hand-written literals.
 *
 * LIN-4568: the old bar's menu (`renderWorkspaceOptions`, lib/components/navbar.js) went with the bar; these cases now
 * read the rail's workspace menu (`renderRail`, lib/components/frame.js), which draws its add rows from the same
 * `workspaceAddProviders` list.
 *
 * The menu must render one "+ <displayName>" row per provider
 * that declares an `entryCta` AND whose `entryCta.isConfigured()` is true,
 * in registry (barrel-import) order, with Linear's PAT-mode hide staying an
 * orthogonal filter (Linear's own `entryCta.isConfigured()` is unconditionally
 * `true` by design and does not encode the PAT gate). Local has no `entryCta`
 * and keeps its bespoke, always-last row.
 *
 * Reuses the env-toggle pattern from tests/unit/lin-1890-jira-entry-surfaces.test.js
 * (the house convention for proving the configured path without mutating the
 * shared Playwright webServer's process-global env).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { renderRail } from '../../lib/components/frame.js';

const renderWorkspaceOptions = (workspaces, urlKey) => renderRail({ urlKey, workspaces });

const JIRA_ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
const GITHUB_ENV_KEYS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
const ENV_KEYS = [...JIRA_ENV_KEYS, ...GITHUB_ENV_KEYS];
let saved;

const configureJira = () => {
  process.env.JIRA_CLIENT_ID = 'client-id-1';
  process.env.JIRA_CLIENT_SECRET = 'secret-1';
  process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
};
const unconfigureJira = () => { for (const k of JIRA_ENV_KEYS) delete process.env[k]; };

const { privateKey: VALID_GITHUB_PEM } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const VALID_GITHUB_PEM_STR = VALID_GITHUB_PEM.export({ type: 'pkcs1', format: 'pem' });

const configureGithub = () => {
  process.env.GITHUB_CLIENT_ID = 'gh-client-id-1';
  process.env.GITHUB_CLIENT_SECRET = 'gh-secret-1';
  process.env.GITHUB_APP_ID = '123456';
  process.env.GITHUB_APP_PRIVATE_KEY = VALID_GITHUB_PEM_STR;
  process.env.GITHUB_APP_SLUG = 'harbour-test';
};
const unconfigureGithub = () => { for (const k of GITHUB_ENV_KEYS) delete process.env[k]; };

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  unconfigureGithub();
  unconfigureJira();
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const WORKSPACES = [{ urlKey: 'acme', name: 'Acme' }];

// Extracts the ordered list of add-row testids from the rendered HTML.
const addRowTestids = (html) => [...html.matchAll(/data-testid="(rail-workspace-add-(?!local)[a-z-]+)"/g)].map(m => m[1]);

describe('LIN-2802 — the rail workspace menu\'s add rows, per provider-config combination', () => {
  test('none configured: Linear + Local only', () => {
    const html = renderWorkspaceOptions(WORKSPACES, 'acme');
    assert.deepEqual(addRowTestids(html), ['rail-workspace-add-linear']);
    assert.match(html, /\+ Linear/);
    assert.ok(!html.includes('rail-workspace-add-github'));
    assert.ok(!html.includes('rail-workspace-add-jira'));
    assert.match(html, /\+ Local workspace/);
  });

  test('GitHub only configured', () => {
    configureGithub();
    const html = renderWorkspaceOptions(WORKSPACES, 'acme');
    assert.deepEqual(addRowTestids(html), ['rail-workspace-add-linear', 'rail-workspace-add-github']);
    assert.match(html, /\+ GitHub Issues/);
  });

  test('Jira only configured', () => {
    configureJira();
    const html = renderWorkspaceOptions(WORKSPACES, 'acme');
    assert.deepEqual(addRowTestids(html), ['rail-workspace-add-linear', 'rail-workspace-add-jira']);
    assert.match(html, /\+ Jira/);
  });

  test('both configured — registry order is github before jira', () => {
    configureGithub();
    configureJira();
    const html = renderWorkspaceOptions(WORKSPACES, 'acme');
    assert.deepEqual(addRowTestids(html), ['rail-workspace-add-linear', 'rail-workspace-add-github', 'rail-workspace-add-jira']);
  });
});

describe('LIN-2802 — Linear PAT hide stays orthogonal to provider config', () => {
  const PAT_WORKSPACES = [{ urlKey: 'acme', name: 'Acme', isPAT: true }];

  test('Linear row disappears under PAT, none else configured', () => {
    const html = renderWorkspaceOptions(PAT_WORKSPACES, 'acme');
    assert.deepEqual(addRowTestids(html), []);
    assert.match(html, /\+ Local workspace/);
  });

  test('Linear row disappears under PAT even with GitHub + Jira configured', () => {
    configureGithub();
    configureJira();
    const html = renderWorkspaceOptions(PAT_WORKSPACES, 'acme');
    assert.deepEqual(addRowTestids(html), ['rail-workspace-add-github', 'rail-workspace-add-jira']);
  });
});

describe('LIN-2802 — row structure invariants', () => {
  test('Local row always renders last; every add row shares one class (the old menu spaced them differently)', () => {
    configureGithub();
    configureJira();
    const html = renderWorkspaceOptions(WORKSPACES, 'acme');
    const adds = [...html.matchAll(/data-testid="(rail-workspace-add-[a-z-]+)"/g)].map(m => m[1]);
    assert.equal(adds[adds.length - 1], 'rail-workspace-add-local', 'Local is the last row');
    const rows = [...html.matchAll(/<(?:a|button)[^>]*data-testid="rail-workspace-add-[a-z-]+"[^>]*>/g)].map(m => m[0]);
    assert.equal(rows.length, 4);
    assert.ok(rows.every(r => r.includes('class="frame-menu__row frame-menu__add"')), 'one class for every add row');
  });

  test('no add row carries role="option"', () => {
    configureGithub();
    configureJira();
    const html = renderWorkspaceOptions(WORKSPACES, 'acme');
    for (const testid of ['rail-workspace-add-linear', 'rail-workspace-add-github', 'rail-workspace-add-jira', 'rail-workspace-add-local']) {
      const rowMatch = html.match(new RegExp(`<(?:a|button)[^>]*data-testid="${testid}"[^>]*>`));
      assert.ok(rowMatch, `${testid} row should exist`);
      assert.ok(!rowMatch[0].includes('role="option"'), `${testid} must not carry role="option"`);
    }
  });
});
