/**
 * LIN-1892 S2 item 7 (G2): the email sign-in entry points.
 *
 *   - The landing hero's "Continue with email" CTA is THREADED (`emailEnabled`,
 *     the established hero pattern; server.js passes isEmailSignInAvailable()).
 *   - The landing navbar's `nav-login-email` CTA CALLS the zero-import
 *     predicate directly (LIN-1890 E4: call, don't thread), so every page that
 *     renders the isLanding bar — the /swipe, /swim, /ship previews — agrees
 *     with the transport and the 503s.
 *
 * Env is set and restored per test (precedent: lin-1890-jira-entry-surfaces).
 * The e2e specs assert presence (the Playwright server runs
 * EMAIL_TRANSPORT=capture); absence is pinned here.
 *
 * Run with: node --test tests/unit/lin-1892-email-entry-surfaces.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingHero } from '../../lib/components/landing-hero.js';
import { renderLandingPage } from '../../lib/render-landing.js';
import { renderNavBar } from '../../lib/components/navbar.js';

const ENV_KEYS = ['NODE_ENV', 'EMAIL_TRANSPORT', 'EMAIL_PROMPT_STEP', 'RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_LINK_ORIGIN'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const EMAIL_CTA = /<a href="\/auth\/email" class="nav-action login" data-testid="nav-login-email">/;

describe('the landing hero (threaded emailEnabled)', () => {
  test('renders "Continue with email" iff emailEnabled', () => {
    const on = renderLandingHero({ emailEnabled: true });
    assert.match(on, /<a href="\/auth\/email" class="landing-cta landing-cta-email" data-testid="landing-cta-email">Continue with email<\/a>/);
    assert.doesNotMatch(renderLandingHero({ emailEnabled: false }), /landing-cta-email|\/auth\/email/);
  });

  test('defaults to hidden, so a caller that forgets cannot promise a 503', () => {
    assert.doesNotMatch(renderLandingHero(), /landing-cta-email/);
    assert.doesNotMatch(renderLandingPage(), /landing-cta-email/);
  });

  test('renderLandingPage threads emailEnabled to the hero', () => {
    assert.match(renderLandingPage({ emailEnabled: true }), /data-testid="landing-cta-email"/);
  });

  test('CHARACTERIZATION: the Linear, GitHub and Jira CTAs are unchanged by it', () => {
    const before = renderLandingHero({ githubEnabled: true, jiraEnabled: true });
    const after = renderLandingHero({ githubEnabled: true, jiraEnabled: true, emailEnabled: true });
    const strip = html => html.replace(/<a href="\/auth\/email"[^>]*>Continue with email<\/a>/, '');
    assert.equal(strip(after), before);
  });
});

describe('the landing navbar (calls isEmailSignInAvailable)', () => {
  test('no email variables, any NODE_ENV → no email CTA', () => {
    for (const nodeEnv of [undefined, 'development', 'test', 'production']) {
      if (nodeEnv) process.env.NODE_ENV = nodeEnv; else delete process.env.NODE_ENV;
      assert.doesNotMatch(renderNavBar({ isLanding: true }), /nav-login-email/, `NODE_ENV=${nodeEnv}`);
    }
  });

  test('Resend configured (key + from + origin) → the email CTA', () => {
    Object.assign(process.env, { NODE_ENV: 'production', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.test', EMAIL_LINK_ORIGIN: 'https://harbour.example' });
    assert.match(renderNavBar({ isLanding: true }), EMAIL_CTA);
  });

  test('Resend keys without EMAIL_LINK_ORIGIN → no CTA (the door is off)', () => {
    Object.assign(process.env, { NODE_ENV: 'production', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.test' });
    assert.doesNotMatch(renderNavBar({ isLanding: true }), /nav-login-email/);
  });

  test('EMAIL_TRANSPORT=console in development → the email CTA', () => {
    Object.assign(process.env, { NODE_ENV: 'development', EMAIL_TRANSPORT: 'console' });
    assert.match(renderNavBar({ isLanding: true }), EMAIL_CTA);
  });

  test('NODE_ENV=test without EMAIL_TRANSPORT=capture → no CTA; with it → the CTA', () => {
    process.env.NODE_ENV = 'test';
    assert.doesNotMatch(renderNavBar({ isLanding: true }), /nav-login-email/);
    process.env.EMAIL_TRANSPORT = 'capture';
    assert.match(renderNavBar({ isLanding: true }), EMAIL_CTA);
  });

  test('the email CTA comes after the provider CTAs', () => {
    Object.assign(process.env, { NODE_ENV: 'development', EMAIL_TRANSPORT: 'console' });
    const html = renderNavBar({ isLanding: true });
    assert.ok(html.indexOf('nav-login-linear') < html.indexOf('nav-login-email'));
  });

  test('{isLanding, minimalNav} (the homepage) still renders nothing', () => {
    Object.assign(process.env, { NODE_ENV: 'development', EMAIL_TRANSPORT: 'console' });
    assert.equal(renderNavBar({ isLanding: true, minimalNav: true }), '');
  });

  test('the authenticated (non-landing) bar never carries the email CTA', () => {
    Object.assign(process.env, { NODE_ENV: 'development', EMAIL_TRANSPORT: 'console' });
    const html = renderNavBar({ workspaces: [{ id: 'w', name: 'Acme', urlKey: 'acme' }], urlKey: 'acme' });
    assert.doesNotMatch(html, /nav-login-email|\/auth\/email/);
  });
});
