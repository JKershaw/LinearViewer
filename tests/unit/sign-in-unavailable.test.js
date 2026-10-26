/**
 * LIN-3980 outcome 7: an unconfigured sign-in door shows a plain sentence and a
 * way back. The unset environment-variable names go to the server log, never
 * the page. Covers the helper, and the Linear and Jira doors end to end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSignInUnavailablePage } from '../../lib/render-pages.js';
import { createAuthRoutes } from '../../routes/auth.js';
import { createJiraAuthRoutes } from '../../routes/jira-auth.js';

const ENV_NAME = /\b(LINEAR|JIRA|GITHUB)_[A-Z_]+\b/;

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    send(html) { this.body = html; return this; },
    redirect() { return this; },
  };
}

function captureWarn() {
  const warnings = [];
  return { warnings, warn: (msg) => warnings.push(msg) };
}

test('the helper says the sign-in is not set up and gives a way back, with no variable name', () => {
  const log = captureWarn();
  const html = renderSignInUnavailablePage('Linear', ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'], log);
  assert.match(html, /Linear sign-in is not set up/);
  assert.match(html, /<a href="\/" class="login-button">Go back<\/a>/);
  assert.doesNotMatch(html, ENV_NAME);
  assert.doesNotMatch(html, /Missing environment/);
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET/, 'the names reach the server log');
});

// LIN-3995 outcome 2: the door carries the landing's look. The Harbour wordmark
// is the page heading and links home, and the title drops the "Projects" suffix.
for (const name of ['Linear', 'Jira', 'GitHub', 'GitHub Projects']) {
  test(`the ${name} sign-in page heads with the Harbour wordmark linking to / and its title has no "Projects"`, () => {
    const html = renderSignInUnavailablePage(name, [], captureWarn());
    assert.match(html, /<h1><a href="\/" class="header-link">Harbour<\/a><\/h1>/);
    assert.match(html, new RegExp(`<title>${name} sign-in is not set up - Harbour</title>`));
    assert.doesNotMatch(html, /<title>[^<]*Projects<\/title>/);
  });
}

test('the helper logs nothing when no variable is missing', () => {
  const log = captureWarn();
  renderSignInUnavailablePage('Jira', [], log);
  assert.equal(log.warnings.length, 0);
});

// The Linear door's check is injectable, so this fails before the change: the
// old check read process.env, which is NODE_ENV=test under the suite and so
// reported nothing missing.
for (const path of ['/auth/linear', '/auth/callback']) {
  test(`the Linear door ${path} names no environment variable when unconfigured`, async () => {
    const warn = captureWarn();
    const savedWarn = console.warn;
    console.warn = (msg) => warn.warn(msg);
    try {
      const router = createAuthRoutes({
        userPreferencesStore: null,
        accountStore: null,
        accountWorkspaceStore: null,
        env: { NODE_ENV: 'production' },
      });
      const res = makeRes();
      await getHandler(router, 'get', path)({ query: { code: 'x', state: 'y' }, session: {} }, res);
      assert.equal(res.statusCode, 503);
      assert.match(res.body, /Linear sign-in is not set up/);
      assert.doesNotMatch(res.body, /LINEAR_CLIENT_ID|LINEAR_CLIENT_SECRET|LINEAR_REDIRECT_URI/);
      assert.match(warn.warnings.join('\n'), /LINEAR_CLIENT_ID/);
    } finally {
      console.warn = savedWarn;
    }
  });
}

test('the Jira door names no environment variable when unconfigured', () => {
  const savedEnv = {};
  for (const v of ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI']) {
    savedEnv[v] = process.env[v];
    delete process.env[v];
  }
  const savedWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const router = createJiraAuthRoutes({});
    const res = makeRes();
    getHandler(router, 'get', '/auth/jira/oauth')({ query: {}, session: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Jira sign-in is not set up/);
    assert.doesNotMatch(res.body, /JIRA_[A-Z_]+/);
    assert.ok(warnings.some(w => /JIRA_CLIENT_ID/.test(w)), 'the names reach the server log');
  } finally {
    console.warn = savedWarn;
    for (const [v, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[v]; else process.env[v] = val;
    }
  }
});
