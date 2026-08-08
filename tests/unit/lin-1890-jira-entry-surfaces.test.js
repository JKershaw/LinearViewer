/**
 * LIN-1890 E3/E4/E5 — the three entry surfaces that can offer "Continue with
 * Jira", and the one rule they share: the CTA is rendered if and ONLY if the
 * server can actually complete the flow.
 *
 * That rule is not cosmetic. `/auth/jira/oauth` 503s when JIRA_CLIENT_ID /
 * JIRA_CLIENT_SECRET / JIRA_REDIRECT_URI are unset (and so does its callback),
 * so an ungated CTA is a promise the server cannot keep. Both halves are
 * asserted here — rendered when configured, ABSENT when not — because only the
 * pair proves the gate rather than the markup.
 *
 * Why this is the configured-path coverage rather than an e2e: the Playwright
 * server is a single shared `webServer` with no per-project env (LIN-1890 plan
 * F2), so a `process.env` mutation to configure Jira would be process-global
 * across both CI workers. The house convention for exactly this case is
 * documented at `tests/e2e/settings-providers.spec.js` — the e2e proves honest
 * DEGRADATION against a real unconfigured server, the configured path is proven
 * here. No configured Jira CTA is rendered by a real server in CI, exactly as
 * none has been for GitHub since LIN-541.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { renderLandingHero } from '../../lib/components/landing-hero.js';
import { renderLandingPage } from '../../lib/render-landing.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderLoginPage } from '../../lib/render-pages.js';

const ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
let saved;
const configureJira = () => {
  process.env.JIRA_CLIENT_ID = 'client-id-1';
  process.env.JIRA_CLIENT_SECRET = 'secret-1';
  process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
};
const unconfigureJira = () => { for (const k of ENV_KEYS) delete process.env[k]; };

beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]])); });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

// The href every surface must agree on. `?mode=new` is stated explicitly rather
// than relying on the route's default: the landing IS the new-login entry, and a
// surface that silently depended on a default would break if the default moved.
const JIRA_ENTRY_HREF = '/auth/jira/oauth?mode=new';

describe('LIN-1890 E3 — the landing hero', () => {
  test('offers the Jira CTA when Jira OAuth is configured', () => {
    const html = renderLandingHero({ jiraEnabled: true });
    assert.ok(html.includes(`href="${JIRA_ENTRY_HREF}"`), 'the CTA points at the new-login entry');
    assert.ok(html.includes('data-testid="landing-cta-jira"'));
    assert.match(html, /Continue with Jira/);
  });

  test('omits it entirely when unconfigured — never a dead link into a 503', () => {
    const html = renderLandingHero({ jiraEnabled: false });
    assert.ok(!html.includes('/auth/jira'), 'no Jira link of any shape');
    assert.ok(!html.includes('landing-cta-jira'));
  });

  test('defaults to disabled, like GitHub', () => {
    assert.ok(!renderLandingHero().includes('/auth/jira'));
  });

  test('CHARACTERIZATION: the Linear and GitHub CTAs are unchanged', () => {
    // Adding a third CTA must not disturb the two that were already there.
    const html = renderLandingHero({ githubEnabled: true, jiraEnabled: true });
    assert.ok(html.includes('href="/auth/linear"'));
    assert.ok(html.includes('data-testid="landing-cta-linear"'));
    assert.ok(html.includes('href="/auth/github"'));
    assert.ok(html.includes('data-testid="landing-cta-github"'));
    // And the gates stay independent of one another.
    const jiraOnly = renderLandingHero({ githubEnabled: false, jiraEnabled: true });
    assert.ok(!jiraOnly.includes('/auth/github'));
    assert.ok(jiraOnly.includes('/auth/jira'));
  });
});

describe('LIN-1890 E3 — threaded through the landing page', () => {
  test('renderLandingPage threads jiraEnabled to the hero', () => {
    assert.ok(renderLandingPage({ jiraEnabled: true }).includes('data-testid="landing-cta-jira"'));
    assert.ok(!renderLandingPage({ jiraEnabled: false }).includes('landing-cta-jira'));
  });

  test('defaults to disabled, so a caller that forgets cannot promise a 503', () => {
    assert.ok(!renderLandingPage({}).includes('landing-cta-jira'));
  });
});

describe('LIN-1890 E4 — the landing nav bar', () => {
  test('offers the Jira CTA when configured, reading the provider predicate directly', () => {
    configureJira();
    const html = renderNavBar({ isLanding: true });
    assert.ok(html.includes(`href="${JIRA_ENTRY_HREF}"`));
    assert.ok(html.includes('data-testid="nav-login-jira"'));
  });

  test('omits it when unconfigured — the honest-degradation half of the gate', () => {
    unconfigureJira();
    const html = renderNavBar({ isLanding: true });
    assert.ok(!html.includes('/auth/jira'));
    assert.ok(!html.includes('nav-login-jira'));
  });

  test('the gate follows the predicate, not a threaded option', () => {
    // A PARTIAL config must not render the CTA: the route needs all three vars
    // and 503s without them. This is the reason the surface calls
    // `isJiraOAuthConfigured()` rather than testing one env var inline.
    unconfigureJira();
    process.env.JIRA_CLIENT_ID = 'client-id-1';
    assert.ok(!renderNavBar({ isLanding: true }).includes('/auth/jira'),
      'a half-configured server must not promise a Jira sign-in');
  });

  test('the Linear CTA is nameable on its own (N4 — `nav a.login` is now ambiguous)', () => {
    configureJira();
    const html = renderNavBar({ isLanding: true });
    assert.ok(html.includes('data-testid="nav-login-linear"'));
    // The shared class is retained for styling — the testid is what makes the
    // three CTAs individually selectable.
    const loginCtas = html.match(/class="nav-action login"/g) || [];
    assert.ok(loginCtas.length >= 2, 'more than one CTA carries the shared class, which is why it cannot be a selector');
  });

  test('CHARACTERIZATION: the homepage still suppresses the whole bar', () => {
    // LIN-1508: `minimalNav` drops the landing bar entirely because the hero
    // carries the CTAs there. A new CTA must not resurrect it.
    configureJira();
    assert.equal(renderNavBar({ isLanding: true, minimalNav: true }), '');
  });

  test('CHARACTERIZATION: authenticated pages are untouched', () => {
    configureJira();
    const html = renderNavBar({ isLanding: false, urlKey: 'acme', workspaces: [{ urlKey: 'acme', name: 'Acme' }] });
    assert.ok(!html.includes('/auth/jira'), 'the Jira CTA belongs to the unauthenticated bar only');
    assert.ok(!html.includes('nav-login-linear'));
  });
});

describe('LIN-1890 E5 — renderLoginPage (dead in production, consistency only)', () => {
  test('offers the Jira CTA when configured', () => {
    configureJira();
    const html = renderLoginPage();
    assert.ok(html.includes(`href="${JIRA_ENTRY_HREF}"`));
    assert.ok(html.includes('data-testid="login-jira"'));
  });

  test('omits it when unconfigured', () => {
    unconfigureJira();
    assert.ok(!renderLoginPage().includes('/auth/jira'));
  });

  test('an explicit option overrides the predicate', () => {
    unconfigureJira();
    assert.ok(renderLoginPage({ jiraEnabled: true }).includes('data-testid="login-jira"'));
    configureJira();
    assert.ok(!renderLoginPage({ jiraEnabled: false }).includes('/auth/jira'));
  });

  test('CHARACTERIZATION: Linear, GitHub and the local-workspace CTA are unchanged', () => {
    configureJira();
    const html = renderLoginPage({ githubEnabled: true });
    assert.ok(html.includes('href="/auth/linear"'));
    assert.ok(html.includes('data-testid="login-github"'));
    assert.ok(html.includes('local-workspace-cta'));
  });
});
