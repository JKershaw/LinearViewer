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
import crypto from 'node:crypto';

import { renderLandingHero } from '../../lib/components/landing-hero.js';
import { renderLandingPage } from '../../lib/render-landing.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderLoginPage } from '../../lib/render-pages.js';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { isGitHubConfigured } from '../../lib/providers/github/app-auth.js';

const JIRA_ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
// LIN-2010 step 9: the five GITHUB_* vars isGitHubConfigured() needs
// (GITHUB_REQUIRED_ENV, lib/providers/github/app-auth.js) — extended into the
// same save/restore ENV_KEYS list below so a GitHub case in this file can
// never leak env into a later Jira case or another test file.
const GITHUB_ENV_KEYS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
const ENV_KEYS = [...JIRA_ENV_KEYS, ...GITHUB_ENV_KEYS];
let saved;
const configureJira = () => {
  process.env.JIRA_CLIENT_ID = 'client-id-1';
  process.env.JIRA_CLIENT_SECRET = 'secret-1';
  process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
};
const unconfigureJira = () => { for (const k of JIRA_ENV_KEYS) delete process.env[k]; };

// A genuinely PEM-shaped ephemeral key (never written to disk) so the
// "configured" GitHub case exercises the real `assertPemShape` pass branch,
// not just an unset var — mirroring tests/unit/github-app-auth.test.js's own
// fixture rather than re-deriving PEM validity rules here.
const { privateKey: VALID_GITHUB_PEM } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const VALID_GITHUB_PEM_STR = VALID_GITHUB_PEM.export({ type: 'pkcs1', format: 'pem' });

const configureGithub = ({ privateKey = VALID_GITHUB_PEM_STR } = {}) => {
  process.env.GITHUB_CLIENT_ID = 'gh-client-id-1';
  process.env.GITHUB_CLIENT_SECRET = 'gh-secret-1';
  process.env.GITHUB_APP_ID = '123456';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_APP_SLUG = 'harbour-test';
};
const unconfigureGithub = () => { for (const k of GITHUB_ENV_KEYS) delete process.env[k]; };

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

// =============================================================================
// LIN-2010 step 9 — GitHub two-sided gating coverage
// =============================================================================
//
// Mirrors the Jira E3/E4/E5 pattern above, for GitHub, at the render layer.
// Acceptance #4 narrowed the GitHub CTA gate from "one env var present" to
// `isGitHubConfigured()` — all five GITHUB_* vars present AND a structurally
// PEM-valid private key (LIN-2081) — and nothing at the render layer proved
// the narrowing before this file. The three surfaces resolve the predicate
// differently (LIN-1890 E4 / LIN-2010 N1): navbar.js calls the registry
// directly (no threading path), while landing-hero.js and renderLoginPage
// take a `githubEnabled` boolean — renderLoginPage's DEFAULT parameter now
// reads the predicate (N1), so its zero-arg call exercises the live path.

const GITHUB_ENTRY_HREF = '/auth/github';

describe('LIN-2010 step 9 — the landing hero (mirrors Jira E3)', () => {
  test('offers the GitHub CTA when GitHub is configured', () => {
    configureGithub();
    const html = renderLandingHero({ githubEnabled: isGitHubConfigured() });
    assert.ok(html.includes(`href="${GITHUB_ENTRY_HREF}"`));
    assert.ok(html.includes('data-testid="landing-cta-github"'));
    assert.match(html, /Continue with GitHub/);
  });

  test('omits it entirely when unconfigured — never a dead link into a 503', () => {
    unconfigureGithub();
    const html = renderLandingHero({ githubEnabled: isGitHubConfigured() });
    assert.ok(!html.includes('/auth/github'), 'no GitHub link of any shape');
    assert.ok(!html.includes('landing-cta-github'));
  });
});

describe('LIN-2010 step 9 — the landing nav bar (mirrors Jira E4)', () => {
  test('offers the GitHub CTA when configured, reading the provider predicate directly', () => {
    configureGithub();
    const html = renderNavBar({ isLanding: true });
    assert.ok(html.includes(`href="${GITHUB_ENTRY_HREF}"`));
    assert.ok(html.includes('data-testid="nav-login-github"'));
  });

  test('omits it when unconfigured — the honest-degradation half of the gate', () => {
    unconfigureGithub();
    const html = renderNavBar({ isLanding: true });
    assert.ok(!html.includes('/auth/github'));
    assert.ok(!html.includes('nav-login-github'));
  });

  test('a partial config (one var only) must not render the CTA', () => {
    unconfigureGithub();
    process.env.GITHUB_CLIENT_ID = 'gh-client-id-1';
    assert.ok(!renderNavBar({ isLanding: true }).includes('/auth/github'),
      'a half-configured server must not promise a GitHub sign-in');
  });
});

describe('LIN-2010 step 9 — renderLoginPage (mirrors Jira E5; N1: default param reads the predicate)', () => {
  test('offers the GitHub CTA when configured', () => {
    configureGithub();
    const html = renderLoginPage();
    assert.ok(html.includes(`href="${GITHUB_ENTRY_HREF}"`));
    assert.ok(html.includes('data-testid="login-github"'));
  });

  test('omits it when unconfigured', () => {
    unconfigureGithub();
    assert.ok(!renderLoginPage().includes('/auth/github'));
  });
});

describe('LIN-2010 step 9 (F2) — present-but-malformed GITHUB_APP_PRIVATE_KEY', () => {
  // All five GITHUB_* vars present (so the "missing var" branch cannot fire),
  // but the key itself is non-empty and NOT PEM-shaped — the half of the
  // tightened gate acceptance #4 promises that nothing at the render layer
  // exercised before this. `isGitHubConfigured()` must read false, and the
  // CTA must be absent on all three surfaces, exactly as if the var were unset.
  test('the CTA is absent on the hero, navbar, and login — all three surfaces', () => {
    configureGithub({ privateKey: 'not-a-real-key' });
    assert.equal(isGitHubConfigured(), false, 'sanity: a malformed key must not read as configured');

    const heroHtml = renderLandingHero({ githubEnabled: isGitHubConfigured() });
    assert.ok(!heroHtml.includes('/auth/github'), 'hero: no GitHub link of any shape');
    assert.ok(!heroHtml.includes('landing-cta-github'));

    const navHtml = renderNavBar({ isLanding: true });
    assert.ok(!navHtml.includes('/auth/github'), 'navbar: no GitHub link of any shape');
    assert.ok(!navHtml.includes('nav-login-github'));

    const loginHtml = renderLoginPage();
    assert.ok(!loginHtml.includes('/auth/github'), 'login: no GitHub link of any shape');
    assert.ok(!loginHtml.includes('login-github'));
  });
});

describe('LIN-2010 step 9 — Settings add-row gate (F1, unit-level proof ahead of e2e)', () => {
  // renderSettingsPage's `githubEnabled` stays a THREADED parameter (LIN-2010
  // beat 3's step-5 correction) — server.js resolves it from the registry via
  // `getProvider('github').entryCta.isConfigured()` at the composition root, so
  // exercising the real unconfigured path here means passing that same value in,
  // not relying on the render function to read process.env for us.
  const settingsHtml = (githubEnabled) => renderSettingsPage('Acme', { urlKey: 'acme', workspaces: [], currentModel: 'x', availableModels: [], githubEnabled });

  test('local never appears in the add-row set', () => {
    assert.ok(!settingsHtml(true).includes('data-testid="settings-provider-add-local"'));
  });

  test('an unconfigured server blocks BOTH github and github-projects rows — exact class/copy tests/e2e/settings-providers.spec.js pins', () => {
    unconfigureGithub();
    const html = settingsHtml(isGitHubConfigured());

    const githubRowMatch = html.match(/<div class="line provider-add-blocked" data-testid="settings-provider-add-github"[^]*?<\/div>/);
    assert.ok(githubRowMatch, 'expected a blocked github row');
    assert.match(githubRowMatch[0], /not configured on this server/);

    const projectsRowMatch = html.match(/<div class="line provider-add-blocked" data-testid="settings-provider-add-github-projects"[^]*?<\/div>/);
    assert.ok(projectsRowMatch, 'expected a blocked github-projects row');
    assert.match(projectsRowMatch[0], /not configured on this server/);
  });
});
