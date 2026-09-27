/**
 * LIN-1892 S2 items 6, 11, 13: the account home (`GET /account`) for a
 * signed-in account with zero workspaces, and the N1 redirect that sends such
 * a session there from `/` and the unauthenticated previews.
 *
 * `/account` runs through the real-express-session harness
 * (tests/fixtures/email-auth-harness.js). The `/`/preview handlers live inline
 * in server.js, which no unit test boots; their decision is the shared
 * `accountHomeRedirect` helper (unit-tested here), and a source pin checks each
 * route calls it after its own workspace redirect and before rendering. The
 * real routes are driven end to end by the W2 Playwright spec.
 *
 * Run with: node --test tests/unit/account-home.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEmailAuthHarness, tokenFromOutbox } from '../fixtures/email-auth-harness.js';
import { accountHomeRedirect } from '../../routes/email-auth.js';
import { ACCOUNT_HOME_C6_LINE, accountHomeSourceCtas, renderAccountHomePage } from '../../lib/render-account-home.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

async function signInByEmail(harness, email) {
  const browser = harness.browser();
  await browser.requestLink(email);
  const t = tokenFromOutbox(harness.transport, email);
  const { nonce } = await browser.openConfirm(t);
  const res = await browser.confirm(t, nonce);
  assert.strictEqual(res.location, '/account');
  return browser;
}

describe('GET /account', () => {
  let harness;
  before(async () => { harness = await startEmailAuthHarness(); });
  after(async () => { await harness?.close(); });

  test('signed out → redirect to / (the landing page)', async () => {
    const res = await harness.browser().get('/account');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, '/');
  });

  test('an email-only account: its email, the source CTAs, the local form, logout, and the C6 line', async () => {
    const browser = await signInByEmail(harness, 'home@x.io');
    const res = await browser.get('/account');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.match(res.text, /data-testid="account-home"/);
    assert.match(res.text, /data-testid="account-home-email">Signed in as home@x\.io</);
    assert.match(res.text, /data-testid="account-home-add-linear"[^>]*>Connect Linear</);
    assert.match(res.text, /href="\/auth\/linear"/);
    assert.match(res.text, /<form action="\/workspace\/new" method="POST" class="local-workspace-cta">/);
    assert.match(res.text, /href="\/logout"[^>]*data-testid="account-home-logout"/);
    assert.match(res.text, /data-testid="account-home-c6">Workspaces don&#039;t follow you to a new device yet: reconnect a source here\.</);
  });

  test('a session that holds a workspace goes to / (which takes it to that workspace): no loop with the / branch', async () => {
    const browser = harness.browser();
    await browser.post('/__test/sign-in', { provider: 'linear', scope: 'viewer-ws', workspaceId: 'ws-1', urlKey: 'acme' });
    const res = await browser.get('/account');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.location, '/');
  });

  test('available even when email sign-in is off (it belongs to the account, not the email door)', async () => {
    const off = await startEmailAuthHarness({ transport: null });
    try {
      const browser = off.browser();
      await browser.post('/__test/sign-in', { provider: 'email', scope: 'legacy@x.io' });
      const res = await browser.get('/account');
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /data-testid="account-home"/);
    } finally {
      await off.close();
    }
  });
});

describe('the C6 line claims no cross-device restore', () => {
  test('it says workspaces do NOT follow to a new device yet, and promises no sync or restore', () => {
    assert.strictEqual(ACCOUNT_HOME_C6_LINE, "Workspaces don't follow you to a new device yet: reconnect a source here.");
    assert.doesNotMatch(ACCOUNT_HOME_C6_LINE, /\b(sync|synced|restore|restored|all your workspaces)\b/i);
  });
});

describe('source CTAs follow the registry and each provider\'s own isConfigured()', () => {
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
  let saved;
  before(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); });
  after(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test('unconfigured: Linear only (never a dead link)', () => {
    for (const k of ENV) delete process.env[k];
    assert.deepStrictEqual(accountHomeSourceCtas().map(c => c.name), ['linear']);
    assert.doesNotMatch(renderAccountHomePage(), /account-home-add-(github|jira)/);
  });

  test('configured: GitHub and Jira join, with their entryCta hrefs', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, {
      GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'secret', GITHUB_APP_ID: '1', GITHUB_APP_SLUG: 'app',
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }),
      JIRA_CLIENT_ID: 'jid', JIRA_CLIENT_SECRET: 'jsecret', JIRA_REDIRECT_URI: 'https://harbour.example/auth/jira/callback',
    });
    const ctas = accountHomeSourceCtas();
    assert.deepStrictEqual(ctas.map(c => c.name), ['linear', 'github', 'jira']);
    assert.strictEqual(ctas.find(c => c.name === 'github').href, '/auth/github');
    assert.strictEqual(ctas.find(c => c.name === 'jira').href, '/auth/jira/oauth?mode=new');
    const html = renderAccountHomePage({ emails: ['a@x.io'] });
    assert.match(html, /data-testid="account-home-add-github"/);
    assert.match(html, /href="\/auth\/jira\/oauth\?mode=new"/);
  });
});

describe('accountHomeRedirect (N1: zero workspaces + accountId is not signed out)', () => {
  function run(session) {
    const res = { redirectedTo: null, redirect(url) { this.redirectedTo = url; } };
    const redirected = accountHomeRedirect({ session }, res);
    return { redirected, to: res.redirectedTo };
  }

  test('an account with zero workspaces → /account', () => {
    assert.deepStrictEqual(run({ accountId: 'A', workspaces: [] }), { redirected: true, to: '/account' });
    assert.deepStrictEqual(run({ accountId: 'A' }), { redirected: true, to: '/account' });
  });

  test('every pre-LIN-1892 session shape is untouched: signed out, or holding workspaces', () => {
    for (const session of [{}, { workspaces: [] }, { workspaces: [{ id: 'w' }] }, { accountId: 'A', workspaces: [{ id: 'w' }] }, { accountId: '' }, undefined]) {
      assert.deepStrictEqual(run(session), { redirected: false, to: null }, JSON.stringify(session));
    }
  });
});

describe('server.js wires accountHomeRedirect into /, /swipe, /swim and /ship', () => {
  const source = readFileSync(join(ROOT, 'server.js'), 'utf8');

  function routeBody(header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, `${header} exists`);
    const end = source.indexOf('\napp.', start + header.length);
    return source.slice(start, end);
  }

  for (const [header, render] of [
    ["app.get('/', (req, res) => {", 'renderLandingPage('],
    ["app.get('/swipe/:identifier?', (req, res) => {", 'renderSwipePage('],
    ["app.get('/swim', (req, res) => {", 'renderSwimPage('],
    ["app.get('/ship', (req, res) => {", 'renderShipPage('],
  ]) {
    test(`${header.split(',')[0]}: workspace redirect first, then the account home, then the unauthenticated render`, () => {
      const body = routeBody(header);
      const workspaceBranch = body.indexOf('if (workspace) {');
      const accountBranch = body.indexOf('if (accountHomeRedirect(req, res)) return');
      const renderCall = body.indexOf(render);
      assert.ok(workspaceBranch >= 0 && accountBranch > workspaceBranch && renderCall > accountBranch,
        `order: workspace (${workspaceBranch}) < account home (${accountBranch}) < ${render} (${renderCall})`);
      assert.strictEqual(body.split('accountHomeRedirect(').length - 1, 1, 'called exactly once');
    });
  }
});
